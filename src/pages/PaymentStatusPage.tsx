import React, { useState, useEffect } from 'react';
import { Registration, PaymentRecord } from '../types.js';
import { BookingFormReceipt } from '../components/BookingFormReceipt.js';
import { 
  CheckCircle2, 
  XCircle, 
  Clock, 
  RotateCw, 
  FileText, 
  Phone, 
  ArrowLeft, 
  ShieldAlert,
  Download,
  AlertTriangle
} from 'lucide-react';

interface PaymentStatusPageProps {
  registrationId: string;
  onRetryPayment: (orderData: any, registrationData: any) => void;
  onNavigateHome: () => void;
}

export const PaymentStatusPage: React.FC<PaymentStatusPageProps> = ({
  registrationId,
  onRetryPayment,
  onNavigateHome
}) => {
  const [loading, setLoading] = useState<boolean>(true);
  const [registration, setRegistration] = useState<Registration | null>(null);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isRetrying, setIsRetrying] = useState<boolean>(false);
  const [showFullReceipt, setShowFullReceipt] = useState<boolean>(true);

  const fetchStatus = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/registration/${registrationId}`);
      if (!res.ok) {
        throw new Error('Registration details not found');
      }
      const data = await res.json();
      setRegistration(data.registration);
      setPayments(data.payments || []);
    } catch (err: any) {
      setError(err.message || 'Failed to retrieve payment status');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (registrationId) {
      fetchStatus();
    }
  }, [registrationId]);

  const handleRetry = async () => {
    if (!registration) return;
    setIsRetrying(true);
    try {
      const res = await fetch('/api/payment/retry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ registrationId: registration.id })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to retry payment');
      }
      onRetryPayment(data.order, {
        id: registration.id,
        registrationNumber: registration.registration_number,
        fullName: registration.full_name,
        email: registration.email,
        mobile: registration.mobile,
        projectName: registration.project_name
      });
    } catch (err: any) {
      alert(err.message || 'Failed to re-open payment checkout');
    } finally {
      setIsRetrying(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="text-center">
          <div className="w-10 h-10 border-3 border-[#0f5973] border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-sm font-semibold text-slate-700">Verifying Payment Status with Gateway...</p>
          <p className="text-xs text-slate-400 mt-1">Please do not refresh or close your browser</p>
        </div>
      </div>
    );
  }

  if (error || !registration) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-xl border border-slate-200 shadow-sm max-w-md w-full text-center">
          <XCircle className="w-12 h-12 text-rose-500 mx-auto mb-3" />
          <h2 className="text-lg font-bold text-slate-800">Booking Record Not Found</h2>
          <p className="text-xs text-slate-500 mt-1 mb-6">{error || 'The requested registration could not be verified.'}</p>
          <button
            onClick={onNavigateHome}
            className="w-full py-2.5 bg-[#0f5973] text-white text-xs font-semibold rounded-lg hover:bg-[#0a4358] transition-colors cursor-pointer"
          >
            Return to Homepage
          </button>
        </div>
      </div>
    );
  }

  const isPaid = registration.payment_status === 'PAID';
  const isFailed = registration.payment_status === 'FAILED';
  const latestPayment = payments[payments.length - 1];

  return (
    <div className="min-h-screen bg-slate-50 py-10 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto">
        
        {/* Navigation Breadcrumb (no-print) */}
        <div className="no-print mb-6 flex items-center justify-between">
          <button
            onClick={onNavigateHome}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to Main Page</span>
          </button>

          <button
            onClick={fetchStatus}
            className="inline-flex items-center gap-1 text-xs text-[#0f5973] hover:underline cursor-pointer"
          >
            <RotateCw className="w-3 h-3" />
            <span>Refresh Status</span>
          </button>
        </div>

        {/* STATUS BANNER */}
        {isPaid ? (
          <div className="no-print mb-8 bg-emerald-50 border border-emerald-200 rounded-xl p-6 text-slate-800 shadow-xs">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-full bg-emerald-600 text-white flex items-center justify-center flex-shrink-0 shadow-sm">
                  <CheckCircle2 className="w-7 h-7" />
                </div>
                <div>
                  <span className="text-[11px] font-bold text-emerald-800 uppercase tracking-widest">
                    Verified Transaction
                  </span>
                  <h1 className="text-xl sm:text-2xl font-bold text-slate-900 mt-0.5">
                    Payment Successful 🎉
                  </h1>
                  <p className="text-xs text-slate-600 mt-1">
                    Thank you, <strong className="text-slate-900">{registration.full_name}</strong>. Your registration has been successfully verified and confirmed.
                  </p>
                </div>
              </div>

              <div className="sm:text-right bg-white/70 p-3 rounded-lg border border-emerald-100 sm:min-w-[180px]">
                <p className="text-[10px] text-slate-500 uppercase font-semibold">Registration Number</p>
                <p className="text-base font-bold font-mono text-[#0f5973]">{registration.registration_number}</p>
                <p className="text-xs font-semibold text-emerald-700 mt-1">
                  ₹ {(registration.total_payment_received || registration.total_payable).toLocaleString('en-IN')} PAID
                </p>
              </div>
            </div>

            <div className="mt-4 pt-4 border-t border-emerald-200/70 text-xs text-slate-600 flex flex-wrap items-center justify-between gap-2">
              <p>
                A formal allotment confirmation has been dispatched to <strong>{registration.email}</strong> and <strong>{registration.mobile}</strong>.
              </p>
              <span className="text-[11px] text-slate-400 font-mono">
                Txn ID: {latestPayment?.gateway_payment_id || 'RZP_VERIFIED'}
              </span>
            </div>
          </div>
        ) : isFailed ? (
          <div className="no-print mb-8 bg-rose-50 border border-rose-200 rounded-xl p-6 text-slate-800 shadow-xs">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-full bg-rose-600 text-white flex items-center justify-center flex-shrink-0 shadow-sm">
                  <AlertTriangle className="w-7 h-7" />
                </div>
                <div>
                  <span className="text-[11px] font-bold text-rose-800 uppercase tracking-widest">
                    Payment Transaction Unsuccessful
                  </span>
                  <h1 className="text-xl sm:text-2xl font-bold text-slate-900 mt-0.5">
                    Payment Unsuccessful
                  </h1>
                  <p className="text-xs text-slate-600 mt-1">
                    We were unable to complete your token payment. Your registration details for <strong>{registration.project_name}</strong> have been safely preserved.
                  </p>
                </div>
              </div>

              <button
                onClick={handleRetry}
                disabled={isRetrying}
                className="w-full sm:w-auto px-6 py-2.5 bg-[#0f5973] hover:bg-[#0a4358] text-white text-xs font-bold uppercase tracking-wider rounded-lg shadow-sm transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {isRetrying ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    <span>Opening Checkout...</span>
                  </>
                ) : (
                  <>
                    <RotateCw className="w-4 h-4" />
                    <span>Retry Payment (₹{registration.total_payable.toLocaleString('en-IN')})</span>
                  </>
                )}
              </button>
            </div>

            <div className="mt-4 pt-4 border-t border-rose-200/70 text-xs text-slate-600 flex items-center justify-between">
              <p>Registration Ref: <span className="font-mono font-semibold">{registration.registration_number}</span></p>
              <p className="text-[11px] text-slate-500">Attempt #{payments.length} Failed · Unit reservation is held pending payment.</p>
            </div>
          </div>
        ) : (
          <div className="no-print mb-8 bg-amber-50 border border-amber-200 rounded-xl p-6 text-slate-800 shadow-xs">
            <div className="flex items-center gap-4">
              <Clock className="w-10 h-10 text-amber-600 flex-shrink-0" />
              <div>
                <h2 className="text-lg font-bold text-slate-900">Payment Processing / Initiated</h2>
                <p className="text-xs text-slate-600 mt-0.5">
                  Your token payment order has been initiated. If you already completed bank authorization, please wait a moment for the gateway webhook to synchronize.
                </p>
              </div>
            </div>
            <div className="mt-4 pt-3 border-t border-amber-200/70 flex gap-3">
              <button
                onClick={handleRetry}
                className="px-4 py-2 bg-[#0f5973] text-white text-xs font-semibold rounded hover:bg-[#0a4358] transition-colors cursor-pointer"
              >
                Complete Payment Now
              </button>
              <button
                onClick={fetchStatus}
                className="px-4 py-2 bg-white border border-slate-300 text-slate-700 text-xs font-semibold rounded hover:bg-slate-50 transition-colors cursor-pointer"
              >
                Check Gateway Status
              </button>
            </div>
          </div>
        )}

        {/* OFFICIAL BOOKING & PLOT DETAILS FORM (PDF REPLICA) */}
        <div className="mt-6">
          <BookingFormReceipt 
            registration={registration}
            payment={latestPayment}
          />
        </div>

        {/* Support & Next Steps */}
        <div className="no-print mt-10 bg-white rounded-xl border border-slate-200 p-6 shadow-xs">
          <h3 className="font-bold text-sm text-[#0f5973] uppercase tracking-wider mb-2">
            What Happens Next?
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs text-slate-600 mt-4">
            <div className="p-3 bg-slate-50 rounded-lg">
              <p className="font-bold text-slate-800 mb-1">1. Priority Allotment Call</p>
              <p>A Senior Relationship Manager from Garg Realty Group will call you on {registration.mobile} to confirm plot demarcation & layout drawings.</p>
            </div>

            <div className="p-3 bg-slate-50 rounded-lg">
              <p className="font-bold text-slate-800 mb-1">2. Allotment Letter Dispatch</p>
              <p>Your stamped provisional allotment letter will be dispatched to your registered email {registration.email} within 24 working hours.</p>
            </div>

            <div className="p-3 bg-slate-50 rounded-lg">
              <p className="font-bold text-slate-800 mb-1">3. 15-Day Cancellation Window</p>
              <p>Should your requirements change, your token amount of ₹{(registration.total_payment_received || registration.total_payable).toLocaleString('en-IN')} remains 100% refundable.</p>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
};
