# markdown-cell-lookup

Markdown tables end up as ad-hoc data stores all the time: environment
variable references in a README, a matrix of feature flags per environment,
a changelog of version-to-date mappings. They're easy to write and easy to
read, but there's no good way to pull one value out of one programmatically
without writing a throwaway parser every time.

`mdcell` answers exactly one question: given a markdown table, a key column,
a key value, and a target column, what's the value in that cell?

## Example

Given `config.md`:

```markdown
# Environment variables

| Name      | Default | Description                     |
| --------- | ------- | -------------------------------- |
| PORT      | 8080    | HTTP port to listen on           |
| LOG_LEVEL | info    | one of debug, info, warn, error  |
| DATA_DIR  | ./data  | where persistent data is stored  |
```

```
$ mdcell config.md --key Name --value LOG_LEVEL --target Default
info

$ mdcell config.md --key Name --value LOG_LEVEL --target Description
one of debug, info, warn, error
```

## Why the errors matter

Markdown tables are whitespace-sensitive and easy to break by hand - a
missing pipe, a delimiter row with the wrong number of columns, a typo in a
column name. `mdcell` points at exactly where the table stopped making
sense, instead of a generic "invalid table" message:

```
$ mdcell config.md --key Name --value PORT --target Defualt
config.md:3:3 - no column named "Defualt" (did you mean "Default"?) - available columns: Name, Default, Description

  | Name      | Default | Description                     |
    ^
```

And if a row's column count doesn't match the header:

```
config.md:6:32 - row has 4 column(s) but the header has 3 (Name, Default, Description)

  | DATA_DIR  | ./data  | where persistent | data is stored |
                                             ^
```

## Usage

```
mdcell <file.md> --key <column> --value <value> --target <column> [--table <heading|index>] [--all]
```

- `--key` - the column to match against.
- `--value` - the exact value to look for in that column.
- `--target` - the column whose value gets printed.
- `--table` - which table to use, if the file has more than one. Give the
  heading text that appears directly above the table, or its 0-based index
  in source order. Omit it to use the first table in the file.
- `--all` - print the target value from every matching row (one per line)
  instead of requiring exactly one match.

Matching is exact (case-sensitive) on the trimmed cell text. If exactly one
row matches, the target cell's value is printed to stdout and the process
exits 0. Anything else - no match, more than one match without `--all`, a bad
column name, a malformed table - is an error on stderr with an exit code of
1.

With `--all`, any number of matches (including one) is fine; each match's
target value is printed on its own line, in the row order they appear in the
table. It's still an error if there are zero matches.

If a file has several tables under headings, refer to them by heading:

```
$ mdcell config.md --key Name --value LOG_LEVEL --target Default --table "Environment variables"
info
```

Every table in the file is parsed up front, so a malformed table later in
the file is still reported even if the one you selected is fine.

## Building

There are no dependencies to install. Compile with a TypeScript compiler
you already have (e.g. a global `tsc`):

```
tsc
node dist/cli.js config.md --key Name --value PORT --target Default
```

## Tests

```
npm test
```

Compiles `src/` and `test/` with `tsc -p tsconfig.test.json` and runs the
result with Node's built-in test runner - no test framework dependency.
`test/parser.test.ts` covers the parser's edge cases: alignment markers,
optional leading/trailing pipes, escaped pipes and pipes inside code spans,
multi-table files, and the exact line/column reported for each malformed
table shape.

## How it works

- `src/parser.ts` reads every `header row + delimiter row + body rows`
  table in the file, tracking the exact line and column each cell started
  at and the heading (if any) that precedes each table.
- `src/lookup.ts` resolves column names to indexes (with a suggestion when
  a name is close but wrong) and finds the row matching the key.
- `src/errors.ts` defines a single error type that knows how to render
  itself with a caret pointing at the offending column.
- `src/cli.ts` wires argument parsing, file reading, and error formatting
  together.

## License

MIT
