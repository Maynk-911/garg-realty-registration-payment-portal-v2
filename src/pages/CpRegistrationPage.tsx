import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Briefcase, CheckCircle2, FileText, Handshake, MapPin, Paperclip, ShieldCheck, Star, User, X, ClipboardList, Building2
} from 'lucide-react';
import {
  CP_DECLARATIONS, COMPANY_PARTNER_TYPES, CpPublicConfig, isValidEmail, GSTIN_REGEX, HEARD_FROM_OPTIONS, INDIA_PIN_REGEX, INDIAN_STATES,
  PAN_REGEX, PARTNER_TYPES, RERA_REGEX, isIndia, normalizeCpMobile
} from '../cpOptions.js';

interface CpRegistrationPageProps {
  onNavigateHome: () => void;
}

type Form = Record<string, string>;
interface PickedFile { name: string; size: number; data: string }
interface Confirmation { reference: string; full_name: string; submitted_at: string; status_label: string }

const EMPTY: Form = {
  full_name: '', mobile: '', whatsapp: '', email: '', date_of_birth: '',
  partner_type: '', company_name: '', years_experience: '', sales_agents: '', existing_business: '', website: '', linkedin: '',
  country: 'India', state: '', city: '', pincode: '', address: '',
  pan_number: '', gst_number: '', rera_number: '', rera_state: '', business_registration_number: '',
  expected_monthly_leads: '', preferred_locations: '', previous_experience: '', heard_from: '', referral_code: '', comments: ''
};

const inputCls = (error?: string) =>
  `w-full px-3.5 py-2.5 text-xs sm:text-sm rounded-lg border text-slate-800 bg-white focus:outline-none focus:ring-1 focus:ring-[#0f5973] ${
    error ? 'border-rose-400 bg-rose-50/20' : 'border-slate-300'
  }`;
const mb = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`);
const Label = ({ field, children, required, optional }: { field: string; children: React.ReactNode; required?: boolean; optional?: boolean }) => (
  <label htmlFor={`field-${field}`} className="block text-xs font-semibold text-slate-700 mb-1">
    {children} {required && <span className="text-rose-500" aria-hidden="true">*</span>}
    {optional && <span className="text-slate-400 font-normal">(Optional)</span>}
  </label>
);

const Section = ({ n, icon: Icon, title, children, note }: { n: number; icon: React.ElementType; title: string; children: React.ReactNode; note?: string }) => (
  <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 sm:p-7 space-y-4" aria-labelledby={`section-${n}`}>
    <div className="border-b border-slate-100 pb-3">
      <h2 id={`section-${n}`} className="text-sm sm:text-base font-bold text-[#0f5973] flex items-center gap-2">
        <Icon className="w-4 h-4" aria-hidden="true" />
        <span>{n}. {title}</span>
      </h2>
      {note && <p className="text-[11px] text-slate-500 mt-1">{note}</p>}
    </div>
    {children}
  </section>
);

const newSubmissionId = () =>
  (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`);

// Public page /cp-registration: Channel Partner / Broker application. Saved to the database for admin review.
export const CpRegistrationPage: React.FC<CpRegistrationPageProps> = ({ onNavigateHome }) => {
  const [config, setConfig] = useState<CpPublicConfig | null>(null);
  const [configError, setConfigError] = useState('');
  const [form, setForm] = useState<Form>(EMPTY);
  const [whatsappSame, setWhatsappSame] = useState(true);
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [files, setFiles] = useState<Record<string, PickedFile>>({});
  const [declarations, setDeclarations] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [emailNote, setEmailNote] = useState('');
  // One id per filled-in form: a double click or network retry returns the same application instead of a second one
  const submissionId = useRef(newSubmissionId());

  const loadConfig = () => {
    setConfigError('');
    fetch('/api/cp/config')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error())))
      .then(setConfig)
      .catch(() => setConfigError('The application form could not be loaded. Please check your connection and try again.'));
  };
  useEffect(loadConfig, []);
  // The "please correct" banner goes away as soon as the applicant changes something
  useEffect(() => { setSubmitError(''); }, [form, whatsappSame, projectIds, files, declarations]);

  const india = !config?.allowInternational || isIndia(form.country);
  const companyRequired = COMPANY_PARTNER_TYPES.includes(form.partner_type as any);
  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setForm(f => ({ ...f, [field]: e.target.value }));
    if (errors[field]) setErrors(({ [field]: _, ...rest }) => rest);
  };

  const validate = (): Record<string, string> => {
    const e: Record<string, string> = {};
    const t = (k: string) => form[k].trim();
    if (!t('full_name')) e.full_name = 'Full name is required';
    else if (t('full_name').length < 2) e.full_name = 'Enter your full name';
    if (!t('mobile')) e.mobile = 'Mobile number is required';
    else if (!normalizeCpMobile(t('mobile'), form.country)) e.mobile = india ? 'Enter a valid 10-digit Indian mobile number' : 'Enter a valid mobile number with country code';
    if (!whatsappSame && t('whatsapp') && !normalizeCpMobile(t('whatsapp'), form.country)) e.whatsapp = 'Enter a valid WhatsApp number';
    if (t('email') && !isValidEmail(t('email'))) e.email = 'Enter a valid e-mail address (letters, numbers and . _ % + - only)';
    if (!form.partner_type) e.partner_type = 'Select your partner type';
    if (companyRequired && !t('company_name')) e.company_name = 'Company / firm name is required for firms and companies';
    if (!t('years_experience')) e.years_experience = 'Years of experience is required';
    else if (!/^\d+$/.test(t('years_experience')) || Number(t('years_experience')) > 60) e.years_experience = 'Enter a whole number of years (0–60)';
    if (t('sales_agents') && !/^\d+$/.test(t('sales_agents'))) e.sales_agents = 'Enter a whole number';
    if (t('linkedin') && !/linkedin\.com/i.test(t('linkedin'))) e.linkedin = 'Enter a LinkedIn profile link (linkedin.com/...)';
    if (!t('state')) e.state = 'State is required';
    if (!t('city')) e.city = 'City is required';
    if (!t('pincode')) e.pincode = india ? 'PIN code is required' : 'Postal code is required';
    else if (india && !INDIA_PIN_REGEX.test(t('pincode'))) e.pincode = 'Enter a valid 6-digit PIN code';
    if (!t('address')) e.address = 'Full address is required';
    else if (t('address').length < 10) e.address = 'Enter your complete address';
    const pan = t('pan_number').toUpperCase();
    if (india && !pan) e.pan_number = 'PAN is required';
    else if (pan && !PAN_REGEX.test(pan)) e.pan_number = 'PAN format is ABCDE1234F';
    if (t('gst_number') && !GSTIN_REGEX.test(t('gst_number').toUpperCase())) e.gst_number = 'GSTIN format is 22ABCDE1234F1Z5 (15 characters)';
    if (t('rera_number') && !RERA_REGEX.test(t('rera_number'))) e.rera_number = 'Use letters, numbers and / - . only';
    if (t('expected_monthly_leads') && !/^\d+$/.test(t('expected_monthly_leads'))) e.expected_monthly_leads = 'Enter a whole number';
    if (!projectIds.length) e.project_ids = 'Select at least one project';
    for (const d of config?.documents || []) if (d.required && !files[d.key]) e[`document_${d.key}`] = `${d.label} is required`;
    const total = Object.values(files).reduce((s, f) => s + f.size, 0);
    if (config && total > config.maxTotalBytes) e.documents = `All documents together must be ${mb(config.maxTotalBytes)} or less`;
    for (const d of CP_DECLARATIONS) if (!declarations[d.key]) e[`declaration_${d.key}`] = 'Please accept this declaration';
    return e;
  };

  const scrollToFirstError = (e: Record<string, string>) => {
    const first = Object.keys(e)[0];
    requestAnimationFrame(() => document.getElementById(`field-${first}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  };

  const pickFile = (key: string, formats: readonly string[]) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !config) return;
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    const allowed = formats.flatMap(f => (f === 'jpg' ? ['jpg', 'jpeg'] : [f]));
    const fail = (msg: string) => setErrors(prev => ({ ...prev, [`document_${key}`]: msg }));
    if (!allowed.includes(ext)) return fail(`Only ${formats.map(f => f.toUpperCase()).join(', ')} files are accepted`);
    if (file.size > config.maxFileBytes) return fail(`This file is ${mb(file.size)}. The limit is ${mb(config.maxFileBytes)} per file.`);
    if (file.size === 0) return fail('This file is empty');
    const reader = new FileReader();
    reader.onload = () => {
      setFiles(prev => ({ ...prev, [key]: { name: file.name, size: file.size, data: String(reader.result) } }));
      setErrors(({ [`document_${key}`]: _, documents: __, ...rest }) => rest);
    };
    reader.onerror = () => fail('The file could not be read. Please choose it again.');
    reader.readAsDataURL(file);
  };

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (submitting) return;
    setSubmitError('');
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) {
      setSubmitError('Please correct the highlighted fields.');
      scrollToFirstError(e);
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/cp/applications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v.trim()])),
          whatsapp: whatsappSame ? '' : form.whatsapp.trim(),
          project_ids: projectIds,
          declarations,
          declaration_version: config?.declarationVersion,
          client_submission_id: submissionId.current,
          documents: Object.entries(files).map(([type, f]) => ({ type, name: f.name, data: f.data }))
        })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.application) {
        setConfirmation(data.application);
        setEmailNote(data.acknowledgementEmail === 'sending' ? 'An acknowledgement is being sent to your e-mail address.' : '');
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
      if (data.fields) { setErrors(data.fields); scrollToFirstError(data.fields); }
      setSubmitError(
        res.status === 413 ? 'Your documents are too large to upload together. Please use smaller files.'
          : data.error || 'Your application could not be submitted. Please try again.'
      );
    } catch {
      setSubmitError('Your application could not be submitted because the connection failed. Please check your internet connection and try again — your details are still filled in.');
    } finally {
      setSubmitting(false);
    }
  };

  const totalUploaded = useMemo(() => Object.values(files).reduce((s, f) => s + f.size, 0), [files]);

  // ---------- small building blocks (plain functions, so inputs keep focus while typing) ----------
  const fieldError = (field: string) =>
    errors[field] ? <p id={`error-${field}`} role="alert" className="text-rose-600 text-[11px] mt-1">{errors[field]}</p> : null;
  const aria = (field: string) => ({ id: `field-${field}`, 'aria-invalid': Boolean(errors[field]), 'aria-describedby': errors[field] ? `error-${field}` : undefined });
  const text = (field: string, label: string, opts: { required?: boolean; optional?: boolean; placeholder?: string; type?: string; maxLength?: number; inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode']; upper?: boolean; autoComplete?: string } = {}) => (
    <div>
      <Label field={field} required={opts.required} optional={opts.optional}>{label}</Label>
      <input
        {...aria(field)}
        type={opts.type || 'text'}
        value={form[field]}
        onChange={opts.upper ? e => { setForm(f => ({ ...f, [field]: e.target.value.toUpperCase() })); if (errors[field]) setErrors(({ [field]: _, ...r }) => r); } : set(field)}
        placeholder={opts.placeholder}
        maxLength={opts.maxLength}
        inputMode={opts.inputMode}
        autoComplete={opts.autoComplete}
        className={`${inputCls(errors[field])}${opts.upper ? ' font-mono uppercase' : ''}`}
      />
      {fieldError(field)}
    </div>
  );

  // ---------- confirmation ----------
  if (confirmation) {
    return (
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-10 sm:py-14">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-lg p-6 sm:p-10 text-center">
          <div className="w-14 h-14 mx-auto rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center mb-4">
            <CheckCircle2 className="w-7 h-7 text-emerald-600" aria-hidden="true" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-[#0f5973] font-['Playfair_Display']">Application Submitted</h1>
          <p className="mt-4 text-sm text-slate-600 leading-relaxed">
            Thank you for applying to become a Garg Realty Group Channel Partner. Your application has been submitted successfully and is
            awaiting verification. Our team will review your details and contact you regarding the next steps.
          </p>
          <dl className="mt-6 text-left bg-slate-50 border border-slate-200 rounded-xl divide-y divide-slate-200 text-sm">
            <div className="flex justify-between gap-4 p-3.5"><dt className="text-slate-500">Application Reference</dt><dd className="font-mono font-bold text-slate-900">{confirmation.reference}</dd></div>
            <div className="flex justify-between gap-4 p-3.5"><dt className="text-slate-500">Applicant Name</dt><dd className="font-semibold text-slate-900 text-right">{confirmation.full_name}</dd></div>
            <div className="flex justify-between gap-4 p-3.5"><dt className="text-slate-500">Submission Date</dt><dd className="text-slate-900">{new Date(confirmation.submitted_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })}</dd></div>
            <div className="flex justify-between gap-4 p-3.5"><dt className="text-slate-500">Current Status</dt><dd><span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-50 text-amber-800 border border-amber-200">{confirmation.status_label}</span></dd></div>
          </dl>
          <p className="mt-4 text-xs text-slate-500">
            Please note your application reference for any correspondence. {emailNote}
          </p>
          <div className="mt-6 flex flex-col sm:flex-row gap-3 justify-center no-print">
            <button type="button" onClick={() => window.print()} className="px-5 py-2.5 border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-bold uppercase tracking-wider rounded-lg cursor-pointer">
              Print / Save
            </button>
            <button type="button" onClick={onNavigateHome} className="px-6 py-2.5 bg-[#b87e2b] hover:bg-[#a66f24] text-white text-xs font-bold uppercase tracking-wider rounded-lg shadow-sm cursor-pointer">
              Back to Home
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-slate-50">
      <section className="bg-gradient-to-b from-[#0f5973] to-[#083545] text-white px-4 sm:px-6 pt-10 pb-16 sm:pt-14 sm:pb-20">
        <div className="max-w-3xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/10 border border-white/20 text-amber-300 text-xs font-semibold mb-4">
            <Handshake className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Channel Partner / Broker Onboarding</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-extrabold font-['Playfair_Display'] leading-tight">Become a Channel Partner</h1>
          <p className="mt-3 text-sm sm:text-base text-teal-100/90 max-w-2xl mx-auto leading-relaxed">
            Brokers, real estate consultants, brokerage firms and channel partner companies can apply here to work with Garg Realty Group.
            Our team reviews every application before approval.
          </p>
        </div>
      </section>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 -mt-8 pb-16">
        {!config && !configError && (
          <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-xs text-slate-500">Loading the application form…</div>
        )}
        {configError && (
          <div className="bg-white rounded-2xl border border-rose-200 p-6 text-center">
            <p className="text-sm text-rose-700">{configError}</p>
            <button type="button" onClick={loadConfig} className="mt-3 px-4 py-2 text-xs font-semibold border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer">Try again</button>
          </div>
        )}

        {config && (
          <form onSubmit={submit} noValidate className="space-y-5">
            <p className="text-[11px] text-slate-500 bg-white border border-slate-200 rounded-xl px-4 py-3">
              Fields marked <span className="text-rose-500">*</span> are required. Format checks only confirm that numbers look correct;
              our team verifies registrations and documents before any approval.
            </p>

            <Section n={1} icon={User} title="Personal Information">
              {text('full_name', 'Full Name', { required: true, placeholder: 'e.g. Rahul Sharma', maxLength: 120, autoComplete: 'name' })}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {text('mobile', 'Mobile Number', { required: true, type: 'tel', placeholder: india ? '98765 43210' : '+971 50 123 4567', maxLength: 18, inputMode: 'tel', autoComplete: 'tel' })}
                <div>
                  <Label field="whatsapp">WhatsApp Number</Label>
                  <label className="flex items-center gap-2 text-xs text-slate-600 mb-2 cursor-pointer">
                    <input type="checkbox" checked={whatsappSame} onChange={e => setWhatsappSame(e.target.checked)} className="w-3.5 h-3.5 accent-[#0f5973]" />
                    <span>Same as mobile number</span>
                  </label>
                  {!whatsappSame && (
                    <>
                      <input {...aria('whatsapp')} type="tel" inputMode="tel" value={form.whatsapp} onChange={set('whatsapp')} placeholder="WhatsApp number" maxLength={18} className={inputCls(errors.whatsapp)} />
                      {fieldError('whatsapp')}
                    </>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {text('email', 'Email Address', { optional: true, type: 'email', placeholder: 'name@example.com', maxLength: 190, autoComplete: 'email' })}
                {text('date_of_birth', 'Date of Birth', { optional: true, type: 'date' })}
              </div>
              <p className="text-[11px] text-slate-500 -mt-1">Add an e-mail address to receive your acknowledgement and approval confirmation by e-mail.</p>
            </Section>

            <Section n={2} icon={Briefcase} title="Professional Information">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label field="partner_type" required>Partner Type</Label>
                  <select {...aria('partner_type')} value={form.partner_type} onChange={set('partner_type')} className={inputCls(errors.partner_type)}>
                    <option value="">Select…</option>
                    {PARTNER_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                  {fieldError('partner_type')}
                </div>
                {text('company_name', 'Company / Firm Name', { required: companyRequired, optional: !companyRequired, maxLength: 160, autoComplete: 'organization' })}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {text('years_experience', 'Years of Experience', { required: true, inputMode: 'numeric', maxLength: 2, placeholder: 'e.g. 5' })}
                {text('sales_agents', 'Number of Sales Agents', { optional: true, inputMode: 'numeric', maxLength: 6 })}
              </div>
              {text('existing_business', 'Existing Real Estate Business', { optional: true, maxLength: 500, placeholder: 'e.g. Residential resale and rentals in Noida' })}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {text('website', 'Professional Website', { optional: true, type: 'url', maxLength: 255, placeholder: 'https://' })}
                {text('linkedin', 'LinkedIn Profile', { optional: true, type: 'url', maxLength: 255, placeholder: 'https://www.linkedin.com/in/…' })}
              </div>
            </Section>

            <Section n={3} icon={MapPin} title="Address Information">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label field="country" required>Country</Label>
                  {config.allowInternational
                    ? <input {...aria('country')} value={form.country} onChange={set('country')} maxLength={80} className={inputCls(errors.country)} />
                    : <input {...aria('country')} value="India" readOnly className={`${inputCls()} bg-slate-50 text-slate-600`} />}
                  {fieldError('country')}
                </div>
                <div>
                  <Label field="state" required>State</Label>
                  {india ? (
                    <select {...aria('state')} value={form.state} onChange={set('state')} className={inputCls(errors.state)}>
                      <option value="">Select state…</option>
                      {INDIAN_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  ) : (
                    <input {...aria('state')} value={form.state} onChange={set('state')} maxLength={80} className={inputCls(errors.state)} />
                  )}
                  {fieldError('state')}
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {text('city', 'City', { required: true, maxLength: 80, autoComplete: 'address-level2' })}
                {text('pincode', india ? 'PIN Code' : 'Postal Code', { required: true, inputMode: india ? 'numeric' : 'text', maxLength: india ? 6 : 10, autoComplete: 'postal-code' })}
              </div>
              <div>
                <Label field="address" required>Full Address</Label>
                <textarea {...aria('address')} rows={3} value={form.address} onChange={set('address')} maxLength={500} className={inputCls(errors.address)} />
                {fieldError('address')}
              </div>
            </Section>

            <Section n={4} icon={Building2} title="Business and Tax Information"
              note="Registration requirements differ between brokers. Leave optional numbers blank if they do not apply to you; our team will advise if anything else is needed.">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {text('pan_number', 'PAN Number', { required: india, optional: !india, upper: true, maxLength: 10, placeholder: 'ABCDE1234F' })}
                {text('gst_number', 'GST Number', { optional: true, upper: true, maxLength: 15, placeholder: '22ABCDE1234F1Z5' })}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {text('rera_number', 'RERA Registration Number', { optional: true, maxLength: 60 })}
                <div>
                  <Label field="rera_state" optional>RERA Registration State</Label>
                  <select {...aria('rera_state')} value={form.rera_state} onChange={set('rera_state')} className={inputCls(errors.rera_state)}>
                    <option value="">Not applicable</option>
                    {INDIAN_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                  {fieldError('rera_state')}
                </div>
              </div>
              {text('business_registration_number', 'Business Registration Number', { optional: true, maxLength: 60, placeholder: 'e.g. CIN / LLPIN / Udyam number' })}
            </Section>

            <Section n={5} icon={Star} title="Preferred Projects" note="Tell us which projects you would like to work on. This does not by itself give access to inventory or bookings.">
              <fieldset id="field-project_ids" aria-describedby={errors.project_ids ? 'error-project_ids' : undefined}>
                <legend className="sr-only">Projects of interest</legend>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {config.projects.map(p => (
                    <label key={p.id} className={`flex items-center gap-3 p-3.5 rounded-xl border cursor-pointer transition-colors ${projectIds.includes(p.id) ? 'border-[#0f5973] bg-teal-50/60' : 'border-slate-200 hover:border-slate-300'}`}>
                      <input
                        type="checkbox"
                        checked={projectIds.includes(p.id)}
                        onChange={e => {
                          setProjectIds(ids => (e.target.checked ? [...ids, p.id] : ids.filter(x => x !== p.id)));
                          setErrors(({ project_ids: _, ...r }) => r);
                        }}
                        className="w-4 h-4 accent-[#0f5973]"
                      />
                      <span className="text-sm font-semibold text-slate-800">{p.name}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              {fieldError('project_ids')}
            </Section>

            <Section n={6} icon={ClipboardList} title="Additional Information">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {text('expected_monthly_leads', 'Expected Monthly Leads', { optional: true, inputMode: 'numeric', maxLength: 6 })}
                {text('preferred_locations', 'Preferred Working Locations', { optional: true, maxLength: 500, placeholder: 'e.g. Delhi NCR, Dehradun' })}
              </div>
              <div>
                <Label field="previous_experience" optional>Previous Real Estate Experience</Label>
                <textarea {...aria('previous_experience')} rows={3} value={form.previous_experience} onChange={set('previous_experience')} maxLength={2000} className={inputCls()} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label field="heard_from" optional>How Did You Hear About Garg Realty?</Label>
                  <select {...aria('heard_from')} value={form.heard_from} onChange={set('heard_from')} className={inputCls(errors.heard_from)}>
                    <option value="">Select…</option>
                    {HEARD_FROM_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
                {text('referral_code', 'Referral Partner Code', { optional: true, upper: true, maxLength: 40 })}
              </div>
              <div>
                <Label field="comments" optional>Additional Comments</Label>
                <textarea {...aria('comments')} rows={3} value={form.comments} onChange={set('comments')} maxLength={2000} className={inputCls()} />
              </div>
            </Section>

            <Section n={7} icon={Paperclip} title="Documents"
              note={`PDF, JPG or PNG, up to ${mb(config.maxFileBytes)} per file and ${mb(config.maxTotalBytes)} in total. Documents are stored privately and seen only by authorised staff.`}>
              <div className="space-y-3" id="field-documents">
                {config.documents.map(d => {
                  const f = files[d.key];
                  const err = errors[`document_${d.key}`];
                  return (
                    <div key={d.key} id={`field-document_${d.key}`} className={`p-3.5 rounded-xl border ${err ? 'border-rose-300 bg-rose-50/30' : 'border-slate-200'}`}>
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div>
                          <p className="text-xs font-semibold text-slate-800">
                            {d.label}{' '}
                            {d.required ? <span className="text-rose-600 text-[10px] font-bold uppercase">Required</span> : <span className="text-slate-400 text-[10px] font-semibold uppercase">Optional</span>}
                          </p>
                          <p className="text-[11px] text-slate-500">{d.hint} · {d.formats.map(x => x.toUpperCase()).join(', ')}</p>
                        </div>
                        {f ? (
                          <div className="flex items-center gap-2 text-[11px] text-slate-700 min-w-0">
                            <FileText className="w-3.5 h-3.5 text-[#0f5973] shrink-0" aria-hidden="true" />
                            <span className="truncate max-w-[180px]" title={f.name}>{f.name}</span>
                            <span className="text-slate-400 shrink-0">{mb(f.size)}</span>
                            <button type="button" aria-label={`Remove ${d.label}`} onClick={() => setFiles(({ [d.key]: _, ...rest }) => rest)} className="p-1 rounded hover:bg-slate-100 cursor-pointer">
                              <X className="w-3.5 h-3.5 text-slate-500" />
                            </button>
                          </div>
                        ) : (
                          <label className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-[11px] font-bold uppercase tracking-wide text-[#0f5973] border border-[#0f5973]/40 rounded-lg hover:bg-teal-50 cursor-pointer">
                            <Paperclip className="w-3.5 h-3.5" aria-hidden="true" />
                            <span>Choose file</span>
                            <input
                              type="file"
                              className="sr-only"
                              aria-label={`Upload ${d.label}`}
                              accept={d.formats.map(x => (x === 'pdf' ? '.pdf,application/pdf' : x === 'jpg' ? '.jpg,.jpeg,image/jpeg' : '.png,image/png')).join(',')}
                              onChange={pickFile(d.key, d.formats)}
                            />
                          </label>
                        )}
                      </div>
                      {err && <p role="alert" className="text-rose-600 text-[11px] mt-1.5">{err}</p>}
                    </div>
                  );
                })}
                {totalUploaded > 0 && <p className="text-[11px] text-slate-500">Total selected: {mb(totalUploaded)} of {mb(config.maxTotalBytes)}</p>}
                {fieldError('documents')}
              </div>
            </Section>

            <Section n={8} icon={ShieldCheck} title="Declarations">
              <div className="space-y-3">
                {CP_DECLARATIONS.map(d => (
                  <div key={d.key} id={`field-declaration_${d.key}`}>
                    <label className="flex items-start gap-2.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={Boolean(declarations[d.key])}
                        onChange={e => { setDeclarations(x => ({ ...x, [d.key]: e.target.checked })); setErrors(({ [`declaration_${d.key}`]: _, ...r }) => r); }}
                        className="mt-0.5 w-4 h-4 accent-[#0f5973] shrink-0"
                      />
                      <span className="text-xs text-slate-700 leading-relaxed">
                        {d.key === 'terms' ? (
                          <>I have read and agree to the{' '}
                            <a href="/privacy-policy" target="_blank" rel="noopener noreferrer" className="text-[#0f5973] underline">Privacy Policy</a> and the{' '}
                            <a href="/terms-and-conditions" target="_blank" rel="noopener noreferrer" className="text-[#0f5973] underline">Terms &amp; Conditions</a>.</>
                        ) : d.text}{' '}
                        <span className="text-rose-500" aria-hidden="true">*</span>
                      </span>
                    </label>
                    {fieldError(`declaration_${d.key}`)}
                  </div>
                ))}
              </div>
            </Section>

            {submitError && (
              <div role="alert" className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs leading-relaxed">{submitError}</div>
            )}

            <div className="flex flex-col-reverse sm:flex-row gap-3 items-center justify-between">
              <button type="button" onClick={onNavigateHome} className="text-xs text-slate-500 hover:text-slate-800 cursor-pointer">Cancel and return home</button>
              <button
                type="submit"
                disabled={submitting}
                className="w-full sm:w-auto px-8 py-3.5 bg-[#b87e2b] hover:bg-[#a66f24] active:scale-[0.99] text-white text-xs sm:text-sm font-bold uppercase tracking-wider rounded-lg shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {submitting ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden="true"></span>
                    <span>Submitting application…</span>
                  </>
                ) : (
                  <>
                    <Handshake className="w-4 h-4" aria-hidden="true" />
                    <span>Submit Application</span>
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
