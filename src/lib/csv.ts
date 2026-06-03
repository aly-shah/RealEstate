/** Minimal, dependency-free CSV builder with proper quoting. */
export function toCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const esc = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.map(esc).join(",")];
  for (const row of rows) lines.push(row.map(esc).join(","));
  return lines.join("\n");
}

export function csvResponse(filename: string, csv: string): Response {
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

/**
 * Minimal RFC-4180-ish CSV parser. Handles:
 *   - quoted fields with embedded commas, newlines and doubled quotes (`""`)
 *   - mixed CRLF / LF line endings
 *   - leading BOM
 *
 * Returns `{ headers, rows }`. Header row is required and is the first
 * non-empty line. Rows shorter than the header are padded with empty strings;
 * rows longer are truncated. This is enough for spreadsheet exports — full
 * RFC compliance (multi-line records inside quotes) is intentionally not
 * required by the importer to keep failure modes predictable.
 */
export function parseCsv(input: string): { headers: string[]; rows: Record<string, string>[] } {
  const text = input.replace(/^﻿/, ""); // strip BOM
  const records: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        // Doubled quote inside quoted field → literal quote.
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      // Eat CRLF as a single line break.
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      // Skip lines that are entirely empty (no fields with any content).
      if (row.length > 1 || row[0] !== "") records.push(row);
      row = [];
      field = "";
      continue;
    }
    field += ch;
  }
  // Flush the last field/row if the input didn't end with a newline.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.length > 1 || row[0] !== "") records.push(row);
  }

  if (records.length === 0) return { headers: [], rows: [] };
  const headers = records[0].map((h) => h.trim());
  const rows = records.slice(1).map((r) => {
    const obj: Record<string, string> = {};
    for (let i = 0; i < headers.length; i++) {
      obj[headers[i]] = (r[i] ?? "").trim();
    }
    return obj;
  });
  return { headers, rows };
}
