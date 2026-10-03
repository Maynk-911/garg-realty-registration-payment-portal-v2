import React, { useState } from 'react';
import { Search, FileText, ArrowRight, ShieldCheck, AlertCircle } from 'lucide-react';
import { BookingFormReceipt } from '../components/BookingFormReceipt.js';
import { Registration, PaymentRecord } from '../types.js';

interface TrackBookingPageProps {
  onNavigateHome: () => void;
  onPayNow: (orderData: any, regData: any) => void;
}

export const TrackBookingPage: React.FC<TrackBookingPageProps> = ({ onNavigateHome, onPayNow }) => {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ registration: Registration; payments: PaymentRecord[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch(`/api/registration/${encodeURIComponent(query.trim())}`);
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'No booking found matching this reference');
      }

      setResult({
        registration: data.registration,
        payments: data.payments || []
      });
    } catch (err: any) {
      setError(err.message || 'Registration reference not found');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto">
        
        {/* Header */}
        <div className="text-center mb-8">
          <span className="text-xs font-bold uppercase tracking-wider text-[#b87e2b]">
            Allotment Verification & Receipt
          </span>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-[#0f5973] mt-1 font-['Playfair_Display']">
            Track Booking & Download Receipt
          </h1>
          <p className="text-xs sm:text-sm text-slate-600 mt-2 max-w-md mx-auto">
            Enter your official registration number (e.g. <span className="font-mono font-semibold text-slate-800">GRG-2026-000101</span>) or registered mobile number to retrieve your booking dossier.
          </p>
        </div>

        {/* Search Bar */}
        <div className="no-print bg-white p-4 sm:p-6 rounded-xl border border-slate-200 shadow-sm max-w-xl mx-auto mb-8">
          <form onSubmit={handleSearch} className="flex gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Registration No. (GRG-2026-XXXXXX) or ID"
                className="w-full pl-9 pr-4 py-2.5 text-xs sm:text-sm rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-[#0f5973]"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="px-5 py-2.5 bg-[#0f5973] hover:bg-[#0a4358] text-white text-xs sm:text-sm font-semibold rounded-lg shadow-sm transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              {loading ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              ) : (
                <>
                  <span>Track</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          {error && (
            <div className="mt-3 p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0 text-rose-500" />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Search Result */}
        {result && (
          <div className="space-y-6">
            <BookingFormReceipt 
              registration={result.registration}
              payment={result.payments[result.payments.length - 1]}
            />
          </div>
        )}

      </div>
    </div>
  );
};
