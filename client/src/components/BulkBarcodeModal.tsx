import React, { useState, useEffect, useMemo, useRef } from 'react';
import { type Item } from '../api';
import { renderBarcodeSvg } from '../../../shared/bulkImport.ts';
import './bulk-barcode.css';

export interface LabelSizeOption {
  id: string;
  name: string;
  widthMm: number;
  heightMm: number;
  isThermal: boolean;
  cols?: number;
  rows?: number;
  labelsPerPage?: number;
}

export const BULK_LABEL_SIZES: LabelSizeOption[] = [
  // A4 Sticker Sheets (Laser/Inkjet/PDF/Normal Printer)
  { id: 'sheet-a4-30', name: '📄 A4 Sheet — 30 Labels (3 × 10 grid, 70 × 29.7 mm)', widthMm: 70, heightMm: 29.7, isThermal: false, cols: 3, rows: 10, labelsPerPage: 30 },
  { id: 'sheet-a4-24', name: '📄 A4 Sheet — 24 Labels (3 × 8 grid, 70 × 36 mm)', widthMm: 70, heightMm: 36, isThermal: false, cols: 3, rows: 8, labelsPerPage: 24 },
  { id: 'sheet-a4-40', name: '📄 A4 Sheet — 40 Labels (4 × 10 grid, 52.5 × 29.7 mm)', widthMm: 52.5, heightMm: 29.7, isThermal: false, cols: 4, rows: 10, labelsPerPage: 40 },
  { id: 'sheet-a4-65', name: '📄 A4 Sheet — 65 Labels (5 × 13 grid, 38 × 21.2 mm)', widthMm: 38, heightMm: 21.2, isThermal: false, cols: 5, rows: 13, labelsPerPage: 65 },
  { id: 'sheet-a4', name: '📄 A4 Sheet — Flexible Grid (62 × 38 mm)', widthMm: 62, heightMm: 38, isThermal: false, cols: 3, rows: 7, labelsPerPage: 21 },
  // Thermal Barcode Printers (TSC, Zebra, TVS, Xprinter roll)
  { id: 'thermal-50-25', name: '🖨️ Thermal Roll — 50 × 25 mm (Standard Roll)', widthMm: 50, heightMm: 25, isThermal: true },
  { id: 'small-40-20', name: '🖨️ Thermal Roll — 40 × 20 mm (Small Roll)', widthMm: 40, heightMm: 20, isThermal: true },
  { id: 'standard-50-30', name: '🖨️ Thermal Roll — 50 × 30 mm (Medium Roll)', widthMm: 50, heightMm: 30, isThermal: true },
  { id: 'large-60-40', name: '🖨️ Thermal Roll — 60 × 40 mm (Large Roll)', widthMm: 60, heightMm: 40, isThermal: true },
];

export interface PrintableItem {
  id: string;
  itemId: string;
  variantId?: string;
  name: string;
  parentName: string;
  size?: string | null;
  sku?: string | null;
  barcode: string;
  priceMinor: number;
  category?: string | null;
  stockUnits?: number;
}

export interface BulkBarcodeModalProps {
  isOpen: boolean;
  onClose: () => void;
  items: Item[];
  shopName?: string;
  shopLogoUrl?: string | null;
  role?: string;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

const formatPrice = (paise?: number | null) => {
  if (paise == null) return '';
  return '₹' + (paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

export function BulkBarcodeModal({ isOpen, onClose, items, shopName, shopLogoUrl, role }: BulkBarcodeModalProps) {
  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('ALL');

  // Selection & custom quantity map: { [itemId]: quantity }
  const [selectedMap, setSelectedMap] = useState<Record<string, number>>({});

  // Label configuration: default to A4 Sheet (30 labels/page) so print matches preview grid
  const [selectedSizeId, setSelectedSizeId] = useState<string>('sheet-a4-30');
  const [showShopLogo, setShowShopLogo] = useState<boolean>(true);
  const [showProductName, setShowProductName] = useState<boolean>(true);
  const [showPrice, setShowPrice] = useState<boolean>(true);
  const [showShopName, setShowShopName] = useState<boolean>(false);
  const [showBarcodeNumber, setShowBarcodeNumber] = useState<boolean>(true);
  const [showSku, setShowSku] = useState<boolean>(true);

  // Active view tab: 'select' | 'preview'
  const [activeTab, setActiveTab] = useState<'select' | 'preview'>('select');
  // Sub-panel for tablet / mobile view (<= 860px)
  const [mobileSubTab, setMobileSubTab] = useState<'catalog' | 'selected'>('catalog');
  const [validationError, setValidationError] = useState<string | null>(null);

  const modalRef = useRef<HTMLDivElement>(null);

  // Detect active role / theme: 'admin' (deep plum) vs 'manager' (deep burgundy)
  const isManager = useMemo(() => {
    if (role === 'manager' || role === 'store_manager') return true;
    if (typeof document !== 'undefined') {
      if (document.body.classList.contains('theme-manager')) return true;
      if (document.querySelector('.theme-manager')) return true;
    }
    try {
      const stored = localStorage.getItem('auth_user') || localStorage.getItem('user');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.role === 'manager' || parsed.role === 'store_manager') return true;
      }
    } catch {}
    return false;
  }, [role]);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Reset search and tab when reopened
  useEffect(() => {
    if (isOpen) {
      setValidationError(null);
    }
  }, [isOpen]);

  // Transform products into individual printable units (expanding variant items into their individual size variants)
  const allPrintableItems = useMemo<PrintableItem[]>(() => {
    const list: PrintableItem[] = [];
    for (const it of items) {
      if (it.variants && it.variants.length > 0) {
        for (const v of it.variants) {
          const barcode = (v.barcode || '').trim() || (it.barcode || '').trim();
          const sizeStr = v.size ? ` (${v.size})` : '';
          list.push({
            id: v.id ? `var_${v.id}` : `${it.id}_${v.size || 'default'}`,
            itemId: it.id,
            variantId: v.id,
            name: `${it.name}${sizeStr}`,
            parentName: it.name,
            size: v.size || null,
            sku: v.sku || it.sku || null,
            barcode: barcode,
            priceMinor: v.priceMinor != null ? v.priceMinor : it.priceMinor,
            category: it.category,
            stockUnits: v.stockMilli != null ? v.stockMilli / 1000 : undefined,
          });
        }
      } else {
        list.push({
          id: it.id,
          itemId: it.id,
          name: it.name,
          parentName: it.name,
          size: it.size || null,
          sku: it.sku || null,
          barcode: (it.barcode || '').trim(),
          priceMinor: it.priceMinor,
          category: it.category,
          stockUnits: it.currentStockMilli != null ? it.currentStockMilli / 1000 : undefined,
        });
      }
    }
    return list;
  }, [items]);

  // Unique categories for filtering
  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const it of allPrintableItems) {
      if (it.category) set.add(it.category);
    }
    return Array.from(set).sort();
  }, [allPrintableItems]);

  // Filtered available items for the picker list
  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return allPrintableItems.filter((it) => {
      const matchesQ =
        !q ||
        it.name.toLowerCase().includes(q) ||
        it.parentName.toLowerCase().includes(q) ||
        (it.sku && it.sku.toLowerCase().includes(q)) ||
        (it.barcode && it.barcode.toLowerCase().includes(q)) ||
        (it.category && it.category.toLowerCase().includes(q)) ||
        (it.size && it.size.toLowerCase().includes(q));
      const matchesCat = categoryFilter === 'ALL' || it.category === categoryFilter;
      return matchesQ && matchesCat;
    });
  }, [allPrintableItems, searchQuery, categoryFilter]);

  // Lookup map for fast access
  const itemsById = useMemo(() => {
    const map = new Map<string, PrintableItem>();
    for (const it of allPrintableItems) map.set(it.id, it);
    return map;
  }, [allPrintableItems]);

  // Selected products list with their quantities
  const selectedEntries = useMemo(() => {
    const entries: Array<{ item: PrintableItem; quantity: number }> = [];
    for (const [id, qty] of Object.entries(selectedMap)) {
      const it = itemsById.get(id);
      if (it && qty > 0) {
        entries.push({ item: it, quantity: qty });
      }
    }
    return entries;
  }, [selectedMap, itemsById]);

  // Total label count across all selected products
  const totalLabels = useMemo(() => {
    return selectedEntries.reduce((sum, entry) => sum + entry.quantity, 0);
  }, [selectedEntries]);

  // Flattened array of labels for preview & print
  const flatLabels = useMemo(() => {
    const list: PrintableItem[] = [];
    for (const entry of selectedEntries) {
      for (let i = 0; i < entry.quantity; i++) {
        list.push(entry.item);
      }
    }
    return list;
  }, [selectedEntries]);

  if (!isOpen) return null;

  const currentSize = BULK_LABEL_SIZES.find((s) => s.id === selectedSizeId) || BULK_LABEL_SIZES[0];

  // Handlers
  const handleToggleItem = (item: PrintableItem) => {
    setValidationError(null);
    const barcodeTrim = (item.barcode || '').trim();
    if (!barcodeTrim) {
      setValidationError(`"${item.name}" has no barcode assigned. It cannot be printed until a barcode is added.`);
      return;
    }

    setSelectedMap((prev) => {
      const next = { ...prev };
      if (next[item.id]) {
        delete next[item.id];
      } else {
        next[item.id] = 1; // Default 1 copy upon initial selection
      }
      return next;
    });
  };

  const handleSetQuantity = (itemId: string, rawVal: number | string) => {
    setValidationError(null);
    const val = typeof rawVal === 'string' ? parseInt(rawVal, 10) : rawVal;
    if (isNaN(val)) return;
    const clamped = Math.max(1, Math.min(val, 500));
    setSelectedMap((prev) => ({
      ...prev,
      [itemId]: clamped,
    }));
  };

  const handleAdjustQuantity = (itemId: string, delta: number) => {
    setValidationError(null);
    setSelectedMap((prev) => {
      const current = prev[itemId] || 1;
      const next = Math.max(1, Math.min(current + delta, 500));
      return { ...prev, [itemId]: next };
    });
  };

  const handleRemoveItem = (itemId: string) => {
    setValidationError(null);
    setSelectedMap((prev) => {
      const next = { ...prev };
      delete next[itemId];
      return next;
    });
  };

  const handleSelectAllFiltered = () => {
    setValidationError(null);
    const validInFilter = filteredItems.filter((it) => it.barcode && it.barcode.trim());
    if (validInFilter.length === 0) {
      setValidationError('None of the products in the current filter have barcodes assigned.');
      return;
    }
    setSelectedMap((prev) => {
      const next = { ...prev };
      for (const it of validInFilter) {
        if (!next[it.id]) next[it.id] = 1;
      }
      return next;
    });
  };

  const handleClearSelection = () => {
    setSelectedMap({});
    setValidationError(null);
  };

  const handleSetAllQuantities = (qty: number) => {
    setValidationError(null);
    setSelectedMap((prev) => {
      const next: Record<string, number> = {};
      for (const id of Object.keys(prev)) {
        next[id] = Math.max(1, Math.min(qty, 500));
      }
      return next;
    });
  };

  const handlePrint = () => {
    setValidationError(null);
    if (selectedEntries.length === 0) {
      setValidationError('Please select at least one product with a valid barcode to print.');
      return;
    }
    if (totalLabels <= 0) {
      setValidationError('Total label quantity must be at least 1.');
      return;
    }

    // Verify all selected products have barcodes
    for (const entry of selectedEntries) {
      const b = (entry.item.barcode || '').trim();
      if (!b) {
        setValidationError(`Cannot print: Product "${entry.item.name}" is missing a barcode.`);
        return;
      }
      if (entry.quantity <= 0) {
        setValidationError(`Invalid quantity for "${entry.item.name}". Please enter 1 or more.`);
        return;
      }
    }

    const isThermal = currentSize.isThermal;
    const widthMm = currentSize.widthMm;
    const heightMm = currentSize.heightMm;

    // Build print HTML
    let bodyContent = '';
    if (isThermal) {
      // Thermal roll continuous pages
      bodyContent = flatLabels
        .map((item) => {
          const barcodeTrim = item.barcode!.trim();
          const svgMarkup = renderBarcodeSvg(barcodeTrim, false);
          return `
            <div class="print-label-page">
              ${showShopLogo && shopLogoUrl ? `<img src="${escapeHtml(shopLogoUrl)}" class="label-logo" alt="Logo" />` : ''}
              ${showShopName && shopName ? `<div class="label-shop">${escapeHtml(shopName)}</div>` : ''}
              ${showProductName ? `<div class="label-name">${escapeHtml(item.name)}</div>` : ''}
              ${showSku && item.sku ? `<div class="label-sku">SKU: ${escapeHtml(item.sku)}</div>` : ''}
              <div class="label-barcode-svg">${svgMarkup}</div>
              ${showBarcodeNumber ? `<div class="label-barcode-num">${escapeHtml(barcodeTrim)}</div>` : ''}
              ${showPrice && item.priceMinor != null ? `<div class="label-price">${formatPrice(item.priceMinor)}</div>` : ''}
            </div>
          `;
        })
        .join('');
    } else {
      // A4 Sheet layout partitioned by page using Table to prevent Chromium grid page-break bugs
      const cols = currentSize.cols || 3;
      const rows = currentSize.rows || 10;
      const labelsPerPage = currentSize.labelsPerPage || cols * rows || 30;
      const pageChunks: PrintableItem[][] = [];
      for (let i = 0; i < flatLabels.length; i += labelsPerPage) {
        pageChunks.push(flatLabels.slice(i, i + labelsPerPage));
      }

      bodyContent = pageChunks
        .map((pageItems) => {
          const tableRows: string[] = [];
          for (let r = 0; r < pageItems.length; r += cols) {
            const rowItems = pageItems.slice(r, r + cols);
            const cells: string[] = [];
            for (let c = 0; c < cols; c++) {
              if (c < rowItems.length) {
                const item = rowItems[c];
                const barcodeTrim = item.barcode!.trim();
                const svgMarkup = renderBarcodeSvg(barcodeTrim, false);
                cells.push(`
                  <td class="sheet-cell">
                    <div class="label-card">
                      ${showShopLogo && shopLogoUrl ? `<img src="${escapeHtml(shopLogoUrl)}" class="label-logo" alt="Logo" />` : ''}
                      ${showShopName && shopName ? `<div class="label-shop">${escapeHtml(shopName)}</div>` : ''}
                      ${showProductName ? `<div class="label-name">${escapeHtml(item.name)}</div>` : ''}
                      ${showSku && item.sku ? `<div class="label-sku">SKU: ${escapeHtml(item.sku)}</div>` : ''}
                      <div class="label-barcode-svg">${svgMarkup}</div>
                      ${showBarcodeNumber ? `<div class="label-barcode-num">${escapeHtml(barcodeTrim)}</div>` : ''}
                      ${showPrice && item.priceMinor != null ? `<div class="label-price">${formatPrice(item.priceMinor)}</div>` : ''}
                    </div>
                  </td>
                `);
              } else {
                cells.push(`<td class="sheet-cell sheet-cell-empty"></td>`);
              }
            }
            tableRows.push(`<tr class="sheet-row">${cells.join('')}</tr>`);
          }

          return `
            <div class="sheet-page">
              <table class="sheet-table">
                <tbody>
                  ${tableRows.join('')}
                </tbody>
              </table>
            </div>
          `;
        })
        .join('');
    }

    const rows = currentSize.rows || 10;
    const cols = currentSize.cols || 3;
    const sheetCardHeightMm = rows >= 13 ? 18.5 : rows >= 10 ? 25.0 : 32.5;
    const svgMaxHeightMm = rows >= 13 ? 6.5 : rows >= 10 ? 9.0 : 11.0;
    const nameFontSizePt = rows >= 13 ? 5.8 : rows >= 10 ? 6.8 : 7.5;
    const priceFontSizePt = rows >= 13 ? 6.2 : rows >= 10 ? 7.2 : 8.2;

    let iframe = document.getElementById('bulk-barcode-print-iframe') as HTMLIFrameElement | null;
    if (!iframe) {
      iframe = document.createElement('iframe');
      iframe.id = 'bulk-barcode-print-iframe';
      iframe.style.position = 'fixed';
      iframe.style.right = '0';
      iframe.style.bottom = '0';
      iframe.style.width = '0';
      iframe.style.height = '0';
      iframe.style.border = '0';
      iframe.style.visibility = 'hidden';
      document.body.appendChild(iframe);
    }

    const doc = iframe.contentWindow?.document;
    if (!doc) {
      alert('Unable to open print frame. Please check browser print permissions.');
      return;
    }

    doc.open();
    doc.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Bulk Print Barcode Labels (${totalLabels} labels)</title>
          <style>
            @page {
              size: ${isThermal ? `${widthMm}mm ${heightMm}mm portrait` : 'A4 portrait'};
              margin: ${isThermal ? '0' : '3.5mm 3mm'};
            }
            * {
              box-sizing: border-box;
              margin: 0;
              padding: 0;
            }
            html, body {
              width: 100%;
              background: #ffffff !important;
              color: #000000 !important;
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }
            ${
              isThermal
                ? `
            .print-label-page {
              width: ${widthMm}mm;
              height: ${heightMm}mm;
              page-break-after: always;
              break-after: page;
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              text-align: center;
              padding: 1.5mm 2mm;
              overflow: hidden;
              background: #ffffff !important;
            }
            .print-label-page:last-child {
              page-break-after: auto;
              break-after: auto;
            }
            `
                : `
            .sheet-page {
              width: 100%;
              box-sizing: border-box;
              page-break-after: always;
              break-after: page;
            }
            .sheet-page:last-child {
              page-break-after: auto;
              break-after: auto;
            }
            .sheet-table {
              width: 100%;
              border-collapse: separate;
              border-spacing: 1.5mm 0.8mm;
              table-layout: fixed;
            }
            .sheet-row {
              page-break-inside: avoid;
              break-inside: avoid;
            }
            .sheet-cell {
              width: ${100 / cols}%;
              padding: 0;
              vertical-align: top;
            }
            .sheet-cell-empty {
              visibility: hidden;
            }
            .label-card {
              box-sizing: border-box;
              width: 100%;
              height: ${sheetCardHeightMm}mm;
              max-height: ${sheetCardHeightMm}mm;
              border: 1px dashed #cbd5e1;
              border-radius: 3px;
              padding: 0.6mm 1mm;
              text-align: center;
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              overflow: hidden;
              background: #ffffff !important;
            }
            `
            }
            .label-logo {
              max-height: ${isThermal ? Math.max(3.5, Math.round(heightMm * 0.16)) : Math.min(4.5, Math.max(2.8, Math.round(sheetCardHeightMm * 0.18)))}mm;
              max-width: ${Math.round(widthMm * 0.45)}mm;
              object-fit: contain;
              margin-bottom: 0.3mm;
              display: block;
              margin-left: auto;
              margin-right: auto;
            }
            .label-shop {
              font-size: 5.5pt;
              font-weight: 700;
              text-transform: uppercase;
              letter-spacing: 0.4px;
              color: #475569;
              margin-bottom: 0.3mm;
              line-height: 1;
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
              max-width: 95%;
            }
            .label-name {
              font-size: ${nameFontSizePt}pt;
              font-weight: 700;
              color: #000000;
              line-height: 1.1;
              max-height: 3.8mm;
              overflow: hidden;
              text-overflow: ellipsis;
              margin-bottom: 0.3mm;
              max-width: 95%;
            }
            .label-sku {
              font-family: monospace;
              font-size: 5pt;
              font-weight: 600;
              color: #334155;
              margin-bottom: 0.3mm;
              line-height: 1;
            }
            .label-barcode-svg {
              width: 90%;
              display: flex;
              justify-content: center;
              align-items: center;
              margin: 0.3mm 0;
            }
            .label-barcode-svg svg {
              width: 100%;
              height: ${svgMaxHeightMm}mm;
              max-height: ${svgMaxHeightMm}mm;
              display: block;
            }
            .label-barcode-num {
              font-family: monospace;
              font-size: 5.8pt;
              font-weight: 700;
              letter-spacing: 0.4px;
              color: #000000;
              margin-top: 0.3mm;
              line-height: 1;
            }
            .label-price {
              font-size: ${priceFontSizePt}pt;
              font-weight: 800;
              color: #000000;
              margin-top: 0.3mm;
              line-height: 1;
            }
          </style>
        </head>
        <body>
          ${bodyContent}
        </body>
      </html>
    `);
    doc.close();

    setTimeout(() => {
      try {
        iframe?.contentWindow?.focus();
        iframe?.contentWindow?.print();
      } catch (err) {
        console.error('Print iframe trigger failed, falling back:', err);
        window.print();
      }
    }, 250);
  };

  return (
    <div
      className="bulk-barcode-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={modalRef}
        className={`bulk-barcode-dialog ${isManager ? 'theme-manager' : 'theme-admin'}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="bulk-barcode-modal-title"
      >
        {/* MODAL HEADER */}
        <div className="bulk-barcode-header">
          <div className="bulk-barcode-header-left">
            <div className="bulk-barcode-icon-badge">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 5v14" />
                <path d="M8 5v14" />
                <path d="M12 5v14" />
                <path d="M17 5v14" />
                <path d="M21 5v14" />
              </svg>
            </div>
            <div>
              <div className="bulk-barcode-title-row">
                <h3 id="bulk-barcode-modal-title" className="bulk-barcode-title">
                  Bulk Barcode Label Printing
                </h3>
                {totalLabels > 0 && (
                  <span className="bulk-barcode-counter-badge">
                    {totalLabels} {totalLabels === 1 ? 'label' : 'labels'} ({selectedEntries.length} {selectedEntries.length === 1 ? 'product' : 'products'})
                  </span>
                )}
              </div>
              <div className="bulk-barcode-subtitle">
                Select multiple products, set custom label quantities for each, preview, and print together
              </div>
            </div>
          </div>

          <div className="bulk-barcode-header-right">
            {/* TAB SELECTOR */}
            <div className="bulk-barcode-tabs">
              <button
                type="button"
                className={`bulk-barcode-tab-btn ${activeTab === 'select' ? 'active' : ''}`}
                onClick={() => setActiveTab('select')}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 11l3 3L22 4" />
                  <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                </svg>
                <span>Select &amp; Quantities ({selectedEntries.length})</span>
              </button>
              <button
                type="button"
                className={`bulk-barcode-tab-btn ${activeTab === 'preview' ? 'active' : ''}`}
                onClick={() => {
                  if (selectedEntries.length === 0) {
                    setValidationError('Select at least one product first to preview labels.');
                    return;
                  }
                  setActiveTab('preview');
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
                <span>Preview ({totalLabels})</span>
              </button>
            </div>

            <button
              type="button"
              className="bulk-barcode-close-btn"
              onClick={onClose}
              title="Close modal (Esc)"
              aria-label="Close"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* VALIDATION ALERT */}
        {validationError && (
          <div className="bulk-barcode-alert">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              <span>{validationError}</span>
            </div>
            <button
              type="button"
              className="bulk-barcode-alert-close"
              onClick={() => setValidationError(null)}
              aria-label="Dismiss alert"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        )}

        {/* LABEL CONFIGURATION BAR */}
        <div className="bulk-barcode-config">
          <div className="bulk-barcode-config-row">
            <div className="bulk-barcode-format-picker">
              <span className="bulk-barcode-format-label">Label Format:</span>
              <select
                className="bulk-barcode-select"
                value={selectedSizeId}
                onChange={(e) => setSelectedSizeId(e.target.value)}
              >
                <optgroup label="📄 A4 Sticker Sheets (Standard Printers / PDF)">
                  {BULK_LABEL_SIZES.filter((s) => !s.isThermal).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="🖨️ Thermal Roll Printers (TSC, Zebra, TVS, Xprinter)">
                  {BULK_LABEL_SIZES.filter((s) => s.isThermal).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </optgroup>
              </select>
            </div>

            <div className="bulk-barcode-checkbox-group">
              <label className="bulk-barcode-checkbox-label">
                <input type="checkbox" checked={showProductName} onChange={(e) => setShowProductName(e.target.checked)} />
                <span>Name</span>
              </label>
              <label className="bulk-barcode-checkbox-label">
                <input type="checkbox" checked={showSku} onChange={(e) => setShowSku(e.target.checked)} />
                <span>SKU</span>
              </label>
              <label className="bulk-barcode-checkbox-label">
                <input type="checkbox" checked={showBarcodeNumber} onChange={(e) => setShowBarcodeNumber(e.target.checked)} />
                <span>Barcode Digits</span>
              </label>
              <label className="bulk-barcode-checkbox-label">
                <input type="checkbox" checked={showPrice} onChange={(e) => setShowPrice(e.target.checked)} />
                <span>Price</span>
              </label>
              {shopLogoUrl && (
                <label className="bulk-barcode-checkbox-label">
                  <input type="checkbox" checked={showShopLogo} onChange={(e) => setShowShopLogo(e.target.checked)} />
                  <span>Store Logo</span>
                </label>
              )}
              <label className="bulk-barcode-checkbox-label">
                <input type="checkbox" checked={showShopName} onChange={(e) => setShowShopName(e.target.checked)} />
                <span>Store Name</span>
              </label>
            </div>
          </div>

          {/* PRINTER GUIDANCE TIP */}
          {currentSize.isThermal ? (
            <div className="bulk-barcode-guidance thermal">
              <span>
                🖨️ <strong>Thermal Roll Mode:</strong> Set print dialog layout to <strong>Portrait</strong>, Margins to <strong>None</strong>, and uncheck <strong>Headers & Footers</strong>. (Printing on regular paper/PDF? Switch to A4 Sheet).
              </span>
              <button
                type="button"
                className="bulk-barcode-guidance-btn"
                onClick={() => setSelectedSizeId('sheet-a4-30')}
              >
                Use A4 Sheet (30 labels/page)
              </button>
            </div>
          ) : (
            <div className="bulk-barcode-guidance sheet">
              <span>
                📄 <strong>A4 Sheet Sticker Mode:</strong> Labels are tiled in a multi-label grid across A4 sheets (~{currentSize.labelsPerPage || 24} labels per page). Ideal for regular printers, sticker paper, or PDF.
              </span>
              <button
                type="button"
                className="bulk-barcode-guidance-btn"
                onClick={() => setSelectedSizeId('thermal-50-25')}
              >
                Use Thermal Roll (50×25mm)
              </button>
            </div>
          )}
        </div>

        {/* TAB 1: PRODUCT SELECTION & QUANTITIES */}
        {activeTab === 'select' && (
          <div className="bulk-barcode-body">
            {/* Mobile & Tablet Segmented Navigation Switcher (<= 860px) */}
            <div className="bulk-barcode-mobile-nav">
              <button
                type="button"
                className={`bulk-barcode-mobile-nav-btn ${mobileSubTab === 'catalog' ? 'active' : ''}`}
                onClick={() => setMobileSubTab('catalog')}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                </svg>
                <span>Available Products ({filteredItems.length})</span>
              </button>
              <button
                type="button"
                className={`bulk-barcode-mobile-nav-btn ${mobileSubTab === 'selected' ? 'active' : ''}`}
                onClick={() => setMobileSubTab('selected')}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
                  <line x1="7" y1="7" x2="7.01" y2="7" />
                </svg>
                <span>Selected ({selectedEntries.length})</span>
                {totalLabels > 0 && <span style={{ fontWeight: 800 }}>• {totalLabels} pcs</span>}
              </button>
            </div>

            <div className="bulk-barcode-columns">
              {/* LEFT PANEL: PRODUCT SEARCH & AVAILABLE ITEMS */}
              <div className={`bulk-barcode-panel bulk-barcode-panel-left ${mobileSubTab !== 'catalog' ? 'mobile-hidden' : ''}`}>
                {/* Search Toolbar */}
                <div className="bulk-barcode-panel-toolbar">
                  <div className="bulk-barcode-search-row">
                    <input
                      type="text"
                      className="bulk-barcode-search-input"
                      placeholder="Search products by name, SKU, barcode..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                    />
                    <select
                      className="bulk-barcode-cat-select"
                      value={categoryFilter}
                      onChange={(e) => setCategoryFilter(e.target.value)}
                    >
                      <option value="ALL">All Categories</option>
                      {categories.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="bulk-barcode-filter-status">
                    <span>
                      Showing {filteredItems.length} products ({filteredItems.filter((it) => it.barcode && it.barcode.trim()).length} with barcode)
                    </span>
                    <button
                      type="button"
                      className="bulk-barcode-link-btn"
                      onClick={handleSelectAllFiltered}
                    >
                      + Select All Valid
                    </button>
                  </div>
                </div>

                {/* Items List */}
                <div className="bulk-barcode-scroll-list">
                  {filteredItems.length === 0 ? (
                    <div className="bulk-barcode-empty-state">
                      <div className="bulk-barcode-empty-icon">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="11" cy="11" r="8" />
                          <line x1="21" y1="21" x2="16.65" y2="16.65" />
                        </svg>
                      </div>
                      <div className="bulk-barcode-empty-title">No products match your search</div>
                      <div className="bulk-barcode-empty-desc">Try searching with a different name or SKU</div>
                    </div>
                  ) : (
                    filteredItems.map((item) => {
                      const isSelected = Boolean(selectedMap[item.id]);
                      const hasBarcode = Boolean(item.barcode && item.barcode.trim());
                      return (
                        <div
                          key={item.id}
                          className={`bulk-barcode-item-card ${isSelected ? 'selected' : ''} ${!hasBarcode ? 'disabled' : ''}`}
                          onClick={() => {
                            if (hasBarcode) handleToggleItem(item);
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            disabled={!hasBarcode}
                            onChange={() => handleToggleItem(item)}
                            onClick={(e) => e.stopPropagation()}
                          />

                          <div className="bulk-barcode-item-info">
                            <div className="bulk-barcode-item-top">
                              <span className="bulk-barcode-item-name">
                                {item.name}
                              </span>
                              {item.priceMinor != null && (
                                <span className="bulk-barcode-item-price">
                                  {formatPrice(item.priceMinor)}
                                </span>
                              )}
                            </div>

                            <div className="bulk-barcode-item-meta">
                              {item.size && (
                                <span style={{ background: '#f3e8ff', color: '#6b21a8', padding: '1px 6px', borderRadius: '4px', fontWeight: 700, fontSize: '0.72rem' }}>
                                  Size: {item.size}
                                </span>
                              )}
                              {item.sku && <span>SKU: <strong style={{ color: 'var(--bb-text-main)' }}>{item.sku}</strong></span>}
                              {item.category && <span>• {item.category}</span>}
                            </div>

                            <div className="bulk-barcode-item-barcode">
                              {hasBarcode ? (
                                <span className="bulk-barcode-barcode-code">
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M3 5v14" />
                                    <path d="M8 5v14" />
                                    <path d="M12 5v14" />
                                    <path d="M17 5v14" />
                                    <path d="M21 5v14" />
                                  </svg>
                                  <span>{item.barcode}</span>
                                </span>
                              ) : (
                                <span style={{ color: '#dc2626', fontWeight: 600, background: '#fef2f2', padding: '1px 6px', borderRadius: '4px', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                                    <line x1="12" y1="9" x2="12" y2="13" />
                                    <line x1="12" y1="17" x2="12.01" y2="17" />
                                  </svg>
                                  <span>No barcode assigned (cannot print)</span>
                                </span>
                              )}
                            </div>
                          </div>

                          {isSelected && (
                            <div className="bulk-barcode-qty-pill">
                              ×{selectedMap[item.id] || 1}
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* RIGHT PANEL: SELECTED PRODUCTS & INDEPENDENT QUANTITIES */}
              <div className={`bulk-barcode-panel bulk-barcode-panel-right ${mobileSubTab !== 'selected' ? 'mobile-hidden' : ''}`}>
                {/* Selected List Header */}
                <div className="bulk-barcode-selected-header">
                  <div>
                    <div style={{ fontWeight: 800, fontSize: '0.88rem', color: 'var(--bb-text-main)' }}>
                      Selected Products for Printing
                    </div>
                    <div style={{ fontSize: '0.74rem', color: 'var(--bb-text-muted)', marginTop: '1px' }}>
                      Set label quantities for each selected item
                    </div>
                  </div>

                  {selectedEntries.length > 0 && (
                    <div className="bulk-barcode-quick-btns">
                      <button
                        type="button"
                        className="bulk-barcode-quick-btn"
                        onClick={() => handleSetAllQuantities(1)}
                        title="Set all selected to 1 label each"
                      >
                        All = 1
                      </button>
                      <button
                        type="button"
                        className="bulk-barcode-quick-btn"
                        onClick={() => handleSetAllQuantities(5)}
                        title="Set all selected to 5 labels each"
                      >
                        All = 5
                      </button>
                      <button
                        type="button"
                        className="bulk-barcode-quick-btn"
                        onClick={() => handleSetAllQuantities(10)}
                        title="Set all selected to 10 labels each"
                      >
                        All = 10
                      </button>
                      <button
                        type="button"
                        className="bulk-barcode-clear-btn"
                        onClick={handleClearSelection}
                        title="Remove all selected products"
                      >
                        Clear
                      </button>
                    </div>
                  )}
                </div>

                {/* Selected List Items */}
                <div className="bulk-barcode-scroll-list">
                  {selectedEntries.length === 0 ? (
                    <div className="bulk-barcode-empty-state">
                      <div className="bulk-barcode-empty-icon">
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="15 18 9 12 15 6" />
                        </svg>
                      </div>
                      <div className="bulk-barcode-empty-title">
                        No products selected yet
                      </div>
                      <div className="bulk-barcode-empty-desc">
                        Select items from the product list to configure label quantities here.
                      </div>
                      {filteredItems.length > 0 && (
                        <button
                          type="button"
                          className="bulk-barcode-btn bulk-barcode-btn-secondary"
                          style={{ marginTop: '0.85rem', fontSize: '0.78rem', minHeight: '32px', padding: '0.35rem 0.75rem' }}
                          onClick={() => {
                            setMobileSubTab('catalog');
                            handleSelectAllFiltered();
                          }}
                        >
                          + Select All Printable Products
                        </button>
                      )}
                    </div>
                  ) : (
                    <div>
                      {selectedEntries.map(({ item, quantity }, idx) => (
                        <div
                          key={item.id}
                          className="bulk-barcode-selected-card"
                        >
                          <span className="bulk-barcode-selected-index">
                            #{idx + 1}
                          </span>

                          <div className="bulk-barcode-item-info">
                            <div className="bulk-barcode-item-top">
                              <span className="bulk-barcode-item-name">
                                {item.name}
                              </span>
                              {item.priceMinor != null && (
                                <span className="bulk-barcode-item-price">
                                  {formatPrice(item.priceMinor)}
                                </span>
                              )}
                            </div>
                            <div className="bulk-barcode-item-meta">
                              {item.size && (
                                <span style={{ background: '#f3e8ff', color: '#6b21a8', padding: '1px 6px', borderRadius: '4px', fontWeight: 700, fontSize: '0.72rem' }}>
                                  Size: {item.size}
                                </span>
                              )}
                              {item.sku && <span>SKU: <strong style={{ color: 'var(--bb-text-main)' }}>{item.sku}</strong></span>}
                              <span className="bulk-barcode-barcode-code">
                                {item.barcode}
                              </span>
                            </div>
                          </div>

                          {/* QUANTITY CONTROL */}
                          <div className="bulk-barcode-qty-control">
                            <button
                              type="button"
                              className="bulk-barcode-qty-btn"
                              onClick={() => handleAdjustQuantity(item.id, -1)}
                              disabled={quantity <= 1}
                              title="Decrease quantity by 1"
                              aria-label="Decrease quantity"
                            >
                              −
                            </button>

                            <input
                              type="number"
                              min="1"
                              max="500"
                              value={quantity}
                              onChange={(e) => handleSetQuantity(item.id, e.target.value)}
                              className="bulk-barcode-qty-input"
                              title="Label quantity for this product"
                              aria-label="Quantity"
                            />

                            <button
                              type="button"
                              className="bulk-barcode-qty-btn"
                              onClick={() => handleAdjustQuantity(item.id, 1)}
                              disabled={quantity >= 500}
                              title="Increase quantity by 1"
                              aria-label="Increase quantity"
                            >
                              +
                            </button>

                            <button
                              type="button"
                              className="bulk-barcode-remove-btn"
                              onClick={() => handleRemoveItem(item.id)}
                              title="Remove from print list"
                              aria-label="Remove item"
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="18" y1="6" x2="6" y2="18" />
                                <line x1="6" y1="6" x2="18" y2="18" />
                              </svg>
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: LIVE PREVIEW */}
        {activeTab === 'preview' && (
          <div className="bulk-barcode-preview-container">
            <div className="bulk-barcode-preview-card">
              <div className="bulk-barcode-preview-header">
                <div>
                  <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 800, color: 'var(--bb-text-main)' }}>
                    Label Print Preview ({totalLabels} total labels)
                  </h4>
                  <div style={{ fontSize: '0.78rem', color: 'var(--bb-text-muted)', marginTop: '2px' }}>
                    Target size: {currentSize.name}
                  </div>
                </div>

                <button
                  type="button"
                  className="bulk-barcode-btn bulk-barcode-btn-secondary"
                  onClick={() => setActiveTab('select')}
                  style={{ minHeight: '34px', padding: '0.35rem 0.75rem', fontSize: '0.8rem' }}
                >
                  ← Edit Quantities
                </button>
              </div>

              {/* Thermal vs Sheet Print Mode Banner */}
              {currentSize.isThermal ? (
                <div className="bulk-barcode-guidance thermal" style={{ padding: '0.65rem 0.9rem', marginBottom: '1rem', borderRadius: '8px' }}>
                  <div style={{ flex: 1, minWidth: '240px' }}>
                    <div style={{ fontWeight: 800, color: '#92400E', fontSize: '0.85rem' }}>
                      🖨️ Thermal Roll Mode Selected (1 sticker per page • {totalLabels} pages in print preview)
                    </div>
                    <div style={{ fontSize: '0.76rem', color: '#B45309', marginTop: '2px', lineHeight: 1.4 }}>
                      Thermal printers print labels one-by-one on continuous sticker rolls. If you are printing on regular A4 paper / PDF and want all {totalLabels} labels on a single sheet:
                    </div>
                  </div>
                  <button
                    type="button"
                    className="bulk-barcode-guidance-btn"
                    onClick={() => setSelectedSizeId('sheet-a4-30')}
                  >
                    📄 Switch to A4 Sheet (30 labels/page)
                  </button>
                </div>
              ) : (
                <div className="bulk-barcode-guidance sheet" style={{ padding: '0.65rem 0.9rem', marginBottom: '1rem', borderRadius: '8px' }}>
                  <div style={{ flex: 1, minWidth: '240px' }}>
                    <div style={{ fontWeight: 800, color: 'var(--bb-primary)', fontSize: '0.85rem' }}>
                      📄 A4 Sticker Sheet Grid Mode ({currentSize.cols || 3} cols × {currentSize.rows || 10} rows • {currentSize.labelsPerPage || 30} labels per page)
                    </div>
                    <div style={{ fontSize: '0.76rem', color: 'var(--bb-text-muted)', marginTop: '2px' }}>
                      All {totalLabels} labels will print together across {Math.ceil(totalLabels / (currentSize.labelsPerPage || 30))} A4 sheet(s) in this exact grid layout.
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <span style={{ fontSize: '0.78rem', color: 'var(--bb-text-muted)', fontWeight: 600 }}>Format:</span>
                    <select
                      className="bulk-barcode-select"
                      value={selectedSizeId}
                      onChange={(e) => setSelectedSizeId(e.target.value)}
                    >
                      <optgroup label="📄 A4 Sticker Sheets">
                        {BULK_LABEL_SIZES.filter((s) => !s.isThermal).map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </optgroup>
                      <optgroup label="🖨️ Thermal Roll Printers">
                        {BULK_LABEL_SIZES.filter((s) => s.isThermal).map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </optgroup>
                    </select>
                  </div>
                </div>
              )}

              {/* Labels Grid Preview */}
              <div
                className="bulk-barcode-preview-grid"
                style={{
                  gridTemplateColumns: !currentSize.isThermal
                    ? `repeat(${currentSize.cols || 3}, minmax(180px, 1fr))`
                    : 'repeat(auto-fill, minmax(210px, 1fr))',
                }}
              >
                {flatLabels.map((item, idx) => {
                  const barcodeTrim = item.barcode!.trim();
                  const svg = renderBarcodeSvg(barcodeTrim, false);
                  return (
                    <div
                      key={`${item.id}-${idx}`}
                      className="bulk-barcode-preview-item"
                    >
                      <div
                        style={{
                          position: 'absolute',
                          top: '3px',
                          left: '5px',
                          fontSize: '0.62rem',
                          fontWeight: 700,
                          color: 'var(--bb-text-muted)',
                        }}
                      >
                        #{idx + 1}
                      </div>

                      {showShopLogo && shopLogoUrl && (
                        <img
                          src={shopLogoUrl}
                          alt="Logo"
                          style={{
                            maxHeight: '18px',
                            maxWidth: '65px',
                            objectFit: 'contain',
                            marginBottom: '2px',
                            display: 'block',
                            marginLeft: 'auto',
                            marginRight: 'auto',
                          }}
                        />
                      )}

                      {showShopName && shopName && (
                        <div style={{ fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--bb-text-muted)', marginBottom: '2px', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {shopName}
                        </div>
                      )}

                      {showProductName && (
                        <div style={{ fontSize: '0.75rem', fontWeight: 800, color: 'var(--bb-text-main)', lineHeight: 1.2, maxHeight: '28px', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>
                          {item.name}
                        </div>
                      )}

                      {showSku && item.sku && (
                        <div style={{ fontSize: '0.62rem', fontFamily: 'monospace', color: 'var(--bb-text-muted)', marginTop: '1px' }}>
                          SKU: {item.sku}
                        </div>
                      )}

                      <div
                        style={{
                          width: '100%',
                          maxHeight: '36px',
                          margin: '4px 0 2px 0',
                          display: 'flex',
                          justifyContent: 'center',
                        }}
                        dangerouslySetInnerHTML={{ __html: svg }}
                      />

                      {showBarcodeNumber && (
                        <div style={{ fontFamily: 'monospace', fontSize: '0.7rem', fontWeight: 700, color: '#000000', letterSpacing: '0.5px' }}>
                          {barcodeTrim}
                        </div>
                      )}

                      {showPrice && item.priceMinor != null && (
                        <div style={{ fontSize: '0.82rem', fontWeight: 900, color: '#000000', marginTop: '2px' }}>
                          {formatPrice(item.priceMinor)}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* MODAL FOOTER */}
        <div className="bulk-barcode-footer">
          <div className="bulk-barcode-footer-summary">
            <span>
              <strong>{selectedEntries.length}</strong> {selectedEntries.length === 1 ? 'product' : 'products'} selected • <strong>{totalLabels}</strong> total {totalLabels === 1 ? 'label' : 'labels'}
            </span>
          </div>

          <div className="bulk-barcode-footer-actions">
            <button
              type="button"
              className="bulk-barcode-btn bulk-barcode-btn-secondary"
              onClick={onClose}
            >
              Cancel
            </button>

            {activeTab === 'select' ? (
              <button
                type="button"
                className="bulk-barcode-btn bulk-barcode-btn-secondary"
                disabled={selectedEntries.length === 0}
                onClick={() => setActiveTab('preview')}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
                <span>Preview Labels ({totalLabels})</span>
              </button>
            ) : (
              <button
                type="button"
                className="bulk-barcode-btn bulk-barcode-btn-secondary"
                onClick={() => setActiveTab('select')}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="19" y1="12" x2="5" y2="12" />
                  <polyline points="12 19 5 12 12 5" />
                </svg>
                <span>Back to Selection</span>
              </button>
            )}

            <button
              id="bulk-print-confirm-btn"
              type="button"
              className="bulk-barcode-btn bulk-barcode-btn-primary"
              disabled={selectedEntries.length === 0 || totalLabels <= 0}
              onClick={handlePrint}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 6 2 18 2 18 9" />
                <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
                <rect x="6" y="14" width="12" height="8" />
              </svg>
              <span>Print {totalLabels > 0 ? `${totalLabels} Labels` : 'Labels'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
