import { createHash } from 'node:crypto';

export interface OutcomePayloadForHash {
  loan_id: string;
  officer_id: string;
  outcome_type: string;
  amount_collected_paise?: number | null;
  promised_amount_paise?: number | null;
  promise_date?: string | null;
  notes: string;
  gps_lat: number;
  gps_lng: number;
  gps_accuracy_m: number;
}

export function hashOutcomePayload(payload: OutcomePayloadForHash): string {
  const canonicalPayload = JSON.stringify({
    loan_id: payload.loan_id,
    officer_id: payload.officer_id,
    outcome_type: payload.outcome_type,
    amount_collected_paise: payload.amount_collected_paise ?? null,
    promised_amount_paise: payload.promised_amount_paise ?? null,
    promise_date: payload.promise_date ?? null,
    notes: payload.notes,
    gps_lat: payload.gps_lat,
    gps_lng: payload.gps_lng,
    gps_accuracy_m: payload.gps_accuracy_m,
  });
  return createHash('sha256').update(canonicalPayload).digest('hex');
}
