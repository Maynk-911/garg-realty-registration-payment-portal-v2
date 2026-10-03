import { Registration, PaymentRecord } from '../types.js';

export interface CRMLeadPayload {
  externalId: string;
  leadSource: string;
  contact: {
    fullName: string;
    phone: string;
    whatsapp?: string;
    email: string;
    city: string;
    state: string;
    pincode: string;
    address: string;
  };
  coApplicant?: {
    name?: string;
    phone?: string;
    email?: string;
  };
  propertyDetails: {
    projectId: string;
    projectName: string;
    unitNumber?: string;
    unitSize?: string;
    floorNo?: string;
    totalPrice: number;
    expectedROI: number;
  };
  payment: {
    tokenAmount: number;
    paymentStatus: string;
    paymentId?: string;
    orderId?: string;
  };
  marketing: {
    source?: string;
    campaign?: string;
    utmSource?: string;
    utmMedium?: string;
    utmCampaign?: string;
    utmTerm?: string;
    utmContent?: string;
  };
  consent: boolean;
  consentTimestamp: string;
  submittedAt: string;
}

export class CRMService {
  private apiUrl: string;
  private apiKey: string;
  private isConfigured: boolean;

  constructor() {
    this.apiUrl = process.env.CRM_API_URL || '';
    this.apiKey = process.env.CRM_API_KEY || '';
    this.isConfigured = Boolean(this.apiUrl && !this.apiUrl.includes('example.com') && this.apiKey && this.apiKey !== 'crm_api_key_placeholder');
  }

  public async createLead(registration: Registration): Promise<{ success: boolean; leadId?: string; message: string }> {
    const payload: CRMLeadPayload = {
      externalId: registration.registration_number,
      leadSource: registration.utm_source || registration.source || 'Website Booking Portal',
      contact: {
        fullName: registration.full_name,
        phone: registration.mobile,
        whatsapp: registration.whatsapp || registration.mobile,
        email: registration.email,
        city: registration.city,
        state: registration.state,
        pincode: registration.pincode,
        address: registration.address
      },
      coApplicant: registration.co_applicant_name ? {
        name: registration.co_applicant_name,
        phone: registration.co_applicant_mobile,
        email: registration.co_applicant_email
      } : undefined,
      propertyDetails: {
        projectId: registration.project_id,
        projectName: registration.project_name,
        unitNumber: registration.unit_number,
        unitSize: registration.unit_size,
        floorNo: registration.floor_no,
        totalPrice: registration.total_price,
        expectedROI: registration.roi_percentage
      },
      payment: {
        tokenAmount: registration.token_amount,
        paymentStatus: registration.payment_status
      },
      marketing: {
        source: registration.source,
        campaign: registration.campaign,
        utmSource: registration.utm_source,
        utmMedium: registration.utm_medium,
        utmCampaign: registration.utm_campaign,
        utmTerm: registration.utm_term,
        utmContent: registration.utm_content
      },
      consent: registration.consent,
      consentTimestamp: registration.consent_timestamp,
      submittedAt: registration.created_at
    };

    if (!this.isConfigured) {
      console.log(`[CRM Service] Simulated lead sync for ${registration.registration_number} (${registration.full_name}) -> Ready for live CRM API`);
      return {
        success: true,
        leadId: `lead_${registration.registration_number.toLowerCase().replace(/-/g, '_')}`,
        message: 'CRM integration active in adapter mode (Set CRM_API_URL and CRM_API_KEY to sync to live CRM)'
      };
    }

    try {
      const response = await fetch(`${this.apiUrl}/leads`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
          'X-Client-Source': 'GargRealtyPortal'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`CRM API HTTP ${response.status}: ${await response.text()}`);
      }

      const resData = await response.json();
      return { success: true, leadId: resData.id || resData.leadId, message: 'Lead synchronized with CRM successfully' };
    } catch (err: any) {
      console.error('[CRM Service] Error pushing lead to CRM:', err.message);
      return { success: false, message: err.message };
    }
  }

  public async updateLead(registration: Registration, payment: PaymentRecord): Promise<{ success: boolean; message: string }> {
    if (!this.isConfigured) {
      console.log(`[CRM Service] Simulated lead update for ${registration.registration_number}: Status -> ${payment.payment_status}, Payment -> ${payment.id}`);
      return { success: true, message: 'CRM lead updated in adapter mode' };
    }

    try {
      const response = await fetch(`${this.apiUrl}/leads/${registration.registration_number}/payment`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          registrationNumber: registration.registration_number,
          paymentStatus: payment.payment_status,
          gatewayPaymentId: payment.gateway_payment_id,
          amountPaid: payment.amount,
          verifiedAt: payment.verified_at
        })
      });

      if (!response.ok) {
        throw new Error(`CRM update failed HTTP ${response.status}`);
      }

      return { success: true, message: 'CRM lead updated successfully' };
    } catch (err: any) {
      console.error('[CRM Service] Error updating CRM lead:', err.message);
      return { success: false, message: err.message };
    }
  }

  public async addPayment(payment: PaymentRecord): Promise<{ success: boolean; message: string }> {
    console.log(`[CRM Service] addPayment logged: ${payment.id} for registration ${payment.registration_number}`);
    return { success: true, message: 'Payment recorded in CRM service adapter' };
  }
}

export const crmService = new CRMService();
