import React, { useState, useEffect } from 'react';
import { Registration, PaymentRecord } from '../types.js';
import { BookingFormReceipt, useVerifiedReceipt } from '../components/BookingFormReceipt.js';
import { getPaymentStatusLabel } from '../bookingOptions.js';
import { 
  CheckCircle2, 
  XCircle, 
  RotateCw, 
  ArrowLeft, 
  AlertTriangle,
  Download,
  Printer,
  Clock
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
  // Final receipt comes from the server only after admin verification
  const verified = useVerifiedReceipt(registration);

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
      setError(err.message || 'Failed to retrieve booking status');
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
        projectName: 'Pangot',
        selectedPlan: registration.selected_plan,
        numberOfUnits: registration.units_count
      });
    } catch (err: any) {
      alert(err.message || 'Failed to re-open payment checkout');
    } finally {
      setIsRetrying(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-[calc(100vh-80px)] bg-slate-50 flex items-center justify-center p-4">
        <div className="text-center">
          <div className="w-10 h-10 border-3 border-[#0f5973] border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-sm font-semibold text-slate-700">Verifying Booking Status...</p>
        </div>
      </div>
    );
  }

  if (error || !registration) {
    return (
      <div className="min-h-[calc(100vh-80px)] bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm max-w-md w-full text-center">
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

  const isPaid = registration.payment_status === 'PAID' && Boolean(registration.payment_verified_at && registration.payment_verified_by);
  const isFailed = registration.payment_status === 'FAILED';
  const hasSubmittedPayment = Boolean(registration.utr_number) || registration.payment_status === 'PAID';
  const statusLabel = getPaymentStatusLabel(registration);
  const latestPayment = payments[payments.length - 1];

  return (
    <div className="min-h-[calc(100vh-80px)] bg-slate-50 py-10 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto">
        
        {/* Navigation Breadcrumb (no-print) */}
        <div className="no-print mb-6 flex items-center justify-between">
          <button
            onClick={onNavigateHome}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Return to Main Page</span>
          </button>

          <button
            onClick={fetchStatus}
            className="inline-flex items-center gap-1 text-xs text-[#0f5973] hover:underline cursor-pointer"
          >
            <RotateCw className="w-3 h-3" />
            <span>Refresh Status</span>
          </button>
        </div>

        {/* CONFIRMATION SCREEN (MATCHING USER REQUIREMENT) */}
        {isPaid ? (
          <div className="no-print mb-8 bg-white border border-emerald-200 rounded-2xl p-6 sm:p-8 shadow-xs">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-6 border-b border-slate-100">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-full bg-emerald-600 text-white flex items-center justify-center flex-shrink-0 shadow-sm">
                  <CheckCircle2 className="w-7 h-7" />
                </div>
                <div>
                  <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
                    Booking Confirmed · Payment Verified
                  </h1>
                  <p className="text-sm font-semibold text-emerald-700 mt-0.5">
                    Thank you for registering for Pangot.
                  </p>
                </div>
              </div>

              {verified.receipt ? (
                <button
                  onClick={() => window.print()}
                  className="px-4 py-2.5 bg-[#0f5973] hover:bg-[#0a4358] text-white text-xs font-bold uppercase tracking-wider rounded-lg shadow-sm transition-colors flex items-center gap-2 cursor-pointer"
                >
                  <Printer className="w-4 h-4" />
                  <span>Download / Print Receipt</span>
                </button>
              ) : (
                <span className="text-xs text-slate-500">{verified.loading ? 'Preparing your receipt…' : 'Receipt unavailable — please refresh.'}</span>
              )}
            </div>

            {/* Exactly Specified Confirmation Parameters */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 pt-6 text-xs text-slate-700">
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                <span className="text-[10px] uppercase font-bold text-slate-400">Booking ID</span>
                <p className="text-base font-extrabold font-mono text-[#0f5973] mt-0.5">
                  {registration.registration_number}
                </p>
              </div>

              <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                <span className="text-[10px] uppercase font-bold text-slate-400">Applicant Name</span>
                <p className="text-sm font-bold text-slate-900 mt-0.5">
                  {registration.full_name}
                </p>
              </div>

              <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                <span className="text-[10px] uppercase font-bold text-slate-400">Project</span>
                <p className="text-sm font-bold text-slate-900 mt-0.5">
                  Pangot
                </p>
              </div>

              <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                <span className="text-[10px] uppercase font-bold text-slate-400">Selected Plan</span>
                <p className="text-sm font-bold text-slate-900 mt-0.5">
                  {registration.selected_plan || registration.unit_size || registration.unit_number || '—'}
                </p>
              </div>

              <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                <span className="text-[10px] uppercase font-bold text-slate-400">Amount Verified</span>
                <p className="text-sm font-bold text-slate-900 mt-0.5 font-mono">
                  ₹ {(registration.total_payment_received || registration.total_payable).toLocaleString('en-IN')}
                </p>
              </div>

              <div className="bg-emerald-50 p-3 rounded-xl border border-emerald-200">
                <span className="text-[10px] uppercase font-bold text-emerald-700">Payment Status</span>
                <p className="text-sm font-bold text-emerald-800 mt-0.5">
                  {statusLabel}
                </p>
              </div>
            </div>

            <p className="text-xs text-slate-500 mt-5">
              A copy of your booking verification has been dispatched to <strong>{registration.email}</strong> and <strong>{registration.mobile}</strong>.
            </p>
          </div>
        ) : isFailed ? (
          <div className="no-print mb-8 bg-rose-50 border border-rose-200 rounded-2xl p-6 text-slate-800 shadow-xs">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-full bg-rose-600 text-white flex items-center justify-center flex-shrink-0 shadow-sm">
                  <AlertTriangle className="w-7 h-7" />
                </div>
                <div>
                  <h1 className="text-xl font-bold text-slate-900">
                    Payment Unsuccessful
                  </h1>
                  <p className="text-xs text-slate-600 mt-1">
                    We were unable to complete your payment. Your registration details have been saved. You can try the payment again.
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
                    <span>Opening QR Code...</span>
                  </>
                ) : (
                  <>
                    <RotateCw className="w-4 h-4" />
                    <span>Pay Booking Token (₹{registration.total_payable.toLocaleString('en-IN')})</span>
                  </>
                )}
              </button>
            </div>
          </div>
        ) : (
          /* PAYMENT SUBMITTED (awaiting accounts verification) / AWAITING PAYMENT */
          <div className="no-print mb-8 bg-white border border-amber-300 rounded-2xl p-6 sm:p-8 shadow-xs">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-6 border-b border-slate-100">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-full bg-amber-500 text-white flex items-center justify-center flex-shrink-0 shadow-sm">
                  <Clock className="w-7 h-7" />
                </div>
                <div>
                  <div className="flex items-center gap-2.5">
                    <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
                      Payment Verification Pending
                    </h1>
                  </div>
                  <p className="text-sm font-semibold text-amber-800 mt-1">
                    {hasSubmittedPayment
                      ? 'Payment details submitted successfully. Verification is pending.'
                      : 'Your booking details are saved. Complete the payment to submit your booking.'}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={fetchStatus}
                  className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer"
                >
                  <RotateCw className="w-3.5 h-3.5" />
                  <span>Refresh Status</span>
                </button>
                <button
                  onClick={() => window.print()}
                  className="px-4 py-2 bg-[#0f5973] hover:bg-[#0a4358] text-white text-xs font-bold uppercase tracking-wider rounded-lg shadow-sm transition-colors flex items-center gap-2 cursor-pointer"
                >
                  <Printer className="w-4 h-4" />
                  <span>Print Acknowledgement</span>
                </button>
                {!hasSubmittedPayment && (
                  <button
                    onClick={handleRetry}
                    disabled={isRetrying}
                    className="px-4 py-2 bg-[#b87e2b] hover:bg-[#a66f24] text-white text-xs font-bold uppercase tracking-wider rounded-lg shadow-sm transition-colors cursor-pointer disabled:opacity-50"
                  >
                    Complete Payment
                  </button>
                )}
              </div>
            </div>

            {/* Exactly Specified Confirmation Parameters */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-6 text-xs text-slate-700">
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                <span className="text-[10px] uppercase font-bold text-slate-400">Booking ID</span>
                <p className="text-sm font-extrabold font-mono text-[#0f5973] mt-0.5">
                  {registration.registration_number}
                </p>
              </div>

              <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                <span className="text-[10px] uppercase font-bold text-slate-400">Applicant Name</span>
                <p className="text-sm font-bold text-slate-900 mt-0.5">
                  {registration.full_name}
                </p>
              </div>

              <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                <span className="text-[10px] uppercase font-bold text-slate-400">Project / Plan</span>
                <p className="text-sm font-bold text-slate-900 mt-0.5">
                  Pangot · {registration.selected_plan || '—'} × {registration.units_count || 1}
                </p>
              </div>

              <div className="bg-amber-50/70 p-3 rounded-xl border border-amber-200">
                <span className="text-[10px] uppercase font-bold text-amber-800">Payment Status</span>
                <p className="text-sm font-bold text-amber-900 mt-0.5 flex items-center gap-1.5 font-mono">
                  <Clock className="w-3.5 h-3.5 text-amber-600" />
                  <span>{statusLabel}</span>
                </p>
              </div>
            </div>

            {/* UTR Reference Details */}
            <div className="mt-4 p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-1.5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                <span className="text-slate-600">UTR / Transaction ID:</span>
                <strong className="font-mono text-slate-900 text-sm tracking-wide">{registration.utr_number || 'Not submitted yet'}</strong>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 pt-1.5 border-t border-slate-200">
                <span className="text-slate-600">Payment Channel:</span>
                <span className="text-slate-800 font-semibold">UPI QR · Garg Residency Pvt Ltd</span>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 pt-1.5 border-t border-slate-200">
                <span className="text-slate-600">Payment Amount:</span>
                <span className="text-slate-900 font-bold font-mono text-sm">₹ {registration.total_payable.toLocaleString('en-IN')}</span>
              </div>
            </div>

            <div className="p-3 bg-amber-50/70 border border-amber-200 rounded-lg text-xs text-amber-900 mt-4 leading-relaxed">
              {hasSubmittedPayment
                ? <><strong>Payment submitted; verification pending. This is not a final booking receipt.</strong> Our accounts team will check the UTR against the bank records and then confirm your booking. Please keep your Booking ID <strong>{registration.registration_number}</strong> for reference.</>
                : <>No payment reference has been submitted for this booking yet. Use <strong>Complete Payment</strong> above to scan the QR code and submit your UTR.</>}
            </div>
          </div>
        )}

        {/* OFFICIAL BOOKING & PLOT DETAILS FORM (PDF REPLICA RECEIPT) */}
        <div className="mt-6">
          <BookingFormReceipt
            registration={registration}
            payment={latestPayment}
            verified={verified}
          />
        </div>

      </div>
    </div>
  );
};
