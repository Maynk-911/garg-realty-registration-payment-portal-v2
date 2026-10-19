import React, { useState, useEffect } from 'react';
import { Project } from '../types.js';
import { UNIT_OPTIONS } from '../bookingOptions.js';
import { 
  User, 
  MapPin, 
  Building2, 
  CreditCard, 
  ChevronRight, 
  ChevronLeft, 
  AlertCircle, 
  ShieldCheck, 
  Edit3,
  Sparkles
} from 'lucide-react';

interface RegistrationFlowProps {
  projects: Project[];
  selectedProjectId: string;
  onInitiatePayment: (orderData: any, registrationData: any) => void;
  onCancel: () => void;
}

export const RegistrationFlow: React.FC<RegistrationFlowProps> = ({
  projects,
  onInitiatePayment,
  onCancel
}) => {
  // Steps: 1: Applicant Details, 2: Address, 3: Booking Details, 4: Review Details
  const [currentStep, setCurrentStep] = useState<number>(1);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [apiError, setApiError] = useState<string | null>(null);

  // Pangot Project
  const pangotProject = projects.find(p => p.id === 'proj_pangot') || projects[0] || {
    id: 'proj_pangot',
    name: 'Pangot Luxury Plots & Cottages',
    token_amount: 51000,
    total_price: 2500000,
    roi_percentage: 14.5
  };

  // The 4 bookable unit options
  const OWNERSHIP_OPTIONS = UNIT_OPTIONS;

  // Form State
  const [formData, setFormData] = useState({
    // Step 1 — Applicant Details
    fullName: '',
    mobile: '',
    whatsapp: '',
    email: '',
    dateOfBirth: '',

    // Step 2 — Address
    country: 'India',
    state: 'Uttarakhand',
    city: 'Nainital',
    pincode: '263001',
    address: '',

    // Step 3 — Booking Details (Project is strictly FIXED to Pangot)
    projectId: 'proj_pangot',
    projectName: 'Pangot',
    selectedPlan: UNIT_OPTIONS[0] as string,
    numberOfUnits: 1,
    specificRequirement: '',
    additionalNotes: '',

    // Consent
    consent: true,
    declarationSigned: true,
    signatureName: '',

    // Marketing tracking
    utmSource: '',
    utmMedium: '',
    utmCampaign: '',
    utmTerm: '',
    utmContent: '',
    gclid: '',
    fbclid: ''
  });

  // Read URL search params for UTM tracking
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      setFormData(prev => ({
        ...prev,
        utmSource: params.get('utm_source') || '',
        utmMedium: params.get('utm_medium') || '',
        utmCampaign: params.get('utm_campaign') || '',
        utmTerm: params.get('utm_term') || '',
        utmContent: params.get('utm_content') || '',
        gclid: params.get('gclid') || '',
        fbclid: params.get('fbclid') || ''
      }));
    } catch (e) {
      // ignore
    }
  }, []);

  // Server-synced token calculation based on Number of Units
  const tokenPerUnit = pangotProject.token_amount || 51000;
  const bookingTokenAmount = tokenPerUnit * formData.numberOfUnits;
  const totalPayable = bookingTokenAmount;

  // Step Validation
  const validateStep = (step: number): boolean => {
    const errors: Record<string, string> = {};

    if (step === 1) {
      if (!formData.fullName.trim() || formData.fullName.trim().length < 2) {
        errors.fullName = 'Please enter your full legal name';
      }

      const cleanMobile = formData.mobile.replace(/\D/g, '');
      if (formData.country === 'India') {
        if (!/^[6-9]\d{9}$/.test(cleanMobile) && !/^(91)[6-9]\d{9}$/.test(cleanMobile)) {
          errors.mobile = 'Enter a valid 10-digit Indian mobile number';
        }
      } else if (cleanMobile.length < 7) {
        errors.mobile = 'Please enter a valid contact number';
      }

      if (!formData.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email.trim())) {
        errors.email = 'Please enter a valid email address';
      }
    }

    if (step === 2) {
      if (!formData.city.trim()) {
        errors.city = 'Please enter city';
      }
      if (!formData.state.trim()) {
        errors.state = 'Please enter state';
      }
      if (!formData.pincode.trim() || formData.pincode.trim().length < 5) {
        errors.pincode = 'Please enter valid postal pincode';
      }
      if (!formData.address.trim() || formData.address.trim().length < 5) {
        errors.address = 'Please enter complete full address';
      }
    }

    if (step === 3) {
      if (!formData.selectedPlan) {
        errors.selectedPlan = 'Please select a unit option';
      }
      if (formData.numberOfUnits < 1) {
        errors.numberOfUnits = 'Please select at least 1 unit';
      }
      if (!formData.consent) {
        errors.consent = 'You must accept the terms and refund policy consent';
      }
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleNext = () => {
    if (validateStep(currentStep)) {
      setApiError(null);
      setCurrentStep(prev => prev + 1);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handlePrev = () => {
    setApiError(null);
    setCurrentStep(prev => Math.max(1, prev - 1));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleProceedToPayment = async () => {
    setIsSubmitting(true);
    setApiError(null);

    try {
      const response = await fetch('/api/registration/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: formData.fullName,
          mobile: formData.mobile,
          whatsapp: formData.whatsapp || formData.mobile,
          email: formData.email,
          dateOfBirth: formData.dateOfBirth,
          country: formData.country,
          state: formData.state,
          city: formData.city,
          pincode: formData.pincode,
          address: formData.address,
          projectId: 'proj_pangot',
          projectName: 'Pangot',
          selectedPlan: formData.selectedPlan,
          numberOfUnits: formData.numberOfUnits,
          unitSize: formData.selectedPlan,
          unitNumber: formData.selectedPlan,
          requirement: formData.specificRequirement,
          notes: formData.additionalNotes,
          consent: formData.consent,
          declarationSigned: formData.declarationSigned,
          signatureName: formData.fullName,
          documentsSubmitted: { id_proof: true, address_proof: true, photo: true },
          utmSource: formData.utmSource,
          utmMedium: formData.utmMedium,
          utmCampaign: formData.utmCampaign,
          utmTerm: formData.utmTerm,
          utmContent: formData.utmContent,
          gclid: formData.gclid,
          fbclid: formData.fbclid
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to submit booking registration');
      }

      onInitiatePayment(data.order, {
        id: data.registrationId,
        registrationNumber: data.registrationNumber,
        fullName: formData.fullName,
        email: formData.email,
        mobile: formData.mobile,
        projectName: 'Pangot',
        selectedPlan: formData.selectedPlan,
        numberOfUnits: formData.numberOfUnits
      });

    } catch (err: any) {
      setApiError(err.message || 'Something went wrong. Please check your network and try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const steps = [
    { num: 1, title: 'Applicant Details' },
    { num: 2, title: 'Address' },
    { num: 3, title: 'Booking Details' },
    { num: 4, title: 'Review Details' },
    { num: 5, title: 'Payment' }
  ];

  return (
    <div className="min-h-[calc(100vh-80px)] bg-slate-50 py-10 px-4 sm:px-6 lg:px-8">
      <div className="max-w-2xl mx-auto">
        
        {/* Top Header Card */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-teal-50 border border-teal-200 text-[#0f5973] rounded-full text-xs font-semibold mb-2">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Pangot Project · Booking Form</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-[#0f5973] font-['Playfair_Display']">
            Pangot Unit Registration
          </h1>
          <p className="text-xs sm:text-sm text-slate-600 mt-1">
            Complete your registration details below. Token amount is 100% refundable within 15 days.
          </p>
        </div>

        {/* Minimal Step Indicator */}
        <div className="mb-6 bg-white p-3 rounded-xl border border-slate-200/90 shadow-xs">
          <div className="grid grid-cols-5 gap-1.5 sm:gap-2 text-center">
            {steps.map(s => {
              const isActive = currentStep === s.num;
              const isDone = currentStep > s.num;
              return (
                <div 
                  key={s.num}
                  onClick={() => { if (isDone) setCurrentStep(s.num); }}
                  className={`py-1.5 rounded-lg text-xs font-bold transition-all ${
                    isActive 
                      ? 'bg-[#0f5973] text-white shadow-xs' 
                      : isDone 
                        ? 'bg-emerald-50 text-emerald-800 cursor-pointer' 
                        : 'text-slate-400 bg-slate-50'
                  }`}
                >
                  <span className="hidden sm:inline">{s.num}. </span>
                  <span>{s.title.split(' ')[0]}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* API Error Notification */}
        {apiError && (
          <div className="mb-6 p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Submission Error</p>
              <p className="mt-0.5">{apiError}</p>
            </div>
          </div>
        )}

        {/* Form Card */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 sm:p-8">
          
          {/* ======================================================== */}
          {/* STEP 1 — APPLICANT DETAILS */}
          {/* ======================================================== */}
          {currentStep === 1 && (
            <div className="space-y-4 animate-fade-in">
              <div className="border-b border-slate-100 pb-3">
                <h3 className="text-sm sm:text-base font-bold text-[#0f5973] flex items-center gap-2">
                  <User className="w-4 h-4" />
                  <span>STEP 1 — APPLICANT DETAILS</span>
                </h3>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Full Name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.fullName}
                  onChange={e => setFormData({ ...formData, fullName: e.target.value })}
                  placeholder="e.g. Rahul Sharma"
                  className={`w-full px-3.5 py-2.5 text-xs sm:text-sm rounded-lg border focus:outline-none focus:ring-1 focus:ring-[#0f5973] ${
                    formErrors.fullName ? 'border-rose-400 bg-rose-50/20' : 'border-slate-300'
                  }`}
                />
                {formErrors.fullName && <p className="text-rose-600 text-[11px] mt-1">{formErrors.fullName}</p>}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Mobile Number <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-2.5 text-xs text-slate-400 font-mono">+91</span>
                    <input
                      type="tel"
                      value={formData.mobile}
                      onChange={e => setFormData({ ...formData, mobile: e.target.value })}
                      placeholder="9876543210"
                      maxLength={12}
                      className={`w-full pl-11 pr-3.5 py-2.5 text-xs sm:text-sm rounded-lg border font-mono focus:outline-none focus:ring-1 focus:ring-[#0f5973] ${
                        formErrors.mobile ? 'border-rose-400 bg-rose-50/20' : 'border-slate-300'
                      }`}
                    />
                  </div>
                  {formErrors.mobile && <p className="text-rose-600 text-[11px] mt-1">{formErrors.mobile}</p>}
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    WhatsApp Number <span className="text-slate-400 font-normal">(Optional)</span>
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-2.5 text-xs text-slate-400 font-mono">+91</span>
                    <input
                      type="tel"
                      value={formData.whatsapp}
                      onChange={e => setFormData({ ...formData, whatsapp: e.target.value })}
                      placeholder="Same as mobile"
                      className="w-full pl-11 pr-3.5 py-2.5 text-xs sm:text-sm rounded-lg border border-slate-300 font-mono focus:outline-none focus:ring-1 focus:ring-[#0f5973]"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Email Address <span className="text-rose-500">*</span>
                </label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={e => setFormData({ ...formData, email: e.target.value })}
                  placeholder="name@example.com"
                  className={`w-full px-3.5 py-2.5 text-xs sm:text-sm rounded-lg border focus:outline-none focus:ring-1 focus:ring-[#0f5973] ${
                    formErrors.email ? 'border-rose-400 bg-rose-50/20' : 'border-slate-300'
                  }`}
                />
                {formErrors.email && <p className="text-rose-600 text-[11px] mt-1">{formErrors.email}</p>}
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Date of Birth <span className="text-slate-400 font-normal">(Optional)</span>
                </label>
                <input
                  type="date"
                  value={formData.dateOfBirth}
                  onChange={e => setFormData({ ...formData, dateOfBirth: e.target.value })}
                  className="w-full px-3.5 py-2.5 text-xs rounded-lg border border-slate-300 text-slate-700 focus:outline-none focus:ring-1 focus:ring-[#0f5973]"
                />
              </div>
            </div>
          )}

          {/* ======================================================== */}
          {/* STEP 2 — ADDRESS */}
          {/* ======================================================== */}
          {currentStep === 2 && (
            <div className="space-y-4 animate-fade-in">
              <div className="border-b border-slate-100 pb-3">
                <h3 className="text-sm sm:text-base font-bold text-[#0f5973] flex items-center gap-2">
                  <MapPin className="w-4 h-4" />
                  <span>STEP 2 — ADDRESS</span>
                </h3>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Country</label>
                  <input
                    type="text"
                    value={formData.country}
                    onChange={e => setFormData({ ...formData, country: e.target.value })}
                    className="w-full px-3.5 py-2.5 text-xs sm:text-sm rounded-lg border border-slate-300 text-slate-700 focus:outline-none focus:ring-1 focus:ring-[#0f5973]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    State <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.state}
                    onChange={e => setFormData({ ...formData, state: e.target.value })}
                    placeholder="e.g. Uttarakhand, Delhi, Haryana"
                    className={`w-full px-3.5 py-2.5 text-xs sm:text-sm rounded-lg border focus:outline-none focus:ring-1 focus:ring-[#0f5973] ${
                      formErrors.state ? 'border-rose-400 bg-rose-50/20' : 'border-slate-300'
                    }`}
                  />
                  {formErrors.state && <p className="text-rose-600 text-[11px] mt-1">{formErrors.state}</p>}
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    City <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.city}
                    onChange={e => setFormData({ ...formData, city: e.target.value })}
                    placeholder="e.g. Nainital, Dehradun, Gurugram"
                    className={`w-full px-3.5 py-2.5 text-xs sm:text-sm rounded-lg border focus:outline-none focus:ring-1 focus:ring-[#0f5973] ${
                      formErrors.city ? 'border-rose-400 bg-rose-50/20' : 'border-slate-300'
                    }`}
                  />
                  {formErrors.city && <p className="text-rose-600 text-[11px] mt-1">{formErrors.city}</p>}
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Pincode <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.pincode}
                    onChange={e => setFormData({ ...formData, pincode: e.target.value })}
                    placeholder="e.g. 263001"
                    maxLength={10}
                    className={`w-full px-3.5 py-2.5 text-xs sm:text-sm rounded-lg border font-mono focus:outline-none focus:ring-1 focus:ring-[#0f5973] ${
                      formErrors.pincode ? 'border-rose-400 bg-rose-50/20' : 'border-slate-300'
                    }`}
                  />
                  {formErrors.pincode && <p className="text-rose-600 text-[11px] mt-1">{formErrors.pincode}</p>}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Full Address <span className="text-rose-500">*</span>
                </label>
                <textarea
                  rows={3}
                  value={formData.address}
                  onChange={e => setFormData({ ...formData, address: e.target.value })}
                  placeholder="House/Plot/Flat No, Street, Locality, Landmark"
                  className={`w-full px-3.5 py-2.5 text-xs sm:text-sm rounded-lg border focus:outline-none focus:ring-1 focus:ring-[#0f5973] ${
                    formErrors.address ? 'border-rose-400 bg-rose-50/20' : 'border-slate-300'
                  }`}
                />
                {formErrors.address && <p className="text-rose-600 text-[11px] mt-1">{formErrors.address}</p>}
              </div>
            </div>
          )}

          {/* ======================================================== */}
          {/* STEP 3 — BOOKING DETAILS */}
          {/* ======================================================== */}
          {currentStep === 3 && (
            <div className="space-y-6 animate-fade-in">
              <div className="border-b border-slate-100 pb-3">
                <h3 className="text-sm sm:text-base font-bold text-[#0f5973] flex items-center gap-2">
                  <Building2 className="w-4 h-4" />
                  <span>STEP 3 — BOOKING DETAILS</span>
                </h3>
              </div>

              {/* 1. Project Allotment Badge */}
              <div className="p-3.5 rounded-xl bg-teal-50 border border-teal-200 flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-teal-700">Project Allotment</span>
                  <p className="font-extrabold text-base text-[#0f5973]">Pangot</p>
                  <p className="text-[11px] text-teal-800">Pangot, Nainital, Uttarakhand</p>
                </div>
                <div className="text-right">
                  <span className="text-[10px] uppercase font-bold text-teal-700">Booking Token</span>
                  <p className="font-bold text-[#0f5973] text-sm">₹{tokenPerUnit.toLocaleString('en-IN')} / Unit</p>
                  <span className="text-[10px] text-emerald-700 font-semibold">15-Day Refund Guarantee</span>
                </div>
              </div>

              {/* 2. Preferred Unit / Plan (The 4 exact options requested) */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-2">
                  Select Unit:
                </label>
                <div className="grid grid-cols-2 gap-2.5">
                  {OWNERSHIP_OPTIONS.map((planLabel) => {
                    const isSelected = formData.selectedPlan === planLabel;
                    return (
                      <button
                        type="button"
                        key={planLabel}
                        onClick={() => setFormData({ ...formData, selectedPlan: planLabel })}
                        className={`p-3 text-xs sm:text-sm font-bold rounded-lg border text-center transition-all cursor-pointer ${
                          isSelected 
                            ? 'bg-[#0f5973] text-white border-[#0f5973] shadow-xs' 
                            : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                        }`}
                      >
                        {planLabel}
                      </button>
                    );
                  })}
                </div>
                {formErrors.selectedPlan && <p className="text-rose-600 text-[11px] mt-1">{formErrors.selectedPlan}</p>}
              </div>

              {/* 3 & 4. Number of Units & Calculated Booking Token (RESTORED AS REQUESTED) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Number of Units
                  </label>
                  <select
                    value={formData.numberOfUnits}
                    onChange={e => setFormData({ ...formData, numberOfUnits: parseInt(e.target.value, 10) })}
                    className="w-full px-3.5 py-2.5 text-xs sm:text-sm rounded-lg border border-slate-300 text-slate-800 bg-white font-semibold focus:outline-none focus:ring-1 focus:ring-[#0f5973]"
                  >
                    <option value={1}>1 Unit</option>
                    <option value={2}>2 Units</option>
                    <option value={3}>3 Units</option>
                    <option value={4}>4 Units</option>
                  </select>
                </div>

                <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                  <span className="text-[11px] text-slate-500 font-medium">Calculated Booking Token:</span>
                  <p className="text-base sm:text-lg font-bold text-[#0f5973] font-mono mt-0.5">
                    ₹ {bookingTokenAmount.toLocaleString('en-IN')}
                  </p>
                  <span className="text-[10px] text-slate-400">
                    (₹{tokenPerUnit.toLocaleString('en-IN')} × {formData.numberOfUnits} {formData.numberOfUnits > 1 ? 'units' : 'unit'})
                  </span>
                </div>
              </div>

              {/* Specific Requirement & Notes */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Any Specific Requirement
                </label>
                <input
                  type="text"
                  value={formData.specificRequirement}
                  onChange={e => setFormData({ ...formData, specificRequirement: e.target.value })}
                  placeholder="e.g. Scenic Hill Facing, Ground Access"
                  className="w-full px-3.5 py-2.5 text-xs sm:text-sm rounded-lg border border-slate-300 text-slate-800 focus:outline-none focus:ring-1 focus:ring-[#0f5973]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Additional Notes
                </label>
                <textarea
                  rows={2}
                  value={formData.additionalNotes}
                  onChange={e => setFormData({ ...formData, additionalNotes: e.target.value })}
                  placeholder="Any preferences or instructions for our Pangot relationship manager"
                  className="w-full px-3.5 py-2.5 text-xs sm:text-sm rounded-lg border border-slate-300 text-slate-800 focus:outline-none focus:ring-1 focus:ring-[#0f5973]"
                />
              </div>

              {/* Mandatory Consent Checkbox */}
              <div className="pt-2 border-t border-slate-100">
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.consent}
                    onChange={e => setFormData({ ...formData, consent: e.target.checked })}
                    className="mt-0.5 rounded text-[#0f5973] focus:ring-0"
                  />
                  <span className="text-xs text-slate-700 leading-snug">
                    I agree to the Terms & Conditions and 15-day refund policy, and consent to being contacted regarding my Pangot unit booking. <span className="text-rose-500">*</span>
                  </span>
                </label>
                {formErrors.consent && <p className="text-rose-600 text-[11px] mt-1">{formErrors.consent}</p>}
              </div>
            </div>
          )}

          {/* ======================================================== */}
          {/* STEP 4 — REVIEW PAGE */}
          {/* ======================================================== */}
          {currentStep === 4 && (
            <div className="space-y-6 animate-fade-in">
              <div className="border-b border-slate-100 pb-3 flex items-center justify-between">
                <h3 className="text-sm sm:text-base font-bold text-[#0f5973] flex items-center gap-2">
                  <CreditCard className="w-4 h-4" />
                  <span>REVIEW DETAILS</span>
                </h3>
                <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded">
                  Next: Payment
                </span>
              </div>

              {/* Review Container */}
              <div className="bg-slate-50 rounded-xl border border-slate-200 divide-y divide-slate-200">
                
                {/* Applicant Details */}
                <div className="p-4 sm:p-5">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-[#0f5973]">
                      Applicant Details
                    </span>
                    <button
                      type="button"
                      onClick={() => setCurrentStep(1)}
                      className="text-xs text-[#0f5973] hover:underline font-semibold flex items-center gap-1 cursor-pointer"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      <span>EDIT DETAILS</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-slate-700">
                    <div><span className="text-slate-500">Name:</span> <strong className="text-slate-900">{formData.fullName}</strong></div>
                    <div><span className="text-slate-500">Mobile:</span> <strong className="font-mono text-slate-900">{formData.mobile}</strong></div>
                    <div><span className="text-slate-500">Email:</span> <span className="text-slate-900">{formData.email}</span></div>
                    <div><span className="text-slate-500">Address:</span> <span className="text-slate-900">{formData.address}, {formData.city}, {formData.state} - {formData.pincode}</span></div>
                  </div>
                </div>

                {/* Booking Details */}
                <div className="p-4 sm:p-5">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-[#0f5973]">
                      Booking Details
                    </span>
                    <button
                      type="button"
                      onClick={() => setCurrentStep(3)}
                      className="text-xs text-[#0f5973] hover:underline font-semibold flex items-center gap-1 cursor-pointer"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      <span>EDIT DETAILS</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-slate-700">
                    <div><span className="text-slate-500">Project:</span> <strong className="text-[#0f5973]">Pangot</strong></div>
                    <div><span className="text-slate-500">Selected Unit:</span> <strong className="text-[#0f5973] font-bold">{formData.selectedPlan}</strong></div>
                    <div><span className="text-slate-500">Number of Units:</span> <strong className="text-slate-900">{formData.numberOfUnits}</strong></div>
                    <div><span className="text-slate-500">Requirement:</span> <span className="text-slate-900">{formData.specificRequirement || 'Standard'}</span></div>
                  </div>
                </div>

                {/* Payment Details */}
                <div className="p-4 sm:p-5 bg-teal-50/40">
                  <span className="text-xs font-bold uppercase tracking-wider text-[#0f5973] block mb-2">
                    Payment Details
                  </span>

                  <div className="space-y-1.5 text-xs text-slate-700">
                    <div className="flex justify-between">
                      <span className="text-slate-600">Booking Amount:</span>
                      <span className="font-mono font-semibold">₹ {totalPayable.toLocaleString('en-IN')}</span>
                    </div>
                    <div className="flex justify-between pt-2 border-t border-slate-200 text-sm font-bold text-[#0f5973]">
                      <span>Total Payable:</span>
                      <span className="font-mono text-base font-extrabold">₹ {totalPayable.toLocaleString('en-IN')}</span>
                    </div>
                  </div>

                  <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded p-2 mt-3">
                    • The token amount is fully-refundable if booking is cancelled within 15 days.
                  </p>
                </div>

              </div>

              {/* Action Buttons */}
              <div className="pt-2 flex flex-col sm:flex-row gap-3 items-center justify-between">
                <button
                  type="button"
                  onClick={() => setCurrentStep(3)}
                  disabled={isSubmitting}
                  className="w-full sm:w-auto px-5 py-2.5 border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-bold uppercase tracking-wider rounded-lg transition-colors cursor-pointer"
                >
                  EDIT DETAILS
                </button>

                <button
                  type="button"
                  onClick={handleProceedToPayment}
                  disabled={isSubmitting}
                  className="w-full sm:w-auto px-8 py-3.5 bg-[#b87e2b] hover:bg-[#a66f24] active:scale-[0.99] text-white text-xs sm:text-sm font-bold uppercase tracking-wider rounded-lg shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  {isSubmitting ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      <span>SAVING YOUR BOOKING...</span>
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="w-4 h-4" />
                      <span>PROCEED TO PAYMENT (₹{totalPayable.toLocaleString('en-IN')})</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Step 1-3 Navigation Controls */}
          {currentStep < 4 && (
            <div className="mt-8 pt-5 border-t border-slate-100 flex items-center justify-between">
              {currentStep > 1 ? (
                <button
                  type="button"
                  onClick={handlePrev}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer"
                >
                  <ChevronLeft className="w-4 h-4" />
                  <span>Previous</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onCancel}
                  className="text-xs text-slate-500 hover:text-slate-800 cursor-pointer"
                >
                  Cancel & Return
                </button>
              )}

              <button
                type="button"
                onClick={handleNext}
                className="px-6 py-2.5 bg-[#0f5973] hover:bg-[#0a4358] text-white text-xs font-bold rounded-lg shadow-sm transition-colors flex items-center gap-2 cursor-pointer ml-auto"
              >
                <span>Continue</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}

        </div>

      </div>
    </div>
  );
};
