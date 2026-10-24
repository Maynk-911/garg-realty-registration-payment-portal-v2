// E-mail notifications for Channel Partner onboarding.
// Sent through any SMTP server (e.g. Hostinger e-mail: smtp.hostinger.com, port 465) configured with SMTP_* variables.
// Without SMTP settings nothing is sent and each notification is recorded as NOT_CONFIGURED, so the admin panel
// shows exactly who still has to be contacted manually. "SENT" means the mail server accepted the message;
// it is not proof that it reached the inbox. Logs contain only the application reference, never personal data.
import nodemailer, { Transporter } from 'nodemailer';
import { CpApplication, CpNotification, CpPartner } from '../types.js';
import { isValidEmail } from '../cpOptions.js';

interface SmtpSettings {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  password?: string;
  from: string;
}

function smtpSettings(): SmtpSettings | null {
  const host = process.env.SMTP_HOST?.trim();
  const from = process.env.SMTP_FROM?.trim() || process.env.SMTP_USER?.trim();
  if (!host || !from) return null;
  const port = Number(process.env.SMTP_PORT || 465);
  return {
    host,
    port,
    secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : port === 465,
    user: process.env.SMTP_USER?.trim() || undefined,
    password: process.env.SMTP_PASSWORD || undefined,
    from
  };
}

let transporter: Transporter | null = null;
let transporterKey = '';
function getTransporter(s: SmtpSettings) {
  const key = `${s.host}:${s.port}:${s.secure}:${s.user || ''}`;
  if (!transporter || transporterKey !== key) {
    transporter = nodemailer.createTransport({
      host: s.host, port: s.port, secure: s.secure,
      auth: s.user ? { user: s.user, pass: s.password || '' } : undefined,
      connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 30_000
    });
    transporterKey = key;
  }
  return transporter;
}

/** Bare sender address for the SMTP envelope ("Name <a@b.c>" -> a@b.c) */
const smtpEnvelopeFrom = (s: SmtpSettings) => /<([^<>]+)>\s*$/.exec(s.from)?.[1]?.trim() || s.from;

export const cpEmailConfigured = () => smtpSettings() !== null;
/** Internal onboarding inbox for new-application alerts */
export const cpInternalRecipient = () => process.env.CP_NOTIFY_EMAIL?.trim() || process.env.ADMIN_EMAIL?.trim() || undefined;

function contactLines() {
  const lines: string[] = [];
  if (process.env.CP_CONTACT_EMAIL?.trim()) lines.push(`E-mail: ${process.env.CP_CONTACT_EMAIL.trim()}`);
  if (process.env.CP_CONTACT_PHONE?.trim()) lines.push(`Phone / WhatsApp: ${process.env.CP_CONTACT_PHONE.trim()}`);
  return lines.length ? `\nFor any questions, please contact our partner team:\n${lines.join('\n')}\n` : '\nFor any questions, simply reply to this e-mail.\n';
}

const istDate = (iso: string) => new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
const SIGNATURE = '\nWarm regards,\nChannel Partner Team\nGarg Realty Group | Garg Residency Private Limited\n';

/** Subject and body for one notification (plain text: nothing from the applicant is rendered as HTML) */
export function buildCpEmail(
  n: CpNotification, a: CpApplication, partner: CpPartner | null, projectName: (id: string) => string
): { subject: string; text: string } {
  const projects = (ids: string[]) => ids.map(projectName).join(', ') || '—';
  switch (n.event) {
    case 'SUBMITTED':
      return {
        subject: `Application received – ${a.application_ref}`,
        text: `Dear ${a.full_name},\n\nThank you for applying to become a Garg Realty Group Channel Partner. Your application has been submitted successfully and is awaiting verification.\n\nApplication reference: ${a.application_ref}\nSubmitted on: ${istDate(a.created_at)}\nStatus: Pending Review\n\nOur team will review your details and contact you regarding the next steps. Please quote your application reference in any correspondence.\n${contactLines()}${SIGNATURE}`
      };
    case 'SUBMITTED_INTERNAL':
      return {
        subject: `New Channel Partner application – ${a.application_ref}`,
        text: `A new Channel Partner / Broker application was submitted.\n\nReference: ${a.application_ref}\nSubmitted: ${istDate(a.created_at)}\nProjects of interest: ${projects(a.project_ids)}\n\nReview it in the Admin Panel under "CP / Broker Management" (sign-in required). Applicant details are not included in this e-mail.\n`
      };
    case 'APPROVED':
      return {
        subject: `Welcome aboard – your Channel Partner ID is ${partner?.cp_id || ''}`,
        text: `Dear ${a.full_name},\n\nWe are pleased to confirm that your Channel Partner application (${a.application_ref}) has been approved.\n\nYour official Channel Partner ID: ${partner?.cp_id || '—'}\nApproved project(s): ${projects(partner?.approved_project_ids || [])}\n\nPlease quote your CP ID in all communication with us. Our partner team will contact you shortly with the next steps, including project information and the channel partner terms.\n${n.message ? `\nNote from our team:\n${n.message}\n` : ''}${contactLines()}${SIGNATURE}`
      };
    case 'REJECTED':
      return {
        subject: `Update on your Channel Partner application – ${a.application_ref}`,
        text: `Dear ${a.full_name},\n\nThank you for your interest in partnering with Garg Realty Group. After reviewing your application (${a.application_ref}), we are unable to approve it at this time.\n${n.message ? `\nReason:\n${n.message}\n` : ''}${contactLines()}${SIGNATURE}`
      };
    case 'INFO_REQUESTED':
      return {
        subject: `Additional information needed – ${a.application_ref}`,
        text: `Dear ${a.full_name},\n\nThank you for applying to become a Garg Realty Group Channel Partner. To continue reviewing your application (${a.application_ref}), we need the following:\n\n${n.message || ''}\n\nPlease reply to this e-mail with the requested information or documents, quoting your application reference.\n${contactLines()}${SIGNATURE}`
      };
  }
}

/**
 * Try to send one notification and return it with the outcome recorded. Never throws:
 * a failed e-mail must not undo the submission or decision it belongs to.
 */
export async function deliverCpNotification(
  n: CpNotification, a: CpApplication, partner: CpPartner | null, projectName: (id: string) => string
): Promise<CpNotification> {
  const now = new Date().toISOString();
  if (!n.recipient) return { ...n, status: 'NO_RECIPIENT', updated_at: now };
  // Last line of defence: only plain, strictly valid addresses ever reach the mail library
  if (!isValidEmail(n.recipient)) {
    console.error(`[CP Notification] ${n.event} for ${a.application_ref}: recipient address is not a plain e-mail address; not sent`);
    return { ...n, status: 'FAILED', last_error: 'Recipient address is not a valid plain e-mail address', updated_at: now };
  }
  const settings = smtpSettings();
  if (!settings) return { ...n, status: 'NOT_CONFIGURED', last_error: 'E-mail (SMTP) is not configured on the server', updated_at: now };
  const { subject, text } = buildCpEmail(n, a, partner, projectName);
  try {
    // Explicit envelope: the SMTP recipient is exactly the validated address, never re-parsed from a header
    await getTransporter(settings).sendMail({
      from: settings.from, to: n.recipient, subject, text,
      envelope: { from: smtpEnvelopeFrom(settings), to: [n.recipient] }
    });
    console.log(`[CP Notification] ${n.event} for ${a.application_ref}: accepted by mail server`);
    return { ...n, status: 'SENT', attempts: n.attempts + 1, last_error: undefined, sent_at: now, updated_at: now };
  } catch (err: any) {
    // The mail server's answer, with any e-mail address in it masked (it may echo the recipient)
    const reason = (String(err?.code || err?.responseCode || 'error') + (err?.response ? `: ${String(err.response).slice(0, 200)}` : ''))
      .replace(/[^\s<>()"']+@[^\s<>()"']+/g, '<address>');
    console.error(`[CP Notification] ${n.event} for ${a.application_ref}: failed (${reason})`);
    return { ...n, status: 'FAILED', attempts: n.attempts + 1, last_error: `Sending failed (${reason})`, updated_at: now };
  }
}
