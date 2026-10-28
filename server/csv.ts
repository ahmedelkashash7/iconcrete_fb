/** Minimal RFC-4180 CSV reader (quotes, embedded commas and newlines). */

export interface ParsedCsv {
  headers: string[];
  rows: string[][];
}

export const parseCsv = (text: string): ParsedCsv => {
  const content = text.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    if (inQuotes) {
      if (char === '"') {
        if (content[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char ?? '';
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char === '\r') {
      // handled with \n
    } else {
      field += char ?? '';
    }
  }
  row.push(field);
  if (row.some((value) => value.trim() !== '')) rows.push(row);

  const nonEmpty = rows.filter((candidate) => candidate.some((value) => value.trim() !== ''));
  const headerRow = nonEmpty.shift();
  return {
    headers: (headerRow ?? []).map((value) => value.trim()),
    rows: nonEmpty,
  };
};

export const csvEscape = (value: string): string => {
  const needsQuotes = /[",\n\r]/.test(value);
  const safe = needsQuotes ? `"${value.replace(/"/g, '""')}"` : value;
  return /^[=+\-@]/.test(safe) ? `'${safe}` : safe;
};
