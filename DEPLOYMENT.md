# Deploying to Hostinger (Node.js Web App + MySQL)

The portal is one Node.js app: an Express server that serves the built React site and stores all bookings,
payments, project settings, admin accounts and audit logs in a **MySQL database** (Hostinger MySQL / MariaDB).
`npm run build` produces:

- `dist/` — the website (Vite)
- `build/server.js` — the compiled server (esbuild); this is the file Hostinger runs

In production the server refuses to start without the database settings, so it can never fall back to a local file.
(`data/db.json` is only used for local development when `DB_HOST` is empty.)

## 1. Create the MySQL database in hPanel

1. Log in to hPanel → **Websites** → **Manage** (your site) → **Databases** → **Management** (MySQL Databases).
2. Under **Create a new MySQL database and database user** enter a database name (e.g. `garg_portal`),
   a user name (e.g. `garg_app`) and a strong password (use the generator). Click **Create**.
   Hostinger adds your account prefix, e.g. `u123456789_garg_portal` and `u123456789_garg_app`.
3. Note the four values shown in the database list / database details:
   - **MySQL database name** → `DB_NAME` (with the prefix)
   - **MySQL user** → `DB_USER` (with the prefix)
   - **Password** you just set → `DB_PASSWORD`
   - **MySQL host** → `DB_HOST` — use exactly the host hPanel shows for this database (do not guess).
     The port is `3306` → `DB_PORT`.
4. Optional, only to test from your own computer: **Databases → Remote MySQL** → add your current IP for this
   database and use the remote host name shown there (e.g. `srvNNNN.hstgr.io`). Remove the IP again afterwards.
5. (Recommended) Create a **second, separate** database for automated tests (e.g. `garg_portal_test`).
   Never run the test suites against the live database.

You do not need to create tables: the app creates and upgrades its schema automatically on first start
(the same SQL is in `database/schema.sql` if you prefer to import it once in phpMyAdmin).
Only Pangot's verified configuration (₹51,000 token, 4 units) and an empty, closed Dholera project are seeded,
plus the admin account from the environment. No bookings or payments are created.

## 2. Hostinger web app settings (hPanel → Websites → Add website → Node.js Web App → import from GitHub)

| Setting | Value |
|---|---|
| Repository / branch | `garg-realty-registration-payment-portal-v2` / `main` |
| Framework | Express.js (or "Other" if Express is not listed) |
| Node.js version | 22.x (20.x also works; minimum 20.19) |
| Root directory | `./` (repository root) |
| Package manager | npm |
| Build command | `npm run build` |
| Entry file | `build/server.js` (start command, if asked: `npm start`) |

## 3. Environment variables (Hostinger's environment variables panel — never commit `.env`)

| Key | Required | Value |
|---|---|---|
| `DB_HOST` | yes | MySQL host from hPanel |
| `DB_PORT` | yes | `3306` |
| `DB_NAME` | yes | database name incl. prefix |
| `DB_USER` | yes | database user incl. prefix |
| `DB_PASSWORD` | yes | database user's password |
| `ADMIN_EMAIL` | yes | admin login email |
| `ADMIN_PASSWORD` | yes | at least 16 characters |
| `ADMIN_JWT_SECRET` | yes | at least 32 random characters, e.g. `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `APP_URL` | recommended | your public URL, e.g. `https://apply.yourdomain.com` |
| `DB_POOL_SIZE` | optional | connection pool size, default `5` (keep low on shared hosting) |
| `DB_SSL` | optional | `true` only if your database requires TLS |
| `NODE_ENV` | optional | `production` (the compiled server already defaults to production) |
| `PORT` | no | provided by Hostinger |

Google Sheets, Razorpay, CRM and email keys are optional; leave them unset if unused.
Credentials are only read on the server; they are never sent to the browser or written to the logs
(the startup log shows only the host and database name).

## 4. After deploying

- The runtime log shows `[Database] MySQL connected: <host>:3306 / <database> (schema ready)` and
  `Server listening on port … (Env: production)`.
- If it shows `Fatal startup error: Database unavailable (...)` or `Database configuration incomplete`, check the
  five `DB_*` variables (the message names the problem; it never contains the password).
- `https://<your-domain>/` shows the project selection; `/admin` shows the admin login.
- In hPanel → **SSL**, make sure the free SSL certificate is installed and **Force HTTPS** is on, so the site and
  the admin login are only served over HTTPS.

## 5. Checking the database connection

From a computer that can reach the database (Remote MySQL enabled for its IP), with the five `DB_*` values in `.env`:

```
npm run db:check
```

It is read-only: it prints the server version, whether all 9 tables exist, and booking/payment counts per project.

## 6. Backups (do this before going live)

- **Automatic:** hPanel → **Files → Backups** (or **Databases → Backups**, depending on plan). Check that daily
  database backups are included in your plan and confirm you can download one. Keep at least 7 days.
- **Manual before every change/deploy:** hPanel → Databases → **phpMyAdmin** → select the database → **Export**
  (Quick, SQL) → save the `.sql` file somewhere private (it contains customer data — never upload it to GitHub).
- **Restore:** phpMyAdmin → select the (empty) database → **Import** → choose the `.sql` file.
- Test a restore into the separate test database once, so you know the backup works.

## 7. Tests

- `npm run test:db` — database-layer tests (constraints, transactions, concurrency). Creates only rows named
  "DB Layer Test" and deletes exactly those at the end. Point it at the **test** database.
- `npm run test:flow` / `npm run test:dholera` — full booking flows against a running server
  (`npm run dev:mock-sheets`). They change Dholera's configuration, so run them only against the **test** database.
- `npm run db:cleanup-test` — lists bookings with `@example.com` e-mails (test data only);
  `npm run db:cleanup-test -- --delete` removes exactly those.

## 8. Channel Partner (CP) / Broker onboarding

Public page: `https://<your-domain>/cp-registration` (also linked from the navbar, the homepage and the footer).
Admin: `/admin` → **CP / Broker Management**.

**Database (migration 2).** The first start of this version creates 7 new tables (`cp_applications`,
`cp_application_projects`, `cp_documents`, `cp_partners`, `cp_partner_projects`, `cp_status_history`,
`cp_notifications`) and two counters, then records version 2 in `schema_migrations`. It adds tables only:
bookings, payments, projects and admin accounts are not altered. It runs once; every statement is
`IF NOT EXISTS`, so an interrupted start simply completes it next time. SQL: `database/migrations/002_cp_onboarding.sql`.
- **Before deploying:** export a backup in phpMyAdmin (section 6).
- **After deploying:** `npm run db:check` should show `schema versions applied: 1, 2` and `All 7 Channel Partner tables present`.
- **Rollback** (only if the module is withdrawn, and it deletes all CP data): deploy the previous version first, then run
  `database/migrations/002_cp_onboarding.rollback.sql` in phpMyAdmin. Bookings are not affected.

**Documents** are stored inside the database (`cp_documents`), never in a public folder, and can be opened only by a
signed-in admin; each view is recorded. Accepted: PDF, JPG, PNG; contents are checked (not just the file name);
PDFs with scripts are refused. Defaults: 2 MB per file, 10 MB per application (`CP_MAX_FILE_MB`, `CP_MAX_TOTAL_MB`).
Documents count towards your database size: check the database quota in hPanel occasionally.

**E-mail.** Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` in the Hostinger environment
(for a Hostinger mailbox: `smtp.hostinger.com`, port `465`). Until then nothing is e-mailed and the admin panel shows
"not sent – e-mail not configured" for each notification (with a Retry button for later). "Sent" means the mail server
accepted the message, not that it reached the inbox.

Optional settings: `CP_NOTIFY_EMAIL`, `CP_CONTACT_EMAIL`, `CP_CONTACT_PHONE`, `CP_REQUIRED_DOCUMENTS`
(e.g. `PAN_CARD`), `CP_SUBMISSIONS_PER_HOUR`, `CP_ALLOW_INTERNATIONAL` — see `.env.example`.

**Tests:** `npm run test:cp` (against a running server on a **test** database; records use `@example.com` e-mails and
are removed with `npm run db:cleanup-test -- --delete`).

## 9. Dependency security notes

**Fixed**
- `body-parser` 1.20.9 (used by Express 4.22.3) fixes GHSA-27r3-jxmh-p828 / CVE-2026-111181: a compressed request
  body with trailing bytes could crash the server. In addition, all request-body parsers use `inflate: false`, so
  compressed (`Content-Encoding`) request bodies are refused with 415 before any decompression. Browsers and the
  Razorpay webhook send uncompressed JSON; the webhook signature is still checked against the exact raw bytes.
- `vite` 8.3.4 fixes the development-server advisories (launch-editor, `server.fs`). Vite runs only for
  `npm run dev` and `npm run build`; the production server never starts it.
- `nodemailer` 10.2.1 fixes the address-parser advisories (and CP e-mail addresses are strictly validated).

**Known, not exploitable here (accepted)** — `@grpc/grpc-js` 1.9.16 (GHSA-m9gg-hp2v-232j high,
GHSA-f596-whhp-79r4 low; fixed in 1.13.6), reported through `firebase` 12.19.0 → `@firebase/firestore` 4.17.2,
which pins `@grpc/grpc-js` `~1.9.0` (so does the newest firebase, 13.1.0; `npm audit` suggests downgrading
firebase to 9.14.0, which is not done). Evidence that the vulnerable code never runs:
- The app imports only `firebase/app` and `firebase/auth` (`src/lib/googleAuth.ts`, admin Google sign-in in the
  browser). Firestore is imported nowhere.
- `@grpc/grpc-js` is a Node.js library; Firestore uses it only when Firestore runs on a server. Neither the built
  site (`dist/`) nor `build/server.js` contains gRPC or Firestore code.
- The advisories concern gRPC *servers* (`getAuthContext`, server error messages); this app runs no gRPC server.
Revisit if Firestore is ever added, or when a firebase release allows `@grpc/grpc-js` ≥ 1.13.6.

## Local development

`npm run dev` runs the TypeScript server with the Vite dev server. With `DB_*` set in `.env` it uses that MySQL
database; without them it uses `data/db.json`.

**Careful:** if `.env` contains the live Hostinger `DB_*` values, `npm run dev` on your computer connects to the
**live** database (and a new version applies its migrations there). For development, leave `DB_*` empty or point them
at a separate test database.
