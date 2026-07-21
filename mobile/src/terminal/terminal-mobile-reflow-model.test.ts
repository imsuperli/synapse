import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { TERMINAL_MOBILE_REFLOW_JS } from "./terminal-webview-mobile-reflow-injected";

const require = createRequire(import.meta.url);
const { Terminal } = require("@xterm/xterm") as typeof import("@xterm/xterm");
const { SerializeAddon } =
  require("@xterm/addon-serialize") as typeof import("@xterm/addon-serialize");

function writeTerminal(terminal: InstanceType<typeof Terminal>, data: string): Promise<void> {
  return new Promise((resolve) => terminal.write(data, resolve));
}

function makeProjectionReflowSafe(serialized: string, sourceCols: number): string {
  // Execute the exact production transformer embedded in the WebView.
  // eslint-disable-next-line no-new-func
  const transform = new Function(
    "serialized",
    "sourceCols",
    `${TERMINAL_MOBILE_REFLOW_JS}\n` +
      "mobileSourceCols = sourceCols; return makeMobileSerializedProjectionReflowSafe(serialized);",
  ) as (serialized: string, sourceCols: number) => string;
  return transform(serialized, sourceCols);
}

function logicalLines(terminal: InstanceType<typeof Terminal>): string[] {
  const buffer = terminal.buffer.normal;
  const result: string[] = [];
  let current = "";
  for (let row = 0; row < buffer.length; row++) {
    const line = buffer.getLine(row);
    if (!line) {
      continue;
    }
    if (!line.isWrapped && current) {
      result.push(current);
      current = "";
    }
    current += line.translateToString(true);
  }
  if (current) {
    result.push(current);
  }
  return result;
}

describe("mobile terminal canonical model projection", () => {
  it("rewraps soft lines at phone width without changing the desktop model", async () => {
    const source = new Terminal({ cols: 20, rows: 6, scrollback: 100, allowProposedApi: true });
    const serializeAddon = new SerializeAddon();
    source.loadAddon(serializeAddon);
    await writeTerminal(
      source,
      "\u001b[31malpha beta gamma delta epsilon\u001b[0m\r\nsecond hard line\r\nprompt$ ",
    );

    const projection = new Terminal({
      cols: 8,
      rows: 10,
      scrollback: 100,
      allowProposedApi: true,
    });
    await writeTerminal(
      projection,
      serializeAddon.serialize({ excludeAltBuffer: true, excludeModes: false }),
    );

    expect(source.cols).toBe(20);
    expect(source.rows).toBe(6);
    expect(logicalLines(projection).slice(0, 3)).toEqual(logicalLines(source).slice(0, 3));
    expect(projection.buffer.normal.length).toBeGreaterThan(source.buffer.normal.length);

    const firstCell = projection.buffer.normal.getLine(0)?.getCell(0);
    expect(firstCell?.isFgPalette()).toBe(true);
    expect(firstCell?.getFgColor()).toBe(1);
  });

  it("keeps application-authored hard line breaks as separate logical lines", async () => {
    const source = new Terminal({ cols: 12, rows: 4, scrollback: 100, allowProposedApi: true });
    const serializeAddon = new SerializeAddon();
    source.loadAddon(serializeAddon);
    await writeTerminal(source, "first hard\r\nsecond hard\r\nthird");

    const projection = new Terminal({
      cols: 6,
      rows: 8,
      scrollback: 100,
      allowProposedApi: true,
    });
    await writeTerminal(
      projection,
      serializeAddon.serialize({ excludeAltBuffer: true, excludeModes: false }),
    );

    expect(logicalLines(projection).slice(0, 3)).toEqual(["first hard", "second hard", "third"]);
  });

  it("preserves internal blank columns compressed by the serializer", async () => {
    const source = new Terminal({ cols: 20, rows: 6, scrollback: 100, allowProposedApi: true });
    const serializeAddon = new SerializeAddon();
    source.loadAddon(serializeAddon);
    await writeTerminal(source, "abc\u001b[10Cdef\r\nprompt$ ");

    const projection = new Terminal({
      cols: 8,
      rows: 10,
      scrollback: 100,
      allowProposedApi: true,
    });
    const serialized = serializeAddon.serialize({
      excludeAltBuffer: true,
      excludeModes: false,
    });
    expect(serialized).toContain("\u001b[10C");
    await writeTerminal(projection, makeProjectionReflowSafe(serialized, source.cols));

    expect(logicalLines(projection).slice(0, 2)).toEqual(["abc          def", "prompt$ "]);
    await writeTerminal(projection, "next\r\n");
    expect(logicalLines(projection)).toContain("prompt$ next");
  });

  it("removes serializer-only soft-wrap repairs at a styled CJK width boundary", async () => {
    const source = new Terminal({ cols: 20, rows: 6, scrollback: 100, allowProposedApi: true });
    const serializeAddon = new SerializeAddon();
    source.loadAddon(serializeAddon);
    await writeTerminal(
      source,
      "Search xxxxxxxxxxxx\u001b[44m设计\u001b[0m.md",
    );

    const serialized = serializeAddon.serialize({
      excludeAltBuffer: true,
      excludeModes: false,
    });
    expect(serialized).toContain("\u001b[A\u001b[19C\u001b[1X\u001b[19D\u001b[B");

    const projection = new Terminal({
      cols: 8,
      rows: 12,
      scrollback: 100,
      allowProposedApi: true,
    });
    const transformed = makeProjectionReflowSafe(serialized, source.cols);
    await writeTerminal(projection, transformed);

    expect(transformed).not.toContain("\u001b[19C");
    expect(logicalLines(projection)).toEqual(logicalLines(source));
  });
});
