// Every error the parser or lookup throws carries a source position, because
// "column not found" is useless in a file with forty columns across three
// tables and the user has no idea which row broke.
export class MarkdownTableError extends Error {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly sourceLine: string;

  constructor(message: string, file: string, line: number, column: number, sourceLine: string) {
    super(message);
    this.name = "MarkdownTableError";
    this.file = file;
    this.line = line;
    this.column = column;
    this.sourceLine = sourceLine;
  }

  format(): string {
    const location = `${this.file}:${this.line}:${this.column}`;
    const pointer = " ".repeat(Math.max(0, this.column - 1)) + "^";
    const lines = [`${location} - ${this.message}`];
    if (this.sourceLine.length > 0) {
      lines.push("", `  ${this.sourceLine}`, `  ${pointer}`);
    }
    return lines.join("\n");
  }
}
