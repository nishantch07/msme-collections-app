-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "assigned_pincode" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Branch" (
    "id" TEXT NOT NULL,
    "branch_code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Branch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BranchPincode" (
    "pincode" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BranchPincode_pkey" PRIMARY KEY ("pincode")
);

-- CreateTable
CREATE TABLE "Loan" (
    "id" TEXT NOT NULL,
    "account_number" TEXT NOT NULL,
    "borrower_name" TEXT NOT NULL,
    "owner_name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "business_type" TEXT NOT NULL,
    "outstanding_paise" INTEGER NOT NULL,
    "emi_amount_paise" INTEGER NOT NULL,
    "dpd" INTEGER NOT NULL,
    "pincode" TEXT NOT NULL,
    "gps_lat" DOUBLE PRECISION,
    "gps_lng" DOUBLE PRECISION,
    "priority_score" DOUBLE PRECISION NOT NULL,
    "priority_breakdown" TEXT NOT NULL,
    "ai_confidence" TEXT NOT NULL,
    "ai_uncertainty_reason" TEXT,
    "manual_override_score" DOUBLE PRECISION,
    "manual_override_reason" TEXT,
    "assigned_officer_id" TEXT,
    "branch_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Loan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutcomeLog" (
    "id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "payload_hash" TEXT,
    "loan_id" TEXT NOT NULL,
    "officer_id" TEXT NOT NULL,
    "outcome_type" TEXT NOT NULL,
    "amount_collected_paise" INTEGER,
    "notes" TEXT NOT NULL,
    "gps_lat" DOUBLE PRECISION NOT NULL,
    "gps_lng" DOUBLE PRECISION NOT NULL,
    "gps_accuracy_m" DOUBLE PRECISION NOT NULL,
    "captured_at_device" TIMESTAMP(3) NOT NULL,
    "synced_at_server" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutcomeLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromiseToPay" (
    "id" TEXT NOT NULL,
    "loan_id" TEXT NOT NULL,
    "promised_amount_paise" INTEGER NOT NULL,
    "promise_date" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromiseToPay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactAttempt" (
    "id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "loan_id" TEXT NOT NULL,
    "officer_id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "attempted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ist_time" TEXT NOT NULL,
    "gps_lat" DOUBLE PRECISION,
    "gps_lng" DOUBLE PRECISION,
    "details" TEXT,

    CONSTRAINT "ContactAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "imported_by" TEXT NOT NULL,
    "imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rows_received" INTEGER NOT NULL,
    "rows_created" INTEGER NOT NULL,
    "rows_updated" INTEGER NOT NULL,
    "rows_rejected" INTEGER NOT NULL,

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoanScoreSnapshot" (
    "id" TEXT NOT NULL,
    "loan_id" TEXT NOT NULL,
    "import_batch_id" TEXT NOT NULL,
    "pincode" TEXT NOT NULL,
    "branch_code" TEXT,
    "branch_name" TEXT,
    "dpd" INTEGER NOT NULL,
    "outstanding_paise" INTEGER NOT NULL,
    "priority_score" DOUBLE PRECISION NOT NULL,
    "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoanScoreSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Branch_branch_code_key" ON "Branch"("branch_code");

-- CreateIndex
CREATE INDEX "BranchPincode_branch_id_idx" ON "BranchPincode"("branch_id");

-- CreateIndex
CREATE UNIQUE INDEX "Loan_account_number_key" ON "Loan"("account_number");

-- CreateIndex
CREATE INDEX "Loan_assigned_officer_id_priority_score_idx" ON "Loan"("assigned_officer_id", "priority_score");

-- CreateIndex
CREATE INDEX "Loan_pincode_dpd_idx" ON "Loan"("pincode", "dpd");

-- CreateIndex
CREATE UNIQUE INDEX "OutcomeLog_idempotency_key_key" ON "OutcomeLog"("idempotency_key");

-- CreateIndex
CREATE INDEX "OutcomeLog_loan_id_captured_at_device_idx" ON "OutcomeLog"("loan_id", "captured_at_device");

-- CreateIndex
CREATE INDEX "PromiseToPay_status_promise_date_idx" ON "PromiseToPay"("status", "promise_date");

-- CreateIndex
CREATE UNIQUE INDEX "ContactAttempt_idempotency_key_key" ON "ContactAttempt"("idempotency_key");

-- CreateIndex
CREATE INDEX "ContactAttempt_attempted_at_idx" ON "ContactAttempt"("attempted_at");

-- CreateIndex
CREATE INDEX "LoanScoreSnapshot_captured_at_pincode_idx" ON "LoanScoreSnapshot"("captured_at", "pincode");

-- CreateIndex
CREATE INDEX "LoanScoreSnapshot_loan_id_captured_at_idx" ON "LoanScoreSnapshot"("loan_id", "captured_at");

-- CreateIndex
CREATE INDEX "LoanScoreSnapshot_import_batch_id_idx" ON "LoanScoreSnapshot"("import_batch_id");

-- AddForeignKey
ALTER TABLE "BranchPincode" ADD CONSTRAINT "BranchPincode_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_assigned_officer_id_fkey" FOREIGN KEY ("assigned_officer_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutcomeLog" ADD CONSTRAINT "OutcomeLog_loan_id_fkey" FOREIGN KEY ("loan_id") REFERENCES "Loan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutcomeLog" ADD CONSTRAINT "OutcomeLog_officer_id_fkey" FOREIGN KEY ("officer_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromiseToPay" ADD CONSTRAINT "PromiseToPay_loan_id_fkey" FOREIGN KEY ("loan_id") REFERENCES "Loan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactAttempt" ADD CONSTRAINT "ContactAttempt_loan_id_fkey" FOREIGN KEY ("loan_id") REFERENCES "Loan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactAttempt" ADD CONSTRAINT "ContactAttempt_officer_id_fkey" FOREIGN KEY ("officer_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanScoreSnapshot" ADD CONSTRAINT "LoanScoreSnapshot_loan_id_fkey" FOREIGN KEY ("loan_id") REFERENCES "Loan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanScoreSnapshot" ADD CONSTRAINT "LoanScoreSnapshot_import_batch_id_fkey" FOREIGN KEY ("import_batch_id") REFERENCES "ImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
