import React, { useState } from 'react';
import { ShieldCheck, X, AlertCircle, Clock, CheckCircle2, QrCode } from 'lucide-react';

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
    projectName: string;
    selectedPlan?: string;
    numberOfUnits?: number;
  };
  onSuccess: (paymentResult: any) => void;
  onFailure: (errorMessage: string) => void;
}

export const PaymentModal: React.FC<PaymentModalProps> = ({
  isOpen,
  onClose,
  orderData,
  registrationData,
  onSuccess,
  onFailure
}) => {
  const [utrNumber, setUtrNumber] = useState('');
  const [upiApp, setUpiApp] = useState('Google Pay');
  const [senderUpi, setSenderUpi] = useState('');
  const [hasConfirmedTransfer, setHasConfirmedTransfer] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmitVerification = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const cleanUtr = utrNumber.trim();
    if (!cleanUtr || cleanUtr.length < 6) {
      setFormError('Please enter a valid 12-digit UTR / UPI Reference Number from your payment app.');
      return;
    }

    if (!hasConfirmedTransfer) {
      setFormError('Please confirm that you have completed the payment before submitting.');
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch('/api/payment/submit-qr-utr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          registrationId: registrationData.id,
          utrNumber: cleanUtr,
          upiApp,
          senderUpi: senderUpi.trim(),
          notes: `Paid via ${upiApp} to Garg Residency Pvt Ltd (TID: 68283784)`
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to submit payment reference');
      }

      // Important: Registration status is PENDING, not PAID
      onSuccess({
        registrationId: registrationData.id,
        registrationNumber: registrationData.registrationNumber,
        status: 'PENDING',
        utrNumber: cleanUtr
      });

    } catch (err: any) {
      setFormError(err.message || 'Failed to submit payment details. Please check connection and try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/80 backdrop-blur-xs overflow-y-auto animate-fade-in">
      <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl border border-slate-200 overflow-hidden my-6">
        
        {/* Modal Header */}
        <div className="bg-[#0f5973] text-white p-4 sm:p-5 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <QrCode className="w-5 h-5 text-amber-400" />
              <h2 className="text-base sm:text-lg font-extrabold uppercase tracking-wider">
                PAY BOOKING TOKEN
              </h2>
            </div>
            <p className="text-xs text-teal-100 mt-0.5">
              Pangot Luxury Plots & Cottages · Garg Realty Group
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-white/80 hover:text-white p-1 rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-4 sm:p-6 max-h-[82vh] overflow-y-auto space-y-5">
          
          {/* Amount & Registration Summary Banner */}
          <div className="p-3.5 rounded-xl bg-teal-50 border border-teal-200 flex items-center justify-between">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-teal-700">Token Advance Amount</span>
              <p className="text-xl sm:text-2xl font-black text-[#0f5973] font-mono">
                ₹ {orderData.amount.toLocaleString('en-IN')}
              </p>
              <p className="text-[11px] text-teal-800 font-medium">
                {registrationData.selectedPlan || 'Pangot Allotment'} {registrationData.numberOfUnits ? `· ${registrationData.numberOfUnits} Unit(s)` : ''}
              </p>
            </div>
            <div className="text-right">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Registration ID</span>
              <p className="text-xs font-mono font-bold text-slate-800 mt-0.5">
                {registrationData.registrationNumber}
              </p>
              <span className="inline-block px-2 py-0.5 bg-emerald-100 text-emerald-800 text-[10px] font-semibold rounded mt-1">
                15-Day Refund Guarantee
              </span>
            </div>
          </div>

          {/* Official HDFC Bank SmartHub VYAPAR QR Code Card */}
          <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 text-center">
            
            {/* The exact official QR Image Asset */}
            <div className="inline-block bg-white p-2 rounded-2xl shadow-sm border border-slate-200">
              <img 
                src="/image.png" 
                alt="Official HDFC Bank SmartHub VYAPAR QR Code - Garg Residency Pvt Ltd"
                className="w-full max-w-[280px] sm:max-w-[310px] mx-auto rounded-xl object-contain block"
                onError={(e) => {
                  // Fallback to alternative path if needed
                  (e.currentTarget as HTMLImageElement).src = '/hdfc-vyapar-qr.png';
                }}
                referrerPolicy="no-referrer"
              />
            </div>

            {/* Exactly Specified Labels Below QR Code */}
            <div className="mt-3.5 pt-3 border-t border-slate-200">
              <p className="text-base sm:text-lg font-extrabold text-slate-900 tracking-wide">
                Garg Residency Pvt Ltd
              </p>
              <p className="text-xs font-bold text-[#0f5973] uppercase tracking-widest mt-0.5">
                Scan &amp; Pay
              </p>
              <p className="text-[11px] text-slate-500 mt-1 font-mono">
                TID: 68283784 · HDFC Bank SmartHub VYAPAR
              </p>
            </div>
          </div>

          {/* Instructions Box */}
          <div className="bg-amber-50/70 border border-amber-200 rounded-xl p-3.5 text-xs text-amber-900 space-y-1.5">
            <p className="font-bold flex items-center gap-1.5 text-amber-950">
              <ShieldCheck className="w-4 h-4 text-amber-600 flex-shrink-0" />
              <span>How to Complete Token Payment:</span>
            </p>
            <ol className="list-decimal pl-4 space-y-1 text-slate-700">
              <li>Open any UPI App (Google Pay, PhonePe, Paytm, BHIM, Cred, HDFC PayZapp, or your Bank App).</li>
              <li>Scan the official QR code above and transfer exact amount: <strong>₹{orderData.amount.toLocaleString('en-IN')}</strong>.</li>
              <li>Copy the <strong>12-digit UTR / UPI Reference Number</strong> from your payment receipt.</li>
              <li>Enter the UTR below and submit for verification.</li>
            </ol>
          </div>

          {/* Payment Verification Submission Form */}
          <form onSubmit={handleSubmitVerification} className="space-y-4 pt-1">
            <div className="border-t border-slate-200 pt-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[#0f5973] mb-3">
                Submit Payment Confirmation
              </h3>
            </div>

            {formError && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-xs flex items-start gap-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>{formError}</span>
              </div>
            )}

            <div>
              <label className="block text-xs font-bold text-slate-800 mb-1">
                Bank UTR / UPI Reference Number <span className="text-rose-500">*</span>
              </label>
              <input 
                type="text"
                value={utrNumber}
                onChange={e => setUtrNumber(e.target.value)}
                placeholder="e.g. 428591823456 (12-digit number)"
                maxLength={25}
                className="w-full px-3.5 py-2.5 text-sm font-mono font-bold rounded-lg border border-slate-300 text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#0f5973] bg-white"
                required
              />
              <p className="text-[11px] text-slate-400 mt-1">
                Found on your UPI transaction details receipt screen as "UPI Ref No" or "UTR".
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  UPI App Used
                </label>
                <select
                  value={upiApp}
                  onChange={e => setUpiApp(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 text-slate-800 bg-white font-medium focus:outline-none focus:ring-1 focus:ring-[#0f5973]"
                >
                  <option value="Google Pay">Google Pay (GPay)</option>
                  <option value="PhonePe">PhonePe</option>
                  <option value="Paytm">Paytm</option>
                  <option value="BHIM UPI">BHIM UPI</option>
                  <option value="HDFC PayZapp / Banking">HDFC Bank / PayZapp</option>
                  <option value="Cred">Cred</option>
                  <option value="Other Bank App">Other Bank UPI App</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Sender UPI ID / Mobile <span className="text-slate-400 font-normal">(Optional)</span>
                </label>
                <input 
                  type="text"
                  value={senderUpi}
                  onChange={e => setSenderUpi(e.target.value)}
                  placeholder="e.g. yourname@okhdfcbank"
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 text-slate-800 focus:outline-none focus:ring-1 focus:ring-[#0f5973]"
                />
              </div>
            </div>

            <div className="pt-1">
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input 
                  type="checkbox"
                  checked={hasConfirmedTransfer}
                  onChange={e => setHasConfirmedTransfer(e.target.checked)}
                  className="mt-0.5 rounded text-[#0f5973] focus:ring-0"
                />
                <span className="text-xs text-slate-700 leading-snug">
                  I confirm that I have scanned the QR code and completed transfer of <strong>₹{orderData.amount.toLocaleString('en-IN')}</strong> to <strong>Garg Residency Pvt Ltd (TID: 68283784)</strong>. <span className="text-rose-500">*</span>
                </span>
              </label>
            </div>

            {/* Note on Verification */}
            <div className="p-3 bg-slate-100 rounded-lg text-[11px] text-slate-600 flex items-start gap-2">
              <Clock className="w-4 h-4 text-slate-500 flex-shrink-0 mt-0.5" />
              <span>
                <strong>Verification Notice:</strong> Submitting will set your booking status to <strong>PENDING</strong> verification. The booking is NOT marked as paid immediately; our accounts desk verifies the UTR against our HDFC Bank SmartHub terminal before issuing the final confirmed allotment certificate.
              </span>
            </div>

            {/* Submit Action */}
            <div className="pt-2 flex flex-col sm:flex-row gap-3">
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting}
                className="w-full sm:w-auto px-4 py-2.5 border border-slate-300 text-slate-700 hover:bg-slate-50 text-xs font-bold rounded-lg transition-colors cursor-pointer"
              >
                Cancel
              </button>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full sm:flex-1 py-3 px-6 bg-[#b87e2b] hover:bg-[#a66f24] active:scale-[0.99] text-white text-xs sm:text-sm font-bold uppercase tracking-wider rounded-lg shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {isSubmitting ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    <span>SUBMITTING UTR FOR VERIFICATION...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    <span>I HAVE PAID — SUBMIT FOR VERIFICATION</span>
                  </>
                )}
              </button>
            </div>

          </form>

        </div>

      </div>
    </div>
  );
};
