import { requirePerm } from '../../auth.ts';
import type { Router } from '../../http.ts';
import {
  handleCapabilities,
  handleExport,
  handleExtract,
  handleGetResults,
  handleHistory,
  handleImport,
  handleMatchProducts,
  handleSaveCorrection,
  handleUpdateItems,
  handleUpload,
  handleValidate,
} from './invoice.controller.ts';

export function registerInvoiceConverter(r: Router): void {
  r.get('/api/invoices/capabilities', requirePerm('items.view'), handleCapabilities);
  r.post('/api/invoices/upload', requirePerm('items.view'), handleUpload);
  r.post('/api/invoices/:id/extract', requirePerm('items.view'), handleExtract);
  r.get('/api/invoices/:id/results', requirePerm('items.view'), handleGetResults);
  r.put('/api/invoices/:id/items', requirePerm('items.view'), handleUpdateItems);
  r.post('/api/invoices/:id/validate', requirePerm('items.view'), handleValidate);
  r.post('/api/invoices/:id/match-products', requirePerm('items.view'), handleMatchProducts);
  r.get('/api/invoices/:id/export', requirePerm('items.view'), handleExport);
  r.post('/api/invoices/:id/import', requirePerm('items.write'), handleImport);

  // History & Supplier Learning
  r.get('/api/supplier-invoices/history', requirePerm('items.view'), handleHistory);
  r.post('/api/supplier-invoices/learn', requirePerm('items.write'), handleSaveCorrection);
}
