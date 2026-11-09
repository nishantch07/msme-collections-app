# MSME Field Collections

A mobile-first collections workflow prototype for field officers and branch managers. It replaces spreadsheet/WhatsApp coordination with a prioritised work queue, offline visit logging, promise tracking, CSV refreshes, and portfolio reporting.

## What is included

- Officer queue with advisory priority scores and human-readable reasons.
- CSV import, pincode/workload assignment, an operations-provided branch master, and import snapshots.
- GPS-backed visit outcomes and an AES-GCM encrypted IndexedDB queue for weak-signal use.
- Promise-to-pay tracking, contact-attempt audit records, and manager roll-rate views.
- Hindi/English reminder previews; an officer must review and confirm any demo WhatsApp action manually. Production WhatsApp remains blocked until an approved DLT template and provider integration exist.
- Contact controls that block the 08:00–19:00 IST window boundaries correctly; production uses server time.

## Run locally

Requirements: Node.js 20+ and npm.

```powershell
npm install
npx prisma db push
npx prisma db seed
npm test
npm run lint
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Demo accounts and role/network/time simulators are available only in the development build. The seed command is destructive and refuses to run when `NODE_ENV=production`.

The sample overdue file is [sample-data/overdue-indore.csv](./sample-data/overdue-indore.csv).

## Safety and deployment status

This is an assessed prototype, **not approved for real borrower data or production recovery operations**. A separate Neon/PostgreSQL schema and initial migration, Render deployment commands, Upstash distributed rate limits, readiness checks, and encrypted offline queue are included. Live use still requires validated branch data, legally approved privacy/retention processes, provider-backed registered messaging, backup/restore drills, monitoring and incident response, and low-end device/lost-device validation. `/api/readiness` intentionally remains blocked until operational release gates are satisfied. See [deployment.md](./deployment.md) for setup and limitations.

Do not treat AI scores as decisions or sendable AI-generated content. Scores are advisory; contact requires an officer action.
