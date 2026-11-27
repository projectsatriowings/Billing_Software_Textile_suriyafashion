import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  api,
  setToken,
  reparseSupplierInvoice,
  fetchSupplierInvoiceMappings,
  saveSupplierInvoiceMapping,
  exportSupplierInvoiceExcel,
  getInvoiceCapabilities,
  uploadInvoiceDocument,
  extractInvoiceJob,
  importInvoiceJobToInventory,
  type ExtractedSupplierInvoiceItem,
  type SupplierInvoiceMetadata,
  type SupplierInvoiceMapping,
  type IntelligentInvoiceItem,
  type IntelligentInvoiceSummary,
  type IntelligentReconciliationReport,
  type InvoiceProcessingCapabilities,
  type Party,
  type Item,
} from '../../api';
import { parseImportNumeric } from '../../../../shared/bulkImport.ts';
import { InvoicePreviewPane } from './InvoicePreviewPane';

interface Props {
  suppliers?: Party[];
  existingItems?: Item[];
  onClose: () => void;
  onOpenBulkImport?: (rows?: string[][]) => void;
}

type WizardStep = 'upload' | 'extracting' | 'review' | 'download';

export function SupplierInvoiceConverterModal({
  suppliers = [],
  existingItems = [],
  onClose,
  onOpenBulkImport,
}: Props) {
  const [step, setStep] = useState<WizardStep>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [filePreviewUrl, setFilePreviewUrl] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [extractingProgress, setExtractingProgress] = useState<string>('Reading invoice file...');

  // Extraction results
  const [metadata, setMetadata] = useState<SupplierInvoiceMetadata>({
    supplierName: '',
    supplierGstin: '',
    invoiceNumber: '',
    invoiceDate: '',
    totalAmount: null,
    rawText: '',
  });
  const [products, setProducts] = useState<IntelligentInvoiceItem[]>([]);
  const [jobId, setJobId] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<InvoiceProcessingCapabilities | null>(null);
  const [reconciliation, setReconciliation] = useState<IntelligentReconciliationReport | null>(null);
  const [analysisSummary, setAnalysisSummary] = useState<IntelligentInvoiceSummary | null>(null);
  const [selectedRowIdx, setSelectedRowIdx] = useState<number | null>(null);
  const [showPreviewPane, setShowPreviewPane] = useState<boolean>(true);
  const [pricingMode, setPricingMode] = useState<'markup' | 'margin'>('markup');
  const [pricingPct, setPricingPct] = useState<string>('25');
  const [isImportingDirect, setIsImportingDirect] = useState(false);
  const [directImportSuccess, setDirectImportSuccess] = useState<string | null>(null);
  const [detectedColumns, setDetectedColumns] = useState<string[]>([]);
  const [columnMap, setColumnMap] = useState<Record<string, string | undefined>>({});
  const [dataLinesPreview, setDataLinesPreview] = useState<string[]>([]);
  const [isOcr, setIsOcr] = useState(false);
  const [pageCount, setPageCount] = useState(1);
  const [showMappingDrawer, setShowMappingDrawer] = useState(false);
  const [savedMappings, setSavedMappings] = useState<SupplierInvoiceMapping[]>([]);
  const [mappingSaveSuccess, setMappingSaveSuccess] = useState(false);

  // Download state
  const [downloadBlob, setDownloadBlob] = useState<Blob | null>(null);
  const [downloadFilename, setDownloadFilename] = useState<string>('supplier_product_import.xlsx');
  const [isGeneratingExcel, setIsGeneratingExcel] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [isAuthError, setIsAuthError] = useState(false);
  const [showInlineLogin, setShowInlineLogin] = useState(false);
  const [inlineLoginIdentifier, setInlineLoginIdentifier] = useState('');
  const [inlineLoginPassword, setInlineLoginPassword] = useState('');
  const [inlineLoginLoading, setInlineLoginLoading] = useState(false);
  const [inlineLoginError, setInlineLoginError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load existing supplier mappings & processing capabilities
  useEffect(() => {
    fetchSupplierInvoiceMappings()
      .then((res) => {
        if (res.ok && Array.isArray(res.mappings)) {
          setSavedMappings(res.mappings);
        }
      })
      .catch(() => { });
    getInvoiceCapabilities()
      .then((res) => {
        if (res.ok) setCapabilities(res.capabilities);
      })
      .catch(() => { });
  }, []);

  // Filter supplier parties
  const supplierParties = useMemo(() => {
    return suppliers.filter((s) => s.type === 'supplier');
  }, [suppliers]);

  // Check if selected supplier has a saved mapping
  const activeSavedMapping = useMemo(() => {
    if (selectedSupplierId) {
      return savedMappings.find((m) => m.supplierId === selectedSupplierId);
    }
    if (metadata.supplierGstin) {
      return savedMappings.find((m) => m.supplierGstin?.toLowerCase() === metadata.supplierGstin.toLowerCase());
    }
    if (metadata.supplierName) {
      return savedMappings.find((m) => m.supplierName.toLowerCase() === metadata.supplierName.toLowerCase());
    }
    return null;
  }, [selectedSupplierId, metadata.supplierGstin, metadata.supplierName, savedMappings]);

  // Handle file selection
  const handleFileSelect = (selectedFile: File) => {
    setErrorMsg('');
    const ext = selectedFile.name.toLowerCase();
    if (!ext.endsWith('.pdf') && !ext.endsWith('.jpg') && !ext.endsWith('.jpeg') && !ext.endsWith('.png')) {
      setErrorMsg('Please select a valid invoice file (.PDF, .JPG, .JPEG, or .PNG)');
      return;
    }

    setFile(selectedFile);

    if (selectedFile.type.startsWith('image/') || selectedFile.type.includes('pdf') || ext.endsWith('.pdf')) {
      const url = URL.createObjectURL(selectedFile);
      setFilePreviewUrl(url);
    } else {
      setFilePreviewUrl(null);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelect(e.dataTransfer.files[0]);
    }
  };

  // Convert file to base64 and start intelligent extraction pipeline
  const handleStartExtraction = async () => {
    if (!file) {
      setErrorMsg('Please select an invoice file to upload');
      return;
    }

    setErrorMsg('');
    setDirectImportSuccess(null);
    setStep('extracting');
    setExtractingProgress('Uploading document and validating format...');

    try {
      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const fileData = await base64Promise;
      const mimeType = file.type || (file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg');

      const uploadRes = await uploadInvoiceDocument({
        fileName: file.name,
        fileData,
        mimeType,
        supplierId: selectedSupplierId || undefined,
      });

      setJobId(uploadRes.jobId);
      setCapabilities(uploadRes.capabilities);
      setExtractingProgress(
        uploadRes.capabilities.aiConfigured
          ? 'Preprocessing image, running OCR & Gemini Vision understanding...'
          : 'Preprocessing image, running local OCR & table extraction...'
      );

      const res = await extractInvoiceJob(uploadRes.jobId, {
        supplierId: selectedSupplierId || undefined,
        fileData,
        fileName: file.name,
        mimeType,
      });

      if (!res.ok) {
        throw new Error('Invoice extraction failed');
      }

      setCapabilities(res.capabilities);
      setReconciliation(res.reconciliation);
      setAnalysisSummary(res.summary);
      setMetadata({
        supplierName: res.header.supplierName || '',
        supplierGstin: res.header.supplierGstin || '',
        invoiceNumber: res.header.invoiceNumber || '',
        invoiceDate: res.header.invoiceDate || '',
        totalAmount: res.header.finalInvoiceAmount,
        subtotalAmount: res.header.subtotal,
        cgstAmount: res.header.cgst,
        sgstAmount: res.header.sgst,
        igstAmount: res.header.igst,
        buyerAddress: res.header.billingAddress || undefined,
        rawText: '',
        discrepancyWarning: res.reconciliation.discrepancyMessages.join(' ') || undefined,
      });
      setProducts(res.items);
      setDetectedColumns(res.headers || []);
      setColumnMap(res.columnMap || {});
      setIsOcr(res.ocrProvider !== 'pdf-parse');
      setPageCount(res.summary.totalPagesProcessed || 1);

      const cleanInv = (res.header.invoiceNumber || 'INVOICE').replace(/[^\w-]/g, '_');
      const dateStr = new Date().toISOString().slice(0, 10);
      setDownloadFilename(`Supplier_Invoice_${cleanInv}_${dateStr}.xlsx`);

      // Automatically open Bulk Product Import (Step 2: Review & Fix) with extracted products
      if (onOpenBulkImport && res.items.length > 0) {
        const rows: string[][] = [
          ['Product Name', 'Size', 'Cost', 'Stock'],
          ...res.items.map((p) => [
            p.name || '',
            p.size ?? p.sizeWeightVolume ?? '',
            p.costPrice || '',
            p.openingStock || '0',
          ]),
        ];
        onClose();
        onOpenBulkImport(rows);
        return;
      }

      setStep('review');
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to extract invoice data. Please try another invoice or check the scan clarity.');
      setStep('upload');
    }
  };

  // Reparse with updated column mapping
  const handleReparse = async () => {
    if (!dataLinesPreview.length) return;
    try {
      const res = await reparseSupplierInvoice({
        dataLines: dataLinesPreview,
        headers: detectedColumns,
        columnMap,
      });
      if (res.ok) {
        setProducts(res.products);
      }
    } catch (err: any) {
      alert(err.message || 'Failed to re-parse invoice');
    }
  };

  // Save Column Mapping for Supplier
  const handleSaveMapping = async () => {
    const sName = metadata.supplierName || 'Supplier';
    try {
      const res = await saveSupplierInvoiceMapping({
        supplierId: selectedSupplierId || null,
        supplierName: sName,
        supplierGstin: metadata.supplierGstin || null,
        mapping: columnMap,
        headerSample: detectedColumns,
      });
      if (res.ok) {
        setMappingSaveSuccess(true);
        setTimeout(() => setMappingSaveSuccess(false), 3000);
        // Refresh saved mappings
        const updated = await fetchSupplierInvoiceMappings();
        if (updated.ok) setSavedMappings(updated.mappings);
      }
    } catch (err: any) {
      alert(err.message || 'Failed to save mapping');
    }
  };

  // Table cell edit handler
  const handleCellChange = (rowIndex: number, field: keyof ExtractedSupplierInvoiceItem, val: string) => {
    setProducts((prev) => {
      const next = [...prev];
      const item = { ...next[rowIndex], [field]: val };

      // Update validation flags
      const flags = [...(item.flags || [])];
      if (field === 'sellingPrice') {
        const flagIdx = flags.indexOf('Selling Price required');
        if (val.trim()) {
          if (flagIdx >= 0) flags.splice(flagIdx, 1);
        } else {
          if (flagIdx < 0) flags.push('Selling Price required');
        }
      }
      if (field === 'costPrice') {
        const flagIdx = flags.indexOf('Cost Price uncertain');
        const cpNum = parseImportNumeric(val);
        if (val.trim() && cpNum !== null && cpNum > 0) {
          if (flagIdx >= 0) flags.splice(flagIdx, 1);
        }
      }
      item.flags = flags;
      next[rowIndex] = item;
      return next;
    });
  };

  // Add row manually
  const handleAddRow = () => {
    const newRow: IntelligentInvoiceItem = {
      id: `manual-row-${Date.now()}`,
      name: '',
      size: '',
      uom: 'pcs',
      sellingPrice: '',
      costPrice: '',
      hsn: '',
      gstRate: '5%',
      priceInclusive: 'Yes',
      openingStock: '1',
      flags: ['Cost Price uncertain'],
      reviewStatus: 'missing_information',
      userApproved: true,
    };
    setProducts((prev) => [...prev, newRow]);
  };

  // Delete row
  const handleDeleteRow = (index: number) => {
    setProducts((prev) => prev.filter((_, i) => i !== index));
  };

  // Calculate sum of extracted items cost
  const totalExtractedCost = useMemo(() => {
    return products.reduce((acc, p) => {
      const cp = parseImportNumeric(p.costPrice) || 0;
      const qty = parseImportNumeric(p.openingStock) || 0;
      if (cp > 0 && qty > 0) {
        return acc + cp * qty;
      }
      return acc;
    }, 0);
  }, [products]);

  // Apply Markup % or Margin % selling price rule (explicit user action)
  const handleApplyPricingRule = (onlyMissing: boolean) => {
    const pct = parseFloat(pricingPct);
    if (!Number.isFinite(pct) || pct <= 0) {
      alert('Enter a valid positive percentage.');
      return;
    }
    if (pricingMode === 'margin' && pct >= 100) {
      alert('Profit margin percentage must be less than 100%.');
      return;
    }
    setProducts((prev) =>
      prev.map((p) => {
        const cp = parseImportNumeric(p.costPrice);
        if (cp === null || cp <= 0) return p;
        if (onlyMissing && p.sellingPrice.trim()) return p;
        const sp = pricingMode === 'markup' ? cp * (1 + pct / 100) : cp / (1 - pct / 100);
        const flags = (p.flags || []).filter((f) => f !== 'Selling Price required');
        return {
          ...p,
          sellingPrice: sp.toFixed(2),
          flags,
          reviewStatus: p.validationErrors?.length ? p.reviewStatus : 'verified',
          userApproved: true,
        };
      })
    );
  };

  const handleSelectMatch = (rowIndex: number, selectedItemId: string) => {
    setProducts((prev) => {
      const next = [...prev];
      const row = { ...next[rowIndex] };
      if (!selectedItemId) {
        row.matchType = 'new_product';
        row.matchedItemId = null;
        row.matchedItemName = null;
      } else {
        const cand = row.matchCandidates?.find((c) => c.itemId === selectedItemId);
        row.matchType = 'exact_match';
        row.matchedItemId = selectedItemId;
        row.matchedItemName = cand?.name || null;
        if (!row.sellingPrice && cand && cand.sellingPriceMinor > 0) {
          row.sellingPrice = (cand.sellingPriceMinor / 100).toFixed(2);
        }
      }
      row.userApproved = true;
      next[rowIndex] = row;
      return next;
    });
  };

  const handleDirectImport = async () => {
    if (!jobId) {
      alert('No active extraction job.');
      return;
    }
    setIsImportingDirect(true);
    setDirectImportSuccess(null);
    setErrorMsg('');
    try {
      const res = await importInvoiceJobToInventory(jobId, {
        items: products,
        supplierId: selectedSupplierId || null,
      });
      setDirectImportSuccess(`Imported ${res.created} new product(s) and restocked ${res.restocked} existing product(s) into inventory.`);
    } catch (err: any) {
      setErrorMsg(err.message || 'Direct inventory import failed.');
    } finally {
      setIsImportingDirect(false);
    }
  };

  const handleOpenInBulkImport = () => {
    if (!onOpenBulkImport) return;
    const rows: string[][] = [
      ['Product Name', 'Size', 'Cost', 'Stock'],
      ...products.map((p) => [
        p.name || '',
        p.size ?? p.sizeWeightVolume ?? '',
        p.costPrice || '',
        p.openingStock || '0',
      ]),
    ];
    onClose();
    onOpenBulkImport(rows);
  };

  // Verified items count (matches 4-column format: Product Name, Size, Cost, Stock)
  const verifiedCount = useMemo(() => {
    return products.filter((p) => {
      const cp = parseImportNumeric(p.costPrice);
      const stock = parseImportNumeric(p.openingStock);
      return p.name.trim() && cp !== null && cp >= 0 && stock !== null && stock > 0;
    }).length;
  }, [products]);

  // Generate Excel and Proceed to Download Step
  const handleGenerateExcel = async () => {
    if (products.length === 0) {
      alert('Please have at least one product row to generate the Excel template.');
      return;
    }
    setIsGeneratingExcel(true);
    setDownloadError(null);
    setIsAuthError(false);
    try {
      const blob = await exportSupplierInvoiceExcel({
        products,
        invoiceNumber: metadata.invoiceNumber || 'INV',
      });
      const resolvedFilename = blob.filename || downloadFilename;
      setDownloadFilename(resolvedFilename);
      setDownloadBlob(blob);
      setIsGeneratingExcel(false);
      setStep('download');

      // Trigger automatic download
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = resolvedFilename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setIsGeneratingExcel(false);
      const msg = err.message || 'Failed to generate Excel file';
      const isAuth =
        msg.toLowerCase().includes('sign in') ||
        msg.toLowerCase().includes('unauthorized') ||
        msg.toLowerCase().includes('session') ||
        msg.toLowerCase().includes('authenticated');
      setDownloadError(msg);
      setIsAuthError(isAuth);
    }
  };

  const handleInlineLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setInlineLoginLoading(true);
    setInlineLoginError(null);
    try {
      const res = await api<{ token: string }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          identifier: inlineLoginIdentifier,
          password: inlineLoginPassword,
        }),
      });
      if (res.token) {
        setToken(res.token);
        setShowInlineLogin(false);
        setDownloadError(null);
        setIsAuthError(false);
        setInlineLoginPassword('');
        // Automatically retry download with the new active token
        setTimeout(() => {
          handleGenerateExcel();
        }, 150);
      }
    } catch (loginErr: any) {
      setInlineLoginError(loginErr.message || 'Sign in failed');
    } finally {
      setInlineLoginLoading(false);
    }
  };

  // Manual Trigger Download
  const handleTriggerDownload = () => {
    if (!downloadBlob) return;
    const url = URL.createObjectURL(downloadBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = downloadFilename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="modal-overlay" style={{ zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(15, 23, 42, 0.72)', backdropFilter: 'blur(4px)' }}>
      <div
        className="card"
        style={{
          width: '95vw',
          maxWidth: '1280px',
          height: '90vh',
          maxHeight: '920px',
          display: 'flex',
          flexDirection: 'column',
          borderRadius: '18px',
          padding: 0,
          overflow: 'hidden',
          background: '#ffffff',
          boxShadow: '0 24px 64px -12px rgba(0, 0, 0, 0.28)',
        }}
      >
        {/* MODAL HEADER */}
        <div
          style={{
            padding: '1.15rem 1.75rem',
            background: 'linear-gradient(135deg, var(--text-main) 0%, var(--deep-purple) 100%)',
            color: '#ffffff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: '1px solid rgba(255, 255, 255, 0.12)',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <div
              style={{
                width: '44px',
                height: '44px',
                borderRadius: '12px',
                background: 'rgba(255, 255, 255, 0.16)',
                border: '1px solid rgba(255, 255, 255, 0.22)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#ffffff',
              }}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="8" y1="13" x2="16" y2="13" />
                <line x1="8" y1="17" x2="16" y2="17" />
                <polyline points="10 9 9 9 8 9" />
              </svg>
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                <h2 style={{ fontSize: '1.25rem', fontWeight: 800, margin: 0, color: '#ffffff', letterSpacing: '-0.01em' }}>
                  Convert Supplier Invoice to Excel
                </h2>
                <span style={{ fontSize: '0.68rem', fontWeight: 700, background: 'rgba(255, 255, 255, 0.16)', border: '1px solid rgba(255, 255, 255, 0.25)', color: '#ffffff', padding: '0.15rem 0.5rem', borderRadius: '6px', textTransform: 'uppercase' }}>
                  {capabilities?.aiConfigured ? 'Hybrid AI + OCR' : 'Local OCR + Parser'}
                </span>
              </div>
              <p style={{ margin: '0.2rem 0 0', fontSize: '0.82rem', color: 'rgba(255, 255, 255, 0.85)' }}>
                Extract product catalog items from PDF, JPG, and PNG supplier invoices into the 4-column product template.
              </p>
            </div>
          </div>

          {/* Stepper Indicator */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', background: 'rgba(255, 255, 255, 0.12)', border: '1px solid rgba(255, 255, 255, 0.18)', padding: '0.35rem 0.85rem', borderRadius: '10px' }}>
              <span style={{ fontSize: '0.78rem', fontWeight: step === 'upload' ? 700 : 500, color: step === 'upload' ? '#ffffff' : 'rgba(255, 255, 255, 0.78)', background: step === 'upload' ? 'rgba(255, 255, 255, 0.18)' : 'transparent', padding: step === 'upload' ? '0.15rem 0.5rem' : '0.15rem 0.2rem', borderRadius: '6px' }}>1. Upload</span>
              <span style={{ color: 'rgba(255, 255, 255, 0.6)' }}>→</span>
              <span style={{ fontSize: '0.78rem', fontWeight: step === 'review' ? 700 : 500, color: step === 'review' ? '#ffffff' : 'rgba(255, 255, 255, 0.78)', background: step === 'review' ? 'rgba(255, 255, 255, 0.18)' : 'transparent', padding: step === 'review' ? '0.15rem 0.5rem' : '0.15rem 0.2rem', borderRadius: '6px' }}>2. Review & Fix</span>
              <span style={{ color: 'rgba(255, 255, 255, 0.6)' }}>→</span>
              <span style={{ fontSize: '0.78rem', fontWeight: step === 'download' ? 700 : 500, color: step === 'download' ? '#ffffff' : 'rgba(255, 255, 255, 0.78)', background: step === 'download' ? 'rgba(255, 255, 255, 0.18)' : 'transparent', padding: step === 'download' ? '0.15rem 0.5rem' : '0.15rem 0.2rem', borderRadius: '6px' }}>3. Download</span>
            </div>

            <button
              type="button"
              onClick={onClose}
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '10px',
                background: 'rgba(255, 255, 255, 0.08)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                color: '#ffffff',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              title="Close"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
          </div>
        </div>

        {/* MODAL BODY */}
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', background: 'var(--bg-main)' }}>
          {errorMsg && (
            <div style={{ padding: '0.75rem 1.5rem', background: '#fef2f2', borderBottom: '1px solid #fee2e2', color: '#b91c1c', fontSize: '0.86rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
              <span>{errorMsg}</span>
            </div>
          )}

          {/* ════════════════════════════════════════════════════════════════════
              STAGE 1: UPLOAD INVOICE
             ════════════════════════════════════════════════════════════════════ */}
          {step === 'upload' && (
            <div style={{ padding: '2rem', display: 'grid', gridTemplateColumns: 'minmax(0, 1.8fr) minmax(320px, 1fr)', gap: '1.75rem', alignItems: 'start' }}>
              {/* Left Column: Drag & Drop Upload Hero */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div
                  onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    border: `2px dashed ${isDragging ? 'var(--primary)' : file ? '#10b981' : 'var(--border)'}`,
                    background: isDragging ? 'var(--primary-light)' : file ? '#f0fdf4' : 'var(--bg-card)',
                    borderRadius: '16px',
                    padding: '2.5rem 1.5rem',
                    textAlign: 'center',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    boxShadow: '0 4px 16px rgba(0,0,0,0.03)',
                  }}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      if (e.target.files && e.target.files[0]) {
                        handleFileSelect(e.target.files[0]);
                      }
                    }}
                  />

                  <div
                    style={{
                      width: '64px',
                      height: '64px',
                      borderRadius: '16px',
                      background: file ? '#dcfce7' : 'var(--primary-light)',
                      color: file ? '#16a34a' : 'var(--primary)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      margin: '0 auto 1.25rem',
                    }}
                  >
                    {file?.type.includes('pdf') || file?.name.endsWith('.pdf') ? (
                      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                        <text x="7" y="17" fontSize="5" fontWeight="bold" fill="currentColor">PDF</text>
                      </svg>
                    ) : (
                      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="17 8 12 3 7 8" />
                        <line x1="12" y1="3" x2="12" y2="15" />
                      </svg>
                    )}
                  </div>

                  <h3 style={{ fontSize: '1.15rem', fontWeight: 700, margin: '0 0 0.5rem', color: file ? '#15803d' : '#1e293b' }}>
                    {file ? file.name : 'Drop supplier invoice here'}
                  </h3>

                  <p style={{ fontSize: '0.86rem', color: '#64748b', margin: '0 0 1.25rem', maxWidth: '420px', marginLeft: 'auto', marginRight: 'auto' }}>
                    {file
                      ? `Ready to extract (${(file.size / 1024).toFixed(1)} KB). Click browse to select a different file.`
                      : 'Drag and drop your scanned invoice or digital PDF file, or browse from computer'}
                  </p>

                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', background: 'var(--primary)', color: '#ffffff', padding: '0.6rem 1.25rem', borderRadius: '10px', fontWeight: 600, fontSize: '0.88rem' }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
                    <span>{file ? 'Choose Another File' : 'Browse Files'}</span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.65rem', marginTop: '1.25rem' }}>
                    <span style={{ fontSize: '0.72rem', fontWeight: 600, padding: '0.2rem 0.55rem', borderRadius: '6px', background: '#e2e8f0', color: '#475569' }}>PDF</span>
                    <span style={{ fontSize: '0.72rem', fontWeight: 600, padding: '0.2rem 0.55rem', borderRadius: '6px', background: '#e2e8f0', color: '#475569' }}>JPG</span>
                    <span style={{ fontSize: '0.72rem', fontWeight: 600, padding: '0.2rem 0.55rem', borderRadius: '6px', background: '#e2e8f0', color: '#475569' }}>JPEG</span>
                    <span style={{ fontSize: '0.72rem', fontWeight: 600, padding: '0.2rem 0.55rem', borderRadius: '6px', background: '#e2e8f0', color: '#475569' }}>PNG</span>
                  </div>
                </div>

                {/* File Preview Card (if image) */}
                {filePreviewUrl && (
                  <div style={{ padding: '1rem', background: '#ffffff', borderRadius: '14px', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <img src={filePreviewUrl} alt="Invoice Preview" style={{ width: '70px', height: '70px', objectFit: 'cover', borderRadius: '8px', border: '1px solid #cbd5e1' }} />
                    <div>
                      <div style={{ fontSize: '0.9rem', fontWeight: 700, color: '#1e293b' }}>Visual Image Preview</div>
                      <div style={{ fontSize: '0.8rem', color: '#64748b' }}>OCR engine will recognize text positions, table alignment, and values automatically.</div>
                    </div>
                  </div>
                )}
              </div>

              {/* Right Column: Supplier Selection & Guidelines */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div style={{ background: '#ffffff', borderRadius: '16px', padding: '1.25rem', border: '1px solid #e2e8f0' }}>
                  <h4 style={{ fontSize: '0.95rem', fontWeight: 700, margin: '0 0 0.85rem', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="2.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
                    <span>Supplier Party (Optional)</span>
                  </h4>
                  <p style={{ fontSize: '0.82rem', color: '#64748b', margin: '0 0 0.85rem' }}>
                    Select an existing supplier to automatically apply saved column mappings, or let the engine auto-detect from the invoice header.
                  </p>

                  <select
                    className="form-select"
                    value={selectedSupplierId}
                    onChange={(e) => setSelectedSupplierId(e.target.value)}
                    style={{ width: '100%', fontSize: '0.88rem', padding: '0.55rem 0.75rem', borderRadius: '10px' }}
                  >
                    <option value="">-- Auto-Detect Supplier from Invoice --</option>
                    {supplierParties.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} {s.gstin ? `(${s.gstin})` : ''}
                      </option>
                    ))}
                  </select>

                  {activeSavedMapping && (
                    <div style={{ marginTop: '0.85rem', padding: '0.65rem 0.85rem', background: '#ecfdf5', borderRadius: '8px', border: '1px solid #a7f3d0', fontSize: '0.8rem', color: '#047857', display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>
                      <span>Saved column mapping found for this supplier. It will be applied automatically!</span>
                    </div>
                  )}
                </div>

                {/* 4-Column Format Guarantee Card */}
                <div style={{ background: 'var(--bg-main)', borderRadius: '16px', padding: '1.25rem', border: '1px solid var(--border-light)' }}>
                  <h4 style={{ fontSize: '0.95rem', fontWeight: 700, margin: '0 0 0.65rem', color: 'var(--text-main)' }}>
                    Exact 4-Column Product Template
                  </h4>
                  <p style={{ fontSize: '0.82rem', color: '#64748b', margin: '0 0 0.85rem' }}>
                    Regardless of supplier invoice layout, output always produces our exact product import template:
                  </p>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.45rem', fontSize: '0.78rem' }}>
                    <div style={{ padding: '0.35rem 0.55rem', background: '#ffffff', borderRadius: '6px', border: '1px solid #e2e8f0', color: '#334155', fontWeight: 600 }}>1. Product Name</div>
                    <div style={{ padding: '0.35rem 0.55rem', background: '#ffffff', borderRadius: '6px', border: '1px solid #e2e8f0', color: '#334155', fontWeight: 600 }}>2. Size</div>
                    <div style={{ padding: '0.35rem 0.55rem', background: '#ffffff', borderRadius: '6px', border: '1px solid #e2e8f0', color: '#334155', fontWeight: 600 }}>3. Cost</div>
                    <div style={{ padding: '0.35rem 0.55rem', background: '#ffffff', borderRadius: '6px', border: '1px solid #e2e8f0', color: '#334155', fontWeight: 600 }}>4. Stock</div>
                  </div>
                </div>

                {/* Submit button */}
                <button
                  type="button"
                  id="start-invoice-extraction-btn"
                  disabled={!file}
                  onClick={handleStartExtraction}
                  style={{
                    padding: '0.9rem 1.5rem',
                    background: file ? 'linear-gradient(135deg, var(--primary) 0%, var(--primary-hover) 100%)' : '#cbd5e1',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '12px',
                    fontWeight: 700,
                    fontSize: '0.96rem',
                    cursor: file ? 'pointer' : 'not-allowed',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.5rem',
                    boxShadow: file ? '0 4px 12px var(--primary-glow)' : 'none',
                    transition: 'all 0.2s ease',
                  }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
                  <span>Extract Invoice Data</span>
                </button>
              </div>
            </div>
          )}

          {/* ════════════════════════════════════════════════════════════════════
              STAGE 2: EXTRACTING STATE (ANIMATED)
             ════════════════════════════════════════════════════════════════════ */}
          {step === 'extracting' && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '3rem 1.5rem' }}>
              <div
                style={{
                  width: '80px',
                  height: '80px',
                  borderRadius: '24px',
                  background: 'linear-gradient(135deg, var(--primary-light) 0%, var(--accent-purple-light) 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: '1.5rem',
                }}
              >
                <div style={{ width: '40px', height: '40px', border: '4px solid var(--primary)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></div>
              </div>
              <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>

              <h3 style={{ fontSize: '1.35rem', fontWeight: 800, margin: '0 0 0.5rem', color: 'var(--text-main)' }}>
                Analyzing Supplier Invoice
              </h3>
              <p style={{ fontSize: '0.92rem', color: 'var(--primary)', fontWeight: 600, margin: '0 0 1rem' }}>
                {extractingProgress}
              </p>
              <p style={{ fontSize: '0.82rem', color: '#64748b', maxWidth: '460px', textAlign: 'center', margin: 0 }}>
                Extracting items, identifying tables, calculating purchase costs, and cross-referencing your existing product catalog without external paid APIs.
              </p>
            </div>
          )}

          {/* ════════════════════════════════════════════════════════════════════
              STAGE 3: REVIEW & CORRECT (EDITABLE 8-COLUMN TABLE)
             ════════════════════════════════════════════════════════════════════ */}
          {step === 'review' && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              {/* Review Top Banner: Metadata & Financial Reconciliation */}
              <div style={{ padding: '1rem 1.5rem', background: '#ffffff', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>Supplier</div>
                    <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#1e293b' }}>
                      {metadata.supplierName || 'Unspecified Supplier'}
                    </div>
                  </div>

                  {metadata.supplierGstin && (
                    <div>
                      <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>Supplier GSTIN</div>
                      <div style={{ fontSize: '0.9rem', fontWeight: 600, color: '#334155', fontFamily: 'monospace' }}>
                        {metadata.supplierGstin}
                      </div>
                    </div>
                  )}

                  <div>
                    <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>Invoice No & Date</div>
                    <div style={{ fontSize: '0.9rem', fontWeight: 600, color: '#334155' }}>
                      {metadata.invoiceNumber || 'N/A'} {metadata.invoiceDate ? `· ${metadata.invoiceDate}` : ''}
                    </div>
                  </div>

                  {/* Financial Match / Discrepancy Indicator */}
                  <div style={{ padding: '0.45rem 0.85rem', background: '#f8fafc', borderRadius: '10px', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <div>
                      <span style={{ fontSize: '0.7rem', color: '#64748b', display: 'block' }}>Invoice Total</span>
                      <span style={{ fontSize: '0.9rem', fontWeight: 700, color: '#1e293b' }}>
                        {metadata.totalAmount != null ? `₹${metadata.totalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : 'N/A'}
                      </span>
                    </div>
                    <span style={{ color: '#cbd5e1' }}>|</span>
                    <div>
                      <span style={{ fontSize: '0.7rem', color: '#64748b', display: 'block' }}>Items Total</span>
                      <span style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--primary)' }}>
                        ₹{totalExtractedCost.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </div>

                    {metadata.totalAmount != null && Math.abs(metadata.totalAmount - totalExtractedCost) < 2 ? (
                      <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#15803d', background: '#dcfce7', padding: '0.15rem 0.45rem', borderRadius: '4px' }}>
                        ✓ Totals Match
                      </span>
                    ) : metadata.totalAmount != null ? (
                      <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#b45309', background: '#fef3c7', padding: '0.15rem 0.45rem', borderRadius: '4px' }} title="Difference between invoice header total and sum of items">
                        Δ ₹{Math.abs(metadata.totalAmount - totalExtractedCost).toFixed(2)}
                      </span>
                    ) : null}
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    onClick={() => setShowPreviewPane((v) => !v)}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.35rem',
                      padding: '0.45rem 0.75rem',
                      borderRadius: '8px',
                      background: showPreviewPane ? 'var(--primary-light)' : '#f1f5f9',
                      border: showPreviewPane ? '1px solid var(--border-light)' : '1px solid #cbd5e1',
                      color: showPreviewPane ? 'var(--primary)' : '#334155',
                      fontWeight: 600,
                      fontSize: '0.8rem',
                      cursor: 'pointer',
                    }}
                  >
                    <span>{showPreviewPane ? 'Hide Preview' : 'Show Invoice'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowMappingDrawer(!showMappingDrawer)}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.45rem',
                      padding: '0.45rem 0.85rem',
                      borderRadius: '8px',
                      background: showMappingDrawer ? 'var(--primary-light)' : '#f1f5f9',
                      border: showMappingDrawer ? '1px solid var(--border-light)' : '1px solid #cbd5e1',
                      color: showMappingDrawer ? 'var(--primary)' : '#334155',
                      fontWeight: 600,
                      fontSize: '0.82rem',
                      cursor: 'pointer',
                    }}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><line x1="4" y1="21" x2="4" y2="14"></line><line x1="4" y1="10" x2="4" y2="3"></line><line x1="12" y1="21" x2="12" y2="12"></line><line x1="12" y1="8" x2="12" y2="3"></line><line x1="20" y1="21" x2="20" y2="16"></line><line x1="20" y1="12" x2="20" y2="3"></line><line x1="1" y1="14" x2="7" y2="14"></line><line x1="9" y1="8" x2="15" y2="8"></line><line x1="17" y1="16" x2="23" y2="16"></line></svg>
                    <span>Column Mapping</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleAddRow}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.45rem',
                      padding: '0.45rem 0.85rem',
                      borderRadius: '8px',
                      background: '#f1f5f9',
                      border: '1px solid #cbd5e1',
                      color: '#334155',
                      fontWeight: 600,
                      fontSize: '0.82rem',
                      cursor: 'pointer',
                    }}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                    <span>Add Row</span>
                  </button>

                  {onOpenBulkImport && (
                    <button
                      type="button"
                      onClick={handleOpenInBulkImport}
                      disabled={products.length === 0}
                      title="Open these extracted products directly in Bulk Product Import"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.4rem',
                        padding: '0.45rem 0.95rem',
                        borderRadius: '8px',
                        background: products.length === 0 ? '#94a3b8' : 'linear-gradient(135deg, var(--primary) 0%, var(--primary-hover) 100%)',
                        color: '#ffffff',
                        border: 'none',
                        fontWeight: 700,
                        fontSize: '0.82rem',
                        cursor: products.length === 0 ? 'not-allowed' : 'pointer',
                      }}
                    >
                      <span>Open in Bulk Import →</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={handleDirectImport}
                    disabled={isImportingDirect || products.length === 0 || !jobId}
                    title="Directly import verified & approved rows into inventory"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.4rem',
                      padding: '0.45rem 0.85rem',
                      borderRadius: '8px',
                      background: '#f1f5f9',
                      color: '#334155',
                      border: '1px solid #cbd5e1',
                      fontWeight: 600,
                      fontSize: '0.8rem',
                      cursor: isImportingDirect || products.length === 0 ? 'not-allowed' : 'pointer',
                    }}
                  >
                    <span>{isImportingDirect ? 'Importing...' : 'Direct Import'}</span>
                  </button>

                  <button
                    type="button"
                    id="export-invoice-to-excel-btn"
                    onClick={handleGenerateExcel}
                    disabled={isGeneratingExcel || products.length === 0}
                    title={products.length === 0 ? 'Add at least one product row to download Excel' : 'Download Excel'}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.45rem',
                      padding: '0.45rem 1.15rem',
                      borderRadius: '8px',
                      background: products.length === 0 ? '#94a3b8' : 'linear-gradient(135deg, #16a34a 0%, #15803d 100%)',
                      color: '#ffffff',
                      border: 'none',
                      fontWeight: 700,
                      fontSize: '0.88rem',
                      cursor: products.length === 0 ? 'not-allowed' : 'pointer',
                      boxShadow: products.length === 0 ? 'none' : '0 2px 8px rgba(22, 163, 74, 0.3)',
                      opacity: products.length === 0 ? 0.7 : 1,
                    }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                    <span>{isGeneratingExcel ? 'Generating...' : 'Download Excel'}</span>
                  </button>
                </div>
              </div>

              {/* Download Error Banner with Inline Re-authentication */}
              {downloadError && (
                <div style={{
                  padding: '0.75rem 1.5rem',
                  background: isAuthError ? '#fff7ed' : '#fef2f2',
                  borderBottom: `1px solid ${isAuthError ? '#fed7aa' : '#fecaca'}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '0.85rem',
                  fontSize: '0.86rem',
                  color: isAuthError ? '#9a3412' : '#b91c1c',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
                    <span><strong>{isAuthError ? 'Authentication Required:' : 'Download Failed:'}</strong> {downloadError} (Your extracted products and edits are preserved)</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    {isAuthError && (
                      <button
                        type="button"
                        onClick={() => {
                          setInlineLoginError(null);
                          setShowInlineLogin(true);
                        }}
                        style={{
                          padding: '0.35rem 0.85rem',
                          background: '#ea580c',
                          color: '#ffffff',
                          border: 'none',
                          borderRadius: '6px',
                          fontSize: '0.8rem',
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        Sign In to Continue
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleGenerateExcel()}
                      style={{
                        padding: '0.35rem 0.85rem',
                        background: '#ffffff',
                        color: isAuthError ? '#ea580c' : '#b91c1c',
                        border: `1px solid ${isAuthError ? '#fed7aa' : '#fecaca'}`,
                        borderRadius: '6px',
                        fontSize: '0.8rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      Retry Download
                    </button>
                    <button
                      type="button"
                      onClick={() => setDownloadError(null)}
                      style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: '1rem', padding: '0 0.25rem' }}
                      title="Dismiss"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              )}

              {/* Financial Discrepancy Alert */}
              {metadata.discrepancyWarning && (
                <div style={{ padding: '0.65rem 1.5rem', background: '#fffbeb', borderBottom: '1px solid #fde68a', display: 'flex', alignItems: 'center', gap: '0.6rem', fontSize: '0.82rem', color: '#92400e' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
                  <span><strong>Tax Reconciliation Warning:</strong> {metadata.discrepancyWarning}</span>
                </div>
              )}

              {/* Collapsible Column Mapping Drawer */}
              {showMappingDrawer && (
                <div style={{ padding: '1rem 1.5rem', background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                    <div style={{ fontSize: '0.9rem', fontWeight: 700, color: '#1e293b' }}>
                      Configure Supplier Invoice Column Mapping
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <button
                        type="button"
                        onClick={handleSaveMapping}
                        style={{ padding: '0.35rem 0.75rem', background: 'var(--primary)', color: '#ffffff', border: 'none', borderRadius: '6px', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer' }}
                      >
                        {mappingSaveSuccess ? '✓ Saved for Supplier!' : 'Save Mapping for Supplier'}
                      </button>
                      <button
                        type="button"
                        onClick={handleReparse}
                        style={{ padding: '0.35rem 0.75rem', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer' }}
                      >
                        Re-parse with Mapping
                      </button>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem' }}>
                    {[
                      { key: 'productNameCol', label: 'Product Name' },
                      { key: 'quantityCol', label: 'Quantity' },
                      { key: 'uomCol', label: 'UOM / Unit' },
                      { key: 'rateCol', label: 'Unit Rate / Price' },
                      { key: 'hsnCol', label: 'HSN / SAC' },
                      { key: 'gstRateCol', label: 'GST Rate %' },
                      { key: 'taxableCol', label: 'Taxable Amount' },
                      { key: 'discountCol', label: 'Discount' },
                      { key: 'totalCol', label: 'Total Amount' },
                    ].map(({ key, label }) => (
                      <div key={key}>
                        <label style={{ fontSize: '0.72rem', fontWeight: 700, color: '#475569', display: 'block', marginBottom: '3px' }}>
                          {label}
                        </label>
                        <select
                          className="form-select"
                          value={columnMap[key] || ''}
                          onChange={(e) => setColumnMap({ ...columnMap, [key]: e.target.value || undefined })}
                          style={{ width: '100%', fontSize: '0.78rem', padding: '0.35rem 0.5rem', borderRadius: '6px' }}
                        >
                          <option value="">-- None / Auto --</option>
                          {detectedColumns.map((c) => (
                            <option key={c} value={c}>{c}</option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {directImportSuccess && (
                <div style={{ padding: '0.65rem 1.5rem', background: '#ecfdf5', borderBottom: '1px solid #a7f3d0', color: '#047857', fontSize: '0.84rem', fontWeight: 600 }}>
                  ✓ {directImportSuccess}
                </div>
              )}

              {/* Invoice Analysis Dashboard & Selling Price Intelligence */}
              <div style={{ padding: '0.55rem 1.5rem', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem', fontSize: '0.78rem', color: '#475569' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', flexWrap: 'wrap' }}>
                  <span>Pages: <strong>{pageCount}</strong></span>
                  <span>·</span>
                  <span>Rows: <strong>{products.length}</strong></span>
                  <span>·</span>
                  <span style={{ color: '#16a34a', fontWeight: 600 }}>{verifiedCount} verified</span>
                  <span>·</span>
                  <span style={{ color: '#ea580c', fontWeight: 600 }}>{products.length - verifiedCount} need review</span>
                  {analysisSummary && (
                    <>
                      <span>·</span>
                      <span>Completeness: <strong>{analysisSummary.extractionCompletenessPct}%</strong></span>
                    </>
                  )}
                </div>

                {/* Selling Price Intelligence Controls */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 700, color: 'var(--text-main)' }}>SP Rule:</span>
                  <select
                    value={pricingMode}
                    onChange={(e) => setPricingMode(e.target.value as 'markup' | 'margin')}
                    style={{ padding: '0.25rem 0.45rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.76rem' }}
                  >
                    <option value="markup">Markup %</option>
                    <option value="margin">Margin %</option>
                  </select>
                  <input
                    type="number"
                    min="1"
                    max="999"
                    value={pricingPct}
                    onChange={(e) => setPricingPct(e.target.value)}
                    style={{ width: '58px', padding: '0.25rem 0.4rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.76rem', textAlign: 'right' }}
                  />
                  <button
                    type="button"
                    onClick={() => handleApplyPricingRule(true)}
                    style={{ padding: '0.25rem 0.6rem', borderRadius: '6px', border: '1px solid var(--border-light)', background: 'var(--primary-light)', color: 'var(--primary)', fontWeight: 700, fontSize: '0.75rem', cursor: 'pointer' }}
                  >
                    Apply to Missing SP
                  </button>
                </div>
              </div>

              {/* Split Pane: Original Invoice Preview + Editable Product Table */}
              <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: showPreviewPane ? '360px minmax(0, 1fr)' : 'minmax(0, 1fr)' }}>
                {showPreviewPane && (
                  <InvoicePreviewPane
                    file={file}
                    previewUrl={filePreviewUrl}
                    pageCount={pageCount}
                    highlightedBbox={selectedRowIdx !== null ? products[selectedRowIdx]?.sourceBbox : null}
                    highlightedRowOrder={selectedRowIdx !== null ? selectedRowIdx + 1 : null}
                  />
                )}

                <div style={{ flex: 1, overflow: 'auto', background: '#ffffff' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84rem' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0', color: '#475569', textAlign: 'left', position: 'sticky', top: 0, zIndex: 10 }}>
                      <th style={{ padding: '0.65rem 0.75rem', width: '38px', textAlign: 'center' }}>#</th>
                      <th style={{ padding: '0.65rem 0.75rem', minWidth: '240px' }}>Product Name <span style={{ color: '#ef4444' }}>*</span></th>
                      <th style={{ padding: '0.65rem 0.75rem', width: '110px' }}>Size</th>
                      <th style={{ padding: '0.65rem 0.75rem', width: '120px' }}>Cost <span style={{ color: '#ef4444' }}>*</span></th>
                      <th style={{ padding: '0.65rem 0.75rem', width: '110px' }}>Stock <span style={{ color: '#ef4444' }}>*</span></th>
                      <th style={{ padding: '0.65rem 0.75rem', minWidth: '150px' }}>Status & Match</th>
                      <th style={{ padding: '0.65rem 0.75rem', width: '45px', textAlign: 'center' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {products.length === 0 ? (
                      <tr>
                        <td colSpan={7} style={{ padding: '3.5rem 1.5rem', textAlign: 'center', color: '#64748b' }}>
                          <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '52px', height: '52px', borderRadius: '50%', background: '#fef2f2', color: '#ef4444', marginBottom: '0.85rem' }}>
                            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
                          </div>
                          <div style={{ fontWeight: 700, color: '#1e293b', fontSize: '1rem', marginBottom: '0.35rem' }}>
                            No product rows detected
                          </div>
                          <p style={{ margin: '0 auto 1.25rem', maxWidth: '440px', fontSize: '0.84rem', color: '#64748b', lineHeight: 1.5 }}>
                            We could not automatically detect line items from the uploaded invoice. You can add product rows manually or adjust the column mapping.
                          </p>
                          <button
                            type="button"
                            onClick={handleAddRow}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '0.45rem',
                              padding: '0.55rem 1.15rem',
                              borderRadius: '8px',
                              background: 'var(--primary)',
                              color: '#ffffff',
                              border: 'none',
                              fontWeight: 600,
                              fontSize: '0.85rem',
                              cursor: 'pointer',
                              boxShadow: '0 2px 4px var(--primary-glow)',
                            }}
                          >
                            + Add Product Row Manually
                          </button>
                        </td>
                      </tr>
                    ) : (
                      products.map((p, idx) => {
                        const isSpMissing = !p.sellingPrice || !p.sellingPrice.trim();
                        const isCpMissing = !p.costPrice || !p.costPrice.trim();

                        return (
                          <tr
                            key={p.id}
                            onClick={() => setSelectedRowIdx(idx)}
                            style={{
                              borderBottom: '1px solid #f1f5f9',
                              background: selectedRowIdx === idx ? 'var(--primary-light)' : idx % 2 === 0 ? '#ffffff' : '#fafafa',
                            }}
                          >
                            <td style={{ padding: '0.5rem 0.75rem', textAlign: 'center', color: '#94a3b8', fontSize: '0.78rem' }}>
                              {idx + 1}
                            </td>

                            {/* 1. PRODUCT NAME */}
                            <td style={{ padding: '0.4rem 0.5rem' }}>
                              <input
                                type="text"
                                value={p.name}
                                onChange={(e) => handleCellChange(idx, 'name', e.target.value)}
                                placeholder="Product description"
                                style={{
                                  width: '100%',
                                  padding: '0.35rem 0.55rem',
                                  borderRadius: '6px',
                                  border: '1px solid #cbd5e1',
                                  fontSize: '0.84rem',
                                  fontWeight: 600,
                                  color: '#1e293b',
                                }}
                              />
                            </td>

                            {/* 2. SIZE */}
                            <td style={{ padding: '0.4rem 0.5rem' }}>
                              <input
                                type="text"
                                value={p.size ?? p.sizeWeightVolume ?? ''}
                                onChange={(e) => handleCellChange(idx, 'size', e.target.value)}
                                placeholder="M / L / Free Size"
                                style={{
                                  width: '100%',
                                  padding: '0.35rem 0.45rem',
                                  borderRadius: '6px',
                                  border: '1px solid #cbd5e1',
                                  fontSize: '0.84rem',
                                  textAlign: 'center',
                                }}
                              />
                            </td>

                            {/* 3. COST */}
                            <td style={{ padding: '0.4rem 0.5rem' }}>
                              <input
                                type="text"
                                value={p.costPrice}
                                onChange={(e) => handleCellChange(idx, 'costPrice', e.target.value)}
                                placeholder="Cost"
                                style={{
                                  width: '100%',
                                  padding: '0.35rem 0.55rem',
                                  borderRadius: '6px',
                                  border: isCpMissing ? '1.5px solid #f59e0b' : '1px solid #cbd5e1',
                                  background: isCpMissing ? '#fffbeb' : '#ffffff',
                                  fontSize: '0.84rem',
                                  textAlign: 'right',
                                  fontWeight: 600,
                                }}
                              />
                            </td>

                            {/* 4. STOCK */}
                            <td style={{ padding: '0.4rem 0.5rem' }}>
                              <input
                                type="text"
                                value={p.openingStock}
                                onChange={(e) => handleCellChange(idx, 'openingStock', e.target.value)}
                                placeholder="Stock"
                                style={{
                                  width: '100%',
                                  padding: '0.35rem 0.45rem',
                                  borderRadius: '6px',
                                  border: '1px solid #cbd5e1',
                                  fontSize: '0.84rem',
                                  textAlign: 'right',
                                  fontWeight: 600,
                                }}
                              />
                            </td>

                            {/* Status & Catalog Match */}
                            <td style={{ padding: '0.4rem 0.5rem', fontSize: '0.74rem' }}>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                                <span
                                  style={{
                                    display: 'inline-block',
                                    padding: '0.15rem 0.45rem',
                                    borderRadius: '4px',
                                    fontWeight: 700,
                                    fontSize: '0.7rem',
                                    width: 'fit-content',
                                    background:
                                      p.reviewStatus === 'verified'
                                        ? '#dcfce7'
                                        : p.reviewStatus === 'calculation_mismatch' || p.reviewStatus === 'missing_information'
                                        ? '#fee2e2'
                                        : '#fef3c7',
                                    color:
                                      p.reviewStatus === 'verified'
                                        ? '#15803d'
                                        : p.reviewStatus === 'calculation_mismatch' || p.reviewStatus === 'missing_information'
                                        ? '#b91c1c'
                                        : '#b45309',
                                  }}
                                >
                                  {(p.reviewStatus || 'needs_review').replace(/_/g, ' ')}
                                </span>
                                {p.matchCandidates && p.matchCandidates.length > 0 && (
                                  <select
                                    value={p.matchedItemId || ''}
                                    onChange={(e) => handleSelectMatch(idx, e.target.value)}
                                    style={{ fontSize: '0.72rem', padding: '0.2rem', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                                  >
                                    <option value="">+ New Catalog Item</option>
                                    {p.matchCandidates.map((c) => (
                                      <option key={c.itemId} value={c.itemId}>
                                        {c.name} ({Math.round(c.similarityScore * 100)}%)
                                      </option>
                                    ))}
                                  </select>
                                )}
                              </div>
                            </td>

                            {/* Actions: Delete */}
                            <td style={{ padding: '0.4rem 0.5rem', textAlign: 'center' }}>
                              <button
                                type="button"
                                onClick={() => handleDeleteRow(idx)}
                                style={{
                                  background: 'transparent',
                                  border: 'none',
                                  color: '#94a3b8',
                                  cursor: 'pointer',
                                  padding: '0.2rem',
                                  borderRadius: '4px',
                                }}
                                title="Delete row"
                              >
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
                </div>
              </div>
            </div>
          )}

          {/* ════════════════════════════════════════════════════════════════════
              STAGE 4: DOWNLOAD & INTEGRATION
             ════════════════════════════════════════════════════════════════════ */}
          {step === 'download' && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '3rem 1.5rem', background: 'var(--bg-main)' }}>
              <div
                style={{
                  width: '76px',
                  height: '76px',
                  borderRadius: '24px',
                  background: '#dcfce7',
                  color: '#15803d',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: '1.25rem',
                }}
              >
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
              </div>

              <h3 style={{ fontSize: '1.45rem', fontWeight: 800, margin: '0 0 0.5rem', color: 'var(--text-main)' }}>
                Excel File Ready!
              </h3>
              <p style={{ fontSize: '0.9rem', color: '#475569', margin: '0 0 1.5rem', textAlign: 'center', maxWidth: '480px' }}>
                Your supplier invoice was converted into the exact 4-column product import template (Product Name, Size, Cost, Stock).
              </p>

              {/* Template File Card */}
              <div
                style={{
                  background: '#ffffff',
                  borderRadius: '14px',
                  border: '1px solid #e2e8f0',
                  padding: '1.25rem 1.75rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '1.25rem',
                  boxShadow: '0 4px 16px rgba(0,0,0,0.04)',
                  marginBottom: '1.75rem',
                }}
              >
                <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: '#ecfdf5', color: '#059669', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><path d="M8 13h8"></path><path d="M8 17h8"></path><path d="M14 9v12"></path></svg>
                </div>
                <div>
                  <div style={{ fontSize: '0.96rem', fontWeight: 700, color: '#1e293b' }}>{downloadFilename}</div>
                  <div style={{ fontSize: '0.8rem', color: '#64748b' }}>
                    {products.length} products · 4 Template Columns (Product Name, Size, Cost, Stock) · Ready for Product Import
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', flexWrap: 'wrap', justifyContent: 'center' }}>
                <button
                  type="button"
                  onClick={handleTriggerDownload}
                  style={{
                    padding: '0.75rem 1.4rem',
                    background: '#ffffff',
                    border: '1px solid #cbd5e1',
                    borderRadius: '10px',
                    fontWeight: 600,
                    fontSize: '0.88rem',
                    color: '#1e293b',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.45rem',
                    cursor: 'pointer',
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                  <span>Download Again</span>
                </button>

                {onOpenBulkImport && (
                  <button
                    type="button"
                    onClick={handleOpenInBulkImport}
                    style={{
                      padding: '0.75rem 1.6rem',
                      background: 'linear-gradient(135deg, var(--primary) 0%, var(--primary-hover) 100%)',
                      border: 'none',
                      borderRadius: '10px',
                      fontWeight: 700,
                      fontSize: '0.9rem',
                      color: '#ffffff',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      cursor: 'pointer',
                      boxShadow: '0 4px 14px var(--primary-glow)',
                    }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                    <span>Import into Products Catalog Now</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => {
                    setFile(null);
                    setProducts([]);
                    setStep('upload');
                  }}
                  style={{
                    padding: '0.75rem 1.25rem',
                    background: 'transparent',
                    border: 'none',
                    color: '#64748b',
                    fontSize: '0.86rem',
                    cursor: 'pointer',
                  }}
                >
                  Convert Another Invoice
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* INLINE RE-AUTHENTICATION MODAL */}
      {showInlineLogin && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.72)',
            zIndex: 10050,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1rem',
          }}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: '16px',
              width: '100%',
              maxWidth: '420px',
              padding: '1.75rem',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.25)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h4 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-main)' }}>
                Sign In to Continue
              </h4>
              <button
                type="button"
                onClick={() => setShowInlineLogin(false)}
                style={{ background: 'none', border: 'none', fontSize: '1.25rem', color: '#64748b', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <p style={{ fontSize: '0.85rem', color: '#64748b', margin: '0 0 1.25rem' }}>
              Your session timed out. Sign in below to resume your download without losing your invoice corrections.
            </p>

            {inlineLoginError && (
              <div style={{ padding: '0.65rem 0.85rem', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', color: '#b91c1c', fontSize: '0.82rem', marginBottom: '1rem' }}>
                {inlineLoginError}
              </div>
            )}

            <form onSubmit={handleInlineLogin}>
              <div style={{ marginBottom: '0.85rem' }}>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#334155', marginBottom: '0.35rem' }}>
                  Username or Email
                </label>
                <input
                  type="text"
                  value={inlineLoginIdentifier}
                  onChange={(e) => setInlineLoginIdentifier(e.target.value)}
                  required
                  placeholder="Username or email"
                  style={{ width: '100%', padding: '0.55rem 0.75rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.9rem' }}
                />
              </div>

              <div style={{ marginBottom: '1.25rem' }}>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#334155', marginBottom: '0.35rem' }}>
                  Password
                </label>
                <input
                  type="password"
                  value={inlineLoginPassword}
                  onChange={(e) => setInlineLoginPassword(e.target.value)}
                  required
                  placeholder="Enter password"
                  style={{ width: '100%', padding: '0.55rem 0.75rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.9rem' }}
                />
              </div>

              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={() => setShowInlineLogin(false)}
                  style={{ padding: '0.5rem 1rem', background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '0.85rem', fontWeight: 600, color: '#475569', cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={inlineLoginLoading}
                  style={{ padding: '0.5rem 1.25rem', background: 'linear-gradient(135deg, var(--primary) 0%, var(--deep-purple) 100%)', border: 'none', borderRadius: '8px', fontSize: '0.85rem', fontWeight: 700, color: '#ffffff', cursor: inlineLoginLoading ? 'wait' : 'pointer' }}
                >
                  {inlineLoginLoading ? 'Signing In...' : 'Sign In & Download'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
