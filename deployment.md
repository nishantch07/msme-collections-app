# Deployment & Reviewer Evaluation Guide
## MSME Field Collections App with AI Prioritisation

- **Author:** Nishant Chhetri
- **GitHub Repository:** [https://github.com/nishant-chhetri/msme-collections-app](https://github.com/nishant-chhetri/msme-collections-app)
- **Live Deployment:** [https://msme-collections-app.onrender.com](https://msme-collections-app.onrender.com)

---

## 1. Quick Local Setup (< 2 Minutes)

### Prerequisites
- Node.js `v18+` or `v20+` (tested on Node v20 & v24)
- npm `v9+` or `v10+`
- Git

### Step-by-Step Commands
```bash
# 1. Clone repository
git clone https://github.com/nishant-chhetri/msme-collections-app.git
cd msme-collections-app

# 2. Install dependencies
npm install

# 3. Initialize SQLite database & generate Prisma client
npx prisma db push

# 4. Seed demo users and Bengaluru + Indore sample accounts
npx prisma db seed

# 5. Execute automated Vitest test suite
npm test

# 6. Start local development server
npm run dev
```

Visit [http://localhost:3000](http://localhost:3000) in your browser.

---

## 2. Demo Hosting Only

This repository is an evaluation prototype, not a production deployment package. Do not connect real borrower data or use this workflow for live recovery until the release blockers in section 4 are resolved and approved by the lender's legal, privacy, security, and operations teams.

For an isolated demo deployment only, configure:

- `DATABASE_URL` — SQLite path (`file:./dev.db`) for evaluation only
- `JWT_SECRET` — Random secret of at least 32 characters; never reuse a demo value
- `GEMINI_API_KEY` — Optional; only used for advisory suggestions in non-production
- `NEXT_PUBLIC_APP_URL` — Full URL of the deployed application (e.g., `https://msme-collections-app.onrender.com`)

### Isolated Demo Service Settings
- **Environment:** Node
- **Build Command:** `npm install && npx prisma generate && npm run build`
- **Start Command:** `npm run start`
- Use a persistent disk only for demo data and verify it survives restarts. SQLite on ephemeral hosting storage will lose data and is not suitable for operational use.

Initialize a fresh demo database as a one-time step with `npx prisma db push` and `npx prisma db seed`. The seed clears demo tables, is disabled when `NODE_ENV=production`, and must never be run against operational data. For an internet-accessible demo, replace seeded passwords and do not use real borrower records.

---

## 3. Demo Credentials & Reviewer Walkthrough

### 3.1 Demo Accounts
| Role | Email | Password | Primary Scope |
| :--- | :--- | :--- | :--- |
| **Field Officer** | `officer@msmelender.in` | `Officer@123` | Peenya Beat (`560058`), 3-Tap Logging, AI Reminders |
| **Collections Manager** | `manager@msmelender.in` | `Manager@123` | Portfolio Oversight (`All Pincodes`), AI Escalation Queue |
| **Indore Field Officer** | `rahul@msmelender.in` | `Officer@123` | Indore (`452001`); sample account LN-10293 |
| **Indore Field Officer** | `neha@msmelender.in` | `Officer@123` | Indore (`452001`); sample account LN-10871 |
| **Indore Field Officer** | `imran@msmelender.in` | `Officer@123` | Indore (`452001`); sample account LN-11930 |

These credentials are for local evaluation only. Seed clears demo user and loan tables; never run it against persistent or real borrower data.

---

### 3.2 2-Minute Evaluator Verification Checklist

1. **Test AI Explainability & Priority Scoring:**
   - On the Field Officer Beat queue, observe accounts ranked by Priority Score ($0–100$).
   - Inspect the top 3 human-readable badges on cards (e.g., `78 DPD (+34.7 pts)`, `3 Broken PTPs (+30.0 pts)`).
2. **Test AI Uncertainty & Dispute Holds:**
   - Look at **Balaji Packaging Solutions** or **Cauvery Metal Works**.
   - Note the prominent amber banner explaining why AI is unsure (`DISPUTE_HOLD` / `LOW_CONFIDENCE`).
   - Click **"Override AI"**, adjust the score slider, type an audit reason, and commit the override. Notice the card update live.
3. **Test the 3-Tap Field Visit Logger (Online & Offline):**
   - Click **"3-Tap Visit"** on any borrower card.
   - Tap an outcome chip (`Paid`, `Promise to Pay`, `Dispute`, etc.).
   - Allow browser/device location and verify the actual GPS coordinates and reported accuracy.
   - Tap **"Save Outcome"** — see the card update immediately.
   - Toggle to **Offline Mode** via the bottom demo toolbar. Log another visit. Notice the pending queue badge (`Offline Mode: 1 pending`) stored in IndexedDB. Click **"Flush Queue"** to batch-sync back to the server.
4. **Test the 2-Layer AI Guardrail:**
   - Click **"AI Reminder"** on any borrower card.
   - Toggle between **English** and **हिंदी**.
   - In the "Reviewer Stress-Test" sandbox, click any aggressive trigger (e.g., *"Police & jail seizure threat"* or *"Phantom amount ₹9,99,999"*).
   - Watch the guardrail instantly catch violations and sanitize the preview text live.
5. **Test the RBI Fair Practices Time Gate (08:00 - 19:00 IST):**
   - In the bottom demo toolbar, toggle the clock to **"🌙 20:45 IST (RBI Locked)"**.
   - Notice the top header and call/visit action buttons reflect the lockout.
   - Try logging a visit or calling — verify that the action is blocked per RBI Fair Practices regulations.
6. **Test Manager Dashboard & Audit Trail:**
   - Sign out and sign in as the **Collections Manager**.
   - Review portfolio KPIs (Collectable Exposure, Collected Today, Broken PTPs).
   - Inspect the **AI Uncertainty & Escalation Queue** and field/contact audit log.

### 3.3 CSV import, roll rates and promise tracking

- Sign in as a manager and choose **Import overdue CSV**. The sample file is [`sample-data/overdue-indore.csv`](./sample-data/overdue-indore.csv).
- Required columns are Loan ID, Borrower, Outstanding, DPD and Pincode. If Pincode is omitted, the Officer column must match a seeded officer; its pincode is used to find eligible staff, then assignment is balanced by current loan workload.
- Amounts in a normal `Outstanding` column are rupees; a column named `outstanding_paise` is interpreted as paise. Optional columns include EMI, Promise Date, Phone, Owner, Business Type and GPS coordinates.
- Before overdue imports, open **Manage branch master** and upload the complete, operations-approved CSV with `branch_code,branch_name,pincode` columns. A pincode can map to only one branch; mappings omitted from the new full-master file are removed. Production loan imports reject pincode values that have no branch-master mapping.
- Import a second daily snapshot to compare the 1–30 DPD cohort with its current DPD. Reporting groups snapshots by the branch mapping captured when each import ran; earlier snapshots without a mapping are explicitly labelled as unmapped.
- A 30-day score back-test appears only after a snapshot is at least 30 days old. It is descriptive, not a causal or statistically validated model report.
- Visit outcomes capture device GPS. The officer must tap **Review & open WhatsApp** and confirm/send inside WhatsApp; no message is automatically sent. Blocked and initiated contact attempts are stored for the manager audit feed.

## 4. Production deployment setup

- The production Prisma schema is `prisma/schema.production.prisma`; the existing `prisma/schema.prisma` and SQLite workflow remain for local demo use. The initial PostgreSQL migration is for a **new, empty** Neon database. Do not run it against an existing database or use `prisma db push` in production. A database containing demo or operational records needs a separately reviewed baseline and migration/cutover plan.
- Configure Render secret values privately; never commit them or paste them into chat:
  - `DATABASE_URL`: Neon pooled PostgreSQL connection string with TLS.
  - `DIRECT_URL`: Neon direct (non-pooled) connection string, used by Prisma migrations.
  - `JWT_SECRET`: cryptographically random, at least 32 characters. Production officer passwords must also be at least 12 characters to enable the encrypted offline vault.
  - `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`: Upstash REST credentials. Protected endpoints fail closed with HTTP 503 when these are absent or unavailable.
  - `NEXT_PUBLIC_APP_URL`: the HTTPS Render application URL.
  - `PRIVACY_NOTICE_VERSION` and `DATA_RETENTION_POLICY_VERSION`: set only after the lender approves the notices and retention policy. These values are governance markers, not implementation of consent or retention workflows.
  - `PRODUCTION_DATA_USE_APPROVED=true`: set only after the lender's legal, privacy, security, and operations owners have signed off for live borrower data. Borrower-data APIs fail closed until this approval, the branch master, and field-device validation are present.
  - `FIELD_DEVICE_VALIDATION_VERSION`: set only after the supported-device field test plan and results are approved and recorded.
  - `APPROVED_DLT_TEMPLATE_ID`: informational until the registered template and approved provider integration are implemented; production WhatsApp remains disabled.
- Render service commands:
  - **Build:** `npm ci && npm run build:production`
  - **Pre-deploy command:** `npm run db:deploy:production`
  - **Start:** `npm run start`
  - **Health check path:** `/api/health`
- `npm run build:production` generates the PostgreSQL Prisma client before building. Local SQLite development should use `npm run prisma:generate:local` after a production build. Configure a Render pre-deploy step (not the start command) for migrations to avoid running them concurrently on multiple instances.
- Verify `/api/health` is 200 after setting Neon credentials. `/api/readiness` reports release checks and stays blocked until the operational approvals, branch master, and field-device validation pass. Production borrower-data APIs return HTTP 503 with the missing gate names until then; branch-master import remains available to complete setup. Messaging readiness is reported separately and production WhatsApp remains blocked even when the operational data gate passes. Never use seed scripts or demo credentials in production.
- Rate limiting uses Upstash sliding windows for login, import, sync, contact, outcome, AI, and override endpoints. If Redis credentials are missing or Redis is unavailable, production operations return 503 rather than silently running unprotected.

## 5. Production and privacy release blockers

- The role and clock simulators are development-only. Production contact/outcome APIs use server-side IST checks; authenticated officers are limited to assigned loans. Login rejects seeded demo accounts, responses do not expose the session token, and sessions expire after eight hours.
- Offline visit/contact queue records are encrypted at rest in IndexedDB using AES-GCM with a PBKDF2-derived key; the key/password is not persisted and the officer must unlock the vault after reload. Legacy plaintext queue entries require an explicit account-owner confirmation before encryption. This is not a substitute for managed-device encryption, remote wipe, device identity, secure key recovery, or low-end device testing.
- The branch-master upload and branch-specific roll-rate reporting are implemented, but Company A must provide and validate the actual branch-to-pincode master. Historical snapshots without branch assignments remain labelled as unmapped.
- Production WhatsApp is deliberately blocked: the app has no provider integration and no verified lender DLT template. Tapping the production action records a blocked contact attempt; neither reminder previews nor templates can be copied or sent from production until the registered text and a provider integration are implemented and approved.
- `/api/readiness` checks the database, session secret, Upstash, legal-policy version markers, explicit production data-use approval, branch-master presence, and field-device validation. Production borrower-data endpoints enforce these gates. Messaging integration and supported-device validation are not represented as a substitute for legal/security sign-off; WhatsApp remains disabled until its approved integration is implemented.
- This project is not a DPDP Act compliance certification. Legal/privacy teams must still approve the borrower/staff notices, lawful purpose and rights workflow, retention/deletion schedule, processor agreements, breach response, and DPIA/security review. The version variables are not evidence of those controls.
- Before live borrower data: run and document Neon backup/restore drills, migration review, access-control and audit-integrity review, monitoring/alerting and incident-response exercises, retention/deletion tests, and an end-to-end pilot on supported low-end Android devices (offline reload, GPS permissions, sync conflicts, lost-device handling, and recovery).
- Offline device timestamps are not tamper-proof evidence. The server checks malformed/future timestamps and stores server sync time; device-clock manipulation remains an operational limitation.
