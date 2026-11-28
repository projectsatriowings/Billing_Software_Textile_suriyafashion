import React from 'react';
import {
  ClockIcon,
  CheckCircle2Icon,
  AlertTriangleIcon,
  ReceiptIcon,
  BanknoteIcon,
  UserIcon,
  PhoneIcon,
  ShoppingCartIcon,
  LayersIcon,
} from '../inventory/InventoryIcons.tsx';

export interface LateSaleConfirmItem {
  name: string;
  variantSize?: string | null;
  variantColour?: string | null;
  qty: number;
  priceMinor: number;
  totalMinor: number;
}

export interface LateSaleConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  isSaving: boolean;
  businessDate: string;
  reason: string;
  customerName?: string | null;
  customerPhone?: string | null;
  items: LateSaleConfirmItem[];
  totalMinor?: number;
  totalAmountMinor?: number;
  paymentMethod?: string;
  cashReceivedMinor?: number;
  changeReturnedMinor?: number;
  formatRupees?: (minor: number) => string;
}

export const LateSaleConfirmModal: React.FC<LateSaleConfirmModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  isSaving,
  businessDate,
  reason,
  customerName,
  customerPhone,
  items,
  totalMinor,
  totalAmountMinor,
  paymentMethod = 'cash',
  cashReceivedMinor,
  changeReturnedMinor,
  formatRupees = (m: number) => `₹${(m / 100).toFixed(2)}`,
}) => {
  if (!isOpen) return null;

  const resolvedTotalMinor = totalMinor ?? totalAmountMinor ?? 0;

  const entryDateTimeStr = new Date().toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Kolkata',
  });

  return (
    <div
      className="modal-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.75)',
        backdropFilter: 'blur(5px)',
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSaving) onClose();
      }}
    >
      <div
        className="bento-card-3d"
        style={{
          width: '100%',
          maxWidth: '620px',
          maxHeight: '94vh',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: '#ffffff',
          borderRadius: '16px',
          overflow: 'hidden',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.3)',
          border: '1px solid #fcd34d',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: '1.25rem 1.5rem',
            background: 'linear-gradient(135deg, #b45309 0%, #d97706 100%)',
            color: '#ffffff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div
              style={{
                width: '40px',
                height: '40px',
                borderRadius: '10px',
                backgroundColor: 'rgba(255, 255, 255, 0.2)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#ffffff',
              }}
            >
              <ClockIcon size={22} />
            </div>
            <div>
              <div style={{ fontSize: '0.72rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#fef3c7' }}>
                AUDIT VERIFICATION
              </div>
              <h2 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800 }}>
                Confirm Late Sale Entry
              </h2>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            style={{
              background: 'rgba(255, 255, 255, 0.2)',
              border: 'none',
              borderRadius: '8px',
              padding: '6px 10px',
              cursor: isSaving ? 'not-allowed' : 'pointer',
              color: '#ffffff',
              fontWeight: 700,
            }}
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div style={{ overflowY: 'auto', padding: '1.25rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {/* Key Dates Badge Deck */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '0.75rem',
            }}
          >
            <div
              style={{
                backgroundColor: '#fffbeb',
                border: '1px solid #fde68a',
                borderRadius: '10px',
                padding: '0.75rem 1rem',
              }}
            >
              <div style={{ fontSize: '0.72rem', fontWeight: 800, color: '#92400e', textTransform: 'uppercase' }}>
                Business Date (Attributed)
              </div>
              <div style={{ fontSize: '1.15rem', fontWeight: 800, color: '#b45309', marginTop: '2px' }}>
                 {businessDate}
              </div>
              <div style={{ fontSize: '0.7rem', color: '#78350f', marginTop: '2px' }}>
                Included in this closed date's sales
              </div>
            </div>

            <div
              style={{
                backgroundColor: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: '10px',
                padding: '0.75rem 1rem',
              }}
            >
              <div style={{ fontSize: '0.72rem', fontWeight: 800, color: '#475569', textTransform: 'uppercase' }}>
                Actual Entry Time (Audit)
              </div>
              <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#0f172a', marginTop: '4px' }}>
                {entryDateTimeStr}
              </div>
              <div style={{ fontSize: '0.7rem', color: '#64748b', marginTop: '2px' }}>
                Preserved unmodified for audit log
              </div>
            </div>
          </div>

          {/* Reason Callout */}
          <div
            style={{
              backgroundColor: '#fdf4ff',
              border: '1px solid #f5d0fe',
              borderRadius: '8px',
              padding: '0.65rem 0.9rem',
              fontSize: '0.82rem',
              color: '#86198f',
              display: 'flex',
              gap: '6px',
            }}
          >
            <strong>Note / Reason:</strong>
            <span>{reason || 'Post-day-close customer purchase'}</span>
          </div>

          {/* Customer Info */}
          {(customerName || customerPhone) && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '1rem',
                padding: '0.65rem 0.9rem',
                backgroundColor: '#f1f5f9',
                borderRadius: '8px',
                fontSize: '0.85rem',
                color: '#334155',
              }}
            >
              <UserIcon size={16} style={{ color: '#0f766e' }} />
              <div>
                <strong>Customer:</strong> {customerName || 'Walk-in Customer'}
                {customerPhone && <span style={{ marginLeft: '8px', color: '#64748b' }}>({customerPhone})</span>}
              </div>
            </div>
          )}

          {/* Products Summary */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase' }}>
                Purchased Items &amp; Textile Variants ({items.length})
              </span>
              <span style={{ fontSize: '0.75rem', color: '#059669', fontWeight: 600 }}>
                ✓ Stocks will be deducted
              </span>
            </div>

            <div
              style={{
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                maxHeight: '160px',
                overflowY: 'auto',
                backgroundColor: '#ffffff',
              }}
            >
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#64748b', textAlign: 'left' }}>
                    <th style={{ padding: '6px 10px', fontWeight: 600 }}>Product / Variant</th>
                    <th style={{ padding: '6px 10px', fontWeight: 600, textAlign: 'center' }}>Qty</th>
                    <th style={{ padding: '6px 10px', fontWeight: 600, textAlign: 'right' }}>Price</th>
                    <th style={{ padding: '6px 10px', fontWeight: 600, textAlign: 'right' }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, idx) => (
                    <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '6px 10px', color: '#1e293b' }}>
                        <div style={{ fontWeight: 600 }}>{it.name}</div>
                        {(it.variantSize || it.variantColour) && (
                          <div style={{ fontSize: '0.72rem', color: '#d97706', fontWeight: 600 }}>
                            Size: {it.variantSize || '—'}{it.variantColour ? ` | Colour: ${it.variantColour}` : ''}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '6px 10px', textAlign: 'center', fontWeight: 600 }}>{it.qty}</td>
                      <td style={{ padding: '6px 10px', textAlign: 'right', color: '#64748b' }}>{formatRupees(it.priceMinor)}</td>
                      <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 700, color: '#0f172a' }}>{formatRupees(it.totalMinor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Payment Details */}
          <div
            style={{
              padding: '0.85rem 1rem',
              backgroundColor: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: '10px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <div>
              <div style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 700 }}>
                Payment Method
              </div>
              <div style={{ fontSize: '0.95rem', fontWeight: 800, color: '#1e293b', textTransform: 'uppercase', marginTop: '2px' }}>
                {paymentMethod === 'cash' ? ' Cash Collected Manually' : paymentMethod === 'upi' ? '📱 UPI / QR Transfer' : paymentMethod}
              </div>
              {paymentMethod === 'cash' && cashReceivedMinor && cashReceivedMinor > 0 ? (
                <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '2px' }}>
                  Received: {formatRupees(cashReceivedMinor)} | Change: {formatRupees(changeReturnedMinor || 0)}
                </div>
              ) : null}
            </div>

            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 700 }}>
                Total Bill Amount
              </div>
              <div style={{ fontSize: '1.4rem', fontWeight: 900, color: '#b45309' }}>
                {formatRupees(resolvedTotalMinor)}
              </div>
            </div>
          </div>

          {/* Audit & Compliance Disclaimer */}
          <div
            style={{
              fontSize: '0.74rem',
              color: '#64748b',
              lineHeight: 1.4,
              borderLeft: '3px solid #d97706',
              paddingLeft: '8px',
            }}
          >
            🔒 <strong>Audit Record Notice:</strong> Original Day Close totals remain preserved. This late sale will appear separately in the previous day's sales register and Day Close Late Sales Reconciliation. Stock deduction is executed immediately.
          </div>
        </div>

        {/* Footer Buttons */}
        <div
          style={{
            padding: '1rem 1.5rem',
            borderTop: '1px solid #e2e8f0',
            backgroundColor: '#ffffff',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '0.75rem',
          }}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            style={{
              padding: '0.65rem 1.25rem',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              backgroundColor: '#ffffff',
              color: '#475569',
              fontWeight: 600,
              fontSize: '0.88rem',
              cursor: isSaving ? 'not-allowed' : 'pointer',
            }}
          >
            Back to Edit Cart
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isSaving}
            style={{
              padding: '0.65rem 1.5rem',
              borderRadius: '8px',
              border: 'none',
              backgroundColor: isSaving ? '#cbd5e1' : '#d97706',
              color: '#ffffff',
              fontWeight: 800,
              fontSize: '0.9rem',
              cursor: isSaving ? 'not-allowed' : 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              boxShadow: '0 4px 12px rgba(217, 119, 6, 0.3)',
            }}
          >
            <CheckCircle2Icon size={16} />
            <span>{isSaving ? 'Issuing Bill...' : 'Confirm & Issue Late Bill'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
