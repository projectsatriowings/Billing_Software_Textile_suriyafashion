import React, { useState, useEffect, useCallback } from 'react';
import type { Item, Party, Role, SupplierReturn, DamagedStockItem } from '../../api.ts';
import {
  fetchSupplierReturns,
  dispatchSupplierReturn,
  rejectSupplierReturn,
  fetchDamagedStock,
} from '../../api.ts';
import { SupplierReturnModal } from './SupplierReturnModal.tsx';
import { SupplierReplacementModal } from './SupplierReplacementModal.tsx';

interface SupplierReturnsViewProps {
  items: Item[];
  suppliers: Party[];
  userRole?: Role;
  onInventoryUpdated: () => void;
  showToast: (msg: string) => void;
}

export const SupplierReturnsView: React.FC<SupplierReturnsViewProps> = ({
  items,
  suppliers,
  userRole,
  onInventoryUpdated,
  showToast,
}) => {
  const [returns, setReturns] = useState<SupplierReturn[]>([]);
  const [damagedStock, setDamagedStock] = useState<DamagedStockItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [search, setSearch] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [isReturnModalOpen, setIsReturnModalOpen] = useState<boolean>(false);
  const [replacementTargetReturn, setReplacementTargetReturn] = useState<SupplierReturn | null>(null);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [retRes, dmgRes] = await Promise.all([
        fetchSupplierReturns({
          search: search || undefined,
          status: statusFilter !== 'ALL' ? statusFilter : undefined,
        }),
        fetchDamagedStock({ status: 'ALL' }),
      ]);
      setReturns(retRes.supplierReturns || []);
      setDamagedStock(dmgRes.damagedStock || []);
    } catch (err: any) {
      showToast(err.message || 'Failed to load supplier returns.');
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, showToast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const formatDate = (val?: string | Date | null) => {
    if (!val) return '—';
    try {
      const d = new Date(val);
      if (isNaN(d.getTime())) return String(val);
      return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch {
      return String(val);
    }
  };

  const handleDispatch = async (ret: SupplierReturn) => {
    const retNum = ret.returnNumber || ret.return_number;
    const dispatchRef = window.prompt(
      `Enter Dispatch / Waybill / Transport Challan Reference for ${retNum}:`,
      'CHALLAN-DISPATCH-01'
    );
    if (!dispatchRef) return;

    try {
      await dispatchSupplierReturn(ret.id, {
        dispatchRef,
        dispatchDate: new Date().toISOString().slice(0, 10),
      });
      showToast(`Supplier return ${retNum} marked as dispatched to supplier.`);
      loadData();
      onInventoryUpdated();
    } catch (err: any) {
      showToast(err.message || 'Failed to dispatch return.');
    }
  };

  const handleReject = async (ret: SupplierReturn) => {
    const retNum = ret.returnNumber || ret.return_number;
    const reason = window.prompt(
      `Enter rejection reason for ${retNum}:`,
      'Supplier refused return claim'
    );
    if (!reason) return;

    try {
      await rejectSupplierReturn(ret.id, reason);
      showToast(`Supplier return ${retNum} marked as rejected.`);
      loadData();
      onInventoryUpdated();
    } catch (err: any) {
      showToast(err.message || 'Failed to reject return.');
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'DRAFT':
        return <span style={{ backgroundColor: '#f3f4f6', color: '#4b5563', padding: '0.2rem 0.6rem', borderRadius: '9999px', fontSize: '0.75rem', fontWeight: 600 }}>Draft</span>;
      case 'APPROVED':
        return <span style={{ backgroundColor: '#e0e7ff', color: '#3730a3', padding: '0.2rem 0.6rem', borderRadius: '9999px', fontSize: '0.75rem', fontWeight: 600 }}>Approved</span>;
      case 'READY_TO_DISPATCH':
        return <span style={{ backgroundColor: '#dbeafe', color: '#1e40af', padding: '0.2rem 0.6rem', borderRadius: '9999px', fontSize: '0.75rem', fontWeight: 600 }}>Ready to Dispatch</span>;
      case 'SENT_TO_SUPPLIER':
        return <span style={{ backgroundColor: '#ffedd5', color: '#9a3412', padding: '0.2rem 0.6rem', borderRadius: '9999px', fontSize: '0.75rem', fontWeight: 600 }}>Sent to Supplier</span>;
      case 'PARTIALLY_REPLACED':
        return <span style={{ backgroundColor: '#fef3c7', color: '#92400e', padding: '0.2rem 0.6rem', borderRadius: '9999px', fontSize: '0.75rem', fontWeight: 600 }}>Partially Replaced</span>;
      case 'FULLY_REPLACED':
        return <span style={{ backgroundColor: '#d1fae5', color: '#065f46', padding: '0.2rem 0.6rem', borderRadius: '9999px', fontSize: '0.75rem', fontWeight: 600 }}>Fully Replaced</span>;
      case 'REJECTED':
        return <span style={{ backgroundColor: '#fee2e2', color: '#991b1b', padding: '0.2rem 0.6rem', borderRadius: '9999px', fontSize: '0.75rem', fontWeight: 600 }}>Rejected</span>;
      default:
        return <span>{status}</span>;
    }
  };

  return (
    <div style={{ padding: '1.5rem', backgroundColor: '#f8fafc', minHeight: '100%' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#0f172a', margin: 0 }}>
            Supplier Returns
          </h2>
          <p style={{ margin: '0.25rem 0 0', color: '#64748b', fontSize: '0.875rem' }}>
            Manage outbound defective stock returns to textile vendors and track replacement status
          </p>
        </div>
        <button
          onClick={() => setIsReturnModalOpen(true)}
          style={{
            padding: '0.6rem 1.2rem',
            backgroundColor: '#2563eb',
            color: '#fff',
            border: 'none',
            borderRadius: '8px',
            fontWeight: 600,
            fontSize: '0.875rem',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
          }}
        >
          <span>+</span> Create Supplier Return
        </button>
      </div>

      {/* Filters */}
      <div
        style={{
          backgroundColor: '#fff',
          padding: '1rem 1.25rem',
          borderRadius: '10px',
          border: '1px solid #e2e8f0',
          marginBottom: '1rem',
          display: 'flex',
          gap: '1rem',
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ flex: 1, minWidth: '240px' }}>
          <input
            type="text"
            placeholder="Search by Return #, Supplier Name, Dispatch Ref..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              width: '100%',
              padding: '0.5rem 0.75rem',
              border: '1px solid #cbd5e1',
              borderRadius: '6px',
              fontSize: '0.875rem',
              boxSizing: 'border-box',
            }}
          />
        </div>

        <div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            style={{
              padding: '0.5rem 0.75rem',
              border: '1px solid #cbd5e1',
              borderRadius: '6px',
              fontSize: '0.875rem',
              backgroundColor: '#fff',
            }}
          >
            <option value="ALL">All Statuses</option>
            <option value="APPROVED">Approved</option>
            <option value="SENT_TO_SUPPLIER">Sent to Supplier</option>
            <option value="PARTIALLY_REPLACED">Partially Replaced</option>
            <option value="FULLY_REPLACED">Fully Replaced</option>
            <option value="REJECTED">Rejected</option>
          </select>
        </div>

        <button
          onClick={loadData}
          style={{
            padding: '0.5rem 1rem',
            backgroundColor: '#f1f5f9',
            border: '1px solid #cbd5e1',
            borderRadius: '6px',
            fontSize: '0.875rem',
            cursor: 'pointer',
            fontWeight: 500,
          }}
        >
          Refresh
        </button>
      </div>

      {/* Returns List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {loading ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: '#94a3b8', backgroundColor: '#fff', borderRadius: '10px' }}>
            Loading supplier returns...
          </div>
        ) : returns.length === 0 ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: '#94a3b8', backgroundColor: '#fff', borderRadius: '10px' }}>
            No supplier returns created yet. Record a damaged item or click "+ Create Supplier Return".
          </div>
        ) : (
          returns.map((ret) => {
            const isExpanded = expandedId === ret.id;
            const hasPendingLines = ret.lines.some((l) => (l.pendingQtyMilli ?? l.pending_qty_milli ?? 0) > 0);
            const retNum = ret.returnNumber || ret.return_number;
            const retDate = ret.returnDate || ret.return_date;
            const suppName = ret.supplierName || ret.supplier_name;
            const totItems = ret.totalItems ?? ret.total_items ?? ret.lines.length;
            const totQty = (((ret.totalQtyMilli ?? ret.total_qty_milli ?? 0) / 1000)).toFixed(1);
            const dispRef = ret.dispatchRef || ret.dispatch_ref;

            return (
              <div
                key={ret.id}
                style={{
                  backgroundColor: '#fff',
                  borderRadius: '10px',
                  border: '1px solid #e2e8f0',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                  overflow: 'hidden',
                }}
              >
                {/* Return Header Row */}
                <div
                  style={{
                    padding: '1.25rem',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: '1rem',
                    borderBottom: isExpanded ? '1px solid #f1f5f9' : 'none',
                  }}
                >
                  <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#0f172a' }}>
                        {retNum}
                      </div>
                      <div style={{ fontSize: '0.8rem', color: '#64748b' }}>Date: {formatDate(retDate)}</div>
                    </div>

                    <div>
                      <div style={{ fontSize: '0.95rem', fontWeight: 600, color: '#1e293b' }}>
                        {suppName || 'Vendor'}
                      </div>
                      <div style={{ fontSize: '0.8rem', color: '#64748b' }}>
                        {totItems} item(s) • {totQty} units
                      </div>
                    </div>

                    <div>{getStatusBadge(ret.status)}</div>

                    {dispRef && (
                      <div style={{ fontSize: '0.8rem', color: '#0369a1', backgroundColor: '#f0f9ff', padding: '0.2rem 0.6rem', borderRadius: '6px' }}>
                        Challan: {dispRef}
                      </div>
                    )}
                  </div>

                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    {ret.status === 'APPROVED' && (
                      <button
                        onClick={() => handleDispatch(ret)}
                        style={{
                          padding: '0.4rem 0.85rem',
                          backgroundColor: '#0284c7',
                          color: '#fff',
                          border: 'none',
                          borderRadius: '6px',
                          fontSize: '0.8rem',
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        Dispatch Goods
                      </button>
                    )}

                    {(ret.status === 'SENT_TO_SUPPLIER' || ret.status === 'PARTIALLY_REPLACED') && hasPendingLines && (
                      <button
                        onClick={() => setReplacementTargetReturn(ret)}
                        style={{
                          padding: '0.4rem 0.85rem',
                          backgroundColor: '#059669',
                          color: '#fff',
                          border: 'none',
                          borderRadius: '6px',
                          fontSize: '0.8rem',
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        Receive Replacement
                      </button>
                    )}

                    {ret.status !== 'REJECTED' && ret.status !== 'FULLY_REPLACED' && (
                      <button
                        onClick={() => handleReject(ret)}
                        style={{
                          padding: '0.4rem 0.75rem',
                          backgroundColor: '#fef2f2',
                          color: '#dc2626',
                          border: '1px solid #fee2e2',
                          borderRadius: '6px',
                          fontSize: '0.8rem',
                          fontWeight: 500,
                          cursor: 'pointer',
                        }}
                      >
                        Reject
                      </button>
                    )}

                    <button
                      onClick={() => setExpandedId(isExpanded ? null : ret.id)}
                      style={{
                        padding: '0.4rem 0.75rem',
                        backgroundColor: '#f8fafc',
                        color: '#475569',
                        border: '1px solid #cbd5e1',
                        borderRadius: '6px',
                        fontSize: '0.8rem',
                        cursor: 'pointer',
                      }}
                    >
                      {isExpanded ? 'Hide Details' : 'View Items'}
                    </button>
                  </div>
                </div>

                {/* Return Lines Details */}
                {isExpanded && (
                  <div style={{ backgroundColor: '#f8fafc', padding: '1rem 1.25rem' }}>
                    <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', marginBottom: '0.5rem' }}>
                      RETURNED TEXTILE ITEMS
                    </div>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.825rem' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid #e2e8f0', color: '#64748b' }}>
                          <th style={{ padding: '0.5rem', textAlign: 'left' }}>Product</th>
                          <th style={{ padding: '0.5rem', textAlign: 'left' }}>Textile Details</th>
                          <th style={{ padding: '0.5rem', textAlign: 'left' }}>Reason</th>
                          <th style={{ padding: '0.5rem', textAlign: 'right' }}>Returned Qty</th>
                          <th style={{ padding: '0.5rem', textAlign: 'right' }}>Replaced Qty</th>
                          <th style={{ padding: '0.5rem', textAlign: 'right' }}>Pending Qty</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ret.lines.map((l) => (
                          <tr key={l.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                            <td style={{ padding: '0.5rem' }}>
                              <div style={{ fontWeight: 600 }}>{l.itemName || l.item_name}</div>
                              {l.sku && <div style={{ fontSize: '0.75rem', color: '#64748b' }}>SKU: {l.sku}</div>}
                            </td>
                            <td style={{ padding: '0.5rem' }}>
                              <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                                {(l.rollNo || l.roll_no) && <span style={{ backgroundColor: '#e2e8f0', padding: '0.1rem 0.3rem', borderRadius: '3px' }}>Roll: {l.rollNo || l.roll_no}</span>}
                                {l.size && <span>Size: {l.size}</span>}
                                {l.colour && <span>Shade: {l.colour}</span>}
                              </div>
                            </td>
                            <td style={{ padding: '0.5rem', color: '#475569' }}>{l.returnReason || l.return_reason}</td>
                            <td style={{ padding: '0.5rem', textAlign: 'right', fontWeight: 600 }}>
                              {(((l.qtyMilli ?? l.qty_milli ?? 0) / 1000)).toFixed(1)} {l.unit}
                            </td>
                            <td style={{ padding: '0.5rem', textAlign: 'right', color: '#059669', fontWeight: 600 }}>
                              {(((l.replacedQtyMilli ?? l.replaced_qty_milli ?? 0) / 1000)).toFixed(1)} {l.unit}
                            </td>
                            <td style={{ padding: '0.5rem', textAlign: 'right', color: (l.pendingQtyMilli ?? l.pending_qty_milli ?? 0) > 0 ? '#d97706' : '#64748b', fontWeight: 700 }}>
                              {(((l.pendingQtyMilli ?? l.pending_qty_milli ?? 0) / 1000)).toFixed(1)} {l.unit}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* New Return Modal */}
      <SupplierReturnModal
        isOpen={isReturnModalOpen}
        onClose={() => setIsReturnModalOpen(false)}
        suppliers={suppliers}
        availableDamagedStock={damagedStock}
        onSuccess={() => {
          loadData();
          onInventoryUpdated();
        }}
        showToast={showToast}
      />

      {/* Replacement Modal */}
      {replacementTargetReturn && (
        <SupplierReplacementModal
          isOpen={Boolean(replacementTargetReturn)}
          onClose={() => setReplacementTargetReturn(null)}
          supplierReturn={replacementTargetReturn}
          items={items}
          onSuccess={() => {
            loadData();
            onInventoryUpdated();
          }}
          showToast={showToast}
        />
      )}
    </div>
  );
};
