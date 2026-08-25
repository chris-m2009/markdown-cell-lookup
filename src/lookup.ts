import { MarkdownTableError } from "./errors.js";
import type { Table } from "./parser.js";

export interface LookupResult {
  value: string;
  line: number;
}

export interface LookupOptions {
  // return every matching row instead of requiring exactly one.
  all?: boolean;
}

export function lookup(
  table: Table,
  keyColumn: string,
  keyValue: string,
  targetColumn: string,
  options: LookupOptions = {},
): LookupResult[] {
  const keyIndex = findColumnIndex(table, keyColumn);
  const targetIndex = findColumnIndex(table, targetColumn);

  const matches = table.rows.filter((row) => row[keyIndex].raw === keyValue);

  if (matches.length === 0) {
    const header = table.header[keyIndex];
    throw new MarkdownTableError(
      `no row where "${keyColumn}" is "${keyValue}"`,
      table.file,
      header.position.line,
      header.position.column,
      sourceLineAt(table, header.position.line),
    );
  }

  if (!options.all && matches.length > 1) {
    const lines = matches.map((row) => row[keyIndex].position.line).join(", ");
    const first = matches[0][keyIndex];
    throw new MarkdownTableError(
      `"${keyColumn}" = "${keyValue}" matches ${matches.length} rows (lines ${lines}); expected exactly one - pass --all to return every match`,
      table.file,
      first.position.line,
      first.position.column,
      sourceLineAt(table, first.position.line),
    );
  }

  return matches.map((row) => ({ value: row[targetIndex].raw, line: row[targetIndex].position.line }));
}

function findColumnIndex(table: Table, name: string): number {
  const exact = table.header.findIndex((cell) => cell.raw === name);
  if (exact !== -1) return exact;

  const known = table.header.map((cell) => cell.raw);
  const lower = name.toLowerCase();
  const looseIndex = table.header.findIndex((cell) => cell.raw.toLowerCase() === lower);
  const suggestion = looseIndex !== -1 ? known[looseIndex] : closestMatch(name, known);
  const hint = suggestion ? ` (did you mean "${suggestion}"?)` : "";

  const header = table.header[0];
  throw new MarkdownTableError(
    `no column named "${name}"${hint} - available columns: ${known.join(", ")}`,
    table.file,
    header?.position.line ?? 1,
    header?.position.column ?? 1,
    header ? sourceLineAt(table, header.position.line) : "",
  );
}

function sourceLineAt(table: Table, line: number): string {
  return table.sourceLines[line - 1] ?? "";
}

function closestMatch(name: string, candidates: string[]): string | undefined {
  let best: string | undefined;
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    const distance = levenshtein(name.toLowerCase(), candidate.toLowerCase());
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return bestDistance <= Math.max(2, Math.floor(name.length / 2)) ? best : undefined;
}

function levenshtein(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) d[i][0] = i;
  for (let j = 0; j <= b.length; j++) d[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
    }
  }

  return d[a.length][b.length];
}
