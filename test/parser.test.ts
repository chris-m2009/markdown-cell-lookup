import test from "node:test";
import assert from "node:assert/strict";
import { parseTables, selectTable } from "../src/parser.js";
import { MarkdownTableError } from "../src/errors.js";

function assertMarkdownTableError(fn: () => void): MarkdownTableError {
  try {
    fn();
  } catch (err) {
    if (err instanceof MarkdownTableError) return err;
    throw err;
  }
  throw new Error("expected function to throw");
}

test("parses a header, delimiter, and body rows under a heading", () => {
  const source = ["# Config", "", "| Name | Value |", "| ---- | ----- |", "| PORT | 8080  |"].join("\n");
  const [table] = parseTables(source, "test.md");

  assert.equal(table.heading, "Config");
  assert.equal(table.index, 0);
  assert.deepEqual(
    table.header.map((cell) => cell.raw),
    ["Name", "Value"],
  );
  assert.deepEqual(table.header[0].position, { line: 3, column: 3 });
  assert.deepEqual(table.header[1].position, { line: 3, column: 10 });
  assert.equal(table.rows.length, 1);
  assert.deepEqual(
    table.rows[0].map((cell) => cell.raw),
    ["PORT", "8080"],
  );
});

test("parses alignment markers on the delimiter row", () => {
  const source = ["| A | B | C | D |", "| :- | -: | :-: | -- |", "| 1  | 2 | 3 | 4 |"].join("\n");
  const [table] = parseTables(source, "test.md");

  assert.deepEqual(table.alignments, ["left", "right", "center", null]);
});

test("treats a leading/trailing pipe on a row as optional", () => {
  const source = ["A | B", "--- | ---", "1 | 2"].join("\n");
  const [table] = parseTables(source, "test.md");

  assert.deepEqual(
    table.header.map((cell) => cell.raw),
    ["A", "B"],
  );
  assert.deepEqual(
    table.rows[0].map((cell) => cell.raw),
    ["1", "2"],
  );
});

test("does not split a cell on an escaped pipe", () => {
  const source = ["| A | B |", "| - | - |", String.raw`| a\|b | c |`].join("\n");
  const [table] = parseTables(source, "test.md");

  assert.deepEqual(
    table.rows[0].map((cell) => cell.raw),
    ["a|b", "c"],
  );
});

test("does not split a cell on a pipe inside an inline code span", () => {
  const source = ["| A | B |", "| - | - |", "| `a|b` | c |"].join("\n");
  const [table] = parseTables(source, "test.md");

  assert.deepEqual(
    table.rows[0].map((cell) => cell.raw),
    ["`a|b`", "c"],
  );
});

test("stops a table's body at the first blank or non-table line", () => {
  const source = ["| A | B |", "| - | - |", "| 1 | 2 |", "", "not a table row"].join("\n");
  const [table] = parseTables(source, "test.md");

  assert.equal(table.rows.length, 1);
});

test("finds multiple tables in one file and resets the heading between them", () => {
  const source = [
    "# First",
    "| A | B |",
    "| - | - |",
    "| 1 | 2 |",
    "",
    "| C | D |",
    "| - | - |",
    "| 3 | 4 |",
  ].join("\n");
  const tables = parseTables(source, "test.md");

  assert.equal(tables.length, 2);
  assert.equal(tables[0].heading, "First");
  assert.equal(tables[1].heading, null);
  assert.equal(tables[1].index, 1);
});

test("throws when a file has no table at all", () => {
  const err = assertMarkdownTableError(() => parseTables("just some text\nno pipes here", "test.md"));
  assert.match(err.message, /no markdown table found/);
  assert.equal(err.line, 1);
});

test("throws with line and column when the delimiter row has the wrong column count", () => {
  const source = ["| A | B |", "| - |"].join("\n");
  const err = assertMarkdownTableError(() => parseTables(source, "test.md"));
  assert.match(err.message, /delimiter row has 1 column\(s\) but the header has 2/);
  assert.equal(err.line, 2);
});

test("throws when a delimiter cell isn't dashes", () => {
  const source = ["| A | B |", "| - | nope |"].join("\n");
  const err = assertMarkdownTableError(() => parseTables(source, "test.md"));
  assert.match(err.message, /invalid delimiter cell "nope"/);
  assert.equal(err.line, 2);
});

test("throws with the offending cell's position when a row has too many columns", () => {
  const source = ["| A | B |", "| - | - |", "| 1 | 2 | 3 |"].join("\n");
  const err = assertMarkdownTableError(() => parseTables(source, "test.md"));
  assert.match(err.message, /row has 3 column\(s\) but the header has 2/);
  assert.equal(err.line, 3);
});

test("throws when a row has too few columns", () => {
  const source = ["| A | B |", "| - | - |", "| 1 |"].join("\n");
  const err = assertMarkdownTableError(() => parseTables(source, "test.md"));
  assert.match(err.message, /row has 1 column\(s\) but the header has 2/);
  assert.equal(err.line, 3);
});

test("selectTable defaults to the first table when no selector is given", () => {
  const source = ["| A |", "| - |", "| 1 |", "", "| B |", "| - |", "| 2 |"].join("\n");
  const tables = parseTables(source, "test.md");
  assert.equal(selectTable(tables, undefined, "test.md"), tables[0]);
});

test("selectTable resolves a numeric selector by index", () => {
  const source = ["| A |", "| - |", "| 1 |", "", "| B |", "| - |", "| 2 |"].join("\n");
  const tables = parseTables(source, "test.md");
  assert.equal(selectTable(tables, "1", "test.md"), tables[1]);
});

test("selectTable throws on an out-of-range index", () => {
  const source = ["| A |", "| - |", "| 1 |"].join("\n");
  const tables = parseTables(source, "test.md");
  assert.throws(() => selectTable(tables, "5", "test.md"), /no table at index 5/);
});

test("selectTable resolves a heading selector", () => {
  const source = ["# First", "| A |", "| - |", "| 1 |", "", "# Second", "| B |", "| - |", "| 2 |"].join("\n");
  const tables = parseTables(source, "test.md");
  assert.equal(selectTable(tables, "Second", "test.md"), tables[1]);
});

test("selectTable throws when a heading matches more than one table", () => {
  const source = ["# Dup", "| A |", "| - |", "| 1 |", "", "# Dup", "| B |", "| - |", "| 2 |"].join("\n");
  const tables = parseTables(source, "test.md");
  assert.throws(() => selectTable(tables, "Dup", "test.md"), /have the heading "Dup" - select by index instead/);
});

test("selectTable throws when a heading matches no table", () => {
  const source = ["# First", "| A |", "| - |", "| 1 |"].join("\n");
  const tables = parseTables(source, "test.md");
  assert.throws(() => selectTable(tables, "Missing", "test.md"), /no table with heading "Missing"/);
});
