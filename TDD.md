# Technical Design Document (TDD)
## MSME Lender's Field Collections App with AI Prioritisation

- **Author:** Nishant Chhetri
- **GitHub Repository:** [https://github.com/nishant-chhetri/msme-collections-app](https://github.com/nishant-chhetri/msme-collections-app)
- **Live Demo Application:** [https://msme-collections-app.onrender.com](https://msme-collections-app.onrender.com)
- **Target OS Evaluation:** Cross-platform (Windows / Linux / macOS)
- **Submission Artifact:** `TDD.docx` + `deployment.md` bundled into `submission.zip`

---

## 1. Explicit Labelled Assumptions

To ensure predictable behavior across intermittent field connectivity and regulatory scrutiny, the system operates under eight explicit architectural and domain assumptions:

- **`[ASSUMPTION-01] RBI Mandatory Contact Window (08:00 - 19:00 IST)`:** In strict compliance with the Reserve Bank of India (RBI) Fair Practices Code for NBFCs and ARCs, all outbound borrower communication (phone calls, WhatsApp/SMS triggers) and in-person visit logging are strictly prohibited outside 08:00 to 19:00 Indian Standard Time (IST). The server acts as the final authoritative gatekeeper, rejecting any collection action outside this window with HTTP `403 COMPLIANCE_WINDOW_LOCKED`. A demo clock simulator header (`x-simulated-ist-hour`) allows evaluators to simulate both permitted and restricted hours on demand.
- **`[ASSUMPTION-02] Indian MSME Ticket Sizes & Currency Representation`:** MSME loan exposures are represented in integer **paise** (`1 INR = 100 paise`) across SQLite and Prisma schemas to eliminate IEEE-754 floating-point rounding errors during financial ledger reconciliation. Exposures in Bengaluru beats typically range from ₹1.5 Lakhs (micro-enterprises) to ₹10 Lakhs (precision machine shops and textile powerlooms).
- **`[ASSUMPTION-03] Offline-First Last-Write-Wins (LWW) & Client-Generated UUID Idempotency`:** Field officers frequently encounter connectivity blackouts in dense industrial basements (e.g., Peenya 3rd Phase) or metal-roofed APMC godowns (Yeshwanthpur). The client creates a deterministic UUIDv4 `idempotency_key` upon tapping "Save". Duplicate sync submissions resulting from flaky 4G retries are safely deduplicated on the server without creating ghost logs or duplicate ledger credits.
- **`[ASSUMPTION-04] TRAI DLT Pre-Approved Fallback Templates`:** Under Telecom Regulatory Authority of India (TRAI) Distributed Ledger Technology (DLT) regulations, financial collection messages sent over SMS/WhatsApp must match registered templates. If `GEMINI_API_KEY` is unavailable or external LLM APIs timeout, the app deterministically falls back to pre-approved bilingual templates, preventing field disruption.
- **`[ASSUMPTION-05] 2-Layer AI Communication Guardrails`:** AI-generated or officer-composed messages undergo dual validation:
  1. *Lexical Filter:* Blocking coercive, defamatory, or threatening keywords across English, Hindi, and Hinglish (e.g., `"police"`, `"jail"`, `"seize"`, `"auction"`, `"warrant"`, `"गिरफ्तार"`, `"जब्त"`).
  2. *Ledger Amount Integrity:* Any currency quote in the message must match the verified EMI or total exposure in paise. Hallucinated figures are flagged and sanitized before transmission.
- **`[ASSUMPTION-06] Geofencing & GPS Accuracy Tolerance`:** Field visits require auto-capturing device GPS coordinates with a target accuracy radius of $\le 25\text{m}$. Captured coordinates are persisted alongside a client device timestamp (`captured_at_device`) and a server receipt timestamp (`synced_at_server`) to audit sync latency.
- **`[ASSUMPTION-07] Role-Based Separation of Duties (RBAC)`:** Field Officers (`OFFICER`) can view assigned beat pincodes and log outcomes. Collections Managers (`MANAGER`) possess portfolio-wide oversight, can review the audit log, and are authorized to review and override AI uncertainty flags.
- **`[ASSUMPTION-08] Explainability as a Core Safety Mandate`:** Black-box ML scores are prohibited in recovery operations. Every AI score ($S_i \in [0, 100]$) is accompanied by the top 3 human-readable score drivers (DPD impact, broken promise ratio, and exposure weight).

---

## 2. Architecture & Tech Stack Rationale

### 2.1 Technology Selection Matrix

| Layer | Technology | Engineering Rationale |
| :--- | :--- | :--- |
| **Framework** | Next.js 14+ (App Router) | Single unified codebase for React Server Components, server actions, and REST API handlers; fast initial server render with minimal JS overhead. |
| **Language** | TypeScript 5 (Strict) | End-to-end type safety between Prisma database models, Zod API payloads, and React components. |
| **Styling** | Tailwind CSS | Mobile-first utility styling engineered for high-contrast sunlight readability; enforcement of minimum $48\text{px}$ touch targets. |
| **Database** | SQLite via Prisma ORM | Zero-config local evaluation (`file:./dev.db`) with zero external service dependencies; instant migration via `prisma db push`. |
| **Client Storage** | IndexedDB via `idb` | Structured transactional client-side storage for queuing offline outcome logs when 4G network drops in field beats. |
| **Unit Testing** | Vitest | High-speed, ESM-native unit testing verifying priority math, RBI compliance gates, guardrails, and idempotency logic in $<400\text{ms}$. |
| **Document Export** | `docx` + Node.js | Programmatic compilation of Markdown technical design documents into Word `.docx` submission format. |

### 2.2 Client-Server Synchronisation Topology

```
+-------------------------------------------------------------------------+
| FIELD OFFICER MOBILE CLIENT (Next.js PWA)                                |
|                                                                         |
|  [3-Tap Visit Drawer] ---> [Online?]                                    |
|                                |                                        |
|                     YES        |        NO (Offline Mode)               |
|                      v         v                                        |
|              POST /api/outcome   IndexedDB (outcome_queue)              |
|                      |                    |                             |
|                      |             [Reconnected]                        |
|                      |                    v                             |
|                      |          POST /api/sync/batch                    |
+----------------------|--------------------|-----------------------------+
                       |                    |
                       +--------+   +-------+
                                v   v
+-------------------------------------------------------------------------+
| SERVER REST API ENGINE                                                  |
|                                                                         |
|  1. RBI Time Gate (08:00 - 19:00 IST Check)                             |
|  2. Zod Schema Validation                                               |
|  3. Idempotency Check (idempotency_key lookup)                          |
|  4. Persist to SQLite (dev.db via Prisma)                               |
|  5. Priority Engine Score Recalculation                                 |
+-------------------------------------------------------------------------+
```

---

## 3. Data Model & Core System Flows

### 3.1 Entity Relationship Diagram & Schema

- **`User`**: `id`, `name`, `email` (Unique), `password_hash`, `role` (`OFFICER` | `MANAGER`), `assigned_pincode`, `created_at`, `updated_at`
- **`Loan`**: `id`, `account_number` (Unique), `borrower_name`, `owner_name`, `phone`, `business_type`, `outstanding_paise`, `emi_amount_paise`, `dpd`, `pincode`, `gps_lat`, `gps_lng`, `priority_score`, `priority_breakdown`, `ai_confidence` (`HIGH` | `LOW_CONFIDENCE` | `DISPUTE_HOLD`), `ai_uncertainty_reason`, `manual_override_score`, `manual_override_reason`, `assigned_officer_id`
- **`OutcomeLog`**: `id`, `idempotency_key` (Unique), `loan_id`, `officer_id`, `outcome_type` (`PAID` | `PTP` | `UNREACHABLE` | `DISPUTE` | `REFUSED`), `amount_collected_paise`, `notes`, `gps_lat`, `gps_lng`, `gps_accuracy_m`, `captured_at_device`, `synced_at_server`
- **`PromiseToPay`**: `id`, `loan_id`, `promised_amount_paise`, `promise_date`, `status` (`ACTIVE` | `BROKEN` | `FULFILLED`)

### 3.2 Step-by-Step Flow Traces

#### Flow A: 3-Tap Field Visit Logging
1. **Tap 1 (Status):** Officer selects borrower card on beat queue $\rightarrow$ selects one of 5 outcome chips: `PAID`, `PTP`, `UNREACHABLE`, `DISPUTE`, or `REFUSED`.
2. **Tap 2 (Context & Geotag):** Device auto-captures current GPS coordinates (`13.0285° N, 77.5197° E ±12m`). If `PAID`, officer inputs collected amount (with 1-click EMI chip); if `PTP`, sets date; if `DISPUTE`, selects dispute category chip.
3. **Tap 3 (Save):** Officer taps "Save Outcome". If online, requests `POST /api/loans/[id]/outcome`; if offline, saves into IndexedDB `outcome_queue`. UI updates optimistically.

#### Flow B: Offline Batch Sync
1. Field Officer logs 3 visits while in basement godown with no signal.
2. Visits are assigned unique client idempotency keys and queued in IndexedDB.
3. Upon returning to 4G coverage, officer taps "Flush Sync Queue" (or app detects online event).
4. `POST /api/sync/batch` transmits all queued records in a single payload.
5. Server deduplicates keys against SQLite: already-processed keys return duplicate receipts without re-applying ledger changes; new records are inserted and priority scores are recalculated.

#### Flow C: Manager AI Uncertainty & Dispute Override
1. Account flagged with `DISPUTE_HOLD` or `LOW_CONFIDENCE` appears on Manager Escalation Queue.
2. Manager reviews documented reason (e.g., GST invoice discrepancy).
3. Manager opens "Override AI Prioritisation" modal, inputs revised score (e.g., 55), documents resolution reason, and switches confidence to `HIGH`.
4. Account automatically returns to officer's actionable beat list with manager's audit trail attached.

---

## 4. AI Prioritisation, Explainability & Uncertainty Handling

### 4.1 Mathematical Scoring Formula

The AI engine computes a deterministic composite Priority Score $S_i \in [0, 100]$:

$$S_i = 0.40 \cdot \hat{D}_i + 0.30 \cdot \hat{V}_i + 0.30 \cdot \hat{B}_i$$

Where:
- **Normalized Days Past Due ($\hat{D}_i$):**
  $$\hat{D}_i = \frac{\min(\text{DPD}_i, 90)}{90} \times 100$$
  Capped at 90 days to avoid disproportionately weighting uncollectable write-offs over actionable 30–60 DPD accounts.
- **Log-Normalized Outstanding Exposure ($\hat{V}_i$):**
  $$\hat{V}_i = \frac{\ln(V_i) - \ln(V_{\min})}{\ln(V_{\max}) - \ln(V_{\min})} \times 100$$
  Normalized across reference exposure bounds ($V_{\min} = ₹10,000$ to $V_{\max} = ₹10,00,000$). Log transformation prevents high-ticket loans from eclipsing volume micro-loans.
- **Broken Promise Ratio ($\hat{B}_i$):**
  $$\hat{B}_i = \min(100, (2 \times \text{Broken}_{<30d} + 1 \times \text{Broken}_{\ge 30d}) \times 25)$$
  Promises broken within the last 30 days receive double weight, penalizing repeated unfulfilled commitments.

### 4.2 When AI is Wrong or Unsure: Human-in-the-Loop Fallbacks

Per the core assessment criteria, the system recognizes its own limitations and proactively flags uncertainty:
1. **Unresolved Dispute (`DISPUTE_HOLD`):** Any borrower who registers a dispute (e.g., invoice discrepancy or defective stock return) is immediately frozen from automated routing. Sending recovery agents to dispute cases causes customer harassment claims and legal liability.
2. **Signal Conflict (`LOW_CONFIDENCE`):** Triggered when an account exhibits high DPD (>45 days) but 0 broken promises and voluntary partial payments, or when DPD >60 days but zero historical visits exist.
3. **Escalation Protocol:** Accounts flagged with uncertainty require documented human review before being routed on an officer's daily beat.

### 4.3 2-Layer Communication Guardrails

The reminder generator combines Google Gemini (with DLT-template instant fallback) with strict deterministic safety filters:
- **Layer 1 (Coercive Lexicon Filter):** Blocks intimidating vocabulary (`police`, `jail`, `seize`, `auction`, `warrant`, `defaulter`, `गिरफ्तार`, `जब्त`, `पुलिस`). Prohibited terms are automatically stripped and replaced with compliant neutral phrases.
- **Layer 2 (Hallucinated Amount Check):** Extracts all currency numbers and verifies them against the verified ledger EMI or outstanding exposure. Unmatched figures are rejected and sanitized.

---

## 5. UI & Outdoor Usability Decisions

1. **Sunlight-Readable High-Contrast Palette:** Pure whites, deep slate-900 typography, and bold emerald/amber/rose status chips ensure readability under bright midday Bengaluru sunlight.
2. **Strict $48\text{px}$ Touch Targets:** Field officers operate single-handed while riding two-wheelers or standing in noisy factory gates. All interactive controls enforce minimum $48\text{px}$ tap targets.
3. **Zero Dead Buttons:** Every button, tab, search bar, and filter chip is bound to live reactive state and server/IndexedDB persistence.
4. **Persistent Demo Toolbar:** Evaluators can toggle between Officer and Manager roles, switch between Online and Offline IndexedDB modes, and toggle the RBI Clock (14:30 IST vs. 20:45 IST) in a single click.

---

## 6. Honest Limits, Scope Cuts & V2 Roadmap

### 6.1 Intentional 7-Day Scope Cuts
- **Direct WhatsApp BSP (Business Solution Provider) Integration:** Live WhatsApp Business API requires Meta enterprise verification and per-template credit card billing. Replaced with pre-filled WhatsApp deep-links (`https://wa.me/?text=...`) which work directly on officer mobile devices without third-party telecom costs.
- **Dynamic BharatQR Payment Webhook:** Live UPI dynamic QR generation requires NPCI merchant KYC registration. Replaced with structured cash and UPI collection recording with paper receipt tracking.

### 6.2 Production V2 Roadmap
- **DPDP Act 2023 Compliance:** Encrypt IndexedDB offline caches at rest using WebCrypto AES-GCM 256-bit keys derived from biometric device auth.
- **OSRM Traveling Salesperson Routing:** Integrate open-source routing to calculate optimal multi-stop motorcycle routes minimizing Bengaluru traffic congestion across Peenya and Yeshwanthpur beats.
