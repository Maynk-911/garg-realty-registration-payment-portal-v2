import { Registration, PaymentRecord } from '../types.js';
import { db } from './db.js';

export class EmailNotificationService {
  private adminEmail: string;
  private emailKey: string;
  private whatsappKey: string;

  constructor() {
    this.adminEmail = process.env.ADMIN_EMAIL || 'admin@gargrealty.com';
    this.emailKey = process.env.EMAIL_SERVICE_KEY || '';
    this.whatsappKey = process.env.WHATSAPP_API_KEY || '';
  }

  public async notifyAdminNewRegistration(registration: Registration): Promise<void> {
    const subject = `📋 [New Booking Initiated] ${registration.project_name} - ${registration.full_name} (${registration.registration_number})`;
    const textBody = `
New Registration Received:
------------------------------------------
Registration No: ${registration.registration_number}
Applicant:       ${registration.full_name}
Mobile:          ${registration.mobile}
WhatsApp:        ${registration.whatsapp || registration.mobile}
Email:           ${registration.email}
Project:         ${registration.project_name}
Unit Number:     ${registration.unit_number || 'N/A'}
Token Payable:   ₹${registration.token_amount.toLocaleString('en-IN')}
Status:          ${registration.payment_status}
Submitted At:    ${registration.created_at}
------------------------------------------
Review at: /admin
`;
    console.log(`[Notification to Admin (${this.adminEmail})]`, subject);
    console.log(textBody);
  }

  public async notifyAdminPaymentSuccess(registration: Registration, payment: PaymentRecord): Promise<void> {
    const alertMessage = `
🎉 NEW PAID REGISTRATION
==========================================
Registration: ${registration.registration_number}
Name:         ${registration.full_name}
Mobile:       ${registration.mobile}
Email:        ${registration.email}

Project:      ${registration.project_name}
Unit:         ${registration.unit_number || 'Allotted on verification'}
Amount Paid:  ₹${payment.amount.toLocaleString('en-IN')}
Payment ID:   ${payment.gateway_payment_id || 'N/A'}
Gateway:      ${payment.gateway}
Status:       ${payment.payment_status}
Verified At:  ${payment.verified_at}
==========================================
`;
    console.log(`[ALERT -> ADMIN]`, alertMessage);

    // If live WhatsApp Gateway configured:
    if (this.whatsappKey && this.whatsappKey !== 'whatsapp_api_key_placeholder') {
      console.log(`[WhatsApp Gateway] Dispatching WhatsApp alert to Admin for ${registration.registration_number}`);
    }
  }

  public async sendClientBookingConfirmation(registration: Registration, payment: PaymentRecord): Promise<void> {
    // Each booking carries its own project's refund terms
    const refundPolicy = (await db.getProject(registration.project_id).catch(() => null))?.refund_policy;
    const refundLine = refundPolicy ? `- ${refundPolicy}\n` : '';
    const message = `
==============================================================
GARG REALTY GROUP | Garg Residency Private Limited
BOOKING CONFIRMATION & PAYMENT RECEIPT
==============================================================
Dear ${registration.full_name},

Thank you for choosing Garg Realty Group. Your booking request and token payment have been successfully verified and registered.

Booking Summary:
--------------------------------------------------------------
Registration Number:    ${registration.registration_number}
Project:                ${registration.project_name}
Unit Allotment:         ${registration.unit_number || 'Assigned in Allotment Letter'}
Unit Size:              ${registration.unit_size || 'As per project layout'}
Token Amount Paid:      ₹${payment.amount.toLocaleString('en-IN')}
Payment Status:         PAID (${payment.payment_status})
Transaction ID:         ${payment.gateway_payment_id || 'N/A'}
Date:                   ${payment.verified_at || new Date().toLocaleString('en-IN')}

Terms Reminder:
${refundLine}- Full payment schedule will be shared by our Relationship Executive.

You can view your official digital booking form and receipt at:
/payment-status/${registration.id}

Thanks & Regards,
Garg Residency Private Limited / Garg Realty Group
Driven by Trust, Defined by Excellence.
==============================================================
`;
    console.log(`[Email / SMS to Client (${registration.email}, ${registration.mobile})]`, message);
  }
}

export const emailService = new EmailNotificationService();
