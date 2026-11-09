import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { calculatePriorityScore } from '../src/lib/priority-engine';

const prisma = new PrismaClient();

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('The destructive demo seed is disabled in production.');
  }
  console.log('🌱 Starting database seed...');

  // Clean existing tables (in reverse foreign key order)
  await prisma.outcomeLog.deleteMany({});
  await prisma.contactAttempt.deleteMany({});
  await prisma.loanScoreSnapshot.deleteMany({});
  await prisma.promiseToPay.deleteMany({});
  await prisma.importBatch.deleteMany({});
  await prisma.loan.deleteMany({});
  await prisma.user.deleteMany({});

  // 1. Seed Users
  const officerHash = await bcrypt.hash('Officer@123', 10);
  const managerHash = await bcrypt.hash('Manager@123', 10);

  const officer = await prisma.user.create({
    data: {
      name: 'Ramesh Kumar',
      email: 'officer@msmelender.in',
      password_hash: officerHash,
      role: 'OFFICER',
      assigned_pincode: '560058', // Peenya Beat
    },
  });

  const manager = await prisma.user.create({
    data: {
      name: 'Priya Nair',
      email: 'manager@msmelender.in',
      password_hash: managerHash,
      role: 'MANAGER',
      assigned_pincode: 'ALL',
    },
  });

  const indoreOfficers = await Promise.all([
    prisma.user.create({
      data: {
        name: 'Rahul Chouhan',
        email: 'rahul@msmelender.in',
        password_hash: officerHash,
        role: 'OFFICER',
        assigned_pincode: '452001',
      },
    }),
    prisma.user.create({
      data: {
        name: 'Neha Solanki',
        email: 'neha@msmelender.in',
        password_hash: officerHash,
        role: 'OFFICER',
        assigned_pincode: '452001',
      },
    }),
    prisma.user.create({
      data: {
        name: 'Imran Qureshi',
        email: 'imran@msmelender.in',
        password_hash: officerHash,
        role: 'OFFICER',
        assigned_pincode: '452001',
      },
    }),
  ]);

  console.log(`✅ Seeded users: Officer (${officer.email}), Manager (${manager.email}), 3 Indore officers.`);

  // 2. Define 18 Realistic Bengaluru MSME Borrowers
  const loansData = [
    // --- 560058: Peenya Industrial Area (Officer Ramesh's primary beat) ---
    {
      account_number: 'BLR-MSME-2024-001',
      borrower_name: 'Peenya CNC Precision Works',
      owner_name: 'H. S. Venkatesh',
      phone: '+91 98450 12041',
      business_type: 'Precision Machining & Auto Spares',
      outstanding_paise: 48500000, // ₹4,85,000
      emi_amount_paise: 4200000,   // ₹42,000
      dpd: 78,
      pincode: '560058',
      gps_lat: 13.0285,
      gps_lng: 77.5197,
      priority_score: 88.5,
      priority_breakdown: JSON.stringify([
        '78 DPD (+34.7 pts)',
        '3 Broken PTPs (+30.0 pts)',
        '₹4.85L Exposure (+23.8 pts)',
      ]),
      ai_confidence: 'HIGH',
      ai_uncertainty_reason: null,
      assigned_officer_id: officer.id,
    },
    {
      account_number: 'BLR-MSME-2024-002',
      borrower_name: 'Balaji Packaging Solutions',
      owner_name: 'K. Balakrishna',
      phone: '+91 98451 98234',
      business_type: 'Corrugated Box & Carton Printing',
      outstanding_paise: 32000000, // ₹3,20,000
      emi_amount_paise: 2800000,   // ₹28,000
      dpd: 52,
      pincode: '560058',
      gps_lat: 13.0312,
      gps_lng: 77.5142,
      priority_score: 72.0,
      priority_breakdown: JSON.stringify([
        '52 DPD (+23.1 pts)',
        'Invoice Dispute (+28.0 pts)',
        '₹3.20L Exposure (+20.9 pts)',
      ]),
      ai_confidence: 'DISPUTE_HOLD',
      ai_uncertainty_reason: 'Unresolved dispute: Borrower claims ₹64k GST billing discrepancy and returned defective consignments. Automated escalation frozen for manager audit.',
      assigned_officer_id: officer.id,
    },
    {
      account_number: 'BLR-MSME-2024-003',
      borrower_name: 'Karnataka Auto Components',
      owner_name: 'Suresh Babu',
      phone: '+91 94481 55210',
      business_type: 'Sheet Metal Fabrication & Stamping',
      outstanding_paise: 65000000, // ₹6,50,000
      emi_amount_paise: 5500000,   // ₹55,000
      dpd: 84,
      pincode: '560058',
      gps_lat: 13.0354,
      gps_lng: 77.5218,
      priority_score: 93.4,
      priority_breakdown: JSON.stringify([
        '84 DPD (+37.3 pts)',
        '4 Broken PTPs (+30.0 pts)',
        '₹6.50L High Exposure (+26.1 pts)',
      ]),
      ai_confidence: 'HIGH',
      ai_uncertainty_reason: null,
      assigned_officer_id: officer.id,
    },
    {
      account_number: 'BLR-MSME-2024-004',
      borrower_name: 'Sri Manjunatha Fabrication Works',
      owner_name: 'Manjunath Gowda',
      phone: '+91 97312 44389',
      business_type: 'Industrial Grills & Gate Fabrication',
      outstanding_paise: 19500000, // ₹1,95,000
      emi_amount_paise: 1800000,   // ₹18,000
      dpd: 41,
      pincode: '560058',
      gps_lat: 13.0249,
      gps_lng: 77.5181,
      priority_score: 61.2,
      priority_breakdown: JSON.stringify([
        '41 DPD (+18.2 pts)',
        '1 Broken PTP (+24.0 pts)',
        '₹1.95L Exposure (+19.0 pts)',
      ]),
      ai_confidence: 'HIGH',
      ai_uncertainty_reason: null,
      assigned_officer_id: officer.id,
    },
    {
      account_number: 'BLR-MSME-2024-005',
      borrower_name: 'Sapthagiri Plastic Moulding Ltd',
      owner_name: 'C. N. Chandrashekar',
      phone: '+91 98860 33190',
      business_type: 'Injection Moulded Industrial Spares',
      outstanding_paise: 54000000, // ₹5,40,000
      emi_amount_paise: 4800000,   // ₹48,000
      dpd: 65,
      pincode: '560058',
      gps_lat: 13.0381,
      gps_lng: 77.5245,
      priority_score: 81.5,
      priority_breakdown: JSON.stringify([
        '65 DPD (+28.9 pts)',
        '2 Broken PTPs (+27.0 pts)',
        '₹5.40L Exposure (+25.6 pts)',
      ]),
      ai_confidence: 'HIGH',
      ai_uncertainty_reason: null,
      assigned_officer_id: officer.id,
    },
    {
      account_number: 'BLR-MSME-2024-006',
      borrower_name: 'Cauvery Metal Works',
      owner_name: 'R. Somasundaram',
      phone: '+91 94480 77123',
      business_type: 'Brass & Bronze Hardware Casting',
      outstanding_paise: 38000000, // ₹3,80,000
      emi_amount_paise: 3500000,   // ₹35,000
      dpd: 68,
      pincode: '560058',
      gps_lat: 13.0298,
      gps_lng: 77.5123,
      priority_score: 64.5,
      priority_breakdown: JSON.stringify([
        '68 DPD (+30.2 pts)',
        'Signal Conflict (-15.0 pts)',
        '₹3.80L Exposure (+22.1 pts)',
      ]),
      ai_confidence: 'LOW_CONFIDENCE',
      ai_uncertainty_reason: 'Conflicting signal: 68 DPD but borrower made 2 voluntary partial UPI transfers in last 20 days; unvisited for 45 days. Needs officer field audit.',
      assigned_officer_id: officer.id,
    },

    // --- 560022: Yeshwanthpur Industrial Suburb & APMC Market ---
    {
      account_number: 'BLR-MSME-2024-007',
      borrower_name: 'Sri Lakshmi Kirana Wholesale',
      owner_name: 'N. Ravikumar',
      phone: '+91 98452 78100',
      business_type: 'APMC Grain & Pulses Wholesaler',
      outstanding_paise: 72000000, // ₹7,20,000
      emi_amount_paise: 6200000,   // ₹62,000
      dpd: 89,
      pincode: '560022',
      gps_lat: 13.0189,
      gps_lng: 77.5452,
      priority_score: 95.8,
      priority_breakdown: JSON.stringify([
        '89 DPD (+39.5 pts)',
        '4 Broken PTPs (+30.0 pts)',
        '₹7.20L High Exposure (+26.3 pts)',
      ]),
      ai_confidence: 'HIGH',
      ai_uncertainty_reason: null,
      assigned_officer_id: officer.id,
    },
    {
      account_number: 'BLR-MSME-2024-008',
      borrower_name: 'Bangalore Spices & Agro Trading',
      owner_name: 'M. Anand',
      phone: '+91 94490 11984',
      business_type: 'Cardamom & Pepper Processing',
      outstanding_paise: 44000000, // ₹4,40,000
      emi_amount_paise: 3800000,   // ₹38,000
      dpd: 58,
      pincode: '560022',
      gps_lat: 13.0221,
      gps_lng: 77.5410,
      priority_score: 68.0,
      priority_breakdown: JSON.stringify([
        '58 DPD (+25.8 pts)',
        'Formal Dispute (+26.0 pts)',
        '₹4.40L Exposure (+23.2 pts)',
      ]),
      ai_confidence: 'DISPUTE_HOLD',
      ai_uncertainty_reason: 'Dispute logged: Owner claims flood water damage in APMC godown and applied for formal insurance settlement restructuring. Recovery visits held.',
      assigned_officer_id: officer.id,
    },
    {
      account_number: 'BLR-MSME-2024-009',
      borrower_name: 'National Print & Pack Industries',
      owner_name: 'Pradeep Shenoy',
      phone: '+91 98800 66291',
      business_type: 'Commercial Label & Offset Printing',
      outstanding_paise: 27500000, // ₹2,75,000
      emi_amount_paise: 2500000,   // ₹25,000
      dpd: 38,
      pincode: '560022',
      gps_lat: 13.0165,
      gps_lng: 77.5489,
      priority_score: 55.4,
      priority_breakdown: JSON.stringify([
        '38 DPD (+16.9 pts)',
        '1 Broken PTP (+20.0 pts)',
        '₹2.75L Exposure (+18.5 pts)',
      ]),
      ai_confidence: 'HIGH',
      ai_uncertainty_reason: null,
      assigned_officer_id: officer.id,
    },
    {
      account_number: 'BLR-MSME-2024-010',
      borrower_name: 'Sri Krishna Bakery & Sweets Unit',
      owner_name: 'G. K. Bhat',
      phone: '+91 97400 55182',
      business_type: 'Commercial Bakery & Rusk Unit',
      outstanding_paise: 21000000, // ₹2,10,000
      emi_amount_paise: 1900000,   // ₹19,000
      dpd: 46,
      pincode: '560022',
      gps_lat: 13.0245,
      gps_lng: 77.5432,
      priority_score: 62.7,
      priority_breakdown: JSON.stringify([
        '46 DPD (+20.4 pts)',
        '2 Broken PTPs (+25.0 pts)',
        '₹2.10L Exposure (+17.3 pts)',
      ]),
      ai_confidence: 'HIGH',
      ai_uncertainty_reason: null,
      assigned_officer_id: officer.id,
    },
    {
      account_number: 'BLR-MSME-2024-011',
      borrower_name: 'Anand Electronics & Hardware Hub',
      owner_name: 'Anand Kumar Jain',
      phone: '+91 98440 22319',
      business_type: 'Electrical Cables & Switchgear Retail',
      outstanding_paise: 36000000, // ₹3,60,000
      emi_amount_paise: 3200000,   // ₹32,000
      dpd: 71,
      pincode: '560022',
      gps_lat: 13.0195,
      gps_lng: 77.5385,
      priority_score: 83.2,
      priority_breakdown: JSON.stringify([
        '71 DPD (+31.5 pts)',
        '3 Broken PTPs (+29.0 pts)',
        '₹3.60L Exposure (+22.7 pts)',
      ]),
      ai_confidence: 'HIGH',
      ai_uncertainty_reason: null,
      assigned_officer_id: officer.id,
    },
    {
      account_number: 'BLR-MSME-2024-012',
      borrower_name: 'Deccan Engineering Works',
      owner_name: 'Mohammed Mansoor',
      phone: '+91 99000 88210',
      business_type: 'Hydraulic Press & Pump Servicing',
      outstanding_paise: 51000000, // ₹5,10,000
      emi_amount_paise: 4500000,   // ₹45,000
      dpd: 82,
      pincode: '560022',
      gps_lat: 13.0270,
      gps_lng: 77.5460,
      priority_score: 69.8,
      priority_breakdown: JSON.stringify([
        '82 DPD (+36.4 pts)',
        'Zero Broken PTPs (-12.0 pts)',
        '₹5.10L Exposure (+25.4 pts)',
      ]),
      ai_confidence: 'LOW_CONFIDENCE',
      ai_uncertainty_reason: 'Conflicting signal: High 82 DPD but zero prior broken PTPs and 100% spotless payment history before sudden non-response. Manager review recommended.',
      assigned_officer_id: officer.id,
    },

    // --- 560053: Chickpet Commercial / Wholesale District ---
    {
      account_number: 'BLR-MSME-2024-013',
      borrower_name: 'Chickpet Silks & Powerloom Co',
      owner_name: 'L. Rameshwar',
      phone: '+91 98453 99012',
      business_type: 'Pure Silk Sarees & Wholesale Fabrics',
      outstanding_paise: 85000000, // ₹8,50,000
      emi_amount_paise: 7500000,   // ₹75,000
      dpd: 76,
      pincode: '560053',
      gps_lat: 12.9698,
      gps_lng: 77.5752,
      priority_score: 91.2,
      priority_breakdown: JSON.stringify([
        '76 DPD (+33.8 pts)',
        '3 Broken PTPs (+30.0 pts)',
        '₹8.50L High Exposure (+27.4 pts)',
      ]),
      ai_confidence: 'HIGH',
      ai_uncertainty_reason: null,
      assigned_officer_id: officer.id,
    },
    {
      account_number: 'BLR-MSME-2024-014',
      borrower_name: 'Rajalakshmi Textiles & Apparels',
      owner_name: 'V. Sundaramurthy',
      phone: '+91 94482 33451',
      business_type: 'Cotton Shirting & Dhotis Wholesale',
      outstanding_paise: 42000000, // ₹4,20,000
      emi_amount_paise: 3700000,   // ₹37,000
      dpd: 49,
      pincode: '560053',
      gps_lat: 12.9682,
      gps_lng: 77.5768,
      priority_score: 66.8,
      priority_breakdown: JSON.stringify([
        '49 DPD (+21.8 pts)',
        '2 Broken PTPs (+26.0 pts)',
        '₹4.20L Exposure (+22.8 pts)',
      ]),
      ai_confidence: 'HIGH',
      ai_uncertainty_reason: null,
      assigned_officer_id: officer.id,
    },
    {
      account_number: 'BLR-MSME-2024-015',
      borrower_name: 'Nandi Dyeing & Printing Works',
      owner_name: 'G. Nagaraj',
      phone: '+91 98802 77119',
      business_type: 'Yarn Dyeing & Screen Printing',
      outstanding_paise: 31000000, // ₹3,10,000
      emi_amount_paise: 2900000,   // ₹29,000
      dpd: 59,
      pincode: '560053',
      gps_lat: 12.9715,
      gps_lng: 77.5739,
      priority_score: 75.3,
      priority_breakdown: JSON.stringify([
        '59 DPD (+26.2 pts)',
        '2 Broken PTPs (+28.0 pts)',
        '₹3.10L Exposure (+21.1 pts)',
      ]),
      ai_confidence: 'HIGH',
      ai_uncertainty_reason: null,
      assigned_officer_id: officer.id,
    },
    {
      account_number: 'BLR-MSME-2024-016',
      borrower_name: 'Venkateshwara Electricals & Rewinding',
      owner_name: 'K. V. Srinivas',
      phone: '+91 97390 12845',
      business_type: 'Motor Rewinding & Copper Wire Sales',
      outstanding_paise: 24000000, // ₹2,40,000
      emi_amount_paise: 2200000,   // ₹22,000
      dpd: 33,
      pincode: '560053',
      gps_lat: 12.9670,
      gps_lng: 77.5780,
      priority_score: 48.9,
      priority_breakdown: JSON.stringify([
        '33 DPD (+14.7 pts)',
        '1 Broken PTP (+18.0 pts)',
        '₹2.40L Exposure (+16.2 pts)',
      ]),
      ai_confidence: 'HIGH',
      ai_uncertainty_reason: null,
      assigned_officer_id: officer.id,
    },
    {
      account_number: 'BLR-MSME-2024-017',
      borrower_name: 'Annapurna Food Products & Flour Mill',
      owner_name: 'B. S. Girish',
      phone: '+91 94498 66100',
      business_type: 'Chakkis, Spices & Food Processing',
      outstanding_paise: 16500000, // ₹1,65,000
      emi_amount_paise: 1500000,   // ₹15,000
      dpd: 26,
      pincode: '560053',
      gps_lat: 12.9730,
      gps_lng: 77.5721,
      priority_score: 39.4,
      priority_breakdown: JSON.stringify([
        '26 DPD (+11.5 pts)',
        '0 Broken PTP (+15.0 pts)',
        '₹1.65L Exposure (+12.9 pts)',
      ]),
      ai_confidence: 'HIGH',
      ai_uncertainty_reason: null,
      assigned_officer_id: officer.id,
    },
    {
      account_number: 'BLR-MSME-2024-018',
      borrower_name: 'Mysore Sandal Handicrafts & Timber',
      owner_name: 'D. M. Jayaram',
      phone: '+91 98455 33880',
      business_type: 'Wood Carving, Inlay Art & Handicrafts',
      outstanding_paise: 39000000, // ₹3,90,000
      emi_amount_paise: 3400000,   // ₹34,000
      dpd: 63,
      pincode: '560053',
      gps_lat: 12.9655,
      gps_lng: 77.5794,
      priority_score: 77.8,
      priority_breakdown: JSON.stringify([
        '63 DPD (+28.0 pts)',
        '2 Broken PTPs (+27.0 pts)',
        '₹3.90L Exposure (+22.8 pts)',
      ]),
      ai_confidence: 'HIGH',
      ai_uncertainty_reason: null,
      assigned_officer_id: officer.id,
    },
  ];

  loansData.push(
    {
      account_number: 'LN-10293',
      borrower_name: 'Company B (packaging unit)',
      owner_name: 'Company B',
      phone: '',
      business_type: 'Packaging',
      outstanding_paise: 64000000,
      emi_amount_paise: 6400000,
      dpd: 12,
      pincode: '452001',
      gps_lat: 22.7196,
      gps_lng: 75.8577,
      priority_score: 0,
      priority_breakdown: '[]',
      ai_confidence: 'HIGH',
      ai_uncertainty_reason: null,
      assigned_officer_id: indoreOfficers[0].id,
    },
    {
      account_number: 'LN-10871',
      borrower_name: 'Company C (fertiliser shop)',
      owner_name: 'Company C',
      phone: '',
      business_type: 'Fertiliser trading',
      outstanding_paise: 31000000,
      emi_amount_paise: 3100000,
      dpd: 27,
      pincode: '452001',
      gps_lat: 22.7196,
      gps_lng: 75.8577,
      priority_score: 0,
      priority_breakdown: '[]',
      ai_confidence: 'HIGH',
      ai_uncertainty_reason: null,
      assigned_officer_id: indoreOfficers[1].id,
    },
    {
      account_number: 'LN-11930',
      borrower_name: 'Company D (printing press)',
      owner_name: 'Company D',
      phone: '',
      business_type: 'Printing',
      outstanding_paise: 22000000,
      emi_amount_paise: 2200000,
      dpd: 19,
      pincode: '452001',
      gps_lat: 22.7196,
      gps_lng: 75.8577,
      priority_score: 0,
      priority_breakdown: '[]',
      ai_confidence: 'HIGH',
      ai_uncertainty_reason: null,
      assigned_officer_id: indoreOfficers[2].id,
    },
  );

  const createdLoans = [];
  for (const loanData of loansData) {
    const samplePromiseDate = loanData.account_number === 'LN-10293'
      ? new Date('2026-11-05T00:00:00.000Z')
      : loanData.account_number === 'LN-11930'
        ? new Date('2026-10-31T00:00:00.000Z')
        : null;
    const score = loanData.account_number.startsWith('LN-')
      ? calculatePriorityScore({
          dpd: loanData.dpd,
          outstanding_paise: loanData.outstanding_paise,
          emi_amount_paise: loanData.emi_amount_paise,
          promises: samplePromiseDate
            ? [{ status: 'BROKEN', promise_date: samplePromiseDate }]
            : [],
        })
      : null;
    const loan = await prisma.loan.create({
      data: score
        ? {
            ...loanData,
            priority_score: score.priorityScore,
            priority_breakdown: JSON.stringify(score.topBadges),
            ai_confidence: score.aiConfidence,
            ai_uncertainty_reason: score.aiUncertaintyReason,
          }
        : loanData,
    });
    createdLoans.push(loan);
  }
  console.log(`✅ Seeded ${createdLoans.length} demo MSME loans across Bengaluru and Indore.`);

  // 3. Seed Historical PromiseToPay and OutcomeLogs
  // Borrowers with broken promises:
  const peenyaCnc = createdLoans.find((l) => l.account_number === 'BLR-MSME-2024-001')!;
  const balajiPkg = createdLoans.find((l) => l.account_number === 'BLR-MSME-2024-002')!;
  const karnatakaAuto = createdLoans.find((l) => l.account_number === 'BLR-MSME-2024-003')!;
  const apmcWholesale = createdLoans.find((l) => l.account_number === 'BLR-MSME-2024-007')!;
  const chickpetSilks = createdLoans.find((l) => l.account_number === 'BLR-MSME-2024-013')!;

  // Historical PTPs
  await prisma.promiseToPay.createMany({
    data: [
      {
        loan_id: peenyaCnc.id,
        promised_amount_paise: 4200000,
        promise_date: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000),
        status: 'BROKEN',
      },
      {
        loan_id: peenyaCnc.id,
        promised_amount_paise: 3000000,
        promise_date: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
        status: 'BROKEN',
      },
      {
        loan_id: karnatakaAuto.id,
        promised_amount_paise: 5500000,
        promise_date: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
        status: 'BROKEN',
      },
      {
        loan_id: karnatakaAuto.id,
        promised_amount_paise: 5000000,
        promise_date: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
        status: 'BROKEN',
      },
      {
        loan_id: apmcWholesale.id,
        promised_amount_paise: 6200000,
        promise_date: new Date(Date.now() - 12 * 24 * 60 * 60 * 1000),
        status: 'BROKEN',
      },
      {
        loan_id: chickpetSilks.id,
        promised_amount_paise: 7500000,
        promise_date: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        status: 'BROKEN',
      },
      {
        loan_id: chickpetSilks.id,
        promised_amount_paise: 4000000,
        promise_date: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
        status: 'ACTIVE',
      },
      {
        loan_id: createdLoans.find((loan) => loan.account_number === 'LN-10293')!.id,
        promised_amount_paise: 6400000,
        promise_date: new Date('2026-11-05T00:00:00.000Z'),
        status: 'BROKEN',
      },
      {
        loan_id: createdLoans.find((loan) => loan.account_number === 'LN-11930')!.id,
        promised_amount_paise: 2200000,
        promise_date: new Date('2026-10-31T00:00:00.000Z'),
        status: 'BROKEN',
      },
    ],
  });

  // Historical OutcomeLogs
  await prisma.outcomeLog.createMany({
    data: [
      {
        idempotency_key: 'seed-log-001',
        loan_id: peenyaCnc.id,
        officer_id: officer.id,
        outcome_type: 'PTP',
        amount_collected_paise: 0,
        notes: 'Met owner Venkatesh at factory gate. Promised ₹42k by 5th Nov via NEFT; delayed client receivables cited.',
        gps_lat: 13.0285,
        gps_lng: 77.5197,
        gps_accuracy_m: 8.5,
        captured_at_device: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000),
        synced_at_server: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000),
      },
      {
        idempotency_key: 'seed-log-002',
        loan_id: balajiPkg.id,
        officer_id: officer.id,
        outcome_type: 'DISPUTE',
        amount_collected_paise: 0,
        notes: 'Owner raised GST invoice mismatch dispute regarding 20% returned packaging lots. Requested revised ledger from central operations before paying.',
        gps_lat: 13.0312,
        gps_lng: 77.5142,
        gps_accuracy_m: 11.2,
        captured_at_device: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
        synced_at_server: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      },
      {
        idempotency_key: 'seed-log-003',
        loan_id: karnatakaAuto.id,
        officer_id: officer.id,
        outcome_type: 'UNREACHABLE',
        amount_collected_paise: 0,
        notes: 'Factory shutter locked. Watchman reported owner travelled to Hosur ancillary cluster until weekend.',
        gps_lat: 13.0354,
        gps_lng: 77.5218,
        gps_accuracy_m: 14.0,
        captured_at_device: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
        synced_at_server: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
      },
      {
        idempotency_key: 'seed-log-004',
        loan_id: apmcWholesale.id,
        officer_id: officer.id,
        outcome_type: 'PAID',
        amount_collected_paise: 1500000, // ₹15,000 partial collection
        notes: 'Owner paid ₹15,000 cash against pending EMI. Issued formal paper receipt #4891; promised balance next week.',
        gps_lat: 13.0189,
        gps_lng: 77.5452,
        gps_accuracy_m: 6.2,
        captured_at_device: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
        synced_at_server: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
      },
    ],
  });

  console.log('✅ Seeded historical OutcomeLogs and PromiseToPay records.');
  console.log('✨ Database seeding complete successfully.');
}

main()
  .catch((e) => {
    console.error('❌ Error during seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
