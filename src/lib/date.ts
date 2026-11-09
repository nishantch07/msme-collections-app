const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export function getIstStartOfToday(date: Date = new Date()): Date {
  const istDate = new Date(date.getTime() + IST_OFFSET_MS);
  return new Date(Date.UTC(
    istDate.getUTCFullYear(),
    istDate.getUTCMonth(),
    istDate.getUTCDate()
  ) - IST_OFFSET_MS);
}

export function parseDateOnlyInIst(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  if (
    calendarDate.getUTCFullYear() !== year
    || calendarDate.getUTCMonth() !== month - 1
    || calendarDate.getUTCDate() !== day
  ) {
    return null;
  }

  return new Date(`${value}T00:00:00+05:30`);
}
