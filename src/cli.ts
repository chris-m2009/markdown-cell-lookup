#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { MarkdownTableError } from "./errors.js";
import { parseTable } from "./parser.js";
import { lookup } from "./lookup.js";

const USAGE = `usage: mdcell <file.md> --key <column> --value <value> --target <column>

example:
  mdcell config.md --key Name --value LOG_LEVEL --target Default`;

interface Args {
  file: string;
  key: string;
  value: string;
  target: string;
}

function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  const flags: Record<string, string> = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const name = arg.slice(2);
      const value = argv[i + 1];
      if (value === undefined) throw new Error(`missing value for --${name}\n\n${USAGE}`);
      flags[name] = value;
      i++;
    } else {
      positional.push(arg);
    }
  }

  const file = positional[0];
  if (!file || !flags.key || !flags.value || !flags.target) {
    throw new Error(USAGE);
  }

  return { file, key: flags.key, value: flags.value, target: flags.target };
}

function main(): void {
  let args: Args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
    return;
  }

  let source: string;
  try {
    source = readFileSync(args.file, "utf8");
  } catch (err) {
    console.error(`could not read ${args.file}: ${(err as Error).message}`);
    process.exitCode = 1;
    return;
  }

  try {
    const table = parseTable(source, args.file);
    const result = lookup(table, args.key, args.value, args.target);
    console.log(result.value);
  } catch (err) {
    if (err instanceof MarkdownTableError) {
      console.error(err.format());
    } else {
      console.error(err instanceof Error ? err.message : String(err));
    }
    process.exitCode = 1;
  }
}

main();
