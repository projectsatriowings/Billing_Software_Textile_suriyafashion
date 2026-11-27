import type { ExtractedProductRecord, ProductMatchCandidate } from '../schemas/invoice.schema.ts';

export interface CatalogItemRow {
  id: string;
  name: string;
  sku?: string | null;
  barcode?: string | null;
  hsn?: string | null;
  unit?: string | null;
  priceMinor: number;
  costMinor: number;
}

function normalizeStr(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function tokenize(s: string): string[] {
  return normalizeStr(s).split(' ').filter((t) => t.length > 0);
}

function computeTokenSimilarity(a: string, b: string): number {
  const ta = new Set(tokenize(a));
  const tb = new Set(tokenize(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let intersection = 0;
  for (const t of ta) {
    if (tb.has(t)) intersection++;
  }
  const union = ta.size + tb.size - intersection;
  return union > 0 ? intersection / union : 0;
}

/**
 * Matches extracted invoice products against existing inventory catalog.
 * Distinguishes exact_match, potential_match, ambiguous_match, and new_product.
 * Never auto-merges ambiguous matches.
 */
export function matchProductsWithCatalog(
  items: ExtractedProductRecord[],
  catalogRows: CatalogItemRow[]
): ExtractedProductRecord[] {
  const exactMap = new Map<string, CatalogItemRow[]>();
  for (const row of catalogRows) {
    const key = normalizeStr(row.name);
    if (!key) continue;
    const list = exactMap.get(key) || [];
    list.push(row);
    exactMap.set(key, list);
  }

  return items.map((item) => {
    const itemKey = normalizeStr(item.name);
    if (!itemKey) {
      return {
        ...item,
        matchType: 'new_product',
        matchedItemId: null,
        matchedItemName: null,
        matchCandidates: [],
      };
    }

    const exactHits = exactMap.get(itemKey) || [];
    if (exactHits.length === 1) {
      const hit = exactHits[0];
      const sp = item.sellingPrice || (hit.priceMinor > 0 ? (hit.priceMinor / 100).toFixed(2) : '');
      const flags = (item.flags || []).filter((f) => f !== 'Selling Price required' || !sp);
      return {
        ...item,
        sellingPrice: sp,
        flags,
        matchType: 'exact_match',
        matchedItemId: hit.id,
        matchedItemName: hit.name,
        matchCandidates: [
          {
            itemId: hit.id,
            name: hit.name,
            sku: hit.sku ?? null,
            barcode: hit.barcode ?? null,
            hsn: hit.hsn ?? null,
            unit: hit.unit ?? null,
            sellingPriceMinor: hit.priceMinor,
            costPriceMinor: hit.costMinor,
            similarityScore: 1,
            matchReason: 'Exact normalized product name match',
          },
        ],
      };
    }

    // Score potential candidates
    const candidates: ProductMatchCandidate[] = [];
    for (const row of catalogRows) {
      let score = computeTokenSimilarity(item.name, row.name);
      const reasons: string[] = [];
      if (score >= 0.4) reasons.push(`${Math.round(score * 100)}% name similarity`);
      if (item.hsn && row.hsn && item.hsn.trim() === row.hsn.trim()) {
        score = Math.min(1, score + 0.15);
        reasons.push('Same HSN');
      }
      if (item.uom && row.unit && item.uom.toLowerCase() === row.unit.toLowerCase()) {
        score = Math.min(1, score + 0.05);
        reasons.push('Same UOM');
      }
      if (score >= 0.45) {
        candidates.push({
          itemId: row.id,
          name: row.name,
          sku: row.sku ?? null,
          barcode: row.barcode ?? null,
          hsn: row.hsn ?? null,
          unit: row.unit ?? null,
          sellingPriceMinor: row.priceMinor,
          costPriceMinor: row.costMinor,
          similarityScore: Math.round(score * 100) / 100,
          matchReason: reasons.join(' · ') || 'Partial match',
        });
      }
    }

    candidates.sort((a, b) => b.similarityScore - a.similarityScore);
    const topCandidates = candidates.slice(0, 5);

    if (exactHits.length > 1 || (topCandidates.length >= 2 && topCandidates[0].similarityScore - topCandidates[1].similarityScore < 0.1)) {
      return {
        ...item,
        matchType: 'ambiguous_match',
        matchedItemId: null,
        matchedItemName: null,
        matchCandidates: topCandidates,
      };
    }

    if (topCandidates.length >= 1) {
      return {
        ...item,
        matchType: 'potential_match',
        matchedItemId: null,
        matchedItemName: null,
        matchCandidates: topCandidates,
      };
    }

    return {
      ...item,
      matchType: 'new_product',
      matchedItemId: null,
      matchedItemName: null,
      matchCandidates: [],
    };
  });
}
