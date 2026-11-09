export interface GuardrailCheckResult {
  safe: boolean;
  violations: string[];
  sanitizedDraft: string;
  fallbackUsed: boolean;
}

export interface ReminderInput {
  borrowerName: string;
  ownerName: string;
  accountNumber: string;
  outstandingPaise: number;
  emiAmountPaise: number;
  officerName?: string;
  language?: 'en' | 'hi';
  customDraft?: string;
}

// Prohibited coercive / threatening terms per RBI Fair Practices Code
const COERCIVE_PATTERNS: Array<{ pattern: RegExp; word: string }> = [
  { pattern: /\bpolice\b/i, word: 'police' },
  { pattern: /\bjail\b/i, word: 'jail' },
  { pattern: /\bseiz(e|ing|ure)\b/i, word: 'seize' },
  { pattern: /\blockdown\b/i, word: 'lockdown' },
  { pattern: /\bauction\b/i, word: 'auction' },
  { pattern: /\bcourt\s*warrant\b/i, word: 'court warrant' },
  { pattern: /\bwarrant\b/i, word: 'warrant' },
  { pattern: /\bshame\b/i, word: 'shame' },
  { pattern: /\bdef+aulter\b/i, word: 'defaulter' },
  { pattern: /\barrest\b/i, word: 'arrest' },
  { pattern: /\bfir\b/i, word: 'FIR' },
  { pattern: /\bthana\b/i, word: 'thana' },
  { pattern: /गिरफ्तार/g, word: 'गिरफ्तार (arrest)' },
  { pattern: /जब्त/g, word: 'जब्त (seize)' },
  { pattern: /पुलिस/g, word: 'पुलिस (police)' },
  { pattern: /नीलामी/g, word: 'नीलामी (auction)' },
  { pattern: /कोर्ट/g, word: 'कोर्ट (court)' },
  { pattern: /वारंट/g, word: 'वारंट (warrant)' },
  { pattern: /जेल/g, word: 'जेल (jail)' },
];

/**
 * 2-Layer Guardrail Validator
 * Layer 1: Coercive / Harassment / Defamation check (EN, HI, Hinglish)
 * Layer 2: Hallucinated currency check against actual loan ledger figures
 */
export function validateCommunicationGuardrails(
  draft: string,
  outstandingPaise: number,
  emiAmountPaise: number,
  promisedPaise?: number
): GuardrailCheckResult {
  const violations: string[] = [];
  let sanitizedDraft = draft;

  // --- LAYER 1: Lexicon Coercion Check ---
  for (const { pattern, word } of COERCIVE_PATTERNS) {
    if (pattern.test(sanitizedDraft)) {
      violations.push(`Coercive/Threatening terminology detected: "${word}"`);
      // Sanitize: replace prohibited threat with compliant neutral phrase
      sanitizedDraft = sanitizedDraft.replace(pattern, '[formal notification]');
    }
  }

  // --- LAYER 2: Hallucinated Amount Check ---
  const validRupees = new Set<number>([
    Math.round(outstandingPaise / 100),
    Math.round(emiAmountPaise / 100),
  ]);
  if (promisedPaise) {
    validRupees.add(Math.round(promisedPaise / 100));
  }

  // Regex to extract INR currency figures: e.g. ₹ 42,000, Rs. 42000, INR 4,85,000
  const currencyRegex = /(?:₹|Rs\.?|INR)\s*([\d,]+)/gi;
  let match: RegExpExecArray | null;

  while ((match = currencyRegex.exec(draft)) !== null) {
    const rawNumberStr = match[1].replace(/,/g, '');
    const parsedAmount = parseInt(rawNumberStr, 10);

    if (!isNaN(parsedAmount) && parsedAmount > 0) {
      if (!validRupees.has(parsedAmount)) {
        violations.push(
          `Hallucinated loan amount: quoted ₹${parsedAmount.toLocaleString('en-IN')} does not match borrower EMI (₹${(emiAmountPaise / 100).toLocaleString('en-IN')}) or total exposure (₹${(outstandingPaise / 100).toLocaleString('en-IN')}).`
        );
        // Sanitize: substitute true EMI amount
        const correctEmiStr = `₹${(emiAmountPaise / 100).toLocaleString('en-IN')}`;
        sanitizedDraft = sanitizedDraft.replace(match[0], correctEmiStr);
      }
    }
  }

  return {
    safe: violations.length === 0,
    violations,
    sanitizedDraft,
    fallbackUsed: false,
  };
}

/**
 * Deterministic DLT-Registered Compliant Reminder Templates
 */
export function getDltTemplateReminder(
  input: ReminderInput,
  lang: 'en' | 'hi' = 'en'
): string {
  const emiRupees = (input.emiAmountPaise / 100).toLocaleString('en-IN');
  const officerStr = input.officerName || 'your field relationship officer';

  if (lang === 'hi') {
    return `नमस्ते ${input.ownerName || input.borrowerName} जी, आपके एमएसएमई ऋण खाता ${input.accountNumber} की बकाया ईएमआई ₹${emiRupees} देय है। कृपया इसे आज ही जमा करने की कृपा करें या अपने फील्ड अधिकारी ${officerStr} से संपर्क करें। आपका सहयोग हमारे लिए महत्वपूर्ण है।`;
  }

  return `Dear ${input.ownerName || input.borrowerName}, this is a polite reminder from your MSME lending partner regarding loan account ${input.accountNumber}. An overdue installment of ₹${emiRupees} is pending. Kindly clear this payment at your earliest convenience or speak to ${officerStr}. Thank you for your partnership.`;
}

/**
 * Generate Bilingual AI Compliant Reminder
 * Tries Gemini API if configured, falls back to deterministic DLT templates.
 * Always validates against the 2-layer safety guardrail.
 */
export async function generateCompliantReminder(
  input: ReminderInput
): Promise<{
  draft: string;
  sanitizedDraft: string;
  language: 'en' | 'hi';
  safe: boolean;
  violations: string[];
  fallbackUsed: boolean;
  provider: 'gemini' | 'dlt-template';
}> {
  const lang = input.language || 'en';
  let rawText = '';
  let provider: 'gemini' | 'dlt-template' = 'dlt-template';
  let fallbackUsed = true;

  const apiKey = process.env.GEMINI_API_KEY?.trim();

  if (apiKey) {
    try {
      const prompt = `You are a polite, RBI-compliant MSME collections officer in India. Write a brief ${
        lang === 'hi' ? 'Hindi' : 'English'
      } reminder message for:
Borrower: ${input.borrowerName} (${input.ownerName})
Loan Account: ${input.accountNumber}
EMI Overdue: ₹${(input.emiAmountPaise / 100).toLocaleString('en-IN')}
Total Outstanding: ₹${(input.outstandingPaise / 100).toLocaleString('en-IN')}

STRICT RULES:
1. Be respectful and professional.
2. Quote ONLY the exact EMI amount ₹${(input.emiAmountPaise / 100).toLocaleString('en-IN')}.
3. NEVER use threatening or coercive language (no police, jail, seizure, court, defaulter).
4. Do not include markdown or quotes, just the message.`;

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.2, maxOutputTokens: 250 },
          }),
        }
      );

      if (response.ok) {
        const data = await response.json();
        const candidate = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (candidate) {
          rawText = candidate.trim();
          provider = 'gemini';
          fallbackUsed = false;
        }
      }
    } catch {
      // Fall through to deterministic template
    }
  }

  // Fallback to deterministic template if Gemini was not used or failed
  if (!rawText) {
    rawText = getDltTemplateReminder(input, lang);
    provider = 'dlt-template';
    fallbackUsed = true;
  }

  // Run through Guardrail Check
  const check = validateCommunicationGuardrails(
    rawText,
    input.outstandingPaise,
    input.emiAmountPaise
  );

  return {
    draft: rawText,
    sanitizedDraft: check.sanitizedDraft,
    language: lang,
    safe: check.safe,
    violations: check.violations,
    fallbackUsed,
    provider,
  };
}
