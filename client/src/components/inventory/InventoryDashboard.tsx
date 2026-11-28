import { handleProductImageError } from '../../imageUtils';
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';

import type { Item, Party, Role, InventoryDashboardStats, InventoryInsights, Category } from '../../api.ts';
import {
  formatIndianCurrency,
  formatStockQuantity,
  determineStockStatus,
  calculateInventorySummary,
  parseNumberSafe,
} from '../../../../shared/inventorySummary.ts';
import {
  fetchInventoryDashboard,
  fetchInventoryItems,
  fetchInventoryInsights,
  can,
  formatStockDuration,
} from '../../api.ts';
import { StatCard } from '../common/BentoUI.tsx';
import { AnimatedCounter } from '../common/AnimatedCounter.tsx';
import { StockLedgerView } from './StockLedgerView.tsx';
import { StockAdjustmentModal } from './StockAdjustmentModal.tsx';
import { PhysicalStockCountView } from './PhysicalStockCountView.tsx';
import { ReorderConfigModal } from './ReorderConfigModal.tsx';
import { Skeleton } from '../common/Skeleton.tsx';
import { TableSkeleton, type TableSkeletonColumn } from '../common/TableSkeleton.tsx';
import { CardSkeleton } from '../common/CardSkeleton.tsx';
import { ChartSkeleton } from '../common/ChartSkeleton.tsx';
import { useDelayedLoading } from '../../hooks/useDelayedLoading.ts';
import {
  TagIcon,
  SlidersIcon,
  PackageIcon,
  CheckCircleIcon,
  AlertTriangleIcon,
  AlertOctagonIcon,
  RupeeIcon,
  LayersIcon,
  LockIcon,
  FileTextIcon,
  ClipboardCheckIcon,
  BellRingIcon,
  ZapIcon,
  SearchIcon,
  XIcon,
  Edit3Icon,
  InfoIcon,
  PhoneIcon,
  Building2Icon,
  DownloadIcon,
  ClockIcon,
  BarChart3Icon,
  LightbulbIcon,
  ArrowRightIcon,
  ImageIcon,
  RefreshCwIcon,
} from './InventoryIcons.tsx';

interface InventoryDashboardProps {
  selectedBranch?: string;
  shop?: any;
  branches?: import('../../api.ts').Branch[];
  items: Item[];
  categories: string[];
  categoriesList?: Category[];
  suppliers: Party[];
  userRole?: Role;
  businessType?: string;
  allowNegativeStock?: boolean;
  initialTab?: 'overview' | 'ledger' | 'counts' | 'replenish' | 'insights';
  onNavigateToPurchases?: (supplierId?: string, itemId?: string) => void;
  onNavigateToCategories?: () => void;
  onNavigateToProductAnalysis?: () => void;
  onOpenSupplierInvoiceConverter?: () => void;
  showToast: (msg: string) => void;
  onReloadItems: () => void;
}

export const InventoryDashboard: React.FC<InventoryDashboardProps> = ({
  selectedBranch,
  shop,
  branches = [],
  items,
  categories,
  categoriesList = [],
  suppliers,
  userRole,
  businessType = 'retail',
  allowNegativeStock = false,
  initialTab = 'overview',
  onNavigateToPurchases,
  onNavigateToCategories,
  onNavigateToProductAnalysis,
  onOpenSupplierInvoiceConverter,
  showToast,
  onReloadItems,
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'overview' | 'ledger' | 'counts' | 'replenish' | 'insights'>(initialTab);

  const isSuperAdmin = userRole === 'owner' || String(userRole).toUpperCase() === 'SUPER_ADMIN';
  const isOwnerOrManager = can(userRole, 'stock.adjust');
  const isAuthorizedForCost = ['owner', 'manager', 'accountant'].includes(userRole || '') || isSuperAdmin;

  const itemsRef = useRef<Item[]>(items || []);
  useEffect(() => {
    itemsRef.current = items || [];
  }, [items]);

  // Helper to scope items to active branch
  const getBranchScopedItems = useCallback((rawItems: Item[]) => {
    if (!rawItems || rawItems.length === 0) return [];
    if (!selectedBranch || selectedBranch.toLowerCase() === 'all') {
      return rawItems.filter((it) => it.active !== false);
    }
    const matchBr = branches.find(
      (b) => b.id === selectedBranch || (b.code && b.code.toUpperCase() === selectedBranch.toUpperCase())
    );
    const targetId = matchBr?.id || selectedBranch;
    const targetCode = matchBr?.code?.toUpperCase();

    // Canonical alias check for main store (code: 'MAIN', id: 'br_main_store')
    const isMainBranchTarget =
      selectedBranch.toUpperCase() === 'MAIN' ||
      selectedBranch === 'br_main_store' ||
      targetCode === 'MAIN' ||
      targetId === 'br_main_store';

    return rawItems.filter((it) => {
      if (it.active === false) return false;
      // Global items without branch assignment are visible to all branches
      if (!it.branchId) return true;
      if (targetId && it.branchId === targetId) return true;
      if (targetCode && (it as any).branchCode && (it as any).branchCode.toUpperCase() === targetCode) return true;
      if (targetCode && it.branchId.toUpperCase() === targetCode) return true;
      if (it.branchId === selectedBranch) return true;
      if (isMainBranchTarget && (it.branchId === 'br_main_store' || it.branchId.toUpperCase() === 'MAIN')) return true;
      return false;
    });
  }, [branches, selectedBranch]);

  // Filters and pagination state
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [sortField, setSortField] = useState<string>('name_asc');
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(15);
  const [mobileTableView, setMobileTableView] = useState<'cards' | 'table'>('cards');

  // Helper to filter and sort items locally as immediate fallback
  const getLocalFilteredItems = useCallback((rawItems: Item[]) => {
    let result = getBranchScopedItems(rawItems);

    if (categoryFilter && categoryFilter !== 'ALL') {
      result = result.filter((it) => it.category === categoryFilter);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter(
        (it) =>
          it.name?.toLowerCase().includes(q) ||
          it.sku?.toLowerCase().includes(q) ||
          it.barcode?.toLowerCase().includes(q)
      );
    }

    if (statusFilter && statusFilter !== 'all') {
      result = result.filter((it) => {
        const stockMilli = it.currentStockMilli ?? ((it as any).stock ? Number((it as any).stock) * 1000 : 0);
        const reorderMilli = it.reorderMilli ?? 0;
        if (statusFilter === 'in_stock') {
          return stockMilli > 0 && (reorderMilli === 0 || stockMilli > reorderMilli);
        } else if (statusFilter === 'low_stock') {
          return stockMilli > 0 && reorderMilli > 0 && stockMilli <= reorderMilli;
        } else if (statusFilter === 'out_of_stock') {
          return stockMilli <= 0;
        } else if (statusFilter === 'zero_stock') {
          return stockMilli === 0;
        } else if (statusFilter === 'negative_stock') {
          return stockMilli < 0;
        } else if (statusFilter === 'unconfigured') {
          return reorderMilli === 0;
        }
        return true;
      });
    }

    result.sort((a, b) => {
      if (sortField === 'name_desc') return (b.name || '').localeCompare(a.name || '');
      if (sortField === 'stock_asc') return (a.currentStockMilli ?? 0) - (b.currentStockMilli ?? 0);
      if (sortField === 'stock_desc') return (b.currentStockMilli ?? 0) - (a.currentStockMilli ?? 0);
      return (a.name || '').localeCompare(b.name || '');
    });

    return result;
  }, [getBranchScopedItems, categoryFilter, searchQuery, statusFilter, sortField]);

  // Compute immediate initial stats if items are already loaded
  const initialScoped = useMemo(() => {
    return getBranchScopedItems(items || []);
  }, [getBranchScopedItems, items]);

  const [stats, setStats] = useState<InventoryDashboardStats | null>(() => {
    if (initialScoped.length > 0) {
      const summary = calculateInventorySummary(initialScoped);
      return {
        totalActiveProducts: summary.totalActive,
        inStockCount: summary.inStockCount,
        lowStockCount: summary.lowStockCount,
        outOfStockCount: summary.outOfStockCount,
        zeroStockCount: summary.zeroStockCount,
        negativeStockCount: summary.negativeStockCount,
        unconfiguredCount: summary.unconfiguredCount,
        distinctCategoryCount: summary.distinctCategoryCount,
        totalStockValueMinor: isAuthorizedForCost ? summary.totalStockValueMinor : null,
        categoryBreakdown: [],
        recentMovements: [],
        replenishmentNeeded: [],
      };
    }
    return null;
  });
  const [statsLoading, setStatsLoading] = useState<boolean>(true);

  const [insights, setInsights] = useState<InventoryInsights | null>(null);
  const [insightsLoading, setInsightsLoading] = useState<boolean>(false);

  // Items table state
  const [tableItems, setTableItems] = useState<Item[]>([]);
  const [totalItems, setTotalItems] = useState<number>(0);
  const [itemsLoading, setItemsLoading] = useState<boolean>(true);

  // Tab-specific caching & cancellation
  const tabCacheRef = useRef<{
    overview: boolean;
    ledger: boolean;
    counts: boolean;
    replenish: boolean;
    insights: boolean;
  }>({
    overview: false,
    ledger: false,
    counts: false,
    replenish: false,
    insights: false,
  });

  const tabAbortControllerRef = useRef<AbortController | null>(null);

  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [replenishError, setReplenishError] = useState<string | null>(null);
  const [insightsError, setInsightsError] = useState<string | null>(null);

  // Debounce search query by 300ms to preserve focus and reduce network pressure
  const [debouncedSearch, setDebouncedSearch] = useState<string>('');
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 300);
    return () => clearTimeout(handler);
  }, [searchQuery]);

  // Delayed loading states (300ms wait, 400ms minDuration, 8000ms slow threshold)
  const {
    showSkeleton: showOverviewDelayed,
    isSlow: isOverviewSlow,
    cancelSlow: cancelOverviewSlow,
  } = useDelayedLoading(itemsLoading && !tabCacheRef.current.overview, 300, 400, 8000);

  // Show skeleton immediately on first load/tab switch before cached; otherwise delayed
  const showOverviewSkeleton = (itemsLoading && !tabCacheRef.current.overview) || showOverviewDelayed;
  const isOverviewRefreshing = itemsLoading && tabCacheRef.current.overview;

  const {
    showSkeleton: showReplenishDelayed,
    isSlow: isReplenishSlow,
    cancelSlow: cancelReplenishSlow,
  } = useDelayedLoading(statsLoading && !tabCacheRef.current.replenish, 300, 400, 8000);

  const showReplenishSkeleton = (statsLoading && !tabCacheRef.current.replenish) || showReplenishDelayed;
  const isReplenishRefreshing = statsLoading && tabCacheRef.current.replenish;

  const {
    showSkeleton: showInsightsDelayed,
    isSlow: isInsightsSlow,
    cancelSlow: cancelInsightsSlow,
  } = useDelayedLoading(insightsLoading && !tabCacheRef.current.insights, 300, 400, 8000);

  const showInsightsSkeleton = (insightsLoading && !tabCacheRef.current.insights) || showInsightsDelayed;
  const isInsightsRefreshing = insightsLoading && tabCacheRef.current.insights;

  const handleSwitchTab = (tab: 'overview' | 'ledger' | 'counts' | 'replenish' | 'insights') => {
    if (tabAbortControllerRef.current) {
      tabAbortControllerRef.current.abort();
    }
    tabAbortControllerRef.current = new AbortController();
    setActiveSubTab(tab);

    if (tab === 'overview') {
      loadTableItems();
    } else if (tab === 'replenish') {
      loadDashboardStats();
    } else if (tab === 'insights') {
      loadInsights();
    }
  };

  const overviewSkeletonColumns: TableSkeletonColumn[] = [
    {
      header: 'Image',
      width: '64px',
      minWidth: '64px',
      align: 'center',
      renderSkeleton: () => (
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <Skeleton width={48} height={48} radius={8} />
        </div>
      ),
    },
    {
      header: 'Product & Identifiers',
      minWidth: '170px',
      renderSkeleton: () => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
          <Skeleton width={180} height={14} radius={4} />
          <Skeleton width={220} height={11} radius={4} />
        </div>
      ),
    },
    {
      header: 'Category',
      minWidth: '140px',
      renderSkeleton: () => <Skeleton width={130} height={28} radius={9999} />,
    },
    {
      header: 'Current Stock',
      minWidth: '100px',
      align: 'right',
      renderSkeleton: () => (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Skeleton width={60} height={12} radius={4} />
        </div>
      ),
    },
    {
      header: 'Status',
      minWidth: '110px',
      renderSkeleton: () => <Skeleton width={90} height={28} radius={9999} />,
    },
    {
      header: 'Reorder Level',
      minWidth: '95px',
      align: 'right',
      renderSkeleton: () => (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Skeleton width={60} height={12} radius={4} />
        </div>
      ),
    },
    ...(isAuthorizedForCost
      ? [
        {
          header: 'Unit Cost',
          minWidth: '85px',
          align: 'right' as const,
          renderSkeleton: () => (
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Skeleton width={75} height={12} radius={4} />
            </div>
          ),
        },
        {
          header: 'Total Value',
          minWidth: '95px',
          align: 'right' as const,
          renderSkeleton: () => (
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Skeleton width={85} height={12} radius={4} />
            </div>
          ),
        },
      ]
      : []),
    {
      header: 'Supplier',
      minWidth: '160px',
      renderSkeleton: () => <Skeleton width={100} height={12} radius={4} />,
    },
    {
      header: 'Actions',
      minWidth: '120px',
      align: 'right',
      renderSkeleton: () => (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Skeleton width={80} height={30} radius={6} />
        </div>
      ),
    },
  ];

  // Fallback function to populate table from local catalog items if API fails or times out
  const fallbackToLocalItems = useCallback(() => {
    const local = getLocalFilteredItems(itemsRef.current || []);
    const paged = local.slice((page - 1) * pageSize, page * pageSize);
    setTableItems(paged);
    setTotalItems(local.length);
  }, [getLocalFilteredItems, page, pageSize]);

  // Modals state
  const [adjustmentTargetItem, setAdjustmentTargetItem] = useState<Item | null>(null);
  const [showAdjustmentModal, setShowAdjustmentModal] = useState<boolean>(false);

  const [reorderTargetItem, setReorderTargetItem] = useState<Item | null>(null);
  const [showReorderModal, setShowReorderModal] = useState<boolean>(false);

  const [selectedLedgerItemId, setSelectedLedgerItemId] = useState<string | undefined>(undefined);

  // Request sequencing to prevent racing updates from overwriting newer branch selections
  const statsReqSeq = useRef<number>(0);
  const itemsReqSeq = useRef<number>(0);

  // Load dashboard stats from server - never blank out existing data with skeletons
  const loadDashboardStats = useCallback(async () => {
    const seq = ++statsReqSeq.current;
    setStatsLoading(true);

    const timer = setTimeout(() => {
      if (statsReqSeq.current === seq) {
        if (itemsRef.current && itemsRef.current.length > 0) {
          const scoped = getBranchScopedItems(itemsRef.current);
          const fallback = calculateInventorySummary(scoped);
          setStats((prev) => prev || {
            totalActiveProducts: fallback.totalActive,
            inStockCount: fallback.inStockCount,
            lowStockCount: fallback.lowStockCount,
            outOfStockCount: fallback.outOfStockCount,
            zeroStockCount: fallback.zeroStockCount,
            negativeStockCount: fallback.negativeStockCount,
            unconfiguredCount: fallback.unconfiguredCount,
            distinctCategoryCount: fallback.distinctCategoryCount,
            totalStockValueMinor: isAuthorizedForCost ? fallback.totalStockValueMinor : null,
            categoryBreakdown: [],
            recentMovements: [],
            replenishmentNeeded: [],
          });
        }
        setStatsLoading(false);
      }
    }, 2500);

    try {
      const res = await fetchInventoryDashboard(selectedBranch, tabAbortControllerRef.current?.signal);
      if (statsReqSeq.current === seq) {
        clearTimeout(timer);
        if (res && res.stats) {
          setStats(res.stats);
          tabCacheRef.current.replenish = true;
          setReplenishError(null);
        } else if (itemsRef.current && itemsRef.current.length > 0) {
          const scoped = getBranchScopedItems(itemsRef.current);
          const fallback = calculateInventorySummary(scoped);
          setStats({
            totalActiveProducts: fallback.totalActive,
            inStockCount: fallback.inStockCount,
            lowStockCount: fallback.lowStockCount,
            outOfStockCount: fallback.outOfStockCount,
            zeroStockCount: fallback.zeroStockCount,
            negativeStockCount: fallback.negativeStockCount,
            unconfiguredCount: fallback.unconfiguredCount,
            distinctCategoryCount: fallback.distinctCategoryCount,
            totalStockValueMinor: isAuthorizedForCost ? fallback.totalStockValueMinor : null,
            categoryBreakdown: [],
            recentMovements: [],
            replenishmentNeeded: [],
          });
          tabCacheRef.current.replenish = true;
        }
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      console.error('Failed to load inventory stats:', err);
      if (statsReqSeq.current === seq) {
        clearTimeout(timer);
        setReplenishError(err?.message || 'Failed to load replenishment suggestions');
        if (itemsRef.current && itemsRef.current.length > 0) {
          const scoped = getBranchScopedItems(itemsRef.current);
          const fallback = calculateInventorySummary(scoped);
          setStats({
            totalActiveProducts: fallback.totalActive,
            inStockCount: fallback.inStockCount,
            lowStockCount: fallback.lowStockCount,
            outOfStockCount: fallback.outOfStockCount,
            zeroStockCount: fallback.zeroStockCount,
            negativeStockCount: fallback.negativeStockCount,
            unconfiguredCount: fallback.unconfiguredCount,
            distinctCategoryCount: fallback.distinctCategoryCount,
            totalStockValueMinor: isAuthorizedForCost ? fallback.totalStockValueMinor : null,
            categoryBreakdown: [],
            recentMovements: [],
            replenishmentNeeded: [],
          });
        }
      }
    } finally {
      if (statsReqSeq.current === seq) {
        clearTimeout(timer);
        setStatsLoading(false);
      }
    }
  }, [selectedBranch, isAuthorizedForCost, getBranchScopedItems]);

  // Load Phase 3 insights
  const loadInsights = useCallback(async () => {
    setInsightsLoading(true);
    setInsightsError(null);
    try {
      const res = await fetchInventoryInsights(tabAbortControllerRef.current?.signal);
      setInsights(res.insights);
      tabCacheRef.current.insights = true;
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      console.error('Failed to load inventory insights:', err);
      setInsightsError(err?.message || 'Failed to load inventory intelligence.');
    } finally {
      setInsightsLoading(false);
    }
  }, []);

  // Load items table with watchdog timeout - never blank out existing table items
  const loadTableItems = useCallback(async () => {
    const seq = ++itemsReqSeq.current;
    setItemsLoading(true);
    setOverviewError(null);

    const timer = setTimeout(() => {
      if (itemsReqSeq.current === seq) {
        fallbackToLocalItems();
        setItemsLoading(false);
      }
    }, 2500);

    try {
      const res = await fetchInventoryItems(
        {
          q: debouncedSearch.trim() || undefined,
          category: categoryFilter !== 'ALL' ? categoryFilter : undefined,
          status: statusFilter !== 'all' ? statusFilter : undefined,
          sort: sortField,
          branchId: selectedBranch,
          limit: pageSize,
          offset: (page - 1) * pageSize,
          branch: selectedBranch,
        },
        tabAbortControllerRef.current?.signal
      );

      if (itemsReqSeq.current === seq) {
        clearTimeout(timer);
        if (res && Array.isArray(res.items)) {
          setTableItems(res.items);
          setTotalItems(res.total ?? res.items.length);
          tabCacheRef.current.overview = true;
        } else {
          fallbackToLocalItems();
          tabCacheRef.current.overview = true;
        }
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      console.error('Failed to load inventory items:', err);
      if (itemsReqSeq.current === seq) {
        clearTimeout(timer);
        fallbackToLocalItems();
        if (tableItems.length === 0) {
          setOverviewError(err?.message || 'Failed to load stock items');
        }
      }
    } finally {
      if (itemsReqSeq.current === seq) {
        clearTimeout(timer);
        setItemsLoading(false);
      }
    }
  }, [debouncedSearch, categoryFilter, statusFilter, sortField, selectedBranch, page, pageSize, fallbackToLocalItems]);

  // 1. Initial mount and branch change: load stats & items
  useEffect(() => {
    loadDashboardStats();
    loadTableItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBranch]);

  // 2. Filters / search / pagination change: reload items
  useEffect(() => {
    loadTableItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, categoryFilter, statusFilter, sortField, page, pageSize]);

  // 3. Sub-tab insights change
  useEffect(() => {
    if (activeSubTab === 'insights') {
      loadInsights();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSubTab]);

  // 4. Global branch switching and billing events
  useEffect(() => {
    const handleBranchChanged = () => {
      loadDashboardStats();
      loadTableItems();
      if (activeSubTab === 'insights') {
        loadInsights();
      }
    };
    const handleBillCompleted = () => {
      loadDashboardStats();
      loadTableItems();
    };
    window.addEventListener('branch_scope_changed', handleBranchChanged);
    window.addEventListener('bill_completed', handleBillCompleted);
    return () => {
      window.removeEventListener('branch_scope_changed', handleBranchChanged);
      window.removeEventListener('bill_completed', handleBillCompleted);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSubTab]);

  // 5. When items catalog prop updates from App.tsx, keep itemsRef in sync and populate if empty
  useEffect(() => {
    itemsRef.current = items || [];
    if (items) {
      if (items.length > 0) {
        setTableItems((prev) => {
          if (prev.length === 0) {
            const local = getLocalFilteredItems(items);
            return local.slice((page - 1) * pageSize, page * pageSize);
          }
          return prev;
        });
        setTotalItems((prev) => (prev === 0 ? getLocalFilteredItems(items).length : prev));
        setStats((prev) => {
          if (!prev) {
            const scoped = getBranchScopedItems(items);
            const summary = calculateInventorySummary(scoped);
            return {
              totalActiveProducts: summary.totalActive,
              inStockCount: summary.inStockCount,
              lowStockCount: summary.lowStockCount,
              outOfStockCount: summary.outOfStockCount,
              zeroStockCount: summary.zeroStockCount,
              negativeStockCount: summary.negativeStockCount,
              unconfiguredCount: summary.unconfiguredCount,
              distinctCategoryCount: summary.distinctCategoryCount,
              totalStockValueMinor: isAuthorizedForCost ? summary.totalStockValueMinor : null,
              categoryBreakdown: [],
              recentMovements: [],
              replenishmentNeeded: [],
            };
          }
          return prev;
        });
      }
      setItemsLoading(false);
      setStatsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, selectedBranch, page, pageSize, isAuthorizedForCost]);

  const handleRefreshAll = () => {
    loadDashboardStats();
    loadTableItems();
    loadInsights();
    onReloadItems();
  };

  const handleAdjustmentSuccess = (_resultingMilli: number, itemName: string) => {
    showToast(`Stock for "${itemName}" updated successfully!`);
    handleRefreshAll();
  };

  const handleReorderSuccess = (updatedItem: any) => {
    showToast(`Reorder levels for "${updatedItem.name}" updated!`);
    handleRefreshAll();
  };

  const handleOpenItemLedger = (item: Item) => {
    setSelectedLedgerItemId(item.id);
    setActiveSubTab('ledger');
  };

  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

  // Service business notice
  const isServiceBusiness = businessType === 'service';

  const totalProducts = stats?.totalActiveProducts ?? (items && items.length > 0 ? calculateInventorySummary(items).totalActive : 0);
  const inStockCount = stats?.inStockCount ?? 0;
  const lowStockCount = stats?.lowStockCount ?? 0;
  const outOfStockCount = stats?.outOfStockCount ?? 0;
  const unconfiguredCount = stats?.unconfiguredCount ?? 0;
  const distinctCategoryCount = stats?.distinctCategoryCount ?? (stats?.categoryBreakdown && stats.categoryBreakdown.length > 0 ? stats.categoryBreakdown.length : (categoriesList && categoriesList.length > 0 ? categoriesList.filter((c) => c.active).length : categories.length));
  const inStockPct = totalProducts > 0 ? Math.round((inStockCount / totalProducts) * 100) : 0;
  const lowStockPct = totalProducts > 0 ? Math.round((lowStockCount / totalProducts) * 100) : 0;
  const outOfStockPct = totalProducts > 0 ? Math.max(0, 100 - inStockPct - lowStockPct) : 0;

  return (
    <div className="inventory-module-wrapper">

      {/* Service Business Banner */}
      {isServiceBusiness && (
        <div className="service-business-notice-card">
          <LightbulbIcon size={20} style={{ color: '#16a34a', flexShrink: 0 }} />
          <div>
            <strong>Service Business Notice:</strong> This business is configured for services and consulting with zero
            mandatory inventory. Inventory features are optional and will only apply if you sell physical consumables or goods.
          </div>
        </div>
      )}

      {/* 2. Portfolio Valuation & Restock Status Hero Cards */}
      <div className="inventory-hero-grid">
        {/* HERO CARD 1: Portfolio Valuation */}
        <div
          className="bento-hero-card"
          style={{ cursor: isAuthorizedForCost ? 'pointer' : 'default' }}
          onClick={() => {
            if (isAuthorizedForCost) {
              setActiveSubTab('overview');
              setSortField('value_desc');
              setStatusFilter('in_stock');
              setPage(1);
            }
          }}
          title={
            isAuthorizedForCost
              ? 'Stock Value at Current Item Master Cost. Click to sort by value.'
              : 'Restricted to owner/manager/accountant'
          }
        >
          <div className="cat-kpi-header" style={{ marginBottom: '14px' }}>
            <div className="cat-kpi-header-left">
              <div className="cat-icon-badge indigo">
                <RupeeIcon size={16} />
              </div>
              <div>
                <span className="cat-kpi-title" style={{ display: 'block', fontSize: '13px', fontWeight: 600, letterSpacing: '0.5px' }}>
                  PORTFOLIO VALUATION
                </span>
                <span style={{ fontSize: '12px', color: '#64748B', fontWeight: 500 }}>
                  Real-time inventory worth
                </span>
              </div>
            </div>
            <span className="kpi-sub-badge green" style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#10B981', display: 'inline-block' }}></span>
              Live Sync
            </span>
          </div>

          <div
            style={{
              fontFamily: "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif",
              fontSize: '32px',
              fontWeight: 700,
              color: '#0F172A',
              lineHeight: 1.2,
              fontVariantNumeric: 'tabular-nums',
              margin: '0.25rem 0 1rem',
            }}
          >
            {isAuthorizedForCost ? (
              statsLoading ? (
                <span className="skeleton-line" style={{ display: 'inline-block', width: '160px', height: '36px', borderRadius: '6px' }} />
              ) : (
                <AnimatedCounter
                  value={(stats?.totalStockValueMinor || 0) / 100}
                  formatter={(val) => formatIndianCurrency(val)}
                  triggerKey={stats?.totalStockValueMinor}
                />
              )
            ) : (
              <span style={{ fontSize: '1rem', color: '#64748B' }}>Restricted (Staff)</span>
            )}
          </div>

          <div className="bento-health-section" style={{ marginTop: 'auto' }}>
            {totalProducts === 0 ? (
              <div
                style={{
                  height: '8px',
                  borderRadius: '9999px',
                  backgroundColor: '#E5E7F0',
                  width: '100%',
                  marginBottom: '10px',
                }}
                title="No items in inventory"
              />
            ) : (
              <div
                style={{
                  display: 'flex',
                  height: '8px',
                  borderRadius: '9999px',
                  overflow: 'hidden',
                  backgroundColor: '#F1F5F9',
                  gap: '2px',
                  marginBottom: '10px',
                }}
              >
                {inStockPct > 0 && (
                  <div
                    style={{ width: `${inStockPct}%`, background: '#22C55E', transition: 'width 0.4s ease' }}
                    title={`In-Stock: ${inStockCount} (${inStockPct}%)`}
                  />
                )}
                {lowStockPct > 0 && (
                  <div
                    style={{ width: `${lowStockPct}%`, background: '#F59E0B', transition: 'width 0.4s ease' }}
                    title={`Low Stock: ${lowStockCount} (${lowStockPct}%)`}
                  />
                )}
                {outOfStockPct > 0 && (
                  <div
                    style={{ width: `${outOfStockPct}%`, background: '#EF4444', transition: 'width 0.4s ease' }}
                    title={`Out of Stock: ${outOfStockCount} (${outOfStockPct}%)`}
                  />
                )}
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap', fontSize: '12px', color: '#64748B' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#22C55E' }}></span>
                In-Stock: <strong style={{ color: totalProducts > 0 && inStockCount > 0 ? '#15803D' : '#0F172A', fontWeight: 600 }}>{totalProducts > 0 ? inStockPct : 0}%</strong> (<AnimatedCounter value={inStockCount} triggerKey={inStockCount} />)
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#F59E0B' }}></span>
                Low: <strong style={{ color: totalProducts > 0 && lowStockCount > 0 ? '#B45309' : '#0F172A', fontWeight: 600 }}>{totalProducts > 0 ? lowStockPct : 0}%</strong> (<AnimatedCounter value={lowStockCount} triggerKey={lowStockCount} />)
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#EF4444' }}></span>
                Out: <strong style={{ color: totalProducts > 0 && outOfStockCount > 0 ? '#B91C1C' : '#0F172A', fontWeight: 600 }}>{totalProducts > 0 ? outOfStockPct : 0}%</strong> (<AnimatedCounter value={outOfStockCount} triggerKey={outOfStockCount} />)
              </span>
            </div>
          </div>
        </div>

        {/* HERO CARD 2: Restock Status */}
        {statsLoading ? (
          <div className="bento-hero-card">
            <div className="cat-kpi-header" style={{ marginBottom: '14px' }}>
              <div className="cat-kpi-header-left">
                <div className="cat-icon-badge slate">
                  <PackageIcon size={16} />
                </div>
                <div>
                  <span className="cat-kpi-title" style={{ display: 'block', fontSize: '13px', fontWeight: 600, letterSpacing: '0.5px' }}>
                    RESTOCK STATUS
                  </span>
                  <span style={{ fontSize: '12px', color: '#64748B', fontWeight: 500 }}>
                    Monitoring inventory levels
                  </span>
                </div>
              </div>
            </div>
            <div className="skeleton-line" style={{ width: '180px', height: '28px', borderRadius: '6px', margin: '0.25rem 0 0.5rem' }} />
            <div className="skeleton-line" style={{ width: '220px', height: '16px', borderRadius: '4px', marginTop: 'auto' }} />
          </div>
        ) : totalProducts === 0 ? (
          <div className="bento-hero-card">
            <div className="cat-kpi-header" style={{ marginBottom: '14px' }}>
              <div className="cat-kpi-header-left">
                <div className="cat-icon-badge slate">
                  <PackageIcon size={16} />
                </div>
                <div>
                  <span className="cat-kpi-title" style={{ display: 'block', fontSize: '13px', fontWeight: 600, letterSpacing: '0.5px' }}>
                    RESTOCK STATUS
                  </span>
                  <span style={{ fontSize: '12px', color: '#64748B', fontWeight: 500 }}>
                    Catalog status
                  </span>
                </div>
              </div>
              <span className="kpi-sub-badge slate">No Data</span>
            </div>
            <div
              style={{
                fontFamily: "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif",
                fontSize: '22px',
                fontWeight: 700,
                color: '#64748B',
                lineHeight: 1.2,
                margin: '0.25rem 0 0.5rem',
              }}
            >
              No inventory data
            </div>
            <div className="cat-kpi-footer" style={{ marginTop: 'auto', borderTop: 'none', paddingTop: 0 }}>
              <span style={{ color: '#64748B', fontSize: '13px' }}>
                Add products to begin tracking stock levels
              </span>
            </div>
          </div>
        ) : (outOfStockCount > 0 || lowStockCount > 0) ? (
          <div className="bento-hero-card">
            <div className="cat-kpi-header" style={{ marginBottom: '14px' }}>
              <div className="cat-kpi-header-left">
                <div className={`cat-icon-badge ${outOfStockCount > 0 ? 'red' : 'amber'}`}>
                  {outOfStockCount > 0 ? <AlertOctagonIcon size={16} /> : <AlertTriangleIcon size={16} />}
                </div>
                <div>
                  <span className="cat-kpi-title" style={{ display: 'block', fontSize: '13px', fontWeight: 600, letterSpacing: '0.5px' }}>
                    RESTOCK STATUS
                  </span>
                  <span style={{ fontSize: '12px', color: '#64748B', fontWeight: 500 }}>
                    {outOfStockCount > 0 ? 'Supply replenishment required' : 'Low stock alert'}
                  </span>
                </div>
              </div>
              <span className={`kpi-sub-badge ${outOfStockCount > 0 ? 'red' : 'amber'}`}>
                {outOfStockCount > 0 ? 'Critical' : 'Low Stock'}
              </span>
            </div>

            <div style={{ fontSize: '18px', fontWeight: 700, margin: '0.25rem 0 1rem', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              {outOfStockCount > 0 && (
                <span style={{ color: '#B91C1C' }}>
                  <strong>{outOfStockCount}</strong> Out of Stock
                </span>
              )}
              {outOfStockCount > 0 && lowStockCount > 0 && (
                <span style={{ color: '#CBD5E1' }}>•</span>
              )}
              {lowStockCount > 0 && (
                <span style={{ color: '#B45309' }}>
                  <strong>{lowStockCount}</strong> Low Stock
                </span>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: 'auto', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="cat-btn-primary"
                style={{
                  height: '36px',
                  borderRadius: '10px',
                  fontSize: '13px',
                  fontWeight: 600,
                  background: outOfStockCount > 0 ? '#DC2626' : '#D97706',
                  boxShadow: 'none',
                }}
                onClick={() => {
                  setActiveSubTab('overview');
                  setStatusFilter(outOfStockCount > 0 ? 'out_of_stock' : 'low_stock');
                  setPage(1);
                }}
              >
                Review Items <ArrowRightIcon size={12} />
              </button>
              {stats?.replenishmentNeeded && stats.replenishmentNeeded.length > 0 && (
                <button
                  type="button"
                  className="cat-btn-outline"
                  style={{
                    height: '36px',
                    borderRadius: '10px',
                    fontSize: '13px',
                    fontWeight: 600,
                    borderColor: '#ECECF5',
                    background: '#FFFFFF',
                  }}
                  onClick={() => setActiveSubTab('replenish')}
                >
                  Plan ({stats.replenishmentNeeded.length})
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="bento-hero-card">
            <div className="cat-kpi-header" style={{ marginBottom: '14px' }}>
              <div className="cat-kpi-header-left">
                <div className="cat-icon-badge green">
                  <CheckCircleIcon size={16} />
                </div>
                <div>
                  <span className="cat-kpi-title" style={{ display: 'block', fontSize: '13px', fontWeight: 600, letterSpacing: '0.5px' }}>
                    RESTOCK STATUS
                  </span>
                  <span style={{ fontSize: '12px', color: '#64748B', fontWeight: 500 }}>
                    Healthy inventory posture
                  </span>
                </div>
              </div>
              <span className="kpi-sub-badge green">Healthy</span>
            </div>

            <div
              style={{
                fontFamily: "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif",
                fontSize: '22px',
                fontWeight: 700,
                color: '#0F172A',
                lineHeight: 1.2,
                margin: '0.25rem 0 0.5rem',
              }}
            >
              All Shelves Sufficient
            </div>

            <div className="cat-kpi-footer" style={{ marginTop: 'auto', borderTop: 'none', paddingTop: 0 }}>
              <span style={{ color: '#64748B', fontSize: '13px' }}>
                Zero critical stockout alerts across catalog
              </span>
            </div>
          </div>
        )}
      </div>

      {/* 3. Stat Cards Row (4 Bento KPI Cards) */}
      <div className="inventory-stat-cards-grid">
        {/* Stat Card 1: Active Items */}
        <StatCard
          icon={<PackageIcon size={16} />}
          iconVariant="purple"
          label="ACTIVE ITEMS"
          statusPill={{ text: `${distinctCategoryCount} Cats`, variant: 'purple' }}
          count={statsLoading ? <span className="skeleton-line" style={{ display: 'inline-block', width: '48px', height: '24px', borderRadius: '4px' }} /> : <AnimatedCounter value={totalProducts} triggerKey={totalProducts} />}
          countColor="#0F172A"
          hint={
            statusFilter === 'all' && categoryFilter === 'ALL' && !searchQuery
              ? (unconfiguredCount > 0 ? `${unconfiguredCount} without reorder level` : '✓ Showing all items')
              : 'In product master'
          }
          isSelected={statusFilter === 'all' && categoryFilter === 'ALL' && !searchQuery}
          useSansFont={true}
          onClick={() => {
            setActiveSubTab('overview');
            setStatusFilter('all');
            setCategoryFilter('ALL');
            setSearchQuery('');
            setPage(1);
          }}
          title="Click to view all active catalog items"
        />

        {/* Stat Card 2: In-Stock */}
        <StatCard
          icon={<CheckCircleIcon size={16} />}
          iconVariant="green"
          label="IN-STOCK"
          statusPill={{ text: `${inStockPct}%`, variant: 'green' }}
          count={statsLoading ? <span className="skeleton-line" style={{ display: 'inline-block', width: '48px', height: '24px', borderRadius: '4px' }} /> : <AnimatedCounter value={inStockCount} triggerKey={inStockCount} />}
          countColor={inStockCount > 0 ? '#15803D' : '#0F172A'}
          hint={
            statusFilter === 'in_stock'
              ? '✓ Filter active (Click to reset)'
              : (unconfiguredCount > 0 ? `${unconfiguredCount} without reorder level` : 'Sufficient shelf stock')
          }
          isSelected={statusFilter === 'in_stock'}
          useSansFont={true}
          onClick={() => {
            setActiveSubTab('overview');
            setStatusFilter((prev) => (prev === 'in_stock' ? 'all' : 'in_stock'));
            setPage(1);
          }}
          title={statusFilter === 'in_stock' ? 'Click to clear in-stock filter' : 'Click to filter in-stock items'}
        />

        {/* Stat Card 3: Low Stock */}
        <StatCard
          icon={<AlertTriangleIcon size={16} />}
          iconVariant="amber"
          label="LOW STOCK"
          statusPill={lowStockCount > 0 ? { text: 'Alert', variant: 'amber' } : { text: 'OK', variant: 'green' }}
          count={statsLoading ? <span className="skeleton-line" style={{ display: 'inline-block', width: '48px', height: '24px', borderRadius: '4px' }} /> : <AnimatedCounter value={lowStockCount} triggerKey={lowStockCount} />}
          countColor={lowStockCount > 0 ? '#B45309' : '#0F172A'}
          hint={statusFilter === 'low_stock' ? '✓ Filter active (Click to reset)' : 'At or below reorder'}
          isSelected={statusFilter === 'low_stock'}
          useSansFont={true}
          onClick={() => {
            setActiveSubTab('overview');
            setStatusFilter((prev) => (prev === 'low_stock' ? 'all' : 'low_stock'));
            setPage(1);
          }}
          title={statusFilter === 'low_stock' ? 'Click to clear low stock filter' : 'Click to filter low stock items'}
        />

        {/* Stat Card 4: Out of Stock */}
        <StatCard
          icon={<AlertOctagonIcon size={16} />}
          iconVariant="red"
          label="OUT OF STOCK"
          statusPill={
            (stats?.negativeStockCount || 0) > 0
              ? { text: `${stats?.negativeStockCount} Neg`, variant: 'purple' }
              : outOfStockCount > 0
                ? { text: 'Alert', variant: 'red' }
                : { text: 'OK', variant: 'green' }
          }
          count={statsLoading ? <span className="skeleton-line" style={{ display: 'inline-block', width: '48px', height: '24px', borderRadius: '4px' }} /> : <AnimatedCounter value={outOfStockCount} triggerKey={outOfStockCount} />}
          countColor={outOfStockCount > 0 ? '#B91C1C' : '#0F172A'}
          hint={
            statusFilter === 'out_of_stock' || statusFilter === 'zero_stock' || statusFilter === 'negative_stock'
              ? '✓ Filter active (Click to reset)'
              : (stats?.negativeStockCount || 0) > 0
                ? `Zero: ${stats?.zeroStockCount ?? 0} | Neg: ${stats?.negativeStockCount}`
                : 'Zero or negative'
          }
          isSelected={statusFilter === 'out_of_stock' || statusFilter === 'zero_stock' || statusFilter === 'negative_stock'}
          useSansFont={true}
          onClick={() => {
            setActiveSubTab('overview');
            setStatusFilter((prev) =>
              prev === 'out_of_stock' || prev === 'zero_stock' || prev === 'negative_stock' ? 'all' : 'out_of_stock'
            );
            setPage(1);
          }}
          title={statusFilter === 'out_of_stock' ? 'Click to clear out of stock filter' : 'Click to filter out of stock items'}
        />
      </div>

      {/* 4. Empty state banner when 0 items */}
      {totalProducts === 0 && !statsLoading && tableItems.length === 0 && (
        <div className="inventory-empty-banner">
          <div className="inventory-empty-icon-box">
            <PackageIcon size={28} />
          </div>
          <h3 className="inventory-empty-title">No products in this branch yet</h3>
          <p className="inventory-empty-subtitle">
            Get started by adding items to your product catalogue or importing a CSV template to manage stock and inventory.
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', justifyContent: 'center' }}>
            {onNavigateToCategories && (
              <button
                type="button"
                className="cat-btn-primary"
                onClick={onNavigateToCategories}
                style={{ height: '40px', borderRadius: '12px', fontSize: '14px', fontWeight: 600, padding: '0 20px' }}
              >
                + Add Products
              </button>
            )}
          </div>
        </div>
      )}

      {/* Navigation Tabs (Sub-Navigation) */}
      <div className="inventory-nav-tabs-bar">
        <button
          type="button"
          className={`inv-tab-btn ${activeSubTab === 'overview' ? 'active' : ''}`}
          onClick={() => {
            handleSwitchTab('overview');
            setStatusFilter('all');
          }}
        >
          <PackageIcon size={16} />
          <span>Stock Overview & Items</span>
        </button>
        <button
          type="button"
          className={`inv-tab-btn ${activeSubTab === 'ledger' ? 'active' : ''}`}
          onClick={() => {
            setSelectedLedgerItemId(undefined);
            handleSwitchTab('ledger');
          }}
        >
          <FileTextIcon size={16} />
          <span>Stock Movement Ledger</span>
        </button>
        <button
          type="button"
          className={`inv-tab-btn ${activeSubTab === 'counts' ? 'active' : ''}`}
          onClick={() => handleSwitchTab('counts')}
        >
          <ClipboardCheckIcon size={16} />
          <span>Physical Stock Counts</span>
        </button>
        <button
          type="button"
          className={`inv-tab-btn ${activeSubTab === 'replenish' ? 'active' : ''}`}
          onClick={() => handleSwitchTab('replenish')}
        >
          <BellRingIcon size={16} />
          <span>Replenishment Suggestions</span>
          {statsLoading && !stats ? (
            <Skeleton width={20} height={20} circle className="tab-badge-skeleton" />
          ) : stats && stats.replenishmentNeeded.length > 0 ? (
            <span className="tab-count-badge red blinking-badge-red">{stats.replenishmentNeeded.length}</span>
          ) : null}
        </button>
        <button
          type="button"
          className={`inv-tab-btn ${activeSubTab === 'insights' ? 'active' : ''}`}
          onClick={() => handleSwitchTab('insights')}
        >
          <ZapIcon size={16} />
          <span>Insights & Risk Intelligence</span>
          {insightsLoading && !insights ? (
            <Skeleton width={20} height={20} circle className="tab-badge-skeleton" />
          ) : insights && ((insights.stockoutRisks?.length || 0) + (insights.batchWarnings?.length || 0) > 0) ? (
            <span className="tab-count-badge amber">
              {(insights.stockoutRisks?.length || 0) + (insights.batchWarnings?.length || 0)}
            </span>
          ) : null}
        </button>
      </div>

      {/* SUB-VIEW 1: Stock Overview & Items */}
      {activeSubTab === 'overview' && (
        <div className="inv-subview-content">
          {/* Filters Bar */}
          <div className="inv-table-filters-card inv-filter-bar">
            <div className="inv-search-box">
              <SearchIcon size={16} style={{ position: 'absolute', left: '0.75rem', color: 'var(--text-dim)', pointerEvents: 'none' }} />
              <input
                type="text"
                className="inv-search-input"
                placeholder="Search products by name, SKU, or barcode..."
                value={searchQuery}
                disabled={showOverviewSkeleton}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setPage(1);
                }}
              />
              {searchQuery && (
                <button
                  type="button"
                  className="clear-search-btn"
                  disabled={showOverviewSkeleton}
                  onClick={() => {
                    setSearchQuery('');
                    setPage(1);
                  }}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  <XIcon size={12} />
                </button>
              )}
            </div>

            <div className="inv-filter-group">
              <div className={`inv-actions-grid ${isOwnerOrManager && onOpenSupplierInvoiceConverter && !isSuperAdmin ? '' : 'single-action'}`}>
                {isOwnerOrManager && (
                  <button
                    type="button"
                    className={`cat-btn-primary btn-stock-adjustment ${isSuperAdmin ? 'btn-stock-adjust-deep-plum' : ''}`}
                    disabled={showOverviewSkeleton}
                    onClick={() => {
                      setAdjustmentTargetItem(null);
                      setShowAdjustmentModal(true);
                    }}
                    title="Create a manual stock increase, decrease or count discrepancy adjustment"
                    style={{
                      height: '38px',
                      borderRadius: '10px',
                      fontSize: '13px',
                      fontWeight: 600,
                      padding: '0 16px',
                      background: isSuperAdmin ? '#49364A' : '#5B4CF5',
                      color: '#FFFFFF',
                      border: isSuperAdmin ? '1px solid #352638' : 'none',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      whiteSpace: 'nowrap',
                      cursor: showOverviewSkeleton ? 'not-allowed' : 'pointer',
                      boxShadow: isSuperAdmin ? '0 2px 6px rgba(73, 54, 74, 0.25)' : 'none',
                      transition: 'all 0.15s ease',
                      opacity: showOverviewSkeleton ? 0.65 : 1,
                    }}
                    onMouseEnter={(e) => {
                      if (isSuperAdmin && !showOverviewSkeleton) {
                        e.currentTarget.style.background = '#604B61';
                        e.currentTarget.style.borderColor = '#49364A';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (isSuperAdmin && !showOverviewSkeleton) {
                        e.currentTarget.style.background = '#49364A';
                        e.currentTarget.style.borderColor = '#352638';
                      }
                    }}
                    onMouseDown={(e) => {
                      if (isSuperAdmin && !showOverviewSkeleton) {
                        e.currentTarget.style.background = '#352638';
                      }
                    }}
                    onMouseUp={(e) => {
                      if (isSuperAdmin && !showOverviewSkeleton) {
                        e.currentTarget.style.background = '#604B61';
                      }
                    }}
                  >
                    <SlidersIcon size={14} style={{ color: '#FFFFFF' }} /> Stock Adjustment
                  </button>
                )}
                {isOwnerOrManager && onOpenSupplierInvoiceConverter && !isSuperAdmin && (
                  <button
                    type="button"
                    className="cat-btn-secondary btn-convert-invoice"
                    disabled={showOverviewSkeleton}
                    onClick={onOpenSupplierInvoiceConverter}
                    title="Convert Supplier Invoice PDF/Image into Excel for Import"
                    style={{
                      height: '38px',
                      borderRadius: '10px',
                      fontSize: '13px',
                      fontWeight: 600,
                      padding: '0 14px',
                      background: '#FFFFFF',
                      color: '#4338CA',
                      border: '1.5px solid #C7D2FE',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      whiteSpace: 'nowrap',
                      cursor: showOverviewSkeleton ? 'not-allowed' : 'pointer',
                      opacity: showOverviewSkeleton ? 0.65 : 1,
                    }}
                  >
                    <FileTextIcon size={14} /> Convert Invoice to Excel
                  </button>
                )}
              </div>

              {/* Selects Grid: Categories, Statuses, Sorting */}
              <div className="inv-selects-grid">
                {/* Category Filter */}
                <select
                  className="inv-select"
                  value={categoryFilter}
                  disabled={showOverviewSkeleton}
                  onChange={(e) => {
                    setCategoryFilter(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="ALL">All Categories</option>
                  {categoriesList && categoriesList.length > 0
                    ? categoriesList
                      .filter((c) => c.active)
                      .map((c) => (
                        <option key={c.id} value={c.name}>
                          {c.parentName ? `${c.parentName} → ${c.name}` : c.name}
                        </option>
                      ))
                    : categories.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                </select>

                {/* Status Filter */}
                <select
                  className="inv-select"
                  value={statusFilter}
                  disabled={showOverviewSkeleton}
                  onChange={(e) => {
                    setStatusFilter(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="all">All Stock Statuses</option>
                  <option value="in_stock">In Stock (Healthy)</option>
                  <option value="low_stock">Low Stock (At Reorder Point)</option>
                  <option value="out_of_stock">Out of Stock (0 or Negative)</option>
                  <option value="zero_stock">Zero Stock (Exactly 0)</option>
                  <option value="negative_stock">Negative Stock (Oversold / &lt; 0)</option>
                  <option value="unconfigured">Unconfigured (No Reorder Level)</option>
                </select>

                {/* Sorting */}
                <select
                  className="inv-select inv-select-sort"
                  value={sortField}
                  disabled={showOverviewSkeleton}
                  onChange={(e) => {
                    setSortField(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="name_asc">Name (A-Z)</option>
                  <option value="name_desc">Name (Z-A)</option>
                  <option value="stock_asc">Stock (Lowest First)</option>
                  <option value="stock_desc">Stock (Highest First)</option>
                  {isAuthorizedForCost && <option value="value_desc">Valuation (Highest First)</option>}
                </select>
              </div>
            </div>
          </div>

          {/* Refresh Indeterminate Progress Bar */}
          {isOverviewRefreshing && (
            <div className="refresh-progress-bar-wrap">
              <div className="progress-line" />
            </div>
          )}

          {/* Meta Bar: Product count, View toggle, Scroll hint */}
          <div className="inv-meta-bar">
            <div className="inv-meta-count">
              Showing {tableItems.length} of {totalItems || tableItems.length} items
            </div>

            <div className="inv-view-toggle">
              <button
                type="button"
                onClick={() => setMobileTableView('cards')}
                className={`inv-toggle-btn ${mobileTableView === 'cards' ? 'active' : ''}`}
                title="Card View (Mobile Optimized)"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="7" height="7" />
                  <rect x="14" y="3" width="7" height="7" />
                  <rect x="14" y="14" width="7" height="7" />
                  <rect x="3" y="14" width="7" height="7" />
                </svg>
                <span>Cards</span>
              </button>
              <button
                type="button"
                onClick={() => setMobileTableView('table')}
                className={`inv-toggle-btn ${mobileTableView === 'table' ? 'active' : ''}`}
                title="Table View (Full Columns)"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 3h18v18H3z" />
                  <path d="M3 9h18" />
                  <path d="M3 15h18" />
                  <path d="M9 3v18" />
                </svg>
                <span>Table</span>
              </button>
            </div>

            <div className="inv-scroll-hint">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="18 8 22 12 18 16" />
                <polyline points="6 8 2 12 6 16" />
                <line x1="2" y1="12" x2="22" y2="12" />
              </svg>
              <span>Swipe horizontally to view full columns</span>
            </div>
          </div>

          {/* 1. Mobile Cards View (Visible on mobile <= 768px when Cards view is selected) */}
          <div className={`inv-mobile-cards-wrap ${mobileTableView === 'cards' ? 'active' : ''}`}>
            {tableItems.map((item) => {
              const currentUnits = item.currentStockMilli / 1000;
              const reorderUnits = (item.reorderMilli || 0) / 1000;
              const unit = item.unit || 'pcs';
              const status = determineStockStatus(currentUnits, reorderUnits);
              const matchedGlobal = items?.find((it) => it.id === item.id);
              const imgUrl = item.imageUrl || (item as any).image || matchedGlobal?.imageUrl || (matchedGlobal as any)?.image;

              const catName = item.category || 'General';
              const catLower = catName.toLowerCase();
              let catClass = '';
              if (catLower.includes('grain') || catLower.includes('staple') || catLower.includes('rice') || catLower.includes('dal') || catLower.includes('atta')) catClass = 'cat-grains';
              else if (catLower.includes('dairy') || catLower.includes('milk') || catLower.includes('curd') || catLower.includes('paneer') || catLower.includes('cheese')) catClass = 'cat-dairy';
              else if (catLower.includes('snack') || catLower.includes('biscuit') || catLower.includes('cookie') || catLower.includes('bakery') || catLower.includes('chip')) catClass = 'cat-snacks';
              else if (catLower.includes('grocer') || catLower.includes('oil') || catLower.includes('spice') || catLower.includes('masala')) catClass = 'cat-groceries';
              else if (catLower.includes('beverage') || catLower.includes('drink') || catLower.includes('juice') || catLower.includes('tea') || catLower.includes('coffee')) catClass = 'cat-beverages';

              return (
                <div key={`inv-m-${item.id}`} className="inv-mobile-card">
                  {/* Header: Thumbnail + Name + Badges */}
                  <div className="inv-mobile-card-header">
                    <div className="inv-mobile-img-box">
                      {imgUrl ? (
                        <img
                          src={imgUrl}
                          alt={item.name}
                          referrerPolicy="no-referrer"
                          onError={(e) => handleProductImageError(e, imgUrl)}
                        />
                      ) : (
                        <div className="product-thumb-placeholder" style={{ display: 'inline-flex' }}>
                          <ImageIcon size={18} />
                        </div>
                      )}
                    </div>
                    <div className="inv-mobile-title-block">
                      <div className="inv-mobile-title">{item.name}</div>
                      <div className="inv-mobile-sub">
                        {item.sku ? `SKU: ${item.sku}` : ''}
                        {item.sku && item.barcode ? ' • ' : ''}
                        {item.barcode ? `Barcode: ${item.barcode}` : ''}
                      </div>
                      <div className="inv-mobile-badges">
                        <span className={`category-pill ${catClass}`}>
                          <TagIcon size={11} style={{ opacity: 0.65, flexShrink: 0 }} />
                          <span>{catName}</span>
                        </span>
                        <span
                          className={`status-pill ${status === 'negative_stock'
                            ? 'purple'
                            : status === 'out_of_stock'
                              ? 'red'
                              : status === 'low_stock'
                                ? 'amber'
                                : 'green'
                            }`}
                        >
                          {status === 'negative_stock'
                            ? 'Negative Stock'
                            : status === 'out_of_stock'
                              ? 'Out of Stock'
                              : status === 'low_stock'
                                ? 'Low Stock'
                                : 'In Stock'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Spec Grid */}
                  <div className="inv-mobile-spec-grid">
                    <div className="inv-mobile-spec-item">
                      <span className="inv-mobile-spec-label">Current Stock</span>
                      <span className="inv-mobile-spec-val stock">
                        <span className={`stock-number-pill ${currentUnits < 0 ? 'negative' : currentUnits === 0 ? 'zero' : ''}`}>
                          {formatStockQuantity(currentUnits, unit)}
                        </span>
                      </span>
                    </div>

                    <div className="inv-mobile-spec-item">
                      <span className="inv-mobile-spec-label">Reorder Point</span>
                      <span className="inv-mobile-spec-val">
                        {reorderUnits > 0 ? (
                          <span
                            className="editable-reorder-link"
                            title="Click to change reorder point"
                            onClick={() => {
                              setReorderTargetItem(item);
                              setShowReorderModal(true);
                            }}
                          >
                            {formatStockQuantity(reorderUnits, unit)}
                            <Edit3Icon size={11} style={{ display: 'inline', marginLeft: 3, verticalAlign: 'middle', opacity: 0.7 }} />
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="btn-configure-tag"
                            onClick={() => {
                              setReorderTargetItem(item);
                              setShowReorderModal(true);
                            }}
                          >
                            + Set Reorder
                          </button>
                        )}
                      </span>
                    </div>

                    {item.preferredSupplierName ? (
                      <div className="inv-mobile-spec-item">
                        <span className="inv-mobile-spec-label">Supplier</span>
                        <span className="inv-mobile-spec-val" style={{ fontSize: '0.78rem', color: '#475569' }}>
                          {item.preferredSupplierName}
                        </span>
                      </div>
                    ) : isAuthorizedForCost ? (
                      <div className="inv-mobile-spec-item">
                        <span className="inv-mobile-spec-label">Unit Cost</span>
                        <span className="inv-mobile-spec-val" style={{ fontSize: '0.8rem', color: '#475569' }}>
                          {formatIndianCurrency(item.costMinor / 100)}
                        </span>
                      </div>
                    ) : null}
                  </div>

                  {/* Actions Row */}
                  <div className="inv-mobile-actions-row">
                    <button
                      type="button"
                      className="inv-mobile-action-btn ledger"
                      title="View stock movement history for this item"
                      onClick={() => handleOpenItemLedger(item)}
                    >
                      <FileTextIcon size={13} />
                      <span>Ledger</span>
                    </button>
                    {isOwnerOrManager && (
                      <button
                        type="button"
                        className="inv-mobile-action-btn adjust"
                        title="Adjust physical or system stock"
                        onClick={() => {
                          setAdjustmentTargetItem(item);
                          setShowAdjustmentModal(true);
                        }}
                      >
                        <SlidersIcon size={13} />
                        <span>Adjust Stock</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
            {tableItems.length === 0 && !showOverviewSkeleton && !overviewError && (
              <div style={{ textAlign: 'center', padding: '2rem 1rem', color: '#94a3b8' }}>
                No items match your search or filter criteria.
              </div>
            )}
          </div>

          {/* Items Table */}
          <div className={`ledger-table-wrap ${mobileTableView === 'cards' ? 'mobile-hidden' : 'mobile-active'}`}>
            {showOverviewSkeleton ? (
              <TableSkeleton
                columns={overviewSkeletonColumns}
                rowCount={8}
                rowHeight={64}
                isSlow={isOverviewSlow}
                onCancel={() => {
                  if (tabAbortControllerRef.current) tabAbortControllerRef.current.abort();
                  setItemsLoading(false);
                  cancelOverviewSlow();
                }}
                loadingText="Loading stock items..."
              />
            ) : overviewError ? (
              <div className="inline-error-card-state">
                <div className="error-icon-box">
                  <AlertTriangleIcon size={24} />
                </div>
                <h4>Couldn't load stock items</h4>
                <p>{overviewError}</p>
                <button type="button" className="error-retry-btn" onClick={loadTableItems}>
                  Retry Loading
                </button>
              </div>
            ) : tableItems.length === 0 ? (
              <div className="table-empty-state">
                <div className="table-empty-icon-wrap">
                  <PackageIcon size={32} />
                </div>
                <h3>
                  {statusFilter === 'out_of_stock'
                    ? 'No Out of Stock Items'
                    : statusFilter === 'low_stock'
                      ? 'No Low Stock Items'
                      : statusFilter !== 'all' || categoryFilter !== 'ALL' || searchQuery
                        ? 'No Matching Items Found'
                        : 'No Items in Inventory'}
                </h3>
                <p>
                  {statusFilter === 'out_of_stock'
                    ? 'Great news! All products in your catalog are currently in stock. None are out of stock or negative.'
                    : statusFilter === 'low_stock'
                      ? 'All inventory items are currently above their minimum reorder levels.'
                      : 'No inventory items matched your current search or filter criteria.'}
                </p>
                {(statusFilter !== 'all' || categoryFilter !== 'ALL' || searchQuery) && (
                  <button
                    type="button"
                    className="reset-filter-btn"
                    onClick={() => {
                      setStatusFilter('all');
                      setCategoryFilter('ALL');
                      setSearchQuery('');
                      setPage(1);
                    }}
                  >
                    <RefreshCwIcon size={15} />
                    <span>Clear Filters & Show All Products ({stats?.totalActiveProducts ?? items.length})</span>
                  </button>
                )}
              </div>
            ) : (
              <table className={`inventory-data-table ${isOverviewRefreshing ? 'table-refreshing-dim' : 'skeleton-fade-in'}`}>
                <thead>
                  <tr>
                    <th style={{ minWidth: '170px' }} className="col-sticky-prod">Product & Identifiers</th>
                    <th style={{ minWidth: '140px', width: '150px', textAlign: 'left', whiteSpace: 'nowrap' }}>Category</th>
                    <th style={{ minWidth: '100px', textAlign: 'right' }}>Current Stock</th>
                    <th style={{ minWidth: '110px' }}>Status</th>
                    <th style={{ minWidth: '95px', textAlign: 'right' }}>Reorder Level</th>
                    {isAuthorizedForCost && <th style={{ minWidth: '85px', textAlign: 'right' }}>Unit Cost</th>}
                    {isAuthorizedForCost && <th style={{ minWidth: '95px', textAlign: 'right' }}>Total Value</th>}
                    <th style={{ minWidth: '160px', width: '190px', textAlign: 'left' }}>Supplier</th>
                    <th style={{ minWidth: '120px', textAlign: 'right' }} className="col-sticky-actions">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {tableItems.map((item) => {
                    const currentUnits = item.currentStockMilli / 1000;
                    const reorderUnits = (item.reorderMilli || 0) / 1000;
                    const unit = item.unit || 'pcs';

                    return (
                      <tr key={item.id} className="item-row">
                        <td style={{ minWidth: '170px', maxWidth: '240px' }} className="col-sticky-prod">
                          <div className="item-cell-title" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.name}</div>
                          <div className="item-cell-sub" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {item.sku ? `SKU: ${item.sku}` : ''}
                            {item.sku && item.barcode ? ' • ' : ''}
                            {item.barcode ? `Barcode: ${item.barcode}` : ''}
                          </div>
                        </td>
                        <td style={{ minWidth: '140px', width: '150px', textAlign: 'left', verticalAlign: 'middle', whiteSpace: 'nowrap' }}>
                          {(() => {
                            const catName = item.category || 'General';
                            const catLower = catName.toLowerCase();
                            let catClass = '';
                            if (catLower.includes('grain') || catLower.includes('staple') || catLower.includes('rice') || catLower.includes('dal') || catLower.includes('atta')) catClass = 'cat-grains';
                            else if (catLower.includes('dairy') || catLower.includes('milk') || catLower.includes('curd') || catLower.includes('paneer') || catLower.includes('cheese')) catClass = 'cat-dairy';
                            else if (catLower.includes('snack') || catLower.includes('biscuit') || catLower.includes('cookie') || catLower.includes('bakery') || catLower.includes('chip')) catClass = 'cat-snacks';
                            else if (catLower.includes('grocer') || catLower.includes('oil') || catLower.includes('spice') || catLower.includes('masala')) catClass = 'cat-groceries';
                            else if (catLower.includes('beverage') || catLower.includes('drink') || catLower.includes('juice') || catLower.includes('tea') || catLower.includes('coffee')) catClass = 'cat-beverages';

                            const matched = categoriesList?.find((c) => c.name.toLowerCase() === catLower);
                            const titleText = matched && matched.parentName ? `${matched.parentName} → ${catName}` : catName;

                            return (
                              <span className={`category-pill ${catClass}`} title={titleText}>
                                <TagIcon size={11} style={{ opacity: 0.65, flexShrink: 0 }} />
                                <span>{catName}</span>
                              </span>
                            );
                          })()}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <span
                            className={`stock-number-pill ${currentUnits < 0 ? 'negative' : currentUnits === 0 ? 'zero' : ''
                              }`}
                          >
                            {formatStockQuantity(currentUnits, unit)}
                          </span>
                        </td>
                        <td>
                          {(() => {
                            const status = determineStockStatus(currentUnits, reorderUnits);
                            return (
                              <span
                                className={`status-pill ${status === 'negative_stock'
                                  ? 'purple'
                                  : status === 'out_of_stock'
                                    ? 'red'
                                    : status === 'low_stock'
                                      ? 'amber'
                                      : 'green'
                                  }`}
                              >
                                {status === 'negative_stock'
                                  ? 'Negative Stock'
                                  : status === 'out_of_stock'
                                    ? 'Out of Stock'
                                    : status === 'low_stock'
                                      ? 'Low Stock'
                                      : 'In Stock'}
                              </span>
                            );
                          })()}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          {reorderUnits > 0 ? (
                            <span
                              className="editable-reorder-link"
                              title="Click to change reorder point"
                              onClick={() => {
                                setReorderTargetItem(item);
                                setShowReorderModal(true);
                              }}
                            >
                              {formatStockQuantity(reorderUnits, unit)}
                              <Edit3Icon size={12} style={{ display: 'inline', marginLeft: 4, verticalAlign: 'middle', opacity: 0.7 }} />
                            </span>
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px' }}>
                              <button
                                type="button"
                                className="btn-configure-tag"
                                onClick={() => {
                                  setReorderTargetItem(item);
                                  setShowReorderModal(true);
                                }}
                              >
                                + Set Reorder
                              </button>
                              <span style={{ fontSize: '0.68rem', color: 'var(--text-dim)' }}>Not Configured</span>
                            </div>
                          )}
                        </td>

                        {isAuthorizedForCost && (
                          <td style={{ textAlign: 'right', color: '#475569', fontVariantNumeric: 'tabular-nums' }}>
                            {formatIndianCurrency(item.costMinor / 100)}
                          </td>
                        )}
                        {isAuthorizedForCost && (
                          <td style={{ textAlign: 'right', fontWeight: 600, color: '#0F172A', fontVariantNumeric: 'tabular-nums' }}>
                            {formatIndianCurrency((item.stockValueMinor || 0) / 100)}
                          </td>
                        )}
                        <td style={{ minWidth: '160px', width: '190px' }}>
                          {item.preferredSupplierName ? (
                            <span
                              className="supplier-chip"
                              title={item.preferredSupplierPhone ? `${item.preferredSupplierName} • Phone: ${item.preferredSupplierPhone}` : item.preferredSupplierName}
                            >
                              <Building2Icon size={12} style={{ flexShrink: 0, opacity: 0.75 }} />
                              <span className="supplier-name-text">{item.preferredSupplierName}</span>
                            </span>
                          ) : (
                            <span style={{ color: 'var(--text-dim)', fontSize: '0.8rem', paddingLeft: '0.25rem' }}>--</span>
                          )}
                        </td>
                        <td style={{ textAlign: 'right' }} className="col-sticky-actions">
                          <div className="table-actions-cluster">
                            <button
                              type="button"
                              className="btn-action-small"
                              title="View stock movement history for this item"
                              onClick={() => handleOpenItemLedger(item)}
                              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
                            >
                              <FileTextIcon size={13} /> Ledger
                            </button>
                            {isOwnerOrManager && (
                              <button
                                type="button"
                                className="btn-action-small primary"
                                title="Adjust physical or system stock"
                                onClick={() => {
                                  setAdjustmentTargetItem(item);
                                  setShowAdjustmentModal(true);
                                }}
                                style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
                              >
                                <SlidersIcon size={13} /> Adjust
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {isOverviewRefreshing && (
                    <>
                      {Array.from({ length: 3 }).map((_, rIdx) => (
                        <tr
                          key={`more-skel-${rIdx}`}
                          className="table-skeleton-row"
                          style={{
                            height: 64,
                            opacity: rIdx === 2 ? 0.5 : 0.85,
                          }}
                        >
                          {overviewSkeletonColumns.map((col, cIdx) => (
                            <td
                              key={`more-skel-${rIdx}-${cIdx}`}
                              style={{
                                width: col.width,
                                minWidth: col.minWidth,
                                textAlign: col.align || 'left',
                                padding: '0.65rem 0.85rem',
                              }}
                            >
                              {col.renderSkeleton ? (
                                col.renderSkeleton(rIdx)
                              ) : (
                                <Skeleton
                                  width={`${Math.floor(65 + ((rIdx * 19 + cIdx * 13) % 30))}%`}
                                  height={14}
                                  radius={4}
                                />
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </>
                  )}
                </tbody>
              </table>
            )}
            {isOverviewRefreshing && tableItems.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '10px 0', color: '#64748b', fontSize: '13px' }}>
                <div className="slow-load-spinner" style={{ width: 14, height: 14, borderTopColor: '#3B1E36', borderColor: '#E2E8F0' }} />
                <span>Loading 25 more…</span>
              </div>
            )}
          </div>

          {/* Pagination */}
          <div className="pagination-bar">
            <div className="pagination-info" style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
              <span>
                Showing {totalItems === 0 ? 0 : (page - 1) * pageSize + 1} to {Math.min(page * pageSize, totalItems)} of {totalItems} items
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.74rem' }}>
                Rows:
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setPage(1);
                  }}
                  style={{ padding: '0.12rem 0.35rem', fontSize: '0.74rem', border: '1px solid var(--border)', borderRadius: '4px', background: 'var(--bg-card)' }}
                >
                  <option value={8}>8</option>
                  <option value={10}>10</option>
                  <option value={15}>15</option>
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                </select>
              </span>
            </div>
            {totalItems > pageSize && (
              <div className="pagination-buttons">
                <button
                  type="button"
                  className="page-btn"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Previous
                </button>
                <span className="page-current">
                  Page {page} of {totalPages}
                </span>
                <button
                  type="button"
                  className="page-btn"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  Next
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* SUB-VIEW 2: Stock Movement Ledger */}
      {activeSubTab === 'ledger' && (
        <div className="inv-subview-content">
          <StockLedgerView initialItemId={selectedLedgerItemId} items={items} />
        </div>
      )}

      {/* SUB-VIEW 3: Physical Stock Counts */}
      {activeSubTab === 'counts' && (
        <div className="inv-subview-content">
          <PhysicalStockCountView
            categories={categories}
            categoriesList={categoriesList}
            userRole={userRole}
            onInventoryUpdated={handleRefreshAll}
            showToast={showToast}
          />
        </div>
      )}

      {/* SUB-VIEW 4: Replenishment Suggestions */}
      {activeSubTab === 'replenish' && (
        <div className="inv-subview-content">

          {isReplenishRefreshing && (
            <div className="refresh-progress-bar-wrap">
              <div className="progress-line" />
            </div>
          )}

          {replenishError ? (
            <div className="inline-error-card-state" style={{ marginTop: '1rem' }}>
              <div className="error-icon-box">
                <AlertTriangleIcon size={24} />
              </div>
              <h4>Couldn't load replenishment recommendations</h4>
              <p>{replenishError}</p>
              <button
                type="button"
                className="error-retry-btn"
                onClick={() => loadDashboardStats()}
              >
                Retry Loading
              </button>
            </div>
          ) : showReplenishSkeleton ? (
            <div aria-busy="true" style={{ marginTop: '1rem' }}>
              <div className="visually-hidden" aria-live="polite">Loading replenishment suggestions…</div>
              {isReplenishSlow && (
                <div className="slow-load-strip">
                  <div className="slow-load-strip-content">
                    <div className="slow-load-spinner" />
                    <span>This is taking longer than usual...</span>
                  </div>
                  <button type="button" className="slow-load-cancel-btn" onClick={cancelReplenishSlow}>
                    Cancel
                  </button>
                </div>
              )}
              <CardSkeleton variant="replenish" count={4} className={isReplenishSlow ? 'slow-load-fade-mask' : ''} />
            </div>
          ) : !stats || stats.replenishmentNeeded.length === 0 ? (
            <div className="table-empty-state">
              <CheckCircleIcon size={36} style={{ color: "#10b981", marginBottom: "0.5rem" }} />
              <h3>All Products Sufficiently Stocked</h3>
              <p>No products have currently dropped to or below their configured reorder levels.</p>
            </div>
          ) : (
            <div className={`ledger-table-wrap ${isReplenishRefreshing ? 'table-refreshing-dim' : 'skeleton-fade-in'}`}>
              <table className="inventory-data-table replenishment-table">
                <thead>
                  <tr>
                    <th>Product & Identifiers</th>
                    <th style={{ minWidth: '140px', width: '150px', textAlign: 'left', whiteSpace: 'nowrap' }}>Category</th>
                    <th style={{ textAlign: 'right' }}>Current Stock</th>
                    <th style={{ textAlign: 'right' }}>Reorder Point</th>
                    <th style={{ textAlign: 'right' }}>Deficit / Gap</th>
                    <th style={{ textAlign: 'right' }}>
                      Suggested Order
                      <span
                        className="info-tooltip-trigger"
                        title="Target-Stock Formula: max(1, 2 × max(reorder point, min stock) − current stock). Targets 2× reorder point to rebuild working buffer. Note: Does not account for supplier lead time, pending purchase orders, or vendor pack sizes."
                        style={{ marginLeft: '4px', cursor: 'help', fontSize: '0.85em' }}
                      >
                        <InfoIcon size={13} style={{ marginLeft: "4px", verticalAlign: "middle" }} />
                      </span>
                    </th>
                    <th>Supplier Details</th>
                    <th style={{ textAlign: 'right' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.replenishmentNeeded.map((r) => {
                    const currentUnits = r.currentStockMilli / 1000;
                    const reorderUnits = r.reorderMilli / 1000;
                    const suggestedUnits = r.suggestedOrderQtyMilli / 1000;
                    const deficitUnits = Math.max(0, reorderUnits - currentUnits);

                    return (
                      <tr key={r.itemId}>
                        <td>
                          <div className="item-cell-title">{r.name}</div>
                          <div className="item-cell-sub">
                            {r.sku ? `SKU: ${r.sku}` : ''}
                            {r.sku && r.barcode ? ' • ' : ''}
                            {r.barcode ? `Barcode: ${r.barcode}` : ''}
                          </div>
                        </td>
                        <td style={{ minWidth: '140px', width: '150px', textAlign: 'left', verticalAlign: 'middle', whiteSpace: 'nowrap' }}>
                          <span className="category-pill">{r.category || 'General'}</span>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <span className={`stock-number-pill ${currentUnits <= 0 ? 'zero' : 'low'}`}>
                            {currentUnits.toFixed(1)} {r.unit}
                          </span>
                        </td>
                        <td style={{ textAlign: 'right' }} className="mono">
                          {reorderUnits.toFixed(1)} {r.unit}
                        </td>
                        <td style={{ textAlign: 'right', color: '#f43f5e', fontWeight: 700 }} className="mono">
                          -{deficitUnits.toFixed(1)} {r.unit}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <span className="suggested-order-badge">
                            +{suggestedUnits.toFixed(1)} {r.unit}
                          </span>
                        </td>
                        <td>
                          {r.preferredSupplierName ? (
                            <div>
                              <div style={{ fontWeight: 600 }}>{r.preferredSupplierName}</div>
                              {r.preferredSupplierPhone && (
                                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                                  <PhoneIcon size={12} style={{ display: "inline", marginRight: "4px", verticalAlign: "middle" }} />{r.preferredSupplierPhone}
                                </div>
                              )}
                            </div>
                          ) : (
                            <span style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>
                              No supplier linked
                            </span>
                          )}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <button
                            type="button"
                            className="btn-primary-small"
                            onClick={() => {
                              if (onNavigateToPurchases) {
                                onNavigateToPurchases(r.preferredSupplierId || undefined, r.itemId);
                              } else {
                                showToast(`Navigate to Purchases to place order for ${r.name}`);
                              }
                            }}
                          >
                            <DownloadIcon size={13} style={{ display: "inline", marginRight: "4px", verticalAlign: "middle" }} /> Inward / Order
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
      )}

      {/* SUB-VIEW 5: Insights & Risk Intelligence (Phase 3) */}
      {activeSubTab === 'insights' && (
        <div className="inv-subview-content">
          {isInsightsRefreshing && (
            <div className="refresh-progress-bar-wrap">
              <div className="progress-line" />
            </div>
          )}

          {insightsError ? (
            <div className="inline-error-card-state" style={{ marginTop: '1rem' }}>
              <div className="error-icon-box">
                <AlertTriangleIcon size={24} />
              </div>
              <h4>Unable to Load Insights</h4>
              <p>{insightsError}</p>
              <button type="button" className="error-retry-btn" onClick={() => loadInsights()}>
                Retry Analysis
              </button>
            </div>
          ) : showInsightsSkeleton ? (
            <div className={`insights-skeleton-wrapper ${isInsightsSlow ? 'slow-load-fade-mask' : ''}`} aria-busy="true" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', marginTop: '1rem' }}>

              {isInsightsSlow && (
                <div className="slow-load-strip">
                  <div className="slow-load-strip-content">
                    <div className="slow-load-spinner" />
                    <span>This is taking longer than usual...</span>
                  </div>
                  <button type="button" className="slow-load-cancel-btn" onClick={cancelInsightsSlow}>
                    Cancel
                  </button>
                </div>
              )}
              {/* KPI row: 4 cards */}
              <CardSkeleton variant="kpi" count={4} />

              {/* Large chart card: full width, 280px tall */}
              <ChartSkeleton type="bar" height={280} titleWidth={220} barsCount={8} />

              {/* Two half-width chart cards: 220px tall */}
              <div className="insights-grid">
                <ChartSkeleton type="line" height={220} titleWidth={180} barsCount={6} />
                <ChartSkeleton type="donut" height={220} titleWidth={160} />
              </div>

              {/* Risk alerts list: 3 rows */}
              <div className="insights-panel-card" style={{ padding: '1.25rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                  <Skeleton width={180} height={16} radius={4} />
                  <Skeleton width={80} height={20} radius={9999} />
                </div>
                <CardSkeleton variant="risk_alert" count={3} />
              </div>
            </div>
          ) : !insights ? (
            <div className="table-empty-state">
              <AlertTriangleIcon size={40} style={{ color: "#f59e0b", marginBottom: "0.5rem" }} />
              <h3>Unable to Load Insights</h3>
              <p>An error occurred while computing inventory intelligence.</p>
              <button type="button" className="btn-primary" onClick={() => loadInsights()} style={{ marginTop: '0.75rem' }}>
                Retry Analysis
              </button>
            </div>
          ) : (
            <div className={`insights-content-loaded ${isInsightsRefreshing ? 'table-refreshing-dim' : 'skeleton-fade-in'}`} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

              {/* Row 1: Stock Alert & Days Remaining + Slow Moving Dead Stock */}
              <div className="insights-grid">
                {/* 1. Stock Alert & Days Remaining */}
                <div className="insights-panel-card">
                  <div className="insights-panel-header">
                    <h3>
                      <AlertOctagonIcon size={18} style={{ color: "#ef4444", display: "inline", marginRight: "6px", verticalAlign: "middle" }} />Stock Alert & Days Remaining
                    </h3>
                    <span className="badge-live-sync">Average Daily Sales</span>
                  </div>
                  <div className="insights-panel-body">
                    {insights.stockoutRisks.length === 0 ? (
                      <div className="table-empty-state" style={{ padding: '2rem 1rem' }}>
                        <CheckCircleIcon size={36} style={{ color: "#10b981", marginBottom: "0.5rem" }} />
                        <h4>No Stock Alerts</h4>
                        <p>All products have sufficient stock based on recent sales.</p>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        {insights.stockoutRisks.map((item) => (
                          <div
                            key={item.itemId}
                            style={{
                              padding: '0.75rem 0.9rem',
                              background: '#f8fafc',
                              border: '1px solid var(--border)',
                              borderRadius: '6px',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '0.4rem',
                            }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span style={{ fontWeight: 700, color: 'var(--text-main)', fontSize: '0.9rem' }}>
                                {item.name}
                              </span>
                              <span
                                className={`runway-badge ${item.riskLevel === 'out_of_stock' || item.riskLevel === 'critical'
                                  ? 'critical'
                                  : 'high'
                                  }`}
                              >
                                {item.riskLevel === 'out_of_stock'
                                  ? 'Out of Stock (0d)'
                                  : `Stock Lasts ~${formatStockDuration(item.runwayDays)}`}
                              </span>
                            </div>
                            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                              Stock: <strong>{item.currentStockUnits.toFixed(1)} {item.unit}</strong> • Average Sales: <strong>{item.dailyVelocityUnits.toFixed(1)} {item.unit}/day</strong> ({item.sold30dUnits.toFixed(1)} {item.unit} sold across {item.ordersCount} orders)
                            </div>
                            <div style={{ fontSize: '0.78rem', color: '#b91c1c', background: '#fef2f2', padding: '0.35rem 0.5rem', borderRadius: '4px' }}>
                              {item.explainableReason}
                            </div>
                            {item.preferredSupplierName && (
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.25rem', paddingTop: '0.35rem', borderTop: '1px dashed var(--border)', fontSize: '0.75rem' }}>
                                <span style={{ color: 'var(--text-dim)' }}>
                                  Supplier: <strong>{item.preferredSupplierName}</strong>
                                </span>
                                {onNavigateToPurchases && (
                                  <button
                                    type="button"
                                    className="btn-action-small primary"
                                    onClick={() => onNavigateToPurchases(undefined, item.itemId)}
                                  >
                                    Order Stock →
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* 2. Unsold Stock Alert */}
                <div className="insights-panel-card">
                  <div className="insights-panel-header">
                    <h3>
                      <ClockIcon size={18} style={{ color: "#f59e0b", display: "inline", marginRight: "6px", verticalAlign: "middle" }} />Unsold Stock Alert
                    </h3>
                    <span className="badge-live-sync">No Sales for 60 Days</span>
                  </div>
                  <div className="insights-panel-body">
                    {insights.slowMovingItems.length === 0 ? (
                      <div className="table-empty-state" style={{ padding: '2rem 1rem' }}>
                        <CheckCircleIcon size={36} style={{ color: "#10b981", marginBottom: "0.5rem" }} />
                        <h4>All Products Are Selling Well</h4>
                        <p>No unsold products found with zero sales in the last 60 days.</p>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        {insights.slowMovingItems.map((item) => (
                          <div
                            key={item.itemId}
                            style={{
                              padding: '0.75rem 0.9rem',
                              background: '#f8fafc',
                              border: '1px solid var(--border)',
                              borderRadius: '6px',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '0.4rem',
                            }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span style={{ fontWeight: 700, color: 'var(--text-main)', fontSize: '0.9rem' }}>
                                {item.name}
                              </span>
                              {item.tiedCapitalMinor !== null && (
                                <span className="dead-capital-badge" title="Money invested in unsold stock">
                                  ₹{(item.tiedCapitalMinor / 100).toFixed(2)} Money Stuck
                                </span>
                              )}
                            </div>
                            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                              Unsold Stock: <strong>{item.currentStockUnits.toFixed(1)} {item.unit}</strong> • Category: {item.category || 'General'}
                            </div>
                            <div style={{ fontSize: '0.78rem', color: '#92400e', background: '#fffbeb', padding: '0.35rem 0.5rem', borderRadius: '4px' }}>
                              {item.explainableReason} Suggestion: Consider offering a discount or returning the stock to the supplier.
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Row 2: Duplicate-Item Detector + Batch & Expiry + Audit Variance */}
              <div className="insights-grid">
                {/* 3. Duplicate Items & Barcode Collision Detector */}
                <div className="insights-panel-card">
                  <div className="insights-panel-header">
                    <h3>
                      <AlertTriangleIcon size={18} style={{ color: "#d97706", display: "inline", marginRight: "6px", verticalAlign: "middle" }} />Duplicate-Item & Barcode Collision Detector
                    </h3>
                    <span className="badge-live-sync">Data Integrity</span>
                  </div>
                  <div className="insights-panel-body">
                    {insights.duplicates.length === 0 ? (
                      <div className="table-empty-state" style={{ padding: '2rem 1rem' }}>
                        <CheckCircleIcon size={36} style={{ color: "#10b981", marginBottom: "0.5rem" }} />
                        <h4>Clean Master Data</h4>
                        <p>Zero barcode collisions or duplicate item names found in this store.</p>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        {insights.duplicates.map((dup, idx) => (
                          <div
                            key={idx}
                            style={{
                              padding: '0.75rem 0.9rem',
                              background: '#fef2f2',
                              border: '1px solid #fecaca',
                              borderRadius: '6px',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '0.35rem',
                            }}
                          >
                            <div style={{ fontWeight: 700, color: '#991b1b', fontSize: '0.86rem' }}>
                              {dup.type === 'barcode_collision' ? 'Barcode Collision' : 'Duplicate Product Name'}: "{dup.key}"
                            </div>
                            <div style={{ fontSize: '0.78rem', color: '#7f1d1d' }}>
                              {dup.description}
                            </div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                              Affected Items:{' '}
                              {dup.items.map((it) => (
                                <span key={it.id} style={{ background: '#ffffff', padding: '0.1rem 0.4rem', borderRadius: '3px', border: '1px solid #fca5a5' }}>
                                  {it.name} {it.sku ? `(${it.sku})` : ''}
                                </span>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* 4. Inward Batches Near Expiry */}
                <div className="insights-panel-card">
                  <div className="insights-panel-header">
                    <h3>
                      <PackageIcon size={18} style={{ color: "var(--primary)", display: "inline", marginRight: "6px", verticalAlign: "middle" }} />Inward Batches Near Expiry
                    </h3>
                    <span className="badge-live-sync">Received Inward Lots</span>
                  </div>
                  <div className="insights-panel-body">
                    <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.75rem', lineHeight: 1.4 }}>
                      Identifies received purchase batches approaching expiry. Note: Because POS sales track total item stock rather than individual batch lots, this volume reflects inward quantity received, not verified on-shelf lot balances.
                    </p>
                    {insights.batchWarnings.length === 0 ? (
                      <div className="table-empty-state" style={{ padding: '2rem 1rem' }}>
                        <CheckCircleIcon size={36} style={{ color: "#10b981", marginBottom: "0.5rem" }} />
                        <h4>No Expiry Risks Detected</h4>
                        <p>All tracked received batch lots are within safe shelf-life windows.</p>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        {insights.batchWarnings.map((batch, idx) => (
                          <div
                            key={idx}
                            style={{
                              padding: '0.75rem 0.9rem',
                              background: batch.status === 'expired' ? '#fff1f2' : '#fffbeb',
                              border: `1px solid ${batch.status === 'expired' ? '#fecdd3' : '#fde68a'}`,
                              borderRadius: '6px',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '0.35rem',
                            }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span style={{ fontWeight: 700, color: 'var(--text-main)', fontSize: '0.88rem' }}>
                                {batch.itemName}
                              </span>
                              <span className="batch-quarantine-badge">
                                {batch.status === 'expired' ? 'EXPIRED' : 'EXPIRING SOON'}
                              </span>
                            </div>
                            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                              Batch: <strong>{batch.batchNo}</strong> • Expiry Date: <strong>{batch.expiry}</strong> • Inward Received Qty: <strong>{((batch.inwardUnits ?? batch.remainingUnits ?? 0)).toFixed(1)} {batch.unit}</strong>
                            </div>
                            <div style={{ fontSize: '0.76rem', color: batch.status === 'expired' ? '#9f1239' : '#92400e' }}>
                              {batch.warning}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Row 3: Physical Count Accuracy & Audit History */}
              <div className="insights-panel-card">
                <div className="insights-panel-header">
                  <h3>
                    <BarChart3Icon size={18} style={{ color: isSuperAdmin ? "#49364A" : "#6366f1", display: "inline", marginRight: "6px", verticalAlign: "middle" }} />Physical Count Audit Accuracy & Shrinkage Analytics
                  </h3>
                  <span className="badge-live-sync">Audit Trail History</span>
                </div>
                <div className="insights-panel-body">
                  {insights.auditVariance.recentCounts.length === 0 ? (
                    <div className="table-empty-state" style={{ padding: '2rem 1rem' }}>
                      <ClipboardCheckIcon size={36} style={{ color: "var(--text-dim)", marginBottom: "0.5rem" }} />
                      <h4>No Completed Physical Counts Yet</h4>
                      <p>Conduct and finalize physical counts in the "Physical Stock Counts" tab to populate inventory audit variance analytics.</p>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                      <table className="inventory-data-table">
                        <thead>
                          <tr>
                            <th>Count Session</th>
                            <th>Date Finalized</th>
                            <th style={{ textAlign: 'right' }}>Audited Items</th>
                            <th style={{ textAlign: 'right' }}>Discrepancies</th>
                            <th
                              style={{ textAlign: 'right' }}
                              title="SKU Match Rate: (Audited Items - Discrepant Items) / Audited Items × 100%. Measures line-item match percentage, distinct from quantity variance or financial variance."
                            >
                              SKU Match Rate %
                            </th>
                            <th style={{ textAlign: 'right' }}>Net Variance Units</th>
                            {isAuthorizedForCost && <th style={{ textAlign: 'right' }}>Net Value Variance</th>}
                          </tr>
                        </thead>
                        <tbody>
                          {insights.auditVariance.recentCounts.map((c) => (
                            <tr key={c.id}>
                              <td>
                                <div style={{ fontWeight: 700 }}>{c.name}</div>
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>#{c.countNumber}</div>
                              </td>
                              <td>{new Date(c.finalizedAt).toLocaleDateString('en-IN')}</td>
                              <td style={{ textAlign: 'right' }} className="mono">{c.totalLines}</td>
                              <td style={{ textAlign: 'right', color: c.discrepantLines > 0 ? '#b91c1c' : '#059669' }} className="mono">
                                {c.discrepantLines}
                              </td>
                              <td style={{ textAlign: 'right' }}>
                                <span
                                  className={`status-pill ${c.accuracyPct >= 95 ? 'green' : c.accuracyPct >= 85 ? 'amber' : 'red'
                                    }`}
                                >
                                  {c.accuracyPct}%
                                </span>
                              </td>
                              <td style={{ textAlign: 'right' }} className="mono">
                                <span style={{ color: c.netDiffUnits < 0 ? '#b91c1c' : c.netDiffUnits > 0 ? '#059669' : 'inherit' }}>
                                  {c.netDiffUnits > 0 ? `+${c.netDiffUnits.toFixed(1)}` : c.netDiffUnits.toFixed(1)}
                                </span>
                              </td>
                              {isAuthorizedForCost && (
                                <td style={{ textAlign: 'right' }} className="mono">
                                  {c.netVarianceValueMinor !== null ? (
                                    <span style={{ color: c.netVarianceValueMinor < 0 ? '#b91c1c' : c.netVarianceValueMinor > 0 ? '#059669' : 'inherit', fontWeight: 700 }}>
                                      {c.netVarianceValueMinor > 0 ? '+' : ''}₹{(c.netVarianceValueMinor / 100).toFixed(2)}
                                    </span>
                                  ) : (
                                    '--'
                                  )}
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>

                      {insights.auditVariance.adjustmentReasons.length > 0 && (
                        <div style={{ marginTop: '0.5rem', background: '#f8fafc', padding: '0.85rem', borderRadius: '6px', border: '1px solid var(--border)' }}>
                          <div style={{ fontWeight: 700, fontSize: '0.82rem', marginBottom: '0.5rem', color: 'var(--text-main)' }}>
                            Top Adjustment Reasons (Last 90 Days):
                          </div>
                          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                            {insights.auditVariance.adjustmentReasons.map((ar) => (
                              <span
                                key={ar.reason}
                                style={{
                                  background: '#ffffff',
                                  border: '1px solid var(--border)',
                                  padding: '0.25rem 0.6rem',
                                  borderRadius: '4px',
                                  fontSize: '0.78rem',
                                }}
                              >
                                <strong style={{ textTransform: 'capitalize' }}>{ar.reason.replace(/_/g, ' ')}</strong>: {ar.count} events ({ar.netChangeUnits > 0 ? '+' : ''}{ar.netChangeUnits.toFixed(1)} units)
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Stock Adjustment Modal */}
      {showAdjustmentModal && (
        <StockAdjustmentModal
          isOpen={showAdjustmentModal}
          onClose={() => setShowAdjustmentModal(false)}
          onSuccess={handleAdjustmentSuccess}
          items={items}
          preselectedItem={adjustmentTargetItem}
          userRole={userRole}
          allowNegativeStock={allowNegativeStock}
        />
      )}

      {/* Reorder Config Modal */}
      {showReorderModal && reorderTargetItem && (
        <ReorderConfigModal
          isOpen={showReorderModal}
          onClose={() => {
            setShowReorderModal(false);
            setReorderTargetItem(null);
          }}
          onSuccess={handleReorderSuccess}
          item={reorderTargetItem}
          suppliers={suppliers}
        />
      )}
    </div>
  );
};
