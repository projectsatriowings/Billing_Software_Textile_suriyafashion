import React, { useState, useEffect } from 'react';
import { getCachedView, setCachedView } from '../../utils/viewCache';
import {
  fetchDayClosingPreview,
  fetchDayClosingAudit,
  submitDayClosing,
  approveDayClosing,
  rejectDayClosing,
  reopenDayClosing,
  fetchDayClosingComparison,
  fetchDayClosingAnalytics,
  fetchDayClosingHistory,
  fetchCounterSalesReport,
  fetchCashierSalesReport,
  fetchDayClosingSchedules,
  saveDayClosingSchedule,
  fetchDayClosingCompliance,
  sendDayClosingReminder,
  fetchDayClosingNotifications,
  markDayClosingNotificationRead,
  markAllDayClosingNotificationsRead,
  withAuthToken,
  type User,
  type Shop,
  type SmartAuditResult,
  type SmartAuditIssue,
  type SmartAuditSeverity,
  type SmartAuditDetectorId,
} from '../../api.ts';
import {
  RupeeIcon,
  BanknoteIcon,
  CreditCardIcon,
  RefreshCwIcon,
  TrendingUpIcon,
  WalletIcon,
  ScaleIcon,
  ClockIcon,
  RotateCcwIcon,
  CheckCircle2Icon,
  AlertTriangleIcon,
  AlertOctagonIcon,
  FileTextIcon,
  FileSpreadsheetIcon,
  DownloadIcon,
  LockIcon,
  StoreIcon,
  ArrowDownLeftIcon,
  ArrowUpRightIcon,
  BarChart3Icon,
  PackageIcon,
  TagIcon,
  ReceiptIcon,
  Building2Icon,
  FilterIcon,
  CheckCircleIcon,
  PrinterIcon,
  InfoIcon,
  UserIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  LayersIcon,
  BellRingIcon,
  EyeIcon,
} from '../inventory/InventoryIcons.tsx';
import './dayClosing.css';

interface DayClosingViewProps {
  user: User;
  shop: Shop | null;
  selectedBranch?: string;
  branches?: any[];
  onNavigateToNotifications?: () => void;
}

type TabType = 'closing' | 'breakdown' | 'comparison' | 'analytics' | 'compliance' | 'history';

const ALL_DETECTORS: Array<{
  id: SmartAuditDetectorId;
  name: string;
  category: 'accuracy' | 'activity' | 'readiness';
  categoryLabel: string;
  description: string;
}> = [
  {
    id: 'cash_shortage',
    name: 'Cash Shortage Detector',
    category: 'accuracy',
    categoryLabel: 'Financial Accuracy',
    description: 'Compares expected closing cash with physical counted cash to detect and quantify cash drawer deficits.',
  },
  {
    id: 'cash_excess',
    name: 'Cash Excess Detector',
    category: 'accuracy',
    categoryLabel: 'Financial Accuracy',
    description: 'Identifies cash surplus in drawer above expected tender collections and opening floats.',
  },
  {
    id: 'sales_mismatch',
    name: 'Sales Mismatch Detector',
    category: 'accuracy',
    categoryLabel: 'Financial Accuracy',
    description: 'Cross-verifies individual invoice line-item pricing and GST tax calculations against header totals.',
  },
  {
    id: 'payment_mismatch',
    name: 'Payment Mismatch Detector',
    category: 'accuracy',
    categoryLabel: 'Financial Accuracy',
    description: 'Reconciles invoice settlement records against ledger receipts and detects orphan or split discrepancies.',
  },
  {
    id: 'duplicate_transactions',
    name: 'Duplicate Transaction Detector',
    category: 'accuracy',
    categoryLabel: 'Financial Accuracy',
    description: 'Identifies rapid identical billings (< 3 mins) and cross-invoice payment reference collisions.',
  },
  {
    id: 'missing_transactions',
    name: 'Missing Transaction Detector',
    category: 'accuracy',
    categoryLabel: 'Financial Accuracy',
    description: 'Detects business date attribution anomalies, unfinalized receipts, or cross-midnight timestamp drift.',
  },
  {
    id: 'unusual_refund',
    name: 'Unusual Refund Detector',
    category: 'activity',
    categoryLabel: 'Business Activity',
    description: 'Flags exceptional refund volumes, single credit notes ≥ ₹2,000, or refunds exceeding 150% average bill.',
  },
  {
    id: 'pending_bills',
    name: 'Pending Bill Detector',
    category: 'activity',
    categoryLabel: 'Business Activity',
    description: 'Identifies unsettled credit invoices and active unclosed cashier shifts prior to day sealing.',
  },
  {
    id: 'unusual_discount',
    name: 'Unusual Discount Detector',
    category: 'activity',
    categoryLabel: 'Business Activity',
    description: 'Monitors high-percentage (≥ 20%) or large nominal (≥ ₹500) promotional markdowns for audit review.',
  },
  {
    id: 'stock_sales_consistency',
    name: 'Stock & Sales Consistency Detector',
    category: 'activity',
    categoryLabel: 'Business Activity',
    description: 'Validates that completed inventory-tracked sales have corresponding stock deduction ledger entries.',
  },
  {
    id: 'unassigned_transactions',
    name: 'Unassigned Transaction Detector',
    category: 'activity',
    categoryLabel: 'Business Activity',
    description: 'Isolates transactions lacking confirmed Counter ID, Cashier ID, or Shift ID attribution.',
  },
  {
    id: 'closing_readiness',
    name: 'Closing Readiness Detector',
    category: 'readiness',
    categoryLabel: 'Closing Readiness',
    description: 'Aggregates all 11 diagnostic checks to formulate overall readiness score and definitive closing guidance.',
  },
];

export const DayClosingView: React.FC<DayClosingViewProps> = ({
  user,
  shop,
  selectedBranch,
  branches,
  onNavigateToNotifications,
}) => {
  // Navigation: Clean, dedicated tabs
  const [activeTab, setActiveTabRaw] = useState<TabType>(() => {
    try {
      const saved = localStorage.getItem('day_closing_active_tab');
      if (saved && ['closing', 'breakdown', 'comparison', 'analytics', 'compliance', 'history'].includes(saved)) {
        return saved as TabType;
      }
    } catch { }
    return 'closing';
  });
  const setActiveTab = (tab: TabType) => {
    setActiveTabRaw(tab);
    try { localStorage.setItem('day_closing_active_tab', tab); } catch { }
  };

  // Branch & Filter states
  const [selectedBranchId, setSelectedBranchId] = useState<string>(
    selectedBranch || (branches && branches[0]?.id) || 'MAIN'
  );
  const [selectedDate, setSelectedDate] = useState<string>(
    new Date().toISOString().slice(0, 10)
  );
  const [selectedShiftId, setSelectedShiftId] = useState<string>('');
  const [selectedCounterId, setSelectedCounterId] = useState<string>('');

  // Tab 1: Day Closing Live Preview & Reconciliation state
  const [loadingPreview, setLoadingPreview] = useState(true);
  const [preview, setPreview] = useState<any | null>(null);
  const previewLoadedRef = React.useRef(false);
  const [actualCashStr, setActualCashStr] = useState<string>('');
  const [closingRemarks, setClosingRemarks] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  // Smart Closing Audit & Detector Engine state
  const [auditData, setAuditData] = useState<SmartAuditResult | null>(null);
  const [auditExpanded, setAuditExpanded] = useState<boolean>(false);
  const [auditFilter, setAuditFilter] = useState<'all' | 'critical' | 'warning' | 'info' | 'detectors'>('all');
  const [expandedIssueIds, setExpandedIssueIds] = useState<Record<string, boolean>>({});
  const [reviewedIssueIds, setReviewedIssueIds] = useState<Record<string, boolean>>({});
  const [runningLiveAudit, setRunningLiveAudit] = useState<boolean>(false);

  // Tab: Counter & Cashier Sales Reports Breakdown
  const [breakdownSubTab, setBreakdownSubTab] = useState<'counter' | 'cashier'>('counter');
  const [counterSalesData, setCounterSalesData] = useState<any | null>(null);
  const [loadingCounterSales, setLoadingCounterSales] = useState(false);
  const [cashierSalesData, setCashierSalesData] = useState<any | null>(null);
  const [loadingCashierSales, setLoadingCashierSales] = useState(false);
  const [selectedCounterKeyFilter, setSelectedCounterKeyFilter] = useState<string>('ALL');
  const [counterDetailViewMode, setCounterDetailViewMode] = useState<'shifts' | 'cashiers'>('shifts');
  const [selectedDetailCashierFilter, setSelectedDetailCashierFilter] = useState<string>('ALL');
  const [expandedCounterKeys, setExpandedCounterKeys] = useState<Record<string, boolean>>({});
  const [showCounterAuditColumns, setShowCounterAuditColumns] = useState<boolean>(false);

  // Tab: Schedules & Compliance Monitoring
  const [complianceData, setComplianceData] = useState<any | null>(null);
  const [loadingCompliance, setLoadingCompliance] = useState(false);
  const [scheduleData, setScheduleData] = useState<any | null>(null);
  const [loadingSchedule, setLoadingSchedule] = useState(false);
  const [expClosingTime, setExpClosingTime] = useState('22:00');
  const [firstReminderMin, setFirstReminderMin] = useState<number>(30);
  const [secondReminderMin, setSecondReminderMin] = useState<number>(15);
  const [finalReminder, setFinalReminder] = useState<boolean>(true);
  const [overdueIntervalMin, setOverdueIntervalMin] = useState<number>(30);
  const [autoAlert, setAutoAlert] = useState<boolean>(true);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [sendingReminder, setSendingReminder] = useState(false);

  // In-app Notifications & Alerts
  const [notifications, setNotifications] = useState<any[]>([]);
  const [unreadNotifCount, setUnreadNotifCount] = useState<number>(0);
  const [showNotifDrawer, setShowNotifDrawer] = useState<boolean>(false);
  const [notifFilterTab, setNotifFilterTab] = useState<'all' | 'open' | 'close'>('all');

  // Tab 2: Comparison state
  const [comparisonData, setComparisonData] = useState<any | null>(null);
  const [loadingComparison, setLoadingComparison] = useState(false);

  // Tab 3: Custom Date Range Analytics state
  const [analyticsStartDate, setAnalyticsStartDate] = useState<string>(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
  });
  const [analyticsEndDate, setAnalyticsEndDate] = useState<string>(
    new Date().toISOString().slice(0, 10)
  );
  const [appliedAnalyticsRange, setAppliedAnalyticsRange] = useState<{ startDate: string; endDate: string }>(() => {
    const d = new Date();
    const start = new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
    const end = d.toISOString().slice(0, 10);
    return { startDate: start, endDate: end };
  });
  const [analyticsPreset, setAnalyticsPreset] = useState<string>('this_month');
  const [analyticsData, setAnalyticsData] = useState<any | null>(null);
  const [loadingAnalytics, setLoadingAnalytics] = useState(false);
  const [analyticsLoadingSource, setAnalyticsLoadingSource] = useState<'preset' | 'calculate' | 'header' | 'initial' | null>(null);
  const [activeLoadingPreset, setActiveLoadingPreset] = useState<string | null>(null);

  // Tab 4: History state
  const [history, setHistory] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(null);

  // Reopen Modal state
  const [isReopenModalOpen, setIsReopenModalOpen] = useState(false);
  const [reopenTargetId, setReopenTargetId] = useState<string>('');
  const [reopenReason, setReopenReason] = useState<string>('');
  const [reopenPin, setReopenPin] = useState<string>('');
  const [reopening, setReopening] = useState(false);

  // Reject / Recount Modal state
  const [isRejectModalOpen, setIsRejectModalOpen] = useState(false);
  const [rejectTargetId, setRejectTargetId] = useState<string>('');
  const [rejectReason, setRejectReason] = useState<string>('');
  const [rejecting, setRejecting] = useState(false);

  // Messages
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const activeBranchId = selectedBranchId || selectedBranch || 'MAIN';
  const userRole = String(user.role || '').toUpperCase();
  const isCashierUser = userRole === 'CASHIER' || userRole === 'COUNTER';
  const isManagerOrOwner = ['OWNER', 'SUPER_ADMIN', 'STORE_MANAGER', 'MANAGER'].includes(userRole);
  const isOwner = ['OWNER', 'SUPER_ADMIN'].includes(userRole);
  const isManager = userRole === 'MANAGER' || userRole === 'STORE_MANAGER';

  // Synchronize branch selection when parent props change
  useEffect(() => {
    if (selectedBranch && selectedBranch !== selectedBranchId) {
      setSelectedBranchId(selectedBranch);
    }
  }, [selectedBranch]);

  useEffect(() => {
    if (isCashierUser && activeTab !== 'closing') {
      setActiveTab('closing');
    }
  }, [isCashierUser, activeTab]);

  const [selectedCashierId, setSelectedCashierId] = useState<string>(() => {
    return isCashierUser ? user.id : '';
  });

  useEffect(() => {
    if (isCashierUser && selectedCashierId !== user.id) {
      setSelectedCashierId(user.id);
    }
  }, [user.id, isCashierUser]);

  const fmt = (minor: number = 0) =>
    `₹${((minor || 0) / 100).toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;

  const fmtDateTime = (iso: string | null | undefined) => {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return '—';
      return d.toLocaleString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      });
    } catch {
      return '—';
    }
  };

  const fmtDuration = (startIso: string, endIso: string | null | undefined) => {
    if (!startIso) return '—';
    try {
      const start = new Date(startIso).getTime();
      const end = endIso ? new Date(endIso).getTime() : Date.now();
      const diffSec = Math.max(0, Math.floor((end - start) / 1000));
      const hours = Math.floor(diffSec / 3600);
      const mins = Math.floor((diffSec % 3600) / 60);
      const secs = diffSec % 60;
      if (hours === 0 && mins === 0) return `${secs}s`;
      if (hours === 0) return `${mins}m ${secs}s`;
      return `${hours}h ${mins}m`;
    } catch {
      return '—';
    }
  };

  // --------------------------------------------------------------------------
  // Data Fetchers
  // --------------------------------------------------------------------------
  const applyPreview = (res: any) => {
      setPreview(res);
      if (res.closedRecord?.audit_summary && Object.keys(res.closedRecord.audit_summary).length > 0) {
        setAuditData(res.closedRecord.audit_summary);
      } else if (res.audit) {
        setAuditData(res.audit);
      }
      const expected = res.cashReconciliation?.expectedClosingCashMinor ?? 0;
      if (res.status === 'open' || res.status === 'reopened') {
        setActualCashStr(((expected || 0) / 100).toFixed(2));
        setClosingRemarks(res.closedRecord?.remarks || '');
      } else if (res.closedRecord?.actual_cash_minor != null) {
        setActualCashStr((res.closedRecord.actual_cash_minor / 100).toFixed(2));
        setClosingRemarks(res.closedRecord.remarks || '');
      } else {
        setActualCashStr(((expected || 0) / 100).toFixed(2));
      }
  };

  const loadPreview = async () => {
    const params = {
      branchId: activeBranchId,
      date: selectedDate,
      shiftId: selectedShiftId || undefined,
      cashierId: selectedCashierId || undefined,
      counterId: selectedCounterId || undefined,
    };
    const cacheKey = `day-closing-preview:${JSON.stringify(params)}`;
    // On opening the page, show the last loaded figures instantly, then refresh them in the
    // background. Later reloads (after submit/approve/filters) always wait for fresh data.
    const cached = previewLoadedRef.current ? undefined : getCachedView<any>(cacheKey);
    previewLoadedRef.current = true;
    if (cached) {
      applyPreview(cached);
      setLoadingPreview(false);
    }
    try {
      if (!cached) setLoadingPreview(true);
      setError(null);
      const res = await fetchDayClosingPreview(params);
      setCachedView(cacheKey, res);
      applyPreview(res);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch day closing preview');
    } finally {
      setLoadingPreview(false);
    }
  };

  const handleRunLiveAudit = async (customActualCash?: number) => {
    try {
      setRunningLiveAudit(true);
      const actualVal = customActualCash !== undefined
        ? customActualCash
        : Math.round((parseFloat(actualCashStr) || 0) * 100);

      const res = await fetchDayClosingAudit({
        branchId: activeBranchId,
        date: selectedDate,
        shiftId: selectedShiftId || undefined,
        cashierId: selectedCashierId || undefined,
        counterId: selectedCounterId || undefined,
        actualCashMinor: actualVal,
      });
      if (res.success && res.audit) {
        setAuditData(res.audit);
      }
    } catch (err: any) {
      console.error('Failed to run live audit:', err);
    } finally {
      setRunningLiveAudit(false);
    }
  };

  const toggleIssueReviewed = (issueId: string) => {
    setReviewedIssueIds(prev => ({
      ...prev,
      [issueId]: !prev[issueId],
    }));
  };

  const toggleIssueExpanded = (issueId: string) => {
    setExpandedIssueIds(prev => ({
      ...prev,
      [issueId]: !prev[issueId],
    }));
  };

  const filteredAuditIssues = React.useMemo(() => {
    if (!auditData?.issues) return [];
    if (auditFilter === 'all') return auditData.issues;
    if (auditFilter === 'critical') return auditData.issues.filter(i => i.severity === 'critical');
    if (auditFilter === 'warning') return auditData.issues.filter(i => i.severity === 'warning');
    if (auditFilter === 'info') return auditData.issues.filter(i => i.severity === 'info');
    return auditData.issues;
  }, [auditData, auditFilter]);

  const loadNotifications = async () => {
    if (user?.role === 'cashier') return;
    try {
      const res = await fetchDayClosingNotifications({ branchId: activeBranchId });
      if (res.success) {
        setNotifications(res.notifications || []);
        setUnreadNotifCount(res.unreadCount || 0);
      }
    } catch {
      // background silent catch
    }
  };

  const handleDismissNotification = async (notifId: string) => {
    try {
      await markDayClosingNotificationRead(notifId);
      setNotifications(prev => prev.filter(n => n.id !== notifId));
      setUnreadNotifCount(prev => Math.max(0, prev - 1));
    } catch {
      // ignore
    }
  };

  const handleMarkAllNotificationsRead = async () => {
    try {
      const unreadIds = notifications
        .filter(n => !n.isRead && !n.is_read)
        .map(n => n.id)
        .filter(Boolean);
      await markAllDayClosingNotificationsRead(unreadIds.length > 0 ? unreadIds : undefined);
      setNotifications(prev => prev.map(n => ({ ...n, isRead: true, is_read: true })));
      setUnreadNotifCount(0);
    } catch {
      // ignore
    }
  };

  const formatTimeAgo = (dateStr?: string) => {
    if (!dateStr) return 'Just now';
    const time = new Date(dateStr).getTime();
    if (isNaN(time)) return 'Just now';
    const diff = Math.max(0, Date.now() - time);
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  const loadCounterSales = async () => {
    try {
      setLoadingCounterSales(true);
      setError(null);
      const res = await fetchCounterSalesReport({
        branchId: activeBranchId,
        date: selectedDate,
      });
      setCounterSalesData(res);
    } catch (err: any) {
      setError(err.message || 'Failed to load counter sales report');
    } finally {
      setLoadingCounterSales(false);
    }
  };

  const loadCashierSales = async () => {
    try {
      setLoadingCashierSales(true);
      setError(null);
      const res = await fetchCashierSalesReport({
        branchId: activeBranchId,
        date: selectedDate,
      });
      setCashierSalesData(res);
    } catch (err: any) {
      setError(err.message || 'Failed to load cashier sales report');
    } finally {
      setLoadingCashierSales(false);
    }
  };

  const loadCompliance = async () => {
    try {
      setLoadingCompliance(true);
      setError(null);
      const res = await fetchDayClosingCompliance({
        branchId: activeBranchId,
        date: selectedDate,
      });
      setComplianceData(res);
    } catch (err: any) {
      setError(err.message || 'Failed to load closing compliance');
    } finally {
      setLoadingCompliance(false);
    }
  };

  const loadSchedule = async () => {
    try {
      setLoadingSchedule(true);
      const res = await fetchDayClosingSchedules(activeBranchId);
      if (res.success && res.schedule) {
        setScheduleData(res.schedule);
        setExpClosingTime(res.schedule.expectedClosingTime || res.schedule.expected_closing_time || '22:00');
        setFirstReminderMin(res.schedule.firstReminderMinutesBefore ?? res.schedule.first_reminder_minutes_before ?? 30);
        setSecondReminderMin(res.schedule.secondReminderMinutesBefore ?? res.schedule.second_reminder_minutes_before ?? 15);
        setFinalReminder(res.schedule.finalReminderAtClosing ?? res.schedule.final_reminder_at_closing ?? true);
        setOverdueIntervalMin(res.schedule.overdueReminderIntervalMinutes ?? res.schedule.overdue_reminder_interval_minutes ?? 30);
        setAutoAlert(res.schedule.autoAlertOverdue ?? res.schedule.auto_alert_overdue ?? true);
      }
    } catch {
      // ignore
    } finally {
      setLoadingSchedule(false);
    }
  };

  const handleSaveSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSavingSchedule(true);
      setError(null);
      await saveDayClosingSchedule({
        branchId: activeBranchId,
        expectedClosingTime: expClosingTime,
        firstReminderMinutesBefore: firstReminderMin,
        secondReminderMinutesBefore: secondReminderMin,
        finalReminderAtClosing: finalReminder,
        overdueReminderIntervalMinutes: overdueIntervalMin,
        autoAlertOverdue: autoAlert,
        enabled: true,
      });
      setSuccessMsg('Closing schedule and reminder settings saved successfully.');
      window.dispatchEvent(new Event('day_closing_updated'));
      loadSchedule();
      loadCompliance();
    } catch (err: any) {
      setError(err.message || 'Failed to save schedule settings');
    } finally {
      setSavingSchedule(false);
    }
  };

  const handleSendReminder = async (cashierId?: string | null) => {
    try {
      setSendingReminder(true);
      setError(null);
      const res = await sendDayClosingReminder({
        branchId: activeBranchId,
        cashierId: cashierId || null,
        date: selectedDate,
        reminderType: 'manual',
        message: `Management Reminder: Please count physical cash and submit your register reconciliation for ${selectedDate}.`,
      });
      setSuccessMsg(res.message || 'Closing reminder sent successfully.');
      loadCompliance();
      loadNotifications();
    } catch (err: any) {
      setError(err.message || 'Failed to send closing reminder');
    } finally {
      setSendingReminder(false);
    }
  };

  const handleExportCounterCsv = () => {
    if (!counterSalesData?.counters?.length) return;
    const header = [
      'Counter Code',
      'Counter Name',
      'Is Exception',
      'Invoices Count',
      'Returns Count',
      'Gross Sales (Rs)',
      'Discounts (Rs)',
      'Returns Value (Rs)',
      'Net Sales (Rs)',
      'Taxable Sales (Rs)',
      'GST Collected (Rs)',
      'COGS (Rs)',
      'Gross Profit (Rs)',
      'Margin %',
      'Credit Sales (Rs)',
      'Cash Collections (Rs)',
      'UPI Collections (Rs)',
      'Card Collections (Rs)',
      'Total Collections (Rs)',
    ];
    const escapeCsv = (str: any) => `"${String(str ?? '').replace(/"/g, '""')}"`;
    const rows = counterSalesData.counters.map((c: any) => [
      c.counterCode,
      c.counterName,
      c.isException ? 'YES (UNASSIGNED)' : 'NO',
      c.invoicesCount,
      c.returnsCount,
      (c.grossSalesMinor / 100).toFixed(2),
      (c.discountsTotalMinor / 100).toFixed(2),
      (c.returnsTotalMinor / 100).toFixed(2),
      (c.netSalesMinor / 100).toFixed(2),
      (c.taxableSalesMinor / 100).toFixed(2),
      (c.gstCollectedMinor / 100).toFixed(2),
      (c.netCogsMinor / 100).toFixed(2),
      (c.grossProfitMinor / 100).toFixed(2),
      c.marginPct + '%',
      (c.creditSalesMinor / 100).toFixed(2),
      (c.collections.cash / 100).toFixed(2),
      (c.collections.upi / 100).toFixed(2),
      (c.collections.card / 100).toFixed(2),
      (c.collections.total / 100).toFixed(2),
    ]);
    const csv = [header, ...rows].map(r => r.map(escapeCsv).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `Counter_Sales_Report_${selectedDate}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleExportCashierCsv = () => {
    if (!cashierSalesData?.cashiers?.length) return;
    const header = [
      'Cashier Name',
      'Role',
      'Closing Status',
      'Is Exception',
      'Invoices Count',
      'Returns Count',
      'Gross Sales (Rs)',
      'Discounts (Rs)',
      'Returns Value (Rs)',
      'Net Sales (Rs)',
      'Taxable Sales (Rs)',
      'GST Collected (Rs)',
      'COGS (Rs)',
      'Gross Profit (Rs)',
      'Margin %',
      'Credit Sales (Rs)',
      'Cash Collections (Rs)',
      'UPI Collections (Rs)',
      'Card Collections (Rs)',
      'Total Collections (Rs)',
      'Actual Cash (Rs)',
      'Expected Cash (Rs)',
      'Cash Difference (Rs)',
    ];
    const escapeCsv = (str: any) => `"${String(str ?? '').replace(/"/g, '""')}"`;
    const rows = cashierSalesData.cashiers.map((c: any) => [
      c.cashierName,
      c.cashierRole,
      c.closingStatus,
      c.isException ? 'YES (UNASSIGNED)' : 'NO',
      c.invoicesCount,
      c.returnsCount,
      (c.grossSalesMinor / 100).toFixed(2),
      (c.discountsTotalMinor / 100).toFixed(2),
      (c.returnsTotalMinor / 100).toFixed(2),
      (c.netSalesMinor / 100).toFixed(2),
      (c.taxableSalesMinor / 100).toFixed(2),
      (c.gstCollectedMinor / 100).toFixed(2),
      (c.netCogsMinor / 100).toFixed(2),
      (c.grossProfitMinor / 100).toFixed(2),
      c.marginPct + '%',
      (c.creditSalesMinor / 100).toFixed(2),
      (c.collections.cash / 100).toFixed(2),
      (c.collections.upi / 100).toFixed(2),
      (c.collections.card / 100).toFixed(2),
      (c.collections.total / 100).toFixed(2),
      c.actualCashMinor != null ? (c.actualCashMinor / 100).toFixed(2) : '—',
      c.expectedCashMinor != null ? (c.expectedCashMinor / 100).toFixed(2) : '—',
      c.varianceMinor != null ? (c.varianceMinor / 100).toFixed(2) : '—',
    ]);
    const csv = [header, ...rows].map(r => r.map(escapeCsv).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `Cashier_Sales_Report_${selectedDate}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const loadComparison = async () => {
    try {
      setLoadingComparison(true);
      setError(null);
      const res = await fetchDayClosingComparison({
        branchId: activeBranchId,
        date: selectedDate,
      });
      setComparisonData(res);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch sales comparison');
    } finally {
      setLoadingComparison(false);
    }
  };

  const loadAnalytics = async (
    overrideStartDate?: string,
    overrideEndDate?: string,
    source: 'preset' | 'calculate' | 'header' | 'initial' = 'initial'
  ) => {
    const sDate = overrideStartDate ?? analyticsStartDate;
    const eDate = overrideEndDate ?? analyticsEndDate;
    if (sDate && eDate && sDate > eDate) {
      setError('Start Date cannot be after End Date.');
      return;
    }
    try {
      setLoadingAnalytics(true);
      setAnalyticsLoadingSource(source);
      setError(null);
      setAppliedAnalyticsRange({ startDate: sDate, endDate: eDate });
      const res = await fetchDayClosingAnalytics({
        branchId: activeBranchId,
        startDate: sDate,
        endDate: eDate,
      });
      setAnalyticsData(res);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch date range analytics');
    } finally {
      setLoadingAnalytics(false);
      setAnalyticsLoadingSource(null);
      setActiveLoadingPreset(null);
    }
  };

  const loadHistory = async () => {
    try {
      setLoadingHistory(true);
      setError(null);
      const res = await fetchDayClosingHistory({
        branchId: activeBranchId,
        limit: 50,
      });
      setHistory(res?.history || []);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch closing history');
    } finally {
      setLoadingHistory(false);
    }
  };

  useEffect(() => {
    loadNotifications();
  }, [activeBranchId]);

  useEffect(() => {
    if (activeTab === 'closing') {
      loadPreview();
    } else if (activeTab === 'breakdown') {
      loadCounterSales();
      loadCashierSales();
    } else if (activeTab === 'comparison') {
      loadComparison();
    } else if (activeTab === 'analytics') {
      loadAnalytics();
    } else if (activeTab === 'compliance') {
      loadCompliance();
      loadSchedule();
    } else if (activeTab === 'history') {
      loadHistory();
    }
  }, [activeBranchId, selectedDate, selectedShiftId, selectedCashierId, selectedCounterId, activeTab]);

  const handleApplyPreset = (preset: string) => {
    setAnalyticsPreset(preset);
    setActiveLoadingPreset(preset);
    const d = new Date();
    const todayStr = d.toISOString().slice(0, 10);

    let start = todayStr;
    let end = todayStr;

    if (preset === 'today') {
      start = todayStr;
      end = todayStr;
    } else if (preset === 'yesterday') {
      const y = new Date(d.getTime() - 86400000).toISOString().slice(0, 10);
      start = y;
      end = y;
    } else if (preset === 'last_7_days') {
      const s = new Date(d.getTime() - 6 * 86400000).toISOString().slice(0, 10);
      start = s;
      end = todayStr;
    } else if (preset === 'last_30_days') {
      const s = new Date(d.getTime() - 29 * 86400000).toISOString().slice(0, 10);
      start = s;
      end = todayStr;
    } else if (preset === 'this_month') {
      start = new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
      end = todayStr;
    } else if (preset === 'last_month') {
      start = new Date(d.getFullYear(), d.getMonth() - 1, 1).toISOString().slice(0, 10);
      end = new Date(d.getFullYear(), d.getMonth(), 0).toISOString().slice(0, 10);
    }

    setAnalyticsStartDate(start);
    setAnalyticsEndDate(end);

    // Immediately fetch & display data on preset click without requiring Calculate Range
    loadAnalytics(start, end, 'preset');
  };

  // --------------------------------------------------------------------------
  // Action Handlers
  // --------------------------------------------------------------------------
  const handleSubmitClosing = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!preview) return;

    if (preview.status === 'approved' || preview.status === 'closed') {
      alert('This business date is already approved and sealed.');
      return;
    }

    if (isNaN(parseFloat(actualCashStr))) {
      alert('Please enter a valid actual closing cash amount.');
      return;
    }

    const actualCashMinor = Math.round((parseFloat(actualCashStr) || 0) * 100);
    const expectedCashMinor = preview.cashReconciliation?.expectedClosingCashMinor || 0;
    const diffMinor = actualCashMinor - expectedCashMinor;

    // Discrepancy explanation mandatory if there is cash variance
    if (Math.abs(diffMinor) > 0 && closingRemarks.trim().length < 3) {
      alert(`Cash difference of ${diffMinor >= 0 ? '+' : ''}${fmt(diffMinor)} detected.\n\nPlease provide a brief discrepancy reason in the remarks field before submitting.`);
      return;
    }

    const confirmMsg =
      `Submit Day Closing for ${preview.bdate || selectedDate}?\n\n` +
      `Expected Cash: ${fmt(expectedCashMinor)}\n` +
      `Counted Cash:  ${fmt(actualCashMinor)}\n` +
      `Difference:    ${diffMinor >= 0 ? '+' : ''}${fmt(diffMinor)}\n\n` +
      `This will seal today's register and record cash drawer floats.`;

    if (!window.confirm(confirmMsg)) return;

    try {
      setSubmitting(true);
      setError(null);
      const res = await submitDayClosing({
        branchId: activeBranchId,
        date: preview.bdate || selectedDate,
        shiftId: selectedShiftId || undefined,
        cashierId: selectedCashierId || undefined,
        counterId: selectedCounterId || undefined,
        status: isCashierUser ? 'submitted' : undefined,
        actualCashMinor,
        remarks: closingRemarks.trim(),
        auditSummary: auditData || preview?.audit,
      });
      setSuccessMsg(`Day closing submitted successfully! Reference: ${res.dayClosing?.id || 'OK'}`);
      window.dispatchEvent(new Event('day_closing_submitted'));
      await loadPreview();
    } catch (err: any) {
      setError(err.message || 'Failed to submit day closing');
    } finally {
      setSubmitting(false);
    }
  };

  const handleApproveClosing = async (closingId: string) => {
    if (!window.confirm('Approve and permanently lock this day closing? All transactions on this date will be sealed.')) return;
    try {
      setActionLoading(true);
      setError(null);
      await approveDayClosing(closingId);
      setSuccessMsg('Day closing approved and locked successfully!');
      window.dispatchEvent(new Event('day_closing_updated'));
      await loadPreview();
      await loadHistory();
    } catch (err: any) {
      setError(err.message || 'Failed to approve day closing');
    } finally {
      setActionLoading(false);
    }
  };

  const handleOpenReopenModal = (closingId: string) => {
    setReopenTargetId(closingId);
    setReopenReason('');
    setReopenPin('');
    setIsReopenModalOpen(true);
  };

  const handleConfirmReopen = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reopenTargetId) return;
    if (reopenReason.trim().length < 5) {
      alert('Please provide a meaningful reason (at least 5 characters) for reopening.');
      return;
    }
    if (isManager && !reopenPin.trim()) {
      alert('Security PIN or password is required for Manager reopening authorization.');
      return;
    }

    try {
      setReopening(true);
      setError(null);
      await reopenDayClosing(reopenTargetId, reopenReason.trim(), reopenPin.trim() || undefined);
      setSuccessMsg('Business day has been reopened. Invoices unlocked for correction.');
      setIsReopenModalOpen(false);
      window.dispatchEvent(new Event('day_closing_updated'));
      await loadPreview();
      await loadHistory();
    } catch (err: any) {
      setError(err.message || 'Failed to reopen day closing');
    } finally {
      setReopening(false);
    }
  };

  const handleOpenRejectModal = (closingId: string) => {
    setRejectTargetId(closingId);
    setRejectReason('');
    setIsRejectModalOpen(true);
  };

  const handleConfirmReject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectTargetId) return;
    if (rejectReason.trim().length < 5) {
      alert('Please provide a specific reason for rejection / recount (at least 5 characters).');
      return;
    }

    try {
      setRejecting(true);
      setError(null);
      await rejectDayClosing(rejectTargetId, rejectReason.trim());
      setSuccessMsg('Day closing returned to Cashier for recount and correction.');
      setIsRejectModalOpen(false);
      window.dispatchEvent(new Event('day_closing_updated'));
      await loadPreview();
      await loadHistory();
    } catch (err: any) {
      setError(err.message || 'Failed to reject day closing');
    } finally {
      setRejecting(false);
    }
  };

  const handlePrint = (closingId: string) => {
    const tid = shop?.id || preview?.closedRecord?.tenant_id || preview?.closedRecord?.tenantId || '';
    const query = tid ? `?tenantId=${encodeURIComponent(tid)}` : '';
    window.open(withAuthToken(`/api/day-closing/${closingId}/print${query}`), '_blank', 'width=950,height=800');
  };

  const handleExportCsv = (closingId?: string) => {
    if (closingId) {
      window.open(withAuthToken(`/api/day-closing/${closingId}/export.csv`), '_blank');
    } else {
      window.open(withAuthToken(`/api/day-closing/history/export.csv?branchId=${encodeURIComponent(activeBranchId)}`), '_blank');
    }
  };

  // Computed values from preview
  const sales = preview?.salesSummary || {
    grossSalesMinor: 0,
    totalDiscountsMinor: 0,
    returnsTotalMinor: 0,
    netSalesMinor: 0,
    gstCollectedMinor: 0,
    invoicesCount: 0,
    cancelledInvoicesCount: 0,
    averageBillValueMinor: 0,
    totalProductsSold: 0,
    totalQuantitiesSold: 0,
    totalCustomersBilled: 0,
    newCustomersCount: 0,
    customerCreditBalanceMinor: 0,
  };

  const returns = preview?.returnSummary || {
    totalReturnsCount: 0,
    totalReturnValueMinor: 0,
    cashRefundsPaidMinor: 0,
    upiRefundsPaidMinor: 0,
    totalRefundsPaidMinor: 0,
    exchangeCreditAdjustedMinor: 0,
    storeCreditsIssuedMinor: 0,
  };

  const exchanges = preview?.exchangeSummary || {
    exchangesCount: 0,
    exchangeAdjustedMinor: 0,
    newProductsSoldMinor: 0,
    remainingCustomerCreditMinor: 0,
  };

  const payments = preview?.paymentSummary || {
    cashCollectionsMinor: 0,
    upiCollectionsMinor: 0,
    cardCollectionsMinor: 0,
    storeCreditMinor: 0,
  };

  const profit = preview?.profitSummary || {
    netSalesMinor: 0,
    netCogsMinor: 0,
    grossProfitMinor: 0,
    operatingExpensesMinor: 0,
    netProfitMinor: 0,
  };

  const cashRec = preview?.cashReconciliation || {
    openingCashMinor: 0,
    cashSalesReceivedMinor: 0,
    cashRefundsPaidMinor: 0,
    cashInMinor: 0,
    cashOutMinor: 0,
    cashExpensesMinor: 0,
    expectedClosingCashMinor: 0,
  };

  const marginPct = sales.netSalesMinor > 0
    ? (profit.grossProfitMinor / sales.netSalesMinor) * 100
    : 0;

  const operatingMarginPct = sales.netSalesMinor > 0
    ? (profit.netProfitMinor / sales.netSalesMinor) * 100
    : 0;

  const actualCashMinor = Math.round((parseFloat(actualCashStr) || 0) * 100);
  const expectedCashMinor = cashRec.expectedClosingCashMinor || 0;
  const cashDifferenceMinor = actualCashMinor - expectedCashMinor;

  const closingStatus = preview?.status || (preview?.isClosed ? 'closed' : 'open');
  const closedRecord = preview?.closedRecord || null;

  return (
    <div className="day-closing-wrapper bento-theme-wrapper">
      {/* --------------------------------------------------------------------
          1. Master Bento Command Hero Deck (Consolidated Header & Controls)
          -------------------------------------------------------------------- */}
      <div className="cat-bento-header-card bento-card-3d day-closing-bento-hero">
        <div className="bento-hero-gradient-bar" />
        <div className="day-closing-header-content">
          <div className="cat-bento-title-group">
            <div className="cat-bento-icon-box">
              <LockIcon size={24} />
            </div>
            <div>
              <div className="cat-bento-title-row">
                <h1 className="cat-bento-title">Day Closing & Register Reconciliation</h1>
                <span className={`cat-badge-live-sync ${closingStatus}`}>
                  <span className="live-indicator-dot" />
                  {closingStatus === 'open' && 'REGISTER OPEN • ACTIVE TRADING'}
                  {closingStatus === 'submitted' && 'DAY CLOSING SUBMITTED'}
                  {closingStatus === 'approved' && 'DAY CLOSING SEALED'}
                  {closingStatus === 'closed' && 'DAY CLOSING CLOSED'}
                  {closingStatus === 'reopened' && 'REOPENED FOR AUDIT'}
                </span>
              </div>
              <p className="cat-bento-subtitle">
                Audit daily sales, returns, cash drawer floats, and seal register transactions
                {shop?.name && <span> • Organization: <strong>{shop.name}</strong></span>}
              </p>
            </div>
          </div>

          <div className="cat-bento-header-actions">
            {user?.role !== 'cashier' && (
              <button
                type="button"
                onClick={() => {
                  if (onNavigateToNotifications) {
                    onNavigateToNotifications();
                  } else {
                    setShowNotifDrawer(true);
                  }
                }}
                className="cat-btn-outline day-closing-notif-hero-btn"
                title="Open Shift Notifications"
              >
                <BellRingIcon size={14} />
                <span>Shift Notifications</span>
                {unreadNotifCount > 0 ? (
                  <span className="day-closing-notif-counter-pill red">{unreadNotifCount} new</span>
                ) : notifications.length > 0 ? (
                  <span className="day-closing-notif-counter-pill teal">{notifications.length}</span>
                ) : null}
              </button>
            )}

            {closedRecord?.id && (
              <>
                <button
                  type="button"
                  onClick={() => handlePrint(closedRecord.id)}
                  className="cat-btn-outline"
                  title="Print Official Closing Statement"
                >
                  <PrinterIcon size={14} />
                  <span>Print Statement</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleExportCsv(closedRecord.id)}
                  className="cat-btn-outline"
                  title="Download closing details in Excel CSV format"
                >
                  <FileSpreadsheetIcon size={14} />
                  <span>Export CSV</span>
                </button>
              </>
            )}

            <button
              type="button"
              onClick={() => {
                if (activeTab === 'closing') loadPreview();
                else if (activeTab === 'comparison') loadComparison();
                else if (activeTab === 'analytics') loadAnalytics(undefined, undefined, 'header');
                else if (activeTab === 'history') loadHistory();
              }}
              disabled={loadingPreview || loadingComparison || (loadingAnalytics && analyticsLoadingSource === 'header') || loadingHistory}
              className="cat-btn-primary"
            >
              <RefreshCwIcon size={14} className={(loadingPreview || loadingComparison || (loadingAnalytics && analyticsLoadingSource === 'header') || loadingHistory) ? 'animate-spin' : ''} />
              <span>Refresh</span>
            </button>
          </div>
        </div>

        {/* Integrated Context & Filter Controls inside Hero Deck */}
        <div className="bento-hero-context-bar">
          <div className="bento-hero-context-left">
            {branches && branches.length > 0 && !isCashierUser ? (
              <div className="bento-context-select-item">
                <Building2Icon size={14} />
                <select
                  value={activeBranchId}
                  onChange={(e) => setSelectedBranchId(e.target.value)}
                  className="bento-select"
                  title="Active Branch"
                >
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} ({b.code || b.id})
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <span className="bento-context-chip" title="Assigned Branch">
                <Building2Icon size={14} />
                <span>{branches?.find((b: any) => b.id === activeBranchId)?.name || activeBranchId || 'Main Branch'}</span>
              </span>
            )}

            {!isCashierUser && (activeTab === 'closing' || activeTab === 'comparison') ? (
              <div className="bento-context-select-item">
                <ClockIcon size={14} />
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="bento-input-date"
                  title="Business Date"
                />
              </div>
            ) : (
              <span className="bento-context-chip" title="Business Date">
                <ClockIcon size={14} />
                <span>{selectedDate}</span>
              </span>
            )}

            {!isCashierUser && activeTab === 'closing' ? (
              <div className="bento-context-select-item">
                <UserIcon size={14} />
                <select
                  value={selectedCashierId}
                  onChange={(e) => {
                    setSelectedCashierId(e.target.value);
                    setActualCashStr('');
                    setClosingRemarks('');
                  }}
                  className="bento-select"
                  title="Cashier / Counter Register"
                >
                  <option value="">All Cashiers (Store-wide)</option>
                  {preview?.availableCashiers?.map((c: any) => (
                    <option key={c.id} value={c.id}>
                      Cashier: {c.name} {c.role ? `(${c.role})` : ''}
                    </option>
                  ))}
                </select>
                {selectedCashierId && (
                  <button
                    type="button"
                    onClick={() => setSelectedCashierId('')}
                    className="bento-chip-clear-btn"
                    title="Reset to store-wide"
                  >
                    ✕
                  </button>
                )}
              </div>
            ) : (
              <span className="bento-context-chip" title="Cashier Register">
                <UserIcon size={14} />
                <span>Cashier: {user.name}</span>
              </span>
            )}

            {activeTab === 'closing' && preview?.availableShifts && preview.availableShifts.length > 0 && (
              <div className="bento-context-select-item">
                <FilterIcon size={14} />
                <select
                  value={selectedShiftId}
                  onChange={(e) => setSelectedShiftId(e.target.value)}
                  className="bento-select"
                  title="Shift Filter"
                >
                  <option value="">All Shifts (Consolidated Full Day)</option>
                  {preview.availableShifts.map((s: any) => (
                    <option key={s.id} value={s.id}>
                      Shift {s.shift_number || s.id.slice(0, 6)} ({s.cashier_name || 'Cashier'})
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {!isCashierUser && activeTab === 'closing' && (
            <button
              type="button"
              onClick={() => setActiveTab('breakdown')}
              className="bento-breakdown-shortcut-btn"
              title="View Multi-Counter & Cashier Breakdown Reports"
            >
              <LayersIcon size={13} />
              <span>Counter Breakdown</span>
              <ArrowRightIcon size={12} />
            </button>
          )}
        </div>

        {/* Multi-Tab Navigation Bar (Rendered ONLY if Manager/Owner) */}
        {!isCashierUser && (
          <div className="bento-hero-tabs-segment">
            <button
              onClick={() => setActiveTab('closing')}
              className={`bento-hero-tab ${activeTab === 'closing' ? 'active' : ''}`}
            >
              <LockIcon size={14} />
              <span>Register Closing</span>
            </button>
            <button
              onClick={() => setActiveTab('breakdown')}
              className={`bento-hero-tab ${activeTab === 'breakdown' ? 'active' : ''}`}
            >
              <FileSpreadsheetIcon size={14} />
              <span>Counter & Cashier Reports</span>
            </button>
            <button
              onClick={() => setActiveTab('comparison')}
              className={`bento-hero-tab ${activeTab === 'comparison' ? 'active' : ''}`}
            >
              <ScaleIcon size={14} />
              <span>Comparison</span>
            </button>
            <button
              onClick={() => setActiveTab('analytics')}
              className={`bento-hero-tab ${activeTab === 'analytics' ? 'active' : ''}`}
            >
              <BarChart3Icon size={14} />
              <span>Analytics</span>
            </button>
            <button
              onClick={() => setActiveTab('compliance')}
              className={`bento-hero-tab ${activeTab === 'compliance' ? 'active' : ''}`}
            >
              <CheckCircleIcon size={14} />
              <span>Compliance</span>
            </button>
            <button
              onClick={() => setActiveTab('history')}
              className={`bento-hero-tab ${activeTab === 'history' ? 'active' : ''}`}
            >
              <ClockIcon size={14} />
              <span>Audit History</span>
            </button>
          </div>
        )}
      </div>

      {/* General System Alerts */}
      {error && (
        <div className="day-closing-alert error bento-card-3d">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <AlertTriangleIcon size={18} />
            <span><strong>Error:</strong> {error}</span>
          </div>
          <button onClick={() => setError(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontWeight: 'bold', color: '#b91c1c' }}>✕</button>
        </div>
      )}

      {successMsg && (
        <div className="day-closing-alert success bento-card-3d">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <CheckCircle2Icon size={18} />
            <span><strong>Success:</strong> {successMsg}</span>
          </div>
          <button onClick={() => setSuccessMsg(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontWeight: 'bold', color: '#047857' }}>✕</button>
        </div>
      )}

      {/* ====================================================================
          TAB 1: REGISTER CLOSING & CASH RECONCILIATION
          ==================================================================== */}
      {activeTab === 'closing' && (
        <>
          {/* ====================================================================
              ROW 2: DUAL-CARD BENTO DIAGNOSTICS & OPERATIONS DECK (7:5)
              ==================================================================== */}
          <div className="bento-diagnostics-deck">
            {/* 2A: Smart Closing Audit Radar (Col span 7) */}
            <div className="day-closing-card bento-card-3d bento-audit-deck-card">
              <div className="day-closing-card-header">
                <div className="day-closing-card-title-group">
                  <div className="day-closing-card-icon-bubble green">
                    <ShieldCheckIcon size={18} />
                  </div>
                  <div>
                    <span className="bento-deck-card-title">Smart Closing Audit Radar</span>
                    <span className="bento-deck-card-sub">12 Multi-point Financial & Anomaly Detectors</span>
                  </div>
                </div>

                <div className="bento-audit-header-actions">
                  {auditData && (
                    <div className={`smart-audit-status-badge ${auditData.readinessStatus}`}>
                      {auditData.readinessStatus === 'ready_to_submit' ? (
                        <ShieldCheckIcon size={14} />
                      ) : (
                        <ShieldAlertIcon size={14} />
                      )}
                      <span>
                        {auditData.readinessStatus === 'ready_to_submit' && 'Ready to Submit'}
                        {auditData.readinessStatus === 'ready_with_warnings' && 'Ready with Warnings'}
                        {auditData.readinessStatus === 'action_required' && 'Action Required'}
                      </span>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => handleRunLiveAudit()}
                    disabled={runningLiveAudit || loadingPreview}
                    className="smart-audit-run-btn"
                    title="Re-run all 12 financial and operational audit detectors in real time"
                  >
                    <RefreshCwIcon size={13} className={runningLiveAudit ? 'animate-spin' : ''} />
                    <span>{runningLiveAudit ? 'Auditing...' : 'Run Audit'}</span>
                  </button>

                  {auditData && (
                    <button
                      type="button"
                      onClick={() => setAuditExpanded(!auditExpanded)}
                      className="smart-audit-toggle-btn"
                      title={auditExpanded ? 'Collapse audit details' : 'Expand detailed detector report and formula breakdown'}
                    >
                      <span>{auditExpanded ? 'Hide Details' : `Audit Details (${auditData.issues.length})`}</span>
                      {auditExpanded ? <ChevronUpIcon size={14} /> : <ChevronDownIcon size={14} />}
                    </button>
                  )}
                </div>
              </div>

              {/* Audit Summary Body */}
              {auditData ? (
                <div className="bento-audit-summary-body">
                  <div className="bento-audit-score-pill">
                    <span className="bento-audit-score-label">READINESS SCORE</span>
                    <span className="bento-audit-score-val">{auditData.readinessScore}<span>/100</span></span>
                  </div>

                  <div className="bento-audit-chips-row">
                    {auditData.criticalCount > 0 && (
                      <span className="smart-audit-counter-pill critical">
                        <AlertOctagonIcon size={13} />
                        <strong>{auditData.criticalCount}</strong> Critical
                      </span>
                    )}

                    {auditData.warningCount > 0 && (
                      <span className="smart-audit-counter-pill warning">
                        <AlertTriangleIcon size={13} />
                        <strong>{auditData.warningCount}</strong> Warnings
                      </span>
                    )}

                    {auditData.infoCount > 0 && (
                      <span className="smart-audit-counter-pill info">
                        <InfoIcon size={13} />
                        <strong>{auditData.infoCount}</strong> Observations
                      </span>
                    )}

                    {auditData.issues.length === 0 && (
                      <span className="smart-audit-counter-pill clear">
                        <CheckIcon size={13} />
                        All 12 Detectors Clear
                      </span>
                    )}
                  </div>
                </div>
              ) : (
                <div className="bento-audit-summary-body">
                  <span style={{ fontSize: '0.85rem', color: 'var(--dc-text-muted)' }}>Audit engine ready for live inspection.</span>
                </div>
              )}

              {/* Expandable Audit Details Panel */}
              {auditData && auditExpanded && (
                <div className="smart-audit-panel">
                  <div className="smart-audit-panel-header">
                    <div className="smart-audit-panel-title-area">
                      <div className="smart-audit-panel-icon">
                        <ShieldAlertIcon size={20} />
                      </div>
                      <div className="smart-audit-header-title">
                        <h3>Smart Closing Audit & Verification Report</h3>
                        <p>
                          Intelligent multi-point financial mismatch detection, transaction ledger reconciliation, and business anomaly analysis.
                        </p>
                      </div>
                    </div>

                    <div className="smart-audit-filter-tabs">
                      <button
                        type="button"
                        onClick={() => setAuditFilter('all')}
                        className={`smart-audit-filter-btn ${auditFilter === 'all' ? 'active' : ''}`}
                      >
                        All Issues ({auditData.issues.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setAuditFilter('critical')}
                        className={`smart-audit-filter-btn ${auditFilter === 'critical' ? 'active' : ''}`}
                      >
                        Critical ({auditData.criticalCount})
                      </button>
                      <button
                        type="button"
                        onClick={() => setAuditFilter('warning')}
                        className={`smart-audit-filter-btn ${auditFilter === 'warning' ? 'active' : ''}`}
                      >
                        Warnings ({auditData.warningCount})
                      </button>
                      <button
                        type="button"
                        onClick={() => setAuditFilter('info')}
                        className={`smart-audit-filter-btn ${auditFilter === 'info' ? 'active' : ''}`}
                      >
                        Observations ({auditData.infoCount})
                      </button>
                      <button
                        type="button"
                        onClick={() => setAuditFilter('detectors')}
                        className={`smart-audit-filter-btn ${auditFilter === 'detectors' ? 'active' : ''}`}
                      >
                        All 12 Detectors
                      </button>
                    </div>
                  </div>

                  {/* Panel Content: Issues List or Detectors Grid */}
                  {auditFilter === 'detectors' ? (
                    <div className="smart-audit-detectors-grid">
                      {ALL_DETECTORS.map((detector) => {
                        const matchingIssues = auditData.issues.filter((i) => i.detector === detector.id);
                        const hasCritical = matchingIssues.some((i) => i.severity === 'critical');
                        const hasWarning = matchingIssues.some((i) => i.severity === 'warning');
                        const hasInfo = matchingIssues.some((i) => i.severity === 'info');
                        const statusClass = hasCritical ? 'failed' : hasWarning ? 'warning' : hasInfo ? 'info' : 'passed';

                        return (
                          <div key={detector.id} className={`smart-audit-detector-card ${statusClass}`}>
                            <div className="smart-audit-detector-top">
                              <span className="smart-audit-detector-name">{detector.name}</span>
                              <span className={`smart-audit-detector-badge ${statusClass}`}>
                                {statusClass === 'passed' && 'Passed'}
                                {statusClass === 'failed' && 'Action Required'}
                                {statusClass === 'warning' && 'Warning'}
                                {statusClass === 'info' && 'Observation'}
                              </span>
                            </div>
                            <div className="smart-audit-detector-cat">{detector.categoryLabel}</div>
                            <p className="smart-audit-detector-desc">{detector.description}</p>
                            {matchingIssues.length > 0 && (
                              <div style={{ marginTop: '0.65rem', fontSize: '0.75rem', fontWeight: 700, color: '#0f172a' }}>
                                {matchingIssues.length} issue(s) flagged
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="smart-audit-issues-list">
                      {filteredAuditIssues.length === 0 ? (
                        <div className="smart-audit-clean-state">
                          <ShieldCheckIcon size={44} style={{ color: '#059669', marginBottom: '8px' }} />
                          <div style={{ fontSize: '1rem', fontWeight: 800, color: '#0f172a' }}>
                            {auditFilter === 'all'
                              ? 'All 12 Reconciliation Checks Passed Cleanly'
                              : `No ${auditFilter.toUpperCase()} issues detected`}
                          </div>
                          <div style={{ fontSize: '0.825rem', color: '#64748b', maxWidth: '460px', marginTop: '4px' }}>
                            All ledger entries, tender settlements, invoice line totals, and cashier attributions match expected values.
                          </div>
                        </div>
                      ) : (
                        filteredAuditIssues.map((issue) => {
                          const isExpanded = !!expandedIssueIds[issue.id];
                          const isReviewed = !!reviewedIssueIds[issue.id];
                          const detName = ALL_DETECTORS.find(d => d.id === issue.detector)?.name || issue.detector;
                          const formulaBreakdown = issue.details?.formulaBreakdown;
                          const supportingItems = (
                            issue.details?.supportingItems ||
                            issue.details?.items ||
                            issue.details?.invoices ||
                            issue.details?.affectedInvoices ||
                            issue.details?.pairs ||
                            issue.details?.highDiscounts ||
                            issue.details?.unusualRefunds ||
                            issue.details?.affectedLines ||
                            []
                          ) as any[];

                          return (
                            <div
                              key={issue.id}
                              className={`smart-audit-issue-card ${issue.severity} ${isReviewed ? 'reviewed' : ''}`}
                            >
                              <div
                                className="smart-audit-issue-row"
                                onClick={() => toggleIssueExpanded(issue.id)}
                              >
                                <div className="smart-audit-issue-main">
                                  <div className="smart-audit-issue-info">
                                    <div className="smart-audit-issue-title-row">
                                      <span className={`smart-audit-severity-tag ${issue.severity}`}>
                                        {issue.severity === 'critical' ? (
                                          <AlertOctagonIcon size={12} />
                                        ) : issue.severity === 'warning' ? (
                                          <AlertTriangleIcon size={12} />
                                        ) : (
                                          <InfoIcon size={12} />
                                        )}
                                        {issue.severity.toUpperCase()}
                                      </span>
                                      <span className="smart-audit-issue-title-text">{issue.title}</span>
                                    </div>
                                    <p className="smart-audit-issue-summary">{issue.description}</p>

                                    <div className="smart-audit-context-tags">
                                      <span className="smart-audit-context-tag detector-name">
                                        {detName}
                                      </span>
                                      {(issue.counterCode || issue.counterId) && (
                                        <span className="smart-audit-context-tag">
                                          Counter: {issue.counterCode || issue.counterId}
                                        </span>
                                      )}
                                      {(issue.cashierName || issue.cashierId) && (
                                        <span className="smart-audit-context-tag">
                                          Cashier: {issue.cashierName || issue.cashierId}
                                        </span>
                                      )}
                                      {issue.count != null && issue.count > 0 && (
                                        <span className="smart-audit-context-tag">
                                          {issue.count} Record(s)
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                </div>

                                <div className="smart-audit-issue-meta">
                                  {issue.amountMinor != null && (
                                    <div className="smart-audit-amount-badge">
                                      <span className="smart-audit-amount-label">Variance</span>
                                      <span className="smart-audit-amount-value">{fmt(issue.amountMinor)}</span>
                                    </div>
                                  )}
                                  <div className={`smart-audit-chevron ${isExpanded ? 'open' : ''}`}>
                                    <ChevronDownIcon size={16} />
                                  </div>
                                </div>
                              </div>

                              {isExpanded && (
                                <div className="smart-audit-issue-expanded">
                                  <div className="smart-audit-action-callout">
                                    <strong>Recommended Action:</strong> {issue.recommendedAction || issue.details?.actionRequired || 'Review records.'}
                                  </div>

                                  {formulaBreakdown && (
                                    <div className="smart-audit-detail-block">
                                      <div className="smart-audit-detail-title">Reconciliation Breakdown</div>
                                      <div className="smart-audit-formula-box">{formulaBreakdown}</div>
                                    </div>
                                  )}

                                  {supportingItems.length > 0 && (
                                    <div className="smart-audit-detail-block">
                                      <div className="smart-audit-detail-title">
                                        Supporting Records ({supportingItems.length})
                                      </div>
                                      <table className="smart-audit-supporting-table">
                                        <thead>
                                          <tr>
                                            <th>Reference / ID</th>
                                            <th>Description / Reason</th>
                                            <th style={{ textAlign: 'right' }}>Amount</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {supportingItems.slice(0, 8).map((item, idx) => (
                                            <tr key={idx}>
                                              <td><code>{item.reference || item.invoiceNumber || item.invoice1 || item.id || `Item #${idx + 1}`}</code></td>
                                              <td>{item.description || item.reason || item.type || item.paymentMethod || '—'}</td>
                                              <td style={{ textAlign: 'right', fontWeight: 600 }}>
                                                {item.amountMinor != null
                                                  ? fmt(item.amountMinor)
                                                  : (item.totalMinor != null
                                                      ? fmt(item.totalMinor)
                                                      : (item.discountMinor != null ? fmt(item.discountMinor) : '—'))}
                                              </td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                      {supportingItems.length > 8 && (
                                        <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '6px', textAlign: 'right' }}>
                                          + {supportingItems.length - 8} additional records
                                        </div>
                                      )}
                                    </div>
                                  )}

                                  <div className="smart-audit-expanded-footer">
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        toggleIssueReviewed(issue.id);
                                      }}
                                      className={`smart-audit-review-btn ${isReviewed ? 'active' : ''}`}
                                    >
                                      <CheckIcon size={14} />
                                      {isReviewed ? 'Marked as Reviewed' : 'Mark as Reviewed'}
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 2B: Operational Alerts & Register Status (Col span 5) */}
            <div className="day-closing-card bento-card-3d bento-ops-deck-card">
              <div className="day-closing-card-header">
                <div className="day-closing-card-title-group">
                  <div className={`day-closing-card-icon-bubble ${preview?.scheduleInfo?.isOverdue ? 'rose' : 'green'}`}>
                    {preview?.scheduleInfo?.isOverdue ? <AlertTriangleIcon size={18} /> : <ClockIcon size={18} />}
                  </div>
                  <div>
                    <span className="bento-deck-card-title">Register Alerts & Compliance</span>
                    <span className="bento-deck-card-sub">{selectedDate} • {isCashierUser ? user.name : 'Counter Operations'}</span>
                  </div>
                </div>
                <span className={`cat-badge-live-sync sm ${closingStatus}`}>
                  <span className="live-indicator-dot" />
                  {closingStatus.toUpperCase()}
                </span>
              </div>

              <div className="bento-ops-body">
                {preview?.scheduleInfo?.isOverdue && (
                  <div className="bento-ops-alert-chip overdue">
                    <AlertTriangleIcon size={16} />
                    <div className="bento-ops-alert-content">
                      <strong>Closing Overdue:</strong> Expected at {preview.scheduleInfo.expectedClosingTime} ({preview.scheduleInfo.minutesOverdue}m overdue).
                    </div>
                  </div>
                )}

                {preview?.duplicateAlerts && preview.duplicateAlerts.length > 0 && (
                  <div className="bento-ops-alert-chip duplicate">
                    <AlertOctagonIcon size={16} />
                    <div className="bento-ops-alert-content">
                      <strong>Duplicate Billing:</strong> {preview.duplicateAlerts.length} potential duplicate pair(s) detected ({preview.duplicateAlerts.map((d: any) => `${d.invoice1} & ${d.invoice2}`).join(', ')}).
                    </div>
                  </div>
                )}

                {user?.role !== 'cashier' &&
                  notifications
                    .filter((n: any) => n.type === 'rejection' && (!n.isRead && !n.is_read))
                    .map((n: any) => (
                      <div key={n.id} className="bento-ops-alert-chip recount">
                        <AlertTriangleIcon size={16} />
                        <div className="bento-ops-alert-content">
                          <strong>{n.title}:</strong> {n.message}
                        </div>
                        <button onClick={() => handleDismissNotification(n.id)} className="bento-ops-alert-dismiss" title="Dismiss alert">✕</button>
                      </div>
                    ))}

                {preview?.closingReminder?.hasUnclosedPrevDay && (
                  <div className="bento-ops-alert-chip reminder">
                    <AlertTriangleIcon size={16} />
                    <div className="bento-ops-alert-content">
                      <strong>Unclosed Previous Day:</strong> Date {preview.closingReminder.prevDayDate} has not been approved and sealed yet.
                    </div>
                    <button onClick={() => setSelectedDate(preview.closingReminder.prevDayDate)} className="bento-ops-action-btn">Inspect</button>
                  </div>
                )}

                {!preview?.scheduleInfo?.isOverdue &&
                 (!preview?.duplicateAlerts || preview.duplicateAlerts.length === 0) &&
                 (!preview?.closingReminder?.hasUnclosedPrevDay) && (
                  <div className="bento-ops-clean-state">
                    <CheckCircleIcon size={18} style={{ color: 'var(--dc-primary)', flexShrink: 0 }} />
                    <div>
                      <strong>Register Operational & In Balance</strong>
                      <p>Active trading in progress. All float records are synced and ready for closing submission.</p>
                    </div>
                  </div>
                )}

                {/* Manager Actions if submitted or closed */}
                {closingStatus === 'submitted' && isManagerOrOwner && closedRecord?.id && (
                  <div className="bento-ops-lifecycle-actions">
                    <button onClick={() => handleApproveClosing(closedRecord.id)} disabled={actionLoading} className="cat-btn-primary sm">
                      <CheckCircle2Icon size={13} />
                      Approve & Lock
                    </button>
                    <button onClick={() => handleOpenRejectModal(closedRecord.id)} disabled={actionLoading} className="cat-btn-outline sm">
                      <RotateCcwIcon size={13} />
                      Reject / Recount
                    </button>
                  </div>
                )}
                {(closingStatus === 'approved' || closingStatus === 'closed') && (isOwner || isManager) && closedRecord?.id && (
                  <div className="bento-ops-lifecycle-actions">
                    <button onClick={() => handleOpenReopenModal(closedRecord.id)} className="cat-btn-outline sm">
                      <RotateCcwIcon size={13} />
                      Reopen Day
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ====================================================================
              POST-DAY-CLOSE LATE SALES RECONCILIATION DECK
              ==================================================================== */}
          {preview?.lateSalesSummary?.hasLateSales && (
            <div
              className="bento-card-3d"
              style={{
                marginBottom: '1.25rem',
                backgroundColor: '#ffffff',
                borderRadius: '16px',
                border: '1px solid #fde68a',
                overflow: 'hidden',
                boxShadow: '0 10px 25px -5px rgba(245, 158, 11, 0.1)',
              }}
            >
              {/* Header */}
              <div
                style={{
                  padding: '1rem 1.25rem',
                  background: 'linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%)',
                  borderBottom: '1px solid #fde68a',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '0.5rem',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <div
                    style={{
                      width: '36px',
                      height: '36px',
                      borderRadius: '8px',
                      backgroundColor: '#f59e0b',
                      color: '#ffffff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <ClockIcon size={18} />
                  </div>
                  <div>
                    <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, color: '#92400e' }}>
                      Post-Day-Close Late Sales Reconciliation
                    </h3>
                    <p style={{ margin: 0, fontSize: '0.78rem', color: '#b45309' }}>
                      {preview.lateSalesSummary.lateSalesCount} late bill(s) entered after day close • Original Day Close values preserved
                    </p>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <span
                    style={{
                      backgroundColor: '#ffffff',
                      border: '1px solid #fcd34d',
                      borderRadius: '20px',
                      padding: '3px 10px',
                      fontSize: '0.74rem',
                      fontWeight: 800,
                      color: '#b45309',
                    }}
                  >
                    +{fmt(preview.lateSalesSummary.lateSalesTotalMinor)} Added
                  </span>
                </div>
              </div>

              {/* Metric Comparison Cards */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                  gap: '1rem',
                  padding: '1.25rem',
                  backgroundColor: '#fafafa',
                  borderBottom: '1px solid #f1f5f9',
                }}
              >
                {/* 1. Original Closed Sales */}
                <div style={{ backgroundColor: '#ffffff', padding: '1rem', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>
                    Original Closed Sales
                  </div>
                  <div style={{ fontSize: '1.2rem', fontWeight: 800, color: '#334155', marginTop: '2px' }}>
                    {fmt(preview.lateSalesSummary.originalNetSalesMinor)}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '4px' }}>
                    Sealed at Day Close (Unchanged)
                  </div>
                </div>

                {/* 2. Late Sales Added */}
                <div style={{ backgroundColor: '#fffbeb', padding: '1rem', borderRadius: '10px', border: '1px solid #fde68a' }}>
                  <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#92400e', textTransform: 'uppercase' }}>
                    Late Sales Added
                  </div>
                  <div style={{ fontSize: '1.2rem', fontWeight: 900, color: '#d97706', marginTop: '2px' }}>
                    +{fmt(preview.lateSalesSummary.lateSalesTotalMinor)}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: '#b45309', marginTop: '4px' }}>
                    {preview.lateSalesSummary.lateSalesCount} transaction(s) post-closing
                  </div>
                </div>

                {/* 3. Revised Business-Date Total */}
                <div style={{ backgroundColor: '#f0fdf4', padding: '1rem', borderRadius: '10px', border: '1px solid #bbf7d0' }}>
                  <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#166534', textTransform: 'uppercase' }}>
                    Revised Business-Date Total
                  </div>
                  <div style={{ fontSize: '1.25rem', fontWeight: 900, color: '#15803d', marginTop: '2px' }}>
                    {fmt(preview.lateSalesSummary.revisedNetSalesMinor)}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: '#166534', marginTop: '4px' }}>
                    Full revised sales for {selectedDate}
                  </div>
                </div>

                {/* 4. Cash Drawer Separation */}
                <div style={{ backgroundColor: '#ffffff', padding: '1rem', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>
                    Post-Close Cash Collected
                  </div>
                  <div style={{ fontSize: '1.2rem', fontWeight: 800, color: '#0f766e', marginTop: '2px' }}>
                    {fmt(preview.lateSalesSummary.lateCashMinor)}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '4px' }}>
                    Tracked separately from closing cash
                  </div>
                </div>
              </div>

              {/* Itemized Table of Late Sales */}
              <div style={{ padding: '1rem 1.25rem' }}>
                <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', marginBottom: '8px' }}>
                  Itemized Late Sales Transactions
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid #e2e8f0', color: '#64748b', textAlign: 'left' }}>
                        <th style={{ padding: '6px 8px' }}>Bill Number</th>
                        <th style={{ padding: '6px 8px' }}>Customer</th>
                        <th style={{ padding: '6px 8px', textAlign: 'right' }}>Total Amount</th>
                        <th style={{ padding: '6px 8px' }}>Payment Mode</th>
                        <th style={{ padding: '6px 8px' }}>Actual Entry Timestamp</th>
                        <th style={{ padding: '6px 8px' }}>Entered By</th>
                        <th style={{ padding: '6px 8px' }}>Audit Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.lateSalesSummary.lateSales.map((ls: any) => (
                        <tr key={ls.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '8px 8px', fontWeight: 700, color: '#0f766e' }}>
                            {ls.number}
                          </td>
                          <td style={{ padding: '8px 8px', color: '#1e293b' }}>
                            <div>{ls.customerName}</div>
                            {ls.customerPhone && <div style={{ fontSize: '0.72rem', color: '#64748b' }}>{ls.customerPhone}</div>}
                          </td>
                          <td style={{ padding: '8px 8px', textAlign: 'right', fontWeight: 800, color: '#0f172a' }}>
                            {fmt(ls.totalMinor)}
                          </td>
                          <td style={{ padding: '8px 8px' }}>
                            {ls.payments && ls.payments.length > 0
                              ? ls.payments.map((p: any) => `${(p.method || '').toUpperCase()} (${fmt(p.amountMinor)})`).join(', ')
                              : 'PAID'}
                          </td>
                          <td style={{ padding: '8px 8px', color: '#475569', whiteSpace: 'nowrap' }}>
                            {new Date(ls.lateSaleEntryAt || ls.createdAt).toLocaleString('en-IN', {
                              dateStyle: 'short',
                              timeStyle: 'short',
                              timeZone: 'Asia/Kolkata',
                            })}
                          </td>
                          <td style={{ padding: '8px 8px', color: '#334155' }}>
                            {ls.enteredByName || 'Store Manager'}
                          </td>
                          <td style={{ padding: '8px 8px', color: '#92400e', fontStyle: 'italic', maxWidth: '200px' }}>
                            {ls.lateSaleReason || 'Post-closing customer purchase'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ====================================================================
              ROW 3: ASYMMETRICAL BENTO FINANCIAL KPI DECK (Hero 5 : Secondary 7)
              ==================================================================== */}
          <div className="bento-financial-kpi-deck">
            {/* 3A: Hero Bento Tile: Net Sales (Col span 5) */}
            <div className="bento-kpi-hero-card bento-card-3d">
              <div className="bento-kpi-hero-top">
                <div>
                  <span className="bento-kpi-hero-tag">PRIMARY FINANCIAL KPI</span>
                  <h3 className="bento-kpi-hero-title">Net Sales</h3>
                </div>
                <div className="bento-kpi-hero-icon">
                  <RupeeIcon size={20} />
                </div>
              </div>

              <div className="bento-kpi-hero-amount">
                {fmt(sales.netSalesMinor)}
              </div>

              <div className="bento-kpi-hero-formula">
                <span>Gross {fmt(sales.grossSalesMinor)}</span>
                <span>−</span>
                <span>Returns {fmt(sales.returnsTotalMinor)}</span>
                <span>−</span>
                <span>Discounts {fmt(sales.totalDiscountsMinor)}</span>
              </div>

              <div className="bento-kpi-hero-footer">
                <span className="bento-kpi-pill">
                  <ReceiptIcon size={13} />
                  <span>{sales.invoicesCount || 0} bills completed</span>
                </span>
                <span className="bento-kpi-pill">
                  <span>Avg: {fmt(sales.averageBillValueMinor)}</span>
                </span>
                {sales.cancelledInvoicesCount ? (
                  <span className="bento-kpi-pill">
                    <span>{sales.cancelledInvoicesCount} cancelled</span>
                  </span>
                ) : null}
              </div>
            </div>

            {/* 3B: Secondary 2x2 Bento Metric Grid (Col span 7) */}
            <div className="bento-kpi-secondary-grid">
              {isCashierUser ? (
                <>
                  <div className="fin-kpi-card bento-card-3d blue">
                    <div className="fin-kpi-top">
                      <span className="fin-kpi-label">Gross Sales</span>
                      <div className="fin-kpi-icon"><TrendingUpIcon size={15} /></div>
                    </div>
                    <div className="fin-kpi-val">{fmt(sales.grossSalesMinor)}</div>
                    <span className="fin-kpi-sub">Pre-discount, excl. GST</span>
                  </div>

                  <div className="fin-kpi-card bento-card-3d teal">
                    <div className="fin-kpi-top">
                      <span className="fin-kpi-label">Total Invoices</span>
                      <div className="fin-kpi-icon"><ReceiptIcon size={15} /></div>
                    </div>
                    <div className="fin-kpi-val">{sales.invoicesCount || 0} bills</div>
                    <span className="fin-kpi-sub">{sales.cancelledInvoicesCount || 0} cancelled bills</span>
                  </div>

                  <div className="fin-kpi-card bento-card-3d emerald">
                    <div className="fin-kpi-top">
                      <span className="fin-kpi-label">GST Collected</span>
                      <div className="fin-kpi-icon"><RupeeIcon size={15} /></div>
                    </div>
                    <div className="fin-kpi-val" style={{ color: '#047857' }}>{fmt(sales.gstCollectedMinor)}</div>
                    <span className="fin-kpi-sub">CGST + SGST + IGST</span>
                  </div>

                  <div className="fin-kpi-card bento-card-3d rose">
                    <div className="fin-kpi-top">
                      <span className="fin-kpi-label">Discounts & Returns</span>
                      <div className="fin-kpi-icon"><RotateCcwIcon size={15} /></div>
                    </div>
                    <div className="fin-kpi-val" style={{ color: '#e11d48' }}>
                      -{fmt((sales.totalDiscountsMinor || 0) + (sales.returnsTotalMinor || 0))}
                    </div>
                    <span className="fin-kpi-sub">{returns.totalReturnsCount || 0} returns • {fmt(sales.totalDiscountsMinor)} disc</span>
                  </div>
                </>
              ) : (
                <>
                  <div className="fin-kpi-card bento-card-3d teal">
                    <div className="fin-kpi-top">
                      <span className="fin-kpi-label">Gross Profit</span>
                      <div className="fin-kpi-icon"><TrendingUpIcon size={15} /></div>
                    </div>
                    <div className="fin-kpi-val" style={{ color: 'var(--dc-primary)' }}>{fmt(profit.grossProfitMinor)}</div>
                    <span className="fin-kpi-sub">{marginPct.toFixed(1)}% Gross Margin</span>
                  </div>

                  <div className="fin-kpi-card bento-card-3d amber">
                    <div className="fin-kpi-top">
                      <span className="fin-kpi-label">Operating Expenses</span>
                      <div className="fin-kpi-icon"><ArrowUpRightIcon size={15} /></div>
                    </div>
                    <div className="fin-kpi-val">{fmt(profit.operatingExpensesMinor)}</div>
                    <span className="fin-kpi-sub">Branch petty & overheads</span>
                  </div>

                  <div className="fin-kpi-card bento-card-3d emerald">
                    <div className="fin-kpi-top">
                      <span className="fin-kpi-label">Operating Profit</span>
                      <div className="fin-kpi-icon"><RupeeIcon size={15} /></div>
                    </div>
                    <div className="fin-kpi-val" style={{ color: profit.netProfitMinor >= 0 ? '#047857' : '#b91c1c' }}>
                      {fmt(profit.netProfitMinor)}
                    </div>
                    <span className="fin-kpi-sub">{operatingMarginPct.toFixed(1)}% Net Margin</span>
                  </div>

                  <div className="fin-kpi-card bento-card-3d blue">
                    <div className="fin-kpi-top">
                      <span className="fin-kpi-label">GST Collected</span>
                      <div className="fin-kpi-icon"><RupeeIcon size={15} /></div>
                    </div>
                    <div className="fin-kpi-val" style={{ color: '#047857' }}>{fmt(sales.gstCollectedMinor)}</div>
                    <span className="fin-kpi-sub">CGST + SGST + IGST</span>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Bento Grid: Tender Collections (60%) & Cash Drawer Reconciliation (40%) */}
          <div className="day-closing-bento-grid">
            {/* LEFT 7 COLUMNS: Tender Collections & Returns */}
            <div className="bento-col-7">
              {/* Tender Collections */}
              <div className="day-closing-card bento-card-3d">
                <div className="day-closing-card-header">
                  <div className="day-closing-card-title-group">
                    <div className="day-closing-card-icon-bubble green">
                      <WalletIcon size={18} />
                    </div>
                    <span>Tender & Settlement Collections</span>
                  </div>
                  <span className="day-closing-card-badge emerald">
                    Payment Channels
                  </span>
                </div>

                <div className="tender-kpi-grid">
                  <div className="tender-kpi-card bento-card-3d cash">
                    <div className="tender-header">
                      <BanknoteIcon size={15} />
                      <span>Physical Cash</span>
                    </div>
                    <div className="tender-amount">{fmt(payments.cashCollectionsMinor)}</div>
                    <div className="tender-subtext" style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '2px' }}>Cash in Drawer</div>
                  </div>

                  <div className="tender-kpi-card bento-card-3d upi">
                    <div className="tender-header">
                      <RefreshCwIcon size={14} />
                      <span>UPI / QR</span>
                    </div>
                    <div className="tender-amount">{fmt(payments.upiCollectionsMinor)}</div>
                    <div className="tender-subtext" style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '2px' }}>GPay, PhonePe, Paytm</div>
                  </div>

                  <div className="tender-kpi-card bento-card-3d card">
                    <div className="tender-header">
                      <CreditCardIcon size={14} />
                      <span>Card / POS</span>
                    </div>
                    <div className="tender-amount">{fmt(payments.cardCollectionsMinor)}</div>
                    <div className="tender-subtext" style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '2px' }}>Swipe Terminal / EDC</div>
                  </div>

                  <div className="tender-kpi-card bento-card-3d credit">
                    <div className="tender-header">
                      <StoreIcon size={14} />
                      <span>Store Credit</span>
                    </div>
                    <div className="tender-amount">{fmt(payments.storeCreditMinor)}</div>
                    <div className="tender-subtext" style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '2px' }}>Vouchers / Non-Cash</div>
                  </div>
                </div>
              </div>

              {/* Returns, Refunds & Exchanges */}
              <div className="day-closing-card bento-card-3d">
                <div className="day-closing-card-header">
                  <div className="day-closing-card-title-group">
                    <div className="day-closing-card-icon-bubble rose">
                      <RotateCcwIcon size={18} />
                    </div>
                    <span>Returns, Refunds & Exchanges</span>
                  </div>
                  <span className="day-closing-card-badge rose">
                    {returns.totalReturnsCount || 0} Return Events
                  </span>
                </div>

                <div>
                  <div className="detail-list-row">
                    <span className="detail-list-label">Total Returned Merchandise Value:</span>
                    <span className="detail-list-val rose">{fmt(returns.totalReturnValueMinor)}</span>
                  </div>
                  <div className="detail-list-row">
                    <span className="detail-list-label">Cash Refunds Disbursed:</span>
                    <span className="detail-list-val">{fmt(returns.cashRefundsPaidMinor)}</span>
                  </div>
                  <div className="detail-list-row">
                    <span className="detail-list-label">UPI Refunds Processed:</span>
                    <span className="detail-list-val">{fmt(returns.upiRefundsPaidMinor)}</span>
                  </div>
                  <div className="detail-list-row">
                    <span className="detail-list-label">Exchange Credits Applied to New Sales:</span>
                    <span className="detail-list-val indigo">{fmt(returns.exchangeCreditAdjustedMinor)}</span>
                  </div>
                  <div className="detail-list-row">
                    <span className="detail-list-label">Store Credit Notes Issued:</span>
                    <span className="detail-list-val teal">{fmt(returns.storeCreditsIssuedMinor)}</span>
                  </div>
                  <div className="detail-list-row">
                    <span className="detail-list-label">New Merchandise Sold in Exchanges:</span>
                    <span className="detail-list-val">{fmt(exchanges.newProductsSoldMinor)}</span>
                  </div>
                </div>

                <div className="detail-notice-box" style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                  <InfoIcon size={16} style={{ color: 'var(--dc-primary)', flexShrink: 0, marginTop: '2px' }} />
                  <div>
                    <strong>Accounting Integrity:</strong> Exchanges seamlessly offset customer return credit against new merchandise sold without inflating gross cash collections. Resellable returns restore inventory cost, while damaged goods are quarantined separately.
                  </div>
                </div>
              </div>
            </div>

            {/* RIGHT 5 COLUMNS: Dedicated Cash Drawer Reconciliation */}
            <div className="bento-col-5">
              <div className="day-closing-card bento-card-3d">
                <div className="day-closing-card-header">
                  <div className="day-closing-card-title-group">
                    <div className="day-closing-card-icon-bubble green">
                      <BanknoteIcon size={18} />
                    </div>
                    <span>Cash Drawer Reconciliation</span>
                  </div>
                  <span className={`day-closing-card-badge ${selectedCashierId || isCashierUser ? 'emerald' : ''}`}>
                    {selectedCashierId || isCashierUser
                      ? (preview?.availableCashiers?.find((c: any) => c.id === (selectedCashierId || user.id))?.name
                          ? `Cashier: ${preview.availableCashiers.find((c: any) => c.id === (selectedCashierId || user.id)).name}`
                          : `Cashier Register`)
                      : 'Store Consolidated'}
                  </span>
                </div>

                <div className="cash-rec-container">
                  <div className="cash-rec-row">
                    <span className="cash-rec-label">Opening Cash Float</span>
                    <span className="cash-rec-val">{fmt(cashRec.openingCashMinor)}</span>
                  </div>

                  <div className="cash-rec-row">
                    <span className="cash-rec-label" style={{ color: '#15803d' }}>
                      <ArrowDownLeftIcon size={14} /> (+) Cash Sales Received
                    </span>
                    <span className="cash-rec-val plus">+{fmt(cashRec.cashSalesReceivedMinor)}</span>
                  </div>

                  <div className="cash-rec-row">
                    <span className="cash-rec-label" style={{ color: '#15803d' }}>
                      (+) Cash In / Drawer Deposits
                    </span>
                    <span className="cash-rec-val plus">+{fmt(cashRec.cashInMinor)}</span>
                  </div>

                  <div className="cash-rec-row">
                    <span className="cash-rec-label" style={{ color: '#b91c1c' }}>
                      <ArrowUpRightIcon size={14} /> (-) Cash Refunds Paid Out
                    </span>
                    <span className="cash-rec-val minus">-{fmt(cashRec.cashRefundsPaidMinor)}</span>
                  </div>

                  <div className="cash-rec-row">
                    <span className="cash-rec-label" style={{ color: '#b91c1c' }}>
                      (-) Cash Expenses Paid
                    </span>
                    <span className="cash-rec-val minus">-{fmt(cashRec.cashExpensesMinor)}</span>
                  </div>

                  <div className="cash-rec-row">
                    <span className="cash-rec-label" style={{ color: '#b91c1c' }}>
                      (-) Cash Out / Withdrawals
                    </span>
                    <span className="cash-rec-val minus">-{fmt(cashRec.cashOutMinor)}</span>
                  </div>

                  {/* Expected Closing Cash Banner */}
                  <div className="cash-rec-expected-box">
                    <span className="cash-rec-expected-label">Expected Closing Cash:</span>
                    <span className="cash-rec-expected-val">{fmt(cashRec.expectedClosingCashMinor)}</span>
                  </div>

                  {/* Cash Variance Warning Alert */}
                  {Math.abs(cashDifferenceMinor) > 5000 && (closingStatus === 'open' || closingStatus === 'reopened') && (
                    <div style={{
                      background: '#fffbeb',
                      border: '1px solid #fde68a',
                      borderRadius: '10px',
                      padding: '0.65rem 0.85rem',
                      fontSize: '0.775rem',
                      color: '#92400e',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      fontWeight: 600
                    }}>
                      <AlertTriangleIcon size={16} style={{ color: '#d97706', flexShrink: 0 }} />
                      <span>Notice: High cash variance detected ({cashDifferenceMinor >= 0 ? '+' : ''}{fmt(cashDifferenceMinor)}). Discrepancy reason is mandatory in remarks before submission.</span>
                    </div>
                  )}

                  {/* Submission Form (Active if open or reopened) */}
                  {closingStatus === 'open' || closingStatus === 'reopened' ? (
                    <form onSubmit={handleSubmitClosing} style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                      <div className="cash-rec-input-group">
                        <label className="cash-rec-input-label">
                          Enter the actual cash counted (₹) *
                        </label>
                        <div className="cash-rec-input-wrapper">
                          <span className="cash-rec-input-prefix">₹</span>
                          <input
                            type="number"
                            step="0.01"
                            required
                            value={actualCashStr}
                            onChange={(e) => setActualCashStr(e.target.value)}
                            onBlur={() => handleRunLiveAudit()}
                            placeholder="0.00"
                            className="cash-rec-input"
                          />
                        </div>
                      </div>

                      {/* Variance Pill */}
                      <div className={`cash-rec-diff-pill ${
                        cashDifferenceMinor === 0
                          ? 'balanced'
                          : cashDifferenceMinor > 0
                          ? 'surplus'
                          : 'deficit'
                      }`}>
                        <span>
                          {cashDifferenceMinor === 0
                            ? 'Cash Matched'
                            : cashDifferenceMinor > 0
                            ? 'Cash Excess'
                            : 'Cash Shortage'}
                        </span>
                        <span>
                          {cashDifferenceMinor >= 0 ? '+' : ''}{fmt(cashDifferenceMinor)}
                        </span>
                      </div>

                      <div className="cash-rec-input-group">
                        <label className="cash-rec-input-label">
                          Closing Remarks / Discrepancy Reason {Math.abs(cashDifferenceMinor) > 0 ? '*' : ''}
                        </label>
                        <textarea
                          rows={2}
                          value={closingRemarks}
                          onChange={(e) => setClosingRemarks(e.target.value)}
                          placeholder="e.g. Counted by cashier, minor coin variation"
                          className="cash-rec-remarks-input"
                          required={Math.abs(cashDifferenceMinor) > 0}
                        />
                      </div>

                      <button
                        type="submit"
                        disabled={submitting}
                        className="cash-rec-submit-btn cat-btn-primary"
                        style={{ width: '100%', padding: '0.85rem 1.25rem', borderRadius: '14px', fontSize: '0.95rem', fontWeight: 800 }}
                      >
                        <LockIcon size={16} />
                        {submitting
                          ? 'Submitting Closing...'
                          : closingStatus === 'reopened'
                          ? 'Submit & Re-Seal Day Closing'
                          : 'Submit Day Closing'}
                      </button>
                    </form>
                  ) : (
                    /* Closed or Submitted View */
                    <div style={{ marginTop: '0.5rem', background: 'var(--dc-surface-inner)', padding: '1.1rem', borderRadius: '14px', border: '1.5px solid var(--dc-border)', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.825rem' }}>
                        <span style={{ color: '#64748b' }}>Actual Closing Cash:</span>
                        <strong style={{ color: '#0f172a' }}>{fmt(closedRecord?.actual_cash_minor)}</strong>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.825rem' }}>
                        <span style={{ color: '#64748b' }}>Cash Discrepancy:</span>
                        <strong style={{ color: (closedRecord?.variance_minor || 0) < 0 ? '#b91c1c' : (closedRecord?.variance_minor || 0) > 0 ? '#1d4ed8' : '#15803d' }}>
                          {(closedRecord?.variance_minor || 0) === 0
                            ? 'Cash Matched'
                            : (closedRecord?.variance_minor || 0) < 0
                            ? `Cash Shortage (${fmt(closedRecord?.variance_minor || 0)})`
                            : `Cash Excess (+${fmt(closedRecord?.variance_minor || 0)})`}
                        </strong>
                      </div>
                      {closedRecord?.remarks && (
                        <div style={{ fontSize: '0.75rem', color: '#475569', fontStyle: 'italic', paddingTop: '4px' }}>
                          "{closedRecord.remarks}"
                        </div>
                      )}

                      {closingStatus === 'submitted' && (
                        <div style={{
                          marginTop: '0.5rem',
                          padding: '0.65rem 0.85rem',
                          background: '#fffbeb',
                          border: '1px solid #fde68a',
                          borderRadius: '8px',
                          fontSize: '0.775rem',
                          color: '#92400e',
                          fontWeight: 600
                        }}>
                          {isCashierUser
                            ? 'Your Day Closing is submitted. Modification is locked awaiting Management review.'
                            : 'Submitted by cashier. Review and approve or reject below.'}
                        </div>
                      )}

                      {closingStatus === 'submitted' && isManagerOrOwner && (
                        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                          <button
                            onClick={() => handleApproveClosing(closedRecord.id)}
                            disabled={actionLoading}
                            className="btn-approve"
                            style={{ flex: 1, justifyContent: 'center' }}
                          >
                            <CheckCircle2Icon size={15} />
                            Approve
                          </button>
                          <button
                            onClick={() => handleOpenRejectModal(closedRecord.id)}
                            disabled={actionLoading}
                            className="btn-reject"
                            style={{ flex: 1, justifyContent: 'center' }}
                          >
                            <RotateCcwIcon size={15} />
                            Reject
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ====================================================================
          TAB: COUNTER & CASHIER SALES REPORTS
          ==================================================================== */}
      {activeTab === 'breakdown' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {/* Sub-navigation & Return pill bar */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#ffffff', padding: '12px 18px', borderRadius: '12px', border: '1px solid #e2e8f0', flexWrap: 'wrap', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => setActiveTab('closing')}
                className="btn-nav-back"
                title="Return to Register Closing & Reconciliation"
              >
                <ArrowLeftIcon size={14} />
                <span>Back to Register Closing</span>
              </button>

              <div style={{ width: '1px', height: '24px', background: '#e2e8f0' }} />

              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '6px 14px',
                borderRadius: '8px',
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                color: '#1e293b',
                fontWeight: 700,
                fontSize: '0.85rem',
              }}>
                <Building2Icon size={16} style={{ color: 'var(--dc-primary)' }} />
                <span>Counter & Cashier Sales Report</span>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              {counterSalesData?.consolidatedTotal && (
                <div style={{ fontSize: '0.82rem', color: '#64748b', background: '#f8fafc', padding: '6px 12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                  Consolidated Net Sales: <strong style={{ color: '#16a34a' }}>{fmt(counterSalesData.consolidatedTotal.netSalesMinor)}</strong>
                </div>
              )}

              <button
                onClick={handleExportCounterCsv}
                disabled={!counterSalesData?.counters?.length}
                className="btn-export"
                style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                <FileSpreadsheetIcon size={15} />
                Export Counter CSV
              </button>
            </div>
          </div>

          {/* COUNTER REPORT CONTENT */}
          {breakdownSubTab === 'counter' && (
            <>
              {loadingCounterSales ? (
                <div style={{ padding: '3rem', textAlign: 'center', background: '#ffffff', borderRadius: '16px', border: '1px solid #e2e8f0' }}>
                  <RefreshCwIcon size={32} className="animate-spin" style={{ margin: '0 auto 12px auto', color: 'var(--dc-primary)' }} />
                  <p style={{ fontSize: '0.9rem', fontWeight: 600, color: '#64748b' }}>Aggregating counter-wise sales records...</p>
                </div>
              ) : counterSalesData ? (
                <>
                  {counterSalesData.exceptionCount > 0 && (
                    <div style={{ background: '#fef3c7', border: '1px solid #fde68a', borderRadius: '8px', padding: '10px 14px', color: '#92400e', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <AlertTriangleIcon size={16} />
                      <span><strong>Notice:</strong> {counterSalesData.exceptionCount} unassigned counter transaction group(s) detected. Shown separately below for audit compliance.</span>
                    </div>
                  )}

                  {/* 1. Dynamic Counter Register Selector (Pill tabs if <= 3, Dropdown if > 3) */}
                  {(() => {
                    const standardCounters = counterSalesData.counters.filter((c: any) => !c.isException);
                    const showDropdown = standardCounters.length > 3;

                    return (
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        flexWrap: 'wrap',
                        gap: '12px',
                        background: '#ffffff',
                        border: '1px solid #e2e8f0',
                        borderRadius: '12px',
                        padding: '12px 16px',
                        marginBottom: '16px',
                        boxShadow: '0 1px 3px rgba(15, 23, 42, 0.04)',
                      }}>
                        {showDropdown ? (
                          /* > 3 counters: Dropdown selector */
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                            <label style={{ fontSize: '0.85rem', fontWeight: 700, color: '#334155', display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <Building2Icon size={16} style={{ color: 'var(--dc-primary)' }} />
                              <span>Select Counter:</span>
                            </label>
                            <select
                              value={selectedCounterKeyFilter}
                              onChange={(e) => setSelectedCounterKeyFilter(e.target.value)}
                              style={{
                                padding: '7px 14px',
                                borderRadius: '8px',
                                border: '1.5px solid #cbd5e1',
                                background: '#ffffff',
                                fontSize: '0.85rem',
                                fontWeight: 600,
                                color: '#0f172a',
                                minWidth: '290px',
                                cursor: 'pointer',
                              }}
                            >
                              <option value="ALL">🏢 All Counters (Consolidated Total — {fmt(counterSalesData.consolidatedTotal?.netSalesMinor)})</option>
                              {counterSalesData.counters.map((c: any) => (
                                <option key={c.counterKey} value={c.counterKey}>
                                  {c.isException ? '⚠️ ' : ''}{c.counterName} ({c.counterCode}) — {fmt(c.netSalesMinor)} ({c.invoicesCount} bills){c.activeShift ? ' • Live Shift' : ''}
                                </option>
                              ))}
                            </select>
                            {selectedCounterKeyFilter !== 'ALL' && (
                              <button
                                type="button"
                                onClick={() => setSelectedCounterKeyFilter('ALL')}
                                style={{
                                  background: '#f1f5f9',
                                  border: '1px solid #cbd5e1',
                                  borderRadius: '6px',
                                  padding: '5px 12px',
                                  fontSize: '0.78rem',
                                  color: '#475569',
                                  cursor: 'pointer',
                                  fontWeight: 700,
                                }}
                              >
                                Show All Counters
                              </button>
                            )}
                          </div>
                        ) : (
                          /* <= 3 counters: Horizontal Pill Tabs */
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                            <button
                              type="button"
                              onClick={() => setSelectedCounterKeyFilter('ALL')}
                              style={{
                                padding: '7px 14px',
                                borderRadius: '8px',
                                border: selectedCounterKeyFilter === 'ALL' ? '2px solid var(--dc-primary)' : '1px solid #cbd5e1',
                                background: selectedCounterKeyFilter === 'ALL' ? 'var(--dc-primary-soft, #E6F4F3)' : '#ffffff',
                                color: selectedCounterKeyFilter === 'ALL' ? 'var(--dc-primary, #0F766E)' : '#475569',
                                fontWeight: 700,
                                fontSize: '0.82rem',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                                transition: 'all 0.15s ease',
                              }}
                            >
                              <Building2Icon size={15} />
                              <span>All Counters (Total)</span>
                              <span style={{
                                fontSize: '0.72rem',
                                background: selectedCounterKeyFilter === 'ALL' ? 'rgba(20, 184, 166, 0.25)' : '#f1f5f9',
                                color: selectedCounterKeyFilter === 'ALL' ? 'var(--dc-sidebar, #0F2D2E)' : '#64748b',
                                padding: '2px 7px',
                                borderRadius: '10px',
                                fontWeight: 800,
                              }}>
                                {counterSalesData.counters.length}
                              </span>
                            </button>

                            {counterSalesData.counters.map((c: any) => {
                              const isSelected = selectedCounterKeyFilter === c.counterKey;
                              const hasLiveShift = Boolean(c.activeShift);
                              return (
                                <button
                                  key={c.counterKey}
                                  type="button"
                                  onClick={() => setSelectedCounterKeyFilter(c.counterKey)}
                                  style={{
                                    padding: '7px 14px',
                                    borderRadius: '8px',
                                    border: isSelected ? '2px solid var(--dc-primary)' : '1px solid #cbd5e1',
                                    background: isSelected ? 'var(--dc-primary-soft, #E6F4F3)' : '#ffffff',
                                    color: isSelected ? 'var(--dc-primary, #0F766E)' : '#475569',
                                    fontWeight: 700,
                                    fontSize: '0.82rem',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    transition: 'all 0.15s ease',
                                  }}
                                >
                                  <span>{c.counterName}</span>
                                  <span style={{ fontSize: '0.7rem', color: isSelected ? 'var(--dc-primary, #0F766E)' : '#64748b' }}>({c.counterCode})</span>
                                  {hasLiveShift && (
                                    <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#16a34a', display: 'inline-block' }} title="Shift Active" />
                                  )}
                                  <span style={{
                                    fontSize: '0.74rem',
                                    color: isSelected ? '#15803d' : '#059669',
                                    fontWeight: 800,
                                    marginLeft: '2px',
                                  }}>
                                    {fmt(c.netSalesMinor)}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        )}

                        {/* Right: Toggle Tax & Profit Audit Details */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <button
                            type="button"
                            onClick={() => setShowCounterAuditColumns((prev) => !prev)}
                            style={{
                              background: showCounterAuditColumns ? 'var(--dc-primary-soft, #E6F4F3)' : '#ffffff',
                              border: `1px solid ${showCounterAuditColumns ? 'rgba(20, 184, 166, 0.4)' : '#cbd5e1'}`,
                              borderRadius: '8px',
                              padding: '6px 12px',
                              fontSize: '0.78rem',
                              fontWeight: 600,
                              color: showCounterAuditColumns ? 'var(--dc-primary, #0F766E)' : '#475569',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '5px',
                            }}
                            title="Toggle Taxable, GST & Gross Profit Audit Columns"
                          >
                            <EyeIcon size={14} style={{ color: showCounterAuditColumns ? 'var(--dc-primary)' : '#64748b' }} />
                            <span>{showCounterAuditColumns ? 'Hide Audit (GST/Profit)' : 'Audit (GST/Profit)'}</span>
                          </button>
                        </div>
                      </div>
                    );
                  })()}

                  {/* 2. Top Bento Summary Metrics Cards */}
                  {(() => {
                    const isFiltered = selectedCounterKeyFilter !== 'ALL';
                    const targetCounter = isFiltered ? counterSalesData.counters.find((c: any) => c.counterKey === selectedCounterKeyFilter) : null;
                    const summaryNet = targetCounter ? targetCounter.netSalesMinor : counterSalesData.consolidatedTotal?.netSalesMinor;
                    const summaryBills = targetCounter ? targetCounter.invoicesCount : counterSalesData.consolidatedTotal?.invoicesCount;
                    const summaryCash = targetCounter ? targetCounter.collections.cash : counterSalesData.consolidatedTotal?.collections?.cash;
                    const summaryUpi = targetCounter ? targetCounter.collections.upi : counterSalesData.consolidatedTotal?.collections?.upi;
                    const summaryReturns = targetCounter ? targetCounter.returnsTotalMinor : counterSalesData.consolidatedTotal?.returnsTotalMinor;
                    const summaryReturnsCount = targetCounter ? targetCounter.returnsCount : counterSalesData.consolidatedTotal?.returnsCount;

                    return (
                      <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                        gap: '12px',
                        marginBottom: '16px',
                      }}>
                        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '14px 16px', borderLeft: '4px solid #16a34a', boxShadow: '0 1px 3px rgba(15, 23, 42, 0.04)' }}>
                          <div style={{ fontSize: '0.74rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                            {isFiltered ? `${targetCounter?.counterName} Net Sales` : 'Consolidated Net Sales'}
                          </div>
                          <div style={{ fontSize: '1.45rem', fontWeight: 800, color: '#16a34a', marginTop: '4px' }}>
                            {fmt(summaryNet)}
                          </div>
                          <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '2px' }}>
                            {isFiltered ? `Counter ${targetCounter?.counterCode} revenue` : 'Store-wide register sales'}
                          </div>
                        </div>

                        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '14px 16px', borderLeft: '4px solid var(--dc-ring)', boxShadow: '0 1px 3px rgba(15, 23, 42, 0.04)' }}>
                          <div style={{ fontSize: '0.74rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                            Bills Issued
                          </div>
                          <div style={{ fontSize: '1.45rem', fontWeight: 800, color: '#0f172a', marginTop: '4px' }}>
                            {summaryBills} <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#64748b' }}>bills</span>
                          </div>
                          <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '2px' }}>
                            Checkout retail invoices
                          </div>
                        </div>

                        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '14px 16px', borderLeft: '4px solid #059669', boxShadow: '0 1px 3px rgba(15, 23, 42, 0.04)' }}>
                          <div style={{ fontSize: '0.74rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                            Cash in Drawer
                          </div>
                          <div style={{ fontSize: '1.45rem', fontWeight: 800, color: '#059669', marginTop: '4px' }}>
                            {fmt(summaryCash)}
                          </div>
                          <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '2px' }}>
                            Physical cash collections
                          </div>
                        </div>

                        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '14px 16px', borderLeft: '4px solid #0284c7', boxShadow: '0 1px 3px rgba(15, 23, 42, 0.04)' }}>
                          <div style={{ fontSize: '0.74rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                            UPI & Digital
                          </div>
                          <div style={{ fontSize: '1.45rem', fontWeight: 800, color: '#0284c7', marginTop: '4px' }}>
                            {fmt(summaryUpi)}
                          </div>
                          <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '2px' }}>
                            QR code, cards & digital
                          </div>
                        </div>

                        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '14px 16px', borderLeft: `4px solid ${summaryReturns > 0 ? '#dc2626' : '#cbd5e1'}`, boxShadow: '0 1px 3px rgba(15, 23, 42, 0.04)' }}>
                          <div style={{ fontSize: '0.74rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                            Returns / Credit Notes
                          </div>
                          <div style={{ fontSize: '1.45rem', fontWeight: 800, color: summaryReturns > 0 ? '#dc2626' : '#64748b', marginTop: '4px' }}>
                            {summaryReturns > 0 ? `-${fmt(summaryReturns)}` : '₹0.00'}
                          </div>
                          <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '2px' }}>
                            {summaryReturnsCount} return notes recorded
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {/* 3. DEDICATED TABLE VIEW */}
                  {selectedCounterKeyFilter !== 'ALL' ? (
                    /* -----------------------------------------------------------
                       VIEW A: SINGLE COUNTER SELECTED -> CASHIER-WISE SHIFT SESSIONS
                       ----------------------------------------------------------- */
                    (() => {
                      const targetCounter = counterSalesData.counters.find((c: any) => c.counterKey === selectedCounterKeyFilter);
                      if (!targetCounter) return null;
                      const cashiers = targetCounter.cashiers || [];
                      const shifts = targetCounter.shifts || [];

                      const visibleCashiers = selectedDetailCashierFilter === 'ALL'
                        ? cashiers
                        : cashiers.filter((c: any) => c.cashierId === selectedDetailCashierFilter);

                      return (
                        <div className="day-closing-card" style={{ boxShadow: '0 1px 3px rgba(15, 23, 42, 0.04)' }}>
                          <div className="day-closing-card-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
                            <div className="day-closing-card-title-group" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                              <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'var(--dc-primary-soft, #E6F4F3)', color: 'var(--dc-primary, #0F766E)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <Building2Icon size={20} />
                              </div>
                              <div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                  <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800, color: '#0f172a' }}>
                                    {targetCounter.counterName} ({targetCounter.counterCode}) — Cashier-wise Shift Sessions
                                  </h3>
                                  <span style={{ fontSize: '0.72rem', background: 'var(--dc-primary-soft, #E6F4F3)', color: 'var(--dc-sidebar, #0F2D2E)', border: '1px solid rgba(20, 184, 166, 0.4)', padding: '2px 8px', borderRadius: '6px', fontWeight: 700 }}>
                                    {cashiers.length} Cashier{cashiers.length !== 1 ? 's' : ''} on Duty
                                  </span>
                                  <span style={{ fontSize: '0.72rem', background: '#f1f5f9', color: '#334155', border: '1px solid #cbd5e1', padding: '2px 8px', borderRadius: '6px', fontWeight: 700 }}>
                                    {shifts.length} Total Shift{shifts.length !== 1 ? 's' : ''}
                                  </span>
                                  {targetCounter.activeShift && (
                                    <span style={{ fontSize: '0.72rem', background: '#dcfce7', color: '#15803d', border: '1px solid #86efac', padding: '2px 8px', borderRadius: '6px', fontWeight: 800, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                      <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#16a34a' }} />
                                      LIVE: #{targetCounter.activeShift.shiftNumber}
                                    </span>
                                  )}
                                </div>
                                <span style={{ fontSize: '0.78rem', color: '#64748b', marginTop: '2px', display: 'block' }}>
                                  Business Date: {selectedDate} · Cashier-wise chronological shift logs, live active shift tracking, and register reconciliation for {targetCounter.counterName}
                                </span>
                              </div>
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                              {/* View Mode Toggle: Shifts vs Cashier Summary */}
                              <div style={{ display: 'inline-flex', padding: '3px', background: '#f1f5f9', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                                <button
                                  type="button"
                                  onClick={() => setCounterDetailViewMode('shifts')}
                                  style={{
                                    padding: '5px 12px',
                                    fontSize: '0.76rem',
                                    fontWeight: 700,
                                    borderRadius: '6px',
                                    border: 'none',
                                    background: counterDetailViewMode === 'shifts' ? '#ffffff' : 'transparent',
                                    color: counterDetailViewMode === 'shifts' ? '#0f172a' : '#64748b',
                                    boxShadow: counterDetailViewMode === 'shifts' ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '5px',
                                  }}
                                >
                                  <ClockIcon size={13} />
                                  <span>Shift Sessions ({shifts.length})</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setCounterDetailViewMode('cashiers')}
                                  style={{
                                    padding: '5px 12px',
                                    fontSize: '0.76rem',
                                    fontWeight: 700,
                                    borderRadius: '6px',
                                    border: 'none',
                                    background: counterDetailViewMode === 'cashiers' ? '#ffffff' : 'transparent',
                                    color: counterDetailViewMode === 'cashiers' ? '#0f172a' : '#64748b',
                                    boxShadow: counterDetailViewMode === 'cashiers' ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '5px',
                                  }}
                                >
                                  <UserIcon size={13} />
                                  <span>Cashier Summary ({cashiers.length})</span>
                                </button>
                              </div>
                            </div>
                          </div>

                          {/* Cashier Filter Selector Bar when multiple cashiers exist */}
                          {cashiers.length > 1 && counterDetailViewMode === 'shifts' && (
                            <div style={{
                              padding: '10px 16px',
                              background: '#f8fafc',
                              borderBottom: '1px solid #e2e8f0',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '8px',
                              flexWrap: 'wrap',
                            }}>
                              <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#64748b' }}>Filter Cashier:</span>
                              <button
                                type="button"
                                onClick={() => setSelectedDetailCashierFilter('ALL')}
                                style={{
                                  padding: '3px 10px',
                                  fontSize: '0.75rem',
                                  fontWeight: 700,
                                  borderRadius: '6px',
                                  border: selectedDetailCashierFilter === 'ALL' ? '1px solid var(--dc-primary)' : '1px solid #cbd5e1',
                                  background: selectedDetailCashierFilter === 'ALL' ? 'var(--dc-primary-soft, #E6F4F3)' : '#ffffff',
                                  color: selectedDetailCashierFilter === 'ALL' ? 'var(--dc-primary, #0F766E)' : '#475569',
                                  cursor: 'pointer',
                                }}
                              >
                                All Cashiers ({cashiers.length})
                              </button>
                              {cashiers.map((c: any) => {
                                const isSelected = selectedDetailCashierFilter === c.cashierId;
                                const hasLive = c.shifts?.some((s: any) => s.status === 'open');
                                return (
                                  <button
                                    key={c.cashierId}
                                    type="button"
                                    onClick={() => setSelectedDetailCashierFilter(c.cashierId)}
                                    style={{
                                      padding: '3px 10px',
                                      fontSize: '0.75rem',
                                      fontWeight: 700,
                                      borderRadius: '6px',
                                      border: isSelected ? '1px solid var(--dc-primary)' : '1px solid #cbd5e1',
                                      background: isSelected ? 'var(--dc-primary-soft, #E6F4F3)' : '#ffffff',
                                      color: isSelected ? 'var(--dc-primary, #0F766E)' : '#475569',
                                      cursor: 'pointer',
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: '5px',
                                    }}
                                  >
                                    <span>{c.cashierName}</span>
                                    <span style={{ fontSize: '0.68rem', opacity: 0.8 }}>({c.shifts?.length || 0})</span>
                                    {hasLive && (
                                      <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#16a34a' }} />
                                    )}
                                  </button>
                                );
                              })}
                            </div>
                          )}

                          <div className="data-table-container">
                            {counterDetailViewMode === 'shifts' ? (
                              /* ---------------- CASHIER-WISE SHIFT SESSIONS TABLE ---------------- */
                              <table className="analytics-table">
                                <thead>
                                  <tr style={{ background: '#f8fafc' }}>
                                    <th>Shift # & Status</th>
                                    <th>Cashier on Duty</th>
                                    <th>Shift Start Time</th>
                                    <th>Shift Close Time</th>
                                    <th style={{ textAlign: 'center' }}>Duration</th>
                                    <th style={{ textAlign: 'center' }}>Bills</th>
                                    <th>Net Sales</th>
                                    <th>Cash Collected</th>
                                    <th>UPI / Digital</th>
                                    <th>Returns</th>
                                    <th style={{ textAlign: 'center' }}>Action</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {visibleCashiers.length > 0 ? (
                                    visibleCashiers.map((cashier: any) => {
                                      const cashierShifts = (cashier.shifts || []).slice().sort((a: any, b: any) =>
                                        new Date(b.openedAt).getTime() - new Date(a.openedAt).getTime()
                                      );
                                      const hasLive = cashierShifts.some((s: any) => s.status === 'open');

                                      return (
                                        <React.Fragment key={cashier.cashierId}>
                                          {/* Group Header for Cashier (ensures zero shuffle) */}
                                          <tr style={{ background: '#f1f5f9', borderTop: '2px solid #cbd5e1' }}>
                                            <td colSpan={11} style={{ padding: '8px 14px' }}>
                                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                  <div style={{
                                                    width: '26px',
                                                    height: '26px',
                                                    borderRadius: '50%',
                                                    background: 'var(--dc-primary-soft, #E6F4F3)',
                                                    color: 'var(--dc-primary, #0F766E)',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    fontSize: '0.74rem',
                                                    fontWeight: 800,
                                                  }}>
                                                    {(cashier.cashierName || 'C').slice(0, 1).toUpperCase()}
                                                  </div>
                                                  <div>
                                                    <span style={{ fontWeight: 800, fontSize: '0.88rem', color: '#0f172a' }}>
                                                      {cashier.cashierName}
                                                    </span>
                                                    <span style={{ marginLeft: '6px', fontSize: '0.72rem', color: '#64748b', textTransform: 'capitalize' }}>
                                                      ({String(cashier.cashierRole || 'Cashier').toLowerCase()})
                                                    </span>
                                                  </div>
                                                  <span style={{
                                                    fontSize: '0.72rem',
                                                    fontWeight: 700,
                                                    padding: '2px 8px',
                                                    borderRadius: '6px',
                                                    background: '#ffffff',
                                                    border: '1px solid #cbd5e1',
                                                    color: '#334155',
                                                  }}>
                                                    {cashierShifts.length} Shift Session{cashierShifts.length !== 1 ? 's' : ''}
                                                  </span>
                                                  {hasLive && (
                                                    <span style={{
                                                      fontSize: '0.7rem',
                                                      fontWeight: 800,
                                                      padding: '2px 7px',
                                                      borderRadius: '5px',
                                                      background: '#dcfce7',
                                                      border: '1px solid #86efac',
                                                      color: '#15803d',
                                                      display: 'inline-flex',
                                                      alignItems: 'center',
                                                      gap: '4px',
                                                    }}>
                                                      <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#16a34a' }} />
                                                      LIVE SHIFT ACTIVE
                                                    </span>
                                                  )}
                                                </div>

                                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '0.78rem' }}>
                                                  <span>Bills: <strong>{cashier.invoicesCount || 0}</strong></span>
                                                  <span style={{ color: '#cbd5e1' }}>·</span>
                                                  <span>Net Sales: <strong style={{ color: '#16a34a' }}>{fmt(cashier.netSalesMinor || 0)}</strong></span>
                                                  <span style={{ color: '#cbd5e1' }}>·</span>
                                                  <span>Cash: <strong style={{ color: '#0f172a' }}>{fmt(cashier.collections?.cash || 0)}</strong></span>
                                                  <span style={{ color: '#cbd5e1' }}>·</span>
                                                  <span>UPI: <strong style={{ color: '#0284c7' }}>{fmt(cashier.collections?.upi || 0)}</strong></span>
                                                </div>
                                              </div>
                                            </td>
                                          </tr>

                                          {/* Cashier Shift Rows */}
                                          {cashierShifts.length > 0 ? (
                                            cashierShifts.map((sh: any) => {
                                              const isOpen = sh.status === 'open';
                                              return (
                                                <tr key={sh.shiftId} style={{ background: isOpen ? '#f0fdf4' : undefined }}>
                                                  <td>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                      <span
                                                        style={{
                                                          fontWeight: 800,
                                                          fontSize: '0.84rem',
                                                          color: isOpen ? '#15803d' : '#0f172a',
                                                          fontFamily: 'monospace',
                                                        }}
                                                      >
                                                        #{sh.shiftNumber}
                                                      </span>
                                                      <span
                                                        style={{
                                                          fontSize: '0.68rem',
                                                          padding: '2px 7px',
                                                          borderRadius: '5px',
                                                          fontWeight: 800,
                                                          background: isOpen ? '#dcfce7' : '#f1f5f9',
                                                          color: isOpen ? '#15803d' : '#475569',
                                                          border: `1px solid ${isOpen ? '#86efac' : '#cbd5e1'}`,
                                                          display: 'inline-flex',
                                                          alignItems: 'center',
                                                          gap: '4px',
                                                          letterSpacing: '0.5px',
                                                        }}
                                                      >
                                                        {isOpen && (
                                                          <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#16a34a' }} />
                                                        )}
                                                        <span>{isOpen ? 'LIVE' : 'Closed'}</span>
                                                      </span>
                                                    </div>
                                                  </td>
                                                  <td>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                      <div style={{
                                                        width: '24px',
                                                        height: '24px',
                                                        borderRadius: '50%',
                                                        background: 'var(--dc-primary-soft, #E6F4F3)',
                                                        color: 'var(--dc-primary, #0F766E)',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        fontSize: '0.7rem',
                                                        fontWeight: 800,
                                                      }}>
                                                        {(sh.cashierName || cashier.cashierName || 'C').slice(0, 1).toUpperCase()}
                                                      </div>
                                                      <div>
                                                        <div style={{ fontWeight: 700, fontSize: '0.82rem', color: '#0f172a' }}>
                                                          {sh.cashierName || cashier.cashierName}
                                                        </div>
                                                        <span style={{ fontSize: '0.66rem', color: '#64748b', textTransform: 'capitalize' }}>
                                                          {String(sh.cashierRole || cashier.cashierRole || 'Cashier').toLowerCase()}
                                                        </span>
                                                      </div>
                                                    </div>
                                                  </td>
                                                  <td>
                                                    <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#0f172a' }}>
                                                      {fmtDateTime(sh.openedAt)}
                                                    </div>
                                                  </td>
                                                  <td>
                                                    {isOpen ? (
                                                      <span style={{ color: '#cbd5e1', fontWeight: 600 }}>—</span>
                                                    ) : (
                                                      <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#334155' }}>
                                                        {fmtDateTime(sh.closedAt)}
                                                      </div>
                                                    )}
                                                  </td>
                                                  <td style={{ textAlign: 'center' }}>
                                                    <span style={{
                                                      fontSize: '0.74rem',
                                                      fontWeight: 700,
                                                      padding: '2px 8px',
                                                      borderRadius: '6px',
                                                      background: isOpen ? '#dcfce7' : '#f8fafc',
                                                      border: `1px solid ${isOpen ? '#bbf7d0' : '#e2e8f0'}`,
                                                      color: isOpen ? '#15803d' : '#475569',
                                                    }}>
                                                      {isOpen ? `Active (${fmtDuration(sh.openedAt, null)})` : fmtDuration(sh.openedAt, sh.closedAt)}
                                                    </span>
                                                  </td>
                                                  <td style={{ textAlign: 'center' }}>
                                                    <strong style={{ fontSize: '0.88rem' }}>{sh.invoicesCount || 0}</strong>
                                                  </td>
                                                  <td>
                                                    <strong style={{ fontSize: '0.92rem', color: (sh.netSalesMinor || 0) > 0 ? '#16a34a' : '#64748b' }}>
                                                      {fmt(sh.netSalesMinor || 0)}
                                                    </strong>
                                                  </td>
                                                  <td>
                                                    <span style={{ fontWeight: 600, color: '#0f172a', fontSize: '0.84rem' }}>
                                                      {fmt(sh.collections?.cash || 0)}
                                                    </span>
                                                  </td>
                                                  <td>
                                                    <span style={{ fontWeight: 600, color: '#0284c7', fontSize: '0.84rem' }}>
                                                      {fmt(sh.collections?.upi || 0)}
                                                    </span>
                                                  </td>
                                                  <td style={{ color: (sh.returnsTotalMinor || 0) > 0 ? '#dc2626' : '#64748b', fontWeight: (sh.returnsTotalMinor || 0) > 0 ? 700 : 400, fontSize: '0.84rem' }}>
                                                    {(sh.returnsTotalMinor || 0) > 0 ? `-${fmt(sh.returnsTotalMinor)}` : '₹0.00'}
                                                  </td>
                                                  <td style={{ textAlign: 'center' }}>
                                                    <button
                                                      type="button"
                                                      onClick={() => {
                                                        setSelectedCounterId(targetCounter.counterId || targetCounter.counterCode);
                                                        setSelectedCashierId(sh.cashierId || cashier.cashierId || '');
                                                        setSelectedShiftId(sh.shiftId || '');
                                                        setActiveTab('closing');
                                                      }}
                                                      className="btn-reconcile-nav"
                                                      style={{ padding: '4px 10px', fontSize: '0.74rem' }}
                                                      title={`Reconcile Shift #${sh.shiftNumber}`}
                                                    >
                                                      <span>Reconcile</span>
                                                      <ArrowRightIcon size={11} />
                                                    </button>
                                                  </td>
                                                </tr>
                                              );
                                            })
                                          ) : (
                                            <tr>
                                              <td colSpan={11} style={{ textAlign: 'center', padding: '16px', color: '#94a3b8', fontSize: '0.8rem' }}>
                                                No shifts recorded for {cashier.cashierName} today.
                                              </td>
                                            </tr>
                                          )}
                                        </React.Fragment>
                                      );
                                    })
                                  ) : (
                                    <tr>
                                      <td colSpan={11} style={{ textAlign: 'center', padding: '24px', color: '#94a3b8' }}>
                                        No shifts recorded for {targetCounter.counterName} on {selectedDate}.
                                      </td>
                                    </tr>
                                  )}
                                </tbody>
                                <tfoot>
                                  <tr style={{ background: '#f8fafc', fontWeight: 800, borderTop: '2px solid #cbd5e1' }}>
                                    <td colSpan={2}>{targetCounter.counterName.toUpperCase()} TOTAL</td>
                                    <td colSpan={3} style={{ color: '#475569', fontSize: '0.78rem' }}>
                                      {shifts.length} Total Shift Session{shifts.length !== 1 ? 's' : ''} Today
                                    </td>
                                    <td style={{ textAlign: 'center' }}>{targetCounter.invoicesCount}</td>
                                    <td style={{ color: '#16a34a', fontSize: '1rem' }}>{fmt(targetCounter.netSalesMinor)}</td>
                                    <td>{fmt(targetCounter.collections?.cash || 0)}</td>
                                    <td>{fmt(targetCounter.collections?.upi || 0)}</td>
                                    <td style={{ color: targetCounter.returnsTotalMinor > 0 ? '#dc2626' : '#64748b' }}>
                                      {targetCounter.returnsTotalMinor > 0 ? `-${fmt(targetCounter.returnsTotalMinor)}` : '₹0.00'}
                                    </td>
                                    <td style={{ textAlign: 'center' }}>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setSelectedCounterId(targetCounter.counterId || targetCounter.counterCode);
                                          setSelectedCashierId('');
                                          setActiveTab('closing');
                                        }}
                                        className="btn-reconcile-nav-all"
                                        style={{ padding: '4px 10px', fontSize: '0.74rem' }}
                                      >
                                        <span>Full Register</span>
                                        <ArrowRightIcon size={11} />
                                      </button>
                                    </td>
                                  </tr>
                                </tfoot>
                              </table>
                            ) : (
                              /* ---------------- CASHIER SUMMARY TABLE ---------------- */
                              <table className="analytics-table">
                                <thead>
                                  <tr style={{ background: '#f8fafc' }}>
                                    <th>Cashier on Duty</th>
                                    <th>Shift Count & Status</th>
                                    <th style={{ textAlign: 'center' }}>Bills</th>
                                    <th>Net Sales</th>
                                    <th>Cash Collected</th>
                                    <th>UPI / Digital</th>
                                    <th>Returns</th>
                                    <th>Contribution</th>
                                    <th style={{ textAlign: 'center' }}>Action</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {cashiers.length > 0 ? (
                                    cashiers.map((cashier: any) => {
                                      const contributionPct = targetCounter.netSalesMinor > 0
                                        ? Math.round((cashier.netSalesMinor / targetCounter.netSalesMinor) * 1000) / 10
                                        : 0;
                                      const hasLiveShift = cashier.shifts?.some((s: any) => s.status === 'open');

                                      return (
                                        <tr key={cashier.cashierId}>
                                          <td>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                              <div style={{
                                                width: '28px',
                                                height: '28px',
                                                borderRadius: '50%',
                                                background: 'var(--dc-primary-soft, #E6F4F3)',
                                                color: 'var(--dc-primary, #0F766E)',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                fontSize: '0.75rem',
                                                fontWeight: 800,
                                              }}>
                                                {(cashier.cashierName || 'C').slice(0, 1).toUpperCase()}
                                              </div>
                                              <div>
                                                <div style={{ fontWeight: 700, fontSize: '0.88rem', color: '#0f172a' }}>
                                                  {cashier.cashierName}
                                                </div>
                                                <span style={{ fontSize: '0.7rem', color: '#64748b', textTransform: 'capitalize' }}>
                                                  {String(cashier.cashierRole || 'Cashier').toLowerCase()}
                                                </span>
                                              </div>
                                            </div>
                                          </td>
                                          <td>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                                              <span style={{
                                                fontSize: '0.74rem',
                                                padding: '3px 8px',
                                                borderRadius: '6px',
                                                fontWeight: 700,
                                                background: '#f1f5f9',
                                                color: '#334155',
                                                border: '1px solid #cbd5e1',
                                              }}>
                                                {cashier.shifts?.length || 0} Shift{(cashier.shifts?.length || 0) !== 1 ? 's' : ''}
                                              </span>
                                              {hasLiveShift && (
                                                <span style={{
                                                  fontSize: '0.72rem',
                                                  padding: '2px 7px',
                                                  borderRadius: '5px',
                                                  fontWeight: 700,
                                                  background: '#dcfce7',
                                                  color: '#15803d',
                                                  border: '1px solid #86efac',
                                                  display: 'inline-flex',
                                                  alignItems: 'center',
                                                  gap: '4px',
                                                }}>
                                                  <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#16a34a' }} />
                                                  <span>Active Now</span>
                                                </span>
                                              )}
                                            </div>
                                          </td>
                                          <td style={{ textAlign: 'center' }}>
                                            <strong style={{ fontSize: '0.9rem' }}>{cashier.invoicesCount}</strong>
                                          </td>
                                          <td>
                                            <strong style={{ fontSize: '1rem', color: '#16a34a' }}>{fmt(cashier.netSalesMinor)}</strong>
                                          </td>
                                          <td>
                                            <span style={{ fontWeight: 600, color: '#0f172a' }}>{fmt(cashier.collections.cash)}</span>
                                          </td>
                                          <td>
                                            <span style={{ fontWeight: 600, color: '#0284c7' }}>{fmt(cashier.collections.upi)}</span>
                                          </td>
                                          <td style={{ color: cashier.returnsTotalMinor > 0 ? '#dc2626' : '#64748b', fontWeight: cashier.returnsTotalMinor > 0 ? 700 : 400 }}>
                                            {cashier.returnsTotalMinor > 0 ? `-${fmt(cashier.returnsTotalMinor)}` : '₹0.00'}
                                          </td>
                                          <td>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                              <div style={{ width: '48px', height: '6px', borderRadius: '3px', background: '#e2e8f0', overflow: 'hidden' }}>
                                                <div style={{ width: `${Math.min(100, contributionPct)}%`, height: '100%', background: 'var(--dc-primary)' }} />
                                              </div>
                                              <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--dc-primary, #0F766E)' }}>
                                                {contributionPct}%
                                              </span>
                                            </div>
                                          </td>
                                          <td style={{ textAlign: 'center' }}>
                                            <button
                                              type="button"
                                              onClick={() => {
                                                setSelectedCounterId(targetCounter.counterId || targetCounter.counterCode);
                                                setSelectedCashierId(cashier.cashierId);
                                                setActiveTab('closing');
                                              }}
                                              className="btn-reconcile-nav"
                                              style={{ padding: '4px 10px', fontSize: '0.74rem' }}
                                              title={`Audit & Reconcile ${cashier.cashierName}`}
                                            >
                                              <span>Reconcile</span>
                                              <ArrowRightIcon size={11} />
                                            </button>
                                          </td>
                                        </tr>
                                      );
                                    })
                                  ) : (
                                    <tr>
                                      <td colSpan={9} style={{ textAlign: 'center', padding: '24px', color: '#94a3b8' }}>
                                        No cashier transactions recorded for this counter on {selectedDate}.
                                      </td>
                                    </tr>
                                  )}
                                </tbody>
                                <tfoot>
                                  <tr style={{ background: '#f8fafc', fontWeight: 800, borderTop: '2px solid #cbd5e1' }}>
                                    <td>{targetCounter.counterName.toUpperCase()} TOTAL</td>
                                    <td>{targetCounter.shiftsCount || cashiers.length} Shift(s) Registered</td>
                                    <td style={{ textAlign: 'center' }}>{targetCounter.invoicesCount}</td>
                                    <td style={{ color: '#16a34a', fontSize: '1.05rem' }}>{fmt(targetCounter.netSalesMinor)}</td>
                                    <td>{fmt(targetCounter.collections?.cash || 0)}</td>
                                    <td>{fmt(targetCounter.collections?.upi || 0)}</td>
                                    <td style={{ color: targetCounter.returnsTotalMinor > 0 ? '#dc2626' : '#64748b' }}>
                                      {targetCounter.returnsTotalMinor > 0 ? `-${fmt(targetCounter.returnsTotalMinor)}` : '₹0.00'}
                                    </td>
                                    <td style={{ color: 'var(--dc-primary)' }}>100%</td>
                                    <td style={{ textAlign: 'center' }}>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setSelectedCounterId(targetCounter.counterId || targetCounter.counterCode);
                                          setSelectedCashierId('');
                                          setActiveTab('closing');
                                        }}
                                        className="btn-reconcile-nav-all"
                                        style={{ padding: '4px 10px', fontSize: '0.74rem' }}
                                      >
                                        <span>Full Register</span>
                                        <ArrowRightIcon size={11} />
                                      </button>
                                    </td>
                                  </tr>
                                </tfoot>
                              </table>
                            )}
                          </div>
                        </div>
                      );
                    })()
                  ) : (
                    /* -----------------------------------------------------------
                       VIEW B: "ALL COUNTERS" -> CONSOLIDATED STORE COUNTERS TABLE
                       ----------------------------------------------------------- */
                    <div className="day-closing-card" style={{ boxShadow: '0 1px 3px rgba(15, 23, 42, 0.04)' }}>
                      <div className="day-closing-card-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div className="day-closing-card-title-group">
                          <Building2Icon size={18} style={{ color: 'var(--dc-primary)' }} />
                          <span>Store Counters & Cashier Performance Breakdown ({selectedDate})</span>
                        </div>
                        <span className="day-closing-card-badge">
                          {counterSalesData.counters.length} Counter Registers
                        </span>
                      </div>

                      <div className="data-table-container">
                        <table className="analytics-table">
                          <thead>
                            <tr style={{ background: '#f8fafc' }}>
                              <th>Counter Register</th>
                              <th>Cashiers on Duty</th>
                              <th style={{ textAlign: 'center' }}>Bills</th>
                              <th>Net Sales</th>
                              <th>Cash Collected</th>
                              <th>UPI / Digital</th>
                              <th>Returns</th>
                              {showCounterAuditColumns && (
                                <>
                                  <th>Taxable</th>
                                  <th>GST</th>
                                  <th>Gross Profit</th>
                                  <th>Margin</th>
                                </>
                              )}
                              <th style={{ textAlign: 'center' }}>Action</th>
                            </tr>
                          </thead>
                          <tbody>
                            {counterSalesData.counters.map((c: any) => {
                              const cashiers = c.cashiers || [];
                              const activeShift = c.activeShift;

                              return (
                                <tr key={c.counterKey} style={c.isException ? { background: '#fffbeb' } : {}}>
                                  <td>
                                    <div>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                        <strong style={{ fontSize: '0.9rem', color: '#0f172a' }}>{c.counterName}</strong>
                                        {c.isException ? (
                                          <span style={{ fontSize: '0.68rem', background: '#fef3c7', color: '#92400e', padding: '2px 6px', borderRadius: '4px', fontWeight: 700 }}>
                                            EXCEPTION
                                          </span>
                                        ) : (
                                          <span style={{ fontSize: '0.72rem', color: 'var(--dc-primary, #0F766E)', background: 'var(--dc-primary-soft, #E6F4F3)', padding: '2px 6px', borderRadius: '4px', fontWeight: 700 }}>
                                            {c.counterCode}
                                          </span>
                                        )}
                                      </div>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '3px' }}>
                                        {activeShift ? (
                                          <span style={{ fontSize: '0.7rem', color: '#15803d', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 600 }}>
                                            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#16a34a' }} />
                                            Shift #{activeShift.shiftNumber} (Live Shift)
                                          </span>
                                        ) : c.shiftsCount > 0 ? (
                                          <span style={{ fontSize: '0.7rem', color: '#64748b' }}>
                                            {c.shiftsCount} shift(s) closed
                                          </span>
                                        ) : (
                                          <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>
                                            No shifts today
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  </td>
                                  <td>
                                    {cashiers.length > 0 ? (
                                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                                        {cashiers.map((cashier: any) => (
                                          <span
                                            key={cashier.cashierId}
                                            style={{
                                              fontSize: '0.75rem',
                                              background: '#f1f5f9',
                                              border: '1px solid #e2e8f0',
                                              color: '#334155',
                                              padding: '2px 8px',
                                              borderRadius: '6px',
                                              fontWeight: 600,
                                              display: 'inline-flex',
                                              alignItems: 'center',
                                              gap: '4px',
                                            }}
                                          >
                                            <UserIcon size={11} style={{ color: '#64748b' }} />
                                            <span>{cashier.cashierName}</span>
                                            <span style={{ color: '#16a34a', fontWeight: 700 }}>
                                              ({cashier.invoicesCount} bills)
                                            </span>
                                          </span>
                                        ))}
                                      </div>
                                    ) : (
                                      <span style={{ fontSize: '0.75rem', color: '#94a3b8', fontStyle: 'italic' }}>
                                        None
                                      </span>
                                    )}
                                  </td>
                                  <td style={{ textAlign: 'center' }}>
                                    <strong style={{ fontSize: '0.88rem' }}>{c.invoicesCount}</strong>
                                  </td>
                                  <td>
                                    <strong style={{ fontSize: '0.95rem', color: '#16a34a' }}>{fmt(c.netSalesMinor)}</strong>
                                  </td>
                                  <td>
                                    <span style={{ fontWeight: 600, color: '#0f172a' }}>{fmt(c.collections.cash)}</span>
                                  </td>
                                  <td>
                                    <span style={{ fontWeight: 600, color: '#0284c7' }}>{fmt(c.collections.upi)}</span>
                                  </td>
                                  <td style={{ color: c.returnsTotalMinor > 0 ? '#dc2626' : '#64748b', fontWeight: c.returnsTotalMinor > 0 ? 700 : 400 }}>
                                    {c.returnsTotalMinor > 0 ? `-${fmt(c.returnsTotalMinor)}` : '₹0.00'}
                                  </td>

                                  {showCounterAuditColumns && (
                                    <>
                                      <td>{fmt(c.taxableSalesMinor)}</td>
                                      <td>{fmt(c.gstCollectedMinor)}</td>
                                      <td style={{ fontWeight: 700, color: 'var(--dc-primary)' }}>{fmt(c.grossProfitMinor)}</td>
                                      <td>{c.marginPct}%</td>
                                    </>
                                  )}

                                  <td style={{ textAlign: 'center' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                                      <button
                                        type="button"
                                        onClick={() => setSelectedCounterKeyFilter(c.counterKey)}
                                        style={{
                                          background: 'var(--dc-primary-soft, #E6F4F3)',
                                          border: '1px solid rgba(20, 184, 166, 0.4)',
                                          color: 'var(--dc-primary, #0F766E)',
                                          borderRadius: '6px',
                                          padding: '4px 10px',
                                          fontSize: '0.75rem',
                                          fontWeight: 700,
                                          cursor: 'pointer',
                                          display: 'flex',
                                          alignItems: 'center',
                                          gap: '4px',
                                        }}
                                        title={`View Cashier Breakdown for ${c.counterName}`}
                                      >
                                        <UserIcon size={12} />
                                        <span>Cashiers ({cashiers.length})</span>
                                        <ArrowRightIcon size={11} />
                                      </button>

                                      {!c.isException ? (
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setSelectedCounterId(c.counterId || c.counterCode);
                                            setSelectedCashierId('');
                                            setActiveTab('closing');
                                          }}
                                          className="btn-reconcile-nav"
                                          title={`Open Register Closing for ${c.counterName}`}
                                        >
                                          <span>Register</span>
                                          <ArrowRightIcon size={12} />
                                        </button>
                                      ) : (
                                        <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>Unassigned</span>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>

                          <tfoot>
                            <tr style={{ background: '#f8fafc', fontWeight: 800, borderTop: '2px solid #cbd5e1' }}>
                              <td>CONSOLIDATED TOTAL</td>
                              <td>{counterSalesData.counters.length} Active Registers</td>
                              <td style={{ textAlign: 'center' }}>{counterSalesData.consolidatedTotal?.invoicesCount}</td>
                              <td style={{ color: '#16a34a', fontSize: '0.95rem' }}>{fmt(counterSalesData.consolidatedTotal?.netSalesMinor)}</td>
                              <td>{fmt(counterSalesData.consolidatedTotal?.collections?.cash)}</td>
                              <td style={{ color: '#0284c7' }}>{fmt(counterSalesData.consolidatedTotal?.collections?.upi)}</td>
                              <td style={{ color: '#dc2626' }}>-{fmt(counterSalesData.consolidatedTotal?.returnsTotalMinor)}</td>

                              {showCounterAuditColumns && (
                                <>
                                  <td>{fmt(counterSalesData.consolidatedTotal?.taxableSalesMinor)}</td>
                                  <td>{fmt(counterSalesData.consolidatedTotal?.gstCollectedMinor)}</td>
                                  <td style={{ color: 'var(--dc-primary)' }}>{fmt(counterSalesData.consolidatedTotal?.grossProfitMinor)}</td>
                                  <td>{counterSalesData.consolidatedTotal?.marginPct}%</td>
                                </>
                              )}

                              <td style={{ textAlign: 'center' }}>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSelectedCounterId('');
                                    setSelectedCashierId('');
                                    setActiveTab('closing');
                                  }}
                                  className="btn-reconcile-nav-all"
                                  title="Open Store-wide Consolidated Register Closing"
                                >
                                  <span>Full Register</span>
                                  <ArrowRightIcon size={12} />
                                </button>
                              </td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    </div>
                  )}
                </>
              ) : null}
            </>
          )}
        </div>
      )}

      {/* ====================================================================
          TAB 2: TODAY VS PREVIOUS DAY COMPARISON
          ==================================================================== */}
      {activeTab === 'comparison' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {loadingComparison ? (
            <div style={{ padding: '3rem', textAlign: 'center', background: '#ffffff', borderRadius: '16px', border: '1px solid #e2e8f0' }}>
              <RefreshCwIcon size={32} className="animate-spin" style={{ margin: '0 auto 12px auto', color: 'var(--dc-ring)' }} />
              <p style={{ fontSize: '0.9rem', fontWeight: 600, color: '#64748b' }}>Calculating daily comparisons and trend analytics...</p>
            </div>
          ) : comparisonData ? (
            <>
              {/* Comprehensive Comparison Table */}
              <div className="day-closing-card">
                <div className="day-closing-card-header">
                  <div className="day-closing-card-title-group">
                    <ScaleIcon size={18} style={{ color: 'var(--dc-primary)' }} />
                    <span>Detailed Variance & Growth Comparison ({comparisonData.bdate || comparisonData.currentDate} vs {comparisonData.previousDate})</span>
                  </div>
                </div>

                <div className="data-table-container">
                  <table className="analytics-table">
                    <thead>
                      <tr>
                        <th>Metric</th>
                        <th>Current Period ({comparisonData.bdate || comparisonData.currentDate})</th>
                        <th>Previous Business Day ({comparisonData.previousDate})</th>
                        <th>Difference</th>
                        <th>Growth %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(comparisonData.metrics || {}).map(([key, m]: [string, any]) => {
                        const isCount = key.toLowerCase().includes('count');
                        const isGrowthPos = (m.growthPct || 0) > 0;
                        const isGrowthNeg = (m.growthPct || 0) < 0;
                        const diff = m.diff ?? m.difference ?? ((m.current ?? 0) - (m.previous ?? 0));

                        const labelMap: Record<string, string> = {
                          grossSales: 'Gross Sales (excl. GST)',
                          discounts: 'Total Discounts Given',
                          totalDiscounts: 'Total Discounts Given',
                          returns: 'Sales Returns (Credit Notes)',
                          salesReturns: 'Sales Returns (Credit Notes)',
                          netSales: 'Net Sales Revenue',
                          gstCollected: 'GST Collected',
                          cogs: 'Cost of Goods Sold (COGS)',
                          grossProfit: 'Gross Profit',
                          expenses: 'Operating Expenses',
                          operatingProfit: 'Net Operating Profit',
                          netProfit: 'Net Operating Profit',
                          invoicesCount: 'Total Invoices Issued',
                          invoiceCount: 'Total Invoices Issued',
                          averageBillValue: 'Average Bill Value',
                          refundsPaid: 'Refunds Paid Out',
                        };

                        return (
                          <tr key={key}>
                            <td style={{ fontWeight: 700, color: '#0f172a' }}>{labelMap[key] || key}</td>
                            <td style={{ fontWeight: 800 }}>{isCount ? m.current : fmt(m.current)}</td>
                            <td style={{ color: '#64748b' }}>{isCount ? m.previous : fmt(m.previous)}</td>
                            <td style={{ fontWeight: 700, color: diff >= 0 ? '#15803d' : '#b91c1c' }}>
                              {diff >= 0 ? '+' : ''}{isCount ? diff : fmt(diff)}
                            </td>
                            <td>
                              <span className={`growth-badge ${isGrowthPos ? 'positive' : isGrowthNeg ? 'negative' : 'neutral'}`}>
                                {isGrowthPos ? '+' : isGrowthNeg ? '-' : ''}{Math.abs(m.growthPct || 0).toFixed(1)}%
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : null}
        </div>
      )}

      {/* ====================================================================
          TAB 3: CUSTOM DATE RANGE ANALYTICS
          ==================================================================== */}
      {activeTab === 'analytics' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {/* Date Range Selector Card */}
          <div className="day-closing-card">
            <div className="day-closing-card-header">
              <div className="day-closing-card-title-group">
                <BarChart3Icon size={18} style={{ color: 'var(--dc-primary)' }} />
                <span>Custom Date Range Business Analysis</span>
              </div>

              <div className="preset-pills-bar">
                {[
                  { id: 'today', label: 'Today' },
                  { id: 'yesterday', label: 'Yesterday' },
                  { id: 'last_7_days', label: 'Last 7 Days' },
                  { id: 'this_month', label: 'This Month' },
                  { id: 'last_month', label: 'Last Month' },
                ].map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => handleApplyPreset(p.id)}
                    className={`preset-pill-btn ${analyticsPreset === p.id ? 'active' : ''}`}
                    disabled={loadingAnalytics}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
                  >
                    {loadingAnalytics && activeLoadingPreset === p.id && (
                      <RefreshCwIcon size={12} className="animate-spin" />
                    )}
                    <span>{p.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
              <div className="day-closing-filter-item">
                <span>Start Date:</span>
                <input
                  type="date"
                  value={analyticsStartDate}
                  onChange={(e) => {
                    setAnalyticsStartDate(e.target.value);
                    setAnalyticsPreset('custom');
                  }}
                  className="day-closing-input"
                />
              </div>

              <div className="day-closing-filter-item">
                <span>End Date:</span>
                <input
                  type="date"
                  value={analyticsEndDate}
                  onChange={(e) => {
                    setAnalyticsEndDate(e.target.value);
                    setAnalyticsPreset('custom');
                  }}
                  className="day-closing-input"
                />
              </div>

              <button
                type="button"
                onClick={() => loadAnalytics(analyticsStartDate, analyticsEndDate, 'calculate')}
                disabled={loadingAnalytics}
                className="btn-approve"
                style={{ background: 'var(--dc-primary)', display: 'flex', alignItems: 'center', gap: '0.45rem', cursor: loadingAnalytics ? 'not-allowed' : 'pointer' }}
              >
                <RefreshCwIcon size={14} className={(loadingAnalytics && analyticsLoadingSource === 'calculate') ? 'animate-spin' : ''} />
                Calculate Range
              </button>
            </div>
          </div>

          {loadingAnalytics && !analyticsData ? (
            <div style={{ padding: '3rem', textAlign: 'center', background: '#ffffff', borderRadius: '16px', border: '1px solid #e2e8f0' }}>
              <RefreshCwIcon size={32} className="animate-spin" style={{ margin: '0 auto 12px auto', color: 'var(--dc-ring)' }} />
              <p style={{ fontSize: '0.9rem', fontWeight: 600, color: '#64748b' }}>Aggregating multi-day financial records...</p>
            </div>
          ) : analyticsData?.current ? (
            <div style={{ opacity: loadingAnalytics ? 0.6 : 1, transition: 'opacity 0.2s ease', pointerEvents: loadingAnalytics ? 'none' : 'auto' }}>
              {/* Range Financial Summary Grid */}
              <div className="financial-kpi-grid">
                <div className="fin-kpi-card blue">
                  <div className="fin-kpi-top">
                    <span className="fin-kpi-label">Gross Sales</span>
                    <div className="fin-kpi-icon"><TrendingUpIcon size={14} /></div>
                  </div>
                  <div className="fin-kpi-val">{fmt(analyticsData.current.grossSalesMinor)}</div>
                  <span className="fin-kpi-sub">Total billed before tax</span>
                </div>

                <div className="fin-kpi-card rose">
                  <div className="fin-kpi-top">
                    <span className="fin-kpi-label">Returns</span>
                    <div className="fin-kpi-icon"><RotateCcwIcon size={14} /></div>
                  </div>
                  <div className="fin-kpi-val" style={{ color: '#e11d48' }}>-{fmt(analyticsData.current.returnsMinor ?? analyticsData.current.returnsTotalMinor ?? 0)}</div>
                  <span className="fin-kpi-sub">Total returned goods</span>
                </div>

                <div className="fin-kpi-card green highlight">
                  <div className="fin-kpi-top">
                    <span className="fin-kpi-label">Net Sales</span>
                    <div className="fin-kpi-icon"><RupeeIcon size={14} /></div>
                  </div>
                  <div className="fin-kpi-val">{fmt(analyticsData.current.netSalesMinor)}</div>
                  <span className="fin-kpi-sub">Net revenue realized</span>
                </div>

                <div className="fin-kpi-card purple">
                  <div className="fin-kpi-top">
                    <span className="fin-kpi-label">Gross Profit</span>
                    <div className="fin-kpi-icon"><TrendingUpIcon size={14} /></div>
                  </div>
                  <div className="fin-kpi-val" style={{ color: 'var(--dc-primary, #0F766E)' }}>{fmt(analyticsData.current.grossProfitMinor)}</div>
                  <span className="fin-kpi-sub">{((analyticsData.current.grossMarginPct || 0)).toFixed(1)}% Gross Margin</span>
                </div>

                <div className="fin-kpi-card amber">
                  <div className="fin-kpi-top">
                    <span className="fin-kpi-label">Expenses</span>
                    <div className="fin-kpi-icon"><ArrowUpRightIcon size={14} /></div>
                  </div>
                  <div className="fin-kpi-val">{fmt(analyticsData.current.expensesMinor)}</div>
                  <span className="fin-kpi-sub">Operating costs</span>
                </div>

                <div className="fin-kpi-card green">
                  <div className="fin-kpi-top">
                    <span className="fin-kpi-label">Operating Profit</span>
                    <div className="fin-kpi-icon"><RupeeIcon size={14} /></div>
                  </div>
                  <div className="fin-kpi-val" style={{ color: ((analyticsData.current.netProfitMinor ?? analyticsData.current.operatingProfitMinor) || 0) >= 0 ? '#15803d' : '#b91c1c' }}>
                    {fmt(analyticsData.current.netProfitMinor ?? analyticsData.current.operatingProfitMinor ?? 0)}
                  </div>
                  <span className="fin-kpi-sub">{((analyticsData.current.netMarginPct || 0)).toFixed(1)}% Net Margin</span>
                </div>
              </div>

              {/* Range Daily Series Breakdown */}
              {analyticsData.dailySeries && analyticsData.dailySeries.length > 0 && (
                <div className="day-closing-card">
                  <div className="day-closing-card-header">
                    <div className="day-closing-card-title-group">
                      <FileTextIcon size={18} style={{ color: 'var(--dc-primary)' }} />
                      <span>Daily Breakdown in Range ({appliedAnalyticsRange.startDate} to {appliedAnalyticsRange.endDate})</span>
                    </div>
                    <span className="day-closing-card-badge">
                      {analyticsData.dailySeries.length} Days Recorded
                    </span>
                  </div>

                  <div className="data-table-container">
                    <table className="analytics-table">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Invoices Count</th>
                          <th>Gross Sales</th>
                          <th>Net Sales</th>
                          <th>Gross Profit</th>
                        </tr>
                      </thead>
                      <tbody>
                        {analyticsData.dailySeries.map((d: any) => (
                          <tr key={d.date}>
                            <td style={{ fontWeight: 800, color: '#0f172a' }}>{d.date}</td>
                            <td>{d.invoicesCount || 0}</td>
                            <td>{fmt(d.grossSalesMinor)}</td>
                            <td style={{ fontWeight: 700, color: '#15803d' }}>{fmt(d.netSalesMinor)}</td>
                            <td style={{ fontWeight: 800, color: 'var(--dc-primary)' }}>{fmt(d.grossProfitMinor)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </div>
      )}

      {/* ====================================================================
          TAB: SCHEDULES & COMPLIANCE MONITORING
          ==================================================================== */}
      {activeTab === 'compliance' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {loadingCompliance ? (
            <div style={{ padding: '3rem', textAlign: 'center', background: '#ffffff', borderRadius: '16px', border: '1px solid #e2e8f0' }}>
              <RefreshCwIcon size={32} className="animate-spin" style={{ margin: '0 auto 12px auto', color: 'var(--dc-primary)' }} />
              <p style={{ fontSize: '0.9rem', fontWeight: 600, color: '#64748b' }}>Checking closing compliance and register schedules...</p>
            </div>
          ) : complianceData ? (
            <>
              {/* Compliance KPI summary */}
              <div className="financial-kpi-grid compliance-kpi-grid">
                <div className="fin-kpi-card blue">
                  <span className="fin-kpi-title">Expected Closing Time</span>
                  <div className="fin-kpi-val" style={{ fontSize: '1.4rem' }}>{complianceData.expectedClosingTime}</div>
                  <span className="fin-kpi-sub">
                    {complianceData.isBranchOverdue ? (
                      <span style={{ color: '#dc2626', fontWeight: 700 }}>⚠️ {complianceData.minutesOverdue} mins Overdue</span>
                    ) : (
                      <span style={{ color: '#16a34a', fontWeight: 700 }}>✓ On Schedule</span>
                    )}
                  </span>
                </div>

                <div className="fin-kpi-card purple">
                  <span className="fin-kpi-title">Closing Progress</span>
                  <div className="fin-kpi-val">{complianceData.summary.completionPct}%</div>
                  <span className="fin-kpi-sub">{complianceData.summary.closedCount} of {complianceData.summary.totalRegisters} Registers Sealed</span>
                </div>

                <div className="fin-kpi-card emerald">
                  <span className="fin-kpi-title">Approved Registers</span>
                  <div className="fin-kpi-val">{complianceData.summary.closedCount}</div>
                  <span className="fin-kpi-sub">Audited & Reconciled</span>
                </div>

                <div className="fin-kpi-card orange">
                  <span className="fin-kpi-title">Pending / Submitted</span>
                  <div className="fin-kpi-val">{complianceData.summary.pendingCount + complianceData.summary.submittedCount}</div>
                  <span className="fin-kpi-sub">{complianceData.summary.submittedCount} Awaiting Review</span>
                </div>

                <div className="fin-kpi-card rose">
                  <span className="fin-kpi-title">Overdue Registers</span>
                  <div className="fin-kpi-val">{complianceData.summary.overdueCount}</div>
                  <span className="fin-kpi-sub">Past Expected Time</span>
                </div>
              </div>

              {/* Action Banner: Send Reminder */}
              <div className="compliance-action-banner bento-card-3d">
                <div className="compliance-action-banner-text">
                  <h3>Cashier Closing Reminders & Alerts</h3>
                  <p>
                    Send in-app reminder notification to all pending cashiers to seal their registers.
                    {complianceData.lastReminderSentAt && (
                      <span className="compliance-last-sent-chip">
                        (Last sent: {new Date(complianceData.lastReminderSentAt).toLocaleTimeString()} - {complianceData.lastReminderType})
                      </span>
                    )}
                  </p>
                </div>
                <button
                  onClick={() => handleSendReminder(null)}
                  disabled={sendingReminder}
                  className="btn-approve compliance-reminder-btn"
                >
                  <ClockIcon size={15} />
                  <span>{sendingReminder ? 'Sending...' : 'Send Reminder to All'}</span>
                </button>
              </div>

              {/* Two columns: Register Compliance Matrix (left 65%) and Schedule Settings Form (right 35%) */}
              <div className="compliance-layout-grid">
                {/* Cashier Register Status Grid */}
                <div className="day-closing-card">
                  <div className="day-closing-card-header">
                    <div className="day-closing-card-title-group">
                      <CheckCircleIcon size={18} style={{ color: 'var(--dc-primary)' }} />
                      <span>Cashier Register Compliance Matrix</span>
                    </div>
                    <span className="day-closing-card-badge">
                      {complianceData.cashierMatrix.length} Cashiers
                    </span>
                  </div>

                  <div className="data-table-container">
                    <table className="analytics-table">
                      <thead>
                        <tr>
                          <th>Cashier</th>
                          <th>Role</th>
                          <th>Status</th>
                          <th>Physical Counted</th>
                          <th>Variance</th>
                          <th>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {complianceData.cashierMatrix.map((cm: any) => (
                          <tr key={cm.cashierId}>
                            <td>
                              <strong>{cm.cashierName}</strong>
                            </td>
                            <td style={{ fontSize: '0.75rem', color: '#64748b' }}>{cm.role}</td>
                            <td>
                              <span style={{
                                fontSize: '0.72rem',
                                padding: '2px 8px',
                                borderRadius: '9999px',
                                fontWeight: 700,
                                textTransform: 'uppercase',
                                background: cm.status === 'approved' || cm.status === 'closed' ? '#dcfce7' : (cm.status === 'submitted' ? '#dbeafe' : (cm.isOverdue ? '#fee2e2' : '#fef3c7')),
                                color: cm.status === 'approved' || cm.status === 'closed' ? '#15803d' : (cm.status === 'submitted' ? '#1d4ed8' : (cm.isOverdue ? '#b91c1c' : '#92400e')),
                              }}>
                                {cm.isOverdue ? 'OVERDUE' : cm.status}
                              </span>
                            </td>
                            <td>{cm.actualCashMinor != null ? fmt(cm.actualCashMinor) : '—'}</td>
                            <td style={{
                              fontWeight: 700,
                              color: cm.varianceMinor == null ? 'inherit' : (cm.varianceMinor === 0 ? '#15803d' : (cm.varianceMinor > 0 ? '#2563eb' : '#dc2626'))
                            }}>
                              {cm.varianceMinor != null ? ((cm.varianceMinor > 0 ? '+' : '') + fmt(cm.varianceMinor)) : '—'}
                            </td>
                            <td>
                              {cm.status !== 'approved' && cm.status !== 'closed' && (
                                <button
                                  onClick={() => handleSendReminder(cm.cashierId)}
                                  disabled={sendingReminder}
                                  className="day-closing-refresh-btn"
                                  style={{ padding: '0.25rem 0.5rem', fontSize: '0.72rem' }}
                                  title="Send individual reminder"
                                >
                                  Remind
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Schedule Settings Editor Form */}
                <div className="day-closing-card">
                  <div className="day-closing-card-header">
                    <div className="day-closing-card-title-group">
                      <ClockIcon size={18} style={{ color: 'var(--dc-primary)' }} />
                      <span>Closing Schedule Settings</span>
                    </div>
                  </div>

                  <form onSubmit={handleSaveSchedule} className="compliance-schedule-form">
                    <div>
                      <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                        Expected Closing Time (24h)
                      </label>
                      <input
                        type="time"
                        value={expClosingTime}
                        onChange={(e) => setExpClosingTime(e.target.value)}
                        className="day-closing-input"
                        style={{ width: '100%' }}
                        required
                      />
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                        1st Reminder (Minutes Before)
                      </label>
                      <input
                        type="number"
                        min="1"
                        max="180"
                        value={firstReminderMin}
                        onChange={(e) => setFirstReminderMin(Number(e.target.value))}
                        className="day-closing-input"
                        style={{ width: '100%' }}
                        required
                      />
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                        2nd Reminder (Minutes Before)
                      </label>
                      <input
                        type="number"
                        min="1"
                        max="60"
                        value={secondReminderMin}
                        onChange={(e) => setSecondReminderMin(Number(e.target.value))}
                        className="day-closing-input"
                        style={{ width: '100%' }}
                        required
                      />
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <input
                        type="checkbox"
                        id="finalRemCheckbox"
                        checked={finalReminder}
                        onChange={(e) => setFinalReminder(e.target.checked)}
                      />
                      <label htmlFor="finalRemCheckbox" style={{ fontSize: '0.8rem', color: '#334155', fontWeight: 600, cursor: 'pointer' }}>
                        Send Final Reminder at Expected Time
                      </label>
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                        Overdue Alert Repeat (Minutes)
                      </label>
                      <input
                        type="number"
                        min="5"
                        max="120"
                        value={overdueIntervalMin}
                        onChange={(e) => setOverdueIntervalMin(Number(e.target.value))}
                        className="day-closing-input"
                        style={{ width: '100%' }}
                        required
                      />
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <input
                        type="checkbox"
                        id="autoAlertCheckbox"
                        checked={autoAlert}
                        onChange={(e) => setAutoAlert(e.target.checked)}
                      />
                      <label htmlFor="autoAlertCheckbox" style={{ fontSize: '0.8rem', color: '#334155', fontWeight: 600, cursor: 'pointer' }}>
                        Auto-Alert When Overdue
                      </label>
                    </div>

                    <button
                      type="submit"
                      disabled={savingSchedule}
                      className="cash-rec-submit-btn"
                      style={{ marginTop: '8px' }}
                    >
                      {savingSchedule ? 'Saving...' : 'Save Schedule Settings'}
                    </button>
                  </form>
                </div>
              </div>
            </>
          ) : null}
        </div>
      )}

      {/* ====================================================================
          TAB 4: CLOSING HISTORY & AUDIT LOGS
          ==================================================================== */}
      {activeTab === 'history' && (
        <div className="day-closing-card">
          <div className="day-closing-card-header">
            <div className="day-closing-card-title-group">
              <ClockIcon size={18} style={{ color: 'var(--dc-primary)' }} />
              <span>Previous Day Closings & Sealed Audit Trail</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <button
                onClick={() => handleExportCsv()}
                className="day-closing-refresh-btn"
                title="Download all past day closings in CSV format"
              >
                <DownloadIcon size={14} />
                Export All CSV
              </button>
              <span className="day-closing-card-badge">
                {history.length} Records Logged
              </span>
            </div>
          </div>

          {loadingHistory ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>
              Loading history records...
            </div>
          ) : history.length === 0 ? (
            <div style={{ padding: '2.5rem', textAlign: 'center', color: '#94a3b8' }}>
              No day closing records found for this branch.
            </div>
          ) : (
            <div className="data-table-container">
              <table className="analytics-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Status</th>
                    <th>Gross Sales</th>
                    <th>Returns</th>
                    <th>Net Sales</th>
                    <th>Expected Cash</th>
                    <th>Actual Cash</th>
                    <th>Variance</th>
                    <th>Gross Profit</th>
                    <th>Submitted By</th>
                    <th>Approved By</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h) => {
                    const grossSales = Number(h.grossSalesMinor ?? h.gross_sales_minor ?? 0);
                    const returnsTotal = Number(h.returnsTotalMinor ?? h.returns_total_minor ?? h.sales_returns_minor ?? 0);
                    const netSales = Number(h.netSalesMinor ?? h.net_sales_minor ?? Math.max(0, grossSales - returnsTotal));
                    const expectedCash = Number(h.expectedCashMinor ?? h.expected_cash_minor ?? 0);
                    const actualCash = Number(h.actualCashMinor ?? h.actual_cash_minor ?? 0);
                    const variance = Number(h.varianceMinor ?? h.variance_minor ?? (actualCash - expectedCash));
                    const grossProfit = Number(h.grossProfitMinor ?? h.gross_profit_minor ?? 0);
                    const closedByName = h.closedByName || h.closed_by_name || 'Cashier';
                    const approvedByName = h.approvedByName || h.approved_by_name || '—';
                    const reopenedByName = h.reopenedByName || h.reopened_by_name;
                    const reopenReason = h.reopenReason || h.reopen_reason;
                    const closedAt = h.closedAt || h.closed_at;
                    const approvedAt = h.approvedAt || h.approved_at;
                    const status = h.status || 'closed';
                    const isExpanded = expandedHistoryId === h.id;

                    return (
                      <React.Fragment key={h.id}>
                        <tr
                          style={{ cursor: 'pointer' }}
                          onClick={() => setExpandedHistoryId(isExpanded ? null : h.id)}
                        >
                          <td style={{ fontWeight: 800, color: '#0f172a' }}>{h.bdate}</td>
                          <td>
                            <span style={{
                              padding: '2px 8px',
                              borderRadius: '9999px',
                              fontSize: '0.725rem',
                              fontWeight: 800,
                              textTransform: 'uppercase',
                              background: status === 'approved' || status === 'closed' ? 'var(--dc-primary-soft, #E6F4F3)' : status === 'submitted' ? '#fffbeb' : '#fff1f2',
                              color: status === 'approved' || status === 'closed' ? 'var(--dc-primary, #0F766E)' : status === 'submitted' ? '#92400e' : '#be123c',
                            }}>
                              {status}
                            </span>
                          </td>
                          <td>{fmt(grossSales)}</td>
                          <td style={{ color: '#e11d48' }}>-{fmt(returnsTotal)}</td>
                          <td style={{ fontWeight: 700, color: '#15803d' }}>{fmt(netSales)}</td>
                          <td>{fmt(expectedCash)}</td>
                          <td style={{ fontWeight: 700, color: '#0f172a' }}>{fmt(actualCash)}</td>
                          <td>
                            <span style={{
                              padding: '2px 8px',
                              borderRadius: '9999px',
                              fontSize: '0.725rem',
                              fontWeight: 800,
                              background: variance === 0 ? '#ecfdf5' : variance > 0 ? '#eff6ff' : '#fef2f2',
                              color: variance === 0 ? '#047857' : variance > 0 ? '#1d4ed8' : '#b91c1c',
                            }}>
                              {variance >= 0 ? '+' : ''}{fmt(variance)}
                            </span>
                          </td>
                          <td style={{ fontWeight: 700, color: 'var(--dc-primary)' }}>{fmt(grossProfit)}</td>
                          <td style={{ color: '#64748b' }}>{closedByName}</td>
                          <td style={{ color: '#64748b' }}>{approvedByName}</td>
                          <td style={{ textAlign: 'right' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '0.4rem' }}>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handlePrint(h.id);
                                }}
                                className="day-closing-refresh-btn"
                                style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem' }}
                                title="Print Statement"
                              >
                                Print
                              </button>

                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleExportCsv(h.id);
                                }}
                                className="day-closing-refresh-btn"
                                style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem' }}
                                title="Download CSV"
                              >
                                CSV
                              </button>

                              {(status === 'approved' || status === 'closed') && isOwner && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleOpenReopenModal(h.id);
                                  }}
                                  className="day-closing-refresh-btn"
                                  style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem', color: '#ea580c' }}
                                >
                                  Reopen
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>

                        {/* Expandable Audit Log Details Row */}
                        {isExpanded && (
                          <tr>
                            <td colSpan={12} style={{ background: '#f8fafc', padding: '1rem 1.25rem' }}>
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', fontSize: '0.8rem' }}>
                                <div>
                                  <div style={{ color: '#64748b', fontWeight: 600 }}>Submitted By</div>
                                  <div style={{ fontWeight: 800, color: '#0f172a' }}>{closedByName}</div>
                                  <div style={{ color: '#94a3b8', fontSize: '0.75rem' }}>
                                    {closedAt ? new Date(closedAt).toLocaleString('en-IN') : '—'}
                                  </div>
                                </div>

                                <div>
                                  <div style={{ color: '#64748b', fontWeight: 600 }}>Approved By</div>
                                  <div style={{ fontWeight: 800, color: '#0f172a' }}>{approvedByName || 'Pending Approval'}</div>
                                  <div style={{ color: '#94a3b8', fontSize: '0.75rem' }}>
                                    {approvedAt ? new Date(approvedAt).toLocaleString('en-IN') : '—'}
                                  </div>
                                </div>

                                <div>
                                  <div style={{ color: '#64748b', fontWeight: 600 }}>Reopened By</div>
                                  <div style={{ fontWeight: 800, color: reopenedByName ? '#b91c1c' : '#0f172a' }}>
                                    {reopenedByName || 'Not Reopened'}
                                  </div>
                                  {reopenReason && (
                                    <div style={{ color: '#991b1b', fontSize: '0.75rem', fontStyle: 'italic' }}>
                                      "{reopenReason}"
                                    </div>
                                  )}
                                </div>

                                <div>
                                  <div style={{ color: '#64748b', fontWeight: 600 }}>Closing Remarks / Note</div>
                                  <div style={{ fontWeight: 600, color: '#334155' }}>
                                    {h.remarks || 'No remarks recorded.'}
                                  </div>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* --------------------------------------------------------------------
          REOPEN DAY CLOSING MODAL DIALOG
          -------------------------------------------------------------------- */}
      {isReopenModalOpen && (
        <div className="day-closing-modal-backdrop" onClick={() => setIsReopenModalOpen(false)}>
          <div className="day-closing-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="day-closing-modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <AlertTriangleIcon size={20} style={{ color: '#ea580c' }} />
                <span className="day-closing-modal-title">Reopen Business Day</span>
              </div>
              <button
                onClick={() => setIsReopenModalOpen(false)}
                style={{ background: 'none', border: 'none', fontSize: '1.25rem', cursor: 'pointer', color: '#94a3b8' }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleConfirmReopen} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <p style={{ margin: 0, fontSize: '0.825rem', color: '#475569', lineHeight: 1.5 }}>
                Reopening a closed day unlocks invoices and shifts for adjustments. This audit event will be permanently recorded with your user ID and timestamp.
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                <label style={{ fontSize: '0.8rem', fontWeight: 700, color: '#334155' }}>
                  Mandatory Reopening Reason *
                </label>
                <textarea
                  rows={3}
                  required
                  value={reopenReason}
                  onChange={(e) => setReopenReason(e.target.value)}
                  placeholder="e.g. Backdated return entry required, cashier invoice adjustment"
                  className="cash-rec-remarks-input"
                />
              </div>

              {isManager && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                  <label style={{ fontSize: '0.8rem', fontWeight: 700, color: '#334155' }}>
                    Manager Authorization PIN / Password *
                  </label>
                  <input
                    type="password"
                    required
                    value={reopenPin}
                    onChange={(e) => setReopenPin(e.target.value)}
                    placeholder="Enter security PIN or account password"
                    className="day-closing-input"
                    style={{ width: '100%' }}
                  />
                  <span style={{ fontSize: '0.725rem', color: '#64748b' }}>
                    Authorized permission with secure PIN verification is required for managers.
                  </span>
                </div>
              )}

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
                <button
                  type="button"
                  onClick={() => setIsReopenModalOpen(false)}
                  className="day-closing-refresh-btn"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={reopening || reopenReason.trim().length < 5 || (isManager && !reopenPin.trim())}
                  className="btn-reopen"
                >
                  {reopening ? 'Reopening...' : 'Confirm & Reopen Day'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --------------------------------------------------------------------
          REJECT / RECOUNT MODAL DIALOG
          -------------------------------------------------------------------- */}
      {isRejectModalOpen && (
        <div className="day-closing-modal-backdrop" onClick={() => setIsRejectModalOpen(false)}>
          <div className="day-closing-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="day-closing-modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <RotateCcwIcon size={20} style={{ color: '#dc2626' }} />
                <span className="day-closing-modal-title">Reject Day Closing & Request Recount</span>
              </div>
              <button
                onClick={() => setIsRejectModalOpen(false)}
                style={{ background: 'none', border: 'none', fontSize: '1.25rem', cursor: 'pointer', color: '#94a3b8' }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleConfirmReject} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <p style={{ margin: 0, fontSize: '0.825rem', color: '#475569', lineHeight: 1.5 }}>
                Rejecting this closing submission returns the register to the Cashier for physical recount and adjustment. Please state the reason clearly.
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                <label style={{ fontSize: '0.8rem', fontWeight: 700, color: '#334155' }}>
                  Rejection & Recount Reason *
                </label>
                <textarea
                  rows={3}
                  required
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="e.g. Unexplained cash shortage of ₹200. Please recheck coin tray and physical drawer."
                  className="cash-rec-remarks-input"
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
                <button
                  type="button"
                  onClick={() => setIsRejectModalOpen(false)}
                  className="day-closing-refresh-btn"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={rejecting || rejectReason.trim().length < 5}
                  className="btn-reject"
                >
                  {rejecting ? 'Rejecting...' : 'Reject & Return to Cashier'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Slide-over Separate Shift Notifications Drawer */}
      {user?.role !== 'cashier' && showNotifDrawer && (
        <div className="day-closing-drawer-backdrop" onClick={() => setShowNotifDrawer(false)}>
          <div className="day-closing-drawer-panel" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="day-closing-drawer-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '10px',
                  background: 'var(--dc-primary-soft, #E6F4F3)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--dc-primary, #0F766E)',
                }}>
                  <BellRingIcon size={18} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '0.98rem', fontWeight: 700, color: '#0F172A' }}>
                    Shift & Register Notifications
                  </h3>
                  <span style={{ fontSize: '0.72rem', color: '#64748B' }}>
                    Live drawer float checks and shift closing summaries
                  </span>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {onNavigateToNotifications && (
                  <button
                    type="button"
                    onClick={() => {
                      setShowNotifDrawer(false);
                      onNavigateToNotifications();
                    }}
                    style={{
                      background: 'var(--dc-primary-soft, #E6F4F3)',
                      border: '1px solid rgba(20, 184, 166, 0.4)',
                      color: 'var(--dc-primary, #0F766E)',
                      fontSize: '0.72rem',
                      fontWeight: 700,
                      padding: '4px 8px',
                      borderRadius: '6px',
                      cursor: 'pointer',
                    }}
                  >
                    Full Page →
                  </button>
                )}
                {unreadNotifCount > 0 && (
                  <button
                    type="button"
                    onClick={handleMarkAllNotificationsRead}
                    style={{
                      background: '#F1F5F9',
                      border: '1px solid #CBD5E1',
                      color: '#334155',
                      fontSize: '0.72rem',
                      fontWeight: 600,
                      padding: '4px 8px',
                      borderRadius: '6px',
                      cursor: 'pointer',
                    }}
                  >
                    Mark all read
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowNotifDrawer(false)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    fontSize: '1.2rem',
                    color: '#64748B',
                    cursor: 'pointer',
                    padding: '4px 8px',
                    borderRadius: '6px',
                  }}
                  title="Close panel"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Filter Tabs */}
            <div className="day-closing-drawer-tabs">
              <button
                type="button"
                className={`day-closing-drawer-tab ${notifFilterTab === 'all' ? 'active' : ''}`}
                onClick={() => setNotifFilterTab('all')}
              >
                All ({notifications.length})
              </button>
              <button
                type="button"
                className={`day-closing-drawer-tab ${notifFilterTab === 'open' ? 'active' : ''}`}
                onClick={() => setNotifFilterTab('open')}
              >
                Shift Open ({notifications.filter((n: any) => n.type === 'shift_open').length})
              </button>
              <button
                type="button"
                className={`day-closing-drawer-tab ${notifFilterTab === 'close' ? 'active' : ''}`}
                onClick={() => setNotifFilterTab('close')}
              >
                Shift Close ({notifications.filter((n: any) => n.type === 'shift_close').length})
              </button>
            </div>

            {/* Notifications Body */}
            <div className="day-closing-drawer-body">
              {(() => {
                const filtered = notifications.filter((n: any) => {
                  if (notifFilterTab === 'open') return n.type === 'shift_open';
                  if (notifFilterTab === 'close') return n.type === 'shift_close';
                  return true;
                });

                if (filtered.length === 0) {
                  return (
                    <div style={{
                      padding: '40px 20px',
                      textAlign: 'center',
                      color: '#64748B',
                      background: '#F8FAFC',
                      borderRadius: '12px',
                      border: '1px dashed #CBD5E1',
                    }}>
                      <div style={{ marginBottom: '8px', color: '#94A3B8', display: 'flex', justifyContent: 'center' }}>
                        <BellRingIcon size={32} />
                      </div>
                      <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#1E293B', marginBottom: '4px' }}>
                        No Notifications
                      </div>
                      <div style={{ fontSize: '0.78rem' }}>
                        No shift activity matches this filter.
                      </div>
                    </div>
                  );
                }

                return filtered.map((n: any) => {
                  const isShiftOpen = n.type === 'shift_open';
                  const isShiftClose = n.type === 'shift_close';
                  let meta = n.metadata;
                  if (typeof meta === 'string') {
                    try { meta = JSON.parse(meta); } catch {}
                  }
                  meta = meta || {};

                  const isUnread = !n.isRead && !n.is_read;
                  const createdAt = n.createdAt || n.created_at;
                  const branchName = n.branchName || n.branch_name || meta.branchName || '';

                  return (
                    <div
                      key={n.id}
                      style={{
                        background: '#FFFFFF',
                        border: '1px solid #E2E8F0',
                        borderLeft: `4px solid ${isShiftOpen ? '#16A34A' : isShiftClose ? 'var(--dc-ring)' : '#F59E0B'}`,
                        borderRadius: '10px',
                        padding: '12px 14px',
                        boxShadow: '0 2px 4px rgba(15, 23, 42, 0.04)',
                        position: 'relative',
                      }}
                    >
                      {/* Card Head */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '6px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                          {isUnread && (
                            <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#EF4444', flexShrink: 0 }} title="Unread" />
                          )}
                          <strong style={{ fontSize: '0.85rem', color: '#0F172A', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {n.title}
                          </strong>
                        </div>
                        <span style={{
                          fontSize: '0.68rem',
                          fontWeight: 700,
                          padding: '2px 8px',
                          borderRadius: '10px',
                          background: isShiftOpen ? '#DCFCE7' : 'var(--dc-primary-soft, #E6F4F3)',
                          color: isShiftOpen ? '#15803D' : 'var(--dc-primary, #0F766E)',
                          whiteSpace: 'nowrap',
                        }}>
                          {isShiftOpen ? 'Drawer Open' : (meta.varianceText || 'Shift Closed')}
                        </span>
                      </div>

                      {/* Branch & Time ago */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px', fontSize: '0.72rem', color: '#64748B' }}>
                        {branchName && (
                          <span style={{ background: '#F1F5F9', padding: '1px 6px', borderRadius: '4px', fontWeight: 600, color: '#334155' }}>
                            {branchName}
                          </span>
                        )}
                        <span style={{ marginLeft: 'auto' }}>
                          {formatTimeAgo(createdAt)}
                        </span>
                      </div>

                      {/* Description Message */}
                      <p style={{ margin: '0 0 10px 0', fontSize: '0.78rem', color: '#334155', lineHeight: 1.45 }}>
                        {n.message}
                      </p>

                      {/* Stats Grid for Shift Open */}
                      {isShiftOpen && (
                        <div style={{
                          display: 'grid',
                          gridTemplateColumns: '1fr 1fr',
                          gap: '6px',
                          background: '#F8FAFC',
                          padding: '8px',
                          borderRadius: '8px',
                          border: '1px solid #E2E8F0',
                        }}>
                          <div>
                            <div style={{ fontSize: '0.64rem', textTransform: 'uppercase', color: '#64748B', fontWeight: 600 }}>Counter</div>
                            <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#0F172A' }}>{meta.counter || 'Counter 1'}</div>
                          </div>
                          <div>
                            <div style={{ fontSize: '0.64rem', textTransform: 'uppercase', color: '#64748B', fontWeight: 600 }}>Opening Float</div>
                            <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#16A34A' }}>{meta.openingCashFormatted || '₹0.00'}</div>
                          </div>
                        </div>
                      )}

                      {/* Stats Grid for Shift Close */}
                      {isShiftClose && (
                        <div style={{
                          display: 'grid',
                          gridTemplateColumns: '1fr 1fr 1fr 1fr',
                          gap: '6px',
                          background: '#F8FAFC',
                          padding: '8px',
                          borderRadius: '8px',
                          border: '1px solid #E2E8F0',
                        }}>
                          <div>
                            <div style={{ fontSize: '0.62rem', textTransform: 'uppercase', color: '#64748B', fontWeight: 600 }}>Sales</div>
                            <div style={{ fontSize: '0.76rem', fontWeight: 700, color: '#059669' }}>{meta.totalSalesFormatted || '₹0.00'}</div>
                          </div>
                          <div>
                            <div style={{ fontSize: '0.62rem', textTransform: 'uppercase', color: '#64748B', fontWeight: 600 }}>Bills</div>
                            <div style={{ fontSize: '0.76rem', fontWeight: 700, color: '#0F172A' }}>{meta.invoicesCount ?? 0}</div>
                          </div>
                          <div>
                            <div style={{ fontSize: '0.62rem', textTransform: 'uppercase', color: '#64748B', fontWeight: 600 }}>Returns</div>
                            <div style={{ fontSize: '0.76rem', fontWeight: 700, color: '#D97706' }}>{meta.returnsCount ?? 0}</div>
                          </div>
                          <div>
                            <div style={{ fontSize: '0.62rem', textTransform: 'uppercase', color: '#64748B', fontWeight: 600 }}>Drawer</div>
                            <div style={{ fontSize: '0.76rem', fontWeight: 700, color: 'var(--dc-primary)' }}>{meta.countedCashFormatted || '₹0.00'}</div>
                          </div>
                        </div>
                      )}

                      {/* Action / Dismiss */}
                      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '8px' }}>
                        <button
                          type="button"
                          onClick={() => handleDismissNotification(n.id)}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: '#64748B',
                            fontSize: '0.72rem',
                            cursor: 'pointer',
                            padding: '2px 6px',
                            borderRadius: '4px',
                          }}
                          title="Dismiss notification"
                        >
                          Dismiss
                        </button>
                      </div>
                    </div>
                  );
                });
              })()}
            </div>

            {/* Footer */}
            <div className="day-closing-drawer-footer">
              <span style={{ fontSize: '0.72rem', color: '#64748B' }}>
                Showing shift activity for {branches?.find((b: any) => b.id === activeBranchId)?.name || 'Branch'}
              </span>
              <button
                type="button"
                onClick={() => setShowNotifDrawer(false)}
                className="day-closing-refresh-btn"
                style={{ padding: '5px 12px', fontSize: '0.76rem' }}
              >
                Close Drawer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
