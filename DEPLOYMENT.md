# Deploying to Hostinger (Node.js Web App)

The portal is one Node.js app: an Express server that serves the built React site and stores bookings in a
local JSON database. `npm run build` produces two things:

- `dist/` — the website (Vite)
- `build/server.js` — the compiled server (esbuild); this is the file Hostinger runs

No external database is required.

## Hostinger settings (hPanel → Websites → Add website → Node.js Web App → import from GitHub)

| Setting | Value |
|---|---|
| Repository / branch | `garg-realty-registration-payment-portal-v2` / `main` |
| Framework | Express.js (or "Other" if Express is not listed) |
| Node.js version | 22.x (20.x also works; minimum 20.19) |
| Root directory | `./` (repository root) |
| Package manager | npm |
| Build command | `npm run build` |
| Entry file | `build/server.js` (start command, if asked: `npm start`) |

## Environment variables (set in Hostinger's environment variables panel — never commit `.env`)

| Key | Required | Value |
|---|---|---|
| `ADMIN_EMAIL` | yes | admin login email |
| `ADMIN_PASSWORD` | yes | at least 16 characters |
| `ADMIN_JWT_SECRET` | yes | at least 32 random characters, e.g. `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `DATA_DIR` | strongly recommended | absolute folder **outside** the deployed code, e.g. `/home/<your-hostinger-user>/garg-realty-data` |
| `APP_URL` | recommended | your public URL, e.g. `https://apply.yourdomain.com` |
| `NODE_ENV` | optional | `production` (the compiled server already defaults to production) |
| `PORT` | no | provided by Hostinger |

Google Sheets, Razorpay, CRM and email keys are optional; leave them unset if unused.

## Booking data (important)

All bookings live in `<DATA_DIR>/db.json` (default: `data/db.json` inside the app folder). Redeploying replaces the
app folder's code, so point `DATA_DIR` at a folder outside it to make sure bookings survive every redeploy.
The folder and database are created automatically on first start, with the admin account taken from the
environment variables. Back up this folder regularly.

## After deploying

- `https://<your-domain>/` shows the home page; `/admin` shows the admin login.
- The runtime log shows `Server listening on port … (Env: production)`.
- If the log warns "Admin login disabled" or "Admin account not provisioned", check the three `ADMIN_*` variables.

## Local development

`npm run dev` runs the TypeScript server directly with the Vite dev server (no build needed).
