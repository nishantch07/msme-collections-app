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

# 4. Seed 18 Bengaluru MSME accounts & demo users
npx prisma db seed

# 5. Execute automated Vitest test suite
npm test

# 6. Start local development server
npm run dev
```

Visit [http://localhost:3000](http://localhost:3000) in your browser.

---

## 2. Production Deployment (Render / Vercel)

### Required Environment Variable Names (No Secrets Committed)
Configure the following variable names in your cloud hosting provider dashboard:

- `DATABASE_URL` — SQLite path (`file:./dev.db`) or PostgreSQL connection string
- `JWT_SECRET` — High-entropy secret string for signed session tokens
- `GEMINI_API_KEY` — (Optional) Google Gemini Flash API key; falls back to deterministic DLT templates if omitted
- `NEXT_PUBLIC_APP_URL` — Full URL of the deployed application (e.g., `https://msme-collections-app.onrender.com`)

### Render Web Service Settings
- **Environment:** Node
- **Build Command:** `npm install && npx prisma db push && npx prisma db seed && npm run build`
- **Start Command:** `npm run start`

---

## 3. Demo Credentials & Reviewer Walkthrough

### 3.1 Demo Accounts
| Role | Email | Password | Primary Scope |
| :--- | :--- | :--- | :--- |
| **Field Officer** | `officer@msmelender.in` | `Officer@123` | Peenya Beat (`560058`), 3-Tap Logging, AI Reminders |
| **Collections Manager** | `manager@msmelender.in` | `Manager@123` | Portfolio Oversight (`All Pincodes`), AI Escalation Queue |

*(Tip: You can use the **1-Click Reviewer Login** cards on the `/login` screen or the persistent bottom demo pill to switch roles instantly).*

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
   - Verify auto-captured GPS coordinates (`13.0285° N, 77.5197° E ±12m`).
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
   - In the bottom demo toolbar, switch role to **"Manager"**.
   - Review portfolio KPIs (Collectable Exposure, Collected Today, Broken PTPs).
   - Inspect the **AI Uncertainty & Escalation Queue** table and the immutable **Field Sync & Compliance Audit Log**.
