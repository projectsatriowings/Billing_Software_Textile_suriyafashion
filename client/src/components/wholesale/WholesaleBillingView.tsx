import React, { useState, useMemo, useEffect, useRef, useCallback, useContext } from 'react';
import {
  Users,
  UserPlus,
  Package,
  Search,
  ShoppingCart,
  Phone,
  AlertTriangle,
  Trash2,
  Banknote,
  QrCode,
  FileText,
  Clock,
  FileCheck,
  X,
  CheckCircle2,
  Printer,
  Download,
} from 'lucide-react';
import type { User, Shop, Item, Party, Branch, WholesaleCustomer } from '../../api';
import { api, downloadInvoicePdf, triggerBlobDownload, fetchWholesaleCustomers, createWholesaleCustomer } from '../../api';
import { BranchContext } from '../../contexts/BranchContext';
import { moneyInWords } from '../../../../shared/money.ts';
import { STATES } from '../../../../shared/states.ts';
import { DEFAULT_INVOICE_PROFILES } from '../../../../shared/types.ts';

export function formatStockUnit(qty: number, rawUnit?: string | null): string {
  const u = (rawUnit || 'pcs').trim();
  if (!u) return 'Pcs';
  const lower = u.toLowerCase();

  if (lower === 'pcs' || lower === 'piece' || lower === 'pieces' || lower === 'pc') {
    return qty === 1 ? 'Pc' : 'Pcs';
  }
  if (lower === 'bag' || lower === 'bags') {
    return qty === 1 ? 'Bag' : 'Bags';
  }
  if (lower === 'pouch' || lower === 'pouches') {
    return qty === 1 ? 'Pouch' : 'Pouches';
  }
  if (lower === 'box' || lower === 'boxes') {
    return qty === 1 ? 'Box' : 'Boxes';
  }
  if (lower === 'pack' || lower === 'packs') {
    return qty === 1 ? 'Pack' : 'Packs';
  }
  if (lower === 'bottle' || lower === 'bottles') {
    return qty === 1 ? 'Bottle' : 'Bottles';
  }
  if (lower === 'can' || lower === 'cans') {
    return qty === 1 ? 'Can' : 'Cans';
  }
  if (lower === 'kg' || lower === 'kgs' || lower === 'kilogram' || lower === 'kilograms') {
    return 'Kg';
  }
  if (lower === 'gm' || lower === 'gms' || lower === 'gram' || lower === 'grams') {
    return 'Gm';
  }
  if (lower === 'ltr' || lower === 'liter' || lower === 'litre' || lower === 'litres' || lower === 'liters') {
    return 'Ltr';
  }
  if (lower === 'ml' || lower === 'mls') {
    return 'Ml';
  }
  if (lower === 'mtr' || lower === 'meter' || lower === 'meters' || lower === 'metre' || lower === 'metres') {
    return 'Mtr';
  }

  // Capitalize first letter
  const capitalized = u.charAt(0).toUpperCase() + u.slice(1);
  if (qty !== 1 && !capitalized.endsWith('s')) {
    return `${capitalized}s`;
  }
  return capitalized;
}

export interface WholesaleBillingViewProps {
  user: User;
  shop: Shop | null;
  items: Item[];
  branches: Branch[];
  selectedBranch: string;
  onRefreshData?: () => Promise<void> | void;
  showToast: (msg: string, type?: 'success' | 'error' | 'warning' | 'info') => void;
  onNavigateToSettings?: () => void;
}

interface CartLine {
  item: Item;
  qty: number; // e.g. 10 bags, 50 pcs
  rateRupees: number; // Wholesale selling price in ₹
  discountRupees: number; // Line discount in ₹
  hsn: string;
  gstRateBp: number; // e.g. 500 = 5%
  unit: string;
}

export function WholesaleBillingView({
  user,
  shop,
  items,
  branches,
  selectedBranch,
  onRefreshData,
  showToast,
  onNavigateToSettings,
}: WholesaleBillingViewProps) {
  // Profiles
  const profiles = shop?.invoiceProfiles || DEFAULT_INVOICE_PROFILES;
  const wholesaleProfile = profiles.wholesale;

  // Branch context & active branch resolution
  const branchCtx = useContext(BranchContext);
  const isSuperAdmin = Boolean(
    user && (user.role === 'owner' || user.role === 'admin' || String(user.role).toUpperCase() === 'SUPER_ADMIN')
  );

  // Active branch:
  // 1. If Store Manager (non-Super Admin): strictly their assigned branch
  // 2. If Super Admin: the selected branch from BranchContext or prop, or fallback to first branch if 'all'
  const activeBranchObj = useMemo(() => {
    if (!isSuperAdmin) {
      const managerBranch = user.branchId || user.assignedLocation;
      return (
        branches.find(
          (b) => b.id === managerBranch || (b.code && b.code.toUpperCase() === (managerBranch || '').toUpperCase())
        ) || branches[0] || null
      );
    }

    const currentScope = branchCtx?.selectedBranch || selectedBranch || '';
    const isAll = !currentScope || currentScope.toLowerCase() === 'all';
    if (!isAll) {
      const match = branches.find(
        (b) => b.id === currentScope || (b.code && b.code.toUpperCase() === currentScope.toUpperCase())
      );
      if (match) return match;
    }

    return branchCtx?.activeBranch || branches[0] || null;
  }, [branches, selectedBranch, user, isSuperAdmin, branchCtx?.selectedBranch, branchCtx?.activeBranch]);

  // Branch-specific live stock map: { [itemId: string]: number (units) }
  const [branchStockMap, setBranchStockMap] = useState<Record<string, number>>({});
  const [, setIsLoadingStock] = useState<boolean>(false);

  // Branch-specific product catalog: loaded for the currently selected branch
  const [catalogItems, setCatalogItems] = useState<Item[]>([]);
  const [, setIsLoadingCatalog] = useState<boolean>(false);

  const fetchBranchCatalog = useCallback(async () => {
    const branchIdToQuery = activeBranchObj?.id;
    if (!branchIdToQuery) return;
    try {
      setIsLoadingCatalog(true);
      const res = await api<{ items: Item[] }>(
        `/api/items?includeInactive=0&branchId=${encodeURIComponent(branchIdToQuery)}&limit=500`
      );
      if (res && Array.isArray(res.items)) {
        setCatalogItems(res.items);
      }
    } catch (err) {
      console.error('[WholesaleBilling] Failed to fetch branch catalog:', err);
    } finally {
      setIsLoadingCatalog(false);
    }
  }, [activeBranchObj?.id]);

  const fetchBranchStock = useCallback(async () => {
    const branchIdToQuery = activeBranchObj?.id;
    if (!branchIdToQuery) return;
    try {
      setIsLoadingStock(true);
      const res = await api<{ branchId: string; stock: Record<string, number> }>(
        `/api/inventory/branch-stock?branchId=${encodeURIComponent(branchIdToQuery)}`
      );
      if (res && res.stock) {
        setBranchStockMap(res.stock);
      }
    } catch (err) {
      console.error('[WholesaleBilling] Failed to fetch branch stock:', err);
    } finally {
      setIsLoadingStock(false);
    }
  }, [activeBranchObj?.id]);

  // Load branch catalog and stock on mount, on branch change, or on global branch_scope_changed event
  useEffect(() => {
    fetchBranchCatalog();
    fetchBranchStock();

    const handleScopeChange = () => {
      fetchBranchCatalog();
      fetchBranchStock();
    };
    window.addEventListener('branch_scope_changed', handleScopeChange);
    return () => {
      window.removeEventListener('branch_scope_changed', handleScopeChange);
    };
  }, [fetchBranchCatalog, fetchBranchStock]);

  // Refresh branch catalog and stock when items prop reloads (e.g. after purchases, transfers, or adjustments)
  useEffect(() => {
    fetchBranchCatalog();
    fetchBranchStock();
  }, [fetchBranchCatalog, fetchBranchStock, branchCtx?.branchVersion, items]);

  // Effective catalog: strictly scoped to the active branch (returns full catalog, never sliced)
  const effectiveCatalog = useMemo(() => {
    if (catalogItems.length > 0) return catalogItems;
    if (!activeBranchObj) return [];
    return items.filter((it) => {
      const itBranch = it.branchId || (it as any).branch_id;
      if (!itBranch) return true;
      return (
        itBranch === activeBranchObj.id ||
        itBranch === activeBranchObj.code ||
        (activeBranchObj.code && String(itBranch).toUpperCase() === activeBranchObj.code.toUpperCase()) ||
        String(itBranch).toUpperCase() === String(activeBranchObj.id).toUpperCase()
      );
    });
  }, [catalogItems, items, activeBranchObj]);

  // Dedicated Wholesale Customers state (exclusively from wholesale_customers table)
  const [wholesaleCustomers, setWholesaleCustomers] = useState<WholesaleCustomer[]>([]);
  const [isLoadingWholesaleCustomers, setIsLoadingWholesaleCustomers] = useState(false);

  const loadWholesaleCustomers = useCallback(async () => {
    setIsLoadingWholesaleCustomers(true);
    try {
      const res = await fetchWholesaleCustomers();
      setWholesaleCustomers(res.customers || []);
    } catch (err: any) {
      console.error('Failed to load wholesale customers:', err);
      showToast(err.message || 'Failed to load wholesale customers', 'error');
    } finally {
      setIsLoadingWholesaleCustomers(false);
    }
  }, [showToast]);

  useEffect(() => {
    loadWholesaleCustomers();
  }, [loadWholesaleCustomers]);

  // Selected Customer State
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>(() => {
    try {
      return localStorage.getItem('wholesale_selected_customer_id') || '';
    } catch {
      return '';
    }
  });

  useEffect(() => {
    try {
      if (selectedCustomerId) {
        localStorage.setItem('wholesale_selected_customer_id', selectedCustomerId);
      } else {
        localStorage.removeItem('wholesale_selected_customer_id');
      }
    } catch { }
  }, [selectedCustomerId]);
  const [customerSearchQuery, setCustomerSearchQuery] = useState('');
  const [isCustomerDropdownOpen, setIsCustomerDropdownOpen] = useState(false);

  const selectedCustomer = useMemo(() => {
    return wholesaleCustomers.find((p) => p.id === selectedCustomerId) || null;
  }, [wholesaleCustomers, selectedCustomerId]);

  const displayedWholesaleCustomers = useMemo(() => {
    if (!customerSearchQuery.trim()) return wholesaleCustomers;
    const q = customerSearchQuery.trim().toLowerCase();
    return wholesaleCustomers.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.companyName && c.companyName.toLowerCase().includes(q)) ||
        (c.phone && c.phone.includes(q)) ||
        (c.gstin && c.gstin.toLowerCase().includes(q))
    );
  }, [wholesaleCustomers, customerSearchQuery]);

  // Shipping address override for this order
  const [shippingAddress, setShippingAddress] = useState('');

  useEffect(() => {
    if (selectedCustomer) {
      setShippingAddress(selectedCustomer.shippingAddress || selectedCustomer.billingAddress || selectedCustomer.address || '');
    } else {
      setShippingAddress('');
    }
  }, [selectedCustomer]);

  // Customer state detection for GST
  const customerStateCode = useMemo(() => {
    if (selectedCustomer?.gstin) {
      const clean = selectedCustomer.gstin.trim().toUpperCase();
      if (clean.length >= 2) return clean.slice(0, 2);
    }
    if (selectedCustomer?.stateCode) {
      return String(selectedCustomer.stateCode).padStart(2, '0');
    }
    if ((selectedCustomer as any)?.state_code) {
      return String((selectedCustomer as any).state_code).padStart(2, '0');
    }
    return null;
  }, [selectedCustomer]);

  const customerStateName = useMemo(() => {
    if (!customerStateCode) return '';
    return STATES.find((s) => s.code === customerStateCode)?.name || '';
  }, [customerStateCode]);

  const shopStateCode = useMemo(() => {
    if (wholesaleProfile?.gstin && wholesaleProfile.gstin.length >= 2) {
      return wholesaleProfile.gstin.slice(0, 2);
    }
    if (shop?.gstin && shop.gstin.length >= 2) {
      return shop.gstin.slice(0, 2);
    }
    return '33'; // Default TN
  }, [wholesaleProfile?.gstin, shop?.gstin]);

  const isInterstate = useMemo(() => {
    if (!customerStateCode) return false;
    return customerStateCode !== shopStateCode;
  }, [customerStateCode, shopStateCode]);

  // Cart Lines State
  const [cart, setCart] = useState<CartLine[]>(() => {
    try {
      const saved = localStorage.getItem('wholesale_active_cart');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch { }
    return [];
  });

  useEffect(() => {
    try {
      if (cart.length > 0) {
        localStorage.setItem('wholesale_active_cart', JSON.stringify(cart));
      } else {
        localStorage.removeItem('wholesale_active_cart');
      }
    } catch { }
  }, [cart]);

  // Synchronize cart item data with fresh `items` list when loaded from backend
  useEffect(() => {
    if (items.length === 0 || cart.length === 0) return;
    setCart((prev) => {
      let changed = false;
      const updated = prev.map((line) => {
        const freshItem = items.find((i) => i.id === line.item.id);
        if (freshItem && freshItem.currentStockMilli !== line.item.currentStockMilli) {
          changed = true;
          return { ...line, item: freshItem };
        }
        return line;
      });
      return changed ? updated : prev;
    });
  }, [items]);

  // Product Search State
  const [productSearch, setProductSearch] = useState('');
  const [isProductPickerOpen, setIsProductPickerOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Payment Breakdown State
  const [paymentMode, setPaymentMode] = useState<'cash' | 'upi' | 'cheque' | 'credit'>('cash');
  const [paidAmountRupees, setPaidAmountRupees] = useState<string>('');
  const [paymentReference, setPaymentReference] = useState('');

  // Bill-level discount
  const [billDiscountRupees, setBillDiscountRupees] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('wholesale_bill_discount');
      if (saved) {
        const num = Number(saved);
        if (!isNaN(num) && num >= 0) return num;
      }
    } catch { }
    return 0;
  });

  // Wholesale GST Toggle & Mode ('product' = per-product GST, 'bill' = overall bill GST)
  const [applyGst, setApplyGst] = useState<boolean>(() => Boolean(shop?.gstEnabled ?? true));
  const [gstMode, setGstMode] = useState<'product' | 'bill'>('product');
  const [overallGstRateBp, setOverallGstRateBp] = useState<number>(500);

  useEffect(() => {
    try {
      if (billDiscountRupees > 0) {
        localStorage.setItem('wholesale_bill_discount', String(billDiscountRupees));
      } else {
        localStorage.removeItem('wholesale_bill_discount');
      }
    } catch { }
  }, [billDiscountRupees]);

  // Quick Add Customer Modal
  const [showAddCustomerModal, setShowAddCustomerModal] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState('');
  const [newCustomerContact, setNewCustomerContact] = useState('');
  const [newCustomerPhone, setNewCustomerPhone] = useState('');
  const [newCustomerEmail, setNewCustomerEmail] = useState('');
  const [newCustomerGstin, setNewCustomerGstin] = useState('');
  const [newCustomerBillingAddress, setNewCustomerBillingAddress] = useState('');
  const [newCustomerShippingAddress, setNewCustomerShippingAddress] = useState('');
  const [newCustomerCreditLimit, setNewCustomerCreditLimit] = useState('');
  const [isSavingCustomer, setIsSavingCustomer] = useState(false);

  // Invoice Generation State
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [generatedInvoice, setGeneratedInvoice] = useState<{ id: string; number: string; totalMinor: number } | null>(null);
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);

  const handleDownloadInvoice = async (invoiceId: string, invoiceNumber?: string) => {
    if (isDownloadingPdf) return;
    setIsDownloadingPdf(true);
    try {
      const blob = await downloadInvoicePdf(invoiceId, 'wholesale_a4');
      triggerBlobDownload(blob, `Wholesale_Invoice_${invoiceNumber || 'INV'}.pdf`);
      showToast('Wholesale invoice PDF downloaded successfully', 'success');
    } catch (err: any) {
      console.error('Failed to download invoice PDF:', err);
      showToast(err.message || 'Failed to download wholesale invoice PDF. Please try again.', 'error');
    } finally {
      setIsDownloadingPdf(false);
    }
  };

  // Filter products: returns ALL products belonging to the selected branch, without arbitrary limit
  const filteredProducts = useMemo(() => {
    if (!productSearch.trim()) return effectiveCatalog;
    const q = productSearch.toLowerCase();
    return effectiveCatalog.filter(
      (it) =>
        it.name.toLowerCase().includes(q) ||
        (it.barcode && it.barcode.toLowerCase().includes(q)) ||
        (it.sku && it.sku.toLowerCase().includes(q))
    );
  }, [effectiveCatalog, productSearch]);

  // Add Item to Wholesale Cart
  const handleAddItem = (item: Item) => {
    // Default rate: wholesalePriceMinor if present, else priceMinor
    const rateMinor = item.wholesalePriceMinor !== undefined && item.wholesalePriceMinor !== null
      ? item.wholesalePriceMinor
      : item.priceMinor;
    const rateRupees = rateMinor / 100;

    // Default quantity: minWholesaleQtyMilli if set, else 1
    const defaultQty = item.minWholesaleQtyMilli ? item.minWholesaleQtyMilli / 1000 : 1;

    setCart((prev) => {
      const existingIdx = prev.findIndex((l) => l.item.id === item.id);
      if (existingIdx >= 0) {
        const copy = [...prev];
        copy[existingIdx].qty += 1;
        return copy;
      }
      return [
        ...prev,
        {
          item,
          qty: defaultQty,
          rateRupees,
          discountRupees: 0,
          hsn: item.hsn || '',
          gstRateBp: item.taxRateBp || 500,
          unit: item.unit || 'Pcs',
        },
      ];
    });

    setProductSearch('');
    setIsProductPickerOpen(false);
    showToast(`Added "${item.name}" to wholesale order`);
  };

  // Barcode / Enter key in product search
  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const q = productSearch.trim().toLowerCase();
      const match = effectiveCatalog.find(
        (it) =>
          (it.barcode && it.barcode.toLowerCase() === q) ||
          (it.sku && it.sku.toLowerCase() === q) ||
          it.name.toLowerCase() === q
      ) || filteredProducts[0];
      if (match) {
        handleAddItem(match);
      }
    }
  };

  // Calculations
  const calculated = useMemo(() => {
    let subtotalRupees = 0;
    let lineDiscountsRupees = 0;
    let taxableRupees = 0;
    let cgstRupees = 0;
    let sgstRupees = 0;
    let igstRupees = 0;
    let totalQty = 0;

    const lineCalculations = cart.map((line) => {
      const lineBaseRupees = (line.qty * line.rateRupees) - line.discountRupees;
      subtotalRupees += line.qty * line.rateRupees;
      lineDiscountsRupees += line.discountRupees;
      taxableRupees += lineBaseRupees;
      totalQty += line.qty;

      let lineCgst = 0;
      let lineSgst = 0;
      let lineIgst = 0;
      const effectiveGstBp = !applyGst
        ? 0
        : gstMode === 'bill'
          ? overallGstRateBp
          : line.gstRateBp;

      if (effectiveGstBp > 0) {
        if (isInterstate) {
          lineIgst = (lineBaseRupees * effectiveGstBp) / 10000;
          igstRupees += lineIgst;
        } else {
          const halfRate = Math.floor(effectiveGstBp / 2);
          lineCgst = (lineBaseRupees * halfRate) / 10000;
          lineSgst = (lineBaseRupees * (effectiveGstBp - halfRate)) / 10000;
          cgstRupees += lineCgst;
          sgstRupees += lineSgst;
        }
      }

      const lineTotalRupees = lineBaseRupees + lineCgst + lineSgst + lineIgst;

      return {
        lineBaseRupees,
        lineCgst,
        lineSgst,
        lineIgst,
        lineTotalRupees,
      };
    });

    // Bill-level discount
    const netTaxableRupees = Math.max(0, taxableRupees - billDiscountRupees);
    const discountScale = taxableRupees > 0 ? netTaxableRupees / taxableRupees : 1;
    const scaledCgstRupees = cgstRupees * discountScale;
    const scaledSgstRupees = sgstRupees * discountScale;
    const scaledIgstRupees = igstRupees * discountScale;
    const totalTaxRupees = scaledCgstRupees + scaledSgstRupees + scaledIgstRupees;
    const rawTotalRupees = netTaxableRupees + totalTaxRupees;

    // Nearest rupee round off (<= .50 rounds down, >= .51 rounds up)
    const rawPaise = Math.round(rawTotalRupees * 100);
    const absPaise = Math.abs(rawPaise);
    const baseRupees = Math.floor(absPaise / 100);
    const remPaise = absPaise % 100;
    const roundedAbsRupees = remPaise > 50 ? baseRupees + 1 : baseRupees;
    const roundedTotalRupees = rawPaise < 0 ? -roundedAbsRupees : roundedAbsRupees;
    const roundOffDiffRupees = Number((roundedTotalRupees - rawTotalRupees).toFixed(2));

    const totalPaise = Math.round(roundedTotalRupees * 100);

    return {
      totalQty,
      subtotalRupees,
      lineDiscountsRupees,
      netTaxableRupees,
      cgstRupees: scaledCgstRupees,
      sgstRupees: scaledSgstRupees,
      igstRupees: scaledIgstRupees,
      totalTaxRupees,
      roundOffDiffRupees,
      roundedTotalRupees,
      totalPaise,
      lineCalculations,
    };
  }, [cart, billDiscountRupees, isInterstate, applyGst, gstMode, overallGstRateBp]);

  // Payment Breakdown
  const paidNumeric = useMemo(() => {
    if (paymentMode === 'credit') return 0;
    if (!paidAmountRupees.trim()) return calculated.roundedTotalRupees;
    return Math.max(0, parseFloat(paidAmountRupees) || 0);
  }, [paymentMode, paidAmountRupees, calculated.roundedTotalRupees]);

  const balanceOnCredit = useMemo(() => {
    return Math.max(0, calculated.roundedTotalRupees - paidNumeric);
  }, [calculated.roundedTotalRupees, paidNumeric]);

  // Customer Credit Limit check
  const creditStatus = useMemo(() => {
    if (!selectedCustomer) return null;
    const limitMinor = selectedCustomer.creditLimitMinor || 0;
    const duesMinor = selectedCustomer.duesMinor || selectedCustomer.unpaidInvoicesMinor || 0;
    const availableMinor = Math.max(0, limitMinor - duesMinor);

    const newBalanceMinor = Math.round(balanceOnCredit * 100);
    const isExceeded = limitMinor > 0 && newBalanceMinor > availableMinor;

    return {
      limitMinor,
      duesMinor,
      availableMinor,
      isExceeded,
    };
  }, [selectedCustomer, balanceOnCredit]);

  // Save new Wholesale Customer (saved exclusively to wholesale_customers table)
  const handleSaveNewCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCustomerName.trim()) {
      showToast('Please enter customer/business name', 'error');
      return;
    }
    if (!newCustomerPhone.trim()) {
      showToast('Please enter mobile number', 'error');
      return;
    }

    setIsSavingCustomer(true);
    try {
      const payload: Partial<WholesaleCustomer> = {
        name: newCustomerName.trim(),
        companyName: newCustomerName.trim(),
        contactPerson: newCustomerContact.trim() || null,
        phone: newCustomerPhone.trim(),
        email: newCustomerEmail.trim() || null,
        gstin: newCustomerGstin.trim().toUpperCase() || null,
        billingAddress: newCustomerBillingAddress.trim() || null,
        shippingAddress: newCustomerShippingAddress.trim() || newCustomerBillingAddress.trim() || null,
        creditLimitMinor: newCustomerCreditLimit ? Math.round(parseFloat(newCustomerCreditLimit) * 100) : 0,
        branchId: activeBranchObj?.id || (selectedBranch && selectedBranch.toLowerCase() !== 'all' ? selectedBranch : null),
      };

      const res = await createWholesaleCustomer(payload);
      const created = res.customer;

      showToast(`Wholesale Customer "${created.name}" created successfully!`, 'success');
      setShowAddCustomerModal(false);
      setNewCustomerName('');
      setNewCustomerContact('');
      setNewCustomerPhone('');
      setNewCustomerEmail('');
      setNewCustomerGstin('');
      setNewCustomerBillingAddress('');
      setNewCustomerShippingAddress('');
      setNewCustomerCreditLimit('');

      // Immediately add to wholesale customers list and select it so it appears in the dropdown immediately
      setWholesaleCustomers((prev) => [created, ...prev.filter((c) => c.id !== created.id)]);
      setSelectedCustomerId(created.id);
      setCustomerSearchQuery('');

      // Background refresh
      loadWholesaleCustomers();
      if (onRefreshData) await onRefreshData();
    } catch (err: any) {
      showToast(err.message || 'Failed to create wholesale customer', 'error');
    } finally {
      setIsSavingCustomer(false);
    }
  };

  // Generate Wholesale Invoice
  const handleGenerateInvoice = async () => {
    if (cart.length === 0) {
      showToast('Order cart is empty. Add at least one product.', 'warning');
      return;
    }

    if (!selectedCustomer) {
      showToast('Please select a wholesale customer for B2B billing.', 'warning');
      return;
    }

    if (creditStatus?.isExceeded) {
      showToast(
        `Credit limit exceeded! Customer available credit is ₹${(creditStatus.availableMinor / 100).toFixed(2)}, but requested credit balance is ₹${balanceOnCredit.toFixed(2)}.`,
        'error'
      );
      return;
    }

    setIsSubmitting(true);
    try {
      // Lines payload
      const lines = cart.map((l) => {
        const effectiveTaxRateBp = !applyGst
          ? 0
          : gstMode === 'bill'
            ? overallGstRateBp
            : l.gstRateBp;
        return {
          itemId: l.item.id,
          name: l.item.name,
          qtyMilli: Math.round(l.qty * 1000),
          priceMinor: Math.round(l.rateRupees * 100),
          taxRateBp: effectiveTaxRateBp,
          taxRateBpOverride: effectiveTaxRateBp,
          discountMinor: Math.round(l.discountRupees * 100),
          hsn: l.hsn,
          unit: l.unit,
        };
      });

      // Payments payload
      const payments = [];
      const paidMinor = Math.round(paidNumeric * 100);

      if (paidMinor > 0) {
        payments.push({
          mode: paymentMode === 'credit' ? 'cash' : paymentMode,
          amountMinor: paidMinor,
          reference: paymentReference.trim() || undefined,
        });
      }

      if (balanceOnCredit > 0) {
        payments.push({
          mode: 'credit',
          amountMinor: Math.round(balanceOnCredit * 100),
          reference: 'Wholesale On-Account Credit',
        });
      }

      const custName = selectedCustomer.name.trim();
      const custPhone = selectedCustomer.phone?.trim() || undefined;
      const custGstin = selectedCustomer.gstin?.trim().toUpperCase() || undefined;
      const custContactPerson = (selectedCustomer as any).contactPerson?.trim() || undefined;
      const custAddress = selectedCustomer.address?.trim() || undefined;
      const shipAddress = shippingAddress.trim() || custAddress || undefined;

      const payload = {
        invoiceType: 'wholesale',
        applyGst,
        branchId: activeBranchObj?.id || (selectedBranch && selectedBranch.toLowerCase() !== 'all' ? selectedBranch : undefined),
        wholesaleCustomerId: selectedCustomer.id,
        customerId: selectedCustomer.id,
        customerName: custName,
        customerPhone: custPhone,
        customerGstin: custGstin,
        billingAddress: custAddress,
        shippingAddress: shipAddress,
        contactPerson: custContactPerson,
        placeState: customerStateCode || shopStateCode || '33',
        intra: !isInterstate,
        customer: {
          id: selectedCustomer.id,
          name: custName,
          phone: custPhone,
          gstin: custGstin,
          address: custAddress,
          shippingAddress: shipAddress,
          contactPerson: custContactPerson,
          stateCode: customerStateCode || undefined,
          stateName: customerStateName || undefined,
        },
        lines,
        payments,
        billDiscountMinor: Math.round(billDiscountRupees * 100),
        custom: {
          paymentTerms: paymentMode === 'credit' ? '30 Days Credit' : 'Due on Receipt',
          billingAddress: custAddress,
          shippingAddress: shipAddress,
          customerGstin: custGstin,
          customerState: customerStateName || undefined,
          customerStateCode: customerStateCode || undefined,
          contactPerson: custContactPerson,
        },
      };

      const res = await api<any>('/api/invoices', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      const invId = res.invoice?.id || res.id || res.invoiceId;
      const invNumber = res.invoice?.number || res.number || 'WH-BILL';
      const invTotal = res.invoice?.totalMinor ?? res.totalMinor ?? calculated.totalPaise;

      setGeneratedInvoice({
        id: invId,
        number: invNumber,
        totalMinor: invTotal,
      });
      setShowInvoiceModal(true);
      showToast(`Wholesale Invoice ${invNumber} generated successfully!`, 'success');

      // Clear cart
      setCart([]);
      setBillDiscountRupees(0);
      setPaidAmountRupees('');
      setPaymentReference('');
      setSelectedCustomerId('');
      // Refresh branch catalog, stock & wholesale customer balances immediately
      fetchBranchCatalog();
      fetchBranchStock();
      loadWholesaleCustomers();
      if (onRefreshData) await onRefreshData();
    } catch (err: any) {
      showToast(err.message || 'Failed to generate wholesale invoice', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="wholesale-billing-container" style={{ padding: '0 0 2.5rem' }}>
      {/* Main Grid: 2 Columns (Left: Selection & Cart, Right: Summary & Checkout) */}
      <div className="wholesale-billing-grid">
        {/* Left Column: Customer + Product Search + Order Items Table + Logistics */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* STEP 1: WHOLESALE CUSTOMER SELECTION */}
          <div
            style={{
              background: '#ffffff',
              borderRadius: '12px',
              border: '1px solid #e2e8f0',
              padding: '1.25rem',
              boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Users size={18} style={{ color: '#4f46e5' }} />
                <strong style={{ fontSize: '0.95rem', color: '#1e293b' }}>
                  Step 1: Select Wholesale Buyer / B2B Customer <span style={{ color: '#ef4444' }}>*</span>
                </strong>
              </div>
              <button
                type="button"
                onClick={() => setShowAddCustomerModal(true)}
                style={{
                  background: '#f1f5f9',
                  border: '1px solid #cbd5e1',
                  color: '#1e293b',
                  padding: '0.4rem 0.75rem',
                  borderRadius: '6px',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                }}
              >
                <UserPlus size={14} /> New Wholesale Customer
              </button>
            </div>

            {/* Customer Dropdown / Search */}
            <div style={{ position: 'relative', marginBottom: '0.75rem' }}>
              {wholesaleCustomers.length > 8 && (
                <div style={{ marginBottom: '0.45rem', position: 'relative' }}>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Search wholesale customers by name, phone, or GSTIN..."
                    value={customerSearchQuery}
                    onChange={(e) => setCustomerSearchQuery(e.target.value)}
                    style={{ fontSize: '0.84rem', padding: '0.35rem 0.6rem 0.35rem 2rem' }}
                  />
                  <Search size={14} style={{ position: 'absolute', left: '0.65rem', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                  {customerSearchQuery && (
                    <button
                      type="button"
                      onClick={() => setCustomerSearchQuery('')}
                      style={{ position: 'absolute', right: '0.65rem', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8' }}
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>
              )}
              <select
                className="form-input"
                value={selectedCustomerId}
                onChange={(e) => setSelectedCustomerId(e.target.value)}
                style={{ fontWeight: 500, fontSize: '0.9rem' }}
                disabled={isLoadingWholesaleCustomers}
              >
                <option value="">
                  {isLoadingWholesaleCustomers
                    ? '-- Loading Wholesale Customers... --'
                    : displayedWholesaleCustomers.length === 0 && customerSearchQuery
                      ? '-- No Matching Wholesale Customers Found --'
                      : wholesaleCustomers.length === 0
                        ? '-- No Wholesale Customers Found (Click "+ New Wholesale Customer") --'
                        : '-- Choose Wholesale Buyer / Company --'}
                </option>
                {displayedWholesaleCustomers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} {c.phone ? `(${c.phone})` : ''} · {c.gstin ? `GSTIN: ${c.gstin}` : 'Unregistered'}
                  </option>
                ))}
              </select>
            </div>

            {/* Selected Customer Details Card */}
            {selectedCustomer && (
              <div
                style={{
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: '10px',
                  padding: '1rem',
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                  gap: '0.85rem',
                }}
              >
                <div>
                  <div style={{ fontSize: '0.72rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 600 }}>Buyer Firm</div>
                  <div style={{ fontSize: '0.92rem', fontWeight: 700, color: '#1e293b' }}>{selectedCustomer.name}</div>
                  {(selectedCustomer as any).contactPerson && (
                    <div style={{ fontSize: '0.78rem', color: '#475569' }}>Attn: {(selectedCustomer as any).contactPerson}</div>
                  )}
                  <div style={{ fontSize: '0.78rem', color: '#475569', marginTop: '0.2rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <Phone size={13} style={{ color: '#64748b' }} /> {selectedCustomer.phone || '—'}
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: '0.72rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 600 }}>GSTIN &amp; Supply State</div>
                  <div style={{ fontSize: '0.88rem', fontWeight: 600, color: selectedCustomer.gstin ? '#0284c7' : '#64748b' }}>
                    {selectedCustomer.gstin || 'Unregistered B2C'}
                  </div>
                  {customerStateCode && (
                    <div style={{ fontSize: '0.76rem', color: '#0369a1', marginTop: '0.2rem' }}>
                      {STATES.find((s) => s.code === customerStateCode)?.name || 'State'} (Code {customerStateCode})
                      {isInterstate ? (
                        <span style={{ marginLeft: '4px', background: '#fef3c7', color: '#92400e', padding: '1px 5px', borderRadius: '4px', fontWeight: 600 }}>
                          Inter-State (IGST)
                        </span>
                      ) : (
                        <span style={{ marginLeft: '4px', background: '#ecfdf5', color: '#065f46', padding: '1px 5px', borderRadius: '4px', fontWeight: 600 }}>
                          Intra-State (CGST+SGST)
                        </span>
                      )}
                    </div>
                  )}
                </div>

                <div>
                  <div style={{ fontSize: '0.72rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 600 }}>Credit Status</div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem', marginTop: '0.15rem' }}>
                    <span style={{ fontSize: '0.82rem', color: '#475569' }}>Dues:</span>
                    <strong style={{ fontSize: '0.88rem', color: ((selectedCustomer.duesMinor || selectedCustomer.unpaidInvoicesMinor || 0) > 0) ? '#b45309' : '#059669' }}>
                      ₹{(((selectedCustomer.duesMinor || selectedCustomer.unpaidInvoicesMinor || 0)) / 100).toFixed(2)}
                    </strong>
                  </div>
                  <div style={{ fontSize: '0.76rem', color: '#64748b', marginTop: '0.15rem' }}>
                    Credit Limit: <strong>₹{((selectedCustomer.creditLimitMinor || 0) / 100).toFixed(2)}</strong>
                  </div>
                  {creditStatus && creditStatus.limitMinor > 0 && (
                    <div style={{ fontSize: '0.74rem', color: creditStatus.isExceeded ? '#dc2626' : '#16a34a', fontWeight: 600, marginTop: '0.2rem' }}>
                      Available Credit: ₹{(creditStatus.availableMinor / 100).toFixed(2)}
                    </div>
                  )}
                </div>

                <div style={{ gridColumn: '1 / -1', borderTop: '1px dashed #cbd5e1', paddingTop: '0.65rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontSize: '0.75rem', color: '#475569' }}>
                      <strong>Billing Address:</strong> {selectedCustomer.address || 'Address not configured'}
                    </div>
                  </div>
                  <div style={{ marginTop: '0.4rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#334155', minWidth: '100px' }}>
                      Shipping Address:
                    </label>
                    <input
                      type="text"
                      className="form-input"
                      value={shippingAddress}
                      onChange={(e) => setShippingAddress(e.target.value)}
                      placeholder="Delivery destination / Place of Supply"
                      style={{ fontSize: '0.8rem', padding: '0.35rem 0.6rem' }}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* STEP 2: PRODUCT SEARCH & CART TABLE */}
          <div
            style={{
              background: '#ffffff',
              borderRadius: '12px',
              border: '1px solid #e2e8f0',
              padding: '1.25rem',
              boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Package size={18} style={{ color: '#4f46e5' }} />
                <strong style={{ fontSize: '0.95rem', color: '#1e293b' }}>
                  Step 2: Add Bulk Products to Order ({cart.length} items)
                </strong>
              </div>
              <div style={{ fontSize: '0.8rem', color: '#64748b' }}>
                Auto-applies Wholesale Price &amp; checks Min Qty
              </div>
            </div>

            {/* Search Bar */}
            <div style={{ position: 'relative', marginBottom: '1rem' }}>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <div style={{ position: 'relative', flex: 1 }}>
                  <input
                    ref={searchInputRef}
                    type="text"
                    className="form-input"
                    placeholder="Search by Barcode, Item Name, or SKU (Press Enter to add)..."
                    value={productSearch}
                    onChange={(e) => {
                      setProductSearch(e.target.value);
                      setIsProductPickerOpen(true);
                    }}
                    onFocus={() => setIsProductPickerOpen(true)}
                    onKeyDown={handleSearchKeyDown}
                    style={{ paddingLeft: '2.4rem' }}
                  />
                  <span style={{ position: 'absolute', left: '0.8rem', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', display: 'flex', alignItems: 'center' }}>
                    <Search size={16} />
                  </span>
                </div>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setIsProductPickerOpen(!isProductPickerOpen)}
                  style={{ padding: '0.5rem 1rem', fontSize: '0.85rem' }}
                >
                  {isProductPickerOpen ? 'Close Catalog' : 'Browse Catalog'}
                </button>
              </div>

              {/* Product Picker Dropdown */}
              {isProductPickerOpen && (
                <div
                  style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    right: 0,
                    zIndex: 50,
                    background: '#ffffff',
                    border: '1px solid #cbd5e1',
                    borderRadius: '8px',
                    boxShadow: '0 10px 25px rgba(0,0,0,0.1)',
                    maxHeight: '320px',
                    overflowY: 'auto',
                    marginTop: '4px',
                  }}
                >
                  {filteredProducts.length === 0 ? (
                    <div style={{ padding: '1rem', textAlign: 'center', color: '#64748b', fontSize: '0.85rem' }}>
                      No matching products found.
                    </div>
                  ) : (
                    filteredProducts.map((it) => {
                      const wholesaleRupees = it.wholesalePriceMinor ? (it.wholesalePriceMinor / 100).toFixed(2) : null;
                      const retailRupees = (it.priceMinor / 100).toFixed(2);
                      const minWholesaleQty = it.minWholesaleQtyMilli ? it.minWholesaleQtyMilli / 1000 : null;

                      // Available stock in the currently selected branch
                      const stockUnits = branchStockMap[it.id] !== undefined ? branchStockMap[it.id] : 0;
                      const isZeroStock = stockUnits <= 0;
                      const formattedQty = stockUnits <= 0 ? 0 : (stockUnits % 1 === 0 ? stockUnits : Number(stockUnits.toFixed(2)));
                      const displayUnit = formatStockUnit(formattedQty, it.unit);

                      return (
                        <div
                          key={it.id}
                          onClick={() => handleAddItem(it)}
                          style={{
                            padding: '0.65rem 1rem',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            borderBottom: '1px solid #f1f5f9',
                            cursor: 'pointer',
                            transition: 'background 0.15s',
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.background = '#f8fafc')}
                          onMouseLeave={(e) => (e.currentTarget.style.background = '#ffffff')}
                        >
                          <div>
                            <div style={{ fontWeight: 600, fontSize: '0.88rem', color: '#1e293b' }}>{it.name}</div>
                            <div style={{ fontSize: '0.74rem', color: '#64748b' }}>
                              SKU: {it.sku || '—'} · HSN: {it.hsn || '—'} · Tax: {(it.taxRateBp || 500) / 100}% · Unit: {it.unit || 'Pcs'}
                            </div>
                          </div>

                          <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', whiteSpace: 'nowrap' }}>
                              <span style={{ fontSize: '0.9rem', fontWeight: 700, color: '#16a34a' }}>
                                ₹{wholesaleRupees || retailRupees}
                              </span>
                              <span style={{ color: '#94a3b8', fontWeight: 400, fontSize: '0.82rem', margin: '0 2px' }}>|</span>
                              <span
                                style={{
                                  fontSize: '0.8rem',
                                  fontWeight: isZeroStock ? 600 : 500,
                                  color: isZeroStock ? '#dc2626' : '#475569',
                                }}
                              >
                                Stock: {formattedQty} {displayUnit}
                              </span>
                            </div>
                            {minWholesaleQty && (
                              <div style={{ fontSize: '0.7rem', color: '#b45309', fontWeight: 600, marginTop: '2px' }}>
                                Min Qty: {minWholesaleQty} {formatStockUnit(minWholesaleQty, it.unit)}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>

            {/* Cart Table */}
            {cart.length === 0 ? (
              <div
                style={{
                  padding: '2.5rem 1rem',
                  textAlign: 'center',
                  background: '#f8fafc',
                  border: '1px dashed #cbd5e1',
                  borderRadius: '8px',
                  color: '#64748b',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '0.5rem', color: '#94a3b8' }}>
                  <ShoppingCart size={36} strokeWidth={1.5} />
                </div>
                <strong style={{ fontSize: '0.92rem', color: '#334155' }}>Wholesale Order Cart is Empty</strong>
                <p style={{ margin: '0.35rem 0 0', fontSize: '0.8rem' }}>
                  Search for products above or scan barcodes to begin assembling your bulk wholesale invoice.
                </p>
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84rem' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0', color: '#475569', textAlign: 'left' }}>
                      <th style={{ padding: '0.65rem', width: '35px' }}>#</th>
                      <th style={{ padding: '0.65rem' }}>Description</th>
                      <th style={{ padding: '0.65rem', width: '80px', textAlign: 'center' }}>HSN</th>
                      <th style={{ padding: '0.65rem', width: '65px', textAlign: 'center' }}>GST</th>
                      <th style={{ padding: '0.65rem', width: '90px', textAlign: 'center' }}>Quantity</th>
                      <th style={{ padding: '0.65rem', width: '105px', textAlign: 'right' }}>Wholesale ₹</th>
                      <th style={{ padding: '0.65rem', width: '80px', textAlign: 'right' }}>Disc ₹</th>
                      <th style={{ padding: '0.65rem', width: '105px', textAlign: 'right' }}>Amount ₹</th>
                      <th style={{ padding: '0.65rem', width: '40px', textAlign: 'center' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {cart.map((line, idx) => {
                      const minQty = line.item.minWholesaleQtyMilli ? line.item.minWholesaleQtyMilli / 1000 : null;
                      const isBelowMin = minQty && line.qty < minQty;
                      const lineCalc = calculated.lineCalculations[idx];

                      return (
                        <tr key={line.item.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '0.65rem', textAlign: 'center', color: '#64748b' }}>{idx + 1}</td>
                          <td style={{ padding: '0.65rem' }}>
                            <div style={{ fontWeight: 600, color: '#1e293b' }}>{line.item.name}</div>
                            <div style={{ fontSize: '0.72rem', color: '#64748b' }}>
                              SKU: {line.item.sku || '—'} · Unit: {line.unit}
                            </div>
                            {isBelowMin && (
                              <div style={{ fontSize: '0.68rem', color: '#dc2626', fontWeight: 600, marginTop: '2px', display: 'flex', alignItems: 'center', gap: '3px' }}>
                                <AlertTriangle size={12} /> Below min wholesale qty ({minQty} {line.unit})
                              </div>
                            )}
                          </td>
                          <td style={{ padding: '0.65rem', textAlign: 'center', color: '#475569' }}>
                            {line.hsn || '—'}
                          </td>
                          <td style={{ padding: '0.65rem', textAlign: 'center', color: '#475569' }}>
                            {!applyGst ? (
                              <span style={{ color: '#94a3b8' }}>0%</span>
                            ) : gstMode === 'bill' ? (
                              <span style={{ color: '#4f46e5', fontWeight: 600 }}>{(overallGstRateBp / 100)}%</span>
                            ) : (
                              <select
                                className="form-input"
                                value={line.gstRateBp}
                                onChange={(e) => {
                                  const bp = Number(e.target.value);
                                  setCart((prev) => {
                                    const copy = [...prev];
                                    copy[idx].gstRateBp = bp;
                                    return copy;
                                  });
                                }}
                                style={{ padding: '0.25rem 0.35rem', fontSize: '0.8rem', minWidth: '62px', textAlign: 'center' }}
                              >
                                {[0, 500, 1200, 1800, 2800].map((bp) => (
                                  <option key={bp} value={bp}>{bp / 100}%</option>
                                ))}
                                {![0, 500, 1200, 1800, 2800].includes(line.gstRateBp) && (
                                  <option value={line.gstRateBp}>{line.gstRateBp / 100}%</option>
                                )}
                              </select>
                            )}
                          </td>
                          <td style={{ padding: '0.65rem', textAlign: 'center' }}>
                            <input
                              type="number"
                              min="1"
                              step="any"
                              className="form-input"
                              value={line.qty}
                              onChange={(e) => {
                                const val = Math.max(1, parseFloat(e.target.value) || 1);
                                setCart((prev) => {
                                  const copy = [...prev];
                                  copy[idx].qty = val;
                                  return copy;
                                });
                              }}
                              style={{ width: '75px', textAlign: 'center', padding: '0.35rem 0.4rem', fontSize: '0.85rem' }}
                            />
                          </td>
                          <td style={{ padding: '0.65rem', textAlign: 'right' }}>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              className="form-input"
                              value={line.rateRupees}
                              onChange={(e) => {
                                const val = Math.max(0, parseFloat(e.target.value) || 0);
                                setCart((prev) => {
                                  const copy = [...prev];
                                  copy[idx].rateRupees = val;
                                  return copy;
                                });
                              }}
                              style={{ width: '90px', textAlign: 'right', padding: '0.35rem 0.4rem', fontSize: '0.85rem' }}
                            />
                          </td>
                          <td style={{ padding: '0.65rem', textAlign: 'right' }}>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              className="form-input"
                              value={line.discountRupees}
                              onChange={(e) => {
                                const val = Math.max(0, parseFloat(e.target.value) || 0);
                                setCart((prev) => {
                                  const copy = [...prev];
                                  copy[idx].discountRupees = val;
                                  return copy;
                                });
                              }}
                              style={{ width: '70px', textAlign: 'right', padding: '0.35rem 0.4rem', fontSize: '0.85rem' }}
                            />
                          </td>
                          <td style={{ padding: '0.65rem', textAlign: 'right', fontWeight: 600, color: '#1e293b' }}>
                            ₹{lineCalc ? lineCalc.lineTotalRupees.toFixed(2) : '0.00'}
                          </td>
                          <td style={{ padding: '0.65rem', textAlign: 'center' }}>
                            <button
                              type="button"
                              onClick={() => {
                                setCart((prev) => prev.filter((_, i) => i !== idx));
                              }}
                              style={{
                                background: 'transparent',
                                border: 'none',
                                color: '#94a3b8',
                                cursor: 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                padding: '2px',
                              }}
                              title="Remove item"
                            >
                              <Trash2 size={15} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Calculations & Payment & Checkout */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            {/* Bill Summary Card */}
            <div
              style={{
                background: '#ffffff',
                borderRadius: '12px',
                border: '1px solid #e2e8f0',
                padding: '1.25rem',
                boxShadow: '0 2px 6px rgba(0,0,0,0.03)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', borderBottom: '1px solid #f1f5f9', paddingBottom: '0.65rem' }}>
                <strong style={{ fontSize: '0.98rem', color: '#1e293b' }}>Tax Invoice Summary</strong>
                <span
                  className="ws-series-badge"
                  style={{
                    fontSize: '0.8rem',
                    background: isSuperAdmin ? '#F3EDF3' : '#ede9fe',
                    color: isSuperAdmin ? '#49364A' : '#6d4aff',
                    border: isSuperAdmin ? '1px solid #D8CBD8' : 'none',
                    padding: '2px 8px',
                    borderRadius: '12px',
                    fontWeight: 600,
                  }}
                >
                  {wholesaleProfile.invoicePrefix || 'WH'} Series
                </span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', fontSize: '0.86rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b' }}>
                  <span>Total Items / Quantity</span>
                  <span style={{ fontWeight: 600, color: '#1e293b' }}>
                    {cart.length} lines · {calculated.totalQty} units
                  </span>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b' }}>
                  <span>Subtotal (Gross)</span>
                  <span style={{ fontWeight: 600, color: '#1e293b' }}>₹{calculated.subtotalRupees.toFixed(2)}</span>
                </div>

                {calculated.lineDiscountsRupees > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: '#16a34a' }}>
                    <span>Item Discounts</span>
                    <span style={{ fontWeight: 600 }}>-₹{calculated.lineDiscountsRupees.toFixed(2)}</span>
                  </div>
                )}

                {/* Overall Discount Input */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#64748b' }}>
                  <span>Bill Discount (₹)</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    className="form-input"
                    value={billDiscountRupees || ''}
                    onChange={(e) => setBillDiscountRupees(Math.max(0, parseFloat(e.target.value) || 0))}
                    placeholder="0.00"
                    style={{ width: '90px', textAlign: 'right', padding: '0.25rem 0.4rem', fontSize: '0.82rem' }}
                  />
                </div>

                <div style={{ borderTop: '1px dashed #cbd5e1', margin: '0.25rem 0' }} />

                {/* GST Toggle & Mode (Per-Product or Overall Bill) */}
                <div
                  style={{
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    borderRadius: '10px',
                    padding: '0.6rem 0.7rem',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.5rem',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontWeight: 700, color: '#1e293b', fontSize: '0.84rem' }}>
                      Apply GST
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={applyGst}
                      onClick={() => setApplyGst((prev) => !prev)}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.4rem',
                        padding: '0.2rem 0.55rem',
                        borderRadius: '999px',
                        border: applyGst ? '1px solid #16a34a' : '1px solid #cbd5e1',
                        background: applyGst ? '#dcfce7' : '#ffffff',
                        color: applyGst ? '#166534' : '#64748b',
                        fontWeight: 700,
                        fontSize: '0.76rem',
                        cursor: 'pointer',
                      }}
                    >
                      <span
                        style={{
                          width: '8px',
                          height: '8px',
                          borderRadius: '50%',
                          background: applyGst ? '#16a34a' : '#94a3b8',
                        }}
                      />
                      {applyGst ? 'ON' : 'OFF'}
                    </button>
                  </div>

                  {applyGst && (
                    <>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.35rem' }}>
                        <button
                          type="button"
                          onClick={() => setGstMode('product')}
                          style={{
                            padding: '0.32rem 0.45rem',
                            borderRadius: '7px',
                            fontSize: '0.76rem',
                            fontWeight: 700,
                            cursor: 'pointer',
                            border: gstMode === 'product' ? '1.5px solid #4f46e5' : '1px solid #cbd5e1',
                            background: gstMode === 'product' ? '#eef2ff' : '#ffffff',
                            color: gstMode === 'product' ? '#4338ca' : '#475569',
                          }}
                        >
                          Per Product
                        </button>
                        <button
                          type="button"
                          onClick={() => setGstMode('bill')}
                          style={{
                            padding: '0.32rem 0.45rem',
                            borderRadius: '7px',
                            fontSize: '0.76rem',
                            fontWeight: 700,
                            cursor: 'pointer',
                            border: gstMode === 'bill' ? '1.5px solid #4f46e5' : '1px solid #cbd5e1',
                            background: gstMode === 'bill' ? '#eef2ff' : '#ffffff',
                            color: gstMode === 'bill' ? '#4338ca' : '#475569',
                          }}
                        >
                          Overall Bill
                        </button>
                      </div>

                      {gstMode === 'bill' && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', flexWrap: 'wrap' }}>
                          {[500, 1200, 1800, 2800].map((bp) => {
                            const active = overallGstRateBp === bp;
                            return (
                              <button
                                key={bp}
                                type="button"
                                onClick={() => setOverallGstRateBp(bp)}
                                style={{
                                  padding: '0.2rem 0.48rem',
                                  borderRadius: '6px',
                                  fontSize: '0.74rem',
                                  fontWeight: 700,
                                  cursor: 'pointer',
                                  border: active ? '1.5px solid #4f46e5' : '1px solid #cbd5e1',
                                  background: active ? '#eef2ff' : '#ffffff',
                                  color: active ? '#4338ca' : '#334155',
                                }}
                              >
                                {bp / 100}%
                              </button>
                            );
                          })}
                          <input
                            type="number"
                            min="0"
                            max="100"
                            step="0.5"
                            className="form-input"
                            value={overallGstRateBp / 100}
                            onChange={(e) => {
                              const pct = Math.max(0, Math.min(100, parseFloat(e.target.value) || 0));
                              setOverallGstRateBp(Math.round(pct * 100));
                            }}
                            style={{ width: '56px', textAlign: 'right', padding: '0.18rem 0.35rem', fontSize: '0.76rem', marginLeft: 'auto' }}
                            title="Custom Overall GST %"
                          />
                          <span style={{ fontSize: '0.74rem', color: '#64748b', fontWeight: 600 }}>%</span>
                        </div>
                      )}
                    </>
                  )}
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b' }}>
                  <span>Taxable Amount</span>
                  <span style={{ fontWeight: 600, color: '#1e293b' }}>₹{calculated.netTaxableRupees.toFixed(2)}</span>
                </div>

                {!applyGst ? (
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8', fontSize: '0.8rem' }}>
                    <span>GST</span>
                    <span>Not Applied (0%)</span>
                  </div>
                ) : isInterstate ? (
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b' }}>
                    <span>Integrated GST (IGST)</span>
                    <span style={{ fontWeight: 600, color: '#1e293b' }}>₹{calculated.igstRupees.toFixed(2)}</span>
                  </div>
                ) : (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b' }}>
                      <span>Central GST (CGST)</span>
                      <span style={{ fontWeight: 600, color: '#1e293b' }}>₹{calculated.cgstRupees.toFixed(2)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b' }}>
                      <span>State GST (SGST)</span>
                      <span style={{ fontWeight: 600, color: '#1e293b' }}>₹{calculated.sgstRupees.toFixed(2)}</span>
                    </div>
                  </>
                )}

                {calculated.roundOffDiffRupees !== 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b' }}>
                    <span>Round Off</span>
                    <span style={{ fontWeight: 600, color: calculated.roundOffDiffRupees > 0 ? '#16a34a' : '#d97706' }}>
                      {calculated.roundOffDiffRupees > 0 ? `+₹${calculated.roundOffDiffRupees.toFixed(2)}` : `-₹${Math.abs(calculated.roundOffDiffRupees).toFixed(2)}`}
                    </span>
                  </div>
                )}

                <div
                  style={{
                    borderTop: '2px solid #1e293b',
                    paddingTop: '0.65rem',
                    marginTop: '0.35rem',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'baseline',
                  }}
                >
                  <strong style={{ fontSize: '1.05rem', color: '#1e293b' }}>Grand Total (RS.)</strong>
                  <strong style={{ fontSize: '1.35rem', color: '#1e1b4b', letterSpacing: '-0.02em' }}>
                    ₹{calculated.roundedTotalRupees.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </strong>
                </div>

                {/* Amount in words */}
                <div
                  style={{
                    background: '#f8fafc',
                    padding: '0.65rem',
                    borderRadius: '6px',
                    fontSize: '0.76rem',
                    color: '#475569',
                    fontStyle: 'italic',
                    lineHeight: 1.4,
                    border: '1px solid #e2e8f0',
                  }}
                >
                  <strong>Rs. {moneyInWords(calculated.totalPaise)} Only</strong>
                </div>
              </div>
            </div>

            {/* STEP 3: PAYMENT TERMS & SETTLEMENT */}
            <div
              style={{
                background: '#ffffff',
                borderRadius: '12px',
                border: '1px solid #e2e8f0',
                padding: '1.25rem',
                boxShadow: '0 2px 6px rgba(0,0,0,0.03)',
              }}
            >
              <strong style={{ fontSize: '0.95rem', color: '#1e293b', display: 'block', marginBottom: '0.75rem' }}>
                Step 3: Payment Terms &amp; Settlement
              </strong>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.5rem', marginBottom: '0.85rem' }}>
                {[
                  { id: 'cash', label: 'Cash', icon: Banknote },
                  { id: 'upi', label: 'UPI / QR', icon: QrCode },
                  { id: 'cheque', label: 'Cheque / DD', icon: FileText },
                  { id: 'credit', label: 'Credit (Due)', icon: Clock },
                ].map((p) => {
                  const IconComponent = p.icon;
                  const active = paymentMode === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      className={`ws-payment-mode-btn ${active ? 'active' : ''}`}
                      onClick={() => setPaymentMode(p.id as any)}
                      style={{
                        padding: '0.5rem',
                        borderRadius: '8px',
                        border: active
                          ? (isSuperAdmin ? '2px solid #49364A' : '2px solid #6d4aff')
                          : '1px solid #cbd5e1',
                        background: active
                          ? (isSuperAdmin ? '#F3EDF3' : '#f5f3ff')
                          : '#ffffff',
                        color: active
                          ? (isSuperAdmin ? '#49364A' : '#6d4aff')
                          : '#334155',
                        fontWeight: 600,
                        fontSize: '0.78rem',
                        cursor: 'pointer',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '0.25rem',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <IconComponent size={18} strokeWidth={2} />
                      <span>{p.label}</span>
                    </button>
                  );
                })}
              </div>

              {/* Paid Amount (Supports Partial Payment) */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                <div>
                  <label className="form-label" style={{ fontWeight: 600, fontSize: '0.8rem', color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                    Amount Paid Now (₹) {paymentMode === 'credit' ? '(0 for full credit)' : '(Enter amount for partial settlement)'}
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    className="form-input"
                    value={paidAmountRupees}
                    onChange={(e) => setPaidAmountRupees(e.target.value)}
                    placeholder={paymentMode === 'credit' ? '0.00' : String(calculated.roundedTotalRupees)}
                    disabled={paymentMode === 'credit'}
                    style={{ fontWeight: 600, fontSize: '0.95rem' }}
                  />
                </div>

                {/* Reference / UTR Number */}
                <div>
                  <label className="form-label" style={{ fontWeight: 600, fontSize: '0.8rem', color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                    Payment Reference / UTR / Cheque No
                  </label>
                  <input
                    type="text"
                    className="form-input"
                    value={paymentReference}
                    onChange={(e) => setPaymentReference(e.target.value)}
                    placeholder="e.g. UTR / IMPS Ref / Cheque No"
                    style={{ fontSize: '0.82rem' }}
                  />
                </div>

                {/* Balance on Credit Indicator */}
                {balanceOnCredit > 0 && (
                  <div
                    style={{
                      background: '#fffbeb',
                      border: '1px solid #fde68a',
                      padding: '0.65rem 0.85rem',
                      borderRadius: '8px',
                      fontSize: '0.8rem',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <span style={{ color: '#92400e', fontWeight: 600 }}>Balance on Account:</span>
                    <strong style={{ color: '#b45309', fontSize: '0.92rem' }}>₹{balanceOnCredit.toFixed(2)}</strong>
                  </div>
                )}

                {/* Credit Limit Exceeded Warning */}
                {creditStatus?.isExceeded && (
                  <div
                    style={{
                      background: '#fef2f2',
                      border: '1px solid #fecaca',
                      padding: '0.65rem 0.85rem',
                      borderRadius: '8px',
                      fontSize: '0.78rem',
                      color: '#991b1b',
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '0.4rem',
                    }}
                  >
                    <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: '1px' }} />
                    <div>
                      <strong>Credit Limit Exceeded:</strong> Customer available credit is ₹
                      {(creditStatus.availableMinor / 100).toFixed(2)}, but requested credit balance is ₹
                      {balanceOnCredit.toFixed(2)}. Please increase paid amount to continue.
                    </div>
                  </div>
                )}
              </div>

              {/* GENERATE INVOICE ACTION */}
              <div style={{ marginTop: '1.25rem' }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleGenerateInvoice}
                  disabled={isSubmitting || cart.length === 0 || !selectedCustomer || creditStatus?.isExceeded}
                  style={{
                    width: '100%',
                    padding: '0.9rem',
                    fontSize: '1rem',
                    fontWeight: 700,
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    gap: '0.5rem',
                    background: 'linear-gradient(135deg, #4f46e5 0%, #3730a3 100%)',
                    boxShadow: '0 4px 12px rgba(79, 70, 229, 0.25)',
                  }}
                >
                  {isSubmitting ? (
                    <>
                      <span className="spinner-small" /> Generating A4 Tax Invoice...
                    </>
                  ) : (
                    <>
                      <FileCheck size={18} /> Generate Wholesale Invoice ({wholesaleProfile.invoicePrefix || 'WH'})
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* QUICK ADD WHOLESALE CUSTOMER MODAL */}
        {showAddCustomerModal && (
          <div className="modal-backdrop" style={{ zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div
              style={{
                background: '#ffffff',
                borderRadius: '14px',
                padding: '1.75rem',
                maxWidth: '560px',
                width: '92%',
                boxShadow: '0 20px 40px rgba(0,0,0,0.2)',
                maxHeight: '90vh',
                overflowY: 'auto',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
                <h3 style={{ margin: 0, fontSize: '1.15rem', color: '#1e293b', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Users size={18} style={{ color: '#4f46e5' }} /> Add Wholesale B2B Customer
                </h3>
                <button
                  type="button"
                  onClick={() => setShowAddCustomerModal(false)}
                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#64748b', display: 'flex', alignItems: 'center' }}
                >
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleSaveNewCustomer} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div>
                  <label className="form-label" style={{ fontWeight: 600, fontSize: '0.82rem', color: '#334155', display: 'block', marginBottom: '0.25rem' }}>
                    Business / Company Name <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <input
                    type="text"
                    className="form-input"
                    required
                    value={newCustomerName}
                    onChange={(e) => setNewCustomerName(e.target.value)}
                    placeholder="e.g. RIKHABDAS GULABCHAND FABRICS PVT LTD"
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                  <div>
                    <label className="form-label" style={{ fontWeight: 600, fontSize: '0.82rem', color: '#334155', display: 'block', marginBottom: '0.25rem' }}>
                      Contact Person
                    </label>
                    <input
                      type="text"
                      className="form-input"
                      value={newCustomerContact}
                      onChange={(e) => setNewCustomerContact(e.target.value)}
                      placeholder="e.g. Mr. Rikhabdas"
                    />
                  </div>

                  <div>
                    <label className="form-label" style={{ fontWeight: 600, fontSize: '0.82rem', color: '#334155', display: 'block', marginBottom: '0.25rem' }}>
                      Mobile Number <span style={{ color: '#ef4444' }}>*</span>
                    </label>
                    <input
                      type="tel"
                      className="form-input"
                      required
                      value={newCustomerPhone}
                      onChange={(e) => setNewCustomerPhone(e.target.value)}
                      placeholder="e.g. 9374708348"
                    />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '0.75rem' }}>
                  <div>
                    <label className="form-label" style={{ fontWeight: 600, fontSize: '0.82rem', color: '#334155', display: 'block', marginBottom: '0.25rem' }}>
                      Buyer GSTIN
                    </label>
                    <input
                      type="text"
                      className="form-input"
                      maxLength={15}
                      value={newCustomerGstin}
                      onChange={(e) => setNewCustomerGstin(e.target.value.toUpperCase())}
                      placeholder="e.g. 24AAACR9377A1ZH"
                    />
                  </div>

                  <div>
                    <label className="form-label" style={{ fontWeight: 600, fontSize: '0.82rem', color: '#334155', display: 'block', marginBottom: '0.25rem' }}>
                      Credit Limit (₹)
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      className="form-input"
                      value={newCustomerCreditLimit}
                      onChange={(e) => setNewCustomerCreditLimit(e.target.value)}
                      placeholder="e.g. 50000"
                    />
                  </div>
                </div>

                <div>
                  <label className="form-label" style={{ fontWeight: 600, fontSize: '0.82rem', color: '#334155', display: 'block', marginBottom: '0.25rem' }}>
                    Billing Address
                  </label>
                  <textarea
                    className="form-input"
                    rows={2}
                    value={newCustomerBillingAddress}
                    onChange={(e) => setNewCustomerBillingAddress(e.target.value)}
                    placeholder="e.g. 27 B, Plot No. 45-A, Central Road No. 3, Rg House, Opp. Jd Transport, SURAT"
                  />
                </div>

                <div>
                  <label className="form-label" style={{ fontWeight: 600, fontSize: '0.82rem', color: '#334155', display: 'block', marginBottom: '0.25rem' }}>
                    Shipping Address (if different from billing)
                  </label>
                  <textarea
                    className="form-input"
                    rows={2}
                    value={newCustomerShippingAddress}
                    onChange={(e) => setNewCustomerShippingAddress(e.target.value)}
                    placeholder="Delivery destination"
                  />
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setShowAddCustomerModal(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={isSavingCustomer}
                  >
                    {isSavingCustomer ? 'Saving Customer...' : 'Create Customer'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* POST-GENERATION INVOICE PREVIEW MODAL */}
        {showInvoiceModal && generatedInvoice && (
          <div className="modal-backdrop" style={{ zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div
              style={{
                background: '#ffffff',
                borderRadius: '14px',
                padding: '1.5rem',
                maxWidth: '920px',
                width: '95%',
                maxHeight: '94vh',
                display: 'flex',
                flexDirection: 'column',
                boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', borderBottom: '1px solid #f1f5f9', paddingBottom: '0.75rem' }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.2rem', color: '#1e293b', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <CheckCircle2 size={20} style={{ color: '#16a34a' }} /> Wholesale Tax Invoice: {generatedInvoice.number}
                  </h3>
                  <div style={{ fontSize: '0.82rem', color: '#16a34a', fontWeight: 600, marginTop: '2px' }}>
                    Total: ₹{(generatedInvoice.totalMinor / 100).toFixed(2)} · Traditional A4 Tax Invoice Format
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    type="button"
                    onClick={() => {
                      window.open(`/api/invoices/${generatedInvoice.id}/print?paper=wholesale_a4&autoprint=true`, '_blank');
                    }}
                    className="btn btn-primary"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.4rem',
                      padding: '0.5rem 1rem',
                      fontSize: '0.88rem',
                    }}
                  >
                    <Printer size={16} /> Print A4 Invoice
                  </button>

                  <button
                    type="button"
                    disabled={isDownloadingPdf}
                    onClick={() => handleDownloadInvoice(generatedInvoice.id, generatedInvoice.number)}
                    className="btn btn-secondary"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.4rem',
                      padding: '0.5rem 1rem',
                      fontSize: '0.88rem',
                      opacity: isDownloadingPdf ? 0.7 : 1,
                      cursor: isDownloadingPdf ? 'not-allowed' : 'pointer',
                    }}
                    title="Download Wholesale A4 Tax Invoice PDF"
                  >
                    <Download size={16} /> {isDownloadingPdf ? 'Downloading PDF...' : 'Download Invoice'}
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowInvoiceModal(false)}
                    style={{
                      background: '#f1f5f9',
                      border: '1px solid #cbd5e1',
                      borderRadius: '8px',
                      padding: '0.5rem 0.85rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.35rem',
                    }}
                  >
                    <X size={15} /> Close
                  </button>
                </div>
              </div>

              {/* Live A4 Print Frame */}
              <div style={{ flex: 1, minHeight: '520px', background: '#f8fafc', borderRadius: '8px', overflow: 'hidden', border: '1px solid #e2e8f0' }}>
                <iframe
                  src={`/api/invoices/${generatedInvoice.id}/print?paper=wholesale_a4`}
                  title="Wholesale Tax Invoice"
                  style={{ width: '100%', height: '100%', minHeight: '520px', border: 'none' }}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
