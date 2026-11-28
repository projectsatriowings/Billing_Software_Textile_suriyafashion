// shared/modules.ts
// Single source of truth for all sidebar modules and access control permissions in Ledgerly

export interface AppSubModule {
  key: string;
  parentKey: string;
  name: string;
  description: string;
  route: string;
}

export interface AppModule {
  key: string;
  name: string;
  description: string;
  icon: string;
  route: string;
  isSettingsLocked?: boolean;
  subModules?: AppSubModule[];
}

export const APP_MODULES: AppModule[] = [
  {
    key: 'dashboard',
    name: 'Dashboard',
    description: 'Executive revenue overview, sales analytics & live store metrics',
    icon: 'LayoutDashboard',
    route: 'dashboard',
  },
  {
    key: 'pos',
    name: 'POS Counter',
    description: 'High-speed retail checkout, barcode scanner & quick billing',
    icon: 'ShoppingCart',
    route: 'pos',
  },
  {
    key: 'wholesale',
    name: 'Wholesale Billing',
    description: 'B2B tax invoices, bulk wholesale orders & settlement terms',
    icon: 'Warehouse',
    route: 'wholesale',
  },
  {
    key: 'notifications',
    name: 'Notifications',
    description: 'Cashier shift alerts, opening floats & store audit notifications',
    icon: 'Bell',
    route: 'notifications',
  },
  {
    key: 'items',
    name: 'Products',
    description: 'Item master catalogue, barcode generation, HSN codes & pricing',
    icon: 'Package',
    route: 'items',
  },
  {
    key: 'categories',
    name: 'Categories',
    description: 'Multi-level category hierarchy, tax classification & product grouping',
    icon: 'Tag',
    route: 'categories',
  },
  {
    key: 'inventory',
    name: 'Inventory Hub',
    description: 'Multi-branch stock balances, adjustments & automated replenishment',
    icon: 'Layers',
    route: 'stock-transfer',
    subModules: [
      {
        key: 'inventory.transfers',
        parentKey: 'inventory',
        name: 'Stock Transfer',
        description: 'Inter-branch stock transfer requests, dispatch & receipt confirmation',
        route: 'stock-transfer',
      },
      {
        key: 'inventory.adjustment',
        parentKey: 'inventory',
        name: 'Stock Adjustment',
        description: 'Real-time stock valuation, balances & physical discrepancy adjustment',
        route: 'inventory',
      },
      {
        key: 'inventory.reports',
        parentKey: 'inventory',
        name: 'Stock Report',
        description: 'Vendor reorder suggestions, stock movements & replenishment tracking',
        route: 'product-movement',
      },
    ],
  },
  {
    key: 'sales-analysis',
    name: 'Sales Analysis',
    description: 'Hourly customer traffic curves, profit margins & sales breakdown',
    icon: 'BarChart2',
    route: 'sales-analysis',
  },
  {
    key: 'promotions',
    name: 'Discounts & Offers',
    description: 'Automated discount rules, promotional coupons & campaign triggers',
    icon: 'Percent',
    route: 'promotions',
  },
  {
    key: 'customers',
    name: 'Customers',
    description: 'Customer contact directory & purchase history',
    icon: 'Users',
    route: 'customers',
  },
  {
    key: 'suppliers',
    name: 'Suppliers',
    description: 'Vendor directory, purchase invoices & supplier balance reconciliation',
    icon: 'Truck',
    route: 'suppliers',
  },
  {
    key: 'accounts',
    name: 'Accounts & Finance',
    description: 'Operational expenses, supplier payments, cash drawer & ledgers',
    icon: 'Briefcase',
    route: 'invoices',
    subModules: [
      {
        key: 'accounts.invoices',
        parentKey: 'accounts',
        name: 'Sales & Invoices',
        description: 'Historical sales receipts, customer tax invoices & counter billing log',
        route: 'invoices',
      },
      {
        key: 'accounts.purchases',
        parentKey: 'accounts',
        name: 'Purchases & Payables',
        description: 'Vendor purchase invoices, inward stock register & supplier balances',
        route: 'purchases',
      },
      {
        key: 'accounts.payments',
        parentKey: 'accounts',
        name: 'Payments & Payables',
        description: 'Accounts receivable/payable, payment vouchers & customer credit dues',
        route: 'payments',
      },
      {
        key: 'accounts.expenses',
        parentKey: 'accounts',
        name: 'Expenses',
        description: 'Operational business expenditures, vendor GST vouchers & petty cash',
        route: 'expenses',
      },
      {
        key: 'accounts.day_closing',
        parentKey: 'accounts',
        name: 'Day Closing',
        description: 'Daily cash register reconciliation, cash drawer counts & shift closing',
        route: 'day-closing',
      },
      {
        key: 'accounts.return_reports',
        parentKey: 'accounts',
        name: 'Returns & Profit Report',
        description: 'Sales return audit, credit notes log & net profit margin analytics',
        route: 'return-reports',
      },
    ],
  },
  {
    key: 'gst',
    name: 'GST Filing',
    description: 'Statutory GST tax compliance, ITC reconciliation & return preparation',
    icon: 'FileSpreadsheet',
    route: 'gst-overview',
    subModules: [
      {
        key: 'gst.overview',
        parentKey: 'gst',
        name: 'GST Overview',
        description: 'Monthly tax liability dashboard, filing status & compliance checklist',
        route: 'gst-overview',
      },
      {
        key: 'gst.gstr1',
        parentKey: 'gst',
        name: 'GSTR-1 (Sales Register)',
        description: 'Outward supplies register, B2B invoices & B2C counter sales',
        route: 'gst-gstr1',
      },
      {
        key: 'gst.itc',
        parentKey: 'gst',
        name: 'ITC Register & 2B Reconciliation',
        description: 'Inward supplies ITC matching, vendor filing verification & 2B reconciler',
        route: 'gst-itc-reconciliation',
      },
      {
        key: 'gst.gstr3b',
        parentKey: 'gst',
        name: 'GSTR-3B Preparation',
        description: 'Monthly summary liabilities, reviewed eligible ITC & net tax payable',
        route: 'gst-gstr3b',
      },
    ],
  },
  {
    key: 'user-management',
    name: 'User Management',
    description: 'Staff credentials, role assignments, counter locks & permissions',
    icon: 'UserCog',
    route: 'user-management',
  },
  {
    key: 'settings',
    name: 'Settings',
    description: 'Enterprise store configuration, tax GSTINs, thermal printers & modules',
    icon: 'Settings',
    route: 'settings',
    isSettingsLocked: true,
  },
];

export const TOTAL_PARENT_MODULES = APP_MODULES.length; // 15
export const TOTAL_SUB_MODULES = APP_MODULES.reduce(
  (acc, mod) => acc + (mod.subModules ? mod.subModules.length : 0),
  0
); // 13

export type ModuleAccessMap = Record<string, boolean>;
export type RoleModuleAccessConfig = Record<'owner' | 'manager' | 'cashier', ModuleAccessMap>;

export const DEFAULT_ROLE_MODULE_ACCESS: RoleModuleAccessConfig = {
  owner: {
    dashboard: true,
    pos: true,
    wholesale: true,
    notifications: true,
    items: true,
    categories: true,
    inventory: true,
    'inventory.transfers': true,
    'inventory.adjustment': true,
    'inventory.reports': true,
    'inventory.levels': true,
    'sales-analysis': true,
    promotions: true,
    customers: true,
    suppliers: true,
    accounts: true,
    'accounts.invoices': true,
    'accounts.purchases': true,
    'accounts.payments': true,
    'accounts.expenses': true,
    'accounts.day_closing': true,
    'accounts.return_reports': true,
    'accounts.sales_invoices': true,
    gst: true,
    'gst.overview': true,
    'gst.gstr1': true,
    'gst.itc': true,
    'gst.gstr3b': true,
    'gst.hsn': true,
    'user-management': true,
    settings: true,
  },
  manager: {
    dashboard: true,
    pos: true,
    wholesale: true,
    notifications: true,
    items: true,
    categories: true,
    inventory: true,
    'inventory.transfers': true,
    'inventory.adjustment': true,
    'inventory.reports': true,
    'inventory.levels': true,
    'sales-analysis': true,
    promotions: true,
    customers: true,
    suppliers: true,
    accounts: true,
    'accounts.invoices': true,
    'accounts.purchases': true,
    'accounts.payments': true,
    'accounts.expenses': true,
    'accounts.day_closing': true,
    'accounts.return_reports': true,
    'accounts.sales_invoices': true,
    gst: true,
    'gst.overview': true,
    'gst.gstr1': true,
    'gst.itc': true,
    'gst.gstr3b': true,
    'gst.hsn': true,
    'user-management': true,
    settings: true,
  },
  cashier: {
    dashboard: false,
    pos: true,
    shifts: true,
    'recent-bills': true,
    'day-closing': true,
    wholesale: false,
    notifications: true,
    items: false,
    categories: false,
    inventory: false,
    'inventory.transfers': false,
    'inventory.adjustment': false,
    'inventory.reports': false,
    'inventory.levels': false,
    'sales-analysis': false,
    promotions: false,
    customers: false,
    suppliers: false,
    accounts: false,
    'accounts.invoices': false,
    'accounts.purchases': false,
    'accounts.payments': false,
    'accounts.expenses': false,
    'accounts.day_closing': false,
    'accounts.return_reports': false,
    'accounts.sales_invoices': false,
    gst: false,
    'gst.overview': false,
    'gst.gstr1': false,
    'gst.itc': false,
    'gst.gstr3b': false,
    'gst.hsn': false,
    'user-management': false,
    settings: false,
  },
};

const KEY_ALIASES: Record<string, string[]> = {
  'inventory.adjustment': ['inventory.levels'],
  'inventory.levels': ['inventory.adjustment'],
  'accounts.invoices': ['accounts.sales_invoices', 'accounts.payments'],
  'accounts.purchases': ['accounts.payments'],
  'accounts.day_closing': ['accounts'],
  'accounts.return_reports': ['accounts'],
  'gst.overview': ['gst'],
  'gst.itc': ['gst.hsn'],
  'gst.hsn': ['gst.itc'],
};

/**
 * Checks whether a module or sub-module is enabled for a given role in the config.
 * Inherits parent state: if a parent module is disabled, all its sub-modules are effectively disabled.
 */
export function isModuleEnabledForRole(
  config: RoleModuleAccessConfig | undefined,
  role: string | undefined,
  moduleKey: string
): boolean {
  if (!config || !role) return true;
  const canonicalRole = (role === 'super_admin' ? 'owner' : role) as 'owner' | 'manager' | 'cashier';

  // Cashier navigation is completely standalone and independent from Module Management
  if (canonicalRole === 'cashier') {
    return true;
  }

  const roleAccess = config[canonicalRole] || DEFAULT_ROLE_MODULE_ACCESS[canonicalRole] || DEFAULT_ROLE_MODULE_ACCESS.owner;

  // Settings is permanently locked on for Super Admin
  if (canonicalRole === 'owner' && moduleKey === 'settings') {
    return true;
  }

  // Check if sub-module: if so, verify parent module first
  if (moduleKey.includes('.')) {
    const parentKey = moduleKey.split('.')[0];
    const parentEnabled = roleAccess[parentKey] ?? DEFAULT_ROLE_MODULE_ACCESS[canonicalRole]?.[parentKey] ?? true;
    if (!parentEnabled) return false;
  }

  const rawVal = roleAccess[moduleKey];
  if (rawVal !== undefined) return rawVal;

  const aliases = KEY_ALIASES[moduleKey];
  if (aliases) {
    for (const alias of aliases) {
      if (roleAccess[alias] !== undefined) return roleAccess[alias];
    }
  }

  return DEFAULT_ROLE_MODULE_ACCESS[canonicalRole]?.[moduleKey] ?? true;
}
