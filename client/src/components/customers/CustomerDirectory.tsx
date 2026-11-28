import React, { useState, useMemo, useEffect } from 'react';
import type { Party, Shop, Invoice } from '../../api.ts';
import { normalizePhone } from '../../../../shared/whatsapp.ts';
import { LoyaltySchemeModal } from '../loyalty/LoyaltySchemeModal.tsx';
import './CustomerDirectory.css';

export interface CustomerDirectoryProps {
  parties: Party[];
  invoices?: Invoice[];
  duesSummary?: any; // kept optional for backwards compat
  shop: Shop | null;
  onAddCustomer: () => void;
  onEditCustomer: (customer: Party) => void;
  onCollectPayment?: (customer: Party) => void;
  onOpenLedger?: (customer: Party) => void;
  onToggleActive: (customer: Party) => void;
  onSelectForBilling?: (customer: Party) => void;
  onUpdateLoyaltySettings?: (settings: {
    loyaltyEnabled: boolean;
    loyaltyPointsPer100: number;
    loyaltyPointValueMinor: number;
    loyaltyMinPointsRedeem: number;
  }) => Promise<void>;
  onRefresh?: () => void;
}

export function formatRupees(paise: number = 0): string {
  return '₹' + (paise / 100).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatPointsValue(points: number = 0, pointValueMinor: number = 10): string {
  const rupees = points * (pointValueMinor / 100);
  return '₹' + rupees.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function getAvatarColor(name: string): { bg: string; text: string; border: string } {
  const colors = [
    { bg: '#eef2ff', text: '#4f46e5', border: '#c7d2fe' }, // Indigo
    { bg: '#ecfdf5', text: '#059669', border: '#a7f3d0' }, // Emerald
    { bg: '#fdf4ff', text: '#9333ea', border: '#f0abfc' }, // Purple
    { bg: '#fff7ed', text: '#ea580c', border: '#fed7aa' }, // Orange
    { bg: '#f0fdfa', text: '#0d9488', border: '#99f6e4' }, // Teal
    { bg: '#eff6ff', text: '#2563eb', border: '#bfdbfe' }, // Blue
  ];
  let hash = 0;
  for (let i = 0; i < (name || '').length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

export const CustomerDirectory: React.FC<CustomerDirectoryProps> = ({
  parties,
  invoices = [],
  shop,
  onAddCustomer,
  onEditCustomer,
  onToggleActive,
  onUpdateLoyaltySettings,
  onRefresh,
}) => {
  // Active Shop Loyalty Scheme Configuration (with defaults)
  const activePointsPer100 = shop?.loyaltyPointsPer100 ?? 10;
  const activePointValMinor = shop?.loyaltyPointValueMinor ?? 10;
  const activePointValRupees = activePointValMinor / 100;
  const activeLoyaltyEnabled = shop?.loyaltyEnabled ?? true;
  const activeMinRedeem = shop?.loyaltyMinPointsRedeem ?? 10;

  // Modal State for Custom Loyalty Points Scheme
  const [isLoyaltyModalOpen, setIsLoyaltyModalOpen] = useState(false);

  // State
  const [searchTerm, setSearchTerm] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'has_points' | 'zero_points' | 'inactive'>('all');
  const [sortBy, setSortBy] = useState<'points_desc' | 'points_asc' | 'name_asc'>('name_asc');
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('cards');
  const [selectedCustomer, setSelectedCustomer] = useState<Party | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Filter customers to strictly retail customer parties (excluding wholesale customers)
  const customersList = useMemo(() => {
    return parties.filter(
      (p) =>
        (p.type === 'customer' || !p.type) &&
        p.customerType !== 'wholesale'
    );
  }, [parties]);

  // Dynamic Customer Points & Invoice History:
  // Points are dynamic and synchronized directly with backend PostgreSQL database!
  const getCustomerPointsData = (party: Party) => {
    const custInvoices = invoices.filter(
      (inv) =>
        (inv.partyId === party.id || (party.phone && inv.customerPhone === party.phone)) &&
        inv.status !== 'cancelled' &&
        inv.kind !== 'credit_note'
    );

    const purchaseTotalPaise = custInvoices.reduce((sum, inv) => sum + (inv.totalMinor || 0), 0);
    const totalPoints = party.loyaltyPoints ?? 0;

    return {
      points: totalPoints,
      purchaseCount: custInvoices.length,
      totalSpendMinor: purchaseTotalPaise,
      invoices: custInvoices,
    };
  };

  // Derived metrics for Bento Cards
  const kpiStats = useMemo(() => {
    let totalCustomers = customersList.length;
    let totalPoints = 0;
    let hasPointsCount = 0;
    let zeroPointsCount = 0;
    let inactiveCount = 0;

    customersList.forEach((c) => {
      if (c.active === false) inactiveCount++;
      const data = getCustomerPointsData(c);
      totalPoints += data.points;
      if (data.points > 0) hasPointsCount++;
      else zeroPointsCount++;
    });

    const totalRupeesValue = totalPoints * activePointValRupees;

    return {
      totalCustomers,
      totalPoints,
      totalRupeesValue,
      hasPointsCount,
      zeroPointsCount,
      inactiveCount,
    };
  }, [customersList, invoices, activePointValRupees]);

  // Filter and Sort Customers
  const filteredCustomers = useMemo(() => {
    let list = customersList.filter((c) => {
      const data = getCustomerPointsData(c);

      // 1. Search Query (Name or Phone)
      if (searchTerm.trim()) {
        const q = searchTerm.trim().toLowerCase();
        const matches =
          c.name.toLowerCase().includes(q) ||
          (c.phone && c.phone.includes(q));
        if (!matches) return false;
      }

      // 2. Filter Tabs
      if (filterMode === 'inactive') return c.active === false;
      if (filterMode === 'has_points') return data.points > 0 && c.active !== false;
      if (filterMode === 'zero_points') return data.points === 0 && c.active !== false;

      return true;
    });

    // 3. Sorting
    list = [...list].sort((a, b) => {
      const pa = getCustomerPointsData(a).points;
      const pb = getCustomerPointsData(b).points;

      if (sortBy === 'points_desc') return pb - pa;
      if (sortBy === 'points_asc') return pa - pb;
      if (sortBy === 'name_asc') return a.name.localeCompare(b.name);
      return 0;
    });

    return list;
  }, [customersList, invoices, searchTerm, filterMode, sortBy]);

  // Copy phone helper
  const handleCopy = (text: string, id: string) => {
    if (!text) return;
    navigator.clipboard?.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Export CSV
  const handleExportCSV = () => {
    const headers = [
      'Customer Name',
      'Mobile Phone',
      'Email',
      'Loyalty Points Balance',
      'Cash Discount Value (INR)',
      'Status',
    ];

    const rows = filteredCustomers.map((c) => {
      const { points } = getCustomerPointsData(c);
      const cashVal = (points * 0.1).toFixed(2);

      return [
        `"${c.name.replace(/"/g, '""')}"`,
        `"${c.phone || ''}"`,
        `"${c.email || ''}"`,
        points,
        cashVal,
        c.active !== false ? 'Active' : 'Inactive',
      ];
    });

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `customer_points_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="customer-dir-root">
      {/* 1. TOP BENTO KPI METRICS: CLEAN 3-CARD SUMMARY */}
      <div className="customer-kpi-grid">
        {/* Total Customers */}
        <div
          className={`customer-kpi-card purple ${filterMode === 'all' ? 'selected' : ''}`}
          onClick={() => setFilterMode('all')}
          title="Click to view all registered customers"
        >
          <div className="kpi-card-header">
            <span className="kpi-icon-box purple">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                <circle cx="9" cy="7" r="4"></circle>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
              </svg>
            </span>
            <span className="kpi-tag purple">Total Registered</span>
          </div>
          <div className="kpi-val mono">{kpiStats.totalCustomers}</div>
          <div className="kpi-label">Total Customers</div>
          <div className="kpi-sub">Customers registered with name &amp; phone</div>
        </div>
      </div>

      {/* 2. CONTROLS, SEARCH & FILTER TOOLBAR */}
      <div className="customer-main-card">
        <div className="customer-card-header">
          <div className="header-info-group">
            <div className="header-icon-box">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="6" x2="12" y2="18"></line>
                <path d="M16 9.5a2.5 2.5 0 0 0-5 0c0 4 5 2 5 6a2.5 2.5 0 0 1-5 0"></path>
              </svg>
            </div>
            <div>
              <p className="header-subtitle" style={{ margin: 0 }}>
                Customer Name and Mobile Number Directory
              </p>
            </div>
          </div>

          <div className="header-actions-group">
            <button
              type="button"
              className="customer-primary-add-btn"
              onClick={onAddCustomer}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
              <span>Add Customer</span>
            </button>

            <div className="customer-sub-actions-row">
              <button
                type="button"
                className="btn-export-csv"
                onClick={handleExportCSV}
                title="Download customer list as CSV"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                  <polyline points="7 10 12 15 17 10"></polyline>
                  <line x1="12" y1="15" x2="12" y2="3"></line>
                </svg>
                <span>Export CSV</span>
              </button>
            </div>
          </div>
        </div>

        {/* FILTER STRIP & SEARCH */}
        <div className="customer-filter-strip">
          <div className="filter-pills-row">
            <button
              type="button"
              className={`filter-pill ${filterMode === 'all' ? 'active' : ''}`}
              onClick={() => setFilterMode('all')}
            >
              All Customers <span className="pill-count">{kpiStats.totalCustomers}</span>
            </button>
            {kpiStats.inactiveCount > 0 && (
              <button
                type="button"
                className={`filter-pill slate ${filterMode === 'inactive' ? 'active' : ''}`}
                onClick={() => setFilterMode('inactive')}
              >
                Inactive <span className="pill-count">{kpiStats.inactiveCount}</span>
              </button>
            )}
          </div>

          <div className="search-and-sort-group">
            <div className="customer-search-input-wrap">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2.2">
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
              <input
                type="text"
                placeholder="Search customer name, mobile (+91)..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
              {searchTerm && (
                <button type="button" className="clear-search-btn" onClick={() => setSearchTerm('')}>
                  ✕
                </button>
              )}
            </div>

            <div className="customer-sort-and-view-row">
              <div className="sort-dropdown-wrap">
                <label htmlFor="customer-sort">Sort:</label>
                <select
                  id="customer-sort"
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as any)}
                >
                  <option value="name_asc">Name (A–Z)</option>
                </select>
              </div>

              {/* Mobile View Toggle Switcher (Cards vs Table) */}
              <div className="customer-view-toggle">
                <button
                  type="button"
                  onClick={() => setViewMode('cards')}
                  className={`customer-toggle-btn ${viewMode === 'cards' ? 'active' : ''}`}
                  title="Card View (Mobile Optimized)"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="7" height="7"></rect>
                    <rect x="14" y="3" width="7" height="7"></rect>
                    <rect x="14" y="14" width="7" height="7"></rect>
                    <rect x="3" y="14" width="7" height="7"></rect>
                  </svg>
                  <span>Cards</span>
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('table')}
                  className={`customer-toggle-btn ${viewMode === 'table' ? 'active' : ''}`}
                  title="Table View (Full Columns)"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18"></path>
                  </svg>
                  <span>Table</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* 3A. MOBILE CARDS VIEW (Responsive view for touch/mobile screens) */}
        <div className={`customer-mobile-cards-wrap ${viewMode === 'cards' ? 'active' : ''}`}>
          {filteredCustomers.map((c) => {
            const data = getCustomerPointsData(c);
            const avatarStyle = getAvatarColor(c.name);
            const pointsValueStr = formatPointsValue(data.points);

            return (
              <div
                key={c.id}
                className={`customer-m-card ${c.active === false ? 'inactive-card' : ''}`}
                onClick={() => setSelectedCustomer(c)}
                title="Tap to view customer profile & bills"
              >
                {/* Card Header: Avatar, Name, Phone & Quick Actions */}
                <div className="customer-m-header">
                  <div className="customer-m-identity">
                    <div
                      className="customer-avatar"
                      style={{
                        background: avatarStyle.bg,
                        color: avatarStyle.text,
                        borderColor: avatarStyle.border,
                      }}
                    >
                      {c.name.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="customer-m-name-group">
                      <div className="customer-m-name-row">
                        <span className="customer-full-name">{c.name}</span>
                        {c.active === false && (
                          <span className="badge-inactive-tag">Inactive</span>
                        )}
                      </div>
                      {c.phone ? (
                        <div className="customer-m-phone-row" onClick={(e) => e.stopPropagation()}>
                          <a
                            href={`tel:${c.phone}`}
                            className="customer-m-phone-link"
                            title="Tap to call"
                          >
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>
                            </svg>
                            <span>{c.phone}</span>
                          </a>
                          <button
                            type="button"
                            className="phone-copy-mini-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCopy(c.phone!, c.id);
                            }}
                            title="Copy mobile number"
                          >
                            {copiedId === c.id ? 'Copied!' : '📋'}
                          </button>
                        </div>
                      ) : (
                        <span className="text-muted" style={{ fontSize: '0.74rem' }}>No mobile</span>
                      )}
                    </div>
                  </div>

                  <div className="customer-m-quick-actions" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      className="btn-action-edit mini"
                      onClick={() => onEditCustomer(c)}
                      title="Edit customer details"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                        <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path>
                      </svg>
                      <span>Edit</span>
                    </button>
                  </div>
                </div>

                {/* Card Body: Spend metrics */}
                <div className="customer-m-stats-row">
                  <div className="customer-m-stat-box spend">
                    <span className="stat-label">Total Spend</span>
                    <div className="stat-val-bold mono" style={{ color: '#0f172a' }}>
                      {formatRupees(data.totalSpendMinor)}
                    </div>
                    <div className="customer-m-val-sub">
                      {data.purchaseCount} {data.purchaseCount === 1 ? 'order' : 'orders'}
                    </div>
                  </div>
                </div>

                {/* Card Footer: View profile link & toggle status */}
                <div className="customer-m-footer">
                  <span className="customer-m-view-link">
                    <span>View Profile &amp; Bills</span>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </span>
                  <button
                    type="button"
                    className={`btn-action-toggle mini ${c.active !== false ? 'deactivate' : 'activate'}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleActive(c);
                    }}
                  >
                    {c.active !== false ? 'Deactivate' : 'Activate'}
                  </button>
                </div>
              </div>
            );
          })}

          {filteredCustomers.length === 0 && (
            <div className="customer-empty-state">
              <div className="empty-icon-box">
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.8">
                  <circle cx="11" cy="11" r="8"></circle>
                  <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                </svg>
              </div>
              <h3>No customers matched your search</h3>
              <p>Try searching for a different customer name or mobile number.</p>
              <button
                type="button"
                className="btn-reset-filters"
                onClick={() => {
                  setSearchTerm('');
                  setFilterMode('all');
                }}
              >
                Reset All Filters
              </button>
            </div>
          )}
        </div>

        {/* 3B. CLEAN & SIMPLE GRID: NAME, NUMBER, POINTS & CLEAN ACTIONS (Desktop & Table View) */}
        <div className={`customer-table-container ${viewMode === 'cards' ? 'mobile-hidden' : 'mobile-active'}`}>
          {viewMode === 'table' && (
            <div className="customer-scroll-hint">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="18 8 22 12 18 16" />
                <polyline points="6 8 2 12 6 16" />
                <line x1="2" y1="12" x2="22" y2="12" />
              </svg>
              <span>Swipe horizontally to view all columns</span>
            </div>
          )}
          <table className="customer-modern-table">
            <thead>
              <tr>
                <th className="col-sticky-customer" style={{ width: '48%', minWidth: '220px' }}>CUSTOMER NAME</th>
                <th style={{ width: '36%', minWidth: '180px' }}>MOBILE NUMBER</th>
                <th style={{ width: '16%', minWidth: '130px', textAlign: 'right' }}>ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {filteredCustomers.map((c) => {
                const data = getCustomerPointsData(c);
                const avatarStyle = getAvatarColor(c.name);
                const pointsValueStr = formatPointsValue(data.points);

                return (
                  <tr
                    key={c.id}
                    className={`customer-row ${c.active === false ? 'inactive-row' : ''}`}
                    onClick={() => setSelectedCustomer(c)}
                  >
                    {/* Customer Name & Avatar (Sticky on horizontal scroll) */}
                    <td className="col-sticky-customer">
                      <div className="customer-cell-identity">
                        <div
                          className="customer-avatar"
                          style={{
                            background: avatarStyle.bg,
                            color: avatarStyle.text,
                            borderColor: avatarStyle.border,
                          }}
                        >
                          {(c.name || 'C').slice(0, 2).toUpperCase()}
                        </div>
                        <div className="customer-name-group">
                          <span className="customer-full-name">{c.name}</span>
                          {c.active === false && (
                            <span className="badge-inactive-tag">Inactive</span>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* Mobile Number */}
                    <td>
                      <div className="customer-contact-cell">
                        {c.phone ? (
                          <div
                            className="phone-copy-chip"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCopy(c.phone!, c.id);
                            }}
                            title="Click to copy 10-digit mobile number"
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>
                            </svg>
                            <span className="mono bold">{c.phone}</span>
                            <span className="copy-label">{copiedId === c.id ? 'Copied!' : '📋'}</span>
                          </div>
                        ) : (
                          <span className="text-muted">No mobile registered</span>
                        )}
                      </div>
                    </td>

                    {/* Clean Actions: Edit & Deactivate */}
                    <td>
                      <div className="customer-actions-row" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          className="btn-action-edit"
                          onClick={() => onEditCustomer(c)}
                          title="Edit customer details"
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                            <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path>
                          </svg>
                          <span>Edit</span>
                        </button>

                        <button
                          type="button"
                          className={`btn-action-toggle ${c.active !== false ? 'deactivate' : 'activate'}`}
                          onClick={() => onToggleActive(c)}
                          title={c.active !== false ? 'Deactivate customer' : 'Activate customer'}
                        >
                          {c.active !== false ? 'Deactivate' : 'Activate'}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {filteredCustomers.length === 0 && (
                <tr>
                  <td colSpan={4}>
                    <div className="customer-empty-state">
                      <div className="empty-icon-box">
                        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.8">
                          <circle cx="11" cy="11" r="8"></circle>
                          <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                        </svg>
                      </div>
                      <h3>No customers matched your search</h3>
                      <p>Try searching for a different customer name or mobile number.</p>
                      <button
                        type="button"
                        className="btn-reset-filters"
                        onClick={() => {
                          setSearchTerm('');
                          setFilterMode('all');
                        }}
                      >
                        Reset All Filters
                      </button>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 4. CUSTOMER PROFILE DRAWER */}
      {selectedCustomer && (
        <div className="customer-drawer-backdrop" onClick={() => setSelectedCustomer(null)}>
          <div className="customer-drawer-panel" onClick={(e) => e.stopPropagation()}>
            {/* Drawer Header */}
            <div className="drawer-header">
              <div className="drawer-customer-title">
                {(() => {
                  const style = getAvatarColor(selectedCustomer.name);
                  return (
                    <div
                      className="drawer-avatar"
                      style={{
                        background: style.bg,
                        color: style.text,
                        borderColor: style.border,
                      }}
                    >
                      {(selectedCustomer.name || 'C').slice(0, 2).toUpperCase()}
                    </div>
                  );
                })()}
                <div>
                  <h3 className="drawer-name">{selectedCustomer.name}</h3>
                  <div className="drawer-badges">
                    <span className={`status-badge-chip ${selectedCustomer.active !== false ? 'active' : 'inactive'}`}>
                      ● {selectedCustomer.active !== false ? 'Active Customer' : 'Inactive'}
                    </span>
                  </div>
                </div>
              </div>
              <button
                type="button"
                className="drawer-close-btn"
                onClick={() => setSelectedCustomer(null)}
                title="Close Customer Profile"
              >
                ✕
              </button>
            </div>

            {/* Drawer Body */}
            <div className="drawer-body">
              {/* DIGITAL CUSTOMER POINTS CARD */}
              {(() => {
                const data = getCustomerPointsData(selectedCustomer);

                return (
                  <div className="supermarket-digital-card">
                    <div className="card-top-row">
                      <div className="card-brand">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                          <circle cx="12" cy="12" r="10"></circle>
                          <line x1="12" y1="6" x2="12" y2="18"></line>
                        </svg>
                        <span>{shop?.name ? shop.name.toUpperCase() : 'STORE'} REWARDS</span>
                      </div>
                    </div>

                    <div className="card-chip-graphic">
                      <svg width="34" height="26" viewBox="0 0 34 26" fill="none">
                        <rect width="34" height="26" rx="4" fill="#fbbf24" fillOpacity="0.85"></rect>
                        <path d="M0 13h34M17 0v26M10 0v26M24 0v26" stroke="#b45309" strokeWidth="1.2"></path>
                      </svg>
                    </div>

                    <div className="card-bottom-row">
                      <div className="card-holder-info">
                        <span className="c-label">CUSTOMER NAME</span>
                        <span className="c-name">{selectedCustomer.name.toUpperCase()}</span>
                      </div>
                      <div className="card-phone-info">
                        <span className="c-label">MOBILE NUMBER</span>
                        <span className="c-phone mono">{selectedCustomer.phone || 'NO MOBILE'}</span>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Customer Contact */}
              <div className="drawer-section">
                <h4 className="section-heading">Contact Details</h4>
                <div className="drawer-info-list">
                  <div className="drawer-info-item">
                    <span className="info-key">Mobile Number</span>
                    <span className="info-val mono bold">{selectedCustomer.phone || 'Not registered'}</span>
                  </div>
                  {selectedCustomer.email && (
                    <div className="drawer-info-item">
                      <span className="info-key">Email Address</span>
                      <span className="info-val">{selectedCustomer.email}</span>
                    </div>
                  )}
                  {selectedCustomer.address && (
                    <div className="drawer-info-item">
                      <span className="info-key">Address / Location</span>
                      <span className="info-val">{selectedCustomer.address}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Recent Bills that Credited Points Automatically */}
              {(() => {
                const data = getCustomerPointsData(selectedCustomer);

                return (
                  <div className="drawer-section">
                    <h4 className="section-heading">Recent Purchases</h4>
                    <div className="points-history-list">
                      {data.invoices && data.invoices.length > 0 ? (
                        data.invoices.slice(0, 5).map((inv) => {
                          return (
                            <div key={inv.id} className="history-item-row">
                              <div className="history-item-left">
                                <span className="history-dot earned"></span>
                                <div>
                                  <div className="history-desc">Bill #{inv.number}</div>
                                  <div className="history-date">
                                    {formatRupees(inv.totalMinor)} • {inv.bdate || new Date(inv.createdAt).toLocaleDateString('en-IN')}
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })
                      ) : (
                        <div style={{ fontSize: '0.82rem', color: '#94a3b8', fontStyle: 'italic', padding: '0.5rem 0' }}>
                          No purchases recorded yet.
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* Drawer Quick Actions */}
              <div className="drawer-actions-box">
                <button
                  type="button"
                  className="drawer-btn secondary"
                  onClick={() => {
                    onEditCustomer(selectedCustomer);
                    setSelectedCustomer(null);
                  }}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                    <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path>
                  </svg>
                  <span>Edit Customer Details</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
