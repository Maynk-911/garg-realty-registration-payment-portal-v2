import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Project, Registration, PaymentRecord, WebhookEvent, AuditLog, AdminUser } from '../types.js';

interface DatabaseSchema {
  projects: Record<string, Project>;
  registrations: Record<string, Registration>;
  payments: Record<string, PaymentRecord>;
  webhook_events: Record<string, WebhookEvent>;
  audit_logs: Record<string, AuditLog>;
  admin_users: Record<string, AdminUser & { passwordHash: string }>;
  counters: {
    registration_seq: number;
  };
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const INITIAL_PROJECTS: Project[] = [
  {
    id: 'proj_pangot',
    name: 'Pangot Luxury Plots & Cottages',
    tagline: 'Pangot Booking - Booking & Plot Details Form',
    description: 'Scenic high-altitude hill plots in Pangot (Nainital region) with pristine Himalayan views, high ROI rental yield, and legal clear title.',
    location: 'Pangot, Nainital, Uttarakhand',
    token_amount: 50000,
    total_price: 2500000,
    currency: 'INR',
    tax_percentage: 0, // Advance token booking has no GST surcharge or 0% tax configurable
    roi_percentage: 14.5,
    unit_types: ['₹7 L - Co-Own', '₹18 L - Co-Own', 'Studio - Full Own', 'Villa - Full Own'],
    sample_units: [],
    ownership_plans: [
      { id: 'plan_7l_co_own', name: '₹7 L - Co-Own', label: '₹7 L - Co-Own', type: 'CO_OWN', token_amount: 50000, total_price: 700000 },
      { id: 'plan_18l_co_own', name: '₹18 L - Co-Own', label: '₹18 L - Co-Own', type: 'CO_OWN', token_amount: 50000, total_price: 1800000 },
      { id: 'plan_studio_full_own', name: 'Studio - Full Own', label: 'Studio - Full Own', type: 'FULL_OWN', token_amount: 50000, total_price: 2500000 },
      { id: 'plan_villa_full_own', name: 'Villa - Full Own', label: 'Villa - Full Own', type: 'FULL_OWN', token_amount: 50000, total_price: 5000000 }
    ],
    active: true,
    features: [
      '15-day 100% money back guarantee on token',
      'Immediate allotment certificate',
      'High appreciation potential (14.5% targeted ROI)',
      'Freehold registry and mutation'
    ],
    created_at: new Date('2026-01-01T00:00:00Z').toISOString(),
    updated_at: new Date('2026-01-01T00:00:00Z').toISOString()
  },
  {
    id: 'proj_dholera',
    name: 'Dholera SIR Greenfield Plots',
    tagline: 'Smart City Industrial & Commercial Corridor',
    description: 'Strategically located plotting project within the DMIC corridor with world-class trunk infrastructure and express metro connectivity.',
    location: 'Activation Zone, Dholera SIR, Gujarat',
    token_amount: 25000,
    total_price: 1500000,
    currency: 'INR',
    tax_percentage: 0,
    roi_percentage: 18.0,
    unit_types: ['150 Sq. Yds Residential', '300 Sq. Yds Commercial', '1000 Sq. Yds Industrial'],
    sample_units: ['DH-A04', 'DH-B12', 'DH-C23', 'DH-D09'],
    active: true,
    features: ['Near upcoming International Airport', 'Clear title', 'Plug-and-play utilities'],
    created_at: new Date('2026-01-01T00:00:00Z').toISOString(),
    updated_at: new Date('2026-01-01T00:00:00Z').toISOString()
  },
  {
    id: 'proj_sukkoon',
    name: 'Sukkoon Nature Living Estates',
    tagline: 'Holistic Eco Farmhouses & Orchard Land',
    description: 'Expansive organic farm plots surrounded by dense reserved forest greens, private water bodies, and club amenities.',
    location: 'Dehradun Foothills, Uttarakhand',
    token_amount: 50000,
    total_price: 3500000,
    currency: 'INR',
    tax_percentage: 0,
    roi_percentage: 12.0,
    unit_types: ['1000 Sq. Yds Farmlet', '2000 Sq. Yds Estate'],
    sample_units: ['SK-01', 'SK-05', 'SK-12'],
    active: true,
    features: ['Solar ready', 'Gated community with 24/7 security', 'Farm management services'],
    created_at: new Date('2026-01-01T00:00:00Z').toISOString(),
    updated_at: new Date('2026-01-01T00:00:00Z').toISOString()
  },
  {
    id: 'proj_orchid',
    name: 'Orchid Garden Suites',
    tagline: 'Golf Course Extension Luxury Living',
    description: 'Ultra-luxury residential suites overlooking pristine golf greens with concierge services and world-class clubhouse.',
    location: 'Golf Course Ext. Road, Gurugram',
    token_amount: 100000,
    total_price: 7500000,
    currency: 'INR',
    tax_percentage: 0,
    roi_percentage: 11.5,
    unit_types: ['2 BHK + Study (1450 Sq. Ft)', '3 BHK Luxury (2100 Sq. Ft)'],
    sample_units: ['OG-802', 'OG-1104', 'OG-1501'],
    active: true,
    features: ['Italian marble flooring', 'Smart home automation', 'Private elevator access'],
    created_at: new Date('2026-01-01T00:00:00Z').toISOString(),
    updated_at: new Date('2026-01-01T00:00:00Z').toISOString()
  }
];

class Database {
  private data: DatabaseSchema;
  private saveTimeout: NodeJS.Timeout | null = null;

  constructor() {
    this.data = this.loadData();
  }

  private loadData(): DatabaseSchema {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }

      if (fs.existsSync(DB_FILE)) {
        const raw = fs.readFileSync(DB_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        return parsed;
      }
    } catch (err) {
      console.warn('Failed reading db.json, initializing fresh store:', err);
    }

    const initial: DatabaseSchema = {
      projects: {},
      registrations: {},
      payments: {},
      webhook_events: {},
      audit_logs: {},
      admin_users: {
        'admin_1': {
          id: 'admin_1',
          email: 'admin@gargrealty.com',
          name: 'Principal Executive',
          role: 'SUPER_ADMIN',
          passwordHash: crypto.createHash('sha256').update('AdminPassword@2026').digest('hex')
        }
      },
      counters: {
        registration_seq: 100
      }
    };

    INITIAL_PROJECTS.forEach(p => {
      initial.projects[p.id] = p;
    });

    this.persistSync(initial);
    return initial;
  }

  private persistSync(state: DatabaseSchema) {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      const tmp = `${DB_FILE}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf-8');
      fs.renameSync(tmp, DB_FILE);
    } catch (e) {
      console.error('Error persisting database:', e);
    }
  }

  public save() {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }
    this.saveTimeout = setTimeout(() => {
      this.persistSync(this.data);
      this.saveTimeout = null;
    }, 50);
  }

  // --- Registration Operations ---
  public generateRegistrationNumber(): string {
    this.data.counters.registration_seq += 1;
    const seq = String(this.data.counters.registration_seq).padStart(6, '0');
    const year = new Date().getFullYear();
    this.save();
    return `GRG-PNG-${year}-${seq}`;
  }

  public getRegistration(id: string): Registration | null {
    return this.data.registrations[id] || null;
  }

  public getRegistrationByNumber(regNum: string): Registration | null {
    const list = Object.values(this.data.registrations);
    return list.find(r => r.registration_number === regNum) || null;
  }

  public findRegistrationByEmailOrPhone(email: string, mobile: string): Registration | null {
    const list = Object.values(this.data.registrations);
    return list.find(r => 
      (r.email.toLowerCase() === email.toLowerCase() || r.mobile === mobile) &&
      (r.payment_status === 'INITIATED' || r.payment_status === 'PENDING')
    ) || null;
  }

  public saveRegistration(reg: Registration): Registration {
    this.data.registrations[reg.id] = reg;
    this.save();
    return reg;
  }

  public listRegistrations(filter?: {
    search?: string;
    projectId?: string;
    paymentStatus?: string;
    registrationStatus?: string;
    startDate?: string;
    endDate?: string;
  }): Registration[] {
    let list = Object.values(this.data.registrations);

    if (filter?.search) {
      const q = filter.search.toLowerCase();
      list = list.filter(r => 
        r.registration_number.toLowerCase().includes(q) ||
        r.full_name.toLowerCase().includes(q) ||
        r.email.toLowerCase().includes(q) ||
        r.mobile.includes(q) ||
        (r.unit_number && r.unit_number.toLowerCase().includes(q))
      );
    }

    if (filter?.projectId && filter.projectId !== 'all') {
      list = list.filter(r => r.project_id === filter.projectId);
    }

    if (filter?.paymentStatus && filter.paymentStatus !== 'all') {
      list = list.filter(r => r.payment_status === filter.paymentStatus);
    }

    if (filter?.registrationStatus && filter.registrationStatus !== 'all') {
      list = list.filter(r => r.registration_status === filter.registrationStatus);
    }

    if (filter?.startDate) {
      list = list.filter(r => new Date(r.created_at) >= new Date(filter.startDate!));
    }
    if (filter?.endDate) {
      list = list.filter(r => new Date(r.created_at) <= new Date(filter.endDate!));
    }

    // Sort descending by created_at
    return list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }

  // --- Payment Operations ---
  public getPayment(id: string): PaymentRecord | null {
    return this.data.payments[id] || null;
  }

  public getPaymentByOrderId(orderId: string): PaymentRecord | null {
    const list = Object.values(this.data.payments);
    return list.find(p => p.gateway_order_id === orderId) || null;
  }

  public getPaymentsForRegistration(registrationId: string): PaymentRecord[] {
    const list = Object.values(this.data.payments);
    return list
      .filter(p => p.registration_id === registrationId)
      .sort((a, b) => a.attempt_number - b.attempt_number);
  }

  public savePayment(payment: PaymentRecord): PaymentRecord {
    this.data.payments[payment.id] = payment;
    this.save();
    return payment;
  }

  // --- Project Operations ---
  public getProject(id: string): Project | null {
    return this.data.projects[id] || null;
  }

  public listProjects(onlyActive: boolean = true): Project[] {
    const list = Object.values(this.data.projects);
    // Project is strictly locked to Pangot
    return list.filter(p => p.id === 'proj_pangot');
  }

  public saveProject(project: Project): Project {
    this.data.projects[project.id] = project;
    this.save();
    return project;
  }

  // --- Webhook Events (Idempotency) ---
  public getWebhookEvent(eventId: string): WebhookEvent | null {
    return this.data.webhook_events[eventId] || null;
  }

  public saveWebhookEvent(event: WebhookEvent): WebhookEvent {
    this.data.webhook_events[event.id] = event;
    this.save();
    return event;
  }

  public listWebhookEvents(limit: number = 20): WebhookEvent[] {
    return Object.values(this.data.webhook_events)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, limit);
  }

  // --- Audit Logs ---
  public logAudit(log: Omit<AuditLog, 'id' | 'timestamp'>): AuditLog {
    const entry: AuditLog = {
      ...log,
      id: `audit_${crypto.randomUUID().slice(0, 8)}`,
      timestamp: new Date().toISOString()
    };
    this.data.audit_logs[entry.id] = entry;
    this.save();
    return entry;
  }

  public listAuditLogs(limit: number = 50): AuditLog[] {
    return Object.values(this.data.audit_logs)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, limit);
  }

  // --- Admin Users ---
  public getAdminByEmail(email: string) {
    const list = Object.values(this.data.admin_users);
    return list.find(a => a.email.toLowerCase() === email.toLowerCase()) || null;
  }
}

export const db = new Database();
