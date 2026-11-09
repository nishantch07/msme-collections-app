export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === ',' && !quoted) {
      row.push(cell.trim());
      cell = '';
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      row.push(cell.trim());
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += character;
    }
  }

  if (quoted) throw new Error('CSV contains an unclosed quoted field.');
  row.push(cell.trim());
  if (row.some((value) => value.length > 0)) rows.push(row);
  return rows;
}

export function normalizeCsvHeader(header: string): string {
  return header.replace(/^\uFEFF/, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function getCsvValue(
  row: string[],
  headerIndexes: Map<string, number>,
  aliases: string[]
): string | undefined {
  for (const alias of aliases) {
    const index = headerIndexes.get(normalizeCsvHeader(alias));
    if (index !== undefined) return row[index]?.trim();
  }
  return undefined;
}
