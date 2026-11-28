import React, { useState, useEffect, useRef } from 'react';
import {
  LayoutDashboard,
  ShoppingCart,
  Warehouse,
  Clock,
  Receipt,
  Lock,
  Package,
  Tag,
  Layers,
  BarChart2,
  Percent,
  Users,
  Truck,
  Briefcase,
  Bell,
  UserCog,
  Settings,
  LogOut,
  MoreHorizontal,
  X,
  ChevronRight,
  TrendingUp,
  FileText,
  DollarSign,
  ArrowRightLeft,
  Sliders,
  CreditCard,
  ShoppingBag,
} from 'lucide-react';
import type { User, Shop, Party } from '../../api';
import { Tooltip } from '../common/Tooltip';

export interface ResponsiveNavbarProps {
  user: User;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  shop: Shop | null;
  isModuleVisible: (key: string) => boolean;
  activeShiftNumber?: string | null;
  unreadShiftNotifCount?: number;
  itemsCount?: number;
  parties?: Party[];
  onLogout: () => void;
  onOpenSettings: () => void;
  onInventoryClick: () => void;
  onPurchasesClick: () => void;
}

interface MobileNavItem {
  id: string;
  label: string;
  fullLabel: string;
  icon: React.ReactNode;
  badge?: string | number | null;
  badgeActive?: boolean;
}

interface TabletNavItem {
  id: string;
  label: string;
  fullLabel: string;
  icon: ((active: boolean) => React.ReactNode) | React.ReactNode;
  visible?: boolean;
  badge?: string | number | null;
  badgeActive?: boolean;
}

export const ResponsiveNavbar: React.FC<ResponsiveNavbarProps> = ({
  user,
  activeTab,
  setActiveTab,
  shop,
  isModuleVisible,
  activeShiftNumber = null,
  unreadShiftNotifCount = 0,
  itemsCount = 0,
  parties = [],
  onLogout,
  onOpenSettings,
  onInventoryClick,
  onPurchasesClick,
}) => {
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);

  const isCashier = user?.role === 'cashier';
  const isSuperAdmin = Boolean(
    user && (user.role === 'owner' || user.role === 'admin' || String(user.role).toUpperCase() === 'SUPER_ADMIN' || String(user.role).toLowerCase() === 'superadmin' || String(user.role).toLowerCase() === 'admin' || String(user.role).toLowerCase() === 'owner')
  );
  const isManager = Boolean(
    user && (user.role === 'manager' || user.role === 'store_manager' || String(user.role).toLowerCase() === 'storemanager' || String(user.role).toLowerCase() === 'manager' || String(user.role).toLowerCase() === 'store_manager')
  );
  const hideBottomNav = isSuperAdmin || isManager;

  // Close more menu on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowMoreMenu(false);
    };
    if (showMoreMenu) {
      window.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [showMoreMenu]);

  const handleSelectTab = (tab: string) => {
    setShowMoreMenu(false);
    if (tab === 'purchases') {
      onPurchasesClick();
    } else if (tab === 'inventory') {
      onInventoryClick();
    } else if (tab === 'settings') {
      onOpenSettings();
    } else {
      setActiveTab(tab);
    }
  };

  // Determine Primary Mobile Navigation Items (Max 4 items + More button)
  const mobilePrimaryItems: MobileNavItem[] = (() => {
    if (isCashier) {
      return [
        {
          id: 'pos',
          label: 'POS',
          fullLabel: 'POS Counter',
          icon: <ShoppingCart size={21} strokeWidth={2.2} />,
          badge: null,
        },
        {
          id: 'shifts',
          label: 'Shifts',
          fullLabel: 'My Cashier Shift',
          icon: <Clock size={21} strokeWidth={2.2} />,
          badge: activeShiftNumber ? 'Active' : null,
          badgeActive: Boolean(activeShiftNumber),
        },
        {
          id: 'invoices',
          label: 'Bills',
          fullLabel: 'Recent Bills',
          icon: <Receipt size={21} strokeWidth={2.2} />,
          badge: null,
        },
        {
          id: 'day-closing',
          label: 'Closing',
          fullLabel: 'Day Closing',
          icon: <Lock size={21} strokeWidth={2.2} />,
          badge: null,
        },
      ];
    }

    if (isSuperAdmin) {
      return [
        {
          id: 'dashboard',
          label: 'Dashboard',
          fullLabel: 'HQ Dashboard',
          icon: <LayoutDashboard size={21} strokeWidth={2.2} />,
          badge: null,
        },
        {
          id: 'pos',
          label: 'POS',
          fullLabel: 'POS Counter',
          icon: <ShoppingCart size={21} strokeWidth={2.2} />,
          badge: null,
        },
        {
          id: 'wholesale',
          label: 'Wholesale',
          fullLabel: 'Wholesale Billing',
          icon: <Warehouse size={21} strokeWidth={2.2} />,
          badge: null,
        },
        {
          id: 'items',
          label: 'Products',
          fullLabel: 'Product Catalog',
          icon: <Package size={21} strokeWidth={2.2} />,
          badge: itemsCount > 0 ? itemsCount : null,
        },
      ];
    }

    // Store Manager
    return [
      {
        id: 'dashboard',
        label: 'Dashboard',
        fullLabel: 'Store Dashboard',
        icon: <LayoutDashboard size={21} strokeWidth={2.2} />,
        badge: null,
      },
      {
        id: 'pos',
        label: 'POS',
        fullLabel: 'POS Counter',
        icon: <ShoppingCart size={21} strokeWidth={2.2} />,
        badge: null,
      },
      {
        id: 'items',
        label: 'Products',
        fullLabel: 'Product Catalog',
        icon: <Package size={21} strokeWidth={2.2} />,
        badge: itemsCount > 0 ? itemsCount : null,
      },
      {
        id: 'sales-analysis',
        label: 'Sales',
        fullLabel: 'Sales Analysis',
        icon: <BarChart2 size={21} strokeWidth={2.2} />,
        badge: null,
      },
    ];
  })();

  // Determine Tablet Primary Navigation Items (Vertical Icon Sidebar)
  const tabletPrimaryItems: TabletNavItem[] = (() => {
    if (isCashier) {
      return [
        { id: 'pos', label: 'POS', fullLabel: 'POS Counter', icon: (active: boolean) => <ShoppingCart size={22} strokeWidth={active ? 2.6 : 2.0} /> },
        {
          id: 'shifts',
          label: 'Shifts',
          fullLabel: 'My Cashier Shift',
          icon: (active: boolean) => <Clock size={22} strokeWidth={active ? 2.6 : 2.0} />,
          badge: activeShiftNumber ? 'Active' : null,
          badgeActive: Boolean(activeShiftNumber),
        },
        { id: 'invoices', label: 'Bills', fullLabel: 'Recent Bills', icon: (active: boolean) => <Receipt size={22} strokeWidth={active ? 2.6 : 2.0} /> },
        { id: 'day-closing', label: 'Closing', fullLabel: 'Day Closing', icon: (active: boolean) => <Lock size={22} strokeWidth={active ? 2.6 : 2.0} /> },
      ];
    }

    const items: TabletNavItem[] = [
      { id: 'dashboard', label: 'Dashboard', fullLabel: isSuperAdmin ? 'HQ Dashboard' : 'Store Dashboard', icon: (active: boolean) => <LayoutDashboard size={22} strokeWidth={active ? 2.6 : 2.0} />, visible: isModuleVisible('dashboard') },
      { id: 'pos', label: 'POS', fullLabel: 'POS Counter', icon: (active: boolean) => <ShoppingCart size={22} strokeWidth={active ? 2.6 : 2.0} />, visible: isModuleVisible('pos') },
      { id: 'wholesale', label: 'Wholesale', fullLabel: 'Wholesale Billing', icon: (active: boolean) => <Warehouse size={22} strokeWidth={active ? 2.6 : 2.0} />, visible: isSuperAdmin && isModuleVisible('wholesale') },
      { id: 'items', label: 'Products', fullLabel: 'Product Catalog', icon: (active: boolean) => <Package size={22} strokeWidth={active ? 2.6 : 2.0} />, visible: isModuleVisible('items'), badge: itemsCount > 0 ? itemsCount : null },
      { id: 'sales-analysis', label: 'Sales', fullLabel: 'Sales Analytics', icon: (active: boolean) => <BarChart2 size={22} strokeWidth={active ? 2.6 : 2.0} />, visible: isModuleVisible('sales-analysis') },
      { id: 'customers', label: 'Customers', fullLabel: 'Customer Directory', icon: (active: boolean) => <Users size={22} strokeWidth={active ? 2.6 : 2.0} />, visible: isModuleVisible('customers') },
      { id: 'inventory', label: 'Inventory', fullLabel: 'Inventory Hub', icon: (active: boolean) => <Layers size={22} strokeWidth={active ? 2.6 : 2.0} />, visible: isModuleVisible('inventory') },
    ];

    return items.filter((item) => item.visible !== false);
  })();

  // Secondary Modules List for "More" Sheet/Menu (Categorized)
  const customersCount = parties.filter((p) => (p.type === 'customer' || !p.type) && p.customerType !== 'wholesale').length;
  const suppliersCount = parties.filter((p) => p.type === 'supplier').length;

  return (
    <>
      {/* =========================================================================
          1. TABLET DEDICATED VERTICAL ICON-ONLY SIDEBAR (768px - 1199px)
         ========================================================================= */}
      <aside className="responsive-tablet-sidebar" aria-label="Tablet Vertical Navigation">
        <div className="tab-sidebar-top">
          <Tooltip label={shop?.name || 'Home'} position="right">
            <button
              type="button"
              className="tab-sidebar-brand-btn"
              onClick={() => handleSelectTab(isCashier ? 'pos' : 'dashboard')}
              aria-label={shop?.name || 'Home'}
            >
              {shop?.logoUrl ? (
                <img src={shop.logoUrl} alt="Logo" className="tab-brand-img" />
              ) : (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                  <path d="M12 2L2 22h20L12 2z" />
                </svg>
              )}
            </button>
          </Tooltip>
        </div>

        <div className="tab-sidebar-items">
          {tabletPrimaryItems.map((item) => {
            const isActive = activeTab === item.id;
            const itemLabel = item.fullLabel || item.label;
            return (
              <Tooltip key={item.id} label={itemLabel} position="right">
                <button
                  type="button"
                  className={`tab-icon-item ${isActive ? 'active' : ''}`}
                  onClick={() => handleSelectTab(item.id)}
                  aria-label={itemLabel}
                  aria-current={isActive ? 'page' : undefined}
                >
                  <div className="tab-icon-wrap">
                    {typeof item.icon === 'function' ? item.icon(isActive) : item.icon}
                    {item.badge && (
                      item.badgeActive ? (
                        <span
                          className="tab-icon-badge active-pulse"
                          title="Active"
                          aria-label="Active"
                          role="status"
                        />
                      ) : (
                        <span className="tab-icon-badge">{item.badge}</span>
                      )
                    )}
                  </div>
                </button>
              </Tooltip>
            );
          })}

          <Tooltip label="More Modules" position="right">
            <button
              type="button"
              className={`tab-icon-item tab-more-icon-item ${showMoreMenu ? 'active' : ''}`}
              onClick={() => setShowMoreMenu((prev) => !prev)}
              aria-label="More Modules"
              aria-expanded={showMoreMenu}
            >
              <div className="tab-icon-wrap">
                <MoreHorizontal size={22} strokeWidth={showMoreMenu ? 2.6 : 2.0} />
              </div>
            </button>
          </Tooltip>
        </div>

        <div className="tab-sidebar-bottom">
          {!isCashier && isModuleVisible('notifications') && (
            <Tooltip label={`Notifications (${unreadShiftNotifCount} unread)`} position="right">
              <button
                type="button"
                className={`tab-icon-item ${activeTab === 'notifications' ? 'active' : ''}`}
                onClick={() => handleSelectTab('notifications')}
                aria-label="Notifications"
              >
                <div className="tab-icon-wrap">
                  <Bell size={20} strokeWidth={activeTab === 'notifications' ? 2.6 : 2.0} />
                  {unreadShiftNotifCount > 0 && <span className="tab-notif-dot" />}
                </div>
              </button>
            </Tooltip>
          )}

          {!isCashier && isModuleVisible('settings') && (
            <Tooltip label="Store Settings" position="right">
              <button
                type="button"
                className={`tab-icon-item ${activeTab === 'settings' ? 'active' : ''}`}
                onClick={onOpenSettings}
                aria-label="Settings"
              >
                <div className="tab-icon-wrap">
                  <Settings size={20} strokeWidth={activeTab === 'settings' ? 2.6 : 2.0} />
                </div>
              </button>
            </Tooltip>
          )}

          <Tooltip label="Logout" position="right">
            <button
              type="button"
              className="tab-icon-item tab-logout-icon-item"
              onClick={onLogout}
              aria-label="Logout"
            >
              <div className="tab-icon-wrap">
                <LogOut size={20} strokeWidth={2.0} />
              </div>
            </button>
          </Tooltip>
        </div>
      </aside>

      {/* =========================================================================
          2. MOBILE FIXED BOTTOM NAVIGATION BAR (<= 767px) - ICONS ONLY
         ========================================================================= */}
      {!hideBottomNav && (
        <nav className="responsive-mobile-bottom-nav" aria-label="Mobile Navigation">
          {mobilePrimaryItems.map((item) => {
            const isActive = activeTab === item.id;
            const itemLabel = item.fullLabel || item.label;
            return (
              <Tooltip key={item.id} label={itemLabel} position="top">
                <button
                  type="button"
                  className={`mobile-icon-btn ${isActive ? 'active' : ''}`}
                  onClick={() => handleSelectTab(item.id)}
                  aria-label={itemLabel}
                  aria-current={isActive ? 'page' : undefined}
                >
                  <div className="mobile-icon-wrap">
                    {item.icon}
                    {item.badge && (
                      item.badgeActive ? (
                        <span
                          className="mobile-icon-badge active-pulse"
                          title="Active"
                          aria-label="Active"
                          role="status"
                        />
                      ) : (
                        <span className="mobile-icon-badge">
                          {item.badge}
                        </span>
                      )
                    )}
                  </div>
                </button>
              </Tooltip>
            );
          })}

          <Tooltip label="More Modules and Options" position="top">
            <button
              type="button"
              className={`mobile-icon-btn mobile-more-btn ${showMoreMenu ? 'active' : ''}`}
              onClick={() => setShowMoreMenu((prev) => !prev)}
              aria-label="More"
              aria-expanded={showMoreMenu}
            >
              <div className="mobile-icon-wrap">
                <MoreHorizontal size={22} strokeWidth={showMoreMenu ? 2.6 : 2.0} />
              </div>
            </button>
          </Tooltip>
        </nav>
      )}

      {/* =========================================================================
          3. ACCESSIBLE "MORE" NAVIGATION MENU / SHEET (MOBILE & TABLET)
         ========================================================================= */}
      {showMoreMenu && (
        <div
          className="responsive-more-overlay"
          onClick={() => setShowMoreMenu(false)}
          aria-modal="true"
          role="dialog"
        >
          <div
            ref={moreMenuRef}
            className="responsive-more-sheet"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Sheet Handle */}
            <div className="sheet-drag-handle" />

            {/* Sheet Header */}
            <div className="sheet-header">
              <div className="sheet-header-title-box">
                <span className="sheet-store-title">{shop?.name || 'Adaptive POS'}</span>
                <span className="sheet-role-badge">
                  {isSuperAdmin ? 'Super Admin' : isManager ? 'Store Manager' : 'Cashier'}
                </span>
              </div>
              <button
                type="button"
                className="sheet-close-btn"
                onClick={() => setShowMoreMenu(false)}
                aria-label="Close menu"
              >
                <X size={20} />
              </button>
            </div>

            {/* Sheet Scrollable Navigation Grid */}
            <div className="sheet-content-scroll">
              {/* Category: Catalog & Inventory */}
              {!isCashier && (isModuleVisible('items') || isModuleVisible('categories') || isModuleVisible('inventory')) && (
                <div className="sheet-section">
                  <div className="sheet-section-title">Catalog &amp; Inventory</div>
                  <div className="sheet-items-grid">
                    {isModuleVisible('items') && (
                      <button
                        type="button"
                        className={`sheet-item-card ${activeTab === 'items' ? 'active' : ''}`}
                        onClick={() => handleSelectTab('items')}
                      >
                        <Package size={18} />
                        <span>Products</span>
                        {itemsCount > 0 && <span className="sheet-item-badge">{itemsCount}</span>}
                      </button>
                    )}
                    {isModuleVisible('categories') && (
                      <button
                        type="button"
                        className={`sheet-item-card ${activeTab === 'categories' ? 'active' : ''}`}
                        onClick={() => handleSelectTab('categories')}
                      >
                        <Tag size={18} />
                        <span>Categories</span>
                      </button>
                    )}
                    {isModuleVisible('inventory.adjustment') && (
                      <button
                        type="button"
                        className={`sheet-item-card ${activeTab === 'inventory' ? 'active' : ''}`}
                        onClick={() => handleSelectTab('inventory')}
                      >
                        <Sliders size={18} />
                        <span>Adjustment</span>
                      </button>
                    )}
                    {isModuleVisible('inventory.reports') && (
                      <button
                        type="button"
                        className={`sheet-item-card ${activeTab === 'product-movement' ? 'active' : ''}`}
                        onClick={() => handleSelectTab('product-movement')}
                      >
                        <FileText size={18} />
                        <span>Stock Report</span>
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Category: Sales & CRM */}
              {!isCashier && (isModuleVisible('customers') || isModuleVisible('suppliers') || isModuleVisible('promotions') || isModuleVisible('sales-analysis')) && (
                <div className="sheet-section">
                  <div className="sheet-section-title">Sales &amp; Relationships</div>
                  <div className="sheet-items-grid">
                    {isModuleVisible('sales-analysis') && (
                      <button
                        type="button"
                        className={`sheet-item-card ${activeTab === 'sales-analysis' ? 'active' : ''}`}
                        onClick={() => handleSelectTab('sales-analysis')}
                      >
                        <BarChart2 size={18} />
                        <span>Sales Analytics</span>
                      </button>
                    )}
                    {isModuleVisible('promotions') && (
                      <button
                        type="button"
                        className={`sheet-item-card ${activeTab === 'promotions' ? 'active' : ''}`}
                        onClick={() => handleSelectTab('promotions')}
                      >
                        <Percent size={18} />
                        <span>Offers &amp; Deals</span>
                      </button>
                    )}
                    {isModuleVisible('customers') && (
                      <button
                        type="button"
                        className={`sheet-item-card ${activeTab === 'customers' ? 'active' : ''}`}
                        onClick={() => handleSelectTab('customers')}
                      >
                        <Users size={18} />
                        <span>Customers</span>
                        {customersCount > 0 && <span className="sheet-item-badge">{customersCount}</span>}
                      </button>
                    )}
                    {isModuleVisible('suppliers') && (
                      <button
                        type="button"
                        className={`sheet-item-card ${activeTab === 'suppliers' ? 'active' : ''}`}
                        onClick={() => handleSelectTab('suppliers')}
                      >
                        <Truck size={18} />
                        <span>Suppliers</span>
                        {suppliersCount > 0 && <span className="sheet-item-badge">{suppliersCount}</span>}
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Category: Accounts & Invoicing */}
              {(!isCashier && isModuleVisible('accounts')) || isCashier ? (
                <div className="sheet-section">
                  <div className="sheet-section-title">Finance &amp; Invoices</div>
                  <div className="sheet-items-grid">
                    <button
                      type="button"
                      className={`sheet-item-card ${activeTab === 'invoices' ? 'active' : ''}`}
                      onClick={() => handleSelectTab('invoices')}
                    >
                      <Receipt size={18} />
                      <span>{isCashier ? 'Recent Bills' : 'Sales & Invoices'}</span>
                    </button>
                    {!isCashier && isModuleVisible('accounts.purchases') && (
                      <button
                        type="button"
                        className={`sheet-item-card ${activeTab === 'purchases' ? 'active' : ''}`}
                        onClick={() => handleSelectTab('purchases')}
                      >
                        <ShoppingBag size={18} />
                        <span>Purchases</span>
                      </button>
                    )}
                    {!isCashier && isModuleVisible('accounts.payments') && (
                      <button
                        type="button"
                        className={`sheet-item-card ${activeTab === 'payments' ? 'active' : ''}`}
                        onClick={() => handleSelectTab('payments')}
                      >
                        <CreditCard size={18} />
                        <span>Payments</span>
                      </button>
                    )}
                    {!isCashier && isModuleVisible('accounts.expenses') && (
                      <button
                        type="button"
                        className={`sheet-item-card ${activeTab === 'expenses' ? 'active' : ''}`}
                        onClick={() => handleSelectTab('expenses')}
                      >
                        <DollarSign size={18} />
                        <span>Expenses</span>
                      </button>
                    )}
                    <button
                      type="button"
                      className={`sheet-item-card ${activeTab === 'day-closing' ? 'active' : ''}`}
                      onClick={() => handleSelectTab('day-closing')}
                    >
                      <Lock size={18} />
                      <span>Day Closing</span>
                    </button>
                    {!isCashier && isModuleVisible('accounts.return_reports') && (
                      <button
                        type="button"
                        className={`sheet-item-card ${activeTab === 'return-reports' ? 'active' : ''}`}
                        onClick={() => handleSelectTab('return-reports')}
                      >
                        <TrendingUp size={18} />
                        <span>Returns Report</span>
                      </button>
                    )}
                  </div>
                </div>
              ) : null}

              {/* Category: GST Filing */}
              {!isCashier && isModuleVisible('gst') && (
                <div className="sheet-section">
                  <div className="sheet-section-title">GST Compliance</div>
                  <div className="sheet-items-grid">
                    {isModuleVisible('gst.overview') && (
                      <button
                        type="button"
                        className={`sheet-item-card ${activeTab === 'gst-overview' ? 'active' : ''}`}
                        onClick={() => handleSelectTab('gst-overview')}
                      >
                        <FileText size={18} />
                        <span>GST Overview</span>
                      </button>
                    )}
                    {isModuleVisible('gst.gstr1') && (
                      <button
                        type="button"
                        className={`sheet-item-card ${activeTab === 'gst-gstr1' ? 'active' : ''}`}
                        onClick={() => handleSelectTab('gst-gstr1')}
                      >
                        <FileText size={18} />
                        <span>GSTR-1</span>
                      </button>
                    )}
                    {isModuleVisible('gst.itc') && (
                      <button
                        type="button"
                        className={`sheet-item-card ${activeTab === 'gst-itc-reconciliation' ? 'active' : ''}`}
                        onClick={() => handleSelectTab('gst-itc-reconciliation')}
                      >
                        <FileText size={18} />
                        <span>ITC Register &amp; 2B</span>
                      </button>
                    )}
                    {isModuleVisible('gst.gstr3b') && (
                      <button
                        type="button"
                        className={`sheet-item-card ${activeTab === 'gst-gstr3b' ? 'active' : ''}`}
                        onClick={() => handleSelectTab('gst-gstr3b')}
                      >
                        <FileText size={18} />
                        <span>GSTR-3B Prep</span>
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Category: Administration & Settings */}
              <div className="sheet-section">
                <div className="sheet-section-title">Administration</div>
                <div className="sheet-items-grid">
                  {!isCashier && isModuleVisible('notifications') && (
                    <button
                      type="button"
                      className={`sheet-item-card ${activeTab === 'notifications' ? 'active' : ''}`}
                      onClick={() => handleSelectTab('notifications')}
                    >
                      <Bell size={18} />
                      <span>Notifications</span>
                      {unreadShiftNotifCount > 0 && <span className="sheet-item-badge alert">{unreadShiftNotifCount}</span>}
                    </button>
                  )}
                  {!isCashier && (isSuperAdmin || isManager) && isModuleVisible('user-management') && (
                    <button
                      type="button"
                      className={`sheet-item-card ${activeTab === 'user-management' ? 'active' : ''}`}
                      onClick={() => handleSelectTab('user-management')}
                    >
                      <UserCog size={18} />
                      <span>User Management</span>
                    </button>
                  )}
                  {!isCashier && isModuleVisible('settings') && (
                    <button
                      type="button"
                      className={`sheet-item-card ${activeTab === 'settings' ? 'active' : ''}`}
                      onClick={() => handleSelectTab('settings')}
                    >
                      <Settings size={18} />
                      <span>Store Settings</span>
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Sheet Footer: User Profile & Logout */}
            <div className="sheet-footer">
              <div className="sheet-user-info">
                <div className="sheet-avatar">
                  {(user?.name || 'User').slice(0, 1).toUpperCase()}
                </div>
                <div className="sheet-user-meta">
                  <span className="sheet-user-name">{(user?.name || 'User').trim()}</span>
                  <span className="sheet-user-email">
                    {user?.email || (isCashier ? 'Cashier Terminal' : 'Staff')}
                  </span>
                </div>
              </div>
              <button
                type="button"
                className="sheet-logout-btn"
                onClick={() => {
                  setShowMoreMenu(false);
                  onLogout();
                }}
              >
                <LogOut size={16} />
                <span>Logout</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
