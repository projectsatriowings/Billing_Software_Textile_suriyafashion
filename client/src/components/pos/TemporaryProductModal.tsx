import React, { useState, useEffect, useRef } from 'react';

interface TemporaryProductRow {
  id: string;
  name: string;
  sellingPrice: string;
  quantity: string;
}

interface TemporaryProductModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddProducts: (
    supplierInvoiceNumber: string,
    products: Array<{ name: string; sellingPrice: number; quantity: number }>
  ) => void;
}

export function TemporaryProductModal({
  isOpen,
  onClose,
  onAddProducts,
}: TemporaryProductModalProps) {
  const [supplierInvoiceNumber, setSupplierInvoiceNumber] = useState<string>('');
  const [rows, setRows] = useState<TemporaryProductRow[]>([
    { id: '1', name: '', sellingPrice: '', quantity: '1' },
  ]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const invInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setSupplierInvoiceNumber('');
      setRows([{ id: String(Date.now()), name: '', sellingPrice: '', quantity: '1' }]);
      setErrorMessage(null);
      setTimeout(() => invInputRef.current?.focus(), 80);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleAddRow = () => {
    setRows((prev) => [
      ...prev,
      { id: String(Date.now() + Math.random()), name: '', sellingPrice: '', quantity: '1' },
    ]);
  };

  const handleRemoveRow = (id: string) => {
    if (rows.length === 1) {
      setRows([{ id: String(Date.now()), name: '', sellingPrice: '', quantity: '1' }]);
      return;
    }
    setRows((prev) => prev.filter((r) => r.id !== id));
  };

  const handleRowChange = (id: string, field: keyof TemporaryProductRow, val: string) => {
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, [field]: val } : r))
    );
    if (errorMessage) setErrorMessage(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanInv = supplierInvoiceNumber.trim().toUpperCase();
    if (!cleanInv) {
      setErrorMessage('Supplier Invoice Number is required.');
      invInputRef.current?.focus();
      return;
    }

    const validProducts: Array<{ name: string; sellingPrice: number; quantity: number }> = [];

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const cleanName = r.name.trim();
      const price = parseFloat(r.sellingPrice);
      const qty = parseFloat(r.quantity);

      if (!cleanName && !r.sellingPrice && rows.length > 1) {
        continue; // skip completely empty trailing row if multiple
      }

      if (!cleanName) {
        setErrorMessage(`Row ${i + 1}: Product name is required.`);
        return;
      }

      if (isNaN(price) || price < 0) {
        setErrorMessage(`Row ${i + 1} ("${cleanName}"): Please enter a valid selling price.`);
        return;
      }

      if (isNaN(qty) || qty <= 0) {
        setErrorMessage(`Row ${i + 1} ("${cleanName}"): Quantity must be at least 1.`);
        return;
      }

      validProducts.push({
        name: cleanName,
        sellingPrice: price,
        quantity: qty,
      });
    }

    if (validProducts.length === 0) {
      setErrorMessage('Please add at least one product row.');
      return;
    }

    onAddProducts(cleanInv, validProducts);
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99999,
        background: 'rgba(15, 23, 42, 0.65)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: '#ffffff',
          borderRadius: '16px',
          width: '100%',
          maxWidth: '680px',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '90vh',
          border: '1px solid #e2e8f0',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div
          style={{
            padding: '1.1rem 1.4rem',
            background: 'linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%)',
            borderBottom: '1.5px solid #fde68a',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '10px',
                background: '#fef3c7',
                border: '1.5px solid #f59e0b',
                color: '#b45309',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
                <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
                <line x1="12" y1="22.08" x2="12" y2="12"></line>
              </svg>
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: '1.12rem', fontWeight: 800, color: '#78350f' }}>
                Add Non-Inventory Product
              </h2>
              <p style={{ margin: 0, fontSize: '0.78rem', color: '#92400e', marginTop: '2px' }}>
                Sell supplier products immediately before stock is imported into inventory
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: '#92400e',
              fontSize: '1.4rem',
              lineHeight: 1,
              padding: '4px',
              borderRadius: '8px',
            }}
          >
            ✕
          </button>
        </div>

        {/* Modal Form */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
          <div style={{ padding: '1.25rem 1.4rem', overflowY: 'auto', flex: 1 }}>
            {/* Supplier Invoice Number */}
            <div style={{ marginBottom: '1.25rem' }}>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 700, color: '#1e293b', marginBottom: '6px' }}>
                Supplier Invoice Number <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <input
                ref={invInputRef}
                type="text"
                placeholder="e.g. INV-2026-105"
                value={supplierInvoiceNumber}
                onChange={(e) => {
                  setSupplierInvoiceNumber(e.target.value.toUpperCase());
                  if (errorMessage) setErrorMessage(null);
                }}
                required
                style={{
                  width: '100%',
                  padding: '0.65rem 0.85rem',
                  fontSize: '0.95rem',
                  fontFamily: 'monospace',
                  fontWeight: 700,
                  borderRadius: '10px',
                  border: '1.5px solid #cbd5e1',
                  background: '#f8fafc',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
              <span style={{ fontSize: '0.74rem', color: '#64748b', marginTop: '4px', display: 'block' }}>
                Reference ID used to automatically reconcile stock when supplier invoice is imported later
              </span>
            </div>

            {/* Error Message */}
            {errorMessage && (
              <div
                style={{
                  padding: '0.65rem 0.85rem',
                  borderRadius: '8px',
                  background: '#fef2f2',
                  border: '1px solid #fecaca',
                  color: '#b91c1c',
                  fontSize: '0.82rem',
                  fontWeight: 600,
                  marginBottom: '1rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                <span>⚠️</span>
                <span>{errorMessage}</span>
              </div>
            )}

            {/* Product Rows Table */}
            <div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 140px 100px 36px',
                  gap: '10px',
                  paddingBottom: '8px',
                  borderBottom: '1px solid #e2e8f0',
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  color: '#475569',
                  textTransform: 'uppercase',
                  letterSpacing: '0.03em',
                }}
              >
                <span>Product Name *</span>
                <span>Selling Price (₹) *</span>
                <span>Quantity *</span>
                <span></span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '10px' }}>
                {rows.map((row, idx) => (
                  <div
                    key={row.id}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 140px 100px 36px',
                      gap: '10px',
                      alignItems: 'center',
                    }}
                  >
                    <input
                      type="text"
                      placeholder={`e.g. ${idx === 0 ? "Men's Cotton Formal Shirt" : idx === 1 ? 'Floral Printed Kurti' : 'Boys Denim Shorts'}`}
                      value={row.name}
                      onChange={(e) => handleRowChange(row.id, 'name', e.target.value)}
                      required
                      style={{
                        padding: '0.55rem 0.75rem',
                        fontSize: '0.88rem',
                        fontWeight: 600,
                        borderRadius: '8px',
                        border: '1px solid #cbd5e1',
                        outline: 'none',
                        width: '100%',
                        boxSizing: 'border-box',
                      }}
                    />
                    <div style={{ position: 'relative' }}>
                      <span style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#64748b', fontWeight: 600, fontSize: '0.85rem' }}>
                        ₹
                      </span>
                      <input
                        type="number"
                        placeholder="0.00"
                        min="0"
                        step="0.01"
                        value={row.sellingPrice}
                        onChange={(e) => handleRowChange(row.id, 'sellingPrice', e.target.value)}
                        required
                        style={{
                          padding: '0.55rem 0.75rem 0.55rem 1.6rem',
                          fontSize: '0.88rem',
                          fontWeight: 700,
                          borderRadius: '8px',
                          border: '1px solid #cbd5e1',
                          outline: 'none',
                          width: '100%',
                          boxSizing: 'border-box',
                        }}
                      />
                    </div>
                    <input
                      type="number"
                      placeholder="1"
                      min="1"
                      step="1"
                      value={row.quantity}
                      onChange={(e) => handleRowChange(row.id, 'quantity', e.target.value)}
                      required
                      style={{
                        padding: '0.55rem 0.75rem',
                        fontSize: '0.88rem',
                        fontWeight: 700,
                        borderRadius: '8px',
                        border: '1px solid #cbd5e1',
                        outline: 'none',
                        textAlign: 'center',
                        width: '100%',
                        boxSizing: 'border-box',
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => handleRemoveRow(row.id)}
                      title="Remove row"
                      style={{
                        background: 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                        color: rows.length > 1 ? '#ef4444' : '#cbd5e1',
                        fontSize: '1.1rem',
                        padding: '4px',
                        borderRadius: '6px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                      disabled={rows.length <= 1}
                    >
                      🗑️
                    </button>
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={handleAddRow}
                style={{
                  marginTop: '12px',
                  background: '#f8fafc',
                  border: '1.5px dashed #cbd5e1',
                  borderRadius: '8px',
                  padding: '0.45rem 0.85rem',
                  fontSize: '0.82rem',
                  fontWeight: 700,
                  color: '#475569',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                + Add Another Product Row
              </button>
            </div>
          </div>

          {/* Modal Footer */}
          <div
            style={{
              padding: '0.9rem 1.4rem',
              background: '#f8fafc',
              borderTop: '1px solid #e2e8f0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              gap: '10px',
            }}
          >
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '0.6rem 1.1rem',
                fontSize: '0.85rem',
                fontWeight: 650,
                color: '#475569',
                background: '#ffffff',
                border: '1px solid #cbd5e1',
                borderRadius: '8px',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              style={{
                padding: '0.6rem 1.35rem',
                fontSize: '0.85rem',
                fontWeight: 750,
                color: '#ffffff',
                background: '#f59e0b',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                boxShadow: '0 2px 4px rgba(245, 158, 11, 0.3)',
              }}
            >
              <span>Finish & Add to Cart</span>
              <span>→</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
