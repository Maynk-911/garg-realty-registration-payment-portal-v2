# Deploying to Hostinger (Node.js hosting)

The portal is a single Node.js app: an Express server (`server.ts`) that serves the built React site from `dist/`
and stores bookings in a local JSON database (`data/db.json`). No external database is required.

## 1. Upload the code

Upload the project **without** these (they are created on the server or must stay private):

- `node_modules/` — installed by Hostinger
- `dist/` — built on the server
- `.env` — create it on the server (step 2); never upload or commit it
- `data/db.json` — created automatically on first start; never overwrite it on a redeploy (it holds live bookings)

If you deploy from Git, `.gitignore` already excludes all of the above.

## 2. Environment variables

Create `.env` in the project root on the server (or set the same keys in Hostinger's environment panel),
starting from `.env.example`. Required:

| Key | Value |
|---|---|
| `NODE_ENV` | `production` |
| `ADMIN_EMAIL` | the admin login email |
| `ADMIN_PASSWORD` | at least 16 characters |
| `ADMIN_JWT_SECRET` | at least 32 random characters (e.g. `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`) |
| `APP_URL` | your real public URL |

`PORT` is provided by Hostinger. Google Sheets, Razorpay and CRM keys are optional; leave them as placeholders if unused.

## 3. Build and start

```
npm install
npm run build
npm start
```

Set the application startup command in Hostinger to `npm start` (entry: `server.ts`, run through `tsx`).

## 4. Check after deploying

- `https://<your-domain>/` shows the home page.
- `https://<your-domain>/admin` shows the login form; log in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`.
- The server log shows `Server listening on port … (Env: production)`.
- Make sure the `data/` folder is writable and is kept between deploys (back it up regularly — it is the booking database).
