import { MarkdownTableError } from "./errors.js";

export type Alignment = "left" | "right" | "center" | null;

export interface CellPosition {
  line: number;
  column: number;
}

export interface TableCell {
  raw: string;
  position: CellPosition;
}

export interface Table {
  file: string;
  header: TableCell[];
  alignments: Alignment[];
  rows: TableCell[][];
  // the nearest heading above the table, or null if the table isn't preceded
  // by one - lets callers select a table by heading instead of position.
  heading: string | null;
  // 0-based position among the tables found in the file, in source order.
  index: number;
  // kept around so later errors (e.g. during lookup) can quote the exact
  // offending line instead of just naming a line number.
  sourceLines: string[];
}

interface RawCell {
  text: string;
  // 1-based column of the first character of `text`, before trimming.
  column: number;
}

const DELIMITER_CELL = /^:?-+:?$/;
const HEADING_LINE = /^#{1,6}\s+(.+?)\s*$/;

// Scans the whole file and returns every table found, in source order, each
// tagged with the heading immediately above it (if any). A file with no
// tables at all is an error; a malformed table found along the way is also
// an error, since a table that looks intended but is broken shouldn't be
// silently skipped in favor of a later one.
export function parseTables(source: string, file: string): Table[] {
  const lines = source.split("\n");
  const tables: Table[] = [];
  let heading: string | null = null;

  let i = 0;
  while (i < lines.length) {
    const headingMatch = lines[i].match(HEADING_LINE);
    if (headingMatch) {
      heading = headingMatch[1];
      i++;
      continue;
    }

    if (i < lines.length - 1 && lines[i].includes("|") && isDelimiterLine(lines[i + 1])) {
      const { table, nextLine } = parseTableAt(lines, i, file, heading, tables.length);
      tables.push(table);
      heading = null;
      i = nextLine;
      continue;
    }

    i++;
  }

  if (tables.length === 0) {
    throw new MarkdownTableError(
      "no markdown table found (expected a header row followed by a |---|---| delimiter row)",
      file,
      1,
      1,
      lines[0] ?? "",
    );
  }

  return tables;
}

// Resolves a `--table` selector against the tables found in a file. A
// selector of `undefined` means "the first table", matching the tool's
// original single-table behavior. A selector made of digits is an index;
// anything else is matched against table headings.
export function selectTable(tables: Table[], selector: string | undefined, file: string): Table {
  if (selector === undefined) return tables[0];

  if (/^\d+$/.test(selector)) {
    const table = tables[Number(selector)];
    if (!table) {
      throw new MarkdownTableError(
        `no table at index ${selector} - file has ${tables.length} table(s) (indexes 0-${tables.length - 1})`,
        file,
        1,
        1,
        "",
      );
    }
    return table;
  }

  const matches = tables.filter((table) => table.heading === selector);
  if (matches.length === 1) return matches[0];

  const summary = tables
    .map((table) => `${table.index}: ${table.heading ?? "(no heading)"}`)
    .join(", ");

  if (matches.length > 1) {
    throw new MarkdownTableError(
      `${matches.length} tables have the heading "${selector}" - select by index instead - available tables: ${summary}`,
      file,
      1,
      1,
      "",
    );
  }

  throw new MarkdownTableError(
    `no table with heading "${selector}" - available tables: ${summary}`,
    file,
    1,
    1,
    "",
  );
}

function parseTableAt(
  lines: string[],
  headerLineIndex: number,
  file: string,
  heading: string | null,
  index: number,
): { table: Table; nextLine: number } {
  const headerLine = lines[headerLineIndex];
  const delimiterLine = lines[headerLineIndex + 1];
  const headerCellsRaw = splitRow(headerLine);
  const delimiterCellsRaw = splitRow(delimiterLine);

  if (delimiterCellsRaw.length !== headerCellsRaw.length) {
    const culprit = delimiterCellsRaw[delimiterCellsRaw.length - 1];
    throw new MarkdownTableError(
      `delimiter row has ${delimiterCellsRaw.length} column(s) but the header has ${headerCellsRaw.length}`,
      file,
      headerLineIndex + 2,
      culprit ? culprit.column : 1,
      delimiterLine,
    );
  }

  const alignments: Alignment[] = [];
  for (const cell of delimiterCellsRaw) {
    const text = cell.text.trim();
    if (!DELIMITER_CELL.test(text)) {
      throw new MarkdownTableError(
        `invalid delimiter cell "${text}" (expected dashes, e.g. --- or :---: for alignment)`,
        file,
        headerLineIndex + 2,
        cell.column,
        delimiterLine,
      );
    }
    alignments.push(parseAlignment(text));
  }

  const header = headerCellsRaw.map((cell) => toTableCell(cell, headerLineIndex + 1));

  const rows: TableCell[][] = [];
  let nextLine = headerLineIndex + 2;
  for (; nextLine < lines.length; nextLine++) {
    const line = lines[nextLine];
    if (line.trim() === "" || !line.includes("|")) break;

    const rawCells = splitRow(line);
    if (rawCells.length !== header.length) {
      const columnNames = header.map((cell) => cell.raw).join(", ");
      const pointAt =
        rawCells.length > header.length
          ? rawCells[header.length]
          : { column: trimTrailingWhitespace(line).length + 1, text: "" };
      throw new MarkdownTableError(
        `row has ${rawCells.length} column(s) but the header has ${header.length} (${columnNames})`,
        file,
        nextLine + 1,
        pointAt.column,
        line,
      );
    }

    rows.push(rawCells.map((cell) => toTableCell(cell, nextLine + 1)));
  }

  return { table: { file, header, alignments, rows, heading, index, sourceLines: lines }, nextLine };
}

function isDelimiterLine(line: string): boolean {
  if (line.trim() === "") return false;
  const cells = splitRow(line);
  return cells.every((cell) => DELIMITER_CELL.test(cell.text.trim()));
}

function parseAlignment(cell: string): Alignment {
  const left = cell.startsWith(":");
  const right = cell.endsWith(":");
  if (left && right) return "center";
  if (right) return "right";
  if (left) return "left";
  return null;
}

function trimTrailingWhitespace(line: string): string {
  return line.replace(/[ \t]+$/, "");
}

// Splits one table row into cells, tracking the 1-based column each cell
// started at so later error messages can point at the exact offending cell
// rather than just "somewhere on line N". Handles an escaped pipe (\|)
// and a pipe inside an inline code span (`a | b`), neither of which end
// a cell, plus an optional leading/trailing pipe on the row.
function splitRow(rawLine: string): RawCell[] {
  const line = trimTrailingWhitespace(rawLine);
  const len = line.length;
  const codeSpans = findCodeSpans(line);

  let start = 0;
  while (start < len && (line[start] === " " || line[start] === "\t")) start++;
  if (line[start] === "|") start++;

  const boundaries: number[] = [];
  for (let i = start; i < len; i++) {
    if (line[i] === "|" && line[i - 1] !== "\\" && !isInsideCodeSpan(i, codeSpans)) boundaries.push(i);
  }

  const cells: RawCell[] = [];
  let sliceStart = start;
  for (const boundary of boundaries) {
    cells.push({ text: line.slice(sliceStart, boundary), column: sliceStart + 1 });
    sliceStart = boundary + 1;
  }
  cells.push({ text: line.slice(sliceStart, len), column: sliceStart + 1 });

  const lastBoundary = boundaries[boundaries.length - 1];
  if (lastBoundary === len - 1 && cells.length > 1) cells.pop();

  return cells;
}

// Finds inline code spans (`` `text` ``, ```` ``text`` ````, ...) on a line,
// following the same rule Markdown uses: a run of N backticks opens a span,
// and it's closed by the next run of exactly N backticks. A pipe inside one
// of these ranges is content, not a column separator. An opening run with no
// matching close (e.g. a stray backtick) isn't a span at all.
function findCodeSpans(line: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  const len = line.length;
  let i = 0;

  while (i < len) {
    if (line[i] !== "`") {
      i++;
      continue;
    }

    const openStart = i;
    while (i < len && line[i] === "`") i++;
    const openLength = i - openStart;

    let found = false;
    let j = i;
    while (j < len) {
      if (line[j] !== "`") {
        j++;
        continue;
      }
      const runStart = j;
      while (j < len && line[j] === "`") j++;
      if (j - runStart === openLength) {
        found = true;
        break;
      }
    }

    if (!found) continue;
    spans.push([openStart, j]);
    i = j;
  }

  return spans;
}

function isInsideCodeSpan(index: number, spans: Array<[number, number]>): boolean {
  return spans.some(([start, end]) => index >= start && index < end);
}

function toTableCell(cell: RawCell, line: number): TableCell {
  const leading = cell.text.match(/^\s*/)?.[0].length ?? 0;
  const raw = cell.text.trim().replace(/\\\|/g, "|");
  return { raw, position: { line, column: cell.column + leading } };
}
