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

function serializeSnapshotProjection(
  source: InstanceType<typeof Terminal>,
  serializeAddon: InstanceType<typeof SerializeAddon>,
  liveInputText: string,
): string {
  // Execute the production snapshot serializer, including its temporary Codex
  // composer line view. The source terminal itself must remain untouched.
  // eslint-disable-next-line no-new-func
  const serialize = new Function(
    "source",
    "serializeAddon",
    "liveInputText",
    `${TERMINAL_MOBILE_REFLOW_JS}\n` +
      "var trackedMouseTrackingMode = 'none'; " +
      "mobileSourceTerm = source; mobileSourceSerializeAddon = serializeAddon; " +
      "mobileSourceCols = source.cols; mobileSourceRows = source.rows; " +
      "mobileLiveInputText = liveInputText; return serializeMobileSnapshotProjection();",
  ) as (
    source: InstanceType<typeof Terminal>,
    serializeAddon: InstanceType<typeof SerializeAddon>,
    liveInputText: string,
  ) => string;
  return serialize(source, serializeAddon, liveInputText);
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

  it("reflows Codex composer visual rows as one mobile logical line", async () => {
    const source = new Terminal({ cols: 20, rows: 7, scrollback: 100, allowProposedApi: true });
    const serializeAddon = new SerializeAddon();
    source.loadAddon(serializeAddon);
    const input = "abcdefghijklmnopqrstuvwxyza123";
    const firstVisualRow = input.slice(0, 17);
    const secondVisualRow = input.slice(17);
    await writeTerminal(
      source,
      `\u001b[2J\u001b[H› ${firstVisualRow}` +
        `\u001b[2;3H${secondVisualRow}` +
        "\u001b[4;3Hgpt-5.6-sol xhigh" +
        `\u001b[2;${secondVisualRow.length + 3}H`,
    );

    const sourceBefore = logicalLines(source);
    const projection = new Terminal({
      cols: 8,
      rows: 12,
      scrollback: 100,
      allowProposedApi: true,
    });
    await writeTerminal(
      projection,
      serializeSnapshotProjection(source, serializeAddon, input),
    );

    expect(logicalLines(projection)).toEqual([
      `› ${input}`,
      "  gpt-5.6-sol xhigh",
    ]);
    expect(logicalLines(source)).toEqual(sourceBefore);
    expect(source.buffer.active.getLine(1)?.isWrapped).toBe(false);
  });

  it("collapses desktop status alignment gaps below the active Codex composer", async () => {
    const source = new Terminal({ cols: 48, rows: 7, scrollback: 100, allowProposedApi: true });
    const serializeAddon = new SerializeAddon();
    source.loadAddon(serializeAddon);
    await writeTerminal(
      source,
      "\u001b[2J\u001b[H› hello" +
        "\u001b[4;3Htab to queue message            55% Context left" +
        "\u001b[1;8H",
    );

    const projection = new Terminal({
      cols: 20,
      rows: 12,
      scrollback: 100,
      allowProposedApi: true,
    });
    await writeTerminal(
      projection,
      serializeSnapshotProjection(source, serializeAddon, "hello"),
    );

    expect(logicalLines(projection)).toEqual([
      "› hello",
      "  tab to queue message 55% Context left",
    ]);
  });

  it("preserves spaces in ordinary rows below the active Codex composer", async () => {
    const source = new Terminal({ cols: 48, rows: 7, scrollback: 100, allowProposedApi: true });
    const serializeAddon = new SerializeAddon();
    source.loadAddon(serializeAddon);
    await writeTerminal(
      source,
      "\u001b[2J\u001b[H› hello" +
        "\u001b[4;3Hordinary text    keeps spacing" +
        "\u001b[1;8H",
    );

    const projection = new Terminal({
      cols: 20,
      rows: 12,
      scrollback: 100,
      allowProposedApi: true,
    });
    await writeTerminal(
      projection,
      serializeSnapshotProjection(source, serializeAddon, "hello"),
    );

    expect(logicalLines(projection)).toEqual([
      "› hello",
      "  ordinary text    keeps spacing",
    ]);
  });

  it("reflows mixed CJK and narrow cells without retaining Codex continuation indent", async () => {
    const source = new Terminal({ cols: 20, rows: 7, scrollback: 100, allowProposedApi: true });
    const serializeAddon = new SerializeAddon();
    source.loadAddon(serializeAddon);
    const firstVisualRow = "知识库存储统一设a";
    const secondVisualRow = "计.md继续输入";
    const input = firstVisualRow + secondVisualRow;
    await writeTerminal(
      source,
      `\u001b[2J\u001b[H› ${firstVisualRow}` +
        `\u001b[2;3H${secondVisualRow}` +
        "\u001b[4;3Hstatus" +
        "\u001b[2;16H",
    );

    const projection = new Terminal({
      cols: 7,
      rows: 14,
      scrollback: 100,
      allowProposedApi: true,
    });
    await writeTerminal(
      projection,
      serializeSnapshotProjection(source, serializeAddon, input),
    );

    expect(logicalLines(projection)).toEqual([`› ${input}`, "  status"]);
  });

  it("restores a word-boundary space omitted by Codex composer wrapping", async () => {
    const source = new Terminal({ cols: 20, rows: 7, scrollback: 100, allowProposedApi: true });
    const serializeAddon = new SerializeAddon();
    source.loadAddon(serializeAddon);
    const input = "alpha beta gamma delta";
    await writeTerminal(
      source,
      "\u001b[2J\u001b[H› alpha beta gamma" +
        "\u001b[2;3Hdelta" +
        "\u001b[4;3Hstatus" +
        "\u001b[2;8H",
    );

    const projection = new Terminal({
      cols: 9,
      rows: 12,
      scrollback: 100,
      allowProposedApi: true,
    });
    await writeTerminal(
      projection,
      serializeSnapshotProjection(source, serializeAddon, input),
    );

    expect(logicalLines(projection)).toEqual([`› ${input}`, "  status"]);
  });

  it("reflows the reported three-row CJK Codex composer without hard breaks", async () => {
    const source = new Terminal({ cols: 111, rows: 12, scrollback: 100, allowProposedApi: true });
    const serializeAddon = new SerializeAddon();
    source.loadAddon(serializeAddon);
    const firstVisualRow =
      "我的要求很简单，代码知识，除了  services.jsonl 和 capabilities.json之外，都必须要有meta.json，对应的jsonl中禁";
    const secondVisualRow =
      "止存储相同的冗余字段，构建索引时，自动拼接meta.json中的字段。按照这个思路，你梳理一下，哪些要修改？哪些知识可";
    const thirdVisualRow = "以直接修正，哪些服务的知识必须要重新抽取？";
    const input = firstVisualRow + secondVisualRow + thirdVisualRow;
    await writeTerminal(
      source,
      `\u001b[2J\u001b[H› ${firstVisualRow}` +
        `\u001b[2;3H${secondVisualRow}` +
        `\u001b[3;3H${thirdVisualRow}` +
        "\u001b7\u001b[5;3Hgpt-5.6-sol xhigh · ~/develop/synapse\u001b8",
    );

    const projection = new Terminal({
      cols: 38,
      rows: 18,
      scrollback: 100,
      allowProposedApi: true,
    });
    await writeTerminal(
      projection,
      serializeSnapshotProjection(source, serializeAddon, input),
    );

    expect(logicalLines(projection)).toEqual([
      `› ${input}`,
      "  gpt-5.6-sol xhigh · ~/develop/synapse",
    ]);
  });

  it("reflows Codex transcript rows that were wrapped for the desktop grid", async () => {
    const source = new Terminal({ cols: 24, rows: 8, scrollback: 100, allowProposedApi: true });
    const serializeAddon = new SerializeAddon();
    source.loadAddon(serializeAddon);
    await writeTerminal(
      source,
      "\u001b[2J\u001b[H\u001b[2m•\u001b[0m alpha beta gamma xx" +
        "\u001b[2;1H  continues here" +
        "\u001b[4;1H› " +
        "\u001b[4;3H",
    );

    const projection = new Terminal({
      cols: 10,
      rows: 14,
      scrollback: 100,
      allowProposedApi: true,
    });
    await writeTerminal(
      projection,
      serializeSnapshotProjection(source, serializeAddon, ""),
    );

    expect(logicalLines(projection)).toEqual([
      "• alpha beta gamma xx continues here",
      "› ",
    ]);
  });

  it("keeps Codex list and tool-tree rows as separate logical lines", async () => {
    const source = new Terminal({ cols: 24, rows: 8, scrollback: 100, allowProposedApi: true });
    const serializeAddon = new SerializeAddon();
    source.loadAddon(serializeAddon);
    await writeTerminal(
      source,
      "\u001b[2J\u001b[H\u001b[2m•\u001b[0m alpha beta gamma xx" +
        "\u001b[2;1H  - separate item" +
        "\u001b[3;1H  └ tool result" +
        "\u001b[5;1H› " +
        "\u001b[5;3H",
    );

    const projection = new Terminal({
      cols: 10,
      rows: 14,
      scrollback: 100,
      allowProposedApi: true,
    });
    await writeTerminal(
      projection,
      serializeSnapshotProjection(source, serializeAddon, ""),
    );

    expect(logicalLines(projection)).toEqual([
      "• alpha beta gamma xx",
      "  - separate item",
      "  └ tool result",
      "› ",
    ]);
  });

  it("keeps explicit composer newlines and later status rows separate", async () => {
    const source = new Terminal({ cols: 20, rows: 7, scrollback: 100, allowProposedApi: true });
    const serializeAddon = new SerializeAddon();
    source.loadAddon(serializeAddon);
    await writeTerminal(
      source,
      "\u001b[2J\u001b[H› first" +
        "\u001b[2;3Hsecond" +
        "\u001b[4;3Hstatus" +
        "\u001b[2;9H",
    );

    const projection = new Terminal({
      cols: 8,
      rows: 12,
      scrollback: 100,
      allowProposedApi: true,
    });
    await writeTerminal(
      projection,
      serializeSnapshotProjection(source, serializeAddon, "first\nsecond"),
    );

    expect(logicalLines(projection)).toEqual(["› first", "  second", "  status"]);
  });

  it("does not reinterpret similar rows in terminal history", async () => {
    const source = new Terminal({ cols: 20, rows: 9, scrollback: 100, allowProposedApi: true });
    const serializeAddon = new SerializeAddon();
    source.loadAddon(serializeAddon);
    const input = "abcdefghijklmnopqrstuvwxyza123";
    await writeTerminal(
      source,
      "\u001b[2J\u001b[H› old history row" +
        "\u001b[2;3Hstill history" +
        `\u001b[4;1H› ${input.slice(0, 17)}` +
        `\u001b[5;3H${input.slice(17)}` +
        "\u001b[7;3Hstatus" +
        "\u001b[5;16H",
    );

    const projection = new Terminal({
      cols: 8,
      rows: 16,
      scrollback: 100,
      allowProposedApi: true,
    });
    await writeTerminal(
      projection,
      serializeSnapshotProjection(source, serializeAddon, input),
    );

    expect(logicalLines(projection)).toEqual([
      "› old history row",
      "  still history",
      `› ${input}`,
      "  status",
    ]);
  });
});
