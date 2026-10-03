import React from 'react';
import { ArrowLeft, ShieldCheck, FileText, CheckCircle } from 'lucide-react';

interface PolicyPagesProps {
  type: 'terms' | 'privacy' | 'refund';
  onBack: () => void;
}

export const PolicyPages: React.FC<PolicyPagesProps> = ({ type, onBack }) => {
  return (
    <div className="min-h-screen bg-slate-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto bg-white p-8 sm:p-12 rounded-xl border border-slate-200 shadow-sm text-slate-800">
        
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#0f5973] hover:underline mb-6 cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Return to Application</span>
        </button>

        {type === 'terms' && (
          <div className="space-y-6 text-xs sm:text-sm text-slate-700 leading-relaxed">
            <div className="border-b border-slate-200 pb-4">
              <span className="text-xs font-bold text-[#b87e2b] uppercase tracking-wider">
                Garg Residency Private Limited
              </span>
              <h1 className="text-2xl font-bold text-[#0f5973] mt-1 font-['Playfair_Display']">
                Terms and Conditions of Booking & Allotment
              </h1>
              <p className="text-xs text-slate-400 mt-1">Version 2026.1 · Effective Date: January 1, 2026</p>
            </div>

            <section className="space-y-3">
              <h2 className="text-base font-bold text-slate-900">1. Overview of Booking Terms</h2>
              <p>
                These terms govern the token reservation and application for residential, agricultural, and commercial plots developed or marketed by <strong>Garg Realty Group</strong> and its corporate entity <strong>Garg Residency Private Limited</strong> (hereinafter referred to as "the Management").
              </p>
            </section>

            <section className="space-y-3 bg-teal-50/60 p-4 rounded-lg border border-teal-200">
              <h2 className="text-base font-bold text-[#0f5973] flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-[#0f5973]" />
                <span>2. Official Policy Highlights (Section 6 of Form)</span>
              </h2>
              <ul className="list-disc list-inside space-y-1.5 text-slate-800 font-medium">
                <li><strong>The token amount is fully-refundable if booking is cancelled within 15 days</strong> of initial payment verification.</li>
                <li><strong>Full payment must be completed within the agreed schedule</strong> as detailed in the forthcoming Provisional Allotment Letter.</li>
                <li><strong>Management reserves the right to cancel bookings</strong> in case of delayed payments beyond the statutory grace period.</li>
              </ul>
            </section>

            <section className="space-y-3">
              <h2 className="text-base font-bold text-slate-900">3. Provisional Allotment</h2>
              <p>
                Submission of this form and payment of the token amount constitutes an expression of interest and provisional reservation of the preferred unit or plot. Actual plot demarcation and registry execution remain contingent upon due verification of applicant KYC documentation.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="text-base font-bold text-slate-900">4. Payment Processing</h2>
              <p>
                All online payments are securely processed through Razorpay. The client acknowledges that transactions are verified server-side and recorded in the management database.
              </p>
            </section>
          </div>
        )}

        {type === 'privacy' && (
          <div className="space-y-6 text-xs sm:text-sm text-slate-700 leading-relaxed">
            <div className="border-b border-slate-200 pb-4">
              <span className="text-xs font-bold text-[#b87e2b] uppercase tracking-wider">
                Data Protection & Privacy
              </span>
              <h1 className="text-2xl font-bold text-[#0f5973] mt-1 font-['Playfair_Display']">
                Privacy Policy (v2026.1)
              </h1>
              <p className="text-xs text-slate-400 mt-1">Compliance with Digital Personal Data Protection (DPDP) Act</p>
            </div>

            <section className="space-y-3">
              <h2 className="text-base font-bold text-slate-900">1. Data Collected</h2>
              <p>
                When you submit an application through apply.yourdomain.com, we collect:
              </p>
              <ul className="list-disc list-inside space-y-1 text-slate-600">
                <li>Applicant contact details (Full Name, Mobile Number, WhatsApp, Email Address)</li>
                <li>Mailing address and demographic information for allotment legal documentation</li>
                <li>Co-applicant details if specified for joint allotment</li>
                <li>Consent timestamps, user IP address, and browser user agent for audit verification</li>
              </ul>
            </section>

            <section className="space-y-3">
              <h2 className="text-base font-bold text-slate-900">2. No Payment Credential Storage</h2>
              <p>
                Garg Realty Group does not collect, process, or store credit card numbers, CVVs, or net banking passwords. Payment gateways (Razorpay) handle card transactions under PCI-DSS Level 1 compliance.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="text-base font-bold text-slate-900">3. Purpose and Communications</h2>
              <p>
                Your details are utilized strictly for plot allotment, relationship management, payment verification, and dispatch of legal deed agreements. You may request data access or correction by contacting <span className="font-semibold">allotment@gargrealty.com</span>.
              </p>
            </section>
          </div>
        )}

        {type === 'refund' && (
          <div className="space-y-6 text-xs sm:text-sm text-slate-700 leading-relaxed">
            <div className="border-b border-slate-200 pb-4">
              <span className="text-xs font-bold text-[#b87e2b] uppercase tracking-wider">
                Client Assurance & Guarantee
              </span>
              <h1 className="text-2xl font-bold text-[#0f5973] mt-1 font-['Playfair_Display']">
                15-Day 100% Token Refund Policy
              </h1>
              <p className="text-xs text-slate-400 mt-1">Garg Residency Private Limited Policy Guidelines</p>
            </div>

            <div className="bg-emerald-50 border border-emerald-200 p-4 rounded-lg flex items-start gap-3">
              <CheckCircle className="w-5 h-5 text-emerald-700 flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="font-bold text-emerald-900 text-sm">100% Money-Back Commitment</h3>
                <p className="text-xs text-emerald-800 mt-1">
                  We understand that evaluating property investments requires thorough deliberation. If you decide not to proceed with your booking within 15 calendar days from the date of token payment, your entire token amount will be refunded with zero cancellation penalty.
                </p>
              </div>
            </div>

            <section className="space-y-3">
              <h2 className="text-base font-bold text-slate-900">How to Initiate a Refund:</h2>
              <ol className="list-decimal list-inside space-y-2 text-slate-600">
                <li>Send an email to <strong>allotment@gargrealty.com</strong> quoting your unique registration number (e.g. <code>GRG-2026-XXXXXX</code>).</li>
                <li>Or contact your designated Senior Relationship Manager or WhatsApp Help desk (+91 98765 43210).</li>
                <li>Upon verification that your request is within the 15-day window, the refund is initiated directly via Razorpay back to your original payment source (UPI account or bank card).</li>
                <li>Refunds typically reflect in your account within 3 to 5 business days as per standard banking settlement cycles.</li>
              </ol>
            </section>
          </div>
        )}

      </div>
    </div>
  );
};
