import { parseImportNumeric } from '../../../../../shared/bulkImport.ts';
import type {
  ExtractedInvoiceHeader,
  ExtractedProductRecord,
  ReconciliationReport,
} from '../schemas/invoice.schema.ts';

/**
 * Reconciles extracted product lines against invoice-level subtotal, GST breakdown,
 * discounts, other charges, round-off, and grand total.
 * Never alters original supplier amounts to force a match.
 */
export function reconcileInvoice(
  header: ExtractedInvoiceHeader,
  items: ExtractedProductRecord[]
): ReconciliationReport {
  let extractedLineSum = 0;
  let extractedTaxSum = 0;

  for (const item of items) {
    const qty = parseImportNumeric(item.openingStock) ?? item.quantity ?? 0;
    const cost = parseImportNumeric(item.costPrice) ?? 0;
    const gstPct = parseImportNumeric(item.gstRate ? item.gstRate.replace('%', '') : null) ?? item.gstPercentage ?? 0;

    if (cost > 0 && qty > 0) {
      const lineGross = cost * qty;
      extractedLineSum += lineGross;
      if (gstPct > 0) {
        if (item.priceInclusive === 'Yes') {
          const taxable = lineGross / (1 + gstPct / 100);
          extractedTaxSum += lineGross - taxable;
        } else {
          extractedTaxSum += (lineGross * gstPct) / 100;
        }
      }
    }
  }

  extractedLineSum = Math.round(extractedLineSum * 100) / 100;
  extractedTaxSum = Math.round(extractedTaxSum * 100) / 100;

  const invoiceSubtotal = header.subtotal;
  const subtotalDifference =
    invoiceSubtotal !== null ? Math.round((extractedLineSum - invoiceSubtotal) * 100) / 100 : null;

  const hasTaxParts = header.cgst !== null || header.sgst !== null || header.igst !== null;
  const invoiceTaxTotal = hasTaxParts
    ? Math.round(((header.cgst ?? 0) + (header.sgst ?? 0) + (header.igst ?? 0)) * 100) / 100
    : null;
  const taxDifference =
    invoiceTaxTotal !== null ? Math.round((extractedTaxSum - invoiceTaxTotal) * 100) / 100 : null;

  // Compute grand total from extracted lines + header adjustments when prices are exclusive
  const exclusiveExtraTax = items.some((i) => i.priceInclusive === 'No') ? extractedTaxSum : 0;
  const computedGrandTotal =
    Math.round(
      (extractedLineSum +
        exclusiveExtraTax -
        (header.discount ?? 0) +
        (header.otherCharges ?? 0) +
        (header.roundOff ?? 0)) *
        100
    ) / 100;

  const invoiceGrandTotal = header.finalInvoiceAmount;
  const grandTotalDifference =
    invoiceGrandTotal !== null ? Math.round((computedGrandTotal - invoiceGrandTotal) * 100) / 100 : null;

  const discrepancyMessages: string[] = [];
  if (taxDifference !== null && Math.abs(taxDifference) > 1.5) {
    discrepancyMessages.push(
      `Tax discrepancy: Calculated item tax (₹${extractedTaxSum.toFixed(2)}) differs from invoice tax summary (₹${invoiceTaxTotal!.toFixed(2)}) by ₹${Math.abs(taxDifference).toFixed(2)}.`
    );
  }
  if (grandTotalDifference !== null && Math.abs(grandTotalDifference) > 1.5) {
    discrepancyMessages.push(
      `Total discrepancy: Extracted items total (₹${computedGrandTotal.toFixed(2)}) differs from invoice grand total (₹${invoiceGrandTotal!.toFixed(2)}) by ₹${Math.abs(grandTotalDifference).toFixed(2)}.`
    );
  }
  if (header.cgst !== null && header.sgst !== null && header.igst !== null && header.igst > 0 && (header.cgst > 0 || header.sgst > 0)) {
    discrepancyMessages.push('Invoice has both CGST/SGST and IGST populated; verify intra-state vs inter-state GST.');
  }

  return {
    invoiceSubtotal,
    extractedLineSum,
    subtotalDifference,
    invoiceTaxTotal,
    extractedTaxSum,
    taxDifference,
    invoiceGrandTotal,
    computedGrandTotal,
    grandTotalDifference,
    isReconciled: discrepancyMessages.length === 0,
    discrepancyMessages,
  };
}
