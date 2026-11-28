// Typed client API wrapper for Adaptive Billing Platform
import type { StockTransfer, StockTransferLine, CreateStockTransferInput, StockMove } from '../../shared/types.ts';
import type { RoleModuleAccessConfig } from '../../shared/modules.ts';

export const getToken = (): string =>
  sessionStorage.getItem('billing_token') || sessionStorage.getItem('token') ||
  localStorage.getItem('billing_token') || localStorage.getItem('token') || '';
export const setToken = (t: string) => {
  sessionStorage.setItem('billing_token', t);
  localStorage.setItem('billing_token', t);
};
export const clearToken = () => {
  sessionStorage.removeItem('billing_token');
  sessionStorage.removeItem('token');
  localStorage.removeItem('billing_token');
  localStorage.removeItem('token');
};

// Developer Mode Token Management (strictly session-based, never persisted in localStorage)
export const getDeveloperToken = (): string | null => {
  try {
    return sessionStorage.getItem('developer_access_token');
  } catch {
    return null;
  }
};

export const setDeveloperToken = (token: string | null) => {
  try {
    if (token) {
      sessionStorage.setItem('developer_access_token', token);
    } else {
      sessionStorage.removeItem('developer_access_token');
    }
  } catch {
    // ignore
  }
};

export const clearDeveloperToken = () => {
  setDeveloperToken(null);
};

export function withAuthToken(url: string): string {
  const token = getToken();
  if (!token) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}token=${encodeURIComponent(token)}`;
}

export function getActiveBranchScope(): string {
  const br = localStorage.getItem('sa_selected_branch') || localStorage.getItem('selected_branch');
  return br || 'all';
}

export function setActiveBranchScope(branch: string) {
  const val = (branch || 'all').trim();
  if (val && val.toLowerCase() !== 'all') {
    localStorage.setItem('sa_selected_branch', val);
    localStorage.setItem('selected_branch', val);
    sessionStorage.setItem('sa_selected_branch', val);
    sessionStorage.setItem('selected_branch', val);
  } else {
    localStorage.setItem('sa_selected_branch', 'all');
    localStorage.setItem('selected_branch', 'all');
    sessionStorage.setItem('sa_selected_branch', 'all');
    sessionStorage.setItem('selected_branch', 'all');
  }
}

export async function downloadFile(url: string, defaultFilename: string): Promise<void> {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  const selectedBranch = getActiveBranchScope();
  if (selectedBranch && selectedBranch.toLowerCase() !== 'all') {
    headers['x-branch-id'] = selectedBranch;
  }
  const res = await fetch(url, {
    headers,
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    const msg =
      errorData?.error?.message ||
      (typeof errorData?.error === 'string' ? errorData.error : null) ||
      errorData?.message ||
      `Export failed with status ${res.status}`;
    throw new Error(msg);
  }
  const blob = await res.blob();
  const objectUrl = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = defaultFilename;
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(objectUrl);
  document.body.removeChild(a);
}

export async function api<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  const selectedBranch = getActiveBranchScope();
  if (selectedBranch && selectedBranch.toLowerCase() !== 'all') {
    headers['x-branch-id'] = selectedBranch;
  }
  const devToken = getDeveloperToken();
  if (devToken) {
    headers['x-developer-token'] = devToken;
  }

  const res = await fetch(path, {
    ...options,
    headers,
  });

  if (res.status === 401) {
    clearToken();
    window.dispatchEvent(new Event('auth_required'));
  }

  const data = await res.json().catch(() => ({}));

  if (res.status === 403 && (data?.code === 'PASSWORD_CHANGE_REQUIRED' || data?.error?.code === 'PASSWORD_CHANGE_REQUIRED')) {
    window.dispatchEvent(new CustomEvent('password_change_required'));
  }

  if (res.status === 403 && (data?.code === 'DEVELOPER_TOKEN_EXPIRED' || data?.error?.code === 'DEVELOPER_TOKEN_EXPIRED' || data?.code === 'DEVELOPER_MODE_REQUIRED')) {
    clearDeveloperToken();
    window.dispatchEvent(new CustomEvent('developer_mode_locked'));
  }

  if (!res.ok) {
    throw new Error(data?.error?.message || data?.message || `HTTP Error ${res.status}`);
  }
  return data as T;
}

export interface DownloadBlobResult {
  blob: Blob;
  filename?: string;
  contentType: string;
}

export async function apiBlob(
  path: string,
  options: RequestInit = {}
): Promise<DownloadBlobResult> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  const selectedBranch = getActiveBranchScope();
  if (selectedBranch && selectedBranch.toLowerCase() !== 'all') {
    headers['x-branch-id'] = selectedBranch;
  }

  const res = await fetch(path, {
    ...options,
    headers,
  });

  if (res.status === 401) {
    clearToken();
    window.dispatchEvent(new Event('auth_required'));
    const errJson = await res.json().catch(() => ({}));
    const msg = errJson?.error?.message || errJson?.message || 'Please sign in again';
    throw new Error(msg);
  }

  if (res.status === 403) {
    const clone = res.clone();
    const data = await clone.json().catch(() => ({}));
    if (data?.code === 'PASSWORD_CHANGE_REQUIRED' || data?.error?.code === 'PASSWORD_CHANGE_REQUIRED') {
      window.dispatchEvent(new CustomEvent('password_change_required'));
    }
  }

  if (!res.ok) {
    const errJson = await res.json().catch(() => ({}));
    const msg = errJson?.error?.message || errJson?.message || `Download failed with HTTP ${res.status}`;
    throw new Error(msg);
  }

  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const json = await res.json().catch(() => ({}));
    if (json?.error) {
      throw new Error(json.error.message || 'Server error occurred during download');
    }
  }

  const disposition = res.headers.get('content-disposition') || '';
  let filename: string | undefined;
  if (disposition && disposition.includes('filename=')) {
    const match = disposition.match(/filename="?([^";]+)"?/);
    if (match && match[1]) filename = match[1];
  }

  const blob = await res.blob();
  return { blob, filename, contentType };
}

export async function changePassword(
  currentPassword: string,
  newPassword: string,
  changeToken?: string
): Promise<{
  token: string;
  user?: User;
  shop?: any;
  perms?: string[];
  role?: string;
  branchId?: string | null;
}> {
  const customHeaders: Record<string, string> = {};
  if (changeToken) {
    customHeaders['Authorization'] = `Bearer ${changeToken}`;
  }
  const res = await api<{
    token: string;
    user?: User;
    shop?: any;
    perms?: string[];
    role?: string;
    branchId?: string | null;
  }>('/api/auth/change-password', {
    method: 'POST',
    headers: customHeaders,
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  if (res.token) {
    setToken(res.token);
  }
  return res;
}

export async function forgotPassword(identifier: string): Promise<{ ok: boolean; message: string }> {
  return api<{ ok: boolean; message: string }>('/api/auth/forgot-password', {
    method: 'POST',
    body: JSON.stringify({ identifier }),
  });
}

export async function resetPasswordWithToken(token: string, newPassword: string): Promise<{ ok: boolean; message: string }> {
  return api<{ ok: boolean; message: string }>('/api/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({ token, newPassword }),
  });
}

export interface User {
  id: string;
  employeeId?: string;
  name: string;
  email: string;
  role: string;
  assignedLocation?: string;
  assignedCounter?: string;
  allowedLocations?: string[];
  active?: boolean;
  username?: string | null;
  status?: string;
  mustChangePassword?: boolean;
  branchId?: string | null;
}

export interface Branch {
  id: string;
  code: string;
  name: string;
  address?: string | null;
  phone?: string | null;
  active: boolean;
  counters: string[];
  managerId?: string | null;
  managerName?: string | null;
  managerEmail?: string | null;
  managerUsername?: string | null;
  countersTotal?: number;
  countersActive?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface BranchSummary {
  branch: Branch;
  todaySalesCount: number;
  todaySalesTotalMinor: number;
  todayCollectionsMinor: number;
  activeShiftsCount: number;
  activeShifts: {
    id: string;
    shiftNumber: string;
    cashierName: string;
    counter: string;
    openedAt: string;
    openingCashMinor: number;
  }[];
  pendingReviewShiftsCount: number;
  pendingReviewShifts: {
    id: string;
    shiftNumber: string;
    cashierName: string;
    closedAt: string;
    varianceMinor: number;
  }[];
  lowStockCount: number;
  lowStock: {
    id: string;
    name: string;
    sku: string;
    stockMilli: number;
  }[];
  staff: {
    id: string;
    name: string;
    email: string;
    role: string;
    active: boolean;
    counter?: string;
  }[];
}

export interface Shop {
  id: string;
  name: string;
  wholesaleBusinessName?: string | null;
  legalName?: string | null;
  businessType: string;
  gstEnabled?: boolean;
  gstin?: string;
  phone?: string;
  address?: string;
  upiId?: string;
  invoicePrefix: string;
  language?: string;
  locations?: string[];
  whatsappEnabled?: boolean;
  whatsappDefaultLang?: 'en' | 'hi' | 'ta';
  whatsappIncludeLink?: boolean;
  loyaltyEnabled?: boolean;
  loyaltyPointsPer100?: number;
  loyaltyPointValueMinor?: number;
  loyaltyMinPointsRedeem?: number;
  ownerEmail?: string | null;
  invoiceProfiles?: import('../../shared/types.ts').InvoiceProfiles;
  logoUrl?: string | null;
}

export interface DemoBusiness {
  id: string;
  name: string;
  businessType: string;
  gstin?: string;
  phone?: string;
  address?: string;
  invoicePrefix: string;
  ownerEmail: string;
  ownerName: string;
}

export interface Item {
  id: string;
  name: string;
  branchId?: string | null;
  branchName?: string | null;
  branchCode?: string | null;
  sku?: string;
  barcode?: string;
  barcodeType?: 'INTERNAL' | 'MANUFACTURER' | null;
  barcodes?: { id?: string; barcode: string; barcodeType: 'INTERNAL' | 'MANUFACTURER'; branchId?: string | null }[];
  hsn?: string;
  unit: string;
  category?: string;
  categoryId?: string | null;
  categoryName?: string | null;
  subcategoryId?: string | null;
  subcategoryName?: string | null;
  itemType?: 'simple' | 'variant';
  productType?: 'Retail' | 'Wholesale' | string;
  size?: string | null;
  colour?: string | null;
  material?: string | null;
  designPattern?: string | null;
  description?: string | null;
  variants?: ProductVariant[];
  variantsCount?: number;
  totalStockMilli?: number;
  priceMinor: number;
  mrpMinor?: number | null;
  offerPercentage?: number | null;
  wholesalePriceMinor?: number | null;
  minWholesaleQtyMilli?: number | null;
  costMinor: number;
  taxRateBp: number;
  taxInclusive: boolean;
  trackStock?: boolean;
  track_stock?: boolean;
  currentStockMilli: number;
  reorderMilli?: number;
  reorderLevelMilli?: number;
  preferredSupplierId?: string | null;
  preferredSupplierName?: string | null;
  preferredSupplierPhone?: string | null;
  stockStatus?: 'in_stock' | 'low_stock' | 'out_of_stock';
  stockValueMinor?: number | null;
  purchaseDate?: string | null;
  importedDate?: string | null;
  restockedDate?: string | null;
  parentProductId?: string | null;

  favorite: boolean;
  active?: boolean;
  deactivationReason?: 'out_of_stock' | 'manual' | null;
  imageUrl?: string | null;
  image?: string | null;
  custom?: Record<string, any>;
}

export {
  STANDARD_UNITS,
  type UnitDef,
  type Purchase,
  type PurchaseLine,
  type PurchaseStatus,
  type StockMove,
  type StockAdjustment,
  type StockCount,
  type StockCountLine,
  type InventoryDashboardStats,
  type StockMoveKind,
  type StockAdjustmentReason,
  type StockCountStatus,
  can,
  formatStockDuration,
  type Role,
  type Perm,
} from '../../shared/types.ts';
import type { WholesaleCustomer } from '../../shared/types.ts';
export type { WholesaleCustomer };
export { calcPurchase, planSupplierPayment, type PurchaseLineInput, type CalculatedPurchase, type CalculatedPurchaseLine, type SupplierPaymentAllocationPlan, type OpenPurchaseForAllocation } from '../../shared/purchases.ts';

export interface Party {
  id: string;
  name: string;
  type: 'customer' | 'supplier' | 'wholesale';
  phone?: string;
  email?: string;
  gstin?: string;
  stateCode?: string;
  address?: string;
  creditLimitMinor: number;
  loyaltyPoints?: number;
  advanceMinor?: number;
  unpaidInvoicesMinor?: number;
  duesMinor?: number;
  payableMinor?: number;
  unpaidPurchasesMinor?: number;
  openPurchasesCount?: number;
  oldestDueDate?: string | null;
  active?: boolean;
  contactPerson?: string | null;
  shippingAddress?: string | null;
  customerType?: 'retail' | 'wholesale';
  custom?: Record<string, any>;

}

export interface Category {
  id: string;
  tenantId: string;
  name: string;
  description?: string | null;
  active: boolean;
  parentId?: string | null;
  parentName?: string | null;
  itemCount?: number;
}

export interface CategoryImportResult {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  errors: Array<{
    row: number;
    name?: string;
    error: string;
  }>;
}

export interface InvoiceCreditNoteSummary {
  id: string;
  number: string;
  totalMinor: number;
  status: string;
}

export interface Invoice {
  id: string;
  number: string;
  kind: string;
  status: string;
  bdate: string;
  branchId?: string;
  partyId?: string;
  customerName?: string;
  customerPhone?: string;
  totalMinor: number;
  taxableMinor: number;
  cgstMinor: number;
  sgstMinor: number;
  igstMinor?: number;
  paidMinor: number;
  balanceMinor: number;
  returnedMinor?: number;
  creditNotes?: InvoiceCreditNoteSummary[];
  fullyReturned?: boolean;
  linkedInvoiceId?: string;
  createdAt: string;
  payments: { method: string; amountMinor: number }[];
  whatsappSendCount?: number;
  whatsappLastSentAt?: string;
  whatsappLastSentTo?: string;
  whatsappLastLanguage?: 'en' | 'hi' | 'ta' | string;
  whatsappLastSentBy?: string;
  shareToken?: string;
  invoiceType?: 'retail' | 'wholesale';
  profileSnapshot?: Record<string, any> | null;
  custom?: Record<string, any>;
  isLateSale?: boolean;
  lateSaleReason?: string | null;
  lateSaleEntryAt?: string | null;
  lateSaleEnteredBy?: string | null;
}

export interface ReturnInfoLine {
  id: string;
  pos: number;
  itemId?: string | null;
  name: string;
  hsn?: string | null;
  unit?: string | null;
  billedQtyMilli: number;
  alreadyReturnedQtyMilli: number;
  returnableQtyMilli: number;
  priceMinor: number;
  discountMinor: number;
  taxRateBp: number;
  inclusive: boolean;
  origTaxableMinor: number;
  origCgstMinor: number;
  origSgstMinor: number;
  origIgstMinor: number;
  origTotalMinor: number;
}

export interface ReturnInfo {
  invoice: {
    id: string;
    number: string;
    bdate: string;
    createdAt: string;
    customerName?: string;
    customerPhone?: string;
    partyId?: string;
    intra: boolean;
    totalMinor: number;
    paidMinor: number;
    balanceMinor: number;
  };
  lines: ReturnInfoLine[];
  customer?: {
    id: string;
    name: string;
    phone?: string;
    gstin?: string;
    address?: string;
    advanceMinor: number;
  } | null;
  otherUnpaidInvoices: {
    id: string;
    number: string;
    bdate: string;
    balanceMinor: number;
    totalMinor: number;
  }[];
  billAgeDays: number;
  fullyReturned: boolean;
  priorCreditNotes: {
    id: string;
    number: string;
    bdate: string;
    status: string;
    totalMinor: number;
    advanceAmountMinor: number;
    refundAmountMinor: number;
    createdAt: string;
    voidReason?: string;
    voidedAt?: string;
  }[];
}

export interface CreditNoteDetail {
  id: string;
  number: string;
  status: 'posted' | 'voided';
  bdate: string;
  createdAt: string;
  linkedInvoiceId: string;
  originalInvoiceNumber: string;
  originalInvoiceDate: string;
  partyId?: string;
  customerName?: string;
  customerPhone?: string;
  totalCreditMinor: number;
  taxableTotalMinor: number;
  cgstMinor: number;
  sgstMinor: number;
  igstMinor: number;
  roundOffMinor: number;
  advanceAmountMinor: number;
  refundAmountMinor: number;
  refundMode?: string;
  refundReference?: string;
  note?: string;
  voidReason?: string;
  voidedAt?: string;
  voidedByName?: string;
  createdByName?: string;
  shareToken: string;
  whatsappSendCount: number;
  whatsappLastSentAt?: string;
  whatsappLastSentTo?: string;
  whatsappLastLanguage?: string;
  lines: {
    id: string;
    pos?: number;
    itemId?: string;
    name: string;
    hsn?: string;
    unit?: string;
    qtyMilli: number;
    priceMinor: number;
    discountMinor?: number;
    taxRateBp?: number;
    taxableMinor?: number;
    cgstMinor?: number;
    sgstMinor?: number;
    igstMinor?: number;
    totalMinor: number;
    reason: string;
    restock: boolean;
  }[];
  allocations: {
    invoiceId: string;
    invoiceNumber: string;
    invoiceDate?: string;
    amountMinor: number;
  }[];
}

export interface DashboardReport {
  today: {
    billCount: number;
    grossTotalMinor?: number;
    totalMinor: number;
    taxableMinor: number;
    gstMinor: number;
    customerCollectionsMinor?: number;
    khataCollectionsMinor?: number;
    totalCreditNotesMinor?: number;
    creditNotesCount?: number;
    returnRatePct?: number;
    purchasesCount?: number;
    purchasesTotalMinor?: number;
    purchasesTaxableMinor?: number;
    itcMinor?: number;
    netGstPayableMinor?: number;
    supplierPaymentsMinor?: number;
  };
  overall: {
    billCount: number;
    grossTotalMinor?: number;
    totalMinor: number;
    totalCreditNotesMinor?: number;
    customerCount: number;
    itemCount: number;
    totalSupplierPayablesMinor?: number;
    stockValuationMinor?: number;
  };
  gstPosition?: {
    outputGstMinor: number;
    itcMinor: number;
    netGstPayableMinor: number;
  };
  paymentBreakdown: { method: string; totalMinor: number }[];
  refundsPaid?: { mode: string; totalMinor: number }[];
  totalRefundsPaidMinor?: number;
  topItems: { name: string; qtyMilli: number; totalMinor: number }[];
  lowStock: { id: string; name: string; sku?: string; currentStockMilli: number }[];
  branchesOverview?: {
    totalBranches: number;
    activeBranches: number;
    totalCounters: number;
  };
  branchComparison?: {
    id: string;
    code: string;
    name: string;
    active: boolean;
    countersCount: number;
    counters: string[];
    todaySalesCount: number;
    todaySalesTotalMinor: number;
    todayCollectionsMinor: number;
    openShiftsCount: number;
    allTimeSalesCount?: number;
    allTimeSalesTotalMinor?: number;
    allTimeGstMinor?: number;
    allTimeReturnsCount?: number;
    allTimeReturnsTotalMinor?: number;
  }[];
  shiftsSummary?: {
    openShiftsCount: number;
    pendingReviewShiftsCount: number;
    discrepanciesCount: number;
  };
  outstandingDuesMinor?: number;
}

export interface PaymentAllocation {
  invoiceId: string;
  invoiceNumber: string;
  invoiceDate?: string;
  amountMinor: number;
}

export interface Payment {
  id: string;
  receiptNumber: string;
  customerId: string;
  customerName?: string;
  customerPhone?: string;
  amountMinor: number;
  mode: string;
  referenceNo?: string | null;
  paymentDate: string;
  note?: string | null;
  receivedBy: string;
  receivedByName?: string | null;
  advanceMinor: number;
  status: 'posted' | 'reversed';
  reversedBy?: string | null;
  reversedByName?: string | null;
  reversedAt?: string | null;
  reversalReason?: string | null;
  shareToken?: string;
  whatsappSendCount: number;
  whatsappLastSentAt?: string | null;
  whatsappLastSentTo?: string | null;
  whatsappLastLanguage?: 'en' | 'hi' | 'ta' | null;
  createdAt: string;
  allocations: PaymentAllocation[];
  balanceAfterMinor?: number;
}

export interface CustomerDuesOverview {
  party: {
    id: string;
    name: string;
    phone?: string | null;
    gstin?: string | null;
    advanceMinor: number;
    duesMinor: number;
  };
  totalDuesMinor: number;
  totalAdvanceMinor: number;
  totalUnpaidMinor: number;
  oldestInvoiceDate: string | null;
  unpaidCount: number;
  totalBilledMinor: number;
  totalCollectedMinor: number;
  unpaidInvoices: {
    id: string;
    number: string;
    bdate: string;
    totalMinor: number;
    paidMinor: number;
    balanceMinor: number;
    createdAt: string;
  }[];
}
export type KhataOverview = CustomerDuesOverview;

export interface LedgerEvent {
  id: string;
  kind: 'invoice' | 'payment';
  date: string;
  createdAt: string;
  number: string;
  description: string;
  debitMinor: number;
  creditMinor: number;
  amountMinor: number;
  runningBalanceMinor: number;
  status: string;
  mode?: string;
  referenceNo?: string;
  reversalReason?: string;
  reversedAt?: string;
  advanceMinor?: number;
  receivedByName?: string;
  whatsappSendCount?: number;
  whatsappLastSentAt?: string;
  whatsappLastLanguage?: 'en' | 'hi' | 'ta';
  allocations?: { invoiceNumber: string; amountMinor: number }[];
}

export interface CustomerLedger {
  party: {
    id: string;
    name: string;
    phone?: string | null;
    gstin?: string | null;
    address?: string | null;
    advanceMinor: number;
  };
  currentDuesMinor: number;
  closingBalanceMinor: number;
  advanceMinor: number;
  events: LedgerEvent[];
}

export interface DuesSummary {
  totalDuesMinor: number;
  totalAdvanceMinor: number;
  ageing: {
    '0_30': number;
    '31_60': number;
    '61_plus': number;
  };
  topDebtors: {
    id: string;
    name: string;
    phone?: string;
    gstin?: string;
    advanceMinor: number;
    unpaidMinor: number;
    duesMinor: number;
    oldestInvoiceDate?: string;
  }[];
}

export interface SupplierPayablesSummary {
  totalPayableMinor: number;
  ageing: {
    '0_30': number;
    '31_60': number;
    '61_plus': number;
    days0_30?: number;
    days31_60?: number;
    days60Plus?: number;
  };
  topSuppliers: {
    id: string;
    name: string;
    phone: string | null;
    gstin: string | null;
    payableMinor: number;
    openPurchasesCount: number;
    oldestInvoiceDate: string | null;
  }[];
}

export interface SupplierLedgerEntry {
  id: string;
  date: string;
  createdAt: string;
  type: 'purchase' | 'payment';
  refNumber: string;
  description: string;
  status: string;
  amountMinor: number;
  moneyEffect: number;
  runningPayableMinor: number;
  voidReason?: string | null;
}

export interface SupplierPaymentRecord {
  id: string;
  paymentNumber: string;
  method: string;
  amountMinor: number;
  reference?: string | null;
  date: string;
  status: string;
  recordedBy?: string | null;
  voidReason?: string | null;
  createdAt: string;
  supplierId?: string;
  supplierName?: string;
}

export interface SupplierLedger {
  supplier: Party;
  totalPayableMinor: number;
  runningPayableMinor: number;
  openPurchases: {
    id: string;
    purchaseNumber: string;
    supplierInvoiceNumber: string;
    supplierInvoiceDate: string;
    totalMinor: number;
    paidMinor: number;
    balanceMinor: number;
  }[];
  entries: SupplierLedgerEntry[];
  paymentHistory: SupplierPaymentRecord[];
}

export const fetchInventoryDashboard = (paramsOrBranchId?: string | { branch?: string }, signal?: AbortSignal) => {
  const branch = typeof paramsOrBranchId === 'string' ? paramsOrBranchId : paramsOrBranchId?.branch;
  const queryStr = branch && branch !== 'all' ? `?branch=${encodeURIComponent(branch)}` : '';
  return api<{ stats: import('../../shared/types.ts').InventoryDashboardStats }>(`/api/inventory/dashboard${queryStr}`, { signal });
};

export const fetchInventoryItems = (params: {
  q?: string;
  category?: string;
  status?: string;
  sort?: string;
  branchId?: string;
  limit?: number;
  offset?: number;
  branch?: string;
} = {}, signal?: AbortSignal) => {
  const sp = new URLSearchParams();
  if (params.q) sp.set('q', params.q);
  if (params.category && params.category !== 'ALL') sp.set('category', params.category);
  if (params.status && params.status !== 'all') sp.set('status', params.status);
  if (params.sort) sp.set('sort', params.sort);
  if (params.branchId && params.branchId !== 'all') sp.set('branch', params.branchId);
  if (params.limit) sp.set('limit', String(params.limit));
  if (params.offset) sp.set('offset', String(params.offset));
  if (params.branch) sp.set('branch', params.branch);
  const queryStr = sp.toString() ? `?${sp.toString()}` : '';
  return api<{ items: Item[]; total: number; limit: number; offset: number }>(`/api/inventory/items${queryStr}`, { signal });
};

export const fetchStockLedger = (params: {
  itemId?: string;
  kind?: string;
  from?: string;
  to?: string;
  q?: string;
  limit?: number;
  offset?: number;
} = {}, signal?: AbortSignal) => {
  const sp = new URLSearchParams();
  if (params.itemId) sp.set('itemId', params.itemId);
  if (params.kind && params.kind !== 'ALL') sp.set('kind', params.kind);
  if (params.from) sp.set('from', params.from);
  if (params.to) sp.set('to', params.to);
  if (params.q) sp.set('q', params.q);
  if (params.limit) sp.set('limit', String(params.limit));
  if (params.offset) sp.set('offset', String(params.offset));
  const queryStr = sp.toString() ? `?${sp.toString()}` : '';
  return api<{ moves: import('../../shared/types.ts').StockMove[]; total: number; limit: number; offset: number }>(`/api/inventory/ledger${queryStr}`, { signal });
};

export const adjustStock = (data: {
  itemId: string;
  adjustmentType: 'quantity' | 'physical_count';
  changeQtyMilli?: number;
  newQtyMilli?: number;
  reason: string;
  notes?: string;
}) =>
  api<{ ok: boolean; adjustment: import('../../shared/types.ts').StockAdjustment; resultingStockMilli: number }>('/api/inventory/adjustments', {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const fetchStockCounts = (signal?: AbortSignal) =>
  api<{ counts: import('../../shared/types.ts').StockCount[] }>('/api/inventory/counts', { signal });

export const startStockCount = (data: { name: string; category?: string; notes?: string }) =>
  api<{ ok: boolean; count: import('../../shared/types.ts').StockCount }>('/api/inventory/counts', {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const fetchStockCountDetails = (id: string) =>
  api<{ count: import('../../shared/types.ts').StockCount; lines: import('../../shared/types.ts').StockCountLine[] }>(`/api/inventory/counts/${id}`);

export const saveStockCountLines = (id: string, lines: { lineId: string; countedQtyMilli: number | null; notes?: string }[]) =>
  api<{ ok: boolean }>(`/api/inventory/counts/${id}/lines`, {
    method: 'PATCH',
    body: JSON.stringify({ lines }),
  });

export const finalizeStockCount = (id: string) =>
  api<{ ok: boolean; countNumber: string; appliedAdjustmentsCount: number }>(`/api/inventory/counts/${id}/finalize`, {
    method: 'POST',
  });

export const cancelStockCount = (id: string) =>
  api<{ ok: boolean }>(`/api/inventory/counts/${id}/cancel`, {
    method: 'POST',
  });

export const updateItemReorder = (
  id: string,
  data: { reorderMilli: number; preferredSupplierId?: string | null },
) =>
  api<{ ok: boolean; item: any }>(`/api/inventory/items/${id}/reorder`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });

export const fetchInventoryInsights = (signal?: AbortSignal) =>
  api<{ insights: import('../../shared/types.ts').InventoryInsights }>('/api/inventory/insights', { signal });

export const fetchProductMovementAnalysis = (params: {
  range?: string;
  from?: string;
  to?: string;
  fastMinUnits?: number;
  fastMinTxns?: number;
} = {}) => {
  const sp = new URLSearchParams();
  if (params.range) sp.set('range', params.range);
  if (params.from) sp.set('from', params.from);
  if (params.to) sp.set('to', params.to);
  if (params.fastMinUnits !== undefined) sp.set('fastMinUnits', String(params.fastMinUnits));
  if (params.fastMinTxns !== undefined) sp.set('fastMinTxns', String(params.fastMinTxns));
  const qs = sp.toString() ? `?${sp.toString()}` : '';
  return api<import('../../shared/types.ts').ProductMovementAnalysisData>(`/api/inventory/movement-analysis${qs}`);
};

export const fetchSalesAnalysis = (params: {
  from?: string;
  to?: string;
  compare?: 'previous_period' | 'same_period_last_month' | 'none';
  counterId?: string;
  categoryId?: string;
  userId?: string;
  branch?: string;
} = {}) => {
  const sp = new URLSearchParams();
  if (params.from) sp.set('from', params.from);
  if (params.to) sp.set('to', params.to);
  if (params.compare) sp.set('compare', params.compare);
  if (params.counterId && params.counterId !== 'ALL') sp.set('counterId', params.counterId);
  if (params.categoryId && params.categoryId !== 'All categories' && params.categoryId !== 'ALL') sp.set('categoryId', params.categoryId);
  if (params.userId && params.userId !== 'ALL') sp.set('userId', params.userId);
  if (params.branch && params.branch.toLowerCase() !== 'all') sp.set('branch', params.branch);
  const qs = sp.toString() ? `?${sp.toString()}` : '';
  return api<import('../../shared/types.ts').SalesAnalysisData>(`/api/sales-analysis${qs}`);
};

export const scheduleDailySalesReportEmail = (data: { email: string; branch?: string }) => {
  return api<{ ok: boolean; message: string; reportSent?: boolean; email?: string }>(
    '/api/sales-analysis/schedule-email',
    {
      method: 'POST',
      body: JSON.stringify(data),
    }
  );
};

export const fetchScheduledDailySalesReportEmail = (branch?: string) => {
  const sp = new URLSearchParams();
  if (branch && branch.toLowerCase() !== 'all') sp.set('branch', branch);
  const qs = sp.toString() ? `?${sp.toString()}` : '';
  return api<{
    scheduled: boolean;
    email: string;
    isActive: boolean;
    scheduledTime: string;
    lastSentAt: string | null;
  }>(`/api/sales-analysis/schedule-email${qs}`);
};

export type {
  InventoryInsights,
  StockoutRiskItem,
  SlowMovingItem,
  InventoryDuplicateWarning,
  AuditVarianceHistory,
  BatchExpiryWarning,
  ProductMovementStatus,
  ProductMovementItem,
  ProductMovementSummary,
  ProductMovementAnalysisData,
  Shift,
  ShiftStatus,
  CashMovement,
  CashMovementType,
  ShiftSummary,
  ShiftPaymentMethodBreakdown,
  ShiftClosingReport,
  SalesSummaryMetrics,
  SalesComparisonDiff,
  SalesOverviewPoint,
  CategorySalesItem,
  HeatmapCell,
  PaymentModeBreakdown,
  TopCustomerItem,
  SalesInsight,
  DaywiseSalesRow,
  CashierPerformanceRow,
  CashierSummaryStrip,
  SalesAnalysisData,
} from '../../shared/types.ts';

// Cashier Shifts & Day-End Closing API
export interface OccupiedCounterInfo {
  shiftId?: string | null;
  shiftNumber?: string | null;
  counter: string;
  counterId?: string | null;
  counterName?: string | null;
  branchId: string;
  userId: string;
  userName: string;
  isCurrentUser: boolean;
  openedAt?: string;
}

export const fetchActiveShift = () =>
  api<{ ok: boolean; activeShift: import('../../shared/types.ts').Shift | null }>('/api/shifts/active');

export const fetchOccupiedCounters = (branchId?: string) => {
  const qs = branchId ? `?branchId=${encodeURIComponent(branchId)}` : '';
  return api<{ ok: boolean; occupiedCounters: OccupiedCounterInfo[] }>(`/api/shifts/occupied-counters${qs}`);
};

export const openShift = (data: { openingCashMinor: number; location?: string; counter?: string; counterId?: string; branchId?: string; notes?: string }) =>
  api<{ ok: boolean; shift: import('../../shared/types.ts').Shift }>('/api/shifts', {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const selectActiveShiftCounter = (data: { counterId?: string; counter?: string; branchId?: string }) =>
  api<{ ok: boolean; counter: string; counterName?: string; counterId?: string }>('/api/shifts/counter', {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const heartbeatActiveShiftCounter = () =>
  api<{ ok: boolean }>('/api/shifts/counter/heartbeat', {
    method: 'POST',
  });

export const fetchShifts = (params: { status?: string; limit?: number; offset?: number } = {}) => {
  const sp = new URLSearchParams();
  if (params.status && params.status !== 'ALL') sp.set('status', params.status);
  if (params.limit) sp.set('limit', String(params.limit));
  if (params.offset) sp.set('offset', String(params.offset));
  const qs = sp.toString() ? `?${sp.toString()}` : '';
  return api<{ ok: boolean; shifts: import('../../shared/types.ts').Shift[]; total: number }>(`/api/shifts${qs}`);
};

export const fetchShiftDetails = (id: string) =>
  api<{
    ok: boolean;
    shift: import('../../shared/types.ts').Shift;
    movements: import('../../shared/types.ts').CashMovement[];
    payments: any[];
    returns: any[];
  }>(`/api/shifts/${id}`);

export const recordCashMovement = (
  id: string,
  data: { movementType: 'cash_in' | 'cash_out'; amountMinor: number; reason: string; notes?: string },
) =>
  api<{
    ok: boolean;
    movement: import('../../shared/types.ts').CashMovement;
    summary?: import('../../shared/types.ts').ShiftSummary;
  }>(`/api/shifts/${id}/cash-moves`, {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const closeShift = (
  id: string,
  data: { countedCashMinor: number; varianceReason?: string; note?: string },
) =>
  api<{ ok: boolean; shift: import('../../shared/types.ts').Shift }>(`/api/shifts/${id}/close`, {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const reviewShift = (id: string, data: { reviewNotes?: string }) =>
  api<{ ok: boolean; shiftId: string; reviewedBy: string; reviewedAt: string; reviewNotes?: string }>(`/api/shifts/${id}/review`, {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const fetchShiftReport = (id: string) =>
  api<{ ok: boolean; report: import('../../shared/types.ts').ShiftClosingReport }>(`/api/shifts/${id}/report`);

// Multi-Branch Management APIs
export const fetchBranches = () => api<{ branches: Branch[] }>('/api/branches');
export const createBranch = (data: Partial<Branch>) =>
  api<Branch>('/api/branches', { method: 'POST', body: JSON.stringify(data) });
export const updateBranch = (id: string, data: Partial<Branch>) =>
  api<Branch>(`/api/branches/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const fetchBranchSummary = (id: string) =>
  api<BranchSummary>(`/api/branches/${id}/summary`);

// Re-export GST and Expense shared types and utilities
export type {
  Expense,
  ExpenseCategory,
  GstTreatment,
  ItcEligibility,
  ItcMatchingStatus,
  ItcReviewStatus,
  ItcRegisterItem,
  Gstr2bRecord,
  Gstr2bImportSummary,
  Gstr3bSummary,
  GstOverviewMetrics,
} from '../../shared/types.ts';

export {
  calcExpense,
  STANDARD_EXPENSE_CATEGORIES,
} from '../../shared/gst.ts';

// --------------------------------------------------------------------------
// Expenses APIs
// --------------------------------------------------------------------------
export const fetchExpenses = (params: Record<string, string> = {}) => {
  const query = new URLSearchParams(params).toString();
  return api<{
    expenses: import('../../shared/types.ts').Expense[];
    totalCount: number;
    summary: {
      totalMinor: number;
      taxableMinor: number;
      totalGstMinor: number;
      itcMinor: number;
      paidMinor: number;
      balanceMinor: number;
    };
    page: number;
    limit: number;
  }>(`/api/expenses${query ? '?' + query : ''}`);
};

export const fetchExpenseCategories = () =>
  api<{ categories: typeof import('../../shared/gst.ts').STANDARD_EXPENSE_CATEGORIES }>('/api/expenses/categories');

export const createExpense = (data: Partial<import('../../shared/types.ts').Expense>) =>
  api<{ ok?: boolean; expense: import('../../shared/types.ts').Expense }>('/api/expenses', {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const updateExpense = (id: string, data: Partial<import('../../shared/types.ts').Expense>) =>
  api<{ ok?: boolean; expense: import('../../shared/types.ts').Expense }>(`/api/expenses/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });

export const voidExpense = (id: string, voidReason?: string) =>
  api<{ ok: boolean; expense: import('../../shared/types.ts').Expense }>(`/api/expenses/${id}/void`, {
    method: 'POST',
    body: JSON.stringify({ voidReason }),
  });

export const fetchExpenseSummary = (params: Record<string, string> = {}) => {
  const query = new URLSearchParams(params).toString();
  return api<{
    totalMinor: number;
    taxableMinor: number;
    totalGstMinor: number;
    itcMinor: number;
    paidMinor: number;
    balanceMinor: number;
    byCategory: { category: string; count: number; totalMinor: number }[];
  }>(`/api/expenses/summary${query ? '?' + query : ''}`);
};

// --------------------------------------------------------------------------
// GST Module APIs
// --------------------------------------------------------------------------
export const fetchGstOverview = (period?: string, gstin?: string) => {
  const q = new URLSearchParams();
  if (period) q.set('period', period);
  if (gstin) q.set('gstin', gstin);
  return api<import('../../shared/types.ts').GstOverviewMetrics>(`/api/gst/overview?${q.toString()}`);
};

export const fetchGstSalesRegister = (params?: string | Record<string, string>) => {
  let query = '';
  if (typeof params === 'string') {
    query = `?period=${encodeURIComponent(params)}`;
  } else if (params) {
    query = `?${new URLSearchParams(params).toString()}`;
  }
  return api<{
    period: string;
    invoices: any[];
    summary: {
      totalInvoices: number;
      b2bCount: number;
      b2cCount: number;
      totalTaxableMinor: number;
      totalGstMinor: number;
      totalAmountMinor: number;
    };
  }>(`/api/gst/sales-register${query}`);
};

export const fetchGstPurchaseRegister = (params?: string | Record<string, string>) => {
  let query = '';
  if (typeof params === 'string') {
    query = `?period=${encodeURIComponent(params)}`;
  } else if (params) {
    query = `?${new URLSearchParams(params).toString()}`;
  }
  return api<{
    period: string;
    items: any[];
    summary: {
      totalRecords: number;
      purchasesCount: number;
      expensesCount: number;
      totalTaxableMinor: number;
      totalGstMinor: number;
      totalItcMinor: number;
      totalAmountMinor: number;
    };
  }>(`/api/gst/purchase-register${query}`);
};

export const fetchGstr1Summary = (period?: string, gstin?: string) => {
  const q = new URLSearchParams();
  if (period) q.set('period', period);
  if (gstin) q.set('gstin', gstin);
  return api<{
    period: string;
    gstin: string;
    status: 'ready' | 'pending';
    b2b: { count: number; taxableMinor: number; cgstMinor: number; sgstMinor: number; igstMinor: number; totalMinor: number; invoices: any[] };
    b2cl: { count: number; taxableMinor: number; igstMinor: number; totalMinor: number; invoices: any[] };
    b2cs: { count: number; taxableMinor: number; cgstMinor: number; sgstMinor: number; igstMinor: number; totalMinor: number };
    hsnSummary: { hsn: string; description: string; uqc: string; totalQty: number; taxableMinor: number; cgstMinor: number; sgstMinor: number; igstMinor: number; totalMinor: number }[];
    docsIssued: { type: string; from: string; to: string; totalNumber: number; cancelledNumber: number; netNumber: number }[];
    totalTaxableMinor: number;
    totalGstMinor: number;
  }>(`/api/gst/gstr1?${q.toString()}`);
};

export const fetchItcRegister = (period?: string) => {
  const q = period ? `?period=${encodeURIComponent(period)}` : '';
  return api<{
    period: string;
    items: import('../../shared/types.ts').ItcRegisterItem[];
    summary: {
      totalRecords: number;
      totalPotentialItcMinor: number;
      totalReviewedEligibleItcMinor: number;
      totalIneligibleItcMinor: number;
      pendingReviewCount: number;
      matchedCount: number;
      mismatchCount: number;
      missingIn2BCount: number;
    };
  }>(`/api/gst/itc-register${q}`);
};

export const submitItcReview = (data: {
  docType: 'purchase' | 'expense';
  docId: string;
  returnPeriod: string;
  eligibilityStatus: string;
  reviewedEligibleItcMinor: number;
  reason: string;
}) =>
  api<{ ok: boolean; review: any }>('/api/gst/itc-review', {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const importGstr2b = (data: {
  gstin: string;
  returnPeriod: string;
  filename: string;
  fileFormat: 'json' | 'csv';
  fileContent: any;
  forceOverwrite?: boolean;
}) =>
  api<{
    ok: boolean;
    importId: string;
    filename: string;
    returnPeriod: string;
    totalRecords: number;
    matchedCount: number;
    mismatchedCount: number;
    missingInBooksCount: number;
  }>('/api/gst/gstr2b/import', {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const fetchGstr3b = (period?: string, gstin?: string) => {
  const q = new URLSearchParams();
  if (period) q.set('period', period);
  if (gstin) q.set('gstin', gstin);
  return api<import('../../shared/types.ts').Gstr3bSummary>(`/api/gst/gstr3b?${q.toString()}`);
};

export const saveGstr3b = (data: {
  gstin: string;
  returnPeriod: string;
  status: 'draft' | 'reviewed' | 'filed' | 'exported';
  summary?: any;
  notes?: string;
}) =>
  api<{ ok: boolean; id: string; status: string }>('/api/gst/gstr3b/save', {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const fetchGstHistory = () =>
  api<{
    history: {
      id: string;
      returnType: string;
      returnPeriod: string;
      gstin: string;
      status: string;
      summary: any;
      notes?: string | null;
      filedByName: string;
      filedAt: string;
      createdAt: string;
    }[];
  }>('/api/gst/history');

// --------------------------------------------------------------------------
// Accounts & Finance Additional Overview APIs
// --------------------------------------------------------------------------
export const fetchFinanceCashBank = () =>
  api<{
    todayDate: string;
    collectionsByMethod: { method: string; totalMinor: number }[];
    supplierPaymentsByMethod: { method: string; totalMinor: number }[];
    expensesByMethod: { method: string; totalMinor: number }[];
    cashDrawer: {
      totalCashCollectionsMinor: number;
      cashMovementsInMinor: number;
      cashMovementsOutMinor: number;
    };
    digitalBank: {
      totalUpiMinor: number;
      totalCardMinor: number;
      totalBankMinor: number;
    };
  }>('/api/finance/cash-bank');

export const fetchFinanceReceivables = () =>
  api<{
    totalReceivableMinor: number;
    customersCount: number;
    customers: {
      customerId: string;
      customerName: string;
      customerPhone?: string | null;
      totalDueMinor: number;
      openInvoicesCount: number;
      oldestInvoiceDate: string;
    }[];
  }>('/api/finance/receivables');

export const fetchFinancePayables = () =>
  api<{
    totalPayableMinor: number;
    suppliersCount: number;
    suppliers: {
      supplierId: string;
      supplierName: string;
      supplierPhone?: string | null;
      supplierGstin?: string | null;
      totalPayableMinor: number;
      openPurchasesCount: number;
      oldestBillDate: string;
    }[];
  }>('/api/finance/payables');

// ── Bulk Product Import ──────────────────────────────────────────────────────

export interface AdditionalBarcode {
  barcode: string;
  barcodeType?: 'INTERNAL' | 'MANUFACTURER' | null;
}

export interface BulkImportRow {
  name: string;
  sku?: string | null;
  barcode?: string | null;
  hsn?: string | null;
  unit?: string | null;
  categoryId?: string | null;
  category?: string | null;
  subcategoryId?: string | null;
  subcategory?: string | null;
  productType?: 'Retail' | 'Wholesale' | string | null;
  size?: string | null;
  colour?: string | null;
  material?: string | null;
  designPattern?: string | null;
  description?: string | null;
  variants?: ProductVariant[];
  variantsCount?: number;
  totalStockMilli?: number;
  barcodeType?: 'INTERNAL' | 'MANUFACTURER' | null;
  additionalBarcodes?: (string | AdditionalBarcode)[] | null;
  productNature?: 'BRANDED' | 'SHOP_PRODUCT' | null;
  imageUrl?: string | null;
  /** Selling price in paise (integer). */
  priceMinor: number;
  /** Cost price in paise (integer). */
  costMinor?: number | null;
  /** MRP in paise (integer). */
  mrpMinor?: number | null;
  /** Offer / discount percentage (0 to 100). */
  offerPercentage?: number | null;
  /** GST tax rate in basis points (e.g. 500 = 5%). */
  taxRateBp?: number | null;
  /** Whether selling price already includes GST. */
  taxInclusive?: boolean | null;
  /** Opening / incoming stock in milli-units (e.g. 5000 = 5 pieces). */
  openingQtyMilli?: number | null;
  /** Reorder level in milli-units (e.g. 20000 = 20 units). */
  reorderMilli?: number | null;
  supplierId?: string | null;
  supplier?: string | null;
  parentProductId?: string | null;
  purchaseDate?: string | null;
  /** Whether this row is an identified restock of an existing product */
  isRestock?: boolean;
  /** The existing product ID being restocked */
  matchedItemId?: string | null;
  /** Whether to update the existing product price details */
  updatePrices?: boolean;
}

export interface BulkImportRowResult {
  rowIndex: number;
  status: 'created' | 'restocked' | 'skipped';
  name?: string;
  itemId?: string;
  reason?: string;
}

export interface BulkImportResult {
  importId: string;
  purchaseId?: string | null;
  purchaseNumber?: string | null;
  supplierId?: string | null;
  supplierName?: string | null;
  totalRows: number;
  created: number;
  restocked: number;
  skipped: number;
  barcodesSaved: number;
  reconciledSalesCount?: number;
  results: BulkImportRowResult[];
}

export const bulkImportItems = (
  rows: BulkImportRow[],
  importBatchId?: string,
  branchId?: string | null,
  supplierId?: string | null,
  supplierInvoiceNumber?: string | null,
) =>
  api<BulkImportResult>('/api/items/bulk-import', {
    method: 'POST',
    body: JSON.stringify({
      rows,
      importBatchId,
      branchId: branchId || undefined,
      supplierId: supplierId || undefined,
      supplierInvoiceNumber: supplierInvoiceNumber || undefined,
    }),
  });

export interface TemporaryProductSale {
  id: string;
  invoiceId: string;
  invoiceLineId?: string;
  invoiceNumber: string;
  supplierInvoiceNumber: string;
  productName: string;
  normalizedName?: string;
  sellingPriceMinor: number;
  soldQuantity: number;
  reconciledQuantity: number;
  remainingQuantity: number;
  reconciliationStatus: 'pending' | 'partially_reconciled' | 'reconciled';
  matchedItemId?: string | null;
  matchedVariantId?: string | null;
  reconciledPurchaseId?: string | null;
  createdAt: string;
  saleDate?: string;
  customerName?: string;
}

export const fetchPendingTemporarySales = (supplierInvoiceNumber?: string) =>
  api<{ ok: boolean; pendingSales: TemporaryProductSale[]; count: number }>(
    `/api/temporary-sales/pending${supplierInvoiceNumber ? `?supplierInvoiceNumber=${encodeURIComponent(supplierInvoiceNumber)}` : ''}`
  );

export const checkTemporarySalesMatch = (supplierInvoiceNumber: string) =>
  api<{ ok: boolean; supplierInvoiceNumber: string; matches: TemporaryProductSale[]; totalUnreconciledQty: number; hasPendingSales: boolean }>(
    `/api/temporary-sales/match?supplierInvoiceNumber=${encodeURIComponent(supplierInvoiceNumber)}`
  );

export const reconcileTemporarySaleManual = (id: string, body: { itemId: string; variantId: string; purchaseId?: string }) =>
  api<{ ok: boolean; message: string; sale: TemporaryProductSale }>(
    `/api/temporary-sales/${id}/reconcile-manual`,
    { method: 'POST', body: JSON.stringify(body) }
  );

export const generateInternalBarcodeApi = (branchId?: string) =>
  api<{ barcode: string; barcodeType: string; branchId: string | null }>(
    `/api/items/generate-barcode${branchId ? `?branchId=${encodeURIComponent(branchId)}` : ''}`
  );

export const checkBarcodeApi = (barcode: string, options?: { branchId?: string; barcodeType?: string; productId?: string }) => {
  const qp = new URLSearchParams();
  qp.set('barcode', barcode);
  if (options?.branchId) qp.set('branchId', options.branchId);
  if (options?.barcodeType) qp.set('barcodeType', options.barcodeType);
  if (options?.productId) qp.set('productId', options.productId);
  return api<{ available: boolean; conflict?: boolean; message?: string; barcodeType?: string; branchId?: string | null }>(
    `/api/items/check-barcode?${qp.toString()}`
  );
};

export const checkSkuApi = (sku: string, options?: { branchId?: string; productId?: string }) => {
  const qp = new URLSearchParams();
  qp.set('sku', sku);
  if (options?.branchId) qp.set('branchId', options.branchId);
  if (options?.productId) qp.set('productId', options.productId);
  return api<{ available: boolean; conflict?: boolean; message?: string; branchId?: string | null }>(
    `/api/items/check-sku?${qp.toString()}`
  );
};

export const fetchItemByBarcode = (code: string) =>
  api<{ item: Item }>(`/api/items/by-barcode/${encodeURIComponent(code)}`);

export const deleteProduct = (id: string) =>
  api<{ ok: boolean; deleted: boolean; itemId: string; message: string }>(`/api/items/${encodeURIComponent(id)}?permanent=true`, {
    method: 'DELETE',
  });

export interface TodayWholesaleData {
  totalSalesMinor: number;
  grossSalesMinor?: number;
  returnsMinor?: number;
  invoicesCount: number;
  totalUnitsSold: number;
  distinctProductsCount: number;
  taxableMinor: number;
  cgstMinor: number;
  sgstMinor: number;
  igstMinor: number;
  totalGstMinor: number;
  outstandingCreditMinor: number;
  paidMinor: number;
  compTotalSalesMinor: number;
  compInvoicesCount: number;
  salesChangePct: number | null;
  topItems: Array<{
    itemId: string;
    name: string;
    unit: string;
    quantity: number;
    salesMinor: number;
  }>;
  paymentModes: Array<{
    key: string;
    name: string;
    amountMinor: number;
    percentage: number;
    color: string;
  }>;
}

export interface TodayDashboardData {
  serverTime: string;
  nowKolkata: {
    timeStr: string;
    hour: number;
    minute: number;
    todayYMD: string;
    weekday: string;
    formattedDate: string;
    compDateYMD: string;
    compWeekday: string;
    compWeekdayShort: string;
    compLabel: string;
    lastWeekYMD?: string;
    lastWeekday?: string;
  };
  cards: {
    todaySales: {
      netSalesMinor: number;
      grossSalesMinor: number;
      compNetSalesMinor: number;
      changePct: number | null;
      diffMinor: number;
    };
    bills: {
      billsCount: number;
      compBillsCount: number;
      diffCount: number | null;
      hasCompBills: boolean;
    };
    avgBillValue: {
      avgBillMinor: number;
      compAvgBillMinor: number;
      changePct: number | null;
    };
    grossProfit: {
      profitMinor: number;
      marginPct: number;
      cogsMinor: number;
      isEstimated: boolean;
      visible: boolean;
    };
    itemsSold: {
      totalUnits: number;
      distinctProductsCount: number;
    };
    returns: {
      returnsMinor: number;
      returnsCount: number;
      returnRatePct: number;
      compReturnsMinor: number;
      changePct: number | null;
    };
  };
  hourly: {
    openingHour: number;
    closingHour: number;
    currentHour: number;
    currentMinute: number;
    busiestHourToday: {
      hour: number;
      label: string;
      salesMinor: number;
      billsCount: number;
      profitMinor: number;
      compSalesMinor: number;
      compBillsCount: number;
      compProfitMinor: number;
      lastWeekSalesMinor?: number;
    } | null;
    busiestHourComp: {
      hour: number;
      label: string;
      salesMinor: number;
      billsCount: number;
      profitMinor: number;
    } | null;
    busiestHourLastWeek?: {
      hour: number;
      label: string;
      salesMinor: number;
    } | null;
    isEveningRushAhead: boolean;
    subtitle: string;
    series: Array<{
      hour: number;
      label: string;
      hourRange: string;
      isPastOrCurrent: boolean;
      todaySalesMinor: number | null;
      todayBillsCount: number | null;
      todayProfitMinor: number | null;
      compSalesMinor: number;
      compBillsCount: number;
      compProfitMinor: number;
      lastWeekSalesMinor?: number;
      lastWeekBillsCount?: number;
      lastWeekProfitMinor?: number;
    }>;
  };
  payments: {
    collectedTotalMinor: number;
    modes: Array<{
      key: string;
      name: string;
      amountMinor: number;
      percentage: number;
      color: string;
    }>;
    gst: {
      totalGstMinor: number;
      cgstMinor: number;
      sgstMinor: number;
      igstMinor: number;
    };
  };
  topSellers: Array<{
    itemId: string;
    name: string;
    quantity: number;
    unit: string;
    salesMinor: number;
    barPct: number;
  }>;
  stockAttention: Array<{
    itemId: string;
    name: string;
    stockQty: number;
    unit: string;
    reorderLevel: number | null;
    soldTodayQty: number;
    status: 'out_of_stock' | 'sold_today' | 'below_reorder' | 'not_configured';
    badgeText: string;
    badgeType: 'danger' | 'warning' | 'neutral';
  }>;
  temporarySalesPending?: Array<{
    id: string;
    invoiceId: string;
    invoiceNumber: string;
    productName: string;
    supplierInvoiceNumber: string;
    soldQuantity: number;
    reconciledQuantity: number;
    remainingQuantity: number;
    reconciliationStatus: 'pending' | 'partially_reconciled' | 'reconciled';
    sellingPriceMinor: number;
    createdAt: string;
    saleDate?: string;
  }>;
  shiftDrawer: {
    hasOpenShift: boolean;
    shiftNumber: string | null;
    counterName: string;
    openedAt: string | null;
    openedAtFormatted: string | null;
    cashierName: string;
    openingCashMinor: number;
    cashSalesMinor: number;
    cashPaymentsMinor: number;
    cashRefundsMinor: number;
    cashInMinor: number;
    cashOutMinor: number;
    expectedCashMinor: number;
    activeShift: any | null;
  };
  selectedBranch?: {
    id: string;
    code: string;
    name: string;
  };
  branches?: Array<{
    id: string;
    code: string;
    name: string;
    active: boolean;
    counters?: string[];
  }>;
  countersToday?: {
    title: string;
    subtitle: string;
    branchId?: string;
    branchCode?: string;
    branchName?: string;
    counters: Array<{
      id: string;
      code?: string;
      name: string;
      amountMinor: number;
      formattedAmount: string;
    }>;
    totalMinor: number;
    formattedTotal: string;
  };
  wholesale?: TodayWholesaleData;
}

export const fetchTodayDashboard = (branch?: string) =>
  api<TodayDashboardData>(`/api/dashboard/today${branch ? `?branch=${encodeURIComponent(branch)}` : ''}`);

// --------------------------------------------------------------------------
// HSN / SAC Directory APIs
// --------------------------------------------------------------------------
export interface HsnItem {
  code: string;
  desc: string;
  type: 'HSN' | 'SAC';
}

export const searchHsnSac = (q: string, limit = 20) =>
  api<{ q: string; results: HsnItem[]; total: number }>(
    `/api/hsn/search?q=${encodeURIComponent(q)}&limit=${limit}`
  );

export const suggestHsnForProduct = (name: string, category?: string) => {
  const query = new URLSearchParams();
  if (name) query.set('name', name);
  if (category) query.set('category', category);
  return api<{ name: string; category: string; suggestions: HsnItem[] }>(
    `/api/hsn/suggest?${query.toString()}`
  );
};




// --------------------------------------------------------------------------
// Shop Payment & QR Settings APIs
// --------------------------------------------------------------------------
export interface PublicPaymentSettings {
  upiEnabled: boolean;
  qrType: 'static' | 'dynamic';
  provider: 'manual' | 'razorpay' | 'paytm' | 'phonepe';
  staticUpiId: string | null;
  staticMerchantName: string | null;
  rzpEnabled: boolean;
  rzpMode: 'test' | 'live';
  rzpKeyId: string | null;
  hasKeySecret: boolean;
  hasWebhookSecret: boolean;
  maskedKeySecret?: string;
  rzpQrExpiryMinutes: number;
  paytmEnabled?: boolean;
  paytmMode?: 'test' | 'live';
  paytmMid?: string | null;
  hasPaytmKey?: boolean;
  paytmWebsite?: string;
  phonepeEnabled?: boolean;
  phonepeMode?: 'test' | 'live';
  phonepeMid?: string | null;
  hasPhonePeSaltKey?: boolean;
  phonepeSaltIndex?: string;
  bankEnabled?: boolean;
  bankAccountName?: string | null;
  bankAccountNo?: string | null;
  bankIfsc?: string | null;
  bankName?: string | null;
  bankBranch?: string | null;
  status: 'not_configured' | 'connected' | 'error';
  statusMessage: string | null;
  enabledMethods: string[];
}

export interface PaymentAttempt {
  id?: string;
  attemptId: string;
  status: 'pending' | 'paid' | 'failed' | 'expired' | 'cancelled';
  amountMinor: number;
  qrPayload: string;
  qrSvg?: string;
  qrImageUrl?: string | null;
  expiresAt?: string | null;
  provider: 'manual' | 'razorpay' | 'paytm' | 'phonepe';
  qrType: 'static' | 'dynamic';
  providerPaymentId?: string;
  errorReason?: string;
}

export const getPaymentSettings = () =>
  api<PublicPaymentSettings>('/api/shop/payment-settings');

export const updatePaymentSettings = (settings: Partial<PublicPaymentSettings> & {
  target?: string;
  rzpKeySecret?: string;
  rzpWebhookSecret?: string;
  paytmMerchantKey?: string;
  phonepeSaltKey?: string;
}) =>
  api<PublicPaymentSettings>('/api/shop/payment-settings', {
    method: 'PUT',
    body: JSON.stringify(settings),
  });

export const createPaymentAttempt = (params: {
  amountMinor: number;
  qrType?: 'static' | 'dynamic';
  invoiceId?: string;
  idempotencyKey?: string;
  customerName?: string;
}) =>
  api<PaymentAttempt>('/api/payment-attempts', {
    method: 'POST',
    body: JSON.stringify(params),
  });

export const getPaymentAttemptStatus = (attemptId: string) =>
  api<{
    attemptId: string;
    status: 'pending' | 'paid' | 'failed' | 'expired' | 'cancelled';
    amountMinor: number;
    invoiceId?: string;
    providerPaymentId?: string;
    verifiedAt?: string;
    errorReason?: string;
  }>(`/api/payment-attempts/${encodeURIComponent(attemptId)}/status`);

export const verifyPaymentAttempt = (attemptId: string) =>
  api<{ status: string; verified: boolean; providerPaymentId?: string; message?: string }>(
    `/api/payment-attempts/${encodeURIComponent(attemptId)}/verify`,
    { method: 'POST' }
  );

export const manualVerifyPaymentAttempt = (attemptId: string, referenceNo?: string, note?: string) =>
  api<{ status: string; referenceNo: string; verifiedByName?: string }>(
    `/api/payment-attempts/${encodeURIComponent(attemptId)}/manual-verify`,
    {
      method: 'POST',
      body: JSON.stringify({ referenceNo, note }),
    }
  );

export const cancelPaymentAttempt = (attemptId: string) =>
  api<{ ok: boolean; status: string }>(
    `/api/payment-attempts/${encodeURIComponent(attemptId)}/cancel`,
    { method: 'POST' }
  );


// Stock Transfer APIs
export const getStockTransfers = (params?: {
  branch?: string;
  fromBranch?: string;
  toBranch?: string;
  status?: string;
  search?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}) => {
  const query = new URLSearchParams();
  if (params?.branch) query.set('branch', params.branch);
  if (params?.fromBranch) query.set('fromBranch', params.fromBranch);
  if (params?.toBranch) query.set('toBranch', params.toBranch);
  if (params?.status) query.set('status', params.status);
  if (params?.search) query.set('search', params.search);
  if (params?.from) query.set('from', params.from);
  if (params?.to) query.set('to', params.to);
  if (params?.page) query.set('page', String(params.page));
  if (params?.limit) query.set('limit', String(params.limit));
  const qs = query.toString();
  return api<{
    transfers: StockTransfer[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }>(`/api/stock-transfers${qs ? `?${qs}` : ''}`);
};

export const getNextStockTransferNumber = (branch?: string) =>
  api<{ nextTransferNumber: string }>(branch ? `/api/stock-transfers/next-number?branch=${encodeURIComponent(branch)}` : '/api/stock-transfers/next-number');

export const getBranchStock = (branch: string, q?: string, limit?: number, category?: string) => {
  const query = new URLSearchParams();
  query.set('branch', branch);
  if (q) query.set('q', q);
  if (limit) query.set('limit', String(limit));
  if (category && category !== 'ALL') query.set('category', category);
  return api<{ branch: string; items: any[] }>(`/api/stock-transfers/branch-stock?${query.toString()}`);
};

export const getStockTransfer = (id: string) =>
  api<{
    transfer: StockTransfer;
    lines: StockTransferLine[];
    stockMoves: { source: StockMove[]; destination: StockMove[] };
    activityLog: any[];
  }>(`/api/stock-transfers/${encodeURIComponent(id)}`);

export const createStockTransfer = (data: CreateStockTransferInput) =>
  api<{ success: boolean; transferId: string; transferNumber: string; message: string }>(
    '/api/stock-transfers',
    {
      method: 'POST',
      body: JSON.stringify(data),
    }
  );

export const dispatchStockTransfer = (id: string) =>
  api<{ success: boolean; status: string; message: string }>(
    `/api/stock-transfers/${encodeURIComponent(id)}/dispatch`,
    { method: 'POST' }
  );

export const receiveStockTransfer = (
  id: string,
  data?: {
    lines?: { lineId: string; receivedQty?: number; receivedQtyMilli?: number; discrepancyReason?: string }[];
    notes?: string;
  }
) =>
  api<{ success: boolean; status: string; message: string }>(
    `/api/stock-transfers/${encodeURIComponent(id)}/receive`,
    {
      method: 'POST',
      body: JSON.stringify(data || {}),
    }
  );

export const acceptStockTransfer = (
  id: string,
  data?: {
    lines?: { lineId: string; receivedQty?: number; receivedQtyMilli?: number; discrepancyReason?: string }[];
    notes?: string;
  }
) =>
  api<{ success: boolean; status: string; message: string }>(
    `/api/stock-transfers/${encodeURIComponent(id)}/accept`,
    {
      method: 'POST',
      body: JSON.stringify(data || {}),
    }
  );

export const cancelStockTransfer = (id: string, reason?: string) =>
  api<{ success: boolean; status: string; message: string }>(
    `/api/stock-transfers/${encodeURIComponent(id)}/cancel`,
    {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }
  );

// ==========================================
// Discounts & Promotions API
// ==========================================
export type {
  Promotion,
  PromotionInput,
  PromotionType,
  PromotionStatus,
  PromotionRules,
  AppliedPromotionDetail,
  PromotionNudge,
  PromotionEvalResult,
  AutoFreeItem,
  CartItemForEval,
} from '../../shared/promotions.ts';

import type {
  Promotion,
  PromotionInput,
  PromotionStatus,
  PromotionEvalResult,
  CartItemForEval,
} from '../../shared/promotions.ts';

export interface PromotionSummary {
  totalPromotions: number;
  activePromotions: number;
  scheduledPromotions: number;
  expiredPromotions: number;
  draftPromotions: number;
  pausedPromotions: number;
  totalDiscountGivenMinor: number;
  salesGeneratedMinor: number;
}

export interface PromotionReportsData {
  overview: {
    totalDiscountMinor: number;
    billsCount: number;
    revenueMinor: number;
    totalPromotionsCount: number;
    activePromotionsCount: number;
  };
  mostUsedPromotions: Array<{
    promotionId: string;
    name: string;
    type: string;
    usageCount: number;
    totalDiscountMinor: number;
    revenueGeneratedMinor: number;
  }>;
  branchPerformance: Array<{
    branch: string;
    usageCount: number;
    totalDiscountMinor: number;
    totalSalesMinor: number;
  }>;
  timeline: Array<{
    bdate: string;
    usageCount: number;
    discountMinor: number;
    salesMinor: number;
  }>;
}

export const fetchPromotions = (query?: {
  search?: string;
  type?: string;
  status?: string;
  branch?: string;
}) => {
  const params = new URLSearchParams();
  if (query?.search) params.append('search', query.search);
  if (query?.type && query.type !== 'ALL') params.append('type', query.type);
  if (query?.status && query.status !== 'all') params.append('status', query.status);
  if (query?.branch && query.branch !== 'ALL') params.append('branch', query.branch);
  const qStr = params.toString() ? '?' + params.toString() : '';
  return api<{ promotions: Promotion[]; summary: PromotionSummary }>('/api/promotions' + qStr);
};

export const fetchPromotion = (id: string) =>
  api<{ promotion: Promotion }>(`/api/promotions/${encodeURIComponent(id)}`);

export const createPromotion = (promo: PromotionInput) =>
  api<{ promotion: Promotion }>('/api/promotions', {
    method: 'POST',
    body: JSON.stringify(promo),
  });

export const updatePromotion = (id: string, promo: Partial<PromotionInput>) =>
  api<{ promotion: Promotion }>(`/api/promotions/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(promo),
  });

export const duplicatePromotion = (id: string) =>
  api<{ promotion: Promotion }>(`/api/promotions/${encodeURIComponent(id)}/duplicate`, {
    method: 'POST',
  });

export const updatePromotionStatus = (id: string, status: PromotionStatus) =>
  api<{ promotion: Promotion }>(`/api/promotions/${encodeURIComponent(id)}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });

export const deletePromotion = (id: string) =>
  api<{ success: boolean }>(`/api/promotions/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });

export const evaluatePromotionsApi = (payload: {
  cart: CartItemForEval[];
  partyId?: string;
  customerPhone?: string;
  branch?: string;
  counter?: string;
}) =>
  api<PromotionEvalResult>('/api/promotions/evaluate', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

export const fetchPromotionReports = (query?: {
  period?: 'today' | 'week' | 'this_month' | 'custom';
  startDate?: string;
  endDate?: string;
  branch?: string;
  type?: string;
}) => {
  const params = new URLSearchParams();
  if (query?.period) params.append('period', query.period);
  if (query?.startDate) params.append('startDate', query.startDate);
  if (query?.endDate) params.append('endDate', query.endDate);
  if (query?.branch) params.append('branch', query.branch);
  if (query?.type) params.append('type', query.type);
  const qStr = params.toString() ? '?' + params.toString() : '';
  return api<PromotionReportsData>('/api/promotions/reports' + qStr);
};


// =========================================================================
// USER MANAGEMENT MODULE APIS
// =========================================================================

export interface UserManagementSummary {
  branches: { total: number; active: number; inactive: number };
  managers: { total: number; assigned: number; unassigned: number };
  counters: { total: number; active: number; branches: number };
  branchesWithoutManager: number;
}

export interface StoreManager {
  id: string;
  name: string;
  username: string | null;
  email: string | null;
  phone: string | null;
  status: 'ACTIVE' | 'INVITED' | 'DISABLED';
  branchId: string | null;
  branchName: string | null;
  branchCode: string | null;
  branchActive?: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  lastEmailStatus?: 'SENT' | 'FAILED' | 'QUEUED' | null;
  lastEmailError?: string | null;
  lastEmailSentAt?: string | null;
}

export interface CounterItem {
  id: string;
  name: string;
  code: string;
  loginUsername: string | null;
  status: 'ACTIVE' | 'DISABLED';
  branch: {
    id: string;
    name: string;
    code: string;
    active: boolean;
    status: string;
  };
  manager: { id: string; name: string } | null;
  createdAt: string;
  lastEmailStatus?: 'SENT' | 'FAILED' | 'QUEUED' | null;
  lastEmailError?: string | null;
  lastEmailSentAt?: string | null;
}

export interface ManagerInput {
  name: string;
  username?: string | null;
  email?: string | null;
  password?: string;
  branchId?: string | null;
  phone?: string | null;
  sendEmail?: boolean;
  mustChangePassword?: boolean;
}

export const fetchUserManagementSummary = () =>
  api<UserManagementSummary>('/api/user-management/summary');

export const fetchManagers = (query?: { search?: string; branchId?: string; status?: string }) => {
  const p = new URLSearchParams();
  if (query?.search) p.append('search', query.search);
  if (query?.branchId) p.append('branchId', query.branchId);
  if (query?.status) p.append('status', query.status);
  const qStr = p.toString() ? '?' + p.toString() : '';
  return api<{ managers: StoreManager[] }>('/api/managers' + qStr);
};

export const checkUsernameAvailability = (username: string, excludeId?: string) => {
  const p = new URLSearchParams({ username });
  if (excludeId) p.append('excludeId', excludeId);
  return api<{ available: boolean; error?: string }>('/api/managers/check-username?' + p.toString());
};

export const checkEmailAvailability = (email: string, excludeId?: string) => {
  const p = new URLSearchParams({ email });
  if (excludeId) p.append('excludeId', excludeId);
  return api<{ available: boolean; error?: string }>('/api/managers/check-email?' + p.toString());
};

export const createManager = (data: ManagerInput) =>
  api<{ ok: boolean; id: string; emailSent?: boolean }>('/api/managers', {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const updateManager = (id: string, data: Partial<ManagerInput>) =>
  api<{ ok: boolean; id: string }>(`/api/managers/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });

export const resetManagerPassword = (id: string) =>
  api<{ ok: boolean; temporaryPassword: string; manager: { id: string; name: string; email: string | null; username: string | null } }>(
    `/api/managers/${id}/reset-password`,
    { method: 'POST' },
  );

export const updateManagerStatus = (id: string, status: 'ACTIVE' | 'DISABLED') =>
  api<{ ok: boolean; id: string; status: 'ACTIVE' | 'INVITED' | 'DISABLED'; active: boolean }>(
    `/api/managers/${id}/status`,
    {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    },
  );

export const assignBranchManager = (branchId: string, managerId: string | null) =>
  api<{ ok: boolean; branchId: string; managerId: string | null }>(`/api/branches/${branchId}/manager`, {
    method: 'PATCH',
    body: JSON.stringify({ managerId }),
  });

export const fetchCounters = (query?: { search?: string; branchId?: string; status?: string }) => {
  const p = new URLSearchParams();
  if (query?.search) p.append('search', query.search);
  if (query?.branchId) p.append('branchId', query.branchId);
  if (query?.status) p.append('status', query.status);
  const qStr = p.toString() ? '?' + p.toString() : '';
  return api<{ counters: CounterItem[] }>('/api/counters' + qStr);
};

export const updateCounterStatus = (id: string, status: 'ACTIVE' | 'DISABLED') =>
  api<{ ok: boolean; id: string; status: string }>(`/api/counters/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });

export const createCounter = (data: { name: string; code: string; branchId: string; loginUsername?: string }) =>
  api<{ ok: boolean; id: string; name: string; code: string }>(`/api/counters`, {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const updateCounter = (id: string, data: { name?: string; code?: string; loginUsername?: string }) =>
  api<{ ok: boolean; id: string; name: string; code: string }>(`/api/counters/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });

// =========================================================================
// STORE MANAGER - BRANCH USERS APIS (Scoped to session.branchId)
// =========================================================================

export interface BranchUsersSummary {
  branch: {
    id: string;
    name: string;
    code: string;
    active: boolean;
  };
  counters: { total: number; active: number; disabled: number };
  cashiers: { total: number; active: number; invited: number };
  countersWithoutCashier: number;
}

export interface BranchCounterItem {
  id: string;
  name: string;
  code: string;
  loginUsername: string | null;
  email: string | null;
  status: 'ACTIVE' | 'DISABLED';
  lastActiveAt: string | null;
  cashiers: string[];
  createdAt: string;
  lastEmailStatus?: 'SENT' | 'FAILED' | 'QUEUED' | null;
  lastEmailError?: string | null;
  lastEmailSentAt?: string | null;
}

export interface BranchCashierItem {
  id: string;
  name: string;
  username: string | null;
  email: string | null;
  phone: string | null;
  defaultCounter: { id: string; name: string; code: string } | null;
  status: 'ACTIVE' | 'INVITED' | 'DISABLED';
  lastLoginAt: string | null;
  createdAt: string;
  lastEmailStatus?: 'SENT' | 'FAILED' | 'QUEUED' | null;
  lastEmailError?: string | null;
  lastEmailSentAt?: string | null;
}

export interface BranchCounterInput {
  name: string;
  code: string;
  username?: string | null;
  email?: string | null;
  password?: string;
  sendEmail?: boolean;
  mustChangePassword?: boolean;
}

export interface BranchCashierInput {
  name: string;
  username?: string | null;
  email?: string | null;
  password?: string;
  defaultCounterId?: string | null;
  phone?: string | null;
  sendEmail?: boolean;
  mustChangePassword?: boolean;
}

export const fetchBranchUsersSummary = (branchId?: string) => {
  const qStr = branchId ? `?branchId=${encodeURIComponent(branchId)}` : '';
  return api<BranchUsersSummary>('/api/branch/users/summary' + qStr);
};

export const fetchBranchCountersNextCode = () =>
  api<{ code: string; suggestedUsername: string; prefix: string }>('/api/branch/counters/next-code');

export const fetchBranchCounters = (query?: { search?: string; status?: string }) => {
  const p = new URLSearchParams();
  if (query?.search) p.append('search', query.search);
  if (query?.status) p.append('status', query.status);
  const qStr = p.toString() ? '?' + p.toString() : '';
  return api<{ counters: BranchCounterItem[] }>('/api/branch/counters' + qStr);
};

export const createBranchCounter = (data: BranchCounterInput) =>
  api<{ ok: boolean; id: string; name: string; code: string; emailSent?: boolean }>('/api/branch/counters', {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const updateBranchCounter = (id: string, data: Partial<BranchCounterInput>) =>
  api<{ ok: boolean; id: string }>(`/api/branch/counters/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });

export const fetchBranchCashiers = (query?: { search?: string; status?: string }) => {
  const p = new URLSearchParams();
  if (query?.search) p.append('search', query.search);
  if (query?.status) p.append('status', query.status);
  const qStr = p.toString() ? '?' + p.toString() : '';
  return api<{ cashiers: BranchCashierItem[] }>('/api/branch/cashiers' + qStr);
};

export const createBranchCashier = (data: BranchCashierInput) =>
  api<{ ok: boolean; id: string; name: string; emailSent?: boolean }>('/api/branch/cashiers', {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const updateBranchCashier = (id: string, data: Partial<BranchCashierInput>) =>
  api<{ ok: boolean; id: string }>(`/api/branch/cashiers/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });

export const resetBranchUserPassword = (id: string) =>
  api<{ ok: boolean; temporaryPassword: string; user: { id: string; name: string; email: string | null; username: string | null } }>(
    `/api/branch/users/${id}/reset-password`,
    { method: 'POST' },
  );

export const updateBranchUserStatus = (id: string, status: 'ACTIVE' | 'DISABLED') =>
  api<{ ok: boolean; id: string; status: 'ACTIVE' | 'INVITED' | 'DISABLED'; active: boolean }>(
    `/api/branch/users/${id}/status`,
    {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    },
  );

export const checkUserUsernameAvailability = (username: string, excludeId?: string) => {
  const p = new URLSearchParams({ username });
  if (excludeId) p.append('excludeId', excludeId);
  return api<{ available: boolean; error?: string }>('/api/users/check-username?' + p.toString());
};

export const checkUserEmailAvailability = (email: string, excludeId?: string) => {
  const p = new URLSearchParams({ email });
  if (excludeId) p.append('excludeId', excludeId);
  return api<{ available: boolean; error?: string }>('/api/users/check-email?' + p.toString());
};


// ----------------------------------------------------------------------------
// Mail & Delete Endpoints
// ----------------------------------------------------------------------------

export interface BranchDeleteImpact {
  branchName: string;
  branchCode: string;
  countersCount: number;
  counterLoginsCount: number;
  cashiersCount: number;
  managerName: string | null;
  billsCount?: number;
  canDelete?: boolean;
  blockers?: Array<{ key: string; label: string; count: number }>;
}

export interface ManagerDeleteImpact {
  name: string;
  branchName: string | null;
  branchCode: string | null;
}

export interface CounterDeleteImpact {
  name: string;
  code: string;
  loginUsername?: string | null;
  defaultCashiersCount?: number;
  hasHistory?: boolean;
  canDelete?: boolean;
}

export interface CashierDeleteImpact {
  name: string;
}

export const testMailConnection = (to: string) =>
  api<{ ok: boolean; message: string }>('/api/mail/test', {
    method: 'POST',
    body: JSON.stringify({ to }),
  });

export const resendUserCredentials = (id: string) =>
  api<{ ok: boolean; temporaryPassword?: string; emailQueued?: boolean; toEmail?: string }>(
    `/api/users/${id}/resend`,
    { method: 'POST' },
  );

export const resendBranchUserCredentials = (id: string) =>
  api<{ ok: boolean; temporaryPassword?: string; emailQueued?: boolean; toEmail?: string }>(
    `/api/branch/users/${id}/resend`,
    { method: 'POST' },
  );

// Delete Impact
export const fetchBranchDeleteImpact = (id: string) =>
  api<BranchDeleteImpact>(`/api/branches/${id}/delete-impact`);

export const fetchManagerDeleteImpact = (id: string) =>
  api<ManagerDeleteImpact>(`/api/managers/${id}/delete-impact`);

export const fetchCounterDeleteImpact = (id: string, isBranchScope = false) =>
  api<CounterDeleteImpact>(isBranchScope ? `/api/branch/counters/${id}/delete-impact` : `/api/counters/${id}/delete-impact`);

export const fetchCashierDeleteImpact = (id: string, isBranchScope = false) =>
  api<CashierDeleteImpact>(isBranchScope ? `/api/branch/cashiers/${id}/delete-impact` : `/api/cashiers/${id}/delete-impact`);

// Permanent Deletes
/** `confirm` is the branch code the user typed; the server checks it before deleting. */
export const deleteBranch = (id: string, confirm: string) =>
  api<{ ok: boolean; deleted: string; branchName?: string }>(
    `/api/branches/${encodeURIComponent(id)}?confirm=${encodeURIComponent(confirm)}`,
    { method: 'DELETE' },
  );

export const deleteManager = (id: string) =>
  api<{ ok: boolean; deleted: string; name?: string }>(`/api/managers/${id}`, {
    method: 'DELETE',
  });

export const deleteCounter = (id: string, isBranchScope = false) =>
  api<{ ok: boolean; deleted: string; name?: string }>(
    isBranchScope ? `/api/branch/counters/${id}` : `/api/counters/${id}`,
    { method: 'DELETE' },
  );

export const deleteCashier = (id: string, isBranchScope = false) =>
  api<{ ok: boolean; deleted: string; name?: string }>(
    isBranchScope ? `/api/branch/cashiers/${id}` : `/api/cashiers/${id}`,
    { method: 'DELETE' },
  );

// ==========================================
// SMS Integration & Free Trial Types and APIs
// ==========================================

export interface SmsTrialStatus {
  status: 'inactive' | 'active' | 'expired' | 'exhausted';
  totalCredits: number;
  creditsUsed: number;
  remainingCredits: number;
  activatedAt: string | null;
  expiresAt: string | null;
  activatedBy: string | null;
  canActivate: boolean;
  canSend: boolean;
  provider: string;
  providerType: string;
  isConfigured: boolean;
  autoSendEnabled?: boolean;
}

export interface SmsSettings {
  provider: 'msg91' | 'smslocal' | 'fast2sms' | 'twilio' | 'generic' | 'simulator';
  senderId: string;
  templateId: string;
  autoSendEnabled: boolean;
  hasApiKey: boolean;
  apiKeyMasked: string;
  isConfigured: boolean;
  authStatus?: 'valid' | 'invalid' | 'unconfigured';
  walletBalance?: string | null;
  apiRouteUnlocked?: boolean;
  statusMessage?: string;
  providerNotice?: string | null;
}

export interface SmsHistoryItem {
  id: string;
  tenantId: string;
  branchId: string;
  branchName?: string;
  branchCode?: string;
  customerId?: string;
  invoiceId?: string;
  invoiceNumber?: string;
  customerName?: string;
  mobileNumber: string;
  messageText: string;
  status: 'pending' | 'sent' | 'failed' | 'delivered';
  creditType: 'trial' | 'paid';
  gatewayProvider: string;
  gatewayMessageId?: string;
  gatewayResponse?: any;
  errorMessage?: string;
  retryCount: number;
  sentAt?: string;
  createdAt: string;
}

export interface SmsHistoryResponse {
  total: number;
  limit: number;
  offset: number;
  history: SmsHistoryItem[];
}

export const getSmsTrialStatus = () => api<SmsTrialStatus>('/api/sms/trial-status');

export const getSmsSettings = () => api<SmsSettings>('/api/sms/settings');

export const updateSmsSettings = (data: {
  provider: string;
  apiKey?: string;
  senderId?: string;
  templateId?: string;
  autoSendEnabled?: boolean;
}) =>
  api<{ ok: boolean; settings: SmsSettings }>('/api/sms/settings', {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const activateSmsTrial = () =>
  api<{ ok: boolean; status: SmsTrialStatus }>('/api/sms/trial/activate', { method: 'POST' });

export const sendTestSms = (mobileNumber: string, message?: string) =>
  api<{ ok: boolean; messageId?: string; logId?: string; remainingCredits?: number; error?: string }>(
    '/api/sms/test',
    {
      method: 'POST',
      body: JSON.stringify({ mobileNumber, message }),
    }
  );

export const getSmsHistory = (params: { limit?: number; offset?: number; q?: string; status?: string; branchId?: string } = {}) => {
  const qp = new URLSearchParams();
  if (params.limit) qp.set('limit', String(params.limit));
  if (params.offset) qp.set('offset', String(params.offset));
  if (params.q) qp.set('q', params.q);
  if (params.status) qp.set('status', params.status);
  if (params.branchId) qp.set('branchId', params.branchId);
  return api<SmsHistoryResponse>(`/api/sms/history?${qp.toString()}`);
};

export const retrySms = (id: string) =>
  api<{ ok: boolean; status: string; error?: string; remainingCredits?: number }>(
    `/api/sms/retry/${id}`,
    { method: 'POST' }
  );

// =========================================================================
// RETURN, EXCHANGE & DAY CLOSING APIS
// =========================================================================

export const searchInvoicesForReturn = (q: string) =>
  api<{ invoices: any[] }>(`/api/invoices/search-for-return?q=${encodeURIComponent(q)}`);

export const fetchInvoiceReturnInfo = (invoiceId: string) =>
  api<ReturnInfo>(`/api/invoices/${encodeURIComponent(invoiceId)}/return-info`);

export const createReturnCreditNote = (invoiceId: string, data: any) =>
  api<{ creditNoteId: string; number: string; creditNoteNumber: string; totalCreditMinor: number; settlement?: any }>(
    `/api/invoices/${encodeURIComponent(invoiceId)}/returns`,
    {
      method: 'POST',
      body: JSON.stringify(data),
    }
  );

export const submitExchange = (data: {
  origInvoiceId: string;
  branchId?: string;
  counter?: string;
  counterId?: string;
  returnLines: {
    origLineId: string;
    returnQtyMilli: number;
    condition: 'resellable' | 'damaged' | 'defective';
    reason: string;
    remarks?: string;
  }[];
  newLines: any[];
  paymentMethod?: string;
  paymentRef?: string;
  excessRefundMethod?: string;
  customerName?: string;
  customerPhone?: string;
}) =>
  api<{
    success: boolean;
    exchangeId: string;
    creditNoteId: string;
    creditNoteNumber: string;
    newInvoiceId: string;
    newInvoiceNumber: string;
    returnTotalMinor: number;
    newPurchaseMinor: number;
    customerPayableMinor: number;
    customerRefundMinor: number;
    exchangeAdjustedMinor: number;
    netLoyaltyPointsAdjusted?: number;
    customerLoyaltyPoints?: number;
  }>('/api/exchanges', {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const fetchDayClosingPreview = (params: {
  bdate?: string;
  date?: string;
  branchId?: string;
  shiftId?: string;
  cashierId?: string;
  counterId?: string;
} = {}) => {
  const q = new URLSearchParams();
  const bdate = params.bdate || params.date;
  if (bdate) q.set('bdate', bdate);
  if (params.branchId) q.set('branchId', params.branchId);
  if (params.shiftId) q.set('shiftId', params.shiftId);
  if (params.cashierId) q.set('cashierId', params.cashierId);
  if (params.counterId) q.set('counterId', params.counterId);
  return api<any>(`/api/day-closing/preview?${q.toString()}`);
};

export interface ClosedBusinessDate {
  bdate: string;
  dayClosingId: string;
  status: string;
  closedAt: string;
  closedByName: string;
  originalSalesTotalMinor: number;
  originalNetSalesMinor: number;
  originalCashMinor: number;
  invoicesCount: number;
  lateSalesCount: number;
  lateSalesTotalMinor: number;
}

export const getClosedBusinessDates = (branchId?: string) => {
  const q = new URLSearchParams();
  if (branchId) q.set('branchId', branchId);
  return api<{ closedDates: ClosedBusinessDate[] }>(`/api/day-closing/closed-dates?${q.toString()}`);
};

export const submitDayClosing = (data: {
  bdate?: string;
  date?: string;
  branchId?: string;
  shiftId?: string;
  cashierId?: string;
  counterId?: string;
  status?: string;
  actualCashMinor?: number;
  actualClosingCashMinor?: number;
  remarks?: string;
  closingRemarks?: string;
  tenderReconciliation?: Record<string, { expectedMinor: number; actualMinor: number; differenceMinor: number }>;
  auditSummary?: any;
}) =>
  api<{ success: boolean; dayClosing: any }>('/api/day-closing/submit', {
    method: 'POST',
    body: JSON.stringify({
      bdate: data.bdate || data.date,
      branchId: data.branchId,
      shiftId: data.shiftId,
      cashierId: data.cashierId,
      counterId: data.counterId,
      status: data.status,
      actualCashMinor: data.actualCashMinor ?? data.actualClosingCashMinor,
      remarks: data.remarks || data.closingRemarks,
      tenderReconciliation: data.tenderReconciliation,
      auditSummary: data.auditSummary,
    }),
  });

export const approveDayClosing = (closingId: string) =>
  api<{ success: boolean; dayClosing: any }>(`/api/day-closing/${closingId}/approve`, {
    method: 'POST',
  });

export const rejectDayClosing = (closingId: string, reason: string) =>
  api<{ success: boolean; message: string; dayClosing?: any }>(`/api/day-closing/${closingId}/reject`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });

export const reopenDayClosing = (closingId: string, reason: string, pin?: string) =>
  api<{ success: boolean; dayClosing: any }>(`/api/day-closing/${closingId}/reopen`, {
    method: 'POST',
    body: JSON.stringify({ reason, pin }),
  });

export const fetchDayClosingComparison = (params: { branchId?: string; date?: string } = {}) => {
  const q = new URLSearchParams();
  if (params.branchId) q.set('branchId', params.branchId);
  if (params.date) q.set('date', params.date);
  return api<{
    bdate: string;
    previousDate: string;
    branchId: string;
    metrics: Record<string, { current: number; previous: number; diff: number; growthPct: number }>;
    last7DaysTrend: Array<{ date: string; grossSalesMinor: number; netSalesMinor: number; grossProfitMinor: number; invoicesCount: number }>;
  }>(`/api/day-closing/comparison?${q.toString()}`);
};

export const fetchDayClosingAnalytics = (params: {
  branchId?: string;
  startDate?: string;
  endDate?: string;
  comparisonMode?: 'previous_period' | 'same_period_last_year' | 'none';
} = {}) => {
  const q = new URLSearchParams();
  if (params.branchId) q.set('branchId', params.branchId);
  if (params.startDate) q.set('startDate', params.startDate);
  if (params.endDate) q.set('endDate', params.endDate);
  if (params.comparisonMode) q.set('comparisonMode', params.comparisonMode);
  return api<{
    period: { startDate: string; endDate: string; comparisonMode: string; daysInPeriod: number };
    current: any;
    comparison: any;
    dailySeries: Array<{ date: string; grossSalesMinor: number; netSalesMinor: number; grossProfitMinor: number; invoicesCount: number }>;
  }>(`/api/day-closing/analytics?${q.toString()}`);
};

export const fetchProductProfitability = (params: {
  branchId?: string;
  startDate?: string;
  endDate?: string;
  filter?: 'top_selling' | 'highest_revenue' | 'highest_profit' | 'lowest_profit' | 'loss_making' | 'most_returned';
  limit?: number;
} = {}) => {
  const q = new URLSearchParams();
  if (params.branchId) q.set('branchId', params.branchId);
  if (params.startDate) q.set('startDate', params.startDate);
  if (params.endDate) q.set('endDate', params.endDate);
  if (params.filter) q.set('filter', params.filter);
  if (params.limit) q.set('limit', String(params.limit));
  return api<{
    period: { startDate: string; endDate: string; filter: string };
    totalProductsCount: number;
    products: Array<{
      id: string;
      barcode: string;
      name: string;
      category_name: string;
      qty_sold: number;
      qty_returned: number;
      net_qty: number;
      gross_sales_minor: number;
      returns_minor: number;
      net_sales_minor: number;
      cogs_minor: number;
      gross_profit_minor: number;
      gross_margin_pct: number;
      return_rate_pct: number;
    }>;
  }>(`/api/day-closing/product-profitability?${q.toString()}`);
};

export const fetchDayClosingHistory = (params: { branchId?: string; limit?: number } = {}) => {
  const q = new URLSearchParams();
  if (params.branchId) q.set('branchId', params.branchId);
  if (params.limit) q.set('limit', String(params.limit));
  return api<{ history: any[]; records?: any[] }>(`/api/day-closing/history?${q.toString()}`).then((res) => ({
    history: res.history || [],
    records: res.history || [],
  }));
};

export const fetchCounterSalesReport = (params: {
  branchId?: string;
  date?: string;
  bdate?: string;
  startDate?: string;
  endDate?: string;
} = {}) => {
  const q = new URLSearchParams();
  const date = params.date || params.bdate;
  if (date) q.set('date', date);
  if (params.branchId) q.set('branchId', params.branchId);
  if (params.startDate) q.set('startDate', params.startDate);
  if (params.endDate) q.set('endDate', params.endDate);
  return api<{
    success: boolean;
    branchId: string;
    date: string;
    startDate: string;
    endDate: string;
    counters: any[];
    consolidatedTotal: any;
    exceptionCount: number;
  }>(`/api/day-closing/counter-sales?${q.toString()}`);
};

export const fetchCashierSalesReport = (params: {
  branchId?: string;
  date?: string;
  bdate?: string;
  startDate?: string;
  endDate?: string;
} = {}) => {
  const q = new URLSearchParams();
  const date = params.date || params.bdate;
  if (date) q.set('date', date);
  if (params.branchId) q.set('branchId', params.branchId);
  if (params.startDate) q.set('startDate', params.startDate);
  if (params.endDate) q.set('endDate', params.endDate);
  return api<{
    success: boolean;
    branchId: string;
    date: string;
    startDate: string;
    endDate: string;
    cashiers: any[];
    consolidatedTotal: any;
    exceptionCount: number;
  }>(`/api/day-closing/cashier-sales?${q.toString()}`);
};

export const fetchDayClosingSchedules = (branchId?: string, counterId?: string) => {
  const q = new URLSearchParams();
  if (branchId) q.set('branchId', branchId);
  if (counterId) q.set('counterId', counterId);
  return api<{
    success: boolean;
    branchId: string;
    counterId?: string | null;
    schedule: any;
    allSchedules: any[];
  }>(`/api/day-closing/schedules?${q.toString()}`);
};

export const saveDayClosingSchedule = (data: {
  branchId?: string;
  counterId?: string | null;
  expectedClosingTime: string;
  firstReminderMinutesBefore?: number;
  secondReminderMinutesBefore?: number;
  finalReminderAtClosing?: boolean;
  overdueReminderIntervalMinutes?: number;
  autoAlertOverdue?: boolean;
  enabled?: boolean;
}) =>
  api<{ success: boolean; id: string; schedule: any }>('/api/day-closing/schedules', {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const fetchDayClosingCompliance = (params: { branchId?: string; date?: string } = {}) => {
  const q = new URLSearchParams();
  if (params.branchId) q.set('branchId', params.branchId);
  if (params.date) q.set('date', params.date);
  return api<{
    success: boolean;
    branchId: string;
    date: string;
    expectedClosingTime: string;
    isBranchOverdue: boolean;
    minutesOverdue: number;
    lastReminderSentAt: string | null;
    lastReminderType: string | null;
    summary: {
      totalRegisters: number;
      closedCount: number;
      submittedCount: number;
      pendingCount: number;
      overdueCount: number;
      completionPct: number;
      isStoreClosed: boolean;
      storeStatus: string;
    };
    cashierMatrix: any[];
    counters: any[];
  }>(`/api/day-closing/compliance?${q.toString()}`);
};

export const sendDayClosingReminder = (data: {
  branchId?: string;
  cashierId?: string | null;
  counterId?: string | null;
  reminderType?: string;
  message?: string;
  date?: string;
}) =>
  api<{ success: boolean; message: string; notificationId: string }>('/api/day-closing/send-reminder', {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const fetchDayClosingNotifications = (params: { branchId?: string } = {}) => {
  const q = new URLSearchParams();
  if (params.branchId) q.set('branchId', params.branchId);
  return api<{
    success: boolean;
    notifications: any[];
    unreadCount: number;
  }>(`/api/day-closing/notifications?${q.toString()}`);
};

export const markDayClosingNotificationRead = (id: string) =>
  api<{ success: boolean }>(`/api/day-closing/notifications/${id}/read`, {
    method: 'POST',
  });

export const markAllDayClosingNotificationsRead = (ids?: string[]) =>
  api<{ success: boolean }>('/api/day-closing/notifications/read-all', {
    method: 'POST',
    body: ids && ids.length > 0 ? JSON.stringify({ ids }) : undefined,
  });

export type SmartAuditSeverity = 'critical' | 'warning' | 'info';

export type SmartAuditDetectorId =
  | 'cash_shortage'
  | 'cash_excess'
  | 'sales_mismatch'
  | 'payment_mismatch'
  | 'duplicate_transactions'
  | 'missing_transactions'
  | 'unusual_refund'
  | 'pending_bills'
  | 'unusual_discount'
  | 'stock_sales_consistency'
  | 'unassigned_transactions'
  | 'closing_readiness';

export interface SmartAuditIssue {
  id: string;
  detector: SmartAuditDetectorId;
  severity: SmartAuditSeverity;
  title: string;
  description: string;
  amountMinor?: number | null;
  count?: number;
  counterId?: string | null;
  counterCode?: string | null;
  cashierId?: string | null;
  cashierName?: string | null;
  bdate: string;
  recommendedAction: string;
  details?: Record<string, any>;
}

export interface SmartAuditResult {
  evaluatedAt: string;
  bdate: string;
  branchId: string;
  counterId?: string | null;
  cashierId?: string | null;
  readinessStatus: 'ready_to_submit' | 'ready_with_warnings' | 'action_required';
  readinessScore: number;
  summaryMessage: string;
  criticalCount: number;
  warningCount: number;
  infoCount: number;
  totalChecks: number;
  issues: SmartAuditIssue[];
  detectorSummary: Record<SmartAuditDetectorId, { status: 'passed' | 'warning' | 'failed'; issueCount: number }>;
}

export const fetchDayClosingAudit = (params: {
  branchId?: string;
  bdate?: string;
  date?: string;
  counterId?: string;
  cashierId?: string;
  shiftId?: string;
  actualCashMinor?: number;
} = {}) => {
  const q = new URLSearchParams();
  const bdate = params.bdate || params.date;
  if (bdate) q.set('bdate', bdate);
  if (params.branchId) q.set('branchId', params.branchId);
  if (params.counterId) q.set('counterId', params.counterId);
  if (params.cashierId) q.set('cashierId', params.cashierId);
  if (params.shiftId) q.set('shiftId', params.shiftId);
  if (params.actualCashMinor != null) q.set('actualCashMinor', String(params.actualCashMinor));
  return api<{
    success: boolean;
    audit: SmartAuditResult;
  }>(`/api/day-closing/audit?${q.toString()}`);
};

export const fetchReturnReports = (params: {
  reportType?: string;
  filter?: string;
  period?: string;
  from?: string;
  to?: string;
  startDate?: string;
  endDate?: string;
  branchId?: string;
}) => {
  const q = new URLSearchParams();
  q.set('reportType', params.reportType || 'daily_sales');
  const filter = params.filter || params.period || 'this_month';
  q.set('filter', filter);
  const from = params.from || params.startDate;
  const to = params.to || params.endDate;
  if (from) q.set('from', from);
  if (to) q.set('to', to);
  if (params.branchId) q.set('branchId', params.branchId);
  return api<any>(`/api/reports/returns-module?${q.toString()}`);
};

// ── Supplier Invoice to Excel Converter ───────────────────────────────────────
export interface ExtractedSupplierInvoiceItem {
  id: string;
  name: string;
  uom: string;
  sellingPrice: string;
  costPrice: string;
  hsn: string;
  gstRate: string;
  priceInclusive: 'Yes' | 'No';
  openingStock: string;
  rawRate?: string;
  rawQty?: string;
  rawDiscount?: string;
  rawTaxable?: string;
  rawTotal?: string;
  confidence?: 'high' | 'medium' | 'low';
  flags?: string[];
}

export interface SupplierInvoiceMetadata {
  supplierName: string;
  supplierGstin: string;
  invoiceNumber: string;
  invoiceDate: string;
  totalAmount: number | null;
  rawText: string;
  subtotalAmount?: number | null;
  cgstAmount?: number | null;
  sgstAmount?: number | null;
  igstAmount?: number | null;
  buyerName?: string;
  buyerAddress?: string;
  buyerGstin?: string;
  discrepancyWarning?: string;
}

export interface SupplierInvoiceExtractionResult {
  ok: boolean;
  metadata: SupplierInvoiceMetadata;
  headers: string[];
  detectedColumns: string[];
  columnMap: Record<string, string | undefined>;
  savedMapping: {
    id: string;
    supplierId?: string;
    supplierName: string;
    supplierGstin?: string;
    mapping: Record<string, string | undefined>;
  } | null;
  pageCount: number;
  isOcr: boolean;
  products: ExtractedSupplierInvoiceItem[];
  calculatedTotalCost: number;
  dataLinesPreview: string[];
}

export interface SupplierInvoiceMapping {
  id: string;
  supplierId?: string | null;
  supplierName: string;
  supplierGstin?: string | null;
  mapping: Record<string, string | undefined>;
  headerSample?: string[];
  createdAt: string;
  updatedAt: string;
}

export const extractSupplierInvoice = (payload: {
  fileName: string;
  fileData: string;
  mimeType?: string;
  supplierId?: string;
}) =>
  api<SupplierInvoiceExtractionResult>('/api/supplier-invoices/extract', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

export const reparseSupplierInvoice = (payload: {
  dataLines: string[];
  headers: string[];
  columnMap: Record<string, string | undefined>;
}) =>
  api<{
    ok: boolean;
    products: ExtractedSupplierInvoiceItem[];
    calculatedTotalCost: number;
    columnMap: Record<string, string | undefined>;
  }>('/api/supplier-invoices/reparse', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

export const fetchSupplierInvoiceMappings = () =>
  api<{ ok: boolean; mappings: SupplierInvoiceMapping[] }>('/api/supplier-invoices/mappings');

export const saveSupplierInvoiceMapping = (data: {
  id?: string;
  supplierId?: string | null;
  supplierName: string;
  supplierGstin?: string | null;
  mapping: Record<string, string | undefined>;
  headerSample?: string[];
}) =>
  api<{ ok: boolean; id: string; created?: boolean; updated?: boolean }>('/api/supplier-invoices/mappings', {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const deleteSupplierInvoiceMapping = (id: string) =>
  api<{ ok: boolean; deleted: boolean }>(`/api/supplier-invoices/mappings/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });

export interface DownloadableExcelBlob extends Blob {
  filename?: string;
}

export interface DownloadableInvoiceBlob extends Blob {
  filename?: string;
}

export const downloadInvoicePdf = async (
  invoiceId: string,
  paper: string = 'wholesale_a4'
): Promise<DownloadableInvoiceBlob> => {
  const { blob, filename } = await apiBlob(
    `/api/invoices/${encodeURIComponent(invoiceId)}/download-pdf?paper=${encodeURIComponent(paper)}`
  );
  const resBlob = blob as DownloadableInvoiceBlob;
  resBlob.filename = filename || `Wholesale_Invoice_${invoiceId}.pdf`;
  return resBlob;
};

export function triggerBlobDownload(blob: Blob, fallbackFilename: string = 'Invoice.pdf') {
  const filename = (blob as any).filename || fallbackFilename;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}

export const exportSupplierInvoiceExcel = async (payload: {
  products: ExtractedSupplierInvoiceItem[];
  invoiceNumber?: string;
}): Promise<DownloadableExcelBlob> => {
  const invoiceNum = (payload.invoiceNumber || 'INV').replace(/[^\w-]/g, '_');
  const dateStr = new Date().toISOString().slice(0, 10);
  const fallbackFilename = `Supplier_Product_Import_${invoiceNum}_${dateStr}.xlsx`;

  const { blob, filename } = await apiBlob('/api/supplier-invoices/export-excel', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  const resBlob = blob as DownloadableExcelBlob;
  resBlob.filename = filename || fallbackFilename;
  return resBlob;
};

export const fetchWholesaleCustomers = (params?: { search?: string; includeInactive?: boolean }) => {
  const q = new URLSearchParams();
  if (params?.search) q.set('search', params.search);
  if (params?.includeInactive) q.set('includeInactive', '1');
  q.set('limit', '500');
  const qs = q.toString() ? `?${q.toString()}` : '';
  return api<{ customers: WholesaleCustomer[] }>(`/api/wholesale-customers${qs}`);
};

export const createWholesaleCustomer = (payload: Partial<WholesaleCustomer>) =>
  api<{ customer: WholesaleCustomer }>('/api/wholesale-customers', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

export const updateWholesaleCustomer = (id: string, payload: Partial<WholesaleCustomer>) =>
  api<{ customer: WholesaleCustomer }>(`/api/wholesale-customers/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });

export const deleteWholesaleCustomer = (id: string) =>
  api<{ ok: boolean; deleted: boolean }>(`/api/wholesale-customers/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });

export type { RoleModuleAccessConfig };

export interface ModuleAccessChangeItem {
  role: 'owner' | 'manager' | 'cashier';
  moduleKey: string;
  enabled: boolean;
}

export interface SaveModuleAccessPayload {
  access?: RoleModuleAccessConfig;
  changes?: ModuleAccessChangeItem[];
}

export const fetchModuleAccess = () =>
  api<{ success: boolean; access: RoleModuleAccessConfig }>('/api/module-access');

export const saveModuleAccess = (
  payload: SaveModuleAccessPayload | RoleModuleAccessConfig
) => {
  const body =
    typeof payload === 'object' && payload !== null && ('access' in payload || 'changes' in payload)
      ? payload
      : { access: payload };
  return api<{
    success: boolean;
    message: string;
    access: RoleModuleAccessConfig;
    updatedCount?: number;
  }>('/api/module-access', {
    method: 'PUT',
    body: JSON.stringify(body),
  });
};

// Developer Mode API helpers
export async function unlockDeveloperMode(passcode: string): Promise<{ success: boolean; developerToken: string; expiresInSeconds: number }> {
  const res = await api<{ success: boolean; message: string; developerToken: string; expiresInSeconds: number }>('/api/developer/unlock', {
    method: 'POST',
    body: JSON.stringify({ passcode }),
  });
  if (res && res.developerToken) {
    setDeveloperToken(res.developerToken);
    window.dispatchEvent(new CustomEvent('developer_mode_unlocked', { detail: { token: res.developerToken } }));
  }
  return res;
}

export async function lockDeveloperMode(): Promise<void> {
  try {
    await api('/api/developer/lock', { method: 'POST' });
  } catch {
    // ignore
  } finally {
    clearDeveloperToken();
    window.dispatchEvent(new CustomEvent('developer_mode_locked'));
  }
}

export async function checkDeveloperStatus(): Promise<boolean> {
  const token = getDeveloperToken();
  if (!token) return false;
  try {
    const res = await api<{ active: boolean }>('/api/developer/status');
    if (!res.active) {
      clearDeveloperToken();
    }
    return Boolean(res.active);
  } catch {
    return false;
  }
}

// --------------------------------------------------------------------------
// Textile & Apparel Specific: Variants, Measurements, Tailoring, Job Works
// --------------------------------------------------------------------------

export interface ProductVariant {
  id: string;
  tenantId?: string;
  productId: string;
  size?: string | null;
  colour?: string | null;
  pattern?: string | null;
  sku?: string | null;
  barcode?: string | null;
  priceMinor: number;
  mrpMinor?: number | null;
  costMinor: number;
  offerPercentage?: number | null;
  purchaseDate?: string | null;
  stockMilli: number;
  reorderLevelMilli?: number;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface CustomerMeasurement {
  id: string;
  tenantId?: string;
  customerId?: string | null;
  customerName: string;
  customerPhone?: string | null;
  chest?: number | null;
  waist?: number | null;
  shoulder?: number | null;
  sleeve?: number | null;
  length?: number | null;
  neck?: number | null;
  hip?: number | null;
  notes?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface TailoringOrder {
  id: string;
  tenantId?: string;
  branchId?: string | null;
  orderNumber: string;
  customerId?: string | null;
  customerName: string;
  customerPhone?: string | null;
  measurementId?: string | null;
  serviceType: string;
  description?: string | null;
  dueDate: string;
  status: 'pending' | 'in_progress' | 'ready' | 'delivered' | 'cancelled';
  totalMinor: number;
  advancePaidMinor: number;
  balanceMinor: number;
  notes?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface JobWork {
  id: string;
  tenantId?: string;
  branchId?: string | null;
  jobNumber: string;
  workerName: string;
  workerPhone?: string | null;
  kind: string;
  issueDate: string;
  dueDate?: string | null;
  status: 'issued' | 'in_progress' | 'completed' | 'cancelled';
  fabricIssuedMeters?: number;
  wastagePct?: number;
  piecesExpected?: number;
  piecesReceived?: number;
  costPerPieceMinor?: number;
  totalCostMinor?: number;
  notes?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export const getItemVariants = (productId: string) =>
  api<{ variants: ProductVariant[] }>(`/api/items/${productId}/variants`);

export const saveItemVariants = (productId: string, variants: Partial<ProductVariant>[]) =>
  api<{ variants: ProductVariant[] }>(`/api/items/${productId}/variants`, {
    method: 'POST',
    body: JSON.stringify({ variants }),
  });

export const updateVariant = (variantId: string, data: Partial<ProductVariant>) =>
  api<{ variant: ProductVariant }>(`/api/variants/${variantId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });

export const deleteVariant = (variantId: string) =>
  api<{ ok: boolean }>(`/api/variants/${variantId}`, {
    method: 'DELETE',
  });

export const getCustomerMeasurements = (query: string) =>
  api<{ measurements: CustomerMeasurement[] }>(`/api/measurements?q=${encodeURIComponent(query)}`);

export const saveCustomerMeasurement = (data: Partial<CustomerMeasurement>) =>
  api<{ measurement: CustomerMeasurement }>(`/api/measurements`, {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const getTailoringOrders = (params?: { status?: string; search?: string }) => {
  const q = new URLSearchParams();
  if (params?.status) q.set('status', params.status);
  if (params?.search) q.set('q', params.search);
  const qs = q.toString();
  return api<{ orders: TailoringOrder[] }>(`/api/tailoring-orders${qs ? `?${qs}` : ''}`);
};

export const createTailoringOrder = (data: Partial<TailoringOrder>) =>
  api<{ order: TailoringOrder }>(`/api/tailoring-orders`, {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const updateTailoringOrder = (id: string, data: Partial<TailoringOrder>) =>
  api<{ order: TailoringOrder }>(`/api/tailoring-orders/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });

export const getJobWorks = (params?: { status?: string }) => {
  const q = new URLSearchParams();
  if (params?.status) q.set('status', params.status);
  const qs = q.toString();
  return api<{ jobWorks: JobWork[] }>(`/api/job-works${qs ? `?${qs}` : ''}`);
};

export const createJobWork = (data: Partial<JobWork>) =>
  api<{ jobWork: JobWork }>(`/api/job-works`, {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const updateJobWork = (id: string, data: Partial<JobWork>) =>
  api<{ jobWork: JobWork }>(`/api/job-works/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });

export const getVariantSalesStockReport = () =>
  api<{ report: any[] }>(`/api/reports/variants/sales-stock`);

export const getDeadStockReport = (days = 30) =>
  api<{ report: any[] }>(`/api/reports/variants/dead-stock?days=${days}`);

export const getPendingTailoringReport = () =>
  api<{ report: any[] }>(`/api/reports/tailoring/pending`);







