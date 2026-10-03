import React, { useState, useEffect } from 'react';
import { Project, Registration } from '../types.js';
import { 
  User, 
  MapPin, 
  Building, 
  CreditCard, 
  Check, 
  ChevronRight, 
  ChevronLeft, 
  AlertCircle, 
  ShieldCheck, 
  Edit3,
  FileCheck
} from 'lucide-react';

interface RegistrationFlowProps {
  projects: Project[];
  selectedProjectId: string;
  onSelectProject: (id: string) => void;
  onInitiatePayment: (orderData: any, registrationData: any) => void;
  onViewReceipt: (registration: Registration) => void;
}

export const RegistrationFlow: React.FC<RegistrationFlowProps> = ({
  projects,
  selectedProjectId,
  onSelectProject,
  onInitiatePayment,
  onViewReceipt
}) => {
  const [currentStep, setCurrentStep] = useState<number>(1);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [apiError, setApiError] = useState<string | null>(null);

  // Form State
  const [formData, setFormData] = useState({
    // Step 1: Personal Information
    fullName: '',
    mobile: '',
    whatsapp: '',
    email: '',
    dateOfBirth: '',
    gender: 'Prefer not to say',
    // Co-applicant (from PDF Section 1)
    hasCoApplicant: false,
    coApplicantName: '',
    coApplicantMobile: '',
    coApplicantEmail: '',
    coApplicantAddress: '',

    // Step 2: Location
    country: 'India',
    state: 'Uttarakhand',
    city: 'Nainital',
    pincode: '263001',
    address: '',

    // Step 3: Requirement & Unit Details
    companyName: '',
    profession: '',
    requirement: 'Investment & Vacation Home',
    projectId: selectedProjectId || (projects[0]?.id || 'proj_pangot'),
    unitNumber: 'PG-104',
    unitSize: 'Plot 350 Sq. Yds',
    floorNo: 'Ground / Independent',
    notes: '',
    documentsSubmitted: {
      id_proof: true,
      address_proof: true,
      photo: true
    },

    // Step 4: Consent & Declaration (from PDF Section 6 & 7)
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

  // Sync selected project from props
  useEffect(() => {
    if (selectedProjectId) {
      setFormData(prev => ({
        ...prev,
        projectId: selectedProjectId
      }));
    }
  }, [selectedProjectId]);

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

  const activeProject = projects.find(p => p.id === formData.projectId) || projects[0];

  // Dynamic calculations based on DB values
  const tokenAmount = activeProject ? activeProject.token_amount : 50000;
  const taxAmount = activeProject ? Math.round((tokenAmount * (activeProject.tax_percentage || 0)) / 100) : 0;
  const totalPayable = tokenAmount + taxAmount;

  // Validation routines per step
  const validateStep = (step: number): boolean => {
    const errors: Record<string, string> = {};

    if (step === 1) {
      if (!formData.fullName.trim() || formData.fullName.trim().length < 2) {
        errors.fullName = 'Please enter your full legal name';
      }

      const cleanMobile = formData.mobile.replace(/\D/g, '');
      if (formData.country === 'India') {
        if (!/^[6-9]\d{9}$/.test(cleanMobile) && !/^(91)[6-9]\d{9}$/.test(cleanMobile)) {
          errors.mobile = 'Enter a valid 10-digit Indian mobile number (e.g. 9876543210)';
        }
      } else if (cleanMobile.length < 7) {
        errors.mobile = 'Please enter a valid mobile number';
      }

      if (!formData.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email.trim())) {
        errors.email = 'Please enter a valid email address';
      }

      if (formData.hasCoApplicant) {
        if (!formData.coApplicantName.trim()) {
          errors.coApplicantName = 'Please enter co-applicant name';
        }
      }
    }

    if (step === 2) {
      if (!formData.city.trim()) {
        errors.city = 'Please enter your city';
      }
      if (!formData.state.trim()) {
        errors.state = 'Please enter your state';
      }
      if (!formData.pincode.trim() || formData.pincode.trim().length < 5) {
        errors.pincode = 'Please enter a valid postal pincode';
      }
      if (!formData.address.trim() || formData.address.trim().length < 5) {
        errors.address = 'Please enter your complete address';
      }
    }

    if (step === 3) {
      if (!formData.projectId) {
        errors.projectId = 'Please select a project';
      }
    }

    if (step === 4) {
      if (!formData.consent) {
        errors.consent = 'You must accept the Terms & Conditions and Privacy Policy';
      }
      if (!formData.declarationSigned) {
        errors.declarationSigned = 'You must acknowledge the declaration';
      }
      if (!formData.signatureName.trim() && !formData.fullName.trim()) {
        errors.signatureName = 'Please provide signature name';
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

  const handleSubmit = async () => {
    if (!validateStep(4)) return;

    setIsSubmitting(true);
    setApiError(null);

    try {
      const response = await fetch('/api/registration/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          signatureName: formData.signatureName || formData.fullName
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to submit registration');
      }

      // Transition directly to Payment Modal
      onInitiatePayment(data.order, {
        id: data.registrationId,
        registrationNumber: data.registrationNumber,
        fullName: formData.fullName,
        email: formData.email,
        mobile: formData.mobile,
        projectName: activeProject?.name || 'Project Booking'
      });

    } catch (err: any) {
      setApiError(err.message || 'Something went wrong. Please check your network and try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const steps = [
    { num: 1, title: 'Personal Info', desc: 'Applicant & contact' },
    { num: 2, title: 'Location', desc: 'Address & city' },
    { num: 3, title: 'Unit & Requirements', desc: 'Project & plot details' },
    { num: 4, title: 'Payment & Review', desc: 'Token terms & checkout' }
  ];

  return (
    <div className="min-h-screen bg-slate-50 py-10 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto">
        
        {/* Form Title & Top Banner */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-teal-50 border border-teal-200 text-[#0f5973] rounded-full text-xs font-semibold mb-2">
            <FileCheck className="w-3.5 h-3.5" />
            <span>Official Booking & Plot Details Application</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-[#0f5973] font-['Playfair_Display']">
            {activeProject ? activeProject.tagline : 'Client Registration & Booking Form'}
          </h1>
          <p className="text-xs sm:text-sm text-slate-600 mt-1 max-w-xl mx-auto">
            Please complete the details below to secure your allocation. Token advance is 100% refundable within 15 days.
          </p>
        </div>

        {/* Step Progress Bar */}
        <div className="mb-8 bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {steps.map((s) => {
              const isActive = currentStep === s.num;
              const isDone = currentStep > s.num;
              return (
                <div 
                  key={s.num}
                  onClick={() => {
                    if (isDone) setCurrentStep(s.num);
                  }}
                  className={`flex items-center gap-3 p-2 rounded-lg transition-colors ${
                    isActive 
                      ? 'bg-teal-50/80 border border-teal-200' 
                      : isDone 
                        ? 'hover:bg-slate-50 cursor-pointer' 
                        : 'opacity-50'
                  }`}
                >
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                    isDone 
                      ? 'bg-emerald-600 text-white' 
                      : isActive 
                        ? 'bg-[#0f5973] text-white shadow-xs' 
                        : 'bg-slate-200 text-slate-600'
                  }`}>
                    {isDone ? <Check className="w-4 h-4" /> : s.num}
                  </div>
                  <div className="min-w-0">
                    <p className={`text-xs font-bold truncate ${isActive ? 'text-[#0f5973]' : 'text-slate-700'}`}>
                      {s.title}
                    </p>
                    <p className="text-[10px] text-slate-400 truncate">{s.desc}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* API Error Notification */}
        {apiError && (
          <div className="mb-6 p-4 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Submission Error</p>
              <p className="mt-0.5">{apiError}</p>
            </div>
          </div>
        )}

        {/* Form Body Card */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 sm:p-8">
          
          {/* STEP 1: PERSONAL INFORMATION */}
          {currentStep === 1 && (
            <div className="space-y-6 animate-fade-in">
              <div className="border-b border-slate-100 pb-3 flex items-center justify-between">
                <div>
                  <h3 className="text-base font-bold text-[#0f5973] flex items-center gap-2">
                    <User className="w-4 h-4" />
                    <span>1. Personal & Contact Information</span>
                  </h3>
                  <p className="text-xs text-slate-500">Corresponding to Section 1 of the official booking form</p>
                </div>
                <span className="text-xs font-semibold text-slate-400">Step 1 of 4</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Applicant Full Name <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.fullName}
                    onChange={e => setFormData({ ...formData, fullName: e.target.value })}
                    placeholder="e.g. Rahul Sharma"
                    className={`w-full px-3.5 py-2.5 text-xs rounded-lg border focus:outline-none focus:ring-1 focus:ring-[#0f5973] ${
                      formErrors.fullName ? 'border-rose-400 bg-rose-50/20' : 'border-slate-300'
                    }`}
                  />
                  {formErrors.fullName && <p className="text-rose-600 text-[11px] mt-1">{formErrors.fullName}</p>}
                </div>

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
                      className={`w-full pl-11 pr-3.5 py-2.5 text-xs rounded-lg border font-mono focus:outline-none focus:ring-1 focus:ring-[#0f5973] ${
                        formErrors.mobile ? 'border-rose-400 bg-rose-50/20' : 'border-slate-300'
                      }`}
                    />
                  </div>
                  {formErrors.mobile && <p className="text-rose-600 text-[11px] mt-1">{formErrors.mobile}</p>}
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    WhatsApp Number <span className="text-slate-400 font-normal">(Optional for updates)</span>
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-2.5 text-xs text-slate-400 font-mono">+91</span>
                    <input
                      type="tel"
                      value={formData.whatsapp}
                      onChange={e => setFormData({ ...formData, whatsapp: e.target.value })}
                      placeholder="Same as mobile or other"
                      className="w-full pl-11 pr-3.5 py-2.5 text-xs rounded-lg border border-slate-300 font-mono focus:outline-none focus:ring-1 focus:ring-[#0f5973]"
                    />
                  </div>
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Email Address <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={e => setFormData({ ...formData, email: e.target.value })}
                    placeholder="name@example.com"
                    className={`w-full px-3.5 py-2.5 text-xs rounded-lg border focus:outline-none focus:ring-1 focus:ring-[#0f5973] ${
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

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Gender <span className="text-slate-400 font-normal">(Optional)</span>
                  </label>
                  <select
                    value={formData.gender}
                    onChange={e => setFormData({ ...formData, gender: e.target.value })}
                    className="w-full px-3.5 py-2.5 text-xs rounded-lg border border-slate-300 text-slate-700 focus:outline-none focus:ring-1 focus:ring-[#0f5973]"
                  >
                    <option>Male</option>
                    <option>Female</option>
                    <option>Other</option>
                    <option>Prefer not to say</option>
                  </select>
                </div>
              </div>

              {/* Co-applicant toggle matching PDF Section 1 */}
              <div className="pt-4 border-t border-slate-100">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={formData.hasCoApplicant}
                    onChange={e => setFormData({ ...formData, hasCoApplicant: e.target.checked })}
                    className="rounded text-[#0f5973] focus:ring-0"
                  />
                  <span className="text-xs font-semibold text-slate-700">Add Co-Applicant Details (Joint Allotment)</span>
                </label>

                {formData.hasCoApplicant && (
                  <div className="mt-4 p-4 rounded-lg bg-slate-50 border border-slate-200 grid grid-cols-1 sm:grid-cols-2 gap-4 animate-fade-in">
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Co-Applicant Name <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="text"
                        value={formData.coApplicantName}
                        onChange={e => setFormData({ ...formData, coApplicantName: e.target.value })}
                        placeholder="Co-applicant legal name"
                        className="w-full px-3 py-2 text-xs rounded border border-slate-300 bg-white"
                      />
                      {formErrors.coApplicantName && <p className="text-rose-600 text-[11px] mt-1">{formErrors.coApplicantName}</p>}
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Co-Applicant Contact</label>
                      <input
                        type="tel"
                        value={formData.coApplicantMobile}
                        onChange={e => setFormData({ ...formData, coApplicantMobile: e.target.value })}
                        placeholder="Contact number"
                        className="w-full px-3 py-2 text-xs rounded border border-slate-300 bg-white"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Co-Applicant Email</label>
                      <input
                        type="email"
                        value={formData.coApplicantEmail}
                        onChange={e => setFormData({ ...formData, coApplicantEmail: e.target.value })}
                        placeholder="Email address"
                        className="w-full px-3 py-2 text-xs rounded border border-slate-300 bg-white"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* STEP 2: LOCATION & ADDRESS */}
          {currentStep === 2 && (
            <div className="space-y-6 animate-fade-in">
              <div className="border-b border-slate-100 pb-3 flex items-center justify-between">
                <div>
                  <h3 className="text-base font-bold text-[#0f5973] flex items-center gap-2">
                    <MapPin className="w-4 h-4" />
                    <span>2. Residential / Mailing Address</span>
                  </h3>
                  <p className="text-xs text-slate-500">For legal allotment deed dispatch & communication</p>
                </div>
                <span className="text-xs font-semibold text-slate-400">Step 2 of 4</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Country</label>
                  <input
                    type="text"
                    value={formData.country}
                    onChange={e => setFormData({ ...formData, country: e.target.value })}
                    className="w-full px-3.5 py-2.5 text-xs rounded-lg border border-slate-300 text-slate-700 focus:outline-none focus:ring-1 focus:ring-[#0f5973]"
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
                    placeholder="e.g. Haryana, Delhi, Uttarakhand"
                    className="w-full px-3.5 py-2.5 text-xs rounded-lg border border-slate-300 text-slate-700 focus:outline-none focus:ring-1 focus:ring-[#0f5973]"
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
                    placeholder="e.g. Gurugram, Nainital, Mumbai"
                    className="w-full px-3.5 py-2.5 text-xs rounded-lg border border-slate-300 text-slate-700 focus:outline-none focus:ring-1 focus:ring-[#0f5973]"
                  />
                  {formErrors.city && <p className="text-rose-600 text-[11px] mt-1">{formErrors.city}</p>}
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Postal Pincode <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.pincode}
                    onChange={e => setFormData({ ...formData, pincode: e.target.value })}
                    placeholder="e.g. 122001"
                    maxLength={10}
                    className="w-full px-3.5 py-2.5 text-xs rounded-lg border border-slate-300 font-mono text-slate-700 focus:outline-none focus:ring-1 focus:ring-[#0f5973]"
                  />
                  {formErrors.pincode && <p className="text-rose-600 text-[11px] mt-1">{formErrors.pincode}</p>}
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Complete Address (House/Flat, Street, Landmark) <span className="text-rose-500">*</span>
                  </label>
                  <textarea
                    rows={3}
                    value={formData.address}
                    onChange={e => setFormData({ ...formData, address: e.target.value })}
                    placeholder="Enter complete postal address"
                    className="w-full px-3.5 py-2.5 text-xs rounded-lg border border-slate-300 text-slate-700 focus:outline-none focus:ring-1 focus:ring-[#0f5973]"
                  />
                  {formErrors.address && <p className="text-rose-600 text-[11px] mt-1">{formErrors.address}</p>}
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: UNIT & REQUIREMENT DETAILS */}
          {currentStep === 3 && (
            <div className="space-y-6 animate-fade-in">
              <div className="border-b border-slate-100 pb-3 flex items-center justify-between">
                <div>
                  <h3 className="text-base font-bold text-[#0f5973] flex items-center gap-2">
                    <Building className="w-4 h-4" />
                    <span>3. Unit Details & Requirements</span>
                  </h3>
                  <p className="text-xs text-slate-500">Sections 2, 3 & 5 of the Booking & Plot Details Form</p>
                </div>
                <span className="text-xs font-semibold text-slate-400">Step 3 of 4</span>
              </div>

              {/* Project Picker */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-2">
                  Select Development Project <span className="text-rose-500">*</span>
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {projects.map((p) => {
                    const isSelected = p.id === formData.projectId;
                    return (
                      <div
                        key={p.id}
                        onClick={() => {
                          setFormData({ 
                            ...formData, 
                            projectId: p.id,
                            unitSize: p.unit_types[0] || 'Standard Plot',
                            unitNumber: p.sample_units[0] || 'Plot-01'
                          });
                          onSelectProject(p.id);
                        }}
                        className={`p-3 rounded-lg border transition-all cursor-pointer ${
                          isSelected
                            ? 'border-[#0f5973] bg-teal-50/50 ring-1 ring-[#0f5973]'
                            : 'border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-xs text-slate-900">{p.name}</span>
                          <span className="text-[11px] font-bold text-[#0f5973]">
                            Token: ₹{p.token_amount.toLocaleString('en-IN')}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 mt-1">{p.location}</p>
                        <div className="flex items-center gap-2 mt-2 text-[10px] text-emerald-700 font-medium">
                          <span>Targeted ROI: {p.roi_percentage}% p.a.</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Unit Specifications */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Preferred Unit / Plot No.
                  </label>
                  <input
                    type="text"
                    value={formData.unitNumber}
                    onChange={e => setFormData({ ...formData, unitNumber: e.target.value })}
                    placeholder="e.g. PG-104 or Plot-12"
                    className="w-full px-3.5 py-2 text-xs rounded-lg border border-slate-300 font-mono text-slate-800"
                  />
                  <p className="text-[10px] text-slate-400 mt-1">Confirmed upon allocation review</p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Unit Size / Dimension
                  </label>
                  <select
                    value={formData.unitSize}
                    onChange={e => setFormData({ ...formData, unitSize: e.target.value })}
                    className="w-full px-3.5 py-2 text-xs rounded-lg border border-slate-300 text-slate-800"
                  >
                    {activeProject?.unit_types?.map((ut, idx) => (
                      <option key={idx} value={ut}>{ut}</option>
                    ))}
                    <option value="Custom Size">Custom Size / Layout</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Floor No. / Level
                  </label>
                  <input
                    type="text"
                    value={formData.floorNo}
                    onChange={e => setFormData({ ...formData, floorNo: e.target.value })}
                    placeholder="Ground / Independent"
                    className="w-full px-3.5 py-2 text-xs rounded-lg border border-slate-300 text-slate-800"
                  />
                </div>
              </div>

              {/* Professional & Requirement Information */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Company / Organization Name <span className="text-slate-400 font-normal">(Optional)</span>
                  </label>
                  <input
                    type="text"
                    value={formData.companyName}
                    onChange={e => setFormData({ ...formData, companyName: e.target.value })}
                    placeholder="e.g. TechCorp Solutions"
                    className="w-full px-3.5 py-2 text-xs rounded-lg border border-slate-300 text-slate-800"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Profession / Occupation
                  </label>
                  <input
                    type="text"
                    value={formData.profession}
                    onChange={e => setFormData({ ...formData, profession: e.target.value })}
                    placeholder="e.g. Salaried / Business Owner / Investor"
                    className="w-full px-3.5 py-2 text-xs rounded-lg border border-slate-300 text-slate-800"
                  />
                </div>
              </div>

              {/* Documents Submitted checklist matching PDF Section 5 */}
              <div className="pt-2">
                <label className="block text-xs font-semibold text-slate-700 mb-2">
                  5. Documents Submitted Checklist (Self-Declaration)
                </label>
                <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 flex flex-wrap gap-4 text-xs text-slate-700">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.documentsSubmitted.id_proof}
                      onChange={e => setFormData({
                        ...formData,
                        documentsSubmitted: { ...formData.documentsSubmitted, id_proof: e.target.checked }
                      })}
                      className="rounded text-[#0f5973] focus:ring-0"
                    />
                    <span>ID Proof (Aadhar / PAN / Passport)</span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.documentsSubmitted.address_proof}
                      onChange={e => setFormData({
                        ...formData,
                        documentsSubmitted: { ...formData.documentsSubmitted, address_proof: e.target.checked }
                      })}
                      className="rounded text-[#0f5973] focus:ring-0"
                    />
                    <span>Address Proof</span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.documentsSubmitted.photo}
                      onChange={e => setFormData({
                        ...formData,
                        documentsSubmitted: { ...formData.documentsSubmitted, photo: e.target.checked }
                      })}
                      className="rounded text-[#0f5973] focus:ring-0"
                    />
                    <span>Passport Size Photo</span>
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* STEP 4: REVIEW & PAYMENT TERMS */}
          {currentStep === 4 && (
            <div className="space-y-6 animate-fade-in">
              <div className="border-b border-slate-100 pb-3 flex items-center justify-between">
                <div>
                  <h3 className="text-base font-bold text-[#0f5973] flex items-center gap-2">
                    <CreditCard className="w-4 h-4" />
                    <span>4. Review Details & Complete Secure Payment</span>
                  </h3>
                  <p className="text-xs text-slate-500">Please verify all booking parameters before proceeding</p>
                </div>
                <span className="text-xs font-semibold text-slate-400">Step 4 of 4</span>
              </div>

              {/* Review Summary Box */}
              <div className="bg-slate-50 rounded-xl border border-slate-200 p-5 space-y-4">
                
                {/* Applicant Summary */}
                <div className="flex items-start justify-between pb-3 border-b border-slate-200 text-xs">
                  <div>
                    <span className="text-[11px] font-bold text-[#0f5973] uppercase tracking-wider">Applicant</span>
                    <p className="font-bold text-slate-900 text-sm mt-0.5">{formData.fullName}</p>
                    <p className="text-slate-600 font-mono">{formData.mobile} · {formData.email}</p>
                    <p className="text-slate-500 mt-0.5">{formData.address}, {formData.city}, {formData.state} - {formData.pincode}</p>
                    {formData.hasCoApplicant && (
                      <p className="text-slate-600 mt-1 text-[11px]">
                        <span className="font-semibold">Co-Applicant:</span> {formData.coApplicantName} ({formData.coApplicantMobile})
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setCurrentStep(1)}
                    className="text-xs text-[#0f5973] hover:underline flex items-center gap-1 font-semibold cursor-pointer"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    <span>Edit</span>
                  </button>
                </div>

                {/* Unit Details Summary */}
                <div className="flex items-start justify-between pb-3 border-b border-slate-200 text-xs">
                  <div>
                    <span className="text-[11px] font-bold text-[#0f5973] uppercase tracking-wider">Selected Project & Unit</span>
                    <p className="font-bold text-slate-900 text-sm mt-0.5">{activeProject.name}</p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 mt-1 text-slate-600">
                      <div>Unit No: <span className="font-semibold text-slate-800">{formData.unitNumber || 'Allotted on verification'}</span></div>
                      <div>Size: <span className="font-semibold text-slate-800">{formData.unitSize}</span></div>
                      <div>Targeted ROI: <span className="font-semibold text-emerald-700">{activeProject.roi_percentage}% p.a.</span></div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setCurrentStep(3)}
                    className="text-xs text-[#0f5973] hover:underline flex items-center gap-1 font-semibold cursor-pointer"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    <span>Edit</span>
                  </button>
                </div>

                {/* Payment Breakdown Calculation (Server-side synced) */}
                <div>
                  <span className="text-[11px] font-bold text-[#0f5973] uppercase tracking-wider">Payment Breakdown</span>
                  <div className="mt-2 space-y-1.5 text-xs text-slate-600">
                    <div className="flex justify-between">
                      <span>Token Booking Advance:</span>
                      <span className="font-mono text-slate-800 font-semibold">₹ {tokenAmount.toLocaleString('en-IN')}</span>
                    </div>
                    {taxAmount > 0 && (
                      <div className="flex justify-between">
                        <span>Applicable Taxes ({activeProject.tax_percentage}%):</span>
                        <span className="font-mono text-slate-800">₹ {taxAmount.toLocaleString('en-IN')}</span>
                      </div>
                    )}
                    <div className="flex justify-between pt-2 border-t border-slate-200 text-sm font-bold text-[#0f5973]">
                      <span>Total Payable Now:</span>
                      <span className="font-mono text-base">₹ {totalPayable.toLocaleString('en-IN')}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* PDF Terms & Conditions Note (Section 6) */}
              <div className="p-3 bg-amber-50/70 border border-amber-200 rounded-lg text-xs text-amber-900">
                <p className="font-semibold mb-1">Official Booking Terms (Section 6):</p>
                <ul className="list-disc list-inside space-y-0.5 text-[11px] text-amber-800">
                  <li>The token amount is fully-refundable if booking is cancelled within 15 days.</li>
                  <li>Full payment must be completed within the agreed schedule.</li>
                  <li>Management reserves the right to cancel bookings in case of delayed payments.</li>
                </ul>
              </div>

              {/* Mandatory Consent & Digital Signature (Section 7) */}
              <div className="space-y-3 pt-2">
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.consent}
                    onChange={e => setFormData({ ...formData, consent: e.target.checked })}
                    className="mt-0.5 rounded text-[#0f5973] focus:ring-0"
                  />
                  <span className="text-xs text-slate-700 leading-snug">
                    I agree to the <a href="#terms" className="text-[#0f5973] underline font-medium">Terms & Conditions</a> and <a href="#privacy" className="text-[#0f5973] underline font-medium">Privacy Policy</a> and consent to being contacted regarding my registration/request. <span className="text-rose-500">*</span>
                  </span>
                </label>
                {formErrors.consent && <p className="text-rose-600 text-[11px]">{formErrors.consent}</p>}

                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.declarationSigned}
                    onChange={e => setFormData({ ...formData, declarationSigned: e.target.checked })}
                    className="mt-0.5 rounded text-[#0f5973] focus:ring-0"
                  />
                  <span className="text-xs text-slate-700 leading-snug">
                    I hereby declare that the information provided above is accurate to the best of my knowledge. I agree to the terms and conditions mentioned above. <span className="text-rose-500">*</span>
                  </span>
                </label>
                {formErrors.declarationSigned && <p className="text-rose-600 text-[11px]">{formErrors.declarationSigned}</p>}

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Digital Declaration Signee (Applicant Legal Name)
                  </label>
                  <input
                    type="text"
                    value={formData.signatureName || formData.fullName}
                    onChange={e => setFormData({ ...formData, signatureName: e.target.value })}
                    className="w-full px-3.5 py-2 text-xs rounded border border-slate-300 bg-white font-serif italic text-slate-800"
                    placeholder="Enter name as digital signature"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Form Navigation Controls */}
          <div className="mt-8 pt-5 border-t border-slate-200 flex items-center justify-between">
            {currentStep > 1 ? (
              <button
                type="button"
                onClick={handlePrev}
                disabled={isSubmitting}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4" />
                <span>Previous Step</span>
              </button>
            ) : <div></div>}

            {currentStep < 4 ? (
              <button
                type="button"
                onClick={handleNext}
                className="px-6 py-2.5 bg-[#0f5973] hover:bg-[#0a4358] text-white text-xs font-bold rounded-lg shadow-sm transition-colors flex items-center gap-2 cursor-pointer ml-auto"
              >
                <span>Continue</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={isSubmitting}
                className="px-8 py-3 bg-[#b87e2b] hover:bg-[#a66f24] text-white text-xs sm:text-sm font-bold uppercase tracking-wider rounded-lg shadow-md hover:shadow-lg transition-all flex items-center gap-2 cursor-pointer ml-auto disabled:opacity-50"
              >
                {isSubmitting ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    <span>Creating Order...</span>
                  </>
                ) : (
                  <>
                    <ShieldCheck className="w-4 h-4" />
                    <span>Proceed to Secure Payment (₹{totalPayable.toLocaleString('en-IN')})</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>

      </div>
    </div>
  );
};
