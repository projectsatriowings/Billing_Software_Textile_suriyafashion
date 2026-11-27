import React, { useState, useEffect, useCallback } from 'react';
import type { Item, Party, Role, DamagedStockItem, DamagedStockStats } from '../../api.ts';
import { fetchDamagedStock, fetchDamagedStockStats, scrapDamagedStock } from '../../api.ts';
import { DamagedStockModal } from './DamagedStockModal.tsx';
import { SupplierReturnModal } from './SupplierReturnModal.tsx';

interface DamagedDefectiveStockViewProps {
  items: Item[];
  suppliers: Party[];
  userRole?: Role;
  onInventoryUpdated: () => void;
  showToast: (msg: string) => void;
  onNavigateToReturns?: () => void;
}

export const DamagedDefectiveStockView: React.FC<DamagedDefectiveStockViewProps> = ({
  items,
  suppliers,
  userRole,
  onInventoryUpdated,
  showToast,
  onNavigateToReturns,
}) => {
  const [damagedItems, setDamagedItems] = useState<DamagedStockItem[]>([]);
  const [stats, setStats] = useState<DamagedStockStats | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [search, setSearch] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [classificationFilter, setClassificationFilter] = useState<string>('ALL');

  const [isRecordModalOpen, setIsRecordModalOpen] = useState<boolean>(false);
  const [isReturnModalOpen, setIsReturnModalOpen] = useState<boolean>(false);
  const [selectedForReturn, setSelectedForReturn] = useState<DamagedStockItem | null>(null);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [stockRes, statsRes] = await Promise.all([
        fetchDamagedStock({
          search: search || undefined,
          status: statusFilter !== 'ALL' ? statusFilter : undefined,
          classification: classificationFilter !== 'ALL' ? classificationFilter : undefined,
        }),
        fetchDamagedStockStats(),
      ]);
      setDamagedItems(stockRes.damagedStock || []);
      setStats(statsRes.stats || null);
    } catch (err: any) {
      showToast(err.message || 'Failed to load damaged stock data.');
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, classificationFilter, showToast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleScrap = async (item: DamagedStockItem) => {
    const dmgNum = item.damageNumber || item.damage_number;
    const name = item.itemName || item.item_name;
    if (!window.confirm(`Are you sure you want to write off / scrap ${dmgNum} (${name})?`)) {
      return;
    }
    const reason = window.prompt('Enter scrap / disposal reason:', 'Total fabric tear / non-recoverable defect');
    if (reason === null) return;

    try {
      await scrapDamagedStock(item.id, reason);
      showToast(`Damaged item ${dmgNum} written off.`);
      loadData();
      onInventoryUpdated();
    } catch (err: any) {
      showToast(err.message || 'Failed to scrap damaged item.');
    }
  };

  const handleInitiateReturn = (item: DamagedStockItem) => {
    setSelectedForReturn(item);
    setIsReturnModalOpen(true);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'DAMAGED':
        return <span style={{ backgroundColor: '#fee2e2', color: '#b91c1c', padding: '0.2rem 0.6rem', borderRadius: '9999px', fontSize: '0.75rem', fontWeight: 600 }}>Damaged</span>;
      case 'DEFECTIVE':
        return <span style={{ backgroundColor: '#fef3c7', color: '#b45309', padding: '0.2rem 0.6rem', borderRadius: '9999px', fontSize: '0.75rem', fontWeight: 600 }}>Defective</span>;
      case 'RETURN_PENDING':
        return <span style={{ backgroundColor: '#e0e7ff', color: '#4338ca', padding: '0.2rem 0.6rem', borderRadius: '9999px', fontSize: '0.75rem', fontWeight: 600 }}>Return Pending</span>;
      case 'SENT_TO_SUPPLIER':
        return <span style={{ backgroundColor: '#f3e8ff', color: '#7e22ce', padding: '0.2rem 0.6rem', borderRadius: '9999px', fontSize: '0.75rem', fontWeight: 600 }}>Sent to Supplier</span>;
      case 'REPLACEMENT_PENDING':
        return <span style={{ backgroundColor: '#ffedd5', color: '#c2410c', padding: '0.2rem 0.6rem', borderRadius: '9999px', fontSize: '0.75rem', fontWeight: 600 }}>Replacement Pending</span>;
      case 'SCRAPPED':
        return <span style={{ backgroundColor: '#f3f4f6', color: '#4b5563', padding: '0.2rem 0.6rem', borderRadius: '9999px', fontSize: '0.75rem', fontWeight: 600 }}>Written Off</span>;
      case 'RESOLVED':
        return <span style={{ backgroundColor: '#d1fae5', color: '#065f46', padding: '0.2rem 0.6rem', borderRadius: '9999px', fontSize: '0.75rem', fontWeight: 600 }}>Resolved</span>;
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
            Damaged & Defective Stock
          </h2>
          <p style={{ margin: '0.25rem 0 0', color: '#64748b', fontSize: '0.875rem' }}>
            Textile damage tracking, defect isolation, scrap write-offs, and supplier return initiation
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button
            onClick={() => setIsRecordModalOpen(true)}
            style={{
              padding: '0.6rem 1.2rem',
              backgroundColor: '#dc2626',
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
            <span>+</span> Record Damaged / Defective Stock
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: '1rem',
          marginBottom: '1.5rem',
        }}
      >
        <div style={{ backgroundColor: '#fff', padding: '1rem', borderRadius: '10px', border: '1px solid #fee2e2', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
          <div style={{ fontSize: '0.8rem', color: '#991b1b', fontWeight: 600 }}>Damaged Stock</div>
          <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#ef4444', margin: '0.25rem 0' }}>
            {(((stats?.damagedQtyMilli ?? stats?.damaged_qty_milli ?? 0) / 1000)).toFixed(1)} <span style={{ fontSize: '0.85rem' }}>units</span>
          </div>
          <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>{stats?.damagedCount ?? stats?.damaged_count ?? 0} incidents</div>
        </div>

        <div style={{ backgroundColor: '#fff', padding: '1rem', borderRadius: '10px', border: '1px solid #fef3c7', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
          <div style={{ fontSize: '0.8rem', color: '#92400e', fontWeight: 600 }}>Defective Stock</div>
          <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#f59e0b', margin: '0.25rem 0' }}>
            {(((stats?.defectiveQtyMilli ?? stats?.defective_qty_milli ?? 0) / 1000)).toFixed(1)} <span style={{ fontSize: '0.85rem' }}>units</span>
          </div>
          <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>{stats?.defectiveCount ?? stats?.defective_count ?? 0} incidents</div>
        </div>

        <div style={{ backgroundColor: '#fff', padding: '1rem', borderRadius: '10px', border: '1px solid #e0e7ff', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
          <div style={{ fontSize: '0.8rem', color: '#3730a3', fontWeight: 600 }}>Return Pending</div>
          <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#4f46e5', margin: '0.25rem 0' }}>
            {(((stats?.returnPendingQtyMilli ?? stats?.return_pending_qty_milli ?? 0) / 1000)).toFixed(1)} <span style={{ fontSize: '0.85rem' }}>units</span>
          </div>
          <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>Ready for dispatch</div>
        </div>

        <div style={{ backgroundColor: '#fff', padding: '1rem', borderRadius: '10px', border: '1px solid #ffedd5', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
          <div style={{ fontSize: '0.8rem', color: '#9a3412', fontWeight: 600 }}>Sent to Supplier</div>
          <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#ea580c', margin: '0.25rem 0' }}>
            {(((stats?.sentToSupplierQtyMilli ?? stats?.sent_to_supplier_qty_milli ?? 0) / 1000)).toFixed(1)} <span style={{ fontSize: '0.85rem' }}>units</span>
          </div>
          <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>Awaiting replacement/credit</div>
        </div>

        <div style={{ backgroundColor: '#fff', padding: '1rem', borderRadius: '10px', border: '1px solid #d1fae5', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
          <div style={{ fontSize: '0.8rem', color: '#065f46', fontWeight: 600 }}>Resolved / Replaced</div>
          <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#10b981', margin: '0.25rem 0' }}>
            {(((stats?.resolvedQtyMilli ?? stats?.resolved_qty_milli ?? 0) / 1000)).toFixed(1)} <span style={{ fontSize: '0.85rem' }}>units</span>
          </div>
          <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>Completed workflows</div>
        </div>

        <div style={{ backgroundColor: '#fff', padding: '1rem', borderRadius: '10px', border: '1px solid #e5e7eb', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
          <div style={{ fontSize: '0.8rem', color: '#4b5563', fontWeight: 600 }}>Written Off / Scrap</div>
          <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#6b7280', margin: '0.25rem 0' }}>
            {(((stats?.scrappedQtyMilli ?? stats?.scrapped_qty_milli ?? 0) / 1000)).toFixed(1)} <span style={{ fontSize: '0.85rem' }}>units</span>
          </div>
          <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>Loss recognized</div>
        </div>
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
            placeholder="Search by Ref #, Product, SKU, Roll No, Batch..."
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
            value={classificationFilter}
            onChange={(e) => setClassificationFilter(e.target.value)}
            style={{
              padding: '0.5rem 0.75rem',
              border: '1px solid #cbd5e1',
              borderRadius: '6px',
              fontSize: '0.875rem',
              backgroundColor: '#fff',
            }}
          >
            <option value="ALL">All Classifications</option>
            <option value="DAMAGED">Damaged Only</option>
            <option value="DEFECTIVE">Defective Only</option>
          </select>
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
            <option value="DAMAGED">Damaged</option>
            <option value="DEFECTIVE">Defective</option>
            <option value="RETURN_PENDING">Return Pending</option>
            <option value="SENT_TO_SUPPLIER">Sent to Supplier</option>
            <option value="REPLACEMENT_PENDING">Replacement Pending</option>
            <option value="SCRAPPED">Written Off / Scrapped</option>
            <option value="RESOLVED">Resolved</option>
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

      {/* Data Table */}
      <div
        style={{
          backgroundColor: '#fff',
          borderRadius: '10px',
          border: '1px solid #e2e8f0',
          overflowX: 'auto',
          boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
        }}
      >
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.875rem' }}>
          <thead>
            <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
              <th style={{ padding: '0.75rem 1rem', fontWeight: 600, color: '#475569' }}>Damage Ref</th>
              <th style={{ padding: '0.75rem 1rem', fontWeight: 600, color: '#475569' }}>Product & Attributes</th>
              <th style={{ padding: '0.75rem 1rem', fontWeight: 600, color: '#475569' }}>Affected Qty</th>
              <th style={{ padding: '0.75rem 1rem', fontWeight: 600, color: '#475569' }}>Reason / Defect</th>
              <th style={{ padding: '0.75rem 1rem', fontWeight: 600, color: '#475569' }}>Supplier</th>
              <th style={{ padding: '0.75rem 1rem', fontWeight: 600, color: '#475569' }}>Status</th>
              <th style={{ padding: '0.75rem 1rem', fontWeight: 600, color: '#475569', textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>
                  Loading damaged stock records...
                </td>
              </tr>
            ) : damagedItems.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ padding: '2.5rem', textAlign: 'center', color: '#94a3b8' }}>
                  No damaged or defective stock found matching current filters.
                </td>
              </tr>
            ) : (
              damagedItems.map((item) => (
                <tr key={item.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '0.85rem 1rem', verticalAlign: 'top' }}>
                    <div style={{ fontWeight: 700, color: '#0f172a' }}>{item.damageNumber || item.damage_number}</div>
                    <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{item.damageDate || item.damage_date}</div>
                  </td>
                  <td style={{ padding: '0.85rem 1rem', verticalAlign: 'top' }}>
                    <div style={{ fontWeight: 600, color: '#0f172a' }}>{item.itemName || item.item_name}</div>
                    <div style={{ fontSize: '0.75rem', color: '#64748b', display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.2rem' }}>
                      {item.sku && <span>SKU: {item.sku}</span>}
                      {(item.rollNo || item.roll_no) && <span style={{ backgroundColor: '#f1f5f9', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>Roll: {item.rollNo || item.roll_no}</span>}
                      {(item.batchNo || item.batch_no) && <span style={{ backgroundColor: '#f1f5f9', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>Batch: {item.batchNo || item.batch_no}</span>}
                      {item.size && <span>Size: {item.size}</span>}
                      {item.colour && <span>Color: {item.colour}</span>}
                    </div>
                  </td>
                  <td style={{ padding: '0.85rem 1rem', verticalAlign: 'top' }}>
                    <strong style={{ color: '#dc2626' }}>
                      {(((item.qtyMilli ?? item.qty_milli ?? 0) / 1000)).toFixed(2)} {item.unit}
                    </strong>
                  </td>
                  <td style={{ padding: '0.85rem 1rem', verticalAlign: 'top' }}>
                    <div style={{ fontWeight: 500, color: '#334155' }}>{item.damageReason || item.damage_reason}</div>
                    {item.notes && <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.2rem' }}>{item.notes}</div>}
                  </td>
                  <td style={{ padding: '0.85rem 1rem', verticalAlign: 'top' }}>
                    <div style={{ color: '#334155' }}>{item.supplierName || item.supplier_name || '—'}</div>
                    {(item.originalPurchaseNumber || item.original_purchase_number) && (
                      <div style={{ fontSize: '0.75rem', color: '#64748b' }}>Pur: {item.originalPurchaseNumber || item.original_purchase_number}</div>
                    )}
                  </td>
                  <td style={{ padding: '0.85rem 1rem', verticalAlign: 'top' }}>
                    {getStatusBadge(item.status)}
                  </td>
                  <td style={{ padding: '0.85rem 1rem', verticalAlign: 'top', textAlign: 'right' }}>
                    <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                      {(item.status === 'DAMAGED' || item.status === 'DEFECTIVE') && (
                        <>
                          <button
                            onClick={() => handleInitiateReturn(item)}
                            title="Create Supplier Return"
                            style={{
                              padding: '0.35rem 0.75rem',
                              backgroundColor: '#eff6ff',
                              color: '#2563eb',
                              border: '1px solid #bfdbfe',
                              borderRadius: '6px',
                              fontSize: '0.75rem',
                              fontWeight: 600,
                              cursor: 'pointer',
                            }}
                          >
                            Return to Supplier
                          </button>
                          <button
                            onClick={() => handleScrap(item)}
                            title="Scrap / Write-off"
                            style={{
                              padding: '0.35rem 0.6rem',
                              backgroundColor: '#fef2f2',
                              color: '#dc2626',
                              border: '1px solid #fecaca',
                              borderRadius: '6px',
                              fontSize: '0.75rem',
                              fontWeight: 600,
                              cursor: 'pointer',
                            }}
                          >
                            Scrap
                          </button>
                        </>
                      )}
                      {item.status === 'SENT_TO_SUPPLIER' && onNavigateToReturns && (
                        <button
                          onClick={onNavigateToReturns}
                          style={{
                            padding: '0.35rem 0.75rem',
                            backgroundColor: '#f8fafc',
                            color: '#475569',
                            border: '1px solid #cbd5e1',
                            borderRadius: '6px',
                            fontSize: '0.75rem',
                            fontWeight: 500,
                            cursor: 'pointer',
                          }}
                        >
                          View Return
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Record Modal */}
      <DamagedStockModal
        isOpen={isRecordModalOpen}
        onClose={() => setIsRecordModalOpen(false)}
        items={items}
        suppliers={suppliers}
        onSuccess={() => {
          loadData();
          onInventoryUpdated();
        }}
        showToast={showToast}
      />

      {/* Supplier Return Modal */}
      <SupplierReturnModal
        isOpen={isReturnModalOpen}
        onClose={() => {
          setIsReturnModalOpen(false);
          setSelectedForReturn(null);
        }}
        suppliers={suppliers}
        availableDamagedStock={damagedItems}
        preselectedDamagedItem={selectedForReturn}
        onSuccess={() => {
          loadData();
          onInventoryUpdated();
        }}
        showToast={showToast}
      />
    </div>
  );
};
