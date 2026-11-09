export interface RbiComplianceResult {
  isAllowed: boolean;
  currentIstHour: number;
  currentIstMinute: number;
  currentTimeString: string;
  window: string;
  reason?: string;
}

/**
 * Checks compliance with RBI Fair Practices Code for Field Collections:
 * Outbound borrower communication & field visits are strictly prohibited
 * outside 08:00 to 19:00 (7:00 PM) Indian Standard Time (IST).
 */
export function checkRbiCompliance(options?: {
  date?: Date;
  simulatedHour?: number | null;
  simulatedMinute?: number | null;
}): RbiComplianceResult {
  const windowStr = '08:00 - 19:00 IST';

  let istHour: number;
  let istMinute: number;

  if (options?.simulatedHour !== undefined && options?.simulatedHour !== null && !isNaN(options.simulatedHour)) {
    istHour = Math.floor(options.simulatedHour);
    istMinute = options.simulatedMinute !== undefined && options.simulatedMinute !== null && !isNaN(options.simulatedMinute)
      ? Math.floor(options.simulatedMinute)
      : 0;
  } else {
    const d = options?.date ?? new Date();
    // Convert to IST (UTC + 5:30)
    const utcTime = d.getTime() + d.getTimezoneOffset() * 60000;
    const istTime = new Date(utcTime + 5.5 * 3600000);
    istHour = istTime.getHours();
    istMinute = istTime.getMinutes();
  }

  // Permitted window: 08:00 <= time <= 19:00
  // e.g. 08:00 is allowed, 18:59 is allowed, 19:00 sharp is allowed, 19:01 is locked, 07:59 is locked.
  const totalMinutes = istHour * 60 + istMinute;
  const startMinutes = 8 * 60;   // 08:00
  const endMinutes = 19 * 60;    // 19:00

  const isAllowed = totalMinutes >= startMinutes && totalMinutes <= endMinutes;

  const pad = (n: number) => n.toString().padStart(2, '0');
  const currentTimeString = `${pad(istHour)}:${pad(istMinute)} IST`;

  if (!isAllowed) {
    const period = totalMinutes < startMinutes ? 'Early morning contact' : 'Night contact';
    return {
      isAllowed: false,
      currentIstHour: istHour,
      currentIstMinute: istMinute,
      currentTimeString,
      window: windowStr,
      reason: `RBI Fair Practices Code violation: Outbound borrower contact and logging is restricted outside 08:00 - 19:00 IST. (${period} at ${currentTimeString}).`,
    };
  }

  return {
    isAllowed: true,
    currentIstHour: istHour,
    currentIstMinute: istMinute,
    currentTimeString,
    window: windowStr,
  };
}

export const RBI_ERROR_RESPONSE = {
  error: 'COMPLIANCE_WINDOW_LOCKED',
  message: 'RBI Fair Practices Code restricts borrower contact and visit logging between 19:00 and 08:00 IST.',
  window: '08:00 - 19:00 IST',
};
