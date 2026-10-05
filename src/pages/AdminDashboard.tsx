import React, { useState, useEffect } from 'react';
import { 
  Lock, 
  Search, 
  Filter, 
  Download, 
  Eye, 
  CheckCircle2, 
  XCircle, 
  Clock, 
  TrendingUp, 
  Users, 
  CreditCard, 
  AlertTriangle,
  RefreshCw,
  LogOut,
  Building,
  Terminal,
  Activity,
  Calendar,
  X,
  FileSpreadsheet,
  Check,
  ShieldCheck
} from 'lucide-react';
import { Registration, PaymentRecord, AuditLog } from '../types.js';
import { googleSignIn, initAuth, logoutGoogle, getAccessToken } from '../lib/googleAuth.js';

interface AdminDashboardProps {
  onNavigateHome: () => void;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({ onNavigateHome }) => {
  // Authentication State
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('garg_admin_token'));
  const [adminUser, setAdminUser] = useState<any>(() => {
    const saved = localStorage.getItem('garg_admin_user');
    return saved ? JSON.parse(saved) : null;
  });

  // Login form state
  const [email, setEmail] = useState('admin@gargrealty.com');
  const [password, setPassword] = useState('AdminPassword@2026');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginLoading, setLoginLoading] = useState(false);

  // Dashboard Data State
  const [activeTab, setActiveTab] = useState<'overview' | 'registrations' | 'webhooks' | 'audit' | 'sheets'>('overview');
  const [metrics, setMetrics] = useState<any>(null);
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [pagination, setPagination] = useState({ total: 0, page: 1, limit: 15, totalPages: 1 });
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(false);

  // Google Sheets "Payment Domain" Integration State
  const [sheetsStatus, setSheetsStatus] = useState<any>(null);
  const [sheetsLoading, setSheetsLoading] = useState(false);
  const [googleUser, setGoogleUser] = useState<any>(null);
  const [syncFeedback, setSyncFeedback] = useState<string | null>(null);

  // Initialize Firebase Auth listener for Google Sheets
  useEffect(() => {
    initAuth(
      (user, token) => {
        setGoogleUser(user);
        // Automatically link token to backend
        fetch('/api/admin/google-sheets/connect', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${localStorage.getItem('garg_admin_token')}`
          },
          body: JSON.stringify({ accessToken: token, expiresIn: 3600 })
        }).then(() => fetchSheetsStatus()).catch(console.error);
      },
      () => {
        setGoogleUser(null);
      }
    );
  }, []);

  const fetchSheetsStatus = async () => {
    setSheetsLoading(true);
    try {
      const res = await fetch('/api/admin/google-sheets/status', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      setSheetsStatus(data);
    } catch (e) {
      console.error(e);
    } finally {
      setSheetsLoading(false);
    }
  };

  const handleGoogleSignInForSheets = async () => {
    try {
      setSheetsLoading(true);
      setSyncFeedback(null);
      const res = await googleSignIn();
      setGoogleUser(res.user);
      
      // Connect token with backend
      const connectRes = await fetch('/api/admin/google-sheets/connect', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ accessToken: res.accessToken, expiresIn: 3600 })
      });
      const connectData = await connectRes.json();
      if (connectData.success) {
        setSyncFeedback(`Successfully connected! Synchronized ${connectData.syncResult?.synced || 0} record(s) to "Payment Domain".`);
      }
      fetchSheetsStatus();
    } catch (err: any) {
      setSyncFeedback(`Google connection error: ${err.message}`);
    } finally {
      setSheetsLoading(false);
    }
  };

  const handleManualSyncAll = async () => {
    setSheetsLoading(true);
    setSyncFeedback(null);
    try {
      const res = await fetch('/api/admin/google-sheets/sync-all', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        setSyncFeedback(`Sync completed: ${data.syncResult?.synced} record(s) updated in "Payment Domain" (Errors: ${data.syncResult?.errors})`);
      } else {
        setSyncFeedback(`Sync failed: ${data.error}`);
      }
      fetchSheetsStatus();
    } catch (err: any) {
      setSyncFeedback(`Sync error: ${err.message}`);
    } finally {
      setSheetsLoading(false);
    }
  };

  const handleVerifyPendingUtr = async (regId: string) => {
    try {
      const res = await fetch('/api/admin/verify-payment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ registrationId: regId, verified: true })
      });
      const data = await res.json();
      if (data.success) {
        setSelectedReg(data.registration);
        fetchRegistrations(pagination.page);
        fetchOverview();
        fetchSheetsStatus();
        alert('Payment verified and confirmed as PAID! Record has been synchronized to "Payment Domain".');
      }
    } catch (e) {
      alert('Failed to verify payment');
    }
  };

  // Filters State
  const [searchQuery, setSearchQuery] = useState('');
  const [filterProject, setFilterProject] = useState('all');
  const [filterPaymentStatus, setFilterPaymentStatus] = useState('all');
  const [filterRegistrationStatus, setFilterRegistrationStatus] = useState('all');

  // Detail Modal State
  const [selectedReg, setSelectedReg] = useState<Registration | null>(null);
  const [selectedPayments, setSelectedPayments] = useState<PaymentRecord[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  // Webhook Simulator State
  const [webhookSimOrder, setWebhookSimOrder] = useState('');
  const [webhookSimType, setWebhookSimType] = useState<'payment.captured' | 'payment.failed'>('payment.captured');
  const [webhookResult, setWebhookResult] = useState<any>(null);
  const [webhookLoading, setWebhookLoading] = useState(false);

  // Handle Login
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginLoading(true);
    setLoginError(null);

    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Invalid credentials');
      }

      setToken(data.token);
      setAdminUser(data.user);
      localStorage.setItem('garg_admin_token', data.token);
      localStorage.setItem('garg_admin_user', JSON.stringify(data.user));
    } catch (err: any) {
      setLoginError(err.message || 'Login failed');
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = () => {
    setToken(null);
    setAdminUser(null);
    localStorage.removeItem('garg_admin_token');
    localStorage.removeItem('garg_admin_user');
  };

  // Fetch Dashboard Overview Metrics
  const fetchOverview = async () => {
    if (!token) return;
    try {
      setLoading(true);
      const res = await fetch('/api/admin/overview', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.status === 401) {
        handleLogout();
        return;
      }
      const data = await res.json();
      setMetrics(data.metrics);
      if (data.recentAudit) setAuditLogs(data.recentAudit);
    } catch (err) {
      console.error('Failed fetching admin overview:', err);
    } finally {
      setLoading(false);
    }
  };

  // Fetch Registrations Table
  const fetchRegistrations = async (page: number = 1) => {
    if (!token) return;
    try {
      setLoading(true);
      const params = new URLSearchParams({
        page: String(page),
        limit: '15',
        search: searchQuery,
        projectId: filterProject,
        paymentStatus: filterPaymentStatus,
        registrationStatus: filterRegistrationStatus
      });

      const res = await fetch(`/api/admin/registrations?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.status === 401) {
        handleLogout();
        return;
      }
      const data = await res.json();
      setRegistrations(data.registrations || []);
      setPagination(data.pagination);
    } catch (err) {
      console.error('Failed fetching registrations:', err);
    } finally {
      setLoading(false);
    }
  };

  // Fetch Audit Logs
  const fetchAuditLogs = async () => {
    if (!token) return;
    try {
      setLoading(true);
      const res = await fetch('/api/admin/audit-logs', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      setAuditLogs(data.auditLogs || []);
    } catch (err) {
      console.error('Failed fetching audit logs:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (token) {
      fetchOverview();
      fetchRegistrations(1);
    }
  }, [token]);

  // Open Detail Modal
  const openDetail = async (id: string) => {
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/admin/registration/${id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      setSelectedReg(data.registration);
      setSelectedPayments(data.payments || []);
    } catch (e) {
      console.error(e);
    } finally {
      setDetailLoading(false);
    }
  };

  // Update Status
  const handleUpdateStatus = async (regId: string, newRegStatus: string, newPaymentStatus: string) => {
    try {
      const res = await fetch(`/api/admin/registration/${regId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          registrationStatus: newRegStatus,
          paymentStatus: newPaymentStatus
        })
      });
      const data = await res.json();
      if (data.success) {
        setSelectedReg(data.registration);
        fetchRegistrations(pagination.page);
        fetchOverview();
      }
    } catch (e) {
      alert('Failed to update status');
    }
  };

  // Run Webhook Simulation
  const runWebhookSimulation = async () => {
    if (!webhookSimOrder.trim()) {
      alert('Please enter a Gateway Order ID (e.g. order_xxx)');
      return;
    }
    setWebhookLoading(true);
    setWebhookResult(null);
    try {
      const res = await fetch('/api/admin/webhook/simulate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          orderId: webhookSimOrder.trim(),
          eventType: webhookSimType
        })
      });
      const data = await res.json();
      setWebhookResult(data);
      fetchRegistrations(1);
      fetchOverview();
    } catch (e: any) {
      setWebhookResult({ error: e.message });
    } finally {
      setWebhookLoading(false);
    }
  };

  // CSV Export Trigger
  const handleExportCSV = () => {
    const params = new URLSearchParams({
      projectId: filterProject,
      paymentStatus: filterPaymentStatus,
      registrationStatus: filterRegistrationStatus
    });
    window.location.href = `/api/admin/export-csv?${params.toString()}`;
  };

  // 1. If not logged in, render Admin Login screen
  if (!token) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-8 border border-slate-700">
          
          <div className="text-center mb-6">
            <div className="w-12 h-12 bg-[#0f5973] text-white rounded-xl mx-auto flex items-center justify-center mb-3 shadow-md">
              <Lock className="w-6 h-6 text-amber-300" />
            </div>
            <h2 className="text-xl font-bold text-slate-900 font-['Playfair_Display']">
              Garg Realty Executive Portal
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Authorized admin, relationship manager & auditor access
            </p>
          </div>

          {loginError && (
            <div className="mb-4 p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-xs flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-500 flex-shrink-0" />
              <span>{loginError}</span>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Admin Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full px-3.5 py-2.5 text-xs rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-[#0f5973]"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full px-3.5 py-2.5 text-xs rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-[#0f5973]"
                required
              />
            </div>

            <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-[11px] text-slate-500">
              <p className="font-semibold text-slate-700 mb-0.5">Default Master Credentials:</p>
              <p>Email: <span className="font-mono text-slate-800">admin@gargrealty.com</span></p>
              <p>Password: <span className="font-mono text-slate-800">AdminPassword@2026</span></p>
            </div>

            <button
              type="submit"
              disabled={loginLoading}
              className="w-full py-2.5 bg-[#0f5973] hover:bg-[#0a4358] text-white font-bold text-xs uppercase tracking-wider rounded-lg shadow-sm transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {loginLoading ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              ) : (
                <span>Authenticate & Sign In</span>
              )}
            </button>

            <button
              type="button"
              onClick={onNavigateHome}
              className="w-full py-2 text-xs font-medium text-slate-500 hover:text-slate-800 transition-colors"
            >
              Return to Public Portal
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col font-sans">
      
      {/* Admin Top Header */}
      <header className="bg-slate-900 text-white border-b border-slate-800 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="font-bold text-sm tracking-wide text-amber-400 font-['Playfair_Display']">
              GARG REALTY GROUP
            </span>
            <span className="text-slate-600">|</span>
            <span className="text-xs text-slate-300 font-medium">
              Sales, Allotments & Payment Gateway Administration
            </span>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-2 text-xs text-slate-400">
              <span>Signed in as:</span>
              <span className="text-white font-semibold">{adminUser?.name || 'Administrator'}</span>
              <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-500/20 text-amber-300 font-mono border border-amber-500/30">
                {adminUser?.role || 'SUPER_ADMIN'}
              </span>
            </div>

            <button
              onClick={handleLogout}
              className="p-1.5 sm:px-2.5 sm:py-1 text-xs text-slate-400 hover:text-white hover:bg-slate-800 rounded transition-colors flex items-center gap-1 cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Logout</span>
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex gap-6 text-xs font-semibold">
          <button
            onClick={() => setActiveTab('overview')}
            className={`py-2.5 border-b-2 transition-colors cursor-pointer ${
              activeTab === 'overview' ? 'border-amber-400 text-amber-300' : 'border-transparent text-slate-400 hover:text-white'
            }`}
          >
            Dashboard Overview
          </button>
          <button
            onClick={() => {
              setActiveTab('registrations');
              fetchRegistrations(1);
            }}
            className={`py-2.5 border-b-2 transition-colors cursor-pointer ${
              activeTab === 'registrations' ? 'border-amber-400 text-amber-300' : 'border-transparent text-slate-400 hover:text-white'
            }`}
          >
            Registrations & Leads ({pagination.total})
          </button>
          <button
            onClick={() => setActiveTab('webhooks')}
            className={`py-2.5 border-b-2 transition-colors cursor-pointer ${
              activeTab === 'webhooks' ? 'border-amber-400 text-amber-300' : 'border-transparent text-slate-400 hover:text-white'
            }`}
          >
            Webhook & Gateway Simulator
          </button>
          <button
            onClick={() => {
              setActiveTab('audit');
              fetchAuditLogs();
            }}
            className={`py-2.5 border-b-2 transition-colors cursor-pointer ${
              activeTab === 'audit' ? 'border-amber-400 text-amber-300' : 'border-transparent text-slate-400 hover:text-white'
            }`}
          >
            System Audit Trail
          </button>
          <button
            onClick={() => {
              setActiveTab('sheets');
              fetchSheetsStatus();
            }}
            className={`py-2.5 border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'sheets' ? 'border-amber-400 text-amber-300' : 'border-transparent text-slate-400 hover:text-white'
            }`}
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>Google Sheets ("Payment Domain")</span>
          </button>
        </div>
      </header>

      {/* Main Admin Content Container */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex-1 w-full">
        
        {/* TAB 1: OVERVIEW */}
        {activeTab === 'overview' && metrics && (
          <div className="space-y-6">
            
            {/* KPI Cards Row */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
                <div className="flex items-center justify-between text-slate-500 mb-2">
                  <span className="text-xs font-semibold uppercase tracking-wider">Total Registrations</span>
                  <Users className="w-4 h-4 text-[#0f5973]" />
                </div>
                <p className="text-2xl font-extrabold text-slate-900">{metrics.totalRegistrations}</p>
                <div className="mt-2 text-[11px] text-slate-500">
                  Today: <span className="font-semibold text-slate-800">+{metrics.todayRegistrations}</span>
                </div>
              </div>

              <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
                <div className="flex items-center justify-between text-slate-500 mb-2">
                  <span className="text-xs font-semibold uppercase tracking-wider">Paid Bookings</span>
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                </div>
                <p className="text-2xl font-extrabold text-emerald-700">{metrics.paidRegistrations}</p>
                <div className="mt-2 text-[11px] text-slate-500">
                  Success rate: {metrics.totalRegistrations ? Math.round((metrics.paidRegistrations / metrics.totalRegistrations) * 100) : 0}%
                </div>
              </div>

              <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
                <div className="flex items-center justify-between text-slate-500 mb-2">
                  <span className="text-xs font-semibold uppercase tracking-wider">Pending / Initiated</span>
                  <Clock className="w-4 h-4 text-amber-500" />
                </div>
                <p className="text-2xl font-extrabold text-amber-600">{metrics.pendingPayments}</p>
                <div className="mt-2 text-[11px] text-slate-500">
                  Failed: <span className="text-rose-600 font-semibold">{metrics.failedPayments}</span>
                </div>
              </div>

              <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
                <div className="flex items-center justify-between text-slate-500 mb-2">
                  <span className="text-xs font-semibold uppercase tracking-wider">Verified Revenue</span>
                  <CreditCard className="w-4 h-4 text-[#0f5973]" />
                </div>
                <p className="text-2xl font-extrabold text-[#0f5973]">
                  ₹ {metrics.totalRevenue.toLocaleString('en-IN')}
                </p>
                <div className="mt-2 text-[11px] text-slate-500">
                  This Month: <span className="font-semibold text-slate-800">₹ {metrics.thisMonthRevenue.toLocaleString('en-IN')}</span>
                </div>
              </div>
            </div>

            {/* Quick Actions & Recent Stream */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              
              {/* Project Performance Breakdown */}
              <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 p-6 shadow-xs">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold text-sm text-[#0f5973] uppercase tracking-wide">
                    Project Allotments Performance
                  </h3>
                  <button
                    onClick={() => {
                      setActiveTab('registrations');
                      fetchRegistrations(1);
                    }}
                    className="text-xs font-semibold text-[#0f5973] hover:underline cursor-pointer"
                  >
                    View All Leads →
                  </button>
                </div>

                <div className="space-y-3">
                  {metrics.projectBreakdown?.map((pb: any, idx: number) => (
                    <div key={idx} className="p-3 bg-slate-50 rounded-lg border border-slate-100 flex items-center justify-between text-xs">
                      <div>
                        <p className="font-bold text-slate-800">{pb.name}</p>
                        <p className="text-[11px] text-slate-500">{pb.count} registrations · {pb.paidCount} verified paid</p>
                      </div>
                      <div className="text-right">
                        <span className="font-bold text-[#0f5973] text-sm">₹ {pb.revenue.toLocaleString('en-IN')}</span>
                        <p className="text-[10px] text-slate-400">Collected Tokens</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Subdomain & Gateway Deployment Health */}
              <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs flex flex-col justify-between">
                <div>
                  <h3 className="font-bold text-sm text-[#0f5973] uppercase tracking-wide mb-3">
                    Gateway & Subdomain Status
                  </h3>
                  
                  <div className="space-y-3 text-xs">
                    <div className="flex items-center justify-between p-2.5 rounded bg-slate-50">
                      <span className="text-slate-600">Subdomain Target:</span>
                      <span className="font-mono font-semibold text-slate-800">apply.yourdomain.com</span>
                    </div>

                    <div className="flex items-center justify-between p-2.5 rounded bg-slate-50">
                      <span className="text-slate-600">Payment Gateway:</span>
                      <span className="font-semibold text-emerald-700 flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Razorpay Ready
                      </span>
                    </div>

                    <div className="flex items-center justify-between p-2.5 rounded bg-slate-50">
                      <span className="text-slate-600">Webhook Security:</span>
                      <span className="font-semibold text-emerald-700">HMAC-SHA256</span>
                    </div>

                    <div className="flex items-center justify-between p-2.5 rounded bg-slate-50">
                      <span className="text-slate-600">CRM Lead Forwarder:</span>
                      <span className="font-semibold text-[#0f5973]">Active Adapter</span>
                    </div>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-100">
                  <button
                    onClick={() => setActiveTab('webhooks')}
                    className="w-full py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded transition-colors text-center cursor-pointer"
                  >
                    Open Webhook Test Simulator
                  </button>
                </div>
              </div>

            </div>
          </div>
        )}

        {/* TAB 2: REGISTRATIONS MANAGEMENT */}
        {activeTab === 'registrations' && (
          <div className="space-y-4">
            
            {/* Filter Bar */}
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex flex-col md:flex-row gap-3 items-center justify-between">
              <div className="flex flex-1 items-center gap-2 w-full">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') fetchRegistrations(1); }}
                    placeholder="Search applicant name, mobile, registration ref..."
                    className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-[#0f5973]"
                  />
                </div>

                <select
                  value={filterPaymentStatus}
                  onChange={e => setFilterPaymentStatus(e.target.value)}
                  className="px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white text-slate-700"
                >
                  <option value="all">All Payment Statuses</option>
                  <option value="PAID">PAID</option>
                  <option value="INITIATED">INITIATED</option>
                  <option value="FAILED">FAILED</option>
                </select>

                <button
                  onClick={() => fetchRegistrations(1)}
                  className="px-3 py-2 bg-[#0f5973] hover:bg-[#0a4358] text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer"
                >
                  Filter
                </button>
              </div>

              <div className="flex items-center gap-2 w-full md:w-auto justify-end">
                <button
                  onClick={handleExportCSV}
                  className="px-3 py-2 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer shadow-xs"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Export CSV</span>
                </button>
              </div>
            </div>

            {/* Registrations Table */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold uppercase tracking-wider text-[11px]">
                      <th className="py-3 px-4">Registration</th>
                      <th className="py-3 px-4">Applicant</th>
                      <th className="py-3 px-4">Mobile & City</th>
                      <th className="py-3 px-4">Project / Unit</th>
                      <th className="py-3 px-4">Token Payable</th>
                      <th className="py-3 px-4">Payment</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4">Date</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700">
                    {registrations.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="py-8 text-center text-slate-400">
                          No registrations found matching the specified filters.
                        </td>
                      </tr>
                    ) : (
                      registrations.map(r => (
                        <tr key={r.id} className="hover:bg-slate-50/80 transition-colors">
                          <td className="py-3 px-4 font-mono font-bold text-[#0f5973]">
                            {r.registration_number}
                          </td>
                          <td className="py-3 px-4 font-semibold text-slate-900">
                            {r.full_name}
                          </td>
                          <td className="py-3 px-4">
                            <div>{r.mobile}</div>
                            <div className="text-[10px] text-slate-400">{r.city}, {r.state}</div>
                          </td>
                          <td className="py-3 px-4">
                            <div className="font-medium text-slate-800">{r.project_name}</div>
                            <div className="text-[10px] text-slate-500 font-mono">Unit: {r.unit_number || 'N/A'}</div>
                          </td>
                          <td className="py-3 px-4 font-mono font-semibold">
                            ₹ {r.total_payable.toLocaleString('en-IN')}
                          </td>
                          <td className="py-3 px-4">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${
                              r.payment_status === 'PAID'
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : r.payment_status === 'FAILED'
                                  ? 'bg-rose-50 text-rose-700 border border-rose-200'
                                  : 'bg-amber-50 text-amber-700 border border-amber-200'
                            }`}>
                              {r.payment_status}
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            <span className="text-[11px] font-medium text-slate-600">
                              {r.registration_status}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-slate-500 text-[11px]">
                            {new Date(r.created_at).toLocaleDateString('en-IN', {
                              day: '2-digit',
                              month: 'short'
                            })}
                          </td>
                          <td className="py-3 px-4 text-right">
                            <button
                              onClick={() => openDetail(r.id)}
                              className="px-2.5 py-1 text-xs font-semibold text-[#0f5973] hover:bg-teal-50 rounded transition-colors inline-flex items-center gap-1 cursor-pointer"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              <span>View</span>
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {pagination.totalPages > 1 && (
                <div className="p-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs text-slate-600">
                  <span>Page {pagination.page} of {pagination.totalPages} ({pagination.total} records)</span>
                  <div className="flex gap-1">
                    <button
                      disabled={pagination.page <= 1}
                      onClick={() => fetchRegistrations(pagination.page - 1)}
                      className="px-2.5 py-1 bg-white border border-slate-200 rounded hover:bg-slate-100 disabled:opacity-40"
                    >
                      Prev
                    </button>
                    <button
                      disabled={pagination.page >= pagination.totalPages}
                      onClick={() => fetchRegistrations(pagination.page + 1)}
                      className="px-2.5 py-1 bg-white border border-slate-200 rounded hover:bg-slate-100 disabled:opacity-40"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 3: WEBHOOK & GATEWAY TESTING SIMULATOR */}
        {activeTab === 'webhooks' && (
          <div className="max-w-3xl mx-auto space-y-6">
            <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-xs">
              <div className="flex items-center gap-3 mb-4">
                <Terminal className="w-5 h-5 text-[#0f5973]" />
                <h3 className="font-bold text-sm text-[#0f5973] uppercase tracking-wide">
                  Razorpay Webhook & Idempotency Testing Console
                </h3>
              </div>

              <p className="text-xs text-slate-600 mb-6 leading-relaxed">
                This testing console executes authentic HMAC-SHA256 signed webhook events against <code className="bg-slate-100 px-1 py-0.5 rounded text-[#0f5973]">/api/payment/webhook</code> to verify server-side verification, payment state mutation, CRM synchronization, and idempotency protection against duplicate deliveries.
              </p>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Target Gateway Order ID <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={webhookSimOrder}
                    onChange={e => setWebhookSimOrder(e.target.value)}
                    placeholder="e.g. order_test_xxxxxx or copy from table"
                    className="w-full px-3.5 py-2 text-xs rounded-lg border border-slate-300 font-mono text-slate-800"
                  />
                  <p className="text-[11px] text-slate-400 mt-1">
                    Tip: You can use any active order ID created by the registration form.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Event Type</label>
                  <select
                    value={webhookSimType}
                    onChange={e => setWebhookSimType(e.target.value as any)}
                    className="w-full px-3.5 py-2 text-xs rounded-lg border border-slate-300 text-slate-800"
                  >
                    <option value="payment.captured">payment.captured (Success)</option>
                    <option value="payment.failed">payment.failed (Decline)</option>
                  </select>
                </div>

                <button
                  type="button"
                  onClick={runWebhookSimulation}
                  disabled={webhookLoading}
                  className="px-6 py-2.5 bg-[#0f5973] hover:bg-[#0a4358] text-white text-xs font-bold uppercase tracking-wider rounded-lg shadow-sm transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  {webhookLoading ? (
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  ) : (
                    <span>Dispatch Webhook Event to /api/payment/webhook</span>
                  )}
                </button>
              </div>

              {webhookResult && (
                <div className="mt-6 pt-4 border-t border-slate-200">
                  <p className="text-xs font-bold text-slate-700 mb-2">Webhook Execution Result:</p>
                  <pre className="bg-slate-900 text-emerald-300 p-4 rounded-lg text-xs font-mono overflow-x-auto">
                    {JSON.stringify(webhookResult, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 4: AUDIT TRAIL */}
        {activeTab === 'audit' && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-6">
            <h3 className="font-bold text-sm text-[#0f5973] uppercase tracking-wide mb-4">
              Immutable System & Security Audit Logs
            </h3>
            <div className="space-y-2">
              {auditLogs.map(log => (
                <div key={log.id} className="p-3 bg-slate-50 rounded-lg border border-slate-100 flex items-start justify-between text-xs">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-800 font-mono text-[11px]">{log.action}</span>
                      <span className="text-[10px] text-slate-400">by {log.admin_id}</span>
                    </div>
                    <p className="text-[11px] text-slate-500 mt-1">
                      Entity: <span className="font-mono">{log.entity_type} / {log.entity_id}</span>
                    </p>
                  </div>
                  <span className="text-[11px] text-slate-400">
                    {new Date(log.timestamp).toLocaleString('en-IN')}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 5: GOOGLE SHEETS "Payment Domain" INTEGRATION */}
        {activeTab === 'sheets' && (
          <div className="max-w-4xl mx-auto space-y-6">
            
            {/* Header & Status Card */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-6">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-5 border-b border-slate-100">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600">
                    <FileSpreadsheet className="w-7 h-7" />
                  </div>
                  <div>
                    <h3 className="font-extrabold text-base text-slate-900 flex items-center gap-2">
                      <span>Google Sheet Integration</span>
                      <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-emerald-100 text-emerald-800 border border-emerald-200">
                        "Payment Domain"
                      </span>
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Strict server-side synchronization for Pangot booking &amp; token payments.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={fetchSheetsStatus}
                    disabled={sheetsLoading}
                    className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${sheetsLoading ? 'animate-spin' : ''}`} />
                    <span>Check Status</span>
                  </button>

                  <button
                    onClick={handleManualSyncAll}
                    disabled={sheetsLoading}
                    className="px-4 py-2 bg-[#0f5973] hover:bg-[#0a4358] text-white text-xs font-bold uppercase tracking-wider rounded-lg transition-colors flex items-center gap-1.5 shadow-xs cursor-pointer disabled:opacity-50"
                  >
                    <Check className="w-4 h-4" />
                    <span>Sync All Bookings</span>
                  </button>
                </div>
              </div>

              {/* Status Banner */}
              <div className="mt-5 p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Target Spreadsheet</span>
                    <p className="text-base font-bold text-slate-900 font-mono">Payment Domain</p>
                  </div>

                  <div>
                    <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Access Authorization</span>
                    <div className="flex items-center gap-2 mt-0.5">
                      {googleUser || sheetsStatus?.isConnected ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                          <span>Connected ({googleUser?.email || 'Authorized Owner'})</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800 border border-amber-200">
                          <Clock className="w-3.5 h-3.5 text-amber-600" />
                          <span>Awaiting Google Sign-In</span>
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Google Sign In Button if not connected */}
                {(!googleUser && !sheetsStatus?.isConnected) && (
                  <div className="pt-2 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <p className="text-xs text-slate-600">
                      Sign in with your authorized Google account to connect your Google Sheets directly:
                    </p>
                    <button 
                      className="gsi-material-button shadow-sm"
                      onClick={handleGoogleSignInForSheets}
                      disabled={sheetsLoading}
                    >
                      <div className="gsi-material-button-state"></div>
                      <div className="gsi-material-button-content-wrapper">
                        <div className="gsi-material-button-icon">
                          <svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" style={{ display: 'block' }}>
                            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path>
                            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"></path>
                            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path>
                            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path>
                            <path fill="none" d="M0 0h48v48H0z"></path>
                          </svg>
                        </div>
                        <span className="gsi-material-button-contents">Sign in with Google</span>
                      </div>
                    </button>
                  </div>
                )}

                {syncFeedback && (
                  <div className="p-3 rounded-lg bg-teal-50 border border-teal-200 text-teal-900 text-xs">
                    {syncFeedback}
                  </div>
                )}
              </div>
            </div>

            {/* Strict Data Control Rules Summary */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-6 space-y-4">
              <h4 className="font-bold text-sm text-slate-900 uppercase tracking-wider">
                Strict Data Control &amp; Security Compliance
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
                  <p className="font-bold text-slate-800 flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-emerald-600" />
                    <span>Fixed Project &amp; Allowed Plans</span>
                  </p>
                  <p className="text-slate-600 leading-relaxed">
                    • <strong>Project:</strong> Strictly fixed to <strong>"Pangot"</strong>.<br />
                    • <strong>Selected Plan:</strong> Only accepts one of 4 allowed values: <code>₹7 L - Co-Own</code>, <code>₹18 L - Co-Own</code>, <code>Studio - Full Own</code>, <code>Villa - Full Own</code>. Any other value is strictly rejected.
                  </p>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
                  <p className="font-bold text-slate-800 flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-emerald-600" />
                    <span>Zero Direct Customer Access</span>
                  </p>
                  <p className="text-slate-600 leading-relaxed">
                    • <strong>No Frontend Credentials:</strong> All writes occur exclusively via secure server-side API proxy.<br />
                    • <strong>Private Sheet:</strong> No public links or "View Sheet" buttons exist for customers.
                  </p>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
                  <p className="font-bold text-slate-800 flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-emerald-600" />
                    <span>Formula Injection Protection</span>
                  </p>
                  <p className="text-slate-600 leading-relaxed">
                    • Every user-submitted field is sanitized against formula injection. Any string starting with <code>=</code>, <code>+</code>, <code>-</code>, or <code>@</code> is escaped to preserve plain text.
                  </p>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
                  <p className="font-bold text-slate-800 flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-emerald-600" />
                    <span>Duplicate Row Protection</span>
                  </p>
                  <p className="text-slate-600 leading-relaxed">
                    • <strong>Idempotency Key:</strong> Unique <code>Registration ID</code>.<br />
                    • Existing rows are updated in place upon UTR submission or payment verification, eliminating duplicate records.
                  </p>
                </div>
              </div>
            </div>

            {/* Exactly 19 Allowed Columns Display */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-bold text-sm text-slate-900 uppercase tracking-wider">
                    Authorized Columns in "Payment Domain" (Exact 19 Columns)
                  </h4>
                  <p className="text-xs text-slate-500 mt-0.5">
                    No extra or automated columns are created in the spreadsheet.
                  </p>
                </div>
                <span className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-800 font-mono text-xs font-bold">
                  19 / 19 Fixed
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 text-xs">
                {[
                  '1. Registration ID',
                  '2. Full Name',
                  '3. Mobile Number',
                  '4. WhatsApp Number',
                  '5. Email',
                  '6. Country',
                  '7. State',
                  '8. City',
                  '9. Pincode',
                  '10. Full Address',
                  '11. Project',
                  '12. Selected Plan',
                  '13. Number of Units',
                  '14. Booking Token Amount',
                  '15. Payment Status',
                  '16. Payment Reference / Transaction ID',
                  '17. Payment Method',
                  '18. Registration Date',
                  '19. Registration Time'
                ].map((col, idx) => (
                  <div key={idx} className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg font-mono text-[11px] text-slate-700">
                    {col}
                  </div>
                ))}
              </div>
            </div>

          </div>
        )}

      </main>

      {/* REGISTRATION DETAIL DRAWER / MODAL */}
      {selectedReg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto border border-slate-200">
            
            {/* Modal Header */}
            <div className="bg-[#0f5973] text-white p-4 sticky top-0 flex items-center justify-between z-10">
              <div>
                <h3 className="font-bold text-base">{selectedReg.full_name}</h3>
                <p className="text-xs text-teal-100/90 font-mono">
                  {selectedReg.registration_number} · {selectedReg.project_name}
                </p>
              </div>
              <button 
                onClick={() => setSelectedReg(null)}
                className="p-1 hover:bg-white/10 rounded-full text-white/80 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-6 text-xs text-slate-700">
              
              {/* Status Update Strip */}
              <div className="p-4 bg-slate-50 rounded-lg border border-slate-200 flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div>
                    <span className="text-[10px] uppercase font-bold text-slate-400">Payment Status</span>
                    <p className="font-bold text-sm text-[#0f5973]">{selectedReg.payment_status}</p>
                  </div>
                  <div className="h-6 w-px bg-slate-200"></div>
                  <div>
                    <span className="text-[10px] uppercase font-bold text-slate-400">Registration Status</span>
                    <p className="font-bold text-sm text-slate-800">{selectedReg.registration_status}</p>
                  </div>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => handleUpdateStatus(selectedReg.id, 'CONFIRMED', 'PAID')}
                    className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded font-semibold transition-colors cursor-pointer"
                  >
                    Mark Paid & Confirmed
                  </button>
                  <button
                    onClick={() => handleUpdateStatus(selectedReg.id, 'CANCELLED', 'CANCELLED')}
                    className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded font-semibold transition-colors cursor-pointer"
                  >
                    Cancel Booking
                  </button>
                </div>
              </div>

              {/* UTR Verification Strip if submitted via HDFC SmartHub QR */}
              {selectedReg.utr_number && (
                <div className="p-4 bg-amber-50 rounded-lg border border-amber-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <div>
                    <span className="text-[10px] uppercase font-bold text-amber-800">Submitted UPI UTR / Reference No.</span>
                    <p className="font-mono text-base font-bold text-slate-900 mt-0.5">{selectedReg.utr_number}</p>
                    <p className="text-[11px] text-amber-900 mt-0.5">
                      Channel: {selectedReg.upi_app || 'HDFC SmartHub QR'} · Status: <span className="font-bold">{selectedReg.payment_status}</span>
                    </p>
                  </div>
                  {selectedReg.payment_status === 'PENDING' && (
                    <button
                      onClick={() => handleVerifyPendingUtr(selectedReg.id)}
                      className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg font-bold text-xs uppercase tracking-wider transition-colors flex items-center gap-1.5 shadow-sm cursor-pointer"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Verify UTR &amp; Mark as PAID (Sync to Sheets)</span>
                    </button>
                  )}
                </div>
              )}

              {/* Applicant Dossier */}
              <div>
                <h4 className="font-bold text-xs uppercase tracking-wider text-slate-500 mb-2">1. Personal & Contact</h4>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-3 bg-slate-50 rounded-lg border border-slate-100">
                  <div><span className="text-slate-400">Mobile:</span> <p className="font-semibold text-slate-800">{selectedReg.mobile}</p></div>
                  <div><span className="text-slate-400">WhatsApp:</span> <p className="font-semibold text-slate-800">{selectedReg.whatsapp || '—'}</p></div>
                  <div><span className="text-slate-400">Email:</span> <p className="font-semibold text-slate-800">{selectedReg.email}</p></div>
                  <div className="col-span-2"><span className="text-slate-400">Address:</span> <p className="text-slate-800">{selectedReg.address}, {selectedReg.city}, {selectedReg.state} - {selectedReg.pincode}</p></div>
                  <div><span className="text-slate-400">Profession:</span> <p className="text-slate-800">{selectedReg.profession || '—'}</p></div>
                </div>
              </div>

              {/* Unit Specifications */}
              <div>
                <h4 className="font-bold text-xs uppercase tracking-wider text-slate-500 mb-2">2. Unit & Terms</h4>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3 bg-slate-50 rounded-lg border border-slate-100">
                  <div><span className="text-slate-400">Unit No:</span> <p className="font-bold text-slate-800">{selectedReg.unit_number || 'TBD'}</p></div>
                  <div><span className="text-slate-400">Size:</span> <p className="font-semibold text-slate-800">{selectedReg.unit_size}</p></div>
                  <div><span className="text-slate-400">Token Amount:</span> <p className="font-bold text-[#0f5973]">₹ {selectedReg.token_amount.toLocaleString('en-IN')}</p></div>
                  <div><span className="text-slate-400">Targeted ROI:</span> <p className="font-semibold text-emerald-700">{selectedReg.roi_percentage}% p.a.</p></div>
                </div>
              </div>

              {/* Gateway Orders & Transactions */}
              <div>
                <h4 className="font-bold text-xs uppercase tracking-wider text-slate-500 mb-2">3. Gateway Orders & Attempts</h4>
                <div className="space-y-2">
                  {selectedPayments.map(p => (
                    <div key={p.id} className="p-3 bg-slate-50 rounded-lg border border-slate-100 flex items-center justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold font-mono text-slate-800">Order: {p.gateway_order_id}</span>
                          <span className="text-[10px] text-slate-400">Attempt #{p.attempt_number}</span>
                        </div>
                        <p className="text-[11px] text-slate-500 mt-0.5">
                          Txn ID: {p.gateway_payment_id || 'Pending Gateway Return'} · {p.payment_method || 'Razorpay'}
                        </p>
                      </div>
                      <div className="text-right">
                        <span className="font-bold text-slate-800">₹ {p.amount.toLocaleString('en-IN')}</span>
                        <p className="text-[10px] font-bold text-[#0f5973]">{p.payment_status}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Attribution */}
              <div className="p-3 bg-slate-50 rounded-lg text-[11px] text-slate-500 grid grid-cols-2 gap-2">
                <div>UTM Source: <span className="font-mono text-slate-700">{selectedReg.utm_source || 'Direct'}</span></div>
                <div>UTM Campaign: <span className="font-mono text-slate-700">{selectedReg.utm_campaign || 'None'}</span></div>
                <div>IP Address: <span className="font-mono text-slate-700">{selectedReg.ip_address || '127.0.0.1'}</span></div>
                <div>Consent Recorded: <span className="font-mono text-slate-700">{selectedReg.consent_timestamp}</span></div>
              </div>

            </div>
          </div>
        </div>
      )}

    </div>
  );
};
