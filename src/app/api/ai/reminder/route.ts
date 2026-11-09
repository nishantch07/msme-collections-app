import { NextResponse } from 'next/server';
import { z } from 'zod';
import { generateCompliantReminder, validateCommunicationGuardrails } from '@/lib/ai-guardrails';
import { checkRbiCompliance } from '@/lib/compliance';

const ReminderRequestSchema = z.object({
  borrower_name: z.string(),
  owner_name: z.string(),
  account_number: z.string(),
  outstanding_paise: z.number().int().positive(),
  emi_amount_paise: z.number().int().positive(),
  language: z.enum(['en', 'hi']).default('en'),
  officer_name: z.string().optional(),
  custom_draft: z.string().optional(),
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const result = ReminderRequestSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json(
        { error: 'Invalid reminder parameters', details: result.error.issues },
        { status: 400 }
      );
    }

    const {
      borrower_name,
      owner_name,
      account_number,
      outstanding_paise,
      emi_amount_paise,
      language,
      officer_name,
      custom_draft,
    } = result.data;

    // Check simulated or current RBI window
    const simulatedHeader = req.headers.get('x-simulated-ist-hour');
    const { searchParams } = new URL(req.url);
    const simulatedQuery = searchParams.get('simulatedHour');
    const simHour = simulatedHeader ? parseFloat(simulatedHeader) : (simulatedQuery ? parseFloat(simulatedQuery) : null);
    const compliance = checkRbiCompliance({ simulatedHour: simHour });

    // If custom draft is provided for testing guardrails
    if (custom_draft !== undefined && custom_draft !== null) {
      const guardrailResult = validateCommunicationGuardrails(
        custom_draft,
        outstanding_paise,
        emi_amount_paise
      );

      return NextResponse.json({
        success: true,
        draft: custom_draft,
        sanitizedDraft: guardrailResult.sanitizedDraft,
        language,
        safe: guardrailResult.safe,
        violations: guardrailResult.violations,
        fallbackUsed: false,
        provider: 'custom-tested',
        rbiCompliance: compliance,
      });
    }

    // Otherwise generate fresh reminder (Gemini or DLT Template fallback)
    const generated = await generateCompliantReminder({
      borrowerName: borrower_name,
      ownerName: owner_name,
      accountNumber: account_number,
      outstandingPaise: outstanding_paise,
      emiAmountPaise: emi_amount_paise,
      officerName: officer_name || 'Ramesh Kumar',
      language,
    });

    return NextResponse.json({
      success: true,
      ...generated,
      rbiCompliance: compliance,
    });
  } catch (error) {
    console.error('Error generating AI reminder:', error);
    return NextResponse.json({ error: 'Failed to generate reminder' }, { status: 500 });
  }
}
