import type { ExtractedProductRecord } from '../schemas/invoice.schema.ts';

export interface SupplierCorrectionRule {
  id: string;
  originalOcrName: string;
  normalizedOcrKey: string;
  correctedName: string;
  preferredUom?: string | null;
  preferredHsn?: string | null;
  preferredGstRate?: string | null;
  matchedItemId?: string | null;
}

export function normalizeCorrectionKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Applies historical supplier-specific corrections as non-destructive suggestions.
 */
export function applySupplierLearningSuggestions(
  items: ExtractedProductRecord[],
  corrections: SupplierCorrectionRule[]
): ExtractedProductRecord[] {
  if (!corrections.length) return items;
  const byKey = new Map<string, SupplierCorrectionRule>();
  for (const c of corrections) {
    if (c.normalizedOcrKey) byKey.set(c.normalizedOcrKey, c);
  }

  return items.map((item) => {
    const key = normalizeCorrectionKey(item.originalOcrText || item.name);
    const rule = byKey.get(key);
    if (!rule) return item;

    return {
      ...item,
      name: rule.correctedName || item.name,
      uom: rule.preferredUom || item.uom,
      hsn: rule.preferredHsn || item.hsn,
      gstRate: rule.preferredGstRate || item.gstRate,
      matchedItemId: rule.matchedItemId || item.matchedItemId,
      warningMessages: [
        ...item.warningMessages,
        `Applied learned mapping from previous supplier invoice ("${rule.originalOcrName}" → "${rule.correctedName}").`,
      ],
    };
  });
}

/**
 * Selling Price Intelligence:
 * - Markup %: SP = Cost * (1 + pct / 100)
 * - Margin %: SP = Cost / (1 - pct / 100)  (requires pct < 100)
 * Never treats purchase cost as selling price automatically.
 */
export function calculateSellingPriceFromRule(
  costPrice: number,
  mode: 'markup' | 'margin',
  percentage: number
): number | null {
  if (!Number.isFinite(costPrice) || costPrice <= 0) return null;
  if (!Number.isFinite(percentage) || percentage <= 0) return null;

  if (mode === 'markup') {
    return Math.round(costPrice * (1 + percentage / 100) * 100) / 100;
  }
  if (percentage >= 100) return null;
  return Math.round((costPrice / (1 - percentage / 100)) * 100) / 100;
}
