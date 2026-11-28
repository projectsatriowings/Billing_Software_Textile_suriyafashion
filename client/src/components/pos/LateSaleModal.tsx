import React, { useState, useEffect } from 'react';
import { getClosedBusinessDates, type ClosedBusinessDate } from '../../api.ts';
import {
  ClockIcon,
  CheckCircle2Icon,
  AlertTriangleIcon,
  ReceiptIcon,
  BanknoteIcon,
  UserIcon,
  RotateCcwIcon,
  InfoIcon,
} from '../inventory/InventoryIcons.tsx';

export interface LateSaleModalProps {
  isOpen: boolean;
  onClose: () => void;
  onStartLateSale: (selectedDate: string, reason: string, closedDay: ClosedBusinessDate) => void;
  branchId?: string;
  formatRupees: (minor: number) => string;
  initialBusinessDate?: string;
}

export const LateSaleModal: React.FC<LateSaleModalProps> = ({
  isOpen,
  onClose,
  onStartLateSale,
  branchId,
  formatRupees,
  initialBusinessDate,
}) => {
  const [closedDates, setClosedDates] = useState<ClosedBusinessDate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedBdate, setSelectedBdate] = useState<string>(initialBusinessDate || '');
  const [reason, setReason] = useState('Customer purchase after day closing');

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    setError(null);
    getClosedBusinessDates(branchId)
      .then((res) => {
        const dates = res.closedDates || [];
        setClosedDates(dates);
        if (initialBusinessDate && dates.some((d) => d.bdate === initialBusinessDate)) {
          setSelectedBdate(initialBusinessDate);
        } else if (dates.length > 0 && !selectedBdate) {
          setSelectedBdate(dates[0].bdate);
        }
      })
      .catch((err) => {
        setError(err.message || 'Failed to load closed business dates');
      })
      .finally(() => {
        setLoading(false);
      });
  }, [isOpen, branchId, initialBusinessDate]);

  if (!isOpen) return null;

  const selectedClosedDay = closedDates.find((d) => d.bdate === selectedBdate);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBdate) {
      setError('Please select a closed business date.');
      return;
    }
    if (!selectedClosedDay) {
      setError('Selected business date details not found.');
      return;
    }
    onStartLateSale(selectedBdate, reason.trim() || 'Customer purchase after closing', selectedClosedDay);
  };

  const formatDateDisplay = (dateStr: string) => {
    try {
      const [y, m, d] = dateStr.split('-');
      const dateObj = new Date(Number(y), Number(m) - 1, Number(d));
      return dateObj.toLocaleDateString('en-IN', {
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return dateStr;
    }
  };

  const todayStr = new Date().toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  return (
    <div
      className="modal-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.7)',
        backdropFilter: 'blur(4px)',
        zIndex: 9999,
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
        className="bento-card-3d"
        style={{
          width: '100%',
          maxWidth: '680px',
          maxHeight: '92vh',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: '#ffffff',
          borderRadius: '16px',
          overflow: 'hidden',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
          border: '1px solid #e2e8f0',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: '1.25rem 1.5rem',
            background: 'linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)',
            borderBottom: '1px solid #fcd34d',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div
              style={{
                width: '42px',
                height: '42px',
                borderRadius: '10px',
                backgroundColor: '#ffffff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#b45309',
                boxShadow: '0 2px 8px rgba(180, 83, 9, 0.15)',
              }}
            >
              <ClockIcon size={24} />
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: '#92400e', letterSpacing: '-0.02em' }}>
                Late Sale Entry (Post-Day-Close)
              </h2>
              <p style={{ margin: '2px 0 0', fontSize: '0.82rem', color: '#b45309' }}>
                Enter sales for a previously closed business date after daily shutter close
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: '#ffffff',
              border: '1px solid #fcd34d',
              borderRadius: '8px',
              padding: '6px 10px',
              cursor: 'pointer',
              fontWeight: 700,
              fontSize: '0.85rem',
              color: '#92400e',
            }}
          >
            ✕
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} style={{ overflowY: 'auto', padding: '1.25rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {/* Informational Guidance Box */}
          
          {error && (
            <div
              style={{
                backgroundColor: '#fee2e2',
                border: '1px solid #fca5a5',
                borderRadius: '8px',
                padding: '0.75rem 1rem',
                color: '#991b1b',
                fontSize: '0.85rem',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <AlertTriangleIcon size={16} />
              <span>{error}</span>
            </div>
          )}

          {/* Section 1: Choose Closed Date */}
          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 700, color: '#1e293b', marginBottom: '6px' }}>
              Select Closed Business Date:
            </label>

            {loading ? (
              <div style={{ padding: '1.5rem', textAlign: 'center', color: '#64748b', fontSize: '0.9rem' }}>
                Loading closed business dates...
              </div>
            ) : closedDates.length === 0 ? (
              <div
                style={{
                  padding: '1.5rem',
                  textAlign: 'center',
                  backgroundColor: '#f8fafc',
                  border: '1px dashed #cbd5e1',
                  borderRadius: '10px',
                  color: '#64748b',
                  fontSize: '0.85rem',
                }}
              >
                No completed Day Close records found. Late Sale Entry is only available for dates that have already completed Day Close.
              </div>
            ) : (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                  gap: '0.75rem',
                  maxHeight: '260px',
                  overflowY: 'auto',
                  padding: '2px',
                }}
              >
                {closedDates.map((day) => {
                  const isSelected = selectedBdate === day.bdate;
                  return (
                    <div
                      key={day.dayClosingId || day.bdate}
                      onClick={() => setSelectedBdate(day.bdate)}
                      style={{
                        cursor: 'pointer',
                        padding: '0.85rem 1rem',
                        borderRadius: '10px',
                        border: isSelected ? '2px solid #f59e0b' : '1px solid #e2e8f0',
                        backgroundColor: isSelected ? '#fffbeb' : '#ffffff',
                        boxShadow: isSelected ? '0 4px 12px rgba(245, 158, 11, 0.15)' : 'none',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                        <span style={{ fontWeight: 800, fontSize: '0.95rem', color: isSelected ? '#92400e' : '#1e293b' }}>
                          {formatDateDisplay(day.bdate)}
                        </span>
                        {isSelected && (
                          <span
                            style={{
                              backgroundColor: '#f59e0b',
                              color: '#ffffff',
                              padding: '2px 8px',
                              borderRadius: '12px',
                              fontSize: '0.7rem',
                              fontWeight: 700,
                            }}
                          >
                            Selected
                          </span>
                        )}
                      </div>

                      <div style={{ fontSize: '0.78rem', color: '#64748b', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                        <div>
                          <strong>Closed by:</strong> {day.closedByName || 'Store Manager'}
                        </div>
                        <div>
                          <strong>Original Gross Sales:</strong> {formatRupees(day.originalSalesTotalMinor)} ({day.invoicesCount} bills)
                        </div>
                        <div>
                          <strong>Closing Cash Sealed:</strong> {formatRupees(day.originalCashMinor)}
                        </div>
                        {day.lateSalesCount > 0 && (
                          <div style={{ color: '#b45309', fontWeight: 600, marginTop: '2px' }}>
                            {day.lateSalesCount} late sale(s) already logged ({formatRupees(day.lateSalesTotalMinor)})
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Section 2: Reason for Late Sale */}
          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 700, color: '#1e293b', marginBottom: '6px' }}>
              Reason / Audit Note:
            </label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Regular customer arrived after closing, paid cash"
              style={{
                width: '100%',
                padding: '0.65rem 0.85rem',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                fontSize: '0.9rem',
                outline: 'none',
              }}
              required
            />
            <span style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '4px', display: 'block' }}>
              This note will be attached to the invoice and displayed in the Day Close late sales reconciliation report.
            </span>
          </div>

          {/* Action Footer */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: '0.75rem',
              paddingTop: '1rem',
              borderTop: '1px solid #e2e8f0',
              marginTop: '0.5rem',
            }}
          >
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '0.65rem 1.25rem',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                backgroundColor: '#ffffff',
                color: '#475569',
                fontWeight: 600,
                fontSize: '0.88rem',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !selectedBdate}
              style={{
                padding: '0.65rem 1.5rem',
                borderRadius: '8px',
                border: 'none',
                backgroundColor: loading || !selectedBdate ? '#cbd5e1' : '#d97706',
                color: '#ffffff',
                fontWeight: 700,
                fontSize: '0.88rem',
                cursor: loading || !selectedBdate ? 'not-allowed' : 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                boxShadow: '0 4px 12px rgba(217, 119, 6, 0.25)',
              }}
            >
              <ClockIcon size={16} />
              <span>Start Late Sale Entry</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
