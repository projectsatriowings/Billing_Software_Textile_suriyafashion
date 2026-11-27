import React, { useState, useEffect } from 'react';
import {
  getVariantSalesStockReport,
  getDeadStockReport,
  getPendingTailoringReport,
} from '../../api.ts';

export const TextileReportsView: React.FC = () => {
  const [subTab, setSubTab] = useState<'sales_stock' | 'dead_stock' | 'pending_stitching'>('sales_stock');
  const [loading, setLoading] = useState(false);
  const [salesStockData, setSalesStockData] = useState<any[]>([]);
  const [deadStockData, setDeadStockData] = useState<any[]>([]);
  const [deadStockDays, setDeadStockDays] = useState(30);
  const [pendingTailoringData, setPendingTailoringData] = useState<any[]>([]);
  const [searchFilter, setSearchFilter] = useState('');

  const formatRupees = (paise: number) => `₹${(paise / 100).toFixed(2)}`;

  useEffect(() => {
    setLoading(true);
    if (subTab === 'sales_stock') {
      getVariantSalesStockReport()
        .then((res) => setSalesStockData(res.report || []))
        .catch((err) => console.error('Failed to load sales stock report:', err))
        .finally(() => setLoading(false));
    } else if (subTab === 'dead_stock') {
      getDeadStockReport(deadStockDays)
        .then((res) => setDeadStockData(res.report || []))
        .catch((err) => console.error('Failed to load dead stock report:', err))
        .finally(() => setLoading(false));
    } else if (subTab === 'pending_stitching') {
      getPendingTailoringReport()
        .then((res) => setPendingTailoringData(res.report || []))
        .catch((err) => console.error('Failed to load pending tailoring report:', err))
        .finally(() => setLoading(false));
    }
  }, [subTab, deadStockDays]);

  const filteredSalesStock = salesStockData.filter((r) => {
    if (!searchFilter.trim()) return true;
    const q = searchFilter.toLowerCase();
    return (
      r.productName?.toLowerCase().includes(q) ||
      r.size?.toLowerCase().includes(q) ||
      r.colour?.toLowerCase().includes(q) ||
      r.sku?.toLowerCase().includes(q)
    );
  });

  return (
    <div style={{ padding: '1rem', background: '#ffffff', borderRadius: '14px', border: '1px solid #e2e8f0', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
      {/* Top Header & Sub Tabs */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e2e8f0', paddingBottom: '0.85rem', marginBottom: '1rem' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: '#1e293b' }}>
            Textile &amp; Apparel Analytics Hub
          </h2>
          <div style={{ fontSize: '0.82rem', color: '#64748b', marginTop: '2px' }}>
            Size &amp; colour sales velocity, dead-stock inventory ageing, and pending stitching orders
          </div>
        </div>

        {/* Tab Pills */}
        <div style={{ display: 'flex', gap: '0.5rem', background: '#f1f5f9', padding: '4px', borderRadius: '10px' }}>
          <button
            type="button"
            onClick={() => setSubTab('sales_stock')}
            style={{
              padding: '0.45rem 0.95rem',
              borderRadius: '8px',
              fontSize: '0.82rem',
              fontWeight: 700,
              border: 'none',
              background: subTab === 'sales_stock' ? '#ffffff' : 'transparent',
              color: subTab === 'sales_stock' ? '#4f46e5' : '#64748b',
              boxShadow: subTab === 'sales_stock' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              cursor: 'pointer',
            }}
          >
            Size &amp; Colour Stock / Sales
          </button>
          <button
            type="button"
            onClick={() => setSubTab('dead_stock')}
            style={{
              padding: '0.45rem 0.95rem',
              borderRadius: '8px',
              fontSize: '0.82rem',
              fontWeight: 700,
              border: 'none',
              background: subTab === 'dead_stock' ? '#ffffff' : 'transparent',
              color: subTab === 'dead_stock' ? '#4f46e5' : '#64748b',
              boxShadow: subTab === 'dead_stock' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              cursor: 'pointer',
            }}
          >
            Dead-Stock Ageing
          </button>
          <button
            type="button"
            onClick={() => setSubTab('pending_stitching')}
            style={{
              padding: '0.45rem 0.95rem',
              borderRadius: '8px',
              fontSize: '0.82rem',
              fontWeight: 700,
              border: 'none',
              background: subTab === 'pending_stitching' ? '#ffffff' : 'transparent',
              color: subTab === 'pending_stitching' ? '#4f46e5' : '#64748b',
              boxShadow: subTab === 'pending_stitching' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              cursor: 'pointer',
            }}
          >
            Pending Stitching Orders
          </button>
        </div>
      </div>

      {/* Sub Tab: Sales & Stock */}
      {subTab === 'sales_stock' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
            <input
              type="text"
              placeholder="Search product, size, colour or SKU..."
              className="form-input"
              style={{ maxWidth: '340px' }}
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
            />
            <span style={{ fontSize: '0.85rem', color: '#64748b', alignSelf: 'center' }}>
              Showing {filteredSalesStock.length} variant items
            </span>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ width: '100%', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ background: '#f8fafc', textAlign: 'left' }}>
                  <th style={{ padding: '0.65rem' }}>Product Name</th>
                  <th style={{ padding: '0.65rem' }}>Category</th>
                  <th style={{ padding: '0.65rem' }}>Size</th>
                  <th style={{ padding: '0.65rem' }}>Colour</th>
                  <th style={{ padding: '0.65rem' }}>SKU</th>
                  <th style={{ padding: '0.65rem', textAlign: 'right' }}>Selling Rate</th>
                  <th style={{ padding: '0.65rem', textAlign: 'right' }}>Current Stock</th>
                  <th style={{ padding: '0.65rem', textAlign: 'right' }}>Sold Units</th>
                  <th style={{ padding: '0.65rem', textAlign: 'right' }}>Total Revenue</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={9} style={{ textAlign: 'center', padding: '2rem', color: '#64748b' }}>
                      Loading size &amp; colour sales data...
                    </td>
                  </tr>
                ) : filteredSalesStock.length === 0 ? (
                  <tr>
                    <td colSpan={9} style={{ textAlign: 'center', padding: '2rem', color: '#64748b' }}>
                      No variant sales records found.
                    </td>
                  </tr>
                ) : (
                  filteredSalesStock.map((row) => (
                    <tr key={row.variantId} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '0.65rem', fontWeight: 700 }}>{row.productName}</td>
                      <td style={{ padding: '0.65rem', color: '#64748b' }}>{row.categoryName}</td>
                      <td style={{ padding: '0.65rem' }}>
                        <span style={{ background: '#1e293b', color: '#fff', padding: '2px 6px', borderRadius: '4px', fontWeight: 800, fontSize: '0.75rem' }}>
                          {row.size}
                        </span>
                      </td>
                      <td style={{ padding: '0.65rem' }}>
                        <span style={{ background: '#f1f5f9', color: '#334155', padding: '2px 6px', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '0.75rem' }}>
                          {row.colour}
                        </span>
                      </td>
                      <td style={{ padding: '0.65rem', color: '#64748b', fontFamily: 'monospace' }}>{row.sku || '—'}</td>
                      <td style={{ padding: '0.65rem', textAlign: 'right', fontWeight: 700 }}>{formatRupees(row.priceMinor)}</td>
                      <td style={{ padding: '0.65rem', textAlign: 'right', fontWeight: 800, color: row.stockMilli > 0 ? '#10b981' : '#ef4444' }}>
                        {row.stockMilli / 1000}
                      </td>
                      <td style={{ padding: '0.65rem', textAlign: 'right', fontWeight: 700 }}>{row.soldQtyMilli / 1000}</td>
                      <td style={{ padding: '0.65rem', textAlign: 'right', fontWeight: 800, color: '#4f46e5' }}>
                        {formatRupees(row.totalRevenueMinor)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Sub Tab: Dead Stock */}
      {subTab === 'dead_stock' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#475569' }}>Unsold Duration:</span>
              {[30, 60, 90].map((d) => (
                <button
                  key={d}
                  type="button"
                  style={{
                    padding: '0.35rem 0.75rem',
                    borderRadius: '6px',
                    fontSize: '0.8rem',
                    fontWeight: 700,
                    border: '1px solid',
                    borderColor: deadStockDays === d ? '#dc2626' : '#cbd5e1',
                    background: deadStockDays === d ? '#dc2626' : '#ffffff',
                    color: deadStockDays === d ? '#ffffff' : '#475569',
                    cursor: 'pointer',
                  }}
                  onClick={() => setDeadStockDays(d)}
                >
                  {d}+ Days
                </button>
              ))}
            </div>
            <div style={{ fontSize: '0.85rem', color: '#64748b' }}>
              Total Tied-up Dead Stock Value:{' '}
              <strong style={{ color: '#dc2626' }}>
                {formatRupees(deadStockData.reduce((sum, r) => sum + (r.stockValueMinor || 0), 0))}
              </strong>
            </div>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ width: '100%', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ background: '#fef2f2', textAlign: 'left' }}>
                  <th style={{ padding: '0.65rem' }}>Product Name</th>
                  <th style={{ padding: '0.65rem' }}>Size</th>
                  <th style={{ padding: '0.65rem' }}>Colour</th>
                  <th style={{ padding: '0.65rem' }}>SKU</th>
                  <th style={{ padding: '0.65rem', textAlign: 'right' }}>Unsold Units</th>
                  <th style={{ padding: '0.65rem', textAlign: 'right' }}>Unit Cost</th>
                  <th style={{ padding: '0.65rem', textAlign: 'right' }}>Tied-up Capital</th>
                  <th style={{ padding: '0.65rem' }}>Last Sale Recorded</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={8} style={{ textAlign: 'center', padding: '2rem', color: '#64748b' }}>
                      Analyzing dead stock ageing...
                    </td>
                  </tr>
                ) : deadStockData.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ textAlign: 'center', padding: '2rem', color: '#16a34a', fontWeight: 600 }}>
                      🎉 Excellent inventory velocity! No dead stock found for {deadStockDays}+ days.
                    </td>
                  </tr>
                ) : (
                  deadStockData.map((row) => (
                    <tr key={row.variantId} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '0.65rem', fontWeight: 700 }}>{row.productName}</td>
                      <td style={{ padding: '0.65rem' }}>
                        <span style={{ background: '#1e293b', color: '#fff', padding: '2px 6px', borderRadius: '4px', fontWeight: 800, fontSize: '0.75rem' }}>
                          {row.size}
                        </span>
                      </td>
                      <td style={{ padding: '0.65rem' }}>
                        <span style={{ background: '#f1f5f9', color: '#334155', padding: '2px 6px', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '0.75rem' }}>
                          {row.colour}
                        </span>
                      </td>
                      <td style={{ padding: '0.65rem', color: '#64748b', fontFamily: 'monospace' }}>{row.sku || '—'}</td>
                      <td style={{ padding: '0.65rem', textAlign: 'right', fontWeight: 800, color: '#dc2626' }}>
                        {row.stockMilli / 1000}
                      </td>
                      <td style={{ padding: '0.65rem', textAlign: 'right' }}>{formatRupees(row.costMinor)}</td>
                      <td style={{ padding: '0.65rem', textAlign: 'right', fontWeight: 800, color: '#dc2626' }}>
                        {formatRupees(row.stockValueMinor)}
                      </td>
                      <td style={{ padding: '0.65rem', color: '#64748b' }}>
                        {row.lastSoldAt ? new Date(row.lastSoldAt).toLocaleDateString('en-IN') : 'Never Sold (Since Added)'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Sub Tab: Pending Stitching */}
      {subTab === 'pending_stitching' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
            <span style={{ fontSize: '0.85rem', color: '#64748b' }}>
              Active stitching orders queued or on the tailor table
            </span>
            <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#ea580c' }}>
              Pending Balance to Collect:{' '}
              {formatRupees(pendingTailoringData.reduce((sum, r) => sum + (r.balanceMinor || 0), 0))}
            </span>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ width: '100%', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ background: '#f8fafc', textAlign: 'left' }}>
                  <th style={{ padding: '0.65rem' }}>Order #</th>
                  <th style={{ padding: '0.65rem' }}>Customer</th>
                  <th style={{ padding: '0.65rem' }}>Service Type</th>
                  <th style={{ padding: '0.65rem' }}>Delivery Due Date</th>
                  <th style={{ padding: '0.65rem' }}>Measurements (Ch / W / L)</th>
                  <th style={{ padding: '0.65rem', textAlign: 'right' }}>Total</th>
                  <th style={{ padding: '0.65rem', textAlign: 'right' }}>Advance</th>
                  <th style={{ padding: '0.65rem', textAlign: 'right' }}>Balance Due</th>
                  <th style={{ padding: '0.65rem' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={9} style={{ textAlign: 'center', padding: '2rem', color: '#64748b' }}>
                      Loading pending stitching orders...
                    </td>
                  </tr>
                ) : pendingTailoringData.length === 0 ? (
                  <tr>
                    <td colSpan={9} style={{ textAlign: 'center', padding: '2rem', color: '#16a34a', fontWeight: 600 }}>
                      ✓ All stitching orders are completed and delivered!
                    </td>
                  </tr>
                ) : (
                  pendingTailoringData.map((row) => {
                    const isDueSoon = new Date(row.dueDate).getTime() - Date.now() < 86400000 * 2;
                    return (
                      <tr key={row.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '0.65rem', fontWeight: 800 }}>#{row.orderNumber}</td>
                        <td style={{ padding: '0.65rem' }}>
                          <div style={{ fontWeight: 700 }}>{row.customerName}</div>
                          <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{row.customerPhone || '—'}</div>
                        </td>
                        <td style={{ padding: '0.65rem', textTransform: 'capitalize' }}>{row.serviceType.replace('_', ' ')}</td>
                        <td style={{ padding: '0.65rem', fontWeight: 700, color: isDueSoon ? '#dc2626' : '#1e293b' }}>
                          {row.dueDate} {isDueSoon ? '⚠️' : ''}
                        </td>
                        <td style={{ padding: '0.65rem', color: '#475569', fontSize: '0.78rem' }}>
                          {row.chest ? `Chest: ${row.chest}" ` : ''}
                          {row.waist ? `Waist: ${row.waist}" ` : ''}
                          {row.length ? `Len: ${row.length}"` : ''}
                        </td>
                        <td style={{ padding: '0.65rem', textAlign: 'right', fontWeight: 700 }}>{formatRupees(row.totalMinor)}</td>
                        <td style={{ padding: '0.65rem', textAlign: 'right', color: '#16a34a' }}>{formatRupees(row.advancePaidMinor)}</td>
                        <td style={{ padding: '0.65rem', textAlign: 'right', fontWeight: 800, color: row.balanceMinor > 0 ? '#ea580c' : '#16a34a' }}>
                          {formatRupees(row.balanceMinor)}
                        </td>
                        <td style={{ padding: '0.65rem' }}>
                          <span style={{ padding: '2px 6px', borderRadius: '4px', fontSize: '0.72rem', fontWeight: 700, background: '#fef3c7', color: '#b45309', textTransform: 'uppercase' }}>
                            {row.status}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
