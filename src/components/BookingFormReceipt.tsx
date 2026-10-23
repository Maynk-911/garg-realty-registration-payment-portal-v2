import React, { useEffect, useState } from 'react';
import { Registration, PaymentRecord } from '../types.js';
import { BrandLogo } from './BrandLogo.js';
import { getPaymentStatusLabel, PANGOT_ID } from '../bookingOptions.js';
import { CheckCircle2, Printer, Download, ShieldCheck } from 'lucide-react';

/** Final receipt as issued by the server (GET /api/registration/:id/receipt), only after admin verification. */
export interface VerifiedReceipt {
  receipt_number: string;
  registration_number: string;
  amount_received: number;
  utr_number: string | null;
  payment_verified_at: string;
  verification_code: string;
}

export const NOT_A_RECEIPT_NOTICE = 'Payment submitted; verification pending. This is not a final booking receipt.';

/** Asks the server for the final receipt; it is only returned once an admin has verified the payment. */
export function useVerifiedReceipt(registration: Registration | null) {
  const [state, setState] = useState<{ receipt: VerifiedReceipt | null; loading: boolean }>({ receipt: null, loading: false });
  const looksVerified = Boolean(registration && registration.payment_status === 'PAID' && registration.payment_verified_at && registration.payment_verified_by);
  useEffect(() => {
    if (!registration || !looksVerified) {
      setState({ receipt: null, loading: false });
      return;
    }
    let cancelled = false;
    setState({ receipt: null, loading: true });
    fetch(`/api/registration/${encodeURIComponent(registration.id)}/receipt`)
      .then(async res => {
        const data = await res.json().catch(() => ({}));
        if (!cancelled) setState({ receipt: res.ok ? data.receipt : null, loading: false });
      })
      .catch(() => { if (!cancelled) setState({ receipt: null, loading: false }); });
    return () => { cancelled = true; };
  }, [registration?.id, registration?.payment_status, registration?.payment_verified_at, looksVerified]);
  return state;
}

interface BookingFormReceiptProps {
  registration: Registration;
  payment?: PaymentRecord | null;
  onPrint?: () => void;
  /** Pass when the parent already asked the server; otherwise the component asks itself. */
  verified?: { receipt: VerifiedReceipt | null; loading: boolean };
  /** The booking's own project refund policy (Pangot's existing wording is used for Pangot bookings) */
  refundPolicy?: string;
}

export const BookingFormReceipt: React.FC<BookingFormReceiptProps> = ({
  registration,
  payment,
  onPrint,
  verified,
  refundPolicy
}) => {
  const own = useVerifiedReceipt(verified ? null : registration);
  const { receipt, loading: receiptLoading } = verified || own;
  // Only a receipt issued by the server unlocks the final receipt layout
  const isPaid = Boolean(receipt);
  if (!receipt) {
    return <PaymentAcknowledgement registration={registration} checking={receiptLoading} />;
  }
  const handlePrint = () => {
    if (!isPaid) return;
    if (onPrint) {
      onPrint();
    } else {
      window.print();
    }
  };

  const formattedDate = new Date(registration.created_at).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });

  return (
    <div className="w-full max-w-4xl mx-auto">
      {/* Top Action Bar (hidden when printing) */}
      <div className="no-print mb-4 flex items-center justify-between bg-white p-3 rounded-lg border border-slate-200 shadow-sm">
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold ${
            isPaid ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-amber-50 text-amber-700 border border-amber-200'
          }`}>
            {isPaid ? <CheckCircle2 className="w-3.5 h-3.5" /> : <ShieldCheck className="w-3.5 h-3.5" />}
            {`Payment Status: ${getPaymentStatusLabel(registration)}`}
          </span>
          <span className="text-xs text-slate-500 font-mono">
            Ref: {registration.registration_number}
          </span>
        </div>

        {isPaid && <button
          onClick={handlePrint}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-[#0f5973] hover:bg-[#0a4358] text-white text-xs font-medium rounded shadow-sm transition-colors cursor-pointer"
        >
          <Printer className="w-3.5 h-3.5" />
          <span>Print / Save as PDF</span>
        </button>}
      </div>

      {/* The Official Form Sheet (Designed to match the reference PDF 1:1) */}
      <div className="bg-white border border-slate-300 shadow-md p-6 sm:p-10 font-sans text-slate-800 text-xs sm:text-sm print:p-0 print:border-none print:shadow-none">
        
        {/* Header matching the PDF layout */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-3">
          <BrandLogo />

          <div className="text-left sm:text-right">
            <h1 className="text-xl sm:text-2xl font-bold uppercase tracking-wide text-[#0f5973]">
              {registration.project_id === 'proj_pangot' ? 'PANGOT BOOKING' : `${registration.project_name.toUpperCase()} BOOKING`}
            </h1>
            <p className="text-xs sm:text-sm font-semibold text-[#b87e2b]">
              Verified Payment Receipt
            </p>
            <p className="text-[11px] text-slate-600 font-mono">
              Receipt No: {receipt.receipt_number} · Verification Code: {receipt.verification_code}
            </p>
            <p className="text-[11px] text-slate-600">
              Payment verified on {new Date(receipt.payment_verified_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
            </p>
          </div>
        </div>

        {/* Gold Header Accent Divider */}
        <div className="h-[2px] w-full bg-[#b87e2b] mb-4"></div>

        {/* Verified Watermark Stamp for Paid Bookings */}
        {isPaid && (
          <div className="relative">
            <div className="absolute top-2 right-4 rotate-[-8deg] border-2 border-emerald-600 text-emerald-700 px-3 py-1 rounded text-xs font-black tracking-widest uppercase bg-emerald-50/80 shadow-sm pointer-events-none select-none">
              ✓ CONFIRMED & PAYMENT VERIFIED
            </div>
          </div>
        )}

        {/* 1. PERSONAL INFORMATION */}
        <div className="mb-4">
          <div className="bg-[#0f5973] text-white font-bold text-xs uppercase px-3 py-1.5 tracking-wide">
            1. PERSONAL INFORMATION
          </div>
          <div className="border border-slate-300 border-t-0 divide-y divide-slate-200">
            <div className="grid grid-cols-1 sm:grid-cols-4 px-3 py-1.5 items-center">
              <span className="font-semibold text-slate-600 sm:col-span-1">Applicant Name</span>
              <span className="font-medium text-slate-900 sm:col-span-3">{registration.full_name || '—'}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-4 px-3 py-1.5 items-center">
              <span className="font-semibold text-slate-600 sm:col-span-1">Contact Number</span>
              <span className="font-medium text-slate-900 sm:col-span-3">{registration.mobile || '—'}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-4 px-3 py-1.5 items-center">
              <span className="font-semibold text-slate-600 sm:col-span-1">Email Address</span>
              <span className="font-medium text-slate-900 sm:col-span-3">{registration.email || '—'}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-4 px-3 py-1.5 items-center">
              <span className="font-semibold text-slate-600 sm:col-span-1">Address</span>
              <span className="font-medium text-slate-900 sm:col-span-3">
                {[registration.address, registration.city, registration.state, registration.pincode, registration.country].filter(Boolean).join(', ') || '—'}
              </span>
            </div>

            {/* Co-applicant fields from PDF */}
            <div className="grid grid-cols-1 sm:grid-cols-4 px-3 py-1.5 items-center bg-slate-50/50">
              <span className="font-semibold text-slate-600 sm:col-span-1">Co-applicant Name</span>
              <span className="font-medium text-slate-900 sm:col-span-3">{registration.co_applicant_name || '—'}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-4 px-3 py-1.5 items-center bg-slate-50/50">
              <span className="font-semibold text-slate-600 sm:col-span-1">Contact Number</span>
              <span className="font-medium text-slate-900 sm:col-span-3">{registration.co_applicant_mobile || '—'}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-4 px-3 py-1.5 items-center bg-slate-50/50">
              <span className="font-semibold text-slate-600 sm:col-span-1">Email Address</span>
              <span className="font-medium text-slate-900 sm:col-span-3">{registration.co_applicant_email || '—'}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-4 px-3 py-1.5 items-center bg-slate-50/50">
              <span className="font-semibold text-slate-600 sm:col-span-1">Address</span>
              <span className="font-medium text-slate-900 sm:col-span-3">{registration.co_applicant_address || '—'}</span>
            </div>
          </div>
        </div>

        {/* 2. UNIT DETAILS / SELECTED PLAN */}
        <div className="mb-4">
          <div className="bg-[#0f5973] text-white font-bold text-xs uppercase px-3 py-1.5 tracking-wide">
            2. UNIT & ALLOTMENT DETAILS
          </div>
          <div className="border border-slate-300 border-t-0 divide-y divide-slate-200">
            <div className="grid grid-cols-1 sm:grid-cols-4 px-3 py-1.5 items-center">
              <span className="font-semibold text-slate-600 sm:col-span-1">Selected Plan</span>
              <span className="font-bold text-[#0f5973] sm:col-span-3">{registration.selected_plan || registration.unit_size || '—'}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-4 px-3 py-1.5 items-center">
              <span className="font-semibold text-slate-600 sm:col-span-1">Number of Units</span>
              <span className="font-medium text-slate-900 sm:col-span-3">{registration.units_count || 1}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-4 px-3 py-1.5 items-center">
              <span className="font-semibold text-slate-600 sm:col-span-1">Project</span>
              <span className="font-medium text-slate-900 sm:col-span-3">{registration.project_name || 'Pangot'}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-4 px-3 py-1.5 items-center">
              <span className="font-semibold text-slate-600 sm:col-span-1">Requirement</span>
              <span className="font-medium text-slate-900 sm:col-span-3">{registration.requirement || 'Standard Allotment'}</span>
            </div>
          </div>
        </div>

        {/* 3. ROI */}
        <div className="mb-4">
          <div className="bg-[#0f5973] text-white font-bold text-xs uppercase px-3 py-1.5 tracking-wide">
            3. ROI
          </div>
          <div className="border border-slate-300 border-t-0 px-3 py-1.5 flex items-center">
            <span className="font-semibold text-slate-600 w-32">ROI</span>
            <span className="font-bold text-slate-900">{registration.roi_percentage > 0 ? `${registration.roi_percentage}% per annum (Targeted)` : 'Not applicable'}</span>
          </div>
        </div>

        {/* 4. PAYMENT TERMS */}
        <div className="mb-4">
          <div className="bg-[#0f5973] text-white font-bold text-xs uppercase px-3 py-1.5 tracking-wide">
            4. PAYMENT TERMS
          </div>
          <div className="border border-slate-300 border-t-0 divide-y divide-slate-200">
            <div className="grid grid-cols-1 sm:grid-cols-4 px-3 py-1.5 items-center">
              <span className="font-semibold text-slate-600 sm:col-span-1">Token Amount</span>
              <span className="font-bold text-slate-900 sm:col-span-3">₹ {registration.token_amount.toLocaleString('en-IN')}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-4 px-3 py-1.5 items-center">
              <span className="font-semibold text-slate-600 sm:col-span-1">Mode of Payment</span>
              <span className="font-medium text-slate-900 sm:col-span-3">{registration.mode_of_payment || 'UPI QR'}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-4 px-3 py-1.5 items-center">
              <span className="font-semibold text-slate-600 sm:col-span-1">Total Payment Received</span>
              <span className="font-bold text-emerald-800 sm:col-span-3">
                ₹ {receipt.amount_received.toLocaleString('en-IN')}
                {(receipt.utr_number || payment?.gateway_payment_id) && (
                  <span className="ml-2 text-xs font-normal text-slate-500 font-mono">
                    (UTR / Txn: {receipt.utr_number || payment?.gateway_payment_id})
                  </span>
                )}
              </span>
            </div>
          </div>
        </div>

        {/* 5. DOCUMENTS SUBMITTED */}
        <div className="mb-4">
          <div className="bg-[#0f5973] text-white font-bold text-xs uppercase px-3 py-1.5 tracking-wide">
            5. DOCUMENTS SUBMITTED
          </div>
          <div className="border border-slate-300 border-t-0 px-3 py-2 flex flex-wrap items-center gap-6">
            <label className="flex items-center gap-2">
              <input 
                type="checkbox" 
                readOnly 
                checked={registration.documents_submitted?.id_proof}
                className="rounded text-[#0f5973] focus:ring-0" 
              />
              <span className="text-slate-700">ID Proof (Aadhar/Passport/PAN)</span>
            </label>
            <label className="flex items-center gap-2">
              <input 
                type="checkbox" 
                readOnly 
                checked={registration.documents_submitted?.address_proof}
                className="rounded text-[#0f5973] focus:ring-0" 
              />
              <span className="text-slate-700">Address Proof</span>
            </label>
            <label className="flex items-center gap-2">
              <input 
                type="checkbox" 
                readOnly 
                checked={registration.documents_submitted?.photo}
                className="rounded text-[#0f5973] focus:ring-0" 
              />
              <span className="text-slate-700">Passport Size Photo</span>
            </label>
          </div>
        </div>

        {/* 6. TERMS AND CONDITIONS (Exact text from PDF) */}
        <div className="mb-4">
          <div className="bg-[#0f5973] text-white font-bold text-xs uppercase px-3 py-1.5 tracking-wide">
            6. TERMS AND CONDITIONS
          </div>
          <div className="border border-slate-300 border-t-0 p-3 space-y-1 text-slate-700 text-xs">
            {registration.project_id === PANGOT_ID || !registration.project_id
              ? <p>• The token amount is fully-refundable if booking get cancel within 15 days.</p>
              : refundPolicy && <p className="whitespace-pre-line">• {refundPolicy}</p>}
            <p>• Full payment must be completed within the agreed schedule.</p>
            <p>• Management reserves the right to cancel bookings in case of delayed payments.</p>
          </div>
        </div>

        {/* 7. DECLARATION AND SIGNATURE */}
        <div className="mb-6">
          <div className="bg-[#0f5973] text-white font-bold text-xs uppercase px-3 py-1.5 tracking-wide">
            7. DECLARATION AND SIGNATURE
          </div>
          <div className="border border-slate-300 border-t-0 p-3">
            <p className="text-xs text-slate-700 mb-6 italic">
              I hereby declare that the information provided above is accurate to the best of my knowledge. I agree to the terms and conditions mentioned above.
            </p>

            <div className="grid grid-cols-2 gap-8 pt-4 border-t border-slate-200">
              <div>
                <p className="text-xs text-slate-500 font-semibold mb-2">Applicant's Signature</p>
                <div className="h-10 border-b border-dashed border-slate-400 flex items-end pb-1 font-serif text-slate-800 text-sm italic">
                  {registration.signature_name || registration.full_name}
                </div>
                <p className="text-[11px] text-slate-500 mt-1">Date: {formattedDate}</p>
              </div>

              <div>
                <p className="text-xs text-slate-500 font-semibold mb-2">Authorized Officer</p>
                <div className="h-10 border-b border-dashed border-slate-400 flex items-end pb-1 font-serif text-[#0f5973] text-sm font-semibold">
                  Garg Realty Group
                </div>
                <p className="text-[11px] text-slate-500 mt-1">Date: {formattedDate}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Official Footer matching PDF OCR */}
        <div className="pt-4 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between text-xs text-slate-600 gap-2">
          <div className="font-mono text-[11px] text-slate-400">
            Reg No: {registration.registration_number}
          </div>
          <div className="font-semibold text-slate-700">
            Thanks & Regards | Garg Residency Private Limited
          </div>
        </div>
      </div>
    </div>
  );
};

/**
 * Shown (and printed) for every booking without a server-issued final receipt: payment not yet submitted,
 * submitted and awaiting verification, or rejected. It is deliberately not laid out like a receipt.
 */
const PaymentAcknowledgement: React.FC<{ registration: Registration; checking: boolean }> = ({ registration, checking }) => {
  const submitted = Boolean(registration.utr_number);
  const rejected = registration.payment_status === 'FAILED';
  const title = rejected
    ? 'Payment Not Verified'
    : submitted
      ? 'Payment Acknowledgement — Verification Pending'
      : 'Booking Acknowledgement — Payment Not Yet Submitted';
  const notice = rejected
    ? 'The submitted payment could not be verified. This is not a final booking receipt.'
    : submitted
      ? NOT_A_RECEIPT_NOTICE
      : 'No payment has been submitted for this booking yet. This is not a final booking receipt.';
  const fmt = (iso?: string) => iso
    ? new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '—';
  const rows: [string, React.ReactNode][] = [
    ['Booking ID', <span className="font-mono font-bold text-[#0f5973]">{registration.registration_number}</span>],
    ['Applicant Name', registration.full_name || '—'],
    ['Project / Plan', `${registration.project_name || 'Pangot'} · ${registration.selected_plan || registration.unit_size || '—'}`],
    ['Number of Units', registration.units_count || 1],
    ['Amount Payable', `₹ ${registration.total_payable.toLocaleString('en-IN')}`],
    ['UTR / Transaction ID Submitted', submitted ? <span className="font-mono">{registration.utr_number}</span> : 'Not submitted yet'],
    ['Submitted On', fmt(registration.payment_submitted_at)],
    ['Payment Status', getPaymentStatusLabel(registration)]
  ];

  return (
    <div className="w-full max-w-4xl mx-auto">
      <div className="no-print mb-4 flex items-center justify-between bg-white p-3 rounded-lg border border-slate-200 shadow-sm">
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
          <ShieldCheck className="w-3.5 h-3.5" />
          {checking ? 'Checking payment verification…' : 'Final receipt available only after payment verification'}
        </span>
        <span className="text-xs text-slate-500 font-mono">Ref: {registration.registration_number}</span>
      </div>

      <div className="relative overflow-hidden bg-white border border-slate-300 shadow-md p-6 sm:p-10 text-slate-800 text-xs sm:text-sm print:p-0 print:border-none print:shadow-none">
        {/* Watermark so a printout can never pass for a receipt */}
        <div aria-hidden="true" className="pointer-events-none select-none absolute inset-0 flex items-center justify-center">
          <span className="rotate-[-24deg] text-5xl sm:text-7xl font-black tracking-widest text-amber-600/10 whitespace-nowrap">NOT A RECEIPT</span>
        </div>

        <div className="relative">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-3">
            <BrandLogo />
            <div className="text-left sm:text-right">
              <h1 className="text-lg sm:text-xl font-bold uppercase tracking-wide text-[#0f5973]">{title}</h1>
              <p className="text-xs text-slate-500">{registration.project_name || 'Pangot'} · Garg Realty Group</p>
            </div>
          </div>
          <div className="h-[2px] w-full bg-[#b87e2b] mb-4"></div>

          <div className="mb-4 p-3 border-2 border-dashed border-amber-500 bg-amber-50 text-amber-900 font-bold text-center rounded">
            {notice}
          </div>

          <div className="border border-slate-300 divide-y divide-slate-200 mb-4">
            {rows.map(([label, value]) => (
              <div key={label} className="grid grid-cols-1 sm:grid-cols-3 px-3 py-1.5 items-center">
                <span className="font-semibold text-slate-600">{label}</span>
                <span className="font-medium text-slate-900 sm:col-span-2">{value}</span>
              </div>
            ))}
          </div>

          <p className="text-xs text-slate-600">
            {rejected
              ? 'Please contact us with your payment details. No booking is confirmed until the payment is verified.'
              : 'Our accounts team verifies every payment against the bank statement. Your final booking receipt will be available on the Track Booking page once the payment is verified.'}
          </p>

          <div className="pt-4 mt-6 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between text-xs text-slate-600 gap-2">
            <div className="font-mono text-[11px] text-slate-400">Ref: {registration.registration_number}</div>
            <div className="font-semibold text-slate-700">Garg Residency Private Limited</div>
          </div>
        </div>
      </div>
    </div>
  );
};
