import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import axios from 'axios';
import {
  Users,
  HardDrive,
  IndianRupee,
  RotateCcw,
  Search,
  RefreshCw,
  ArrowLeft,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ShieldCheck,
  ShieldAlert,
  Calendar,
  CreditCard,
  Lock,
  Layers,
  Database,
  ExternalLink,
  ChevronDown,
  Info
} from 'lucide-react';
import toast, { Toaster } from 'react-hot-toast';
import { API_BASE_URL } from '../config';

const api = axios.create({
  baseURL: `${API_BASE_URL}/api`,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token') || sessionStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

const REFUND_MAX_PEAK_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });
  } catch {
    return '—';
  }
}

function formatPlanName(planId) {
  if (!planId) return 'Free';
  const id = String(planId).toLowerCase().trim();
  switch (id) {
    case 'tier_50gb':
    case 'essential':
      return 'Essential (50 GB)';
    case 'tier_100gb':
    case 'pro':
      return 'Pro (100 GB)';
    case 'tier_200gb':
    case 'ultra':
      return 'Ultra (200 GB)';
    case 'max':
      return 'Max';
    case 'trial':
      return 'Trial';
    case 'free':
      return 'Free';
    default:
      return id.charAt(0).toUpperCase() + id.slice(1);
  }
}

export default function AdminMonitor() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [data, setData] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState('all'); // all | paid | refund_eligible | peak_exceeded | past_due | expired
  const [resetTargetUser, setResetTargetUser] = useState(null);
  const [isResetting, setIsResetting] = useState(false);

  const fetchOverview = async (isManualRefresh = false) => {
    try {
      if (isManualRefresh) setRefreshing(true);
      const res = await api.get('/admin/overview');
      if (res.data?.success) {
        setData(res.data);
      } else {
        navigate('/dashboard', { replace: true });
      }
    } catch (err) {
      // 404 Cloaking: silent redirect without error toast
      navigate('/dashboard', { replace: true });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchOverview();
  }, []);

  const handleResetRefund = async () => {
    if (!resetTargetUser) return;
    try {
      setIsResetting(true);
      const res = await api.post(`/admin/users/${resetTargetUser._id}/reset-refund`);
      if (res.data?.success) {
        toast.success(`Vault for ${resetTargetUser.email} reset to expired 5 GB baseline.`);
        setResetTargetUser(null);
        await fetchOverview(false);
      } else {
        toast.error(res.data?.error || 'Failed to reset user vault.');
      }
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to reset user after refund.');
    } finally {
      setIsResetting(false);
    }
  };

  const users = data?.users || [];
  const metrics = data?.metrics || {
    totalUsers: 0,
    activePaidUsers: 0,
    pastDueUsers: 0,
    expiredUsers: 0,
    totalStorageUsedBytes: 0,
    totalStorageAllocatedBytes: 0,
    estimatedB2MonthlyINR: 0,
    totalRevenueINR: 0,
    refundEligibleCount: 0
  };

  const filteredUsers = useMemo(() => {
    return users.filter((u) => {
      // Filter tab
      if (activeFilter === 'paid') {
        const isPaid = u.subscription?.planId && u.subscription?.planId !== 'free';
        if (!isPaid || u.subscription?.status !== 'active') return false;
      } else if (activeFilter === 'refund_eligible') {
        if (!u.refundEligible) return false;
      } else if (activeFilter === 'peak_exceeded') {
        if (!u.exceeded2GBRoof) return false;
      } else if (activeFilter === 'past_due') {
        if (u.subscription?.status !== 'past_due') return false;
      } else if (activeFilter === 'expired') {
        if (u.subscription?.status !== 'expired') return false;
      }

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesName = u.name?.toLowerCase().includes(q);
        const matchesEmail = u.email?.toLowerCase().includes(q);
        const matchesOrderId = u.latestOrder?.orderId?.toLowerCase().includes(q);
        const matchesInvoice = u.latestOrder?.invoiceNumber?.toLowerCase().includes(q);
        if (!matchesName && !matchesEmail && !matchesOrderId && !matchesInvoice) {
          return false;
        }
      }

      return true;
    });
  }, [users, activeFilter, searchQuery]);

  if (loading || !data) {
    return <div className="min-h-screen bg-black" />;
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-neutral-100 font-sans selection:bg-neutral-800 pb-16">
      <Toaster position="top-right" toastOptions={{ style: { background: '#1c1c1e', color: '#fff', border: '1px solid #333' } }} />

      {/* Top Header */}
      <header className="border-b border-[#262626] bg-[#121212]/80 backdrop-blur-md sticky top-0 z-30 px-4 sm:px-8 py-3.5">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link
              to="/dashboard"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-neutral-400 hover:text-white hover:bg-neutral-800/80 transition-colors border border-transparent hover:border-[#333]"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Dashboard</span>
            </Link>
            <div className="h-4 w-px bg-neutral-800" />
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <h1 className="text-base font-semibold tracking-tight text-white">Founder Monitor</h1>
              <span className="text-[11px] font-mono uppercase px-2 py-0.5 rounded-full bg-neutral-800 text-neutral-400 border border-[#2e2e2e]">
                Cloaked
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => fetchOverview(true)}
              disabled={refreshing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-neutral-300 bg-[#1e1e1e] hover:bg-[#282828] border border-[#333] transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              <span>{refreshing ? 'Refreshing...' : 'Refresh'}</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-8 pt-8 space-y-8">
        {/* Metric Cards Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Card 1: Users */}
          <div className="bg-[#141414] border border-[#262626] rounded-2xl p-5 shadow-sm hover:border-[#383838] transition-colors">
            <div className="flex items-center justify-between text-neutral-400 mb-2">
              <span className="text-xs uppercase tracking-wider font-semibold">Total Accounts</span>
              <Users className="w-4 h-4 text-neutral-400" />
            </div>
            <div className="text-2xl font-bold text-white tracking-tight">
              {metrics.totalUsers.toLocaleString()}
            </div>
            <div className="mt-3 flex items-center gap-2 text-xs text-neutral-400">
              <span className="text-emerald-400 font-medium">{metrics.activePaidUsers} paid</span>
              <span>•</span>
              <span className="text-amber-400 font-medium">{metrics.pastDueUsers} grace</span>
              <span>•</span>
              <span className="text-neutral-500 font-medium">{metrics.expiredUsers} expired</span>
            </div>
          </div>

          {/* Card 2: B2 Storage & Est Cost */}
          <div className="bg-[#141414] border border-[#262626] rounded-2xl p-5 shadow-sm hover:border-[#383838] transition-colors">
            <div className="flex items-center justify-between text-neutral-400 mb-2">
              <span className="text-xs uppercase tracking-wider font-semibold">B2 Cloud Storage</span>
              <Database className="w-4 h-4 text-neutral-400" />
            </div>
            <div className="text-2xl font-bold text-white tracking-tight">
              {formatBytes(metrics.totalStorageUsedBytes)}
            </div>
            <div className="mt-3 flex items-center justify-between text-xs text-neutral-400">
              <span>Alloc: {formatBytes(metrics.totalStorageAllocatedBytes)}</span>
              <span className="text-neutral-300 font-mono">₹{metrics.estimatedB2MonthlyINR}/mo B2</span>
            </div>
          </div>

          {/* Card 3: Total Revenue */}
          <div className="bg-[#141414] border border-[#262626] rounded-2xl p-5 shadow-sm hover:border-[#383838] transition-colors">
            <div className="flex items-center justify-between text-neutral-400 mb-2">
              <span className="text-xs uppercase tracking-wider font-semibold">Total Revenue</span>
              <IndianRupee className="w-4 h-4 text-neutral-400" />
            </div>
            <div className="text-2xl font-bold text-white tracking-tight">
              ₹{metrics.totalRevenueINR.toLocaleString('en-IN')}
            </div>
            <div className="mt-3 text-xs text-neutral-400">
              <span>All confirmed Cashfree orders</span>
            </div>
          </div>

          {/* Card 4: Refund-Eligible Annual Users */}
          <div className="bg-[#141414] border border-[#262626] rounded-2xl p-5 shadow-sm hover:border-[#383838] transition-colors">
            <div className="flex items-center justify-between text-neutral-400 mb-2">
              <span className="text-xs uppercase tracking-wider font-semibold">Refund Eligible</span>
              <RotateCcw className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="text-2xl font-bold text-emerald-400 tracking-tight">
              {metrics.refundEligibleCount}
            </div>
            <div className="mt-3 text-xs text-neutral-400">
              <span>Annual plans ≤ 7 days & peak ≤ 2 GB</span>
            </div>
          </div>
        </div>

        {/* User Roster Table Section */}
        <div className="bg-[#141414] border border-[#262626] rounded-2xl shadow-sm overflow-hidden">
          {/* Controls Bar */}
          <div className="p-4 sm:p-5 border-b border-[#262626] flex flex-col md:flex-row gap-4 items-stretch md:items-center justify-between">
            {/* Search Input */}
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-neutral-500" />
              <input
                type="text"
                placeholder="Search user email, name, order ID..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-[#1e1e1e] border border-[#2f2f2f] rounded-xl pl-9 pr-4 py-2 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-neutral-500 transition-colors"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-neutral-500 hover:text-neutral-300"
                >
                  Clear
                </button>
              )}
            </div>

            {/* Filter Pills */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0 scrollbar-none">
              {[
                { id: 'all', label: 'All', count: users.length },
                { id: 'paid', label: 'Paid Active', count: metrics.activePaidUsers },
                { id: 'refund_eligible', label: 'Refund Eligible', count: metrics.refundEligibleCount },
                { id: 'peak_exceeded', label: 'Peak > 2GB', count: users.filter(u => u.exceeded2GBRoof).length },
                { id: 'past_due', label: 'Past Due', count: metrics.pastDueUsers },
                { id: 'expired', label: 'Expired', count: metrics.expiredUsers },
              ].map((f) => (
                <button
                  key={f.id}
                  onClick={() => setActiveFilter(f.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors flex items-center gap-1.5 ${
                    activeFilter === f.id
                      ? 'bg-white text-black font-semibold'
                      : 'bg-[#1c1c1c] text-neutral-400 hover:text-white hover:bg-[#252525] border border-[#2c2c2c]'
                  }`}
                >
                  <span>{f.label}</span>
                  <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                    activeFilter === f.id ? 'bg-neutral-200 text-black' : 'bg-neutral-800 text-neutral-400'
                  }`}>
                    {f.count}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-[#262626] bg-[#181818] text-neutral-400 font-semibold uppercase tracking-wider text-[11px]">
                  <th className="py-3 px-4">User</th>
                  <th className="py-3 px-4">Plan & Status</th>
                  <th className="py-3 px-4">Storage Used</th>
                  <th className="py-3 px-4">Peak Storage (2 GB Roof)</th>
                  <th className="py-3 px-4">7-Day Refund Status</th>
                  <th className="py-3 px-4">Latest Payment</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#202020]">
                {filteredUsers.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center py-12 text-neutral-500 text-sm">
                      No users match the current search / filter.
                    </td>
                  </tr>
                ) : (
                  filteredUsers.map((u) => {
                    const planId = u.subscription?.planId || u.plan || 'free';
                    const planDisplay = u.planLabel || formatPlanName(planId);
                    const billingCycle = u.subscription?.billingCycle || 'none';
                    const status = u.subscription?.status || 'active';
                    const peakBytes = u.peakBytes !== undefined ? u.peakBytes : Math.max(u.subscription?.peakStorageBytes || 0, u.storageUsed || 0);
                    const peakGB = (peakBytes / (1024 * 1024 * 1024)).toFixed(2);
                    const remainingDays = u.ageDays !== null ? Math.max(0, (7 - u.ageDays)).toFixed(1) : null;

                    const rawPlan = String(planId).toLowerCase();
                    const refundCount = u.refundCount !== undefined ? u.refundCount : (u.subscription?.refundCount || 0);
                    const hasRefundClaimed = refundCount >= 1 || u.refundIneligibleReason === 'Prior Refund Already Claimed' || Boolean(u.hasPriorRefund);
                    const canResetAfterRefund = u.refundEligible === true && refundCount === 0 && !hasRefundClaimed;

                    return (
                      <tr key={u._id} className="hover:bg-[#191919] transition-colors">
                        {/* User Column */}
                        <td className="py-3 px-4">
                          <div className="font-medium text-white truncate max-w-[180px]">
                            {u.name || 'Anonymous'}
                          </div>
                          <div className="text-neutral-400 text-[11px] truncate max-w-[200px]" title={u.email}>
                            {u.email}
                          </div>
                          <div className="text-[10px] text-neutral-500 mt-0.5">
                            Joined {formatDate(u.createdAt)}
                          </div>
                        </td>

                        {/* Plan & Status Column */}
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className={`px-2 py-0.5 rounded text-[11px] font-medium ${
                              rawPlan.includes('200') || rawPlan === 'ultra' ? 'bg-purple-950/60 text-purple-300 border border-purple-800/50' :
                              rawPlan.includes('100') || rawPlan === 'pro' ? 'bg-blue-950/60 text-blue-300 border border-blue-800/50' :
                              rawPlan.includes('50') || rawPlan === 'essential' ? 'bg-emerald-950/60 text-emerald-300 border border-emerald-800/50' :
                              rawPlan === 'max' ? 'bg-amber-950/60 text-amber-300 border border-amber-800/50' :
                              'bg-neutral-800 text-neutral-300 border border-neutral-700/60'
                            }`}>
                              {planDisplay}
                            </span>
                            {billingCycle !== 'none' && (
                              <span className="text-[10px] text-neutral-400 capitalize">
                                ({billingCycle})
                              </span>
                            )}
                          </div>
                          <div className="mt-1">
                            <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.2 rounded capitalize ${
                              status === 'active' ? 'bg-emerald-950/60 text-emerald-300 border border-emerald-800/40' :
                              status === 'past_due' ? 'bg-amber-950/60 text-amber-300 border border-amber-800/40' :
                              status === 'expired' ? 'bg-rose-950/60 text-rose-300 border border-rose-800/40' :
                              'text-neutral-500'
                            }`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${
                                status === 'active' ? 'bg-emerald-400' :
                                status === 'past_due' ? 'bg-amber-400' :
                                status === 'expired' ? 'bg-rose-400' : 'bg-neutral-500'
                              }`} />
                              {status}
                            </span>
                          </div>
                        </td>

                        {/* Storage Used */}
                        <td className="py-3 px-4">
                          <div className="font-mono text-neutral-200">
                            {formatBytes(u.storageUsed)}
                          </div>
                          <div className="text-[10px] text-neutral-500">
                            Limit: {formatBytes(u.storageLimit)}
                          </div>
                        </td>

                        {/* Peak Storage (2 GB Roof) */}
                        <td className="py-3 px-4">
                          <div className="font-mono text-neutral-200">
                            {formatBytes(peakBytes)}
                          </div>
                          <div className="mt-1">
                            {u.exceeded2GBRoof ? (
                              <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded bg-rose-950/60 text-rose-300 border border-rose-800/40">
                                <XCircle className="w-3 h-3 text-rose-400" />
                                Exceeded 2 GB ({peakGB} GB)
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded bg-emerald-950/40 text-emerald-300 border border-emerald-800/30">
                                <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                                Within 2 GB Roof
                              </span>
                            )}
                          </div>
                        </td>

                        {/* 7-Day Refund Status */}
                        <td className="py-3 px-4">
                          {u.refundEligible ? (
                            <div>
                              <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded bg-emerald-900/60 text-emerald-300 border border-emerald-700/60">
                                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                                ELIGIBLE ({remainingDays}d left)
                              </span>
                              <div className="text-[10px] text-emerald-400/80 mt-1">
                                Annual tier ≤ 7 days & peak ≤ 2 GB
                              </div>
                            </div>
                          ) : (
                            <div>
                              <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded bg-neutral-800 text-neutral-400 border border-neutral-700/40">
                                Ineligible: {u.refundIneligibleReason}
                              </span>
                              {u.ageDays !== null && (
                                <div className="text-[10px] text-neutral-500 mt-0.5">
                                  Age: {u.ageDays} days
                                </div>
                              )}
                            </div>
                          )}
                        </td>

                        {/* Latest Payment */}
                        <td className="py-3 px-4">
                          {u.latestOrder ? (
                            <div className="space-y-0.5">
                              <div className="font-semibold text-white">
                                ₹{u.latestOrder.amount}
                              </div>
                              <div className="text-[10px] font-mono text-neutral-400 truncate max-w-[140px]" title={u.latestOrder.orderId}>
                                {u.latestOrder.orderId}
                              </div>
                              <div className="text-[10px] text-neutral-500">
                                {formatDate(u.latestOrder.paidAt)}
                              </div>
                            </div>
                          ) : (
                            <span className="text-neutral-500 text-[11px]">No orders</span>
                          )}
                        </td>

                        {/* Actions */}
                        <td className="py-3 px-4 text-right">
                          {canResetAfterRefund ? (
                            <button
                              onClick={() => setResetTargetUser(u)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-neutral-300 bg-[#1e1e1e] hover:bg-neutral-800 hover:text-white border border-[#333] hover:border-neutral-500 transition-colors"
                              title="Reset user vault to expired 5 GB baseline after refunding via Cashfree"
                            >
                              <RotateCcw className="w-3 h-3 text-neutral-400" />
                              <span>Reset After Refund</span>
                            </button>
                          ) : hasRefundClaimed ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-neutral-800/80 text-neutral-400 border border-neutral-700/50">
                              Refund Used
                            </span>
                          ) : (
                            <span className="text-neutral-500 font-mono text-xs pr-3 select-none">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      {/* Confirmation Modal for Reset After Refund */}
      {resetTargetUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-[#141414] border border-[#2f2f2f] rounded-2xl max-w-md w-full p-6 space-y-5 shadow-2xl text-left">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-950/60 border border-amber-800/60 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5 text-amber-400" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-base font-semibold text-white">Reset User After Refund</h3>
                <p className="text-xs text-neutral-400 mt-1">
                  This action is intended to be executed <strong className="text-white">after</strong> you process the refund on the Cashfree dashboard.
                </p>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-[#1c1c1c] border border-[#2a2a2a] text-xs space-y-2">
              <div className="flex justify-between">
                <span className="text-neutral-400">Target User:</span>
                <span className="text-white font-medium truncate max-w-[200px]">{resetTargetUser.email}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-400">Current Plan:</span>
                <span className="text-white capitalize">
                  {resetTargetUser.planLabel || formatPlanName(resetTargetUser.subscription?.planId || resetTargetUser.plan || 'free')} ({resetTargetUser.subscription?.billingCycle || 'none'})
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-400">Current Storage:</span>
                <span className="text-white">{formatBytes(resetTargetUser.storageUsed)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-400">Peak Storage:</span>
                <span className="text-white">{formatBytes(resetTargetUser.peakBytes || 0)}</span>
              </div>
            </div>

            <div className="text-xs text-neutral-400 space-y-1 bg-neutral-900/50 p-3 rounded-lg border border-neutral-800">
              <p className="font-semibold text-neutral-300">Effects of this action:</p>
              <ul className="list-disc list-inside space-y-0.5 text-neutral-400">
                <li>Resets plan to free with 5 GB storage limit</li>
                <li>Write-locks uploads; sets 7-day download grace period if files exist before automated B2 deletion</li>
                <li>Clears trial eligibility so the user cannot re-enter trial</li>
                <li>Increments refund count (one-refund-per-account cap enforced)</li>
                <li>Marks latest payment as <code className="text-amber-400">REFUNDED</code></li>
              </ul>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setResetTargetUser(null)}
                disabled={isResetting}
                className="px-4 py-2 rounded-xl text-xs font-medium text-neutral-400 hover:text-white bg-[#1e1e1e] hover:bg-[#282828] border border-[#333] transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleResetRefund}
                disabled={isResetting}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 border border-rose-500 transition-colors disabled:opacity-50"
              >
                <RotateCcw className={`w-3.5 h-3.5 ${isResetting ? 'animate-spin' : ''}`} />
                <span>{isResetting ? 'Resetting...' : 'Confirm Vault Reset'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

