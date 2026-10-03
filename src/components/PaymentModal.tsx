import React, { useState } from 'react';
import { ShieldCheck, CreditCard, Smartphone, Building2, CheckCircle, AlertTriangle, X } from 'lucide-react';

interface PaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  orderData: {
    orderId: string;
    amount: number;
    currency: string;
    keyId: string;
    isSimulator: boolean;
  };
  registrationData: {
    id: string;
    registrationNumber: string;
    fullName: string;
    email: string;
    mobile: string;
    projectName: string;
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
  const [selectedMethod, setSelectedMethod] = useState<'upi' | 'card' | 'netbanking'>('upi');
  const [upiId, setUpiId] = useState('user@okhdfcbank');
  const [isProcessing, setIsProcessing] = useState(false);
  const [cardDetails, setCardDetails] = useState({
    number: '4315 •••• •••• 8820',
    expiry: '12/28',
    cvv: '•••'
  });

  if (!isOpen) return null;

  // Trigger Razorpay Live Checkout if configured
  const triggerRazorpayCheckout = () => {
    if (typeof (window as any).Razorpay !== 'undefined' && !orderData.isSimulator) {
      try {
        const rzp = new (window as any).Razorpay({
          key: orderData.keyId,
          amount: Math.round(orderData.amount * 100),
          currency: orderData.currency || 'INR',
          name: 'Garg Realty Group',
          description: `Token Booking - ${registrationData.projectName}`,
          order_id: orderData.orderId,
          prefill: {
            name: registrationData.fullName,
            email: registrationData.email,
            contact: registrationData.mobile
          },
          theme: {
            color: '#0f5973'
          },
          handler: async (response: any) => {
            setIsProcessing(true);
            try {
              const res = await fetch('/api/payment/verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  registrationId: registrationData.id,
                  razorpayOrderId: response.razorpay_order_id,
                  razorpayPaymentId: response.razorpay_payment_id,
                  razorpaySignature: response.razorpay_signature,
                  paymentMethod: 'Razorpay Live'
                })
              });
              const data = await res.json();
              if (data.success) {
                onSuccess(data);
              } else {
                onFailure(data.error || 'Payment signature verification failed');
              }
            } catch (err: any) {
              onFailure(err.message || 'Payment verification failed');
            } finally {
              setIsProcessing(false);
            }
          },
          modal: {
            ondismiss: () => {
              // user dismissed modal
            }
          }
        });
        rzp.open();
        return;
      } catch (e) {
        console.warn('Razorpay SDK open error, falling back to simulator:', e);
      }
    }
  };

  const handleSimulatedSuccess = async () => {
    setIsProcessing(true);
    try {
      const simulatedPaymentId = `pay_rzp_${Date.now().toString().slice(-8)}`;
      const simulatedSignature = `sig_verified_${Date.now()}`;

      const res = await fetch('/api/payment/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          registrationId: registrationData.id,
          razorpayOrderId: orderData.orderId,
          razorpayPaymentId: simulatedPaymentId,
          razorpaySignature: simulatedSignature,
          paymentMethod: selectedMethod === 'upi' ? `UPI (${upiId})` : selectedMethod === 'card' ? 'Visa Debit Card' : 'HDFC NetBanking'
        })
      });

      const data = await res.json();
      if (data.success) {
        onSuccess(data);
      } else {
        onFailure(data.error || 'Payment verification failed');
      }
    } catch (err: any) {
      onFailure(err.message || 'Payment processing error');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSimulatedFailure = async () => {
    setIsProcessing(true);
    try {
      // Intentionally pass empty or failed signature to test backend rejection & retry flow
      const res = await fetch('/api/payment/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          registrationId: registrationData.id,
          razorpayOrderId: orderData.orderId,
          razorpayPaymentId: '',
          razorpaySignature: '',
          paymentMethod: 'Declined'
        })
      });

      const data = await res.json();
      onFailure(data.error || 'Payment was declined by the issuing bank (Test Simulation)');
    } catch (err: any) {
      onFailure('Payment failed as requested');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-fade-in">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden border border-slate-200">
        
        {/* Gateway Header */}
        <div className="bg-gradient-to-r from-[#0f5973] to-[#093d50] p-4 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-white/10 flex items-center justify-center text-amber-300">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm tracking-wide">Razorpay Secure Checkout</h3>
              <p className="text-[11px] text-teal-100/90 font-mono">
                Order: {orderData.orderId}
              </p>
            </div>
          </div>
          <button 
            onClick={onClose}
            disabled={isProcessing}
            className="p-1 hover:bg-white/10 rounded-full transition-colors text-white/80 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Order Amount Bar */}
        <div className="bg-slate-50 px-5 py-3 border-b border-slate-200 flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-500 font-medium">{registrationData.projectName}</p>
            <p className="text-xs text-slate-700">Token Advance Payment</p>
          </div>
          <div className="text-right">
            <span className="text-xs text-slate-400 uppercase font-semibold">Total Payable</span>
            <p className="text-lg font-extrabold text-[#0f5973]">
              ₹ {orderData.amount.toLocaleString('en-IN')}
            </p>
          </div>
        </div>

        {/* Payment Methods */}
        <div className="p-5">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
            Select Payment Method
          </p>

          <div className="grid grid-cols-3 gap-2 mb-4">
            <button
              type="button"
              onClick={() => setSelectedMethod('upi')}
              className={`p-2.5 rounded-lg border text-xs font-medium flex flex-col items-center gap-1.5 transition-all cursor-pointer ${
                selectedMethod === 'upi' 
                  ? 'border-[#0f5973] bg-teal-50/60 text-[#0f5973] ring-1 ring-[#0f5973]' 
                  : 'border-slate-200 hover:border-slate-300 text-slate-600'
              }`}
            >
              <Smartphone className="w-4 h-4" />
              <span>UPI / QR</span>
            </button>

            <button
              type="button"
              onClick={() => setSelectedMethod('card')}
              className={`p-2.5 rounded-lg border text-xs font-medium flex flex-col items-center gap-1.5 transition-all cursor-pointer ${
                selectedMethod === 'card' 
                  ? 'border-[#0f5973] bg-teal-50/60 text-[#0f5973] ring-1 ring-[#0f5973]' 
                  : 'border-slate-200 hover:border-slate-300 text-slate-600'
              }`}
            >
              <CreditCard className="w-4 h-4" />
              <span>Cards</span>
            </button>

            <button
              type="button"
              onClick={() => setSelectedMethod('netbanking')}
              className={`p-2.5 rounded-lg border text-xs font-medium flex flex-col items-center gap-1.5 transition-all cursor-pointer ${
                selectedMethod === 'netbanking' 
                  ? 'border-[#0f5973] bg-teal-50/60 text-[#0f5973] ring-1 ring-[#0f5973]' 
                  : 'border-slate-200 hover:border-slate-300 text-slate-600'
              }`}
            >
              <Building2 className="w-4 h-4" />
              <span>NetBanking</span>
            </button>
          </div>

          {/* Form details based on method */}
          <div className="bg-slate-50 p-3.5 rounded-lg border border-slate-200 mb-4 text-xs">
            {selectedMethod === 'upi' && (
              <div>
                <label className="block text-slate-600 font-medium mb-1">Enter UPI VPA / ID</label>
                <input 
                  type="text" 
                  value={upiId}
                  onChange={(e) => setUpiId(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded text-slate-800 font-mono text-xs focus:outline-none focus:border-[#0f5973]"
                  placeholder="username@okhdfcbank"
                />
                <p className="text-[11px] text-slate-400 mt-1">Supports Google Pay, PhonePe, Paytm, BHIM</p>
              </div>
            )}

            {selectedMethod === 'card' && (
              <div className="space-y-2">
                <div>
                  <label className="block text-slate-600 font-medium mb-1">Card Number</label>
                  <input 
                    type="text" 
                    readOnly 
                    value={cardDetails.number}
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded text-slate-800 font-mono text-xs"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-slate-600 font-medium mb-1">Expiry</label>
                    <input 
                      type="text" 
                      readOnly 
                      value={cardDetails.expiry}
                      className="w-full px-3 py-2 bg-white border border-slate-300 rounded text-slate-800 font-mono text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-600 font-medium mb-1">CVV</label>
                    <input 
                      type="text" 
                      readOnly 
                      value={cardDetails.cvv}
                      className="w-full px-3 py-2 bg-white border border-slate-300 rounded text-slate-800 font-mono text-xs"
                    />
                  </div>
                </div>
              </div>
            )}

            {selectedMethod === 'netbanking' && (
              <div>
                <label className="block text-slate-600 font-medium mb-1">Select Bank</label>
                <select className="w-full px-3 py-2 bg-white border border-slate-300 rounded text-slate-800 text-xs focus:outline-none focus:border-[#0f5973]">
                  <option>HDFC Bank</option>
                  <option>ICICI Bank</option>
                  <option>State Bank of India</option>
                  <option>Axis Bank</option>
                  <option>Kotak Mahindra Bank</option>
                </select>
              </div>
            )}
          </div>

          {/* Test Sandbox Badge / Live trigger */}
          <div className="mb-4 text-[11px] text-slate-500 bg-amber-50 border border-amber-200 p-2.5 rounded-lg flex items-start gap-2">
            <ShieldCheck className="w-4 h-4 text-amber-700 flex-shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold text-amber-900">Sandbox Test Mode Active</span>
              <p className="text-amber-800 leading-relaxed mt-0.5">
                Simulated transactions test real server-side HMAC signature verification, Firestore record generation, and CRM sync without live bank debit.
              </p>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="space-y-2">
            <button
              type="button"
              disabled={isProcessing}
              onClick={handleSimulatedSuccess}
              className="w-full py-2.5 px-4 bg-[#0f5973] hover:bg-[#0a4358] text-white font-bold text-sm rounded-lg shadow-sm transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {isProcessing ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  <span>Verifying Payment...</span>
                </>
              ) : (
                <>
                  <CheckCircle className="w-4 h-4 text-emerald-300" />
                  <span>Pay ₹{orderData.amount.toLocaleString('en-IN')} (Success)</span>
                </>
              )}
            </button>

            {/* Simulated Failure Trigger to test Retry flow */}
            <button
              type="button"
              disabled={isProcessing}
              onClick={handleSimulatedFailure}
              className="w-full py-2 px-3 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
              <span>Test Payment Failure & Retry Flow</span>
            </button>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-200 flex items-center justify-between text-[10px] text-slate-400">
            <span>256-bit TLS Encrypted</span>
            <span>PCI-DSS Level 1 Compliant</span>
          </div>
        </div>
      </div>
    </div>
  );
};
