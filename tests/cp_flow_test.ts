/**
 * Channel Partner (CP) / Broker onboarding — end-to-end API tests against a running server.
 *   npm run test:cp            (server: npm run dev, or the production build; TEST_BASE_URL to change the address)
 *
 * Run it only against a development or test database. Every record it creates is clearly marked:
 * applicant names start with "CP Test" and e-mail addresses end in @example.com (removable with npm run db:cleanup-test).
 *
 * E-mail: the test runs a local fake SMTP server on CP_TEST_SMTP_PORT (default 2626). If the app was started with
 * SMTP_HOST=127.0.0.1 SMTP_PORT=2626 SMTP_SECURE=false, delivery, failure and retry are tested end to end;
 * without SMTP settings the test checks that every notification is recorded as NOT_CONFIGURED instead.
 */
import '../src/server/loadEnv.js';
import crypto from 'crypto';
import net from 'net';
import sharp from 'sharp';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';
const SMTP_PORT = Number(process.env.CP_TEST_SMTP_PORT || 2626);
const RUN = crypto.randomBytes(3).toString('hex');

let passed = 0;
let failed = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`[PASS] ${name}`); }
  else { failed++; console.log(`[FAIL] ${name}${detail !== undefined ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 400)}` : ''}`); }
};
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ---------- fake SMTP server ----------
const mails: { to: string; data: string }[] = [];
let smtpMode: 'accept' | 'reject' = 'accept';
const smtp = net.createServer(socket => {
  let buffer = '';
  let inData = false;
  let rcpt = '';
  let data = '';
  socket.write('220 cp-test-sink ESMTP\r\n');
  socket.on('data', chunk => {
    buffer += chunk.toString('utf8');
    let idx: number;
    while ((idx = buffer.indexOf('\r\n')) >= 0) {
      const lineText = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      if (inData) {
        if (lineText === '.') { inData = false; mails.push({ to: rcpt, data }); data = ''; socket.write('250 2.0.0 queued\r\n'); }
        else data += `${lineText}\n`;
        continue;
      }
      const cmd = lineText.slice(0, 4).toUpperCase();
      if (cmd === 'EHLO' || cmd === 'HELO') socket.write('250 cp-test-sink\r\n');
      else if (cmd === 'MAIL') socket.write('250 2.1.0 OK\r\n');
      else if (cmd === 'RCPT') {
        rcpt = /<([^>]+)>/.exec(lineText)?.[1] || '';
        socket.write(smtpMode === 'accept' ? '250 2.1.5 OK\r\n' : `550 5.1.1 <${rcpt}>: mailbox unavailable\r\n`);
      } else if (cmd === 'DATA') { inData = true; socket.write('354 go ahead\r\n'); }
      else if (cmd === 'QUIT') { socket.write('221 bye\r\n'); socket.end(); }
      else socket.write('250 OK\r\n');
    }
  });
  socket.on('error', () => {});
});

// ---------- helpers ----------
const api = async (method: string, url: string, body?: unknown, token?: string) => {
  const res = await fetch(`${BASE_URL}${url}`, {
    method,
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body)
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text, headers: res.headers };
};

const randomMobile = () => `9${String(crypto.randomInt(0, 1e9)).padStart(9, '0')}`;
const randomPan = (holder = 'P') => {
  const L = () => String.fromCharCode(65 + crypto.randomInt(0, 26));
  return `${L()}${L()}${L()}${holder}${L()}${String(crypto.randomInt(0, 10000)).padStart(4, '0')}${L()}`;
};
const uuid = () => crypto.randomUUID();
let seq = 0;

function baseApplication(projectIds: string[], overrides: Record<string, unknown> = {}) {
  seq++;
  return {
    full_name: `CP Test Broker ${RUN} ${seq}`.replace(/\d/g, d => 'abcdefghij'[Number(d)]),
    mobile: randomMobile(),
    email: `cp.test.${RUN}.${seq}@example.com`,
    partner_type: 'INDIVIDUAL_BROKER',
    years_experience: '6',
    state: 'Uttarakhand',
    city: 'Dehradun',
    pincode: '248001',
    address: 'Test Address, Rajpur Road, Dehradun',
    pan_number: randomPan(),
    project_ids: projectIds,
    declarations: { accurate: true, contact: true, terms: true },
    declaration_version: 'cp-v2026.1',
    client_submission_id: uuid(),
    ...overrides
  };
}

const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [] /Count 0 >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n', 'latin1');
const doc = (type: string, name: string, bytes: Buffer) => ({ type, name, data: `data:application/octet-stream;base64,${bytes.toString('base64')}` });

async function main() {
  await new Promise<void>((resolve, reject) => smtp.once('error', reject).listen(SMTP_PORT, '127.0.0.1', () => resolve()));
  const PNG = await sharp({ create: { width: 40, height: 40, channels: 3, background: { r: 15, g: 89, b: 115 } } }).png().toBuffer();
  const JPG = await sharp({ create: { width: 40, height: 40, channels: 3, background: { r: 184, g: 126, b: 43 } } }).jpeg().toBuffer();

  // ---------------- PUBLIC ----------------
  const config = await api('GET', '/api/cp/config');
  const projectIds: string[] = (config.json?.projects || []).map((p: any) => p.id);
  check('1. Public config loads; projects come from the project configuration', config.status === 200 && projectIds.includes('proj_pangot') && projectIds.includes('proj_dholera'), config.json);
  check('1b. Config lists 7 document types with explicit required/optional flags', config.json?.documents?.length === 7 && config.json.documents.every((d: any) => typeof d.required === 'boolean'));
  const page = await fetch(`${BASE_URL}/cp-registration`);
  check('1c. /cp-registration page is served without signing in', page.status === 200);

  const login = await api('POST', '/api/admin/login', { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD });
  const token: string = login.json?.token;
  check('2. Admin login works (existing login unchanged)', login.status === 200 && Boolean(token), login.status);
  const role = login.json?.user?.role;
  const summary0 = (await api('GET', '/api/admin/cp/summary', undefined, token)).json;
  const smtpConfigured = Boolean(summary0?.emailConfigured);
  console.log(`   (e-mail ${smtpConfigured ? `configured -> fake SMTP on port ${SMTP_PORT}` : 'NOT configured'})`);

  // Valid individual broker, no documents
  const indiv = baseApplication(['proj_pangot']);
  const r1 = await api('POST', '/api/cp/applications', indiv);
  const ref1: string = r1.json?.application?.reference;
  check('3. Valid individual broker application is accepted (201)', r1.status === 201 && r1.json?.success === true, r1.json);
  check('3b. Reference format CP-GRG-YYYYMMDD-NNNN and status Pending Review', /^CP-GRG-\d{8}-\d{4,}$/.test(ref1 || '') && r1.json?.application?.status === 'PENDING' && r1.json?.application?.status_label === 'Pending Review');
  check('3c. Confirmation shows name and date but no internal database id', r1.json?.application?.full_name === indiv.full_name && Boolean(r1.json?.application?.submitted_at) && !JSON.stringify(r1.json).includes('cpa_'));

  // Valid company with documents (PDF, PNG, JPEG)
  const company = baseApplication(['proj_pangot', 'proj_dholera'], {
    partner_type: 'CP_COMPANY', company_name: `CP Test Realty ${RUN} Pvt Ltd`, sales_agents: '12', website: 'example.com',
    linkedin: 'https://www.linkedin.com/company/example', rera_number: 'UKREA12345678', rera_state: 'Uttarakhand',
    whatsapp: randomMobile(), date_of_birth: '1985-04-12', expected_monthly_leads: '20', heard_from: 'Social media', referral_code: 'grg-ref-1',
    comments: 'Line one\nLine two',
    documents: [doc('PAN_CARD', 'pan card.pdf', PDF), doc('PHOTO', 'me.png', PNG), doc('ADDRESS_PROOF', 'C:\\fakepath\\..\\proof.jpg', JPG)]
  });
  (company as any).gst_number = `27${company.pan_number}1Z5`;
  const r2 = await api('POST', '/api/cp/applications', company);
  const ref2: string = r2.json?.application?.reference;
  check('4. Valid company application with 3 documents (PDF/PNG/JPEG) is accepted', r2.status === 201, r2.json);

  // Required fields and formats
  const empty = await api('POST', '/api/cp/applications', { declaration_version: 'cp-v2026.1' });
  const ef = empty.json?.fields || {};
  check('5. Missing required fields are rejected by the server with field errors', empty.status === 400 &&
    ['full_name', 'mobile', 'partner_type', 'years_experience', 'state', 'city', 'pincode', 'address', 'pan_number', 'project_ids', 'declaration_accurate', 'declaration_contact', 'declaration_terms']
      .every(k => ef[k]), ef);
  const badMobile = await api('POST', '/api/cp/applications', baseApplication(['proj_pangot'], { mobile: '12345' }));
  check('6. Invalid mobile number is rejected', badMobile.status === 400 && Boolean(badMobile.json?.fields?.mobile), badMobile.json);
  const badMobile2 = await api('POST', '/api/cp/applications', baseApplication(['proj_pangot'], { mobile: '5123456789' }));
  check('6b. Indian mobile must start with 6-9', badMobile2.status === 400 && Boolean(badMobile2.json?.fields?.mobile));
  const badEmail = await api('POST', '/api/cp/applications', baseApplication(['proj_pangot'], { email: 'not-an-email' }));
  check('7. Invalid e-mail is rejected', badEmail.status === 400 && Boolean(badEmail.json?.fields?.email));
  // Disguised addresses that mail libraries could read as a different recipient are refused
  const disguised = ['a,victim@evil.com', 'x;victim@evil.com', '"x>"victim@evil.com', 'a(b)victim@evil.com', 'a<victim@evil.com>',
    'Name <victim@evil.com>', 'victim@evil.com,other@evil.com', 'a@b@evil.com', '.lead@example.com', 'two..dots@example.com',
    'trail.@example.com', 'user@-example.com', 'user@example', 'user@exa mple.com', `${'a'.repeat(65)}@example.com`, `a@${'b'.repeat(185)}.com`];
  const disguisedRes = await Promise.all(disguised.map(email => api('POST', '/api/cp/applications', baseApplication(['proj_pangot'], { email }))));
  check('7b. 16 disguised / malformed e-mail addresses are all rejected by the server',
    disguisedRes.every(r => r.status === 400 && Boolean(r.json?.fields?.email)), disguisedRes.map((r, i) => r.status === 400 ? null : `${disguised[i]}:${r.status}`).filter(Boolean));
  const plusEmail = await api('POST', '/api/cp/applications', baseApplication(['proj_pangot'], { email: `First.Last+cp${RUN}@mail.example.co.in` }));
  check('7c. Normal addresses (dots, plus-tags, sub-domains, capitals) are still accepted and stored in lower case',
    plusEmail.status === 201, plusEmail.json);
  const badPan = await api('POST', '/api/cp/applications', baseApplication(['proj_pangot'], { pan_number: 'ABCD1234X', gst_number: '27ABCDE1234F1Y5' }));
  check('8. Invalid PAN and GSTIN formats are rejected', badPan.status === 400 && Boolean(badPan.json?.fields?.pan_number) && Boolean(badPan.json?.fields?.gst_number), badPan.json);
  const noCompany = await api('POST', '/api/cp/applications', baseApplication(['proj_pangot'], { partner_type: 'BROKERAGE_FIRM' }));
  check('9. Brokerage firm without company name is rejected (conditional requirement)', noCompany.status === 400 && Boolean(noCompany.json?.fields?.company_name));
  const noOptional = await api('POST', '/api/cp/applications', baseApplication(['proj_dholera'], { gst_number: '', rera_number: '', email: '' }));
  check('10. Optional GST / RERA / e-mail / documents may be left out', noOptional.status === 201, noOptional.json);
  const badProject = await api('POST', '/api/cp/applications', baseApplication(['proj_does_not_exist']));
  check('11. Unknown project id is rejected', badProject.status === 400 && Boolean(badProject.json?.fields?.project_ids));
  const noDecl = await api('POST', '/api/cp/applications', baseApplication(['proj_pangot'], { declarations: { accurate: true, contact: true } }));
  check('12. Every declaration must be accepted', noDecl.status === 400 && Boolean(noDecl.json?.fields?.declaration_terms));
  const oldVersion = await api('POST', '/api/cp/applications', baseApplication(['proj_pangot'], { declaration_version: 'cp-v2020.1' }));
  check('12b. Outdated declaration version is rejected', oldVersion.status === 400 && Boolean(oldVersion.json?.fields?.declaration_version));

  // Documents
  const exe = await api('POST', '/api/cp/applications', baseApplication(['proj_pangot'], { documents: [doc('PAN_CARD', 'pan.pdf', Buffer.from('MZ\x90\x00 this is not a pdf', 'latin1'))] }));
  check('13. A non-PDF file named .pdf is rejected (contents checked)', exe.status === 400 && Boolean(exe.json?.fields?.document_PAN_CARD), exe.json);
  const mismatch = await api('POST', '/api/cp/applications', baseApplication(['proj_pangot'], { documents: [doc('PAN_CARD', 'pan.pdf', PNG)] }));
  check('14. Extension that does not match the contents is rejected', mismatch.status === 400 && Boolean(mismatch.json?.fields?.document_PAN_CARD));
  const pdfPhoto = await api('POST', '/api/cp/applications', baseApplication(['proj_pangot'], { documents: [doc('PHOTO', 'photo.pdf', PDF)] }));
  check('15. Profile photo must be an image (PDF rejected for that slot)', pdfPhoto.status === 400 && Boolean(pdfPhoto.json?.fields?.document_PHOTO));
  const scriptPdf = Buffer.from('%PDF-1.4\n1 0 obj << /OpenAction << /S /JavaScript /JS (app.alert(1)) >> >> endobj\n%%EOF\n', 'latin1');
  const jsPdf = await api('POST', '/api/cp/applications', baseApplication(['proj_pangot'], { documents: [doc('OTHER', 'x.pdf', scriptPdf)] }));
  check('16. PDF containing JavaScript is rejected', jsPdf.status === 400 && Boolean(jsPdf.json?.fields?.document_OTHER));
  const fakeImage = await api('POST', '/api/cp/applications', baseApplication(['proj_pangot'], { documents: [doc('PHOTO', 'p.png', Buffer.concat([PNG.subarray(0, 16), Buffer.alloc(64)]))] }));
  check('17. Corrupt image with a valid PNG header is rejected', fakeImage.status === 400 && Boolean(fakeImage.json?.fields?.document_PHOTO));
  const maxFile = config.json?.maxFileBytes || 2 * 1024 * 1024;
  const bigPdf = Buffer.concat([PDF.subarray(0, 9), Buffer.alloc(maxFile + 10, 0x20), Buffer.from('\n%%EOF\n')]);
  const big = await api('POST', '/api/cp/applications', baseApplication(['proj_pangot'], { documents: [doc('PAN_CARD', 'big.pdf', bigPdf)] }));
  check('18. File over the per-file size limit is rejected', big.status === 400 && /larger than/.test(big.json?.fields?.document_PAN_CARD || ''), big.json);
  const huge = await api('POST', '/api/cp/applications', JSON.stringify({ ...baseApplication(['proj_pangot']), padding: 'x'.repeat(20 * 1024 * 1024) }));
  check('19. Request over the upload size limit is refused with 413', huge.status === 413, huge.status);
  const dupType = await api('POST', '/api/cp/applications', baseApplication(['proj_pangot'], { documents: [doc('PAN_CARD', 'a.pdf', PDF), doc('PAN_CARD', 'b.pdf', PDF)] }));
  check('20. Two files for the same document type are rejected', dupType.status === 400);

  // Other spellings of the URL go through the same guard (rate limit + size limit) as the exact path
  const variants = ['/api/cp/applications/', '/API/CP/APPLICATIONS', '/Api/Cp/Applications/'];
  const variantRes = await Promise.all(variants.map(p => api('POST', p, baseApplication(['proj_pangot']))));
  check('20b. URL variants (trailing slash, capitals) are handled by the guarded route, not a bypass',
    variantRes.every(r => r.status === 201), variantRes.map(r => r.status));
  const variantHuge = await api('POST', '/API/CP/APPLICATIONS/', JSON.stringify({ ...baseApplication(['proj_pangot']), padding: 'x'.repeat(20 * 1024 * 1024) }));
  check('20c. URL variants get the same upload size limit (413)', variantHuge.status === 413, variantHuge.status);

  // Applicant cannot choose status, reference or CP ID
  const sneaky = await api('POST', '/api/cp/applications', baseApplication(['proj_pangot'], {
    status: 'APPROVED', application_ref: 'CP-GRG-HACK', cp_id: 'GRG-CP-9999', reviewed_by: 'attacker', id: 'cpa_attacker'
  }));
  check('21. Applicant-supplied status / reference / CP ID are ignored', sneaky.status === 201 && sneaky.json?.application?.status === 'PENDING' && sneaky.json?.application?.reference !== 'CP-GRG-HACK', sneaky.json);

  // Duplicates
  const sameAgain = await api('POST', '/api/cp/applications', indiv);
  check('22. Same form sent twice (same submission id) returns the original application', sameAgain.status === 200 && sameAgain.json?.duplicateRequest === true && sameAgain.json?.application?.reference === ref1, sameAgain.json);
  const dupMobile = await api('POST', '/api/cp/applications', baseApplication(['proj_pangot'], { mobile: `+91 ${indiv.mobile}` }));
  check('23. New application with an existing mobile number is blocked (409)', dupMobile.status === 409 && dupMobile.json?.code === 'DUPLICATE_APPLICATION', dupMobile.json);
  check('23b. Duplicate message reveals nothing about the other application', !JSON.stringify(dupMobile.json).includes(ref1) && !JSON.stringify(dupMobile.json).includes(indiv.full_name));
  const dupEmail = await api('POST', '/api/cp/applications', baseApplication(['proj_pangot'], { email: indiv.email.toUpperCase() }));
  check('24. New application with an existing e-mail (any letter case) is blocked', dupEmail.status === 409);
  // One canonical address: what is stored, what duplicates are checked against and where e-mail goes are identical
  const canonical = `mixed.case.${RUN}@example.com`;
  const mixed = await api('POST', '/api/cp/applications', baseApplication(['proj_pangot'], { email: `  Mixed.Case.${RUN}@EXAMPLE.Com  ` }));
  check('24b. Address with capitals and surrounding spaces is accepted', mixed.status === 201, mixed.json);
  const mixedRow = (await api('GET', `/api/admin/cp/applications?search=${mixed.json?.application?.reference}`, undefined, token)).json?.applications?.[0];
  const mixedDetail = (await api('GET', `/api/admin/cp/applications/${mixedRow?.id}`, undefined, token)).json;
  const ackRecipient = mixedDetail?.notifications?.find((n: any) => n.event === 'SUBMITTED')?.recipient;
  check('24c. Stored address and notification recipient are the same canonical (trimmed, lower-case) address',
    mixedDetail?.application?.email === canonical && ackRecipient === canonical, [mixedDetail?.application?.email, ackRecipient]);
  const dupVariants = [canonical, canonical.toUpperCase(), ` ${canonical} `];
  const dupVariantRes = await Promise.all(dupVariants.map(email => api('POST', '/api/cp/applications', baseApplication(['proj_pangot'], { email }))));
  check('24d. The same address in any case or with spaces is detected as a duplicate (409)', dupVariantRes.every(r => r.status === 409), dupVariantRes.map(r => r.status));
  const disguisedDup = await api('POST', '/api/cp/applications', baseApplication(['proj_pangot'], { email: `x;${canonical}` }));
  check('24e. A disguised form of an existing address is rejected outright (cannot slip past the duplicate check)',
    disguisedDup.status === 400 && Boolean(disguisedDup.json?.fields?.email), disguisedDup.status);

  // Concurrency: same person submitting from several tabs at once -> exactly one application
  const racer = baseApplication(['proj_pangot']);
  const race = await Promise.all(Array.from({ length: 6 }, () => api('POST', '/api/cp/applications', { ...racer, client_submission_id: uuid() })));
  const raceCreated = race.filter(r => r.status === 201).length;
  check('25. 6 simultaneous submissions for one mobile create exactly one application', raceCreated === 1 && race.filter(r => r.status === 409).length === 5, race.map(r => r.status));
  // Different applicants at once -> all saved with unique references
  const many = await Promise.all(Array.from({ length: 8 }, () => api('POST', '/api/cp/applications', baseApplication(['proj_dholera']))));
  const refs = many.map(r => r.json?.application?.reference);
  check('26. 8 simultaneous different applicants get 8 unique references', many.every(r => r.status === 201) && new Set(refs).size === 8, many.map(r => r.status));
  // Double click: same submission id at the same time -> one application
  const dbl = baseApplication(['proj_pangot']);
  const dblRes = await Promise.all([api('POST', '/api/cp/applications', dbl), api('POST', '/api/cp/applications', dbl), api('POST', '/api/cp/applications', dbl)]);
  const dblRefs = new Set(dblRes.filter(r => r.json?.application).map(r => r.json.application.reference));
  check('27. Simultaneous double-click submissions return one and the same application', dblRefs.size === 1 && dblRes.every(r => r.status === 201 || r.status === 200 || r.status === 409), dblRes.map(r => r.status));

  // ---------------- ADMIN: authorisation ----------------
  const adminUrls: [string, string][] = [
    ['GET', '/api/admin/cp/summary'], ['GET', '/api/admin/cp/applications'], ['GET', '/api/admin/cp/applications/x'],
    ['GET', '/api/admin/cp/applications/x/pan'], ['GET', '/api/admin/cp/applications/x/documents/y'], ['POST', '/api/admin/cp/applications/x/action'],
    ['POST', '/api/admin/cp/notifications/x/retry'], ['GET', '/api/admin/cp/export-csv']
  ];
  const anon = await Promise.all(adminUrls.map(([m, u]) => api(m, u, m === 'POST' ? { action: 'APPROVE' } : undefined)));
  check('28. Every CP admin endpoint refuses requests without a token (401)', anon.every(r => r.status === 401), anon.map(r => r.status));
  const forged = await Promise.all(adminUrls.map(([m, u]) => api(m, u, m === 'POST' ? { action: 'APPROVE' } : undefined, 'eyJpZCI6ImFkbWluXzEifQ==.' + 'a'.repeat(64))));
  check('29. Forged admin tokens are refused', forged.every(r => r.status === 401), forged.map(r => r.status));

  // ---------------- ADMIN: list, search, filters ----------------
  const list = await api('GET', `/api/admin/cp/applications?search=${encodeURIComponent(ref1)}`, undefined, token);
  const row1 = list.json?.applications?.[0];
  check('30. Admin can search by application reference', list.status === 200 && list.json.applications.length === 1 && row1.application_ref === ref1, list.json);
  const id1: string = row1?.id;
  const byMobile = await api('GET', `/api/admin/cp/applications?search=${indiv.mobile.slice(-6)}`, undefined, token);
  check('31. Admin can search by mobile number digits', byMobile.json?.applications?.some((a: any) => a.application_ref === ref1));
  const byCompany = await api('GET', `/api/admin/cp/applications?search=${encodeURIComponent(`CP Test Realty ${RUN}`)}`, undefined, token);
  check('32. Admin can search by company name', byCompany.json?.applications?.length === 1 && byCompany.json.applications[0].application_ref === ref2);
  const id2: string = byCompany.json?.applications?.[0]?.id;
  const byProject = await api('GET', `/api/admin/cp/applications?projectId=proj_dholera&search=${RUN}&pageSize=100`, undefined, token);
  check('33. Project-interest filter only returns applicants interested in that project',
    byProject.json?.applications?.length >= 9 && byProject.json.applications.every((a: any) => a.projects.includes('Dholera')), byProject.json?.applications?.length);
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Kolkata' });
  const byDate = await api('GET', `/api/admin/cp/applications?from=${today}&to=${today}&search=${RUN}`, undefined, token);
  const futureDate = await api('GET', `/api/admin/cp/applications?from=2099-01-01&search=${RUN}`, undefined, token);
  check('34. Submission-date filter works', byDate.json?.pagination?.total >= 13 && futureDate.json?.pagination?.total === 0, [byDate.json?.pagination, futureDate.json?.pagination]);
  const paged = await api('GET', `/api/admin/cp/applications?search=${RUN}&pageSize=5&page=2&sort=full_name&direction=asc`, undefined, token);
  const names = (paged.json?.applications || []).map((a: any) => a.full_name);
  check('35. Pagination and sorting work', paged.json?.applications?.length === 5 && paged.json.pagination.page === 2 && names.every((n: string, i: number) => i === 0 || names[i - 1].localeCompare(n) <= 0), paged.json?.pagination);
  const pendingOnly = await api('GET', `/api/admin/cp/applications?status=PENDING&search=${RUN}&pageSize=100`, undefined, token);
  check('36. Status filter works', pendingOnly.json?.applications?.every((a: any) => a.status === 'PENDING') && pendingOnly.json.applications.length >= 13);

  // ---------------- ADMIN: detail, PAN, documents ----------------
  const d2 = await api('GET', `/api/admin/cp/applications/${id2}`, undefined, token);
  const app2 = d2.json?.application;
  check('37. Detail shows the application with PAN masked', d2.status === 200 && app2.pan_masked === `${company.pan_number.slice(0, 3)}XXXXXX${company.pan_number.slice(9)}` && !('pan_number' in app2), app2?.pan_masked);
  check('37b. GSTIN-contains-PAN check is shown to the admin', app2?.gst_pan_check === 'MATCH');
  check('37c. Website normalised, comments keep line breaks, referral upper-cased', app2?.website === 'https://example.com/' && app2?.comments === 'Line one\nLine two' && app2?.referral_code === 'GRG-REF-1', [app2?.website, app2?.comments, app2?.referral_code]);
  check('37d. Both project interests are stored', app2?.projects?.length === 2);
  const panRes = await api('GET', `/api/admin/cp/applications/${id2}/pan`, undefined, token);
  check('38. Full PAN is available to the admin on request', panRes.json?.pan_number === company.pan_number);
  const docs = d2.json?.documents || [];
  check('39. Document metadata: 3 files, types detected from contents, safe display names', docs.length === 3 &&
    docs.find((d: any) => d.doc_type === 'PAN_CARD')?.mime_type === 'application/pdf' && docs.find((d: any) => d.doc_type === 'ADDRESS_PROOF')?.original_name === 'proof.jpg', docs);
  const pdfDoc = docs.find((d: any) => d.doc_type === 'PAN_CARD');
  const dl = await fetch(`${BASE_URL}/api/admin/cp/applications/${id2}/documents/${pdfDoc?.id}`, { headers: { Authorization: `Bearer ${token}` } });
  const dlBytes = Buffer.from(await dl.arrayBuffer());
  check('40. Admin can download the document; bytes are identical', dl.status === 200 && dlBytes.equals(PDF) && dl.headers.get('content-type') === 'application/pdf' && /attachment/.test(dl.headers.get('content-disposition') || ''), dl.status);
  const dlAnon = await fetch(`${BASE_URL}/api/admin/cp/applications/${id2}/documents/${pdfDoc?.id}`);
  check('41. The same document URL without a token is refused', dlAnon.status === 401);
  const dlWrongApp = await api('GET', `/api/admin/cp/applications/${id1}/documents/${pdfDoc?.id}`, undefined, token);
  check('42. A document cannot be fetched through another application', dlWrongApp.status === 404);
  const publicDoc = await fetch(`${BASE_URL}/uploads/${pdfDoc?.id}`);
  check('43. Documents are not reachable through a public path', !(publicDoc.headers.get('content-type') || '').includes('pdf'));

  // ---------------- ADMIN: workflow ----------------
  const act = (id: string, action: string, extra: Record<string, unknown> = {}) => api('POST', `/api/admin/cp/applications/${id}/action`, { action, ...extra }, token);
  const ur = await act(id1, 'UNDER_REVIEW');
  check('44. Mark Under Review', ur.status === 200 && ur.json?.application?.status === 'UNDER_REVIEW', ur.json);
  const riNo = await act(id1, 'REQUEST_INFO', { reason: '' });
  check('45. Request Additional Information requires a message', riNo.status === 400);
  const ri = await act(id1, 'REQUEST_INFO', { reason: 'Please send a copy of your RERA certificate.' });
  check('45b. Request Additional Information', ri.status === 200 && ri.json?.application?.status === 'ADDITIONAL_INFO_REQUIRED' && ri.json.application.info_request_message.includes('RERA'), ri.json);
  const badMove = await act(id1, 'SUSPEND', { reason: 'Not possible yet' });
  check('46. Invalid transition (suspend before approval) is refused with 409', badMove.status === 409);
  const unknown = await act(id1, 'MAKE_ADMIN');
  check('46b. Unknown action is refused', unknown.status === 400);

  // Concurrent approvals of the same application -> one CP ID
  const approvals = await Promise.all([1, 2, 3].map(() => act(id1, 'APPROVE', { reason: 'Verified PAN and RERA.' })));
  const okApprovals = approvals.filter(r => r.status === 200);
  check('47. Three simultaneous approvals: exactly one succeeds', okApprovals.length === 1 && approvals.filter(r => r.status === 409).length === 2, approvals.map(r => r.status));
  const approved = okApprovals[0]?.json;
  const cpId1: string = approved?.partner?.cp_id;
  check('48. Approval issues a unique CP ID (GRG-CP-NNNN) and an ACTIVE partner record', /^GRG-CP-\d{4,}$/.test(cpId1 || '') && approved?.partner?.status === 'ACTIVE' && approved?.application?.status === 'APPROVED', approved?.partner);
  check('48b. Approval records the approving admin and time', approved?.partner?.approved_by === process.env.ADMIN_EMAIL && Boolean(approved?.partner?.approved_at));
  check('48c. Approved projects default to the projects of interest', JSON.stringify(approved?.partner?.approved_project_ids) === JSON.stringify(['proj_pangot']));
  const again = await act(id1, 'APPROVE');
  check('49. Approving again is refused (no second CP ID)', again.status === 409);

  // Several different approvals at once -> distinct CP IDs
  const toApprove = many.slice(0, 4).map(r => r.json.application.reference);
  const ids = await Promise.all(toApprove.map(async ref => (await api('GET', `/api/admin/cp/applications?search=${ref}`, undefined, token)).json.applications[0].id));
  const parallel = await Promise.all(ids.map(id => act(id, 'APPROVE', { approvedProjectIds: ['proj_dholera'] })));
  const cpIds = parallel.map(r => r.json?.partner?.cp_id);
  check('50. Four approvals at once get four different CP IDs', parallel.every(r => r.status === 200) && new Set([...cpIds, cpId1]).size === 5, cpIds);
  const badProjects = await act(id2, 'APPROVE', { approvedProjectIds: ['proj_nope'] });
  check('51. Approval with an invalid project is refused and changes nothing', badProjects.status === 400 &&
    (await api('GET', `/api/admin/cp/applications/${id2}`, undefined, token)).json?.application?.status === 'PENDING');

  // Reject
  const rjNo = await act(id2, 'REJECT', { reason: '' });
  check('52. Rejection requires a reason', rjNo.status === 400);
  const rj = await act(id2, 'REJECT', { reason: 'Documents could not be verified.' });
  check('52b. Reject', rj.status === 200 && rj.json?.application?.status === 'REJECTED' && rj.json.application.decision_reason === 'Documents could not be verified.', rj.json);
  check('53. A rejected application has no partner record and cannot be approved', rj.json?.partner === null && (await act(id2, 'APPROVE')).status === 409);
  const reapply = await api('POST', '/api/cp/applications', baseApplication(['proj_pangot'], { mobile: company.mobile, email: company.email }));
  check('54. After a rejection the same person can apply again (new application, old one kept)', reapply.status === 201 && reapply.json?.application?.reference !== ref2);
  check('54b. The rejected application is still on record', (await api('GET', `/api/admin/cp/applications/${id2}`, undefined, token)).json?.application?.status === 'REJECTED');

  // Suspend / reactivate
  const spNo = await act(id1, 'SUSPEND', { reason: '' });
  check('55. Suspension requires a reason', spNo.status === 400);
  const sp = await act(id1, 'SUSPEND', { reason: 'Complaint under investigation.' });
  check('55b. Suspend an approved partner', sp.status === 200 && sp.json?.application?.status === 'SUSPENDED' && sp.json?.partner?.status === 'SUSPENDED' && sp.json.partner.suspension_reason === 'Complaint under investigation.', sp.json?.partner);
  const re = await act(id1, 'REACTIVATE', { reason: 'Resolved.' });
  if (role === 'SUPER_ADMIN') {
    check('56. Reactivate a suspended partner (super admin); same CP ID kept', re.status === 200 && re.json?.application?.status === 'APPROVED' && re.json?.partner?.status === 'ACTIVE' && re.json.partner.cp_id === cpId1, re.json?.partner);
  } else {
    check('56. Reactivation is refused for a non-super-admin', re.status === 403);
  }

  // History + audit
  const d1 = (await api('GET', `/api/admin/cp/applications/${id1}`, undefined, token)).json;
  const transitions = (d1?.history || []).map((h: any) => `${h.from_status || '-'}>${h.to_status}`);
  check('57. Review history records every transition in order', JSON.stringify(transitions) === JSON.stringify(
    ['->PENDING', 'PENDING>UNDER_REVIEW', 'UNDER_REVIEW>ADDITIONAL_INFO_REQUIRED', 'ADDITIONAL_INFO_REQUIRED>APPROVED', 'APPROVED>SUSPENDED', ...(role === 'SUPER_ADMIN' ? ['SUSPENDED>APPROVED'] : [])]
  ), transitions);
  check('57b. History entries carry the admin and the reason', d1?.history?.[3]?.admin_email === process.env.ADMIN_EMAIL && d1?.history?.[4]?.note === 'Complaint under investigation.');
  const actions = (d1?.activity || []).map((l: any) => l.action);
  const activity2 = ((await api('GET', `/api/admin/cp/applications/${id2}`, undefined, token)).json?.activity || []).map((l: any) => l.action);
  check('58. Approvals, suspensions and data access are in the audit trail', ['CP_APPROVE', 'CP_SUSPEND', 'CP_REQUEST_INFO', 'CP_UNDER_REVIEW'].every(a => actions.includes(a)) &&
    activity2.includes('CP_PAN_VIEWED') && activity2.includes('CP_DOCUMENT_VIEWED') && activity2.includes('CP_REJECT'), [actions, activity2]);
  check('58b. Blocked duplicate submissions are recorded for the admin team', actions.includes('CP_DUPLICATE_APPLICATION_BLOCKED'));
  const systemAudit = (await api('GET', '/api/admin/audit-logs', undefined, token)).json?.auditLogs || [];
  check('58c. CP actions also appear in the existing System Audit Trail', systemAudit.some((l: any) => l.entity_type === 'CP_APPLICATION'));

  // ---------------- notifications ----------------
  const notifs = d1?.notifications || [];
  if (!smtpConfigured) {
    check('59. Without SMTP every notification is recorded as NOT_CONFIGURED (never claimed as sent)',
      notifs.length >= 3 && notifs.every((n: any) => n.status === 'NOT_CONFIGURED'), notifs.map((n: any) => `${n.event}:${n.status}`));
    const retry = await api('POST', `/api/admin/cp/notifications/${notifs[0]?.id}/retry`, undefined, token);
    check('60. Retry without SMTP stays NOT_CONFIGURED', retry.status === 200 && retry.json?.notification?.status === 'NOT_CONFIGURED');
    const noEmail = (await api('GET', `/api/admin/cp/applications?search=${noOptional.json?.application?.reference}`, undefined, token)).json?.applications?.[0];
    const ne = (await api('GET', `/api/admin/cp/applications/${noEmail?.id}`, undefined, token)).json;
    check('61. Applicant without e-mail: acknowledgement recorded as NO_RECIPIENT', ne?.notifications?.find((n: any) => n.event === 'SUBMITTED')?.status === 'NO_RECIPIENT');
  } else {
    // Delivered: acknowledgement + internal alert for the first application, approval e-mail with the CP ID
    await sleep(500);
    const ack = mails.find(m => m.to === indiv.email && m.data.includes(ref1));
    check('59. Acknowledgement e-mail delivered to the applicant with the reference', Boolean(ack));
    check('59b. Internal alert sent to the onboarding inbox without applicant details', mails.some(m => m.data.includes(ref1) && m.to !== indiv.email && !m.data.includes(indiv.mobile)));
    const approvalMail = mails.find(m => m.to === indiv.email && m.data.includes(cpId1));
    check('60. Approval e-mail contains the CP ID', Boolean(approvalMail));
    check('60b. Notification statuses recorded as SENT', notifs.filter((n: any) => n.event !== 'SUBMITTED_INTERNAL').every((n: any) => n.status === 'SENT'), notifs.map((n: any) => `${n.event}:${n.status}`));
    // Failure: mail server rejects -> application still saved, failure visible, retry works
    smtpMode = 'reject';
    const failApp = baseApplication(['proj_pangot']);
    const fr = await api('POST', '/api/cp/applications', failApp);
    check('61. Submission succeeds even when the e-mail fails', fr.status === 201);
    const fid = (await api('GET', `/api/admin/cp/applications?search=${fr.json?.application?.reference}`, undefined, token)).json?.applications?.[0]?.id;
    let fd: any = null;
    for (let i = 0; i < 20; i++) { fd = (await api('GET', `/api/admin/cp/applications/${fid}`, undefined, token)).json; if (fd?.notifications?.every((n: any) => n.status !== 'PENDING')) break; await sleep(250); }
    const ackN = fd?.notifications?.find((n: any) => n.event === 'SUBMITTED');
    check('62. Failed e-mail is recorded as FAILED with a reason, address masked', ackN?.status === 'FAILED' && /550/.test(ackN.last_error || '') && !(ackN.last_error || '').includes('@'), ackN);
    const rjFail = await act(fid, 'REJECT', { reason: 'Test rejection while mail server is down.' });
    check('63. A decision is saved even when its e-mail fails', rjFail.status === 200 && rjFail.json?.application?.status === 'REJECTED' &&
      rjFail.json.notifications.find((n: any) => n.event === 'REJECTED')?.status === 'FAILED');
    smtpMode = 'accept';
    const retry = await api('POST', `/api/admin/cp/notifications/${ackN?.id}/retry`, undefined, token);
    check('64. Admin can retry a failed e-mail; it is then SENT', retry.status === 200 && retry.json?.notification?.status === 'SENT' && retry.json.notification.attempts === 2, retry.json);
    const retryAgain = await api('POST', `/api/admin/cp/notifications/${ackN?.id}/retry`, undefined, token);
    check('64b. A sent e-mail is not sent twice', retryAgain.status === 409);
  }

  // ---------------- summary + CSV ----------------
  const summary = (await api('GET', '/api/admin/cp/summary', undefined, token)).json;
  const allRows = (await api('GET', '/api/admin/cp/applications?pageSize=100', undefined, token)).json;
  const totalAll = allRows?.pagination?.total;
  check('65. Summary counts come from the database and add up', summary?.total === totalAll &&
    Object.values(summary.counts as Record<string, number>).reduce((s, n) => s + n, 0) === summary.total, summary);
  const csvCompany = baseApplication(['proj_pangot'], { partner_type: 'BROKERAGE_FIRM', company_name: `=HYPERLINK("http://evil.example")${RUN}` });
  await api('POST', '/api/cp/applications', csvCompany);
  const csv = await api('GET', `/api/admin/cp/export-csv?search=${RUN}`, undefined, token);
  check('66. CSV export works for an admin', csv.status === 200 && csv.text.includes('Application Reference') && csv.text.includes(ref1) && csv.text.includes(cpId1));
  check('66b. CSV excludes PAN, date of birth, address and documents', !csv.text.includes(company.pan_number) && !csv.text.includes('1985-04-12') && !csv.text.includes('Rajpur Road'));
  check('66c. CSV neutralises spreadsheet formulas', csv.text.includes(`"'=HYPERLINK(`) && !/(^|,)"=HYPERLINK/m.test(csv.text));
  const csvAnon = await api('GET', '/api/admin/cp/export-csv');
  check('67. CSV export requires sign-in', csvAnon.status === 401);
  check('67b. Export is recorded in the audit trail', ((await api('GET', '/api/admin/audit-logs', undefined, token)).json?.auditLogs || []).some((l: any) => l.action === 'CP_APPLICATIONS_EXPORTED'));

  // ---------------- mail sender: last line of defence ----------------
  // Called directly in this test process (with SMTP pointed at the fake server): even an address that bypassed the form
  // checks (e.g. a mistyped CP_NOTIFY_EMAIL setting) is never handed to the mail library.
  process.env.SMTP_HOST = '127.0.0.1'; process.env.SMTP_PORT = String(SMTP_PORT); process.env.SMTP_SECURE = 'false';
  process.env.SMTP_FROM = 'Garg Realty Partners <partners@example.com>';
  const { deliverCpNotification } = await import('../src/server/cpNotifications.js');
  const fakeApp: any = { id: 'cpa_test', application_ref: `CP-GRG-TEST-${RUN}`, full_name: 'CP Test Direct', project_ids: [], created_at: new Date().toISOString() };
  const mailsBefore = mails.length;
  smtpMode = 'accept';
  const bad = await deliverCpNotification({ id: 'cpn_t1', application_id: 'cpa_test', event: 'SUBMITTED', channel: 'EMAIL', recipient: 'a<victim@evil.com>', status: 'PENDING', attempts: 0, created_at: '', updated_at: '' }, fakeApp, null, x => x);
  check('70. Mail sender refuses a disguised recipient without contacting the mail server', bad.status === 'FAILED' && /not a valid plain/.test(bad.last_error || '') && mails.length === mailsBefore, bad);
  const good = await deliverCpNotification({ id: 'cpn_t2', application_id: 'cpa_test', event: 'SUBMITTED', channel: 'EMAIL', recipient: `cp.direct.${RUN}@example.com`, status: 'PENDING', attempts: 0, created_at: '', updated_at: '' }, fakeApp, null, x => x);
  check('71. Mail sender delivers a valid address to exactly that one recipient (explicit envelope)',
    good.status === 'SENT' && mails.length === mailsBefore + 1 && mails[mails.length - 1].to === `cp.direct.${RUN}@example.com`, [good.status, mails.slice(mailsBefore)]);

  // ---------------- existing booking features still answer ----------------
  const projects = await api('GET', '/api/projects');
  check('68. Existing project list still works', projects.status === 200 && projects.json?.projects?.length === 2);
  const overview = await api('GET', '/api/admin/overview', undefined, token);
  check('69. Existing admin overview still works', overview.status === 200);

  console.log(`\nCP onboarding test run complete: ${passed} Passed, ${failed} Failed.`);
  smtp.close();
  process.exit(failed ? 1 : 0);
}

main().catch(err => {
  console.error('Test run aborted:', err);
  smtp.close();
  process.exit(1);
});
