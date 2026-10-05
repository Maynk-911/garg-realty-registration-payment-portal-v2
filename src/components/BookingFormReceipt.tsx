import React from 'react';
import { Registration, PaymentRecord } from '../types.js';
import { BrandLogo } from './BrandLogo.js';
import { CheckCircle2, Printer, Download, ShieldCheck } from 'lucide-react';

interface BookingFormReceiptProps {
  registration: Registration;
  payment?: PaymentRecord | null;
  onPrint?: () => void;
}

export const BookingFormReceipt: React.FC<BookingFormReceiptProps> = ({
  registration,
  payment,
  onPrint
}) => {
  const isPaid = registration.payment_status === 'PAID';
  const handlePrint = () => {
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
            Registration Status: {registration.payment_status}
          </span>
          <span className="text-xs text-slate-500 font-mono">
            Ref: {registration.registration_number}
          </span>
        </div>

        <button
          onClick={handlePrint}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-[#0f5973] hover:bg-[#0a4358] text-white text-xs font-medium rounded shadow-sm transition-colors cursor-pointer"
        >
          <Printer className="w-3.5 h-3.5" />
          <span>Print / Save as PDF</span>
        </button>
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
              Booking & Plot Details Form
            </p>
          </div>
        </div>

        {/* Gold Header Accent Divider */}
        <div className="h-[2px] w-full bg-[#b87e2b] mb-4"></div>

        {/* Verified Watermark Stamp for Paid Bookings */}
        {isPaid && (
          <div className="relative">
            <div className="absolute top-2 right-4 rotate-[-8deg] border-2 border-emerald-600 text-emerald-700 px-3 py-1 rounded text-xs font-black tracking-widest uppercase bg-emerald-50/80 shadow-sm pointer-events-none select-none">
              ✓ CONFIRMED & TOKEN PAID
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
              <span className="font-bold text-[#0f5973] sm:col-span-3">{registration.selected_plan || registration.unit_size || '₹7 L - Co-Own'}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-4 px-3 py-1.5 items-center">
              <span className="font-semibold text-slate-600 sm:col-span-1">Project</span>
              <span className="font-medium text-slate-900 sm:col-span-3">{registration.project_name || 'Pangot Luxury Plots & Cottages'}</span>
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
            <span className="font-bold text-slate-900">{registration.roi_percentage}% per annum (Targeted)</span>
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
              <span className="font-medium text-slate-900 sm:col-span-3">{registration.mode_of_payment || 'Razorpay Gateway'}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-4 px-3 py-1.5 items-center">
              <span className="font-semibold text-slate-600 sm:col-span-1">Total Payment Received</span>
              <span className="font-bold text-emerald-800 sm:col-span-3">
                ₹ {(registration.total_payment_received || (isPaid ? registration.total_payable : 0)).toLocaleString('en-IN')}
                {payment?.gateway_payment_id && (
                  <span className="ml-2 text-xs font-normal text-slate-500 font-mono">
                    (Txn: {payment.gateway_payment_id})
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
            <p>• The token amount is fully-refundable if booking get cancel within 15 days.</p>
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
