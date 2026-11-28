import React, { useState, useEffect, useRef } from 'react';
import { getClosedBusinessDates, getClosedDateDetail, type ClosedBusinessDate } from '../../api.ts';
import {
  ClockIcon,
  CheckCircle2Icon,
  AlertTriangleIcon,
  ReceiptIcon,
  BanknoteIcon,
  UserIcon,
  InfoIcon,
  CalendarIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronDownIcon,
  RupeeIcon,
  WalletIcon,
} from '../inventory/InventoryIcons.tsx';

export interface LateSaleModalProps {
  isOpen: boolean;
  onClose: () => void;
  onStartLateSale: (selectedDate: string, reason: string, closedDay: ClosedBusinessDate) => void;
  branchId?: string;
  formatRupees: (minor: number) => string;
  initialBusinessDate?: string;
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const WEEKDAY_NAMES = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

export const LateSaleModal: React.FC<LateSaleModalProps> = ({
  isOpen,
  onClose,
  onStartLateSale,
  branchId,
  formatRupees,
  initialBusinessDate,
}) => {
  const [closedDatesList, setClosedDatesList] = useState<ClosedBusinessDate[]>([]);
  const [loadingDates, setLoadingDates] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Selected Date State
  const [selectedBdate, setSelectedBdate] = useState<string>(initialBusinessDate || '');
  const [selectedDetail, setSelectedDetail] = useState<ClosedBusinessDate | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  // Calendar Popover State
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const calendarRef = useRef<HTMLDivElement>(null);

  // Month navigation in calendar
  const today = new Date();
  const [viewYear, setViewYear] = useState<number>(today.getFullYear());
  const [viewMonth, setViewMonth] = useState<number>(today.getMonth()); // 0-indexed

  // Audit Reason
  const [reason, setReason] = useState('Customer purchase after day closing');

  // Load list of closed dates on modal open
  useEffect(() => {
    if (!isOpen) {
      setIsCalendarOpen(false);
      return;
    }

    setLoadingDates(true);
    setError(null);

    getClosedBusinessDates(branchId)
      .then((res) => {
        const dates = res.closedDates || [];
        setClosedDatesList(dates);

        // If an initial business date was passed, or if one was already selected
        const targetDate = initialBusinessDate || selectedBdate;
        if (targetDate && dates.some((d) => d.bdate === targetDate)) {
          setSelectedBdate(targetDate);
          fetchDateDetail(targetDate);
          // Set calendar month view to match target date
          const [y, m] = targetDate.split('-');
          if (y && m) {
            setViewYear(Number(y));
            setViewMonth(Number(m) - 1);
          }
        }
      })
      .catch((err) => {
        setError(err.message || 'Failed to load closed business dates');
      })
      .finally(() => {
        setLoadingDates(false);
      });
  }, [isOpen, branchId, initialBusinessDate]);

  // Click outside listener for the calendar popover
  useEffect(() => {
    const handleDocumentClick = (e: MouseEvent) => {
      if (calendarRef.current && !calendarRef.current.contains(e.target as Node)) {
        setIsCalendarOpen(false);
      }
    };
    if (isCalendarOpen) {
      document.addEventListener('mousedown', handleDocumentClick);
    }
    return () => {
      document.removeEventListener('mousedown', handleDocumentClick);
    };
  }, [isCalendarOpen]);

  // Fetch complete details only when user selects a date
  const fetchDateDetail = async (dateStr: string) => {
    if (!dateStr) {
      setSelectedDetail(null);
      return;
    }
    setDetailLoading(true);
    setDetailError(null);
    try {
      const res = await getClosedDateDetail(dateStr, branchId);
      if (res.detail) {
        setSelectedDetail(res.detail);
      } else {
        // Fallback to brief data if available in closedDatesList
        const fallback = closedDatesList.find((d) => d.bdate === dateStr);
        setSelectedDetail(fallback || null);
      }
    } catch (err: any) {
      const fallback = closedDatesList.find((d) => d.bdate === dateStr);
      if (fallback) {
        setSelectedDetail(fallback);
      } else {
        setDetailError(err.message || 'Failed to fetch Day Close audit details');
      }
    } finally {
      setDetailLoading(false);
    }
  };

  if (!isOpen) return null;

  const closedDatesSet = new Set(closedDatesList.map((d) => d.bdate));

  const handleSelectDate = (dateStr: string) => {
    setSelectedBdate(dateStr);
    setIsCalendarOpen(false);
    fetchDateDetail(dateStr);
  };

  const handlePrevMonth = () => {
    if (viewMonth === 0) {
      setViewYear(viewYear - 1);
      setViewMonth(11);
    } else {
      setViewMonth(viewMonth - 1);
    }
  };

  const handleNextMonth = () => {
    if (viewMonth === 11) {
      setViewYear(viewYear + 1);
      setViewMonth(0);
    } else {
      setViewMonth(viewMonth + 1);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBdate) {
      setError('Please select a closed business date.');
      return;
    }
    if (!selectedDetail) {
      setError('Selected business date details not found.');
      return;
    }
    onStartLateSale(selectedBdate, reason.trim() || 'Customer purchase after closing', selectedDetail);
  };

  // Format date helper: "Friday, 27 Nov 2026"
  const formatWeekdayDate = (dateStr: string) => {
    try {
      const [y, m, d] = dateStr.split('-');
      const dateObj = new Date(Number(y), Number(m) - 1, Number(d));
      return dateObj.toLocaleDateString('en-IN', {
        weekday: 'long',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return dateStr;
    }
  };

  // Format short date helper: "27 Nov 2026"
  const formatDateShort = (dateStr: string) => {
    try {
      const [y, m, d] = dateStr.split('-');
      const dateObj = new Date(Number(y), Number(m) - 1, Number(d));
      return dateObj.toLocaleDateString('en-IN', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return dateStr;
    }
  };

  // Format time helper
  const formatTime = (isoOrDateStr?: string) => {
    if (!isoOrDateStr) return '';
    try {
      return new Date(isoOrDateStr).toLocaleTimeString('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      });
    } catch {
      return '';
    }
  };

  // Calendar calculation
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstDayIndex = new Date(viewYear, viewMonth, 1).getDay();

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
          maxWidth: '720px',
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
              <h2 style={{ margin: 0, fontSize: '1.22rem', fontWeight: 800, color: '#92400e', letterSpacing: '-0.02em' }}>
                Late Sale Entry (Post-Day-Close)
              </h2>
              <p style={{ margin: '2px 0 0', fontSize: '0.82rem', color: '#b45309' }}>
                Select a closed business date to review Day Close audit figures and log post-closing sales
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

        {/* Modal Form Body */}
        <form
          onSubmit={handleSubmit}
          style={{
            overflowY: 'auto',
            padding: '1.25rem 1.5rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '1.25rem',
          }}
        >
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

          {/* Section 1: Compact Calendar Date Selector */}
          <div style={{ position: 'relative' }} ref={calendarRef}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <label style={{ fontSize: '0.86rem', fontWeight: 700, color: '#1e293b' }}>
                Select Closed Business Date:
              </label>
              {closedDatesList.length > 0 && (
                <span style={{ fontSize: '0.78rem', color: '#64748b' }}>
                  {closedDatesList.length} closed date(s) recorded
                </span>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
              {/* Compact Calendar Icon Button */}
              <button
                type="button"
                onClick={() => setIsCalendarOpen(!isCalendarOpen)}
                disabled={loadingDates}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '0.65rem 1.15rem',
                  backgroundColor: selectedBdate ? '#fffbeb' : '#ffffff',
                  border: selectedBdate ? '2px solid #d97706' : '1px solid #cbd5e1',
                  borderRadius: '10px',
                  color: selectedBdate ? '#92400e' : '#334155',
                  fontWeight: 700,
                  fontSize: '0.9rem',
                  cursor: loadingDates ? 'wait' : 'pointer',
                  boxShadow: selectedBdate ? '0 2px 8px rgba(217, 119, 6, 0.15)' : '0 1px 3px rgba(0, 0, 0, 0.05)',
                  transition: 'all 0.15s ease',
                }}
              >
                <CalendarIcon size={18} style={{ color: selectedBdate ? '#d97706' : '#64748b' }} />
                <span>
                  {loadingDates
                    ? 'Loading closed dates...'
                    : selectedBdate
                    ? formatDateShort(selectedBdate)
                    : 'Select Closed Date'}
                </span>
                <ChevronDownIcon
                  size={16}
                  style={{
                    transform: isCalendarOpen ? 'rotate(180deg)' : 'none',
                    transition: 'transform 0.2s ease',
                    color: selectedBdate ? '#d97706' : '#64748b',
                  }}
                />
              </button>

              {selectedBdate && (
                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '4px 10px',
                    backgroundColor: '#f0fdf4',
                    border: '1px solid #bbf7d0',
                    borderRadius: '20px',
                    fontSize: '0.78rem',
                    color: '#15803d',
                    fontWeight: 600,
                  }}
                >
                  <CheckCircle2Icon size={14} />
                  <span>Closed Day Selected: {selectedBdate}</span>
                </div>
              )}
            </div>

            {/* Calendar Popover Picker */}
            {isCalendarOpen && (
              <div
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 8px)',
                  left: 0,
                  zIndex: 200,
                  width: '320px',
                  backgroundColor: '#ffffff',
                  borderRadius: '14px',
                  border: '1px solid #e2e8f0',
                  boxShadow: '0 16px 36px -4px rgba(0, 0, 0, 0.2), 0 6px 16px -2px rgba(0, 0, 0, 0.1)',
                  padding: '1rem',
                  animation: 'fadeIn 0.15s ease',
                }}
              >
                {/* Month & Year Navigation Header */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: '12px',
                    paddingBottom: '8px',
                    borderBottom: '1px solid #f1f5f9',
                  }}
                >
                  <button
                    type="button"
                    onClick={handlePrevMonth}
                    style={{
                      background: '#f8fafc',
                      border: '1px solid #e2e8f0',
                      borderRadius: '8px',
                      padding: '4px 8px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      color: '#475569',
                    }}
                    title="Previous Month"
                  >
                    <ChevronLeftIcon size={16} />
                  </button>

                  <div style={{ fontWeight: 800, fontSize: '0.92rem', color: '#0f172a' }}>
                    {MONTH_NAMES[viewMonth]} {viewYear}
                  </div>

                  <button
                    type="button"
                    onClick={handleNextMonth}
                    style={{
                      background: '#f8fafc',
                      border: '1px solid #e2e8f0',
                      borderRadius: '8px',
                      padding: '4px 8px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      color: '#475569',
                    }}
                    title="Next Month"
                  >
                    <ChevronRightIcon size={16} />
                  </button>
                </div>

                {/* Weekday Names Header */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(7, 1fr)',
                    textAlign: 'center',
                    marginBottom: '6px',
                  }}
                >
                  {WEEKDAY_NAMES.map((name, i) => (
                    <div
                      key={name}
                      style={{
                        fontSize: '0.72rem',
                        fontWeight: 700,
                        color: i === 0 ? '#ef4444' : '#64748b',
                        padding: '2px 0',
                      }}
                    >
                      {name}
                    </div>
                  ))}
                </div>

                {/* Calendar Days Grid */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(7, 1fr)',
                    gap: '3px',
                  }}
                >
                  {/* Empty slots before first day */}
                  {Array.from({ length: firstDayIndex }).map((_, i) => (
                    <div key={`empty-${i}`} style={{ height: '36px' }} />
                  ))}

                  {/* Month Days */}
                  {Array.from({ length: daysInMonth }).map((_, i) => {
                    const dayNum = i + 1;
                    const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
                    const dateStr = `${viewYear}-${pad(viewMonth + 1)}-${pad(dayNum)}`;
                    const isClosed = closedDatesSet.has(dateStr);
                    const isSelected = selectedBdate === dateStr;

                    return (
                      <button
                        key={dateStr}
                        type="button"
                        disabled={!isClosed}
                        onClick={() => handleSelectDate(dateStr)}
                        style={{
                          height: '38px',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          justifyContent: 'center',
                          borderRadius: '8px',
                          border: isSelected
                            ? '1.5px solid #d97706'
                            : isClosed
                            ? '1px solid #fef3c7'
                            : '1px solid transparent',
                          backgroundColor: isSelected
                            ? '#d97706'
                            : isClosed
                            ? '#fefce8'
                            : 'transparent',
                          color: isSelected
                            ? '#ffffff'
                            : isClosed
                            ? '#0f172a'
                            : '#cbd5e1',
                          fontWeight: isSelected ? 800 : isClosed ? 600 : 400,
                          fontSize: '0.82rem',
                          cursor: isClosed ? 'pointer' : 'not-allowed',
                          opacity: isClosed ? 1 : 0.35,
                          transition: 'all 0.1s ease',
                          padding: '2px',
                        }}
                        title={isClosed ? `Day Close Completed on ${dateStr}` : `No Day Close on ${dateStr}`}
                      >
                        <span>{dayNum}</span>
                        {/* Dot indicator for dates that have completed Day Close */}
                        {isClosed && (
                          <span
                            style={{
                              width: '4px',
                              height: '4px',
                              borderRadius: '50%',
                              backgroundColor: isSelected ? '#ffffff' : '#d97706',
                              marginTop: '2px',
                            }}
                          />
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* Calendar Legend / Helper */}
                <div
                  style={{
                    marginTop: '12px',
                    paddingTop: '8px',
                    borderTop: '1px solid #f1f5f9',
                    fontSize: '0.72rem',
                    color: '#64748b',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <span
                      style={{
                        width: '6px',
                        height: '6px',
                        borderRadius: '50%',
                        backgroundColor: '#d97706',
                        display: 'inline-block',
                      }}
                    />
                    <span>Closed Date (Ready for late sale)</span>
                  </div>
                  <span>Use &lt; &gt; for older months</span>
                </div>
              </div>
            )}
          </div>

          {/* Section 2: Selected Date Details Panel */}
          {detailLoading ? (
            <div
              style={{
                padding: '2.5rem 1.5rem',
                textAlign: 'center',
                backgroundColor: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: '12px',
                color: '#64748b',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <div
                style={{
                  width: '28px',
                  height: '28px',
                  border: '3px solid #cbd5e1',
                  borderTopColor: '#d97706',
                  borderRadius: '50%',
                  animation: 'spin 0.8s linear infinite',
                }}
              />
              <span style={{ fontSize: '0.88rem', fontWeight: 600 }}>
                Loading Day Close details for {selectedBdate}...
              </span>
            </div>
          ) : !selectedBdate ? (
            /* Empty State when no date selected yet */
            <div
              style={{
                padding: '2.5rem 1.5rem',
                textAlign: 'center',
                backgroundColor: '#f8fafc',
                border: '1.5px dashed #cbd5e1',
                borderRadius: '12px',
                color: '#64748b',
              }}
            >
              <div
                style={{
                  width: '48px',
                  height: '48px',
                  borderRadius: '12px',
                  backgroundColor: '#f1f5f9',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#94a3b8',
                  marginBottom: '10px',
                }}
              >
                <CalendarIcon size={24} />
              </div>
              <h3 style={{ margin: 0, fontSize: '0.96rem', fontWeight: 700, color: '#334155' }}>
                No Business Date Selected
              </h3>
              <p style={{ margin: '6px 0 0', fontSize: '0.82rem', color: '#64748b', maxWidth: '380px', marginInline: 'auto' }}>
                Click the <strong>Select Closed Date</strong> button above to pick a closed business date from the calendar and inspect Day Close figures.
              </p>
            </div>
          ) : detailError || !selectedDetail ? (
            /* Empty state when no Day Close found for date */
            <div
              style={{
                padding: '1.75rem',
                textAlign: 'center',
                backgroundColor: '#fef2f2',
                border: '1px solid #fca5a5',
                borderRadius: '12px',
                color: '#991b1b',
              }}
            >
              <AlertTriangleIcon size={24} style={{ marginBottom: '6px' }} />
              <div style={{ fontWeight: 700, fontSize: '0.92rem' }}>No Day Close Record Found</div>
              <div style={{ fontSize: '0.82rem', marginTop: '4px' }}>
                {detailError || `There is no completed Day Close record for ${selectedBdate}.`}
              </div>
            </div>
          ) : (
            /* Complete Spacious Day Close Panel */
            <div
              style={{
                backgroundColor: '#ffffff',
                border: '1.5px solid #e2e8f0',
                borderRadius: '14px',
                padding: '1.25rem 1.4rem',
                boxShadow: '0 4px 14px rgba(0, 0, 0, 0.04)',
                display: 'flex',
                flexDirection: 'column',
                gap: '1rem',
              }}
            >
              {/* Day Close Panel Header */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  paddingBottom: '0.85rem',
                  borderBottom: '1px solid #f1f5f9',
                  flexWrap: 'wrap',
                  gap: '8px',
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: '#0f172a' }}>
                      {formatWeekdayDate(selectedDetail.bdate)}
                    </h3>
                    <span
                      style={{
                        backgroundColor: '#dcfce7',
                        color: '#15803d',
                        border: '1px solid #86efac',
                        padding: '2px 8px',
                        borderRadius: '12px',
                        fontSize: '0.72rem',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                      }}
                    >
                      <CheckCircle2Icon size={12} />
                      {selectedDetail.status || 'CLOSED'}
                    </span>
                  </div>
                  <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: '3px' }}>
                    Business Date ID: <strong>{selectedDetail.bdate}</strong>
                    {selectedDetail.closedAt && (
                      <span style={{ marginLeft: '10px' }}>
                        Sealed at: <strong>{formatTime(selectedDetail.closedAt)}</strong>
                      </span>
                    )}
                  </div>
                </div>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    fontSize: '0.82rem',
                    color: '#334155',
                    backgroundColor: '#f8fafc',
                    padding: '4px 10px',
                    borderRadius: '8px',
                    border: '1px solid #e2e8f0',
                  }}
                >
                  <UserIcon size={15} style={{ color: '#64748b' }} />
                  <span>
                    Closed by: <strong>{selectedDetail.closedByName || 'Store Manager'}</strong>
                  </span>
                </div>
              </div>

              {/* Day Close Key Metrics Grid */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                  gap: '0.75rem',
                }}
              >
                {/* 1. Original Gross Sales */}
                <div
                  style={{
                    backgroundColor: '#f8fafc',
                    padding: '0.75rem 0.9rem',
                    borderRadius: '10px',
                    border: '1px solid #e2e8f0',
                  }}
                >
                  <div style={{ fontSize: '0.74rem', color: '#64748b', fontWeight: 600 }}>
                    Original Gross Sales
                  </div>
                  <div style={{ fontSize: '1.05rem', fontWeight: 800, color: '#0f172a', marginTop: '2px' }}>
                    {formatRupees(selectedDetail.originalSalesTotalMinor)}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '2px' }}>
                    Total {selectedDetail.invoicesCount} invoices
                  </div>
                </div>

                {/* 2. Cash Sales */}
                <div
                  style={{
                    backgroundColor: '#f8fafc',
                    padding: '0.75rem 0.9rem',
                    borderRadius: '10px',
                    border: '1px solid #e2e8f0',
                  }}
                >
                  <div style={{ fontSize: '0.74rem', color: '#64748b', fontWeight: 600 }}>
                    Cash Sales
                  </div>
                  <div style={{ fontSize: '1.05rem', fontWeight: 800, color: '#16a34a', marginTop: '2px' }}>
                    {formatRupees(selectedDetail.cashSalesMinor || 0)}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '2px' }}>
                    Direct cash collected
                  </div>
                </div>

                {/* 3. UPI Sales */}
                <div
                  style={{
                    backgroundColor: '#f8fafc',
                    padding: '0.75rem 0.9rem',
                    borderRadius: '10px',
                    border: '1px solid #e2e8f0',
                  }}
                >
                  <div style={{ fontSize: '0.74rem', color: '#64748b', fontWeight: 600 }}>
                    UPI Sales
                  </div>
                  <div style={{ fontSize: '1.05rem', fontWeight: 800, color: '#2563eb', marginTop: '2px' }}>
                    {formatRupees(selectedDetail.upiSalesMinor || 0)}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '2px' }}>
                    Digital UPI collections
                  </div>
                </div>

                {/* 4. Cash Expenses */}
                <div
                  style={{
                    backgroundColor: '#f8fafc',
                    padding: '0.75rem 0.9rem',
                    borderRadius: '10px',
                    border: '1px solid #e2e8f0',
                  }}
                >
                  <div style={{ fontSize: '0.74rem', color: '#64748b', fontWeight: 600 }}>
                    Cash Expenses
                  </div>
                  <div style={{ fontSize: '1.05rem', fontWeight: 800, color: '#dc2626', marginTop: '2px' }}>
                    {formatRupees(selectedDetail.cashExpensesMinor || 0)}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '2px' }}>
                    Petty cash & payouts
                  </div>
                </div>

                {/* 5. Expected Closing Cash */}
                <div
                  style={{
                    backgroundColor: '#f8fafc',
                    padding: '0.75rem 0.9rem',
                    borderRadius: '10px',
                    border: '1px solid #e2e8f0',
                  }}
                >
                  <div style={{ fontSize: '0.74rem', color: '#64748b', fontWeight: 600 }}>
                    Expected Closing Cash
                  </div>
                  <div style={{ fontSize: '1.05rem', fontWeight: 800, color: '#0f172a', marginTop: '2px' }}>
                    {formatRupees(selectedDetail.expectedCashMinor || selectedDetail.originalCashMinor || 0)}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '2px' }}>
                    Calculated drawer balance
                  </div>
                </div>

                {/* 6. Actual Closing Cash */}
                <div
                  style={{
                    backgroundColor: '#f8fafc',
                    padding: '0.75rem 0.9rem',
                    borderRadius: '10px',
                    border: '1px solid #e2e8f0',
                  }}
                >
                  <div style={{ fontSize: '0.74rem', color: '#64748b', fontWeight: 600 }}>
                    Actual Closing Cash Sealed
                  </div>
                  <div style={{ fontSize: '1.05rem', fontWeight: 800, color: '#d97706', marginTop: '2px' }}>
                    {formatRupees(selectedDetail.actualCashMinor || selectedDetail.originalCashMinor || 0)}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '2px' }}>
                    Physical cash count
                  </div>
                </div>
              </div>

              {/* Section 3: Late Sale Information (Separated from original Day Close) */}
              {selectedDetail.lateSalesCount > 0 ? (
                <div
                  style={{
                    padding: '1rem 1.15rem',
                    backgroundColor: '#fffbeb',
                    border: '1.5px solid #fde68a',
                    borderRadius: '12px',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginBottom: '8px',
                      flexWrap: 'wrap',
                      gap: '6px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <ClockIcon size={18} style={{ color: '#b45309' }} />
                      <span style={{ fontWeight: 800, fontSize: '0.92rem', color: '#92400e' }}>
                        Late Sales Already Recorded
                      </span>
                    </div>
                    <span
                      style={{
                        backgroundColor: '#fef3c7',
                        color: '#92400e',
                        border: '1px solid #fcd34d',
                        padding: '2px 8px',
                        borderRadius: '12px',
                        fontSize: '0.75rem',
                        fontWeight: 700,
                      }}
                    >
                      {selectedDetail.lateSalesCount} late bill(s) logged
                    </span>
                  </div>

                  {/* 4-Item Late Sales Metric Cards */}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                      gap: '0.65rem',
                      marginTop: '6px',
                    }}
                  >
                    <div
                      style={{
                        backgroundColor: '#ffffff',
                        padding: '0.65rem 0.85rem',
                        borderRadius: '8px',
                        border: '1px solid #fef3c7',
                      }}
                    >
                      <div style={{ fontSize: '0.72rem', color: '#78350f', fontWeight: 600 }}>
                        Number of Late Sales
                      </div>
                      <div style={{ fontSize: '1.05rem', fontWeight: 800, color: '#92400e', marginTop: '2px' }}>
                        {selectedDetail.lateSalesCount} bills
                      </div>
                    </div>

                    <div
                      style={{
                        backgroundColor: '#ffffff',
                        padding: '0.65rem 0.85rem',
                        borderRadius: '8px',
                        border: '1px solid #fef3c7',
                      }}
                    >
                      <div style={{ fontSize: '0.72rem', color: '#78350f', fontWeight: 600 }}>
                        Total Late-Sale Amount
                      </div>
                      <div style={{ fontSize: '1.05rem', fontWeight: 800, color: '#b45309', marginTop: '2px' }}>
                        +{formatRupees(selectedDetail.lateSalesTotalMinor)}
                      </div>
                    </div>

                    <div
                      style={{
                        backgroundColor: '#ffffff',
                        padding: '0.65rem 0.85rem',
                        borderRadius: '8px',
                        border: '1px solid #fef3c7',
                      }}
                    >
                      <div style={{ fontSize: '0.72rem', color: '#78350f', fontWeight: 600 }}>
                        Original Sales Total
                      </div>
                      <div style={{ fontSize: '1.05rem', fontWeight: 800, color: '#475569', marginTop: '2px' }}>
                        {formatRupees(selectedDetail.originalSalesTotalMinor)}
                      </div>
                    </div>

                    <div
                      style={{
                        backgroundColor: '#ffffff',
                        padding: '0.65rem 0.85rem',
                        borderRadius: '8px',
                        border: '1px solid #fde68a',
                      }}
                    >
                      <div style={{ fontSize: '0.72rem', color: '#78350f', fontWeight: 700 }}>
                        Revised Business Sales
                      </div>
                      <div style={{ fontSize: '1.05rem', fontWeight: 900, color: '#d97706', marginTop: '2px' }}>
                        {formatRupees(
                          selectedDetail.revisedSalesTotalMinor ||
                            selectedDetail.originalSalesTotalMinor + selectedDetail.lateSalesTotalMinor
                        )}
                      </div>
                    </div>
                  </div>

                  <p style={{ margin: '8px 0 0', fontSize: '0.73rem', color: '#92400e', fontStyle: 'italic' }}>
                    * Late sales are tracked in an independent audit trail and do not overwrite or modify the historical Day Close cash drawer seal.
                  </p>
                </div>
              ) : (
                <div
                  style={{
                    padding: '0.65rem 0.9rem',
                    backgroundColor: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    borderRadius: '8px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    fontSize: '0.8rem',
                    color: '#64748b',
                  }}
                >
                  <InfoIcon size={16} style={{ color: '#0284c7', flexShrink: 0 }} />
                  <span>
                    No late sales have been recorded for this date yet. Your entry will be logged as the first late sale.
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Section 4: Reason / Audit Note Field (Preserved) */}
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
                boxSizing: 'border-box',
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
              marginTop: '0.25rem',
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
              disabled={loadingDates || detailLoading || !selectedBdate || !selectedDetail}
              style={{
                padding: '0.65rem 1.5rem',
                borderRadius: '8px',
                border: 'none',
                backgroundColor:
                  loadingDates || detailLoading || !selectedBdate || !selectedDetail ? '#cbd5e1' : '#d97706',
                color: '#ffffff',
                fontWeight: 700,
                fontSize: '0.88rem',
                cursor:
                  loadingDates || detailLoading || !selectedBdate || !selectedDetail ? 'not-allowed' : 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                boxShadow:
                  loadingDates || detailLoading || !selectedBdate || !selectedDetail
                    ? 'none'
                    : '0 4px 12px rgba(217, 119, 6, 0.25)',
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
