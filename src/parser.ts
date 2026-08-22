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

export function parseTable(source: string, file: string): Table {
  const lines = source.split("\n");

  let headerLineIndex = -1;
  for (let i = 0; i < lines.length - 1; i++) {
    if (lines[i].includes("|") && isDelimiterLine(lines[i + 1])) {
      headerLineIndex = i;
      break;
    }
  }

  if (headerLineIndex === -1) {
    throw new MarkdownTableError(
      "no markdown table found (expected a header row followed by a |---|---| delimiter row)",
      file,
      1,
      1,
      lines[0] ?? "",
    );
  }

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
  for (let i = headerLineIndex + 2; i < lines.length; i++) {
    const line = lines[i];
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
        i + 1,
        pointAt.column,
        line,
      );
    }

    rows.push(rawCells.map((cell) => toTableCell(cell, i + 1)));
  }

  return { file, header, alignments, rows, sourceLines: lines };
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
// inside a cell and an optional leading/trailing pipe on the row.
function splitRow(rawLine: string): RawCell[] {
  const line = trimTrailingWhitespace(rawLine);
  const len = line.length;

  let start = 0;
  while (start < len && (line[start] === " " || line[start] === "\t")) start++;
  if (line[start] === "|") start++;

  const boundaries: number[] = [];
  for (let i = start; i < len; i++) {
    if (line[i] === "|" && line[i - 1] !== "\\") boundaries.push(i);
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

function toTableCell(cell: RawCell, line: number): TableCell {
  const leading = cell.text.match(/^\s*/)?.[0].length ?? 0;
  const raw = cell.text.trim().replace(/\\\|/g, "|");
  return { raw, position: { line, column: cell.column + leading } };
}
