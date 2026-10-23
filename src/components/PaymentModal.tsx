import React, { useState } from 'react';
import { AlertCircle, ArrowLeft, CheckCircle2, Clock } from 'lucide-react';
import { BrandLogo } from './BrandLogo.js';
import { PAYMENT_QR_SRC, PANGOT_ID, PANGOT_PAYEE } from '../bookingOptions.js';

interface PaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  orderData: {
    orderId: string;
    amount: number;
    currency: string;
    keyId?: string;
  };
  registrationData: {
    id: string;
    registrationNumber: string;
    fullName: string;
    email: string;
    mobile: string;
    projectId?: string;
    projectName: string;
    selectedPlan?: string;
    numberOfUnits?: number;
  };
  onSuccess: (paymentResult: any) => void;
  onFailure: (errorMessage: string) => void;
  /** The booking's own project payment QR and payee (never another project's) */
  paymentQrUrl?: string;
  payeeName?: string;
}

// FINAL PAYMENT STAGE — the only payment method is the official QR code.
export const PaymentModal: React.FC<PaymentModalProps> = ({
  isOpen,
  onClose,
  orderData,
  registrationData,
  onSuccess,
  paymentQrUrl,
  payeeName
}) => {
  // Pangot (and bookings made before projects existed) use the official Pangot QR; other projects only their own
  const isPangot = !registrationData.projectId || registrationData.projectId === PANGOT_ID;
  const qrSrc = isPangot ? PAYMENT_QR_SRC : paymentQrUrl;
  const payee = isPangot ? PANGOT_PAYEE : payeeName;
  const [utrNumber, setUtrNumber] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  if (!isOpen) return null;

  const amountLabel = `₹${orderData.amount.toLocaleString('en-IN')}`;

  const handleSubmitPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const cleanUtr = utrNumber.trim();
    if (!/^[A-Za-z0-9]{6,25}$/.test(cleanUtr)) {
      setFormError('Please enter the UTR / Transaction Reference Number shown in your UPI app (letters and digits only).');
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch('/api/payment/submit-qr-utr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          registrationId: registrationData.id,
          utrNumber: cleanUtr
        })
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || 'Your submission could not be recorded right now. Please try again.');
      }

      // Important: the payment is only SUBMITTED here, never auto-verified
      onSuccess({
        registrationId: registrationData.id,
        registrationNumber: registrationData.registrationNumber,
        status: 'PENDING',
        statusLabel: 'Payment Submitted',
        utrNumber: cleanUtr
      });

    } catch (err: any) {
      setFormError(
        err instanceof TypeError
          ? 'Your submission could not be recorded right now. Please check your connection and try again.'
          : err.message || 'Your submission could not be recorded right now. Please try again.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-50 overflow-y-auto animate-fade-in">
      <div className="min-h-full py-6 sm:py-10 px-4">
        <div className="max-w-md mx-auto">

          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="mb-4 inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to booking details</span>
          </button>

          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">

            {/* Logo & Heading */}
            <div className="px-5 sm:px-8 pt-7 pb-5 text-center border-b border-slate-100">
              <BrandLogo size="md" className="justify-center" />
              <h1 className="mt-5 text-2xl font-extrabold tracking-[0.18em] text-[#0f5973] font-['Playfair_Display']">
                PAYMENT
              </h1>
              <p className="text-sm text-slate-600 mt-1">
                Complete your booking payment
              </p>
            </div>

            <div className="px-5 sm:px-8 py-6 space-y-6">

              {/* Booking / Customer Summary */}
              <dl className="rounded-xl bg-slate-50 border border-slate-200 divide-y divide-slate-200 text-xs">
                <div className="flex justify-between gap-4 px-3.5 py-2">
                  <dt className="text-slate-500">Booking ID</dt>
                  <dd className="font-mono font-bold text-slate-900 text-right">{registrationData.registrationNumber}</dd>
                </div>
                <div className="flex justify-between gap-4 px-3.5 py-2">
                  <dt className="text-slate-500">Customer</dt>
                  <dd className="font-semibold text-slate-900 text-right">{registrationData.fullName}</dd>
                </div>
                <div className="flex justify-between gap-4 px-3.5 py-2">
                  <dt className="text-slate-500">Project</dt>
                  <dd className="font-semibold text-slate-900 text-right">{registrationData.projectName}</dd>
                </div>
                {registrationData.selectedPlan && (
                  <div className="flex justify-between gap-4 px-3.5 py-2">
                    <dt className="text-slate-500">Unit</dt>
                    <dd className="font-semibold text-slate-900 text-right">{registrationData.selectedPlan}</dd>
                  </div>
                )}
                {registrationData.numberOfUnits && (
                  <div className="flex justify-between gap-4 px-3.5 py-2">
                    <dt className="text-slate-500">Number of Units</dt>
                    <dd className="font-semibold text-slate-900 text-right">{registrationData.numberOfUnits}</dd>
                  </div>
                )}
              </dl>

              {/* Amount Payable */}
              <div className="text-center">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Booking Amount</p>
                <p className="text-3xl sm:text-4xl font-black text-[#0f5973] font-mono mt-1">{amountLabel}</p>
              </div>

              {/* Official Payment QR (exact supplied QR CODE.jpeg, original aspect ratio) */}
              <div className="text-center">
                <p className="text-sm font-extrabold uppercase tracking-widest text-[#b87e2b] mb-3">
                  Scan &amp; Pay
                </p>
                {qrSrc ? (
                  <img
                    src={qrSrc}
                    alt={`Official ${payee || registrationData.projectName} payment QR code`}
                    width={720}
                    height={1216}
                    className="block w-full max-w-[340px] h-auto mx-auto rounded-2xl border border-slate-200 shadow-sm"
                  />
                ) : (
                  <p className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-sm">
                    The payment QR for this project is not available right now. Please do not pay until it is shown here.
                  </p>
                )}
                {!isPangot && qrSrc && payee && (
                  <p className="text-xs text-slate-500 mt-2">Payee: <strong className="text-slate-700">{payee}</strong></p>
                )}
                <p className="text-sm text-slate-700 mt-4">
                  Scan the QR code using your UPI app and pay <strong>{amountLabel}</strong>.
                </p>
                <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
                  After completing the payment, enter your UTR / Transaction Reference Number below.
                </p>
              </div>

              {/* UTR Submission */}
              <form onSubmit={handleSubmitPayment} className="space-y-4 pt-5 border-t border-slate-100">
                {formError && (
                  <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-xs flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <span>{formError}</span>
                  </div>
                )}

                <div>
                  <label htmlFor="utr-number" className="block text-xs font-bold text-slate-800 mb-1.5">
                    UTR / Transaction ID <span className="text-rose-500">*</span>
                  </label>
                  <input
                    id="utr-number"
                    type="text"
                    value={utrNumber}
                    onChange={e => setUtrNumber(e.target.value)}
                    placeholder="12-digit UTR from your UPI app"
                    maxLength={25}
                    autoComplete="off"
                    className="w-full px-3.5 py-3 text-base font-mono font-bold rounded-lg border border-slate-300 text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#0f5973] bg-white"
                    required
                  />
                  <p className="text-[11px] text-slate-400 mt-1">
                    Shown in your UPI app's transaction details as "UPI Ref No" or "UTR".
                  </p>
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-3.5 px-6 bg-[#b87e2b] hover:bg-[#a66f24] active:scale-[0.99] text-white text-sm font-bold uppercase tracking-wider rounded-lg shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  {isSubmitting ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      <span>Submitting...</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Payment Submitted</span>
                    </>
                  )}
                </button>

                <div className="p-3 bg-slate-100 rounded-lg text-[11px] text-slate-600 flex items-start gap-2 leading-relaxed">
                  <Clock className="w-4 h-4 text-slate-500 flex-shrink-0 mt-0.5" />
                  <span>
                    Scanning the QR code does not confirm your booking automatically. Your payment is recorded as <strong>Payment Submitted</strong> and is confirmed only after our accounts team verifies the UTR.
                  </span>
                </div>
              </form>

            </div>
          </div>

        </div>
      </div>
    </div>
  );
};
