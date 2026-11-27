import React, { useState, useEffect, useCallback } from 'react';
import type { SupplierReplacement, Role } from '../../api.ts';
import { fetchSupplierReplacements } from '../../api.ts';

interface SupplierReplacementsViewProps {
  userRole?: Role;
  showToast: (msg: string) => void;
  onNavigateToReturns?: () => void;
}

export const SupplierReplacementsView: React.FC<SupplierReplacementsViewProps> = ({
  userRole,
  showToast,
  onNavigateToReturns,
}) => {
  const [replacements, setReplacements] = useState<SupplierReplacement[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [search, setSearch] = useState<string>('');

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetchSupplierReplacements({
        search: search || undefined,
      });
      setReplacements(res.supplierReplacements || []);
    } catch (err: any) {
      showToast(err.message || 'Failed to load supplier replacements.');
    } finally {
      setLoading(false);
    }
  }, [search, showToast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const getConditionBadge = (condition: string) => {
    switch (condition) {
      case 'GOOD':
        return (
          <span style={{ backgroundColor: '#d1fae5', color: '#065f46', padding: '0.2rem 0.6rem', borderRadius: '9999px', fontSize: '0.75rem', fontWeight: 600 }}>
            Good / Saleable (Added to Stock)
          </span>
        );
      case 'DEFECTIVE':
        return (
          <span style={{ backgroundColor: '#fee2e2', color: '#991b1b', padding: '0.2rem 0.6rem', borderRadius: '9999px', fontSize: '0.75rem', fontWeight: 600 }}>
            Defective on Arrival
          </span>
        );
      case 'DAMAGED':
        return (
          <span style={{ backgroundColor: '#fee2e2', color: '#991b1b', padding: '0.2rem 0.6rem', borderRadius: '9999px', fontSize: '0.75rem', fontWeight: 600 }}>
            Damaged in Transit
          </span>
        );
      case 'SHORT_RECEIVED':
        return (
          <span style={{ backgroundColor: '#fef3c7', color: '#92400e', padding: '0.2rem 0.6rem', borderRadius: '9999px', fontSize: '0.75rem', fontWeight: 600 }}>
            Short Received
          </span>
        );
      case 'WRONG_PRODUCT':
        return (
          <span style={{ backgroundColor: '#ffedd5', color: '#c2410c', padding: '0.2rem 0.6rem', borderRadius: '9999px', fontSize: '0.75rem', fontWeight: 600 }}>
            Wrong Product Received
          </span>
        );
      default:
        return <span>{condition}</span>;
    }
  };

  return (
    <div style={{ padding: '1.5rem', backgroundColor: '#f8fafc', minHeight: '100%' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#0f172a', margin: 0 }}>
            Supplier Replacements History
          </h2>
          <p style={{ margin: '0.25rem 0 0', color: '#64748b', fontSize: '0.875rem' }}>
            Audit log of replacement goods received from vendors against supplier returns
          </p>
        </div>
        {onNavigateToReturns && (
          <button
            onClick={onNavigateToReturns}
            style={{
              padding: '0.6rem 1.2rem',
              backgroundColor: '#059669',
              color: '#fff',
              border: 'none',
              borderRadius: '8px',
              fontWeight: 600,
              fontSize: '0.875rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
            }}
          >
            <span>+</span> Receive Against Return
          </button>
        )}
      </div>

      {/* Accounting Guarantee Box */}
      <div
        style={{
          backgroundColor: '#eff6ff',
          border: '1px solid #bfdbfe',
          borderRadius: '8px',
          padding: '0.75rem 1rem',
          marginBottom: '1rem',
          fontSize: '0.825rem',
          color: '#1e40af',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
        }}
      >
        <span>⚖️</span>
        <span>
          <strong>Accounting Note:</strong> Supplier replacement receipts restore inventory without creating new purchase invoices, supplier payables, or duplicate GST Input Tax Credit (ITC).
        </span>
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
        }}
      >
        <div style={{ flex: 1 }}>
          <input
            type="text"
            placeholder="Search by Replacement #, Return #, Challan #, Product..."
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

      {/* Table */}
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
              <th style={{ padding: '0.75rem 1rem', fontWeight: 600, color: '#475569' }}>Replacement Ref</th>
              <th style={{ padding: '0.75rem 1rem', fontWeight: 600, color: '#475569' }}>Return Ref & Supplier</th>
              <th style={{ padding: '0.75rem 1rem', fontWeight: 600, color: '#475569' }}>Product Received</th>
              <th style={{ padding: '0.75rem 1rem', fontWeight: 600, color: '#475569' }}>Received Qty</th>
              <th style={{ padding: '0.75rem 1rem', fontWeight: 600, color: '#475569' }}>Condition & Stock Effect</th>
              <th style={{ padding: '0.75rem 1rem', fontWeight: 600, color: '#475569' }}>Challan / Delivery Ref</th>
              <th style={{ padding: '0.75rem 1rem', fontWeight: 600, color: '#475569' }}>Received By</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>
                  Loading supplier replacements...
                </td>
              </tr>
            ) : replacements.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ padding: '2.5rem', textAlign: 'center', color: '#94a3b8' }}>
                  No supplier replacements recorded yet.
                </td>
              </tr>
            ) : (
              replacements.map((rep) => {
                const repNum = rep.replacementNumber || rep.replacement_number;
                const recDate = rep.receivedDate || rep.received_date;
                const retNum = rep.returnNumber || rep.return_number;
                const suppName = rep.supplierName || rep.supplier_name;
                const itemName = rep.replacementItemName || rep.replacement_item_name || rep.originalItemName || rep.original_item_name;
                const origItemName = rep.originalItemName || rep.original_item_name;
                const isSubstituted = (rep.replacementItemId || rep.replacement_item_id) !== (rep.originalItemId || rep.original_item_id);
                const roll = rep.rollNo || rep.roll_no;
                const batch = rep.batchNo || rep.batch_no;
                const qtyUnits = (((rep.qtyMilli ?? rep.qty_milli ?? 0) / 1000)).toFixed(2);
                const challan = rep.challanNo || rep.challan_no;
                const receiver = rep.receiverName || rep.receiver_name;

                return (
                  <tr key={rep.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '0.85rem 1rem', verticalAlign: 'top' }}>
                      <div style={{ fontWeight: 700, color: '#0f172a' }}>{repNum}</div>
                      <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{recDate}</div>
                    </td>
                    <td style={{ padding: '0.85rem 1rem', verticalAlign: 'top' }}>
                      <div style={{ fontWeight: 600, color: '#2563eb' }}>{retNum || '—'}</div>
                      <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{suppName || 'Vendor'}</div>
                    </td>
                    <td style={{ padding: '0.85rem 1rem', verticalAlign: 'top' }}>
                      <div style={{ fontWeight: 600, color: '#0f172a' }}>
                        {itemName}
                      </div>
                      {isSubstituted && origItemName && (
                        <div style={{ fontSize: '0.75rem', color: '#d97706' }}>
                          (Substituted for: {origItemName})
                        </div>
                      )}
                      <div style={{ fontSize: '0.75rem', color: '#64748b', display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.2rem' }}>
                        {roll && <span>Roll: {roll}</span>}
                        {batch && <span>Batch: {batch}</span>}
                        {rep.size && <span>Size: {rep.size}</span>}
                        {rep.colour && <span>Color: {rep.colour}</span>}
                      </div>
                    </td>
                    <td style={{ padding: '0.85rem 1rem', verticalAlign: 'top' }}>
                      <strong style={{ color: rep.condition === 'GOOD' ? '#059669' : '#dc2626' }}>
                        {qtyUnits} {rep.unit}
                      </strong>
                    </td>
                    <td style={{ padding: '0.85rem 1rem', verticalAlign: 'top' }}>
                      {getConditionBadge(rep.condition)}
                      {rep.condition === 'GOOD' ? (
                        <div style={{ fontSize: '0.75rem', color: '#059669', marginTop: '0.25rem' }}>
                          ✓ Added to saleable stock & POS
                        </div>
                      ) : (
                        <div style={{ fontSize: '0.75rem', color: '#b91c1c', marginTop: '0.25rem' }}>
                          ✗ Kept in defective stock
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '0.85rem 1rem', verticalAlign: 'top' }}>
                      <div style={{ fontWeight: 500, color: '#334155' }}>{challan || '—'}</div>
                      {rep.notes && <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{rep.notes}</div>}
                    </td>
                    <td style={{ padding: '0.85rem 1rem', verticalAlign: 'top', color: '#64748b' }}>
                      {receiver || 'Staff'}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
