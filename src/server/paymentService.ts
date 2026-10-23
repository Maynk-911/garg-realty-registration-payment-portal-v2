import crypto from 'crypto';
import { db } from './db.js';
import type { Store } from './store.js';
import { crmService } from './crmService.js';
import { emailService } from './emailService.js';
import { googleSheetsService } from './googleSheetsService.js';
import { Registration, PaymentRecord, PaymentStatus, WebhookEvent } from '../types.js';

export interface CreateOrderParams {
  /** Run inside this transaction (e.g. together with creating the booking). Defaults to its own transaction. */
  store?: Store;
  registrationId: string;
  amount: number; // in INR
  currency?: string;
  notes?: Record<string, string>;
}

export interface VerifyPaymentParams {
  registrationId: string;
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
  paymentMethod?: string;
}

export class PaymentService {
  private keyId: string;
  private keySecret: string;
  private webhookSecret: string;
  private env: string;
  private isLiveCredentialsConfigured: boolean;

  constructor() {
    this.keyId = process.env.RAZORPAY_KEY_ID || '';
    this.keySecret = process.env.RAZORPAY_KEY_SECRET || '';
    this.webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || 'rzp_webhook_secret_default';
    this.env = (process.env.PAYMENT_ENV || 'test').toLowerCase();
    
    this.isLiveCredentialsConfigured = Boolean(
      this.keyId && 
      !this.keyId.includes('your_') && 
      this.keySecret && 
      !this.keySecret.includes('your_')
    );
  }

  /**
   * Simulated (unverified) gateway confirmations are OFF unless explicitly enabled for local testing.
   * Without this, a booking can only become PAID through a real gateway signature or accounts-desk verification.
   */
  private get allowSimulatedPayments(): boolean {
    return process.env.ALLOW_SIMULATED_PAYMENTS === 'true' && process.env.NODE_ENV !== 'production';
  }

  public getPublicConfig() {
    return {
      keyId: this.keyId || 'rzp_test_placeholder',
      env: this.env,
      isLiveCredentialsConfigured: this.isLiveCredentialsConfigured,
      currency: 'INR'
    };
  }

  /**
   * Creates an order with Razorpay or internal test simulator
   */
  public async createOrder(params: CreateOrderParams): Promise<{
    orderId: string;
    amount: number;
    currency: string;
    keyId: string;
    paymentRecordId: string;
    isSimulator: boolean;
  }> {
    const { registrationId, amount } = params;
    const store: Store = params.store || db;
    const registration = await store.getRegistration(registrationId);
    if (!registration) {
      throw new Error(`Registration with ID ${registrationId} not found`);
    }

    const currency = params.currency || 'INR';
    const amountInPaise = Math.round(amount * 100);

    const existingPayments = await store.getPaymentsForRegistration(registrationId);
    const attemptNumber = existingPayments.length + 1;

    let gatewayOrderId = '';
    let isSimulator = true;

    if (this.isLiveCredentialsConfigured) {
      try {
        const auth = Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64');
        const resp = await fetch('https://api.razorpay.com/v1/orders', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Basic ${auth}`
          },
          body: JSON.stringify({
            amount: amountInPaise,
            currency,
            receipt: registration.registration_number,
            notes: {
              registration_id: registration.id,
              registration_number: registration.registration_number,
              project_id: registration.project_id,
              applicant: registration.full_name,
              attempt: String(attemptNumber)
            }
          })
        });

        if (!resp.ok) {
          const errData = await resp.text();
          console.warn('[Razorpay API Warning] Direct API returned error, falling back to secure test order:', errData);
          gatewayOrderId = `order_sim_${crypto.randomUUID().replace(/-/g, '').slice(0, 14)}`;
        } else {
          const orderData = await resp.json();
          gatewayOrderId = orderData.id;
          isSimulator = false;
        }
      } catch (e: any) {
        console.warn('[Razorpay API Exception] Fallback to secure test order:', e.message);
        gatewayOrderId = `order_sim_${crypto.randomUUID().replace(/-/g, '').slice(0, 14)}`;
      }
    } else {
      // Test sandbox order
      gatewayOrderId = `order_test_${crypto.randomUUID().replace(/-/g, '').slice(0, 14)}`;
    }

    const paymentId = `pay_rec_${crypto.randomUUID().slice(0, 10)}`;
    const paymentRecord: PaymentRecord = {
      id: paymentId,
      registration_id: registration.id,
      registration_number: registration.registration_number,
      gateway: isSimulator ? 'SIMULATED' : 'RAZORPAY',
      gateway_order_id: gatewayOrderId,
      amount,
      currency,
      payment_status: 'INITIATED',
      signature_verified: false,
      webhook_verified: false,
      attempt_number: attemptNumber,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    // Payment record and booking status are saved together
    await store.transaction(async tx => {
      await tx.savePayment(paymentRecord);
      // Update registration payment status strictly to PENDING
      registration.payment_status = 'PENDING';
      registration.updated_at = new Date().toISOString();
      await tx.saveRegistration(registration);
    });

    return {
      orderId: gatewayOrderId,
      amount,
      currency,
      keyId: this.keyId || 'rzp_test_public_key',
      paymentRecordId: paymentId,
      isSimulator
    };
  }

  /**
   * Verifies client-side signature returned by Razorpay Checkout
   */
  public async verifyClientSignature(params: VerifyPaymentParams): Promise<{ success: boolean; message: string; payment?: PaymentRecord }> {
    const { registrationId, razorpayOrderId, razorpayPaymentId, razorpaySignature, paymentMethod } = params;

    const registration = await db.getRegistration(registrationId);
    if (!registration) {
      return { success: false, message: 'Registration not found' };
    }

    const payment = await db.getPaymentByOrderId(razorpayOrderId);
    if (!payment) {
      return { success: false, message: 'Payment record for this order was not found' };
    }

    let isValid = false;

    if (this.isLiveCredentialsConfigured) {
      const generatedSignature = crypto
        .createHmac('sha256', this.keySecret)
        .update(`${razorpayOrderId}|${razorpayPaymentId}`)
        .digest('hex');

      isValid = (generatedSignature === razorpaySignature);
    } else if (this.allowSimulatedPayments) {
      // Local test/sandbox mode only: accept simulated signature verification
      isValid = Boolean(razorpaySignature && razorpayPaymentId);
    } else {
      // No gateway is configured, so nothing can be verified here. Leave the booking untouched.
      return { success: false, message: 'Online gateway verification is not available. Payments are verified by the accounts team.' };
    }

    if (!isValid) {
      payment.payment_status = 'FAILED';
      payment.error_code = 'BAD_SIGNATURE';
      payment.error_description = 'Signature verification mismatch';
      payment.updated_at = new Date().toISOString();
      registration.payment_status = 'FAILED';
      registration.updated_at = new Date().toISOString();
      await db.transaction(async tx => {
        await tx.savePayment(payment);
        await tx.saveRegistration(registration);
      });

      return { success: false, message: 'Payment signature could not be verified' };
    }

    // Success
    const now = new Date().toISOString();
    payment.payment_status = 'PAID';
    payment.gateway_payment_id = razorpayPaymentId;
    payment.payment_method = paymentMethod || 'Online Gateway';
    payment.signature_verified = true;
    payment.verified_at = now;
    payment.updated_at = now;
    registration.payment_status = 'PAID';
    registration.registration_status = 'CONFIRMED';
    registration.total_payment_received = payment.amount;
    registration.mode_of_payment = payment.payment_method;
    registration.updated_at = now;
    // Payment, booking and audit entry are saved together
    await db.transaction(async tx => {
      await tx.savePayment(payment);
      await tx.saveRegistration(registration);
      await tx.logAudit({
        admin_id: 'SYSTEM_GATEWAY',
        action: 'PAYMENT_VERIFIED',
        entity_type: 'PAYMENT',
        entity_id: payment.id,
        old_value: { status: 'INITIATED' },
        new_value: { status: 'PAID', paymentId: razorpayPaymentId }
      });
    });
    googleSheetsService.syncRegistration(registration).catch(err => {
      console.warn('Google Sheets sync warning (verify):', err.message);
    });

    // Notify Admin and Client
    emailService.notifyAdminPaymentSuccess(registration, payment).catch(console.error);
    emailService.sendClientBookingConfirmation(registration, payment).catch(console.error);
    crmService.updateLead(registration, payment).catch(console.error);

    return { success: true, message: 'Payment verified and confirmed successfully', payment };
  }

  /**
   * Processes official Razorpay Webhooks with HMAC SHA-256 signature verification & Idempotency
   */
  public async handleWebhook(
    rawBody: string | Buffer,
    signature: string,
    trustedAdminSimulation: boolean = false
  ): Promise<{ status: number; message: string; eventId?: string }> {
    const payloadStr = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf-8');
    let parsed: any;
    try {
      parsed = JSON.parse(payloadStr);
    } catch (e) {
      return { status: 400, message: 'Invalid JSON payload' };
    }

    const eventId = parsed.event_id || parsed.id || `evt_${crypto.randomUUID().slice(0, 10)}`;
    const eventType = parsed.event || 'unknown';

    // Check Idempotency: Has this webhook event already been processed?
    const existingEvent = await db.getWebhookEvent(eventId);
    if (existingEvent && existingEvent.processed) {
      console.log(`[Webhook Idempotency] Skipping duplicate webhook event ${eventId} (${eventType})`);
      return { status: 200, message: 'Event already processed (idempotent)', eventId };
    }

    // Verify Webhook Signature
    let signatureVerified = false;
    if (this.webhookSecret && this.webhookSecret !== 'rzp_webhook_secret_default') {
      const expectedSignature = crypto
        .createHmac('sha256', this.webhookSecret)
        .update(payloadStr)
        .digest('hex');

      signatureVerified = (expectedSignature === signature);
    } else {
      // No real webhook secret: only an authenticated admin simulation or explicit local test mode is accepted
      signatureVerified = Boolean(signature) && (trustedAdminSimulation || this.allowSimulatedPayments);
    }

    const webhookEvent: WebhookEvent = {
      id: eventId,
      event_id: eventId,
      event_type: eventType,
      gateway: 'RAZORPAY',
      payload: parsed,
      signature_verified: signatureVerified,
      processed: false,
      created_at: new Date().toISOString()
    };

    if (!signatureVerified) {
      webhookEvent.error = 'Invalid signature';
      await db.saveWebhookEvent(webhookEvent);
      console.warn(`[Webhook Security] Rejected webhook ${eventId}: Signature mismatch`);
      return { status: 401, message: 'Invalid webhook signature' };
    }

    try {
      // Handle events: payment.captured, order.paid, payment.failed
      if (eventType === 'payment.captured' || eventType === 'order.paid') {
        const paymentEntity = parsed.payload?.payment?.entity || parsed.payload?.payment;
        const orderId = paymentEntity?.order_id || parsed.payload?.order?.entity?.id;
        const paymentId = paymentEntity?.id;
        const amountPaise = paymentEntity?.amount;
        const method = paymentEntity?.method;

        if (orderId) {
          const paymentRecord = await db.getPaymentByOrderId(orderId);
          if (paymentRecord) {
            const now = new Date().toISOString();
            paymentRecord.payment_status = 'PAID';
            paymentRecord.gateway_payment_id = paymentId || paymentRecord.gateway_payment_id;
            paymentRecord.payment_method = method || paymentRecord.payment_method || 'Razorpay Gateway';
            paymentRecord.webhook_verified = true;
            paymentRecord.verified_at = now;
            paymentRecord.updated_at = now;
            // Payment, booking and audit entry are saved together
            const confirmed = await db.transaction(async tx => {
              await tx.savePayment(paymentRecord);
              const registration = await tx.getRegistrationForUpdate(paymentRecord.registration_id);
              if (!registration || registration.payment_status === 'PAID') return null;
              registration.payment_status = 'PAID';
              registration.registration_status = 'CONFIRMED';
              registration.total_payment_received = paymentRecord.amount;
              registration.updated_at = now;
              await tx.saveRegistration(registration);
              await tx.logAudit({
                admin_id: 'WEBHOOK_SERVICE',
                action: 'PAYMENT_CAPTURED_VIA_WEBHOOK',
                entity_type: 'PAYMENT',
                entity_id: paymentRecord.id,
                old_value: { status: 'INITIATED' },
                new_value: { status: 'PAID', eventId }
              });
              return registration;
            });
            if (confirmed) {
              googleSheetsService.syncRegistration(confirmed).catch(err => {
                console.warn('Google Sheets sync warning (webhook):', err.message);
              });
              emailService.notifyAdminPaymentSuccess(confirmed, paymentRecord).catch(console.error);
              emailService.sendClientBookingConfirmation(confirmed, paymentRecord).catch(console.error);
              crmService.updateLead(confirmed, paymentRecord).catch(console.error);
            }
          }
        }
      } else if (eventType === 'payment.failed') {
        const paymentEntity = parsed.payload?.payment?.entity || parsed.payload?.payment;
        const orderId = paymentEntity?.order_id;
        if (orderId) {
          const paymentRecord = await db.getPaymentByOrderId(orderId);
          if (paymentRecord) {
            paymentRecord.payment_status = 'FAILED';
            paymentRecord.error_code = paymentEntity?.error_code || 'GATEWAY_DECLINE';
            paymentRecord.error_description = paymentEntity?.error_description || 'Payment was declined by bank or user';
            paymentRecord.updated_at = new Date().toISOString();
            const failedReg = await db.transaction(async tx => {
              await tx.savePayment(paymentRecord);
              const registration = await tx.getRegistrationForUpdate(paymentRecord.registration_id);
              if (!registration || registration.payment_status === 'PAID') return null;
              registration.payment_status = 'FAILED';
              registration.updated_at = new Date().toISOString();
              await tx.saveRegistration(registration);
              return registration;
            });
            if (failedReg) {
              googleSheetsService.syncRegistration(failedReg).catch(err => {
                console.warn('Google Sheets sync warning (failed):', err.message);
              });
            }
          }
        }
      }

      webhookEvent.processed = true;
      webhookEvent.processed_at = new Date().toISOString();
      await db.saveWebhookEvent(webhookEvent);

      return { status: 200, message: 'Webhook processed successfully', eventId };
    } catch (err: any) {
      webhookEvent.error = err.message;
      await db.saveWebhookEvent(webhookEvent);
      console.error('[Webhook Processing Error]', err);
      return { status: 500, message: `Processing error: ${err.message}` };
    }
  }

  /**
   * Helper to simulate a test webhook for testing idempotency and verification
   */
  public async simulateWebhookEvent(eventType: 'payment.captured' | 'payment.failed', orderId: string, trustedAdminSimulation: boolean = false) {
    const payment = await db.getPaymentByOrderId(orderId);
    if (!payment) {
      throw new Error(`Order ${orderId} not found`);
    }

    const eventId = `sim_evt_${crypto.randomUUID().slice(0, 10)}`;
    const payload = {
      id: eventId,
      entity: 'event',
      event: eventType,
      payload: {
        payment: {
          entity: {
            id: `pay_sim_${crypto.randomUUID().slice(0, 12)}`,
            order_id: orderId,
            amount: payment.amount * 100,
            currency: payment.currency,
            status: eventType === 'payment.captured' ? 'captured' : 'failed',
            method: 'upi',
            error_code: eventType === 'payment.failed' ? 'BAD_REQUEST_ERROR' : undefined,
            error_description: eventType === 'payment.failed' ? 'Payment failed in test simulator' : undefined
          }
        }
      }
    };

    const raw = JSON.stringify(payload);
    const signature = crypto.createHmac('sha256', this.webhookSecret).update(raw).digest('hex');

    return this.handleWebhook(raw, signature, trustedAdminSimulation);
  }
}

export const paymentService = new PaymentService();
