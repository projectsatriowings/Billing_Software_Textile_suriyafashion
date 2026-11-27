import { parseImportNumeric } from '../../../../../shared/bulkImport.ts';
import type {
  ExtractedInvoiceHeader,
  ExtractedProductRecord,
  ReviewStatus,
  ValidationIssue,
} from '../schemas/invoice.schema.ts';

const VALID_GST_RATES = new Set([0, 0.25, 1.5, 2.5, 3, 5, 6, 9, 12, 14, 18, 28]);

export function validateExtractedInvoice(
  header: ExtractedInvoiceHeader,
  items: ExtractedProductRecord[],
  existingInvoiceNumbers: Set<string> = new Set()
): {
  items: ExtractedProductRecord[];
  issues: ValidationIssue[];
  duplicateInvoiceWarning: string | null;
} {
  const issues: ValidationIssue[] = [];
  let duplicateInvoiceWarning: string | null = null;

  if (header.invoiceNumber) {
    const invKey = header.invoiceNumber.trim().toLowerCase();
    if (existingInvoiceNumbers.has(invKey)) {
      duplicateInvoiceWarning = `Invoice number "${header.invoiceNumber}" already exists in purchases/history.`;
      issues.push({
        code: 'DUPLICATE_INVOICE',
        severity: 'warning',
        message: duplicateInvoiceWarning,
      });
    }
  }

  // Track duplicate product names within the same invoice
  const seenNames = new Map<string, number>();
  for (const item of items) {
    const normKey = item.name.trim().toLowerCase().replace(/\s+/g, ' ');
    if (normKey) {
      seenNames.set(normKey, (seenNames.get(normKey) || 0) + 1);
    }
  }

  const validatedItems = items.map((item, idx) => {
    const rowOrder = item.rowOrder || idx + 1;
    const warningMessages = new Set<string>(item.warningMessages || []);
    const validationErrors = new Set<string>();
    const flags = new Set<string>(item.flags || []);

    const name = item.name.trim();
    const qty = parseImportNumeric(item.openingStock) ?? item.quantity;
    const cost = parseImportNumeric(item.costPrice);
    const sp = parseImportNumeric(item.sellingPrice);
    const gstNum = parseImportNumeric(item.gstRate ? item.gstRate.replace('%', '') : null);
    const hsnClean = (item.hsn || '').replace(/\s+/g, '');

    if (!name) {
      validationErrors.add('Product name is missing');
      flags.add('Product Name required');
    }

    if (qty === null || qty <= 0) {
      validationErrors.add('Quantity must be greater than 0');
    } else if (qty > 100000) {
      warningMessages.add(`Unusually high quantity (${qty}). Please verify.`);
    }

    if (cost === null || cost < 0) {
      validationErrors.add('Cost price is missing or negative');
      flags.add('Cost Price uncertain');
    } else if (cost === 0) {
      warningMessages.add('Cost price is 0. Verify if free/sample item.');
    }

    if (sp === null || sp <= 0) {
      flags.add('Selling Price required');
    } else if (cost !== null && sp < cost) {
      warningMessages.add(`Selling price (₹${sp.toFixed(2)}) is lower than cost price (₹${cost.toFixed(2)}).`);
    }

    if (hsnClean && !/^\d{4}(\d{2})?(\d{2})?$/.test(hsnClean)) {
      warningMessages.add(`Invalid HSN format "${hsnClean}" (expected 4, 6, or 8 digits).`);
    }

    if (gstNum !== null && !VALID_GST_RATES.has(gstNum)) {
      warningMessages.add(`Unusual GST rate ${gstNum}% (standard slabs: 0%, 5%, 12%, 18%, 28%).`);
    }

    // Validate qty * unitPurchaseRate - discount = lineItemAmount
    let hasMathMismatch = false;
    if (
      item.unitPurchaseRate !== null &&
      qty !== null &&
      qty > 0 &&
      item.lineItemAmount !== null &&
      item.lineItemAmount > 0
    ) {
      const discount = item.discountAmount ?? 0;
      const expectedExcl = qty * item.unitPurchaseRate - discount;
      const gstMult = gstNum !== null ? 1 + gstNum / 100 : 1;
      const expectedIncl = expectedExcl * gstMult;

      const diffExcl = Math.abs(expectedExcl - item.lineItemAmount);
      const diffIncl = Math.abs(expectedIncl - item.lineItemAmount);

      if (Math.min(diffExcl, diffIncl) > Math.max(2, item.lineItemAmount * 0.02)) {
        hasMathMismatch = true;
        warningMessages.add(
          `Line math mismatch: ${qty} × ₹${item.unitPurchaseRate.toFixed(2)} = ₹${expectedExcl.toFixed(2)}, invoice shows ₹${item.lineItemAmount.toFixed(2)}.`
        );
      }
    }

    const normKey = name.toLowerCase().replace(/\s+/g, ' ');
    const isDuplicateRow = Boolean(normKey && (seenNames.get(normKey) || 0) > 1);
    if (isDuplicateRow) {
      warningMessages.add('Duplicate product row detected in this invoice.');
    }

    // Determine granular ReviewStatus
    let reviewStatus: ReviewStatus = 'verified';
    if (validationErrors.size > 0) {
      reviewStatus = 'missing_information';
    } else if (hasMathMismatch) {
      reviewStatus = 'calculation_mismatch';
    } else if (isDuplicateRow) {
      reviewStatus = 'duplicate_product';
    } else if (warningMessages.size > 0 || item.matchType === 'ambiguous_match') {
      reviewStatus = 'needs_review';
    } else if (!item.userApproved && item.matchType === 'new_product') {
      reviewStatus = 'verified';
    }

    for (const err of validationErrors) {
      issues.push({ code: 'ROW_ERROR', severity: 'error', rowId: item.id, rowOrder, message: `Row ${rowOrder}: ${err}` });
    }
    for (const warn of warningMessages) {
      issues.push({ code: 'ROW_WARNING', severity: 'warning', rowId: item.id, rowOrder, message: `Row ${rowOrder}: ${warn}` });
    }

    return {
      ...item,
      rowOrder,
      warningMessages: Array.from(warningMessages),
      validationErrors: Array.from(validationErrors),
      flags: Array.from(flags),
      reviewStatus,
    };
  });

  return { items: validatedItems, issues, duplicateInvoiceWarning };
}
