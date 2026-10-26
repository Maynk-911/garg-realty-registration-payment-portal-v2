/**
 * "Track CP Application" API tests against a running server on a TEST database.
 *   npm run test:cp-track
 *
 * Start the server with CP_TRACK_LOOKUPS_PER_15MIN=60 and CP_TRACK_CERTIFICATE_TRIES_PER_15MIN=25 (and pass the same
 * values to this test) so the scenarios fit inside the limits and the limits themselves can be checked at the end.
 * All records created here use "CP Test" names and @example.com e-mails (removable with npm run db:cleanup-test).
 */
import '../src/server/loadEnv.js';
import crypto from 'crypto';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';
const LOOKUP_LIMIT = Number(process.env.CP_TRACK_LOOKUPS_PER_15MIN || 60);
const CERT_LIMIT = Number(process.env.CP_TRACK_CERTIFICATE_TRIES_PER_15MIN || 25);

let passed = 0, failed = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`[PASS] ${name}`); }
  else { failed++; console.log(`[FAIL] ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 400)}` : ''}`); }
};
const api = async (method: string, url: string, body?: unknown, token?: string) => {
  const res = await fetch(`${BASE_URL}${url}`, {
    method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text };
};

const RUN = crypto.randomBytes(3).toString('hex');
let seq = 0, lookupsUsed = 0, certTriesUsed = 0;
const track = (ref: string) => { lookupsUsed++; return api('GET', `/api/cp/track/${encodeURIComponent(ref)}`); };
const certificate = (reference: string) => { certTriesUsed++; return api('GET', `/api/cp/track/${encodeURIComponent(reference)}/certificate`); };

async function apply(extra: Record<string, unknown> = {}) {
  seq++;
  const mobile = `9${String(crypto.randomInt(0, 1e9)).padStart(9, '0')}`;
  const body = {
    full_name: 'CP Test Tracker Sharma', mobile, email: `cp.test.track.${RUN}.${seq}@example.com`,
    partner_type: 'BROKERAGE_FIRM', company_name: `CP Test Tracker Realty ${RUN}`, years_experience: '4', state: 'Gujarat',
    city: 'Ahmedabad', pincode: '380001', address: 'CP Test Address, Ashram Road, Ahmedabad', pan_number: 'ABCPE1234K',
    project_ids: ['proj_pangot', 'proj_dholera'], declarations: { accurate: true, contact: true, terms: true },
    declaration_version: 'cp-v2026.1', client_submission_id: crypto.randomUUID(), ...extra
  };
  const r = await api('POST', '/api/cp/applications', body);
  if (r.status !== 201) throw new Error(`could not create test application: ${r.status} ${r.text}`);
  return { ref: r.json.application.reference as string, mobile };
}
// Nothing personal or internal may appear in a public status response
const SENSITIVE = (x: { mobile: string }) => ['ABCPE1234K', x.mobile, '@example.com', 'Ashram Road', 'Ahmedabad', 'Sharma', 'cpa_', 'cpp_', '"email"', '"mobile"', '"pan', '"address"', '"ip_address"', '"id"'];

async function main() {
  const page = await fetch(`${BASE_URL}/track-cp-application`);
  check('1. /track-cp-application page is served without signing in', page.status === 200);

  const login = await api('POST', '/api/admin/login', { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD });
  const admin: string = login.json?.token;
  const idOf = async (ref: string) => (await api('GET', `/api/admin/cp/applications?search=${ref}`, undefined, admin)).json.applications[0].id as string;
  const act = (id: string, action: string, reason?: string) => api('POST', `/api/admin/cp/applications/${id}/action`, { action, reason }, admin);

  // ---------- invalid / unknown references ----------
  const invalid = await Promise.all(['hello', 'CP-GRG-123', 'GRG-PNG-20261024-0101', "CP-GRG-20261024-0001' OR 1=1", '../../etc/passwd', 'CP-GRG-20261024-0001-K7O2', 'CP-GRG-20261024-0001-K7Q', 'CP-GRG-20261024-0001-K7Q2X'].map(track));
  check('2. Invalid reference formats are rejected by the server (400)', invalid.every(r => r.status === 400), invalid.map(r => r.status));
  const unknown = await track('CP-GRG-20990101-0001');
  check('3. A valid-looking but unknown reference returns a generic "not found" (404)', unknown.status === 404 && /No application was found/.test(unknown.json?.error || ''), unknown.json);

  // ---------- pending ----------
  const P = await apply();
  const p = await track(P.ref.toLowerCase());
  const pa = p.json?.application;
  check('4. Valid reference (any letter case): Pending Review with next steps', p.status === 200 && pa?.reference === P.ref && pa?.status === 'PENDING' && pa?.status_label === 'Pending Review' && pa?.next_steps?.length >= 2, pa);
  check('4b. Applicant name is masked; projects and dates shown', pa?.applicant === 'C** T*** T****** S*****' && pa?.projects_of_interest?.length === 2 && /^\d{4}-\d{2}-\d{2}$/.test(pa?.submitted_on || ''), pa?.applicant);
  check('4c. No CP ID and no certificate while pending', pa?.cp_id === null && pa?.certificate_available === false);
  check('5. Public status contains no PAN, mobile, e-mail, address, full name, company or internal ids', SENSITIVE(P).every(s => !p.text.includes(s)) && !p.text.includes('Tracker Realty'), SENSITIVE(P).filter(s => p.text.includes(s)));
  const certPending = await certificate(P.ref);
  check('6. No certificate for a pending application (409)', certPending.status === 409 && !certPending.text.includes('Sharma'));
  const certInvalid = await certificate('CP-GRG-123');
  const certUnknown = await certificate('CP-GRG-20990101-0004-K7Q2');
  const certUnknownLegacy = await certificate('CP-GRG-20990101-0004');
  check('6b. Certificate: invalid reference 400, unknown new-format reference 404, any older-format reference 403 (no lookup, reveals nothing)',
    certInvalid.status === 400 && certUnknown.status === 404 && certUnknownLegacy.status === 403 && certUnknownLegacy.json?.code === 'LEGACY_REFERENCE', [certInvalid.status, certUnknown.status, certUnknownLegacy.status]);
  // An older sequence number made only of 2-9 looks like a random part on its own; it must still count as older
  const certLookalike = await certificate('CP-GRG-20990101-2345');
  check('6c. An older reference whose number looks like a random part (…-2345) is still refused as older (403)',
    certLookalike.status === 403 && certLookalike.json?.code === 'LEGACY_REFERENCE', certLookalike.status);

  // ---------- under review / additional information ----------
  // ---------- reference privacy: random part ----------
  check('5b. New references end in a 4-character random part', /^CP-GRG-\d{8}-\d{4,}-[2-9A-HJKMNP-Z]{4}$/.test(P.ref), P.ref);
  const withoutSuffix = P.ref.replace(/-[2-9A-HJKMNP-Z]{4}$/, '');
  const otherSuffix = withoutSuffix + '-' + (P.ref.endsWith('-2222') ? '3333' : '2222');
  const guessA = await track(withoutSuffix), guessB = await track(otherSuffix);
  const guessC = await certificate(withoutSuffix);
  check('5c. The sequence number alone, or with a wrong random part, finds nothing (status 404; certificate refused 403)',
    guessA.status === 404 && guessB.status === 404 && guessC.status === 403 && !guessC.text.includes('Sharma'), [guessA.status, guessB.status, guessC.status]);
  const suffixes = new Set(await Promise.all([1, 2, 3].map(async () => (await apply()).ref.slice(-4))));
  check('5d. Random parts differ between applications', suffixes.size >= 2, [...suffixes]);

  const pId = await idOf(P.ref);
  await act(pId, 'UNDER_REVIEW');
  check('7. Under Review is shown', (await track(P.ref)).json?.application?.status_label === 'Under Review');
  await act(pId, 'REQUEST_INFO', 'INTERNAL-NOTE-123: please send your RERA certificate');
  const info = await track(P.ref);
  check('8. Additional Information Required is shown with generic next steps; the admin\'s message is NOT shown',
    info.json?.application?.status_label === 'Additional Info Required' && !info.text.includes('INTERNAL-NOTE-123') && info.json?.application?.next_steps?.some((s: string) => /e-mail/.test(s)), info.json?.application);

  // ---------- approved ----------
  const A = await apply();
  const aId = await idOf(A.ref);
  const approval = await act(aId, 'APPROVE', 'INTERNAL-APPROVAL-NOTE');
  const cpId = approval.json?.partner?.cp_id;
  const ap = await track(A.ref);
  const aa = ap.json?.application;
  check('9. Approved: CP ID, approved projects, approval date and certificate availability are shown',
    aa?.status === 'APPROVED' && aa?.cp_id === cpId && aa?.approved_projects?.length === 2 && /^\d{4}-\d{2}-\d{2}$/.test(aa?.approved_on || '') && aa?.certificate_available === true && aa?.certificate_from_partner_team === false, aa);
  check('9b. Approved status still hides personal data and the approval note', SENSITIVE(A).every(s => !ap.text.includes(s)) && !ap.text.includes('INTERNAL-APPROVAL-NOTE'));

  // ---------- certificate ----------
  const certs = await Promise.all([A.ref, A.ref.toLowerCase()].map(r => certificate(r)));
  const c = certs[0].json?.certificate;
  check('10. Approved: the certificate is issued with the reference number alone (any letter case)', certs.every(r => r.status === 200) && c?.cp_id === cpId && c?.full_name === 'CP Test Tracker Sharma' && c?.company_name === `CP Test Tracker Realty ${RUN}` && c?.approved_projects?.length === 2, certs.map(r => r.status));
  check('11. Certificate holds only certificate facts (name, company, CP ID, projects, dates, numbers)',
    JSON.stringify(Object.keys(c || {}).sort()) === JSON.stringify(['application_ref', 'approved_at', 'approved_projects', 'certificate_number', 'company_name', 'cp_id', 'full_name', 'issued_at', 'verification_code']), Object.keys(c || {}));
  check('11b. Certificate has a certificate number and a stable 16-character verification code', c?.certificate_number === `CERT-${cpId}` && /^[0-9A-F]{16}$/.test(c?.verification_code || '') && certs.every(r => r.json?.certificate?.verification_code === c?.verification_code));
  check('11c. Certificate contains no PAN, mobile, e-mail, address or internal ids', ['ABCPE1234K', A.mobile, '@example.com', 'Ashram Road', 'cpa_', 'cpp_'].every(s => !certs[0].text.includes(s)));
  const audit = (await api('GET', `/api/admin/cp/applications/${aId}`, undefined, admin)).json?.activity?.map((x: any) => x.action) || [];
  check('12. Certificate downloads are recorded in the admin audit trail', audit.includes('CP_CERTIFICATE_VIEWED'), audit);

  // ---------- rejected ----------
  const R = await apply();
  await act(await idOf(R.ref), 'REJECT', 'INTERNAL-REJECTION-REASON-XYZ');
  const rj = await track(R.ref);
  check('13. Rejected: status and generic next steps shown; the rejection reason (admin text) is NOT shown',
    rj.json?.application?.status === 'REJECTED' && rj.json?.application?.status_label === 'Rejected' && !rj.text.includes('INTERNAL-REJECTION-REASON-XYZ') && rj.json?.application?.cp_id === null, rj.json?.application);
  check('13b. No certificate for a rejected application (409)', (await certificate(R.ref)).status === 409);

  // ---------- suspended ----------
  const S = await apply();
  const sId = await idOf(S.ref);
  await act(sId, 'APPROVE');
  await act(sId, 'SUSPEND', 'INTERNAL-SUSPENSION-NOTE-ABC');
  const su = await track(S.ref);
  check('14. Suspended: status shown, the suspension note is NOT shown, certificate not available',
    su.json?.application?.status === 'SUSPENDED' && su.json?.application?.status_label === 'Suspended' && !su.text.includes('INTERNAL-SUSPENSION-NOTE-ABC') && su.json?.application?.certificate_available === false, su.json?.application);
  check('14b. No certificate for a suspended partner (409)', (await certificate(S.ref)).status === 409);
  await act(sId, 'REACTIVATE');
  check('14c. After reactivation the certificate is available again', (await certificate(S.ref)).status === 200);

  // ---------- certificate issued by the partner team (admin) ----------
  const adminCert = (id: string, token?: string) => api('GET', `/api/admin/cp/applications/${id}/certificate`, undefined, token);
  const anonAdminCert = await adminCert(aId);
  const okAdminCert = await adminCert(aId, admin);
  check('14d. Admin certificate route requires sign-in (401) and issues the same certificate for an approved partner',
    anonAdminCert.status === 401 && okAdminCert.status === 200 && okAdminCert.json?.certificate?.cp_id === cpId && okAdminCert.json?.certificate?.verification_code === c?.verification_code, [anonAdminCert.status, okAdminCert.status]);
  await act(sId, 'SUSPEND', 'INTERNAL-SUSPENSION-NOTE-2');
  const adminStatuses = [await adminCert(pId, admin), await adminCert(await idOf(R.ref), admin), await adminCert(sId, admin)].map(r => r.status);
  check('14e. Admin cannot issue certificates for pending, rejected or suspended applications either (409)', adminStatuses.every(s => s === 409), adminStatuses);
  const aAudit = (await api('GET', `/api/admin/cp/applications/${aId}`, undefined, admin)).json?.activity?.map((x: any) => x.action) || [];
  check('14f. Certificates issued by the partner team are recorded in the audit trail', aAudit.includes('CP_CERTIFICATE_ISSUED_BY_ADMIN'));

  // ---------- older references without the random part ----------
  if (/_test$/.test(process.env.DB_NAME || '') && process.env.DB_HOST === '127.0.0.1') {
    // Rename one TEST record to the old format, in the local TEST database only
    const Old = await apply();
    const oldCpId = (await act(await idOf(Old.ref), 'APPROVE')).json?.partner?.cp_id;
    const mysql = (await import('mysql2/promise')).default;
    const conn = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
    // Digits 2-9 only: the hardest case, as the number alone looks like a random part
    const legacyRef = `CP-GRG-20200101-${Array.from({ length: 4 }, () => crypto.randomInt(2, 10)).join('')}`;
    const [upd]: any = await conn.query("UPDATE cp_applications SET application_ref = ? WHERE application_ref = ? AND email LIKE '%@example.com'", [legacyRef, Old.ref]);
    await conn.query('UPDATE cp_partners SET application_ref = ? WHERE application_ref = ?', [legacyRef, Old.ref]);
    await conn.end();
    const legacy = await track(legacyRef);
    const la = legacy.json?.application;
    check('15c. An approved older reference still tracks: status and CP ID shown, but no download and a "contact the partner team" next step',
      upd.affectedRows === 1 && legacy.status === 200 && la?.status === 'APPROVED' && la?.cp_id === oldCpId && la?.certificate_available === false &&
      la?.certificate_from_partner_team === true && la?.next_steps?.some((s: string) => /contact our partner team/.test(s)), [upd.affectedRows, legacy.status, la]);
    check('15d. Older-reference tracking shows no full name, company or other personal data',
      la?.applicant === 'C** T*** T****** S*****' && !legacy.text.includes('CP Test Tracker Sharma') && !legacy.text.includes('Tracker Realty') && SENSITIVE(Old).every(s => !legacy.text.includes(s)));
    const legacyCerts = await Promise.all([legacyRef, legacyRef.toLowerCase()].map(r => certificate(r)));
    check('15e. An older reference alone can NOT retrieve the certificate (403, clear message, no personal data)',
      legacyCerts.every(r => r.status === 403 && r.json?.code === 'LEGACY_REFERENCE' && /contact our partner team/.test(r.json?.error || '') && !r.text.includes('Sharma') && !r.text.includes('Tracker Realty') && !r.text.includes(oldCpId)), legacyCerts.map(r => r.status));
    const teamCert = await adminCert(await idOf(legacyRef), admin);
    check('15f. The partner team can still issue that partner\'s certificate from the admin panel', teamCert.status === 200 && teamCert.json?.certificate?.cp_id === oldCpId && teamCert.json?.certificate?.application_ref === legacyRef);
  } else {
    console.log('[SKIP] 15c. Older-reference check needs the local test database (DB_HOST=127.0.0.1, DB_NAME=*_test)');
  }

  // ---------- read-only ----------
  const writes = await Promise.all(['POST', 'PUT', 'PATCH', 'DELETE'].map(m => api(m, `/api/cp/track/${A.ref}`, { status: 'APPROVED', cp_id: 'GRG-CP-9999' })));
  const after = await track(A.ref);
  check('15. Tracking is read-only: write requests do nothing and the record is unchanged', writes.every(r => r.status === 404) && after.json?.application?.cp_id === cpId && after.json?.application?.status === 'APPROVED', writes.map(r => r.status));
  const forgedCert = await api('GET', `/api/cp/track/${P.ref}/certificate?status=APPROVED&cp_id=GRG-CP-9999`);
  const certWrites = await Promise.all(['POST', 'PUT', 'PATCH', 'DELETE'].map(m => api(m, `/api/cp/track/${A.ref}/certificate`, { cp_id: 'GRG-CP-9999' })));
  certTriesUsed++;
  check('15b. A certificate cannot be obtained by claiming a status, and the certificate cannot be written to',
    forgedCert.status === 409 && certWrites.every(r => r.status === 404), [forgedCert.status, certWrites.map(r => r.status)]);

  // ---------- per-connection limits ----------
  const certStatuses: number[] = [];
  while (certTriesUsed <= CERT_LIMIT) certStatuses.push((await certificate('CP-GRG-20990101-0002')).status);
  check(`17. More than ${CERT_LIMIT} certificate attempts per 15 minutes from one connection are refused (429)`, certStatuses[certStatuses.length - 1] === 429, certStatuses.slice(-2));
  const lookupStatuses: number[] = [];
  while (lookupsUsed <= LOOKUP_LIMIT) lookupStatuses.push((await track('CP-GRG-20990101-0003')).status);
  check(`18. More than ${LOOKUP_LIMIT} status lookups per 15 minutes from one connection are refused (429)`, lookupStatuses[lookupStatuses.length - 1] === 429, lookupStatuses.slice(-2));

  // ---------- existing features ----------
  const projects = await api('GET', '/api/projects');
  const booking = await api('GET', '/api/registration/GRG-PNG-20990101-0001');
  check('19. Existing project list and Track Booking lookup still answer', projects.status === 200 && booking.status === 404);

  console.log(`\nCP tracking test run complete: ${passed} Passed, ${failed} Failed.`);
  process.exitCode = failed ? 1 : 0;
}

main().catch(err => { console.error('Test run aborted:', err); process.exitCode = 1; });
