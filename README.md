# Garg Realty Group - Client Registration & Payment Gateway Portal

> **Subdomain Target:** `apply.yourdomain.com`  
> **Corporate Entity:** Garg Residency Private Limited  
> **Brand Motto:** *Driven by Trust, Defined by Excellence*  
> **Visual Reference:** Pangot Booking - Booking & Plot Details Form (PDF Replica & Digital Workflow)

---

## 1. System Architecture

```text
                                CLIENT
                                  │
                                  ▼
                     ┌─────────────────────────┐
                     │     PUBLIC SUBDOMAIN    │
                     │  apply.yourdomain.com   │
                     └────────────┬────────────┘
                                  │
                                  ▼
                     ┌─────────────────────────┐
                     │ 4-Step Registration UI  │
                     │ + Form Review & Consent │
                     └────────────┬────────────┘
                                  │ POST /api/registration/submit
                                  ▼
                     ┌─────────────────────────┐
                     │    EXPRESS REST API     │
                     │ (Server-Side Pricing)   │
                     └────────────┬────────────┘
                                  │
        ┌─────────────────────────┼─────────────────────────┐
        ▼                         ▼                         ▼
┌───────────────┐         ┌───────────────┐         ┌───────────────┐
│   Database    │         │ Razorpay API  │         │  CRM Adapter  │
│ (Firestore /  │         │ (Order Create │         │ (Lead Sync &  │
│ Persistent DB)│         │ & Webhooks)   │         │ Notifications)│
└───────────────┘         └───────┬───────┘         └───────────────┘
                                  │
                                  ▼
                         ┌─────────────────┐
                         │ Payment Webhook │
                         │ (HMAC-SHA256)   │
                         └────────┬────────┘
                                  │
                                  ▼
                     ┌─────────────────────────┐
                     │  Verify Signature &     │
                     │  Mutate Status to PAID  │
                     │  Dispatch Booking Form  │
                     └─────────────────────────┘
```

---

## 2. Directory Structure

```text
├── .env.example               # Environment variables specification
├── firestore.rules            # Firestore security rules (role-based access)
├── index.html                 # HTML shell with OpenGraph tags & Razorpay SDK
├── metadata.json              # Studio applet configuration
├── package.json               # Dependencies and scripts (dev, build, start)
├── server.ts                  # Full-stack Express server + Vite dev middleware
├── src/
│   ├── App.tsx                # Main view router & checkout orchestrator
│   ├── types.ts               # Shared TypeScript schemas (Registration, Payment, etc.)
│   ├── index.css              # Tailwind CSS styling with print utilities
│   ├── components/
│   │   ├── BrandLogo.tsx      # Garg Realty Group crest logo component
│   │   ├── Navbar.tsx         # Responsive header with WhatsApp & tracking links
│   │   ├── Footer.tsx         # Legal footer with 15-day refund policy & office info
│   │   ├── BookingFormReceipt.tsx # 1:1 visual replica of reference PDF form
│   │   └── PaymentModal.tsx   # Razorpay checkout & test sandbox simulator
│   ├── pages/
│   │   ├── LandingPage.tsx    # Hero section, trust badges, project catalogue
│   │   ├── RegistrationFlow.tsx # 4-step wizard with validation & review
│   │   ├── PaymentStatusPage.tsx # Payment verification, retry, and PDF receipt
│   │   ├── TrackBookingPage.tsx  # Booking reference lookup & receipt retrieval
│   │   ├── AdminDashboard.tsx # Comprehensive admin control centre & metrics
│   │   └── PolicyPages.tsx    # Terms, Privacy Policy, and 15-Day Refund Policy
│   └── server/
│       ├── db.ts              # Persistent database layer (Firestore + JSON store)
│       ├── paymentService.ts  # Razorpay integration, HMAC signatures, webhooks
│       ├── crmService.ts      # CRM sync adapter for leads & payments
│       └── emailService.ts    # Admin alert & client booking confirmation service
└── tests/
    └── flow_test.ts           # Automated test suite
```

---

## 3. Database Schema

### `registrations`
- `id`: Unique identifier (e.g. `reg_329f8a...`)
- `registration_number`: Unique human-readable reference (e.g. `GRG-2026-000101`)
- **Section 1: Personal Info**: `full_name`, `mobile`, `whatsapp`, `email`, `date_of_birth`, `gender`, `co_applicant_name`, `co_applicant_mobile`, `co_applicant_email`, `co_applicant_address`
- **Section 2: Location**: `country`, `state`, `city`, `pincode`, `address`
- **Section 3: Unit & Requirement**: `company_name`, `profession`, `requirement`, `project_id`, `project_name`, `unit_number`, `unit_size`, `floor_no`, `total_price`, `roi_percentage`
- **Section 4: Payment Terms**: `token_amount`, `tax_amount`, `total_payable`, `mode_of_payment`, `total_payment_received`
- **Section 5: Documents**: `documents_submitted` (`id_proof`, `address_proof`, `photo`)
- **Section 6 & 7: Consent**: `consent`, `consent_timestamp`, `declaration_signed`, `signature_name`, `ip_address`, `user_agent`
- **Statuses**: `payment_status` (`INITIATED`, `PENDING`, `PAYMENT_PROCESSING`, `PAID`, `FAILED`, `CANCELLED`), `registration_status` (`SUBMITTED`, `CONFIRMED`, `IN_REVIEW`, `CANCELLED`)
- **Attribution**: `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`, `gclid`, `fbclid`

### `payments`
- `id`: Payment ID (e.g. `pay_rec_xxx`)
- `registration_id`: Foreign key to `registrations`
- `registration_number`: `GRG-2026-XXXXXX`
- `gateway`: `'RAZORPAY'` | `'SIMULATED'`
- `gateway_order_id`: Razorpay `order_xxx`
- `gateway_payment_id`: Razorpay `pay_xxx`
- `amount`, `currency`: Total amount in INR
- `payment_status`: Current transaction status
- `payment_method`: UPI, Card, NetBanking
- `signature_verified`: Boolean
- `webhook_verified`: Boolean
- `attempt_number`: Sequential attempt counter (supports retries)

### `projects`
- `id`, `name`, `tagline`, `description`, `location`, `token_amount`, `total_price`, `tax_percentage`, `roi_percentage`, `unit_types`, `active`

### `webhook_events`
- `id`, `event_id`, `event_type`, `gateway`, `payload`, `signature_verified`, `processed`, `processed_at`, `created_at` (ensures idempotency against duplicate deliveries)

---

## 4. API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/config` | Public branding, subdomain name, gateway config |
| `GET` | `/api/projects` | Active projects, token amounts & unit options |
| `POST` | `/api/registration/submit` | Validates client input, determines server-side pricing, generates `GRG-2026-XXXXXX`, creates Razorpay order |
| `POST` | `/api/payment/verify` | Cryptographically verifies Razorpay signature upon checkout return |
| `POST` | `/api/payment/webhook` | Handles Razorpay webhook events with HMAC-SHA256 signature verification |
| `GET` | `/api/registration/:id` | Fetches registration status and payment attempts (public status page) |
| `POST` | `/api/payment/retry` | Generates a new gateway order for existing failed registration without duplicates |
| `POST` | `/api/admin/login` | Authenticates admin credentials, issues signed token |
| `GET` | `/api/admin/overview` | Retrieves KPIs, revenue stats, and project breakdowns |
| `GET` | `/api/admin/registrations` | Search, filter by status/project, and paginate registrations |
| `GET` | `/api/admin/registration/:id` | Full registration dossier, payments, and audit log |
| `PATCH` | `/api/admin/registration/:id/status` | Updates booking/payment status with audit trail |
| `POST` | `/api/admin/webhook/simulate` | Developer console to test webhook delivery and idempotency |
| `GET` | `/api/admin/export-csv` | Exports filtered registrations to CSV file |

---

## 5. Subdomain Deployment: `apply.yourdomain.com`

### Step 1: DNS Setup
Log in to your DNS provider (Cloudflare, GoDaddy, Namecheap, AWS Route 53, etc.) for `yourdomain.com`:

1. Add a **CNAME Record**:
   - **Type**: `CNAME`
   - **Name / Host**: `apply`
   - **Target / Value**: Point to your hosting host (e.g. `your-app.cloudrun.app` or server IP)
   - **TTL**: Auto or 300 seconds

*(Alternatively, if hosting on a VPS or Dedicated IP, add an `A Record`: Host: `apply`, Value: `<Server_IPv4>`)*

### Step 2: Configure Environment Variables
Set production environment variables on your server:
```env
PAYMENT_ENV="production"
RAZORPAY_KEY_ID="rzp_live_YourKey"
RAZORPAY_KEY_SECRET="YourLiveKeySecret"
RAZORPAY_WEBHOOK_SECRET="YourWebhookSecret"
APP_SUBDOMAIN="apply.yourdomain.com"
COMPANY_NAME="Garg Realty Group"
COMPANY_LEGAL_ENTITY="Garg Residency Private Limited"
ADMIN_EMAIL="admin@gargrealty.com"
```

### Step 3: Configure Razorpay Webhook
In your [Razorpay Dashboard](https://dashboard.razorpay.com/):
1. Navigate to **Settings → Webhooks → Add New Webhook**.
2. Enter Webhook URL: `https://apply.yourdomain.com/api/payment/webhook`
3. Enter Secret: Same value as `RAZORPAY_WEBHOOK_SECRET`.
4. Select Active Events:
   - `payment.captured`
   - `payment.failed`
   - `order.paid`
5. Save Webhook.

### Step 4: Run Production Build
```bash
npm run build
npm start
```
The app runs on port 3000 behind Nginx/Caddy/Cloudflare SSL reverse proxy.

---

## 6. Admin Credentials (Default Master Access)

- **URL**: Navigate to `/admin` or click "Admin" in header
- **Email**: `admin@gargrealty.com`
- **Password**: `AdminPassword@2026`
- **Role**: `SUPER_ADMIN`
