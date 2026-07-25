// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { XTERM_HTML } from "./terminal-webview-html";
import { TERMINAL_MOBILE_REFLOW_JS } from "./terminal-webview-mobile-reflow-injected";

function iifeSource(): string {
  const start = XTERM_HTML.indexOf("(function() {");
  const end = XTERM_HTML.lastIndexOf("})();");
  return XTERM_HTML.slice(start, end + "})();".length);
}

function bodyMarkup(): string {
  const start = XTERM_HTML.indexOf("<body>") + "<body>".length;
  const end = XTERM_HTML.indexOf("<script>", start);
  return XTERM_HTML.slice(start, end);
}

type PostedMessage = Record<string, unknown>;

type FakeLine = {
  isWrapped: boolean;
  translateToString(trimRight?: boolean, start?: number): string;
  getCell(col?: number): {
    getWidth(): number;
    getChars(): string;
    getBgColorMode?(): number;
    getBgColor?(): number;
    isAttributeDefault?(): boolean;
    extended: { urlId: number };
  };
};

class FakeTerminal {
  static instances: FakeTerminal[] = [];
  static deferNextOpenedWrite = false;
  static throwNextOpenedWrite = false;
  static deferredOpenedWrites: Array<() => void> = [];
  static nextOpenedWriteBaseY: number | null = null;
  static afterNextOpenedWriteCallback: (() => void) | null = null;

  static releaseDeferredOpenedWrites(): void {
    const pending = FakeTerminal.deferredOpenedWrites;
    FakeTerminal.deferredOpenedWrites = [];
    for (const finish of pending) finish();
  }

  cols: number;
  rows: number;
  options: Record<string, unknown>;
  modes: Record<string, unknown> = { mouseTrackingMode: "none" };
  element: { scrollWidth: number; scrollHeight: number } | null = null;
  allData = "";
  opened = false;
  openedSurface: HTMLElement | null = null;
  disposed = false;
  unstable = false;
  cursorGap = false;
  scrollToLineCalls: number[] = [];
  scrollToBottomCalls = 0;
  __mobileSnapshotCursor: { contentRow: number; col: number } | null = null;
  private writeParsedListeners: Array<() => void> = [];

  private readonly stableLine: FakeLine = {
    isWrapped: false,
    translateToString: (_trimRight, start = 0) =>
      this.cursorGap && start < 3 ? "abc".slice(start) : "",
    getCell: (col = 0) => ({
      getWidth: () => 1,
      getChars: () => (this.cursorGap && col < 3 ? "abc".charAt(col) : ""),
      extended: { urlId: 0 },
    }),
  };

  private readonly unstableLine: FakeLine = {
    isWrapped: false,
    translateToString: (_trimRight, start = 0) => (start === 0 ? "content-after-cursor" : ""),
    getCell: () => ({ getWidth: () => 1, getChars: () => "x", extended: { urlId: 0 } }),
  };

  readonly normalBuffer = {
    type: "normal",
    length: 1,
    baseY: 0,
    viewportY: 0,
    cursorX: 0,
    cursorY: 0,
    getLine: (_row: number) => (this.unstable ? this.unstableLine : this.stableLine),
  };

  readonly alternateBuffer = {
    ...this.normalBuffer,
    type: "alternate",
  };

  readonly buffer = {
    normal: this.normalBuffer,
    active: this.normalBuffer,
  };

  readonly _core = {
    buffer: { scrollTop: 0, scrollBottom: 0 },
    _renderService: {
      dimensions: { css: { cell: { width: 8, height: 15 } } },
    },
    _oscLinkService: { getLinkData: () => null },
  };

  constructor(options: { cols?: number; rows?: number; [key: string]: unknown }) {
    this.cols = options.cols ?? 80;
    this.rows = options.rows ?? 24;
    this.options = { ...options };
    this._core.buffer.scrollBottom = this.rows - 1;
    FakeTerminal.instances.push(this);
  }

  loadAddon(addon: { activate?: (terminal: FakeTerminal) => void }): void {
    addon.activate?.(this);
  }

  open(surface?: HTMLElement): void {
    this.opened = true;
    this.openedSurface = surface ?? null;
    const fontScale = Number(this.options.fontSize ?? 10) / 10;
    const cellWidth = 8 * fontScale;
    const cellHeight = 15 * fontScale;
    this._core._renderService.dimensions.css.cell.width = cellWidth;
    this._core._renderService.dimensions.css.cell.height = cellHeight;
    this.element = {
      scrollWidth: this.cols * cellWidth,
      scrollHeight: this.rows * cellHeight,
    };
  }

  write(data: string, callback?: () => void): void {
    if (this.opened && FakeTerminal.throwNextOpenedWrite) {
      FakeTerminal.throwNextOpenedWrite = false;
      throw new Error("projection write failed");
    }
    this.allData += data;
    if (data.includes("\u001b[?1049h")) {
      this.buffer.active = this.alternateBuffer;
    }
    if (data.includes("\u001b[?1049l")) {
      this.buffer.active = this.normalBuffer;
    }
    if (data.includes("\u001b[?7l")) {
      this.modes.wraparoundMode = false;
    }
    if (data.includes("\u001b[?7h")) {
      this.modes.wraparoundMode = true;
    }
    if (data.includes("\u001b[2H") || data.includes("\rprogress")) {
      this.unstable = true;
    }
    if (data.includes("stable-again")) {
      this.unstable = false;
    }
    if (data.endsWith("abc\u001b[10C")) {
      this.cursorGap = true;
      this.normalBuffer.cursorX = 13;
    }
    const finish = () => {
      callback?.();
      if (this.opened && FakeTerminal.afterNextOpenedWriteCallback) {
        const afterCallback = FakeTerminal.afterNextOpenedWriteCallback;
        FakeTerminal.afterNextOpenedWriteCallback = null;
        afterCallback();
      }
      for (const listener of this.writeParsedListeners) listener();
    };
    if (this.opened && FakeTerminal.nextOpenedWriteBaseY !== null) {
      this.normalBuffer.baseY = FakeTerminal.nextOpenedWriteBaseY;
      this.normalBuffer.viewportY = FakeTerminal.nextOpenedWriteBaseY;
      FakeTerminal.nextOpenedWriteBaseY = null;
    }
    if (this.opened && FakeTerminal.deferNextOpenedWrite) {
      FakeTerminal.deferNextOpenedWrite = false;
      FakeTerminal.deferredOpenedWrites.push(finish);
    } else if (!this.opened && data.includes("slow-live")) {
      setTimeout(finish, 80);
    } else {
      finish();
    }
  }

  resize(cols: number, rows: number): void {
    this.cols = cols;
    this.rows = rows;
    this._core.buffer.scrollBottom = rows - 1;
    if (this.element) {
      const cell = this._core._renderService.dimensions.css.cell;
      this.element.scrollWidth = cols * cell.width;
      this.element.scrollHeight = rows * cell.height;
    }
  }

  clear(): void {
    this.allData = "";
  }
  reset(): void {
    this.unstable = false;
    this.cursorGap = false;
    this.modes = { mouseTrackingMode: "none" };
    this.buffer.active = this.normalBuffer;
    this.normalBuffer.baseY = 0;
    this.normalBuffer.viewportY = 0;
    this.normalBuffer.cursorX = 0;
    this.normalBuffer.cursorY = 0;
  }
  refresh(): void {}
  clearSelection(): void {}
  selectAll(): void {}
  select(): void {}
  scrollLines(): void {}
  scrollToBottom(): void {
    this.scrollToBottomCalls++;
    this.buffer.active.viewportY = this.buffer.active.baseY;
  }
  scrollToLine(line: number): void {
    this.scrollToLineCalls.push(line);
    this.buffer.active.viewportY = line;
  }
  getSelection(): string {
    return "";
  }
  dispose(): void {
    this.disposed = true;
  }

  serializeActiveBuffer(): string {
    return this.allData
      .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, "")
      .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
      .replace(/\u009b[0-?]*[ -/]*[@-~]/g, "");
  }
  onLineFeed(): { dispose(): void } {
    return { dispose() {} };
  }
  onScroll(): { dispose(): void } {
    return { dispose() {} };
  }
  onWriteParsed(listener: () => void): { dispose(): void } {
    this.writeParsedListeners.push(listener);
    return {
      dispose: () => {
        this.writeParsedListeners = this.writeParsedListeners.filter(
          (candidate) => candidate !== listener,
        );
      },
    };
  }
}

class FakeSerializeAddon {
  static throwNextRange = false;
  private terminal: FakeTerminal | null = null;

  activate(terminal: FakeTerminal): void {
    this.terminal = terminal;
  }

  serialize(): string {
    return this.terminal?.allData ?? "";
  }

  _serializeBufferByRange(): string {
    if (FakeSerializeAddon.throwNextRange) {
      FakeSerializeAddon.throwNextRange = false;
      throw new Error("snapshot serialization failed");
    }
    return this.terminal?.serializeActiveBuffer() ?? "";
  }
}

function sendWebViewMessage(message: Record<string, unknown>): void {
  window.dispatchEvent(
    new MessageEvent("message", {
      data: JSON.stringify(message),
    }),
  );
}

function fireSurfaceTouch(type: string, touches: Array<{ x: number; y: number }>): void {
  const surface = document.getElementById("terminal-surface") as HTMLElement;
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "touches", {
    value: touches.map((point, index) => ({
      identifier: index,
      clientX: point.x,
      clientY: point.y,
      target: surface,
    })),
  });
  surface.dispatchEvent(event);
}

function collectProjectedOscLinks(
  source: Record<string, unknown>,
  targetCols: number,
): Array<{ row: number; startCol: number; endCol: number; uri: string }> {
  // eslint-disable-next-line no-new-func
  const collect = new Function(
    "source",
    "targetCols",
    `${TERMINAL_MOBILE_REFLOW_JS}\n` +
      "textScaleMode = 'mobile-reflow'; mobileReflowLayout = 'adaptive'; " +
      "mobileSourceTerm = source; return collectMobileProjectedOscLinks(targetCols);",
  ) as (
    source: Record<string, unknown>,
    targetCols: number,
  ) => Array<{ row: number; startCol: number; endCol: number; uri: string }>;
  return collect(source, targetCols);
}

function projectSourceCursor(
  source: Record<string, unknown>,
  targetCols: number,
  liveInputText = "",
): { contentRow: number; col: number } | null {
  return projectSourceSnapshotGeometry(source, targetCols, liveInputText).cursor;
}

function projectSourceSnapshotGeometry(
  source: Record<string, unknown>,
  targetCols: number,
  liveInputText = "",
): {
  cursor: { contentRow: number; col: number } | null;
  contentRows: number;
} {
  // eslint-disable-next-line no-new-func
  const project = new Function(
    "source",
    "targetCols",
    "liveInputText",
    `${TERMINAL_MOBILE_REFLOW_JS}\n` +
      "textScaleMode = 'mobile-reflow'; mobileReflowLayout = 'snapshot'; " +
      "mobileSourceTerm = source; mobileLiveInputText = liveInputText; " +
      "mobileSnapshotProjectionPlan = findMobileCodexSnapshotProjectionPlan(source.buffer.active); " +
      "var target = { options: {} }; " +
      "collectMobileProjectedOscLinks(targetCols, target); " +
      "return { cursor: target.__mobileSnapshotCursor || null, " +
      "contentRows: mobileProjectedContentRows };",
  ) as (
    source: Record<string, unknown>,
    targetCols: number,
    liveInputText: string,
  ) => {
    cursor: { contentRow: number; col: number } | null;
    contentRows: number;
  };
  return project(source, targetCols, liveInputText);
}

function projectionLine(
  cells: Array<{ chars: string; width?: number; background?: number }>,
  isWrapped = false,
): FakeLine {
  return {
    isWrapped,
    translateToString: (_trimRight, start = 0) =>
      cells
        .slice(start)
        .map((cell) => cell.chars)
        .join("")
        .trimEnd(),
    getCell: (col = 0) => ({
      getWidth: () => cells[col]?.width ?? 1,
      getChars: () => cells[col]?.chars ?? "",
      getBgColorMode: () => (cells[col]?.background === undefined ? 0 : 16_777_216),
      getBgColor: () => cells[col]?.background ?? -1,
      isAttributeDefault: () => cells[col]?.background === undefined,
      extended: { urlId: 0 },
    }),
  };
}

function sourceWithCursor(
  lines: FakeLine[],
  cursorRow: number,
  cursorCol: number,
  cols = 20,
): Record<string, unknown> {
  const active = {
    type: "alternate",
    length: lines.length,
    baseY: 0,
    viewportY: 0,
    cursorX: cursorCol,
    cursorY: cursorRow,
    getLine: (row: number) => lines[row],
    getNullCell: () => ({
      getWidth: () => 1,
      getChars: () => "",
      getBgColorMode: () => 0,
      getBgColor: () => -1,
      isAttributeDefault: () => true,
      extended: { urlId: 0 },
    }),
  };
  return {
    cols,
    rows: lines.length,
    buffer: { active, normal: active },
  };
}

let runtimeBooted = false;
let activePostedMessages: PostedMessage[] = [];

function boot(
  initialData = "a desktop logical line that should wrap on the phone",
  viewport: { cols: number; rows: number } = { cols: 228, rows: 70 },
): PostedMessage[] {
  FakeTerminal.instances = [];
  const posted: PostedMessage[] = [];
  activePostedMessages = posted;
  if (!runtimeBooted) {
    const webWindow = window as unknown as {
      Terminal: typeof FakeTerminal;
      SerializeAddon: { SerializeAddon: typeof FakeSerializeAddon };
      ReactNativeWebView: { postMessage(message: string): void };
    };
    webWindow.Terminal = FakeTerminal;
    webWindow.SerializeAddon = { SerializeAddon: FakeSerializeAddon };
    webWindow.ReactNativeWebView = {
      postMessage(message: string) {
        activePostedMessages.push(JSON.parse(message));
      },
    };
    document.body.innerHTML = bodyMarkup();
    // eslint-disable-next-line no-new-func
    new Function(iifeSource())();
    runtimeBooted = true;
  }
  sendWebViewMessage({ type: "set-auto-scroll-disabled", disabled: false });
  sendWebViewMessage({
    type: "init",
    cols: viewport.cols,
    rows: viewport.rows,
    initialData,
    fontScale: 1,
    textScaleMode: "mobile-reflow",
    preserveFullInitialData: true,
  });
  return posted;
}

const settle = (milliseconds = 80): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

describe("terminal WebView mobile reflow", () => {
  it("keeps a high-contrast cursor visible in the adaptive projection", () => {
    expect(TERMINAL_MOBILE_REFLOW_JS).toContain("cursorBlink: true");
    expect(TERMINAL_MOBILE_REFLOW_JS).toContain("cursorStyle: 'bar'");
    expect(TERMINAL_MOBILE_REFLOW_JS).toContain("cursorInactiveStyle: 'bar'");
    expect(TERMINAL_MOBILE_REFLOW_JS).toContain("cursorWidth: 3");
    expect(TERMINAL_MOBILE_REFLOW_JS).toContain("replace(/\\x1b\\[\\?25l/g, '\\x1b[?25h')");
    expect(TERMINAL_MOBILE_REFLOW_JS).toContain("ensureTerminalCursorVisible(source);");
  });

  it("resolves the independent cursor overlay from the visible buffer position", () => {
    const start = XTERM_HTML.indexOf("function resolveCursorOverlayPosition(");
    const end = XTERM_HTML.indexOf("function updateCursorOverlay()", start);
    const functionSource = XTERM_HTML.slice(start, end);
    // eslint-disable-next-line no-new-func
    const resolvePosition = new Function(
      `${functionSource}; return resolveCursorOverlayPosition;`,
    )() as (
      buffer: { baseY: number; cursorY: number; viewportY: number; cursorX: number },
      cols: number,
      rows: number,
      cellW: number,
      cellH: number,
      projectedCursor?: { contentRow: number; col: number },
      projectedRowOffset?: number,
    ) => { x: number; y: number; height: number } | null;

    expect(
      resolvePosition({ baseY: 0, cursorY: 2, viewportY: 0, cursorX: 4 }, 45, 42, 8, 15),
    ).toEqual({ x: 32, y: 30, height: 15 });
    expect(
      resolvePosition({ baseY: 20, cursorY: 2, viewportY: 30, cursorX: 4 }, 45, 42, 8, 15),
    ).toBeNull();
    expect(
      resolvePosition({ baseY: 20, cursorY: 0, viewportY: 20, cursorX: 0 }, 45, 42, 8, 15),
    ).toEqual({ x: 0, y: 0, height: 15 });
    expect(
      resolvePosition(
        { baseY: 80, cursorY: 20, viewportY: 30, cursorX: 44 },
        45,
        42,
        8,
        15,
        { contentRow: 42, col: 7 },
        10,
      ),
    ).toEqual({ x: 56, y: 30, height: 15 });
  });

  it("maps the source cursor independently from content on later status rows", () => {
    const input = projectionLine(Array.from("prompt text").map((chars) => ({ chars })));
    const status = projectionLine(Array.from("gpt-5.6-sol xhigh").map((chars) => ({ chars })));

    expect(projectSourceCursor(sourceWithCursor([input, status], 0, 6), 8)).toEqual({
      contentRow: 0,
      col: 6,
    });
    expect(projectSourceCursor(sourceWithCursor([input, status], 0, 10), 8)).toEqual({
      contentRow: 1,
      col: 2,
    });
  });

  it("maps source soft wraps and double-width cells to phone cursor coordinates", () => {
    const first = projectionLine(Array.from("abcdefghij").map((chars) => ({ chars })));
    const continuation = projectionLine(
      Array.from("klm").map((chars) => ({ chars })),
      true,
    );
    expect(projectSourceCursor(sourceWithCursor([first, continuation], 1, 3, 10), 6)).toEqual({
      contentRow: 2,
      col: 1,
    });

    const wide = projectionLine([
      { chars: "a" },
      { chars: "b" },
      { chars: "c" },
      { chars: "界", width: 2 },
      { chars: "", width: 0 },
    ]);
    expect(projectSourceCursor(sourceWithCursor([wide], 0, 5, 8), 4)).toEqual({
      contentRow: 1,
      col: 2,
    });
  });

  it("maps the cursor through joined Codex composer visual rows", () => {
    const input = "abcdefghijklmnopqrstuvwxyza123";
    const firstVisualRow = input.slice(0, 17);
    const secondVisualRow = input.slice(17);
    const promptCells = Array.from({ length: 20 }, () => ({ chars: "", background: 236 }));
    const continuationCells = Array.from({ length: 20 }, () => ({
      chars: "",
      background: 236,
    }));
    Array.from(`› ${firstVisualRow}`).forEach((chars, index) => {
      promptCells[index] = { chars, background: 236 };
    });
    Array.from(secondVisualRow).forEach((chars, index) => {
      continuationCells[index + 2] = { chars, background: 236 };
    });
    const prompt = projectionLine(promptCells);
    const continuation = projectionLine(continuationCells);
    const status = projectionLine(Array.from("  status").map((chars) => ({ chars })));

    expect(
      projectSourceCursor(
        sourceWithCursor([prompt, continuation, status], 1, secondVisualRow.length + 2),
        9,
        input,
      ),
    ).toEqual({ contentRow: 3, col: 5 });
  });

  it("does not count styled trailing blanks as projected cursor rows", () => {
    const history = Array.from({ length: 50 }, (_, index) =>
      projectionLine(Array.from(`H${index}`).map((chars) => ({ chars }))),
    );
    const prompt = projectionLine(Array.from("PROMPT").map((chars) => ({ chars })));
    const status = projectionLine([
      ...Array.from("STATUS").map((chars) => ({ chars, background: 236 })),
      ...Array.from({ length: 14 }, () => ({ chars: "", background: 236 })),
    ]);

    expect(
      projectSourceSnapshotGeometry(sourceWithCursor([...history, prompt, status], 50, 6, 20), 8),
    ).toEqual({
      cursor: { contentRow: 50, col: 6 },
      contentRows: 52,
    });
  });

  it("counts styled blanks that serialization advances before a background reset", () => {
    const history = Array.from({ length: 50 }, (_, index) =>
      projectionLine(Array.from(`H${index}`).map((chars) => ({ chars }))),
    );
    const prompt = projectionLine(Array.from("PROMPT").map((chars) => ({ chars })));
    const status = projectionLine([
      ...Array.from("STATUS").map((chars) => ({ chars, background: 236 })),
      ...Array.from({ length: 4 }, () => ({ chars: "", background: 236 })),
      ...Array.from({ length: 10 }, () => ({ chars: "" })),
    ]);

    expect(
      projectSourceSnapshotGeometry(sourceWithCursor([...history, prompt, status], 50, 6, 20), 8),
    ).toEqual({
      cursor: { contentRow: 50, col: 6 },
      contentRows: 53,
    });
  });

  beforeEach(() => {
    Object.defineProperty(window, "innerWidth", { value: 360, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 630, configurable: true });
    FakeTerminal.deferNextOpenedWrite = false;
    FakeTerminal.throwNextOpenedWrite = false;
    FakeTerminal.deferredOpenedWrites = [];
    FakeTerminal.nextOpenedWriteBaseY = null;
    FakeTerminal.afterNextOpenedWriteCallback = null;
    FakeSerializeAddon.throwNextRange = false;
  });

  it("keeps a desktop-grid source model and exposes a phone-width normal-buffer projection", async () => {
    const posted = boot();
    await settle();

    expect(FakeTerminal.instances).toHaveLength(2);
    const [source, projection] = FakeTerminal.instances;
    expect(source).toMatchObject({ cols: 228, rows: 70, opened: false });
    expect(source?.options.fontSize).toBe(10);
    expect(source?.options.scrollback).toBe(30000);
    expect(projection).toMatchObject({ cols: 45, rows: 42, opened: true });
    expect(projection?.options.fontSize).toBe(10);
    expect(projection?.options.cursorInactiveStyle).toBe("bar");
    expect(posted).toContainEqual({ type: "ready", cols: 45, rows: 42 });
    expect(posted).toContainEqual(
      expect.objectContaining({
        type: "diagnostic",
        event: "terminal-ready",
        metrics: expect.objectContaining({
          mobileLayout: "adaptive",
          sourceCols: 228,
          sourceRows: 70,
          cols: 45,
          rows: 42,
        }),
      }),
    );
  });

  it("writes line-oriented live output to both the canonical source and visible projection", async () => {
    boot("initial\r\n");
    await settle();
    const [source, projection] = FakeTerminal.instances;

    sendWebViewMessage({ type: "write", data: "\u001b[32mhello\u001b[0m\r\n" });
    await settle();

    expect(source?.allData).toContain("\u001b[32mhello\u001b[0m\r\n");
    expect(projection?.allData).toContain("\u001b[32mhello\u001b[0m\r\n");
    expect(projection?.disposed).toBe(false);
  });

  it("projects alternate-screen snapshots at phone width", async () => {
    const posted = boot("\u001b[?1049h\u001b[2J\u001b[Hfull screen");
    await settle();

    expect(FakeTerminal.instances).toHaveLength(2);
    const [source, projection] = FakeTerminal.instances;
    expect(source).toMatchObject({ cols: 228, rows: 70, opened: false, disposed: false });
    expect(source?.options.scrollback).toBe(30000);
    expect(projection).toMatchObject({
      cols: 45,
      rows: 42,
      opened: true,
      disposed: false,
    });
    expect(projection?.options.cursorInactiveStyle).toBe("none");
    expect(projection?.allData).toContain("full screen");
    expect(posted).toContainEqual({ type: "ready", cols: 45, rows: 42 });
    expect(posted).toContainEqual(
      expect.objectContaining({
        type: "diagnostic",
        event: "terminal-ready",
        metrics: expect.objectContaining({ mobileLayout: "snapshot" }),
      }),
    );
    expect(posted).toContainEqual(
      expect.objectContaining({
        type: "diagnostic",
        event: "fit-scale",
        metrics: expect.objectContaining({
          fitScale: 1,
          expectedHeight: 630,
        }),
      }),
    );
  });

  it.each([24, 70, 120])(
    "uses the same phone viewport for a %s-row Codex snapshot",
    async (rows) => {
      const posted = boot("\u001b[?1049h\u001b[2J\u001b[Hfull screen", { cols: 228, rows });
      await settle();

      const projection = FakeTerminal.instances[1];
      expect(projection).toMatchObject({ cols: 45, rows: 42, opened: true });
      expect(projection?.options.fontSize).toBe(10);
      expect(posted).toContainEqual(
        expect.objectContaining({
          type: "diagnostic",
          event: "terminal-ready",
          metrics: expect.objectContaining({
            mobileLayout: "snapshot",
            sourceRows: rows,
            cols: 45,
            rows: 42,
          }),
        }),
      );
    },
  );

  it("wraps a long desktop row inside the phone-width snapshot", async () => {
    const desktopLine = "x".repeat(120);
    boot(`\u001b[?1049h\u001b[2J\u001b[H${desktopLine}`);
    await settle();

    const projection = FakeTerminal.instances[1];
    expect(projection).toMatchObject({ cols: 45, rows: 42 });
    expect(projection?.allData).toContain(desktopLine);
    expect(Math.ceil(desktopLine.length / (projection?.cols ?? 1))).toBe(3);
  });

  it("keeps mouse-aware TUIs on the exact source grid with a full-height touch surface", async () => {
    const posted = boot("\u001b[?1000hmouse screen", { cols: 228, rows: 24 });
    await settle();

    expect(FakeTerminal.instances).toHaveLength(1);
    expect(FakeTerminal.instances[0]).toMatchObject({
      cols: 228,
      rows: 24,
      opened: true,
      disposed: false,
    });
    expect(FakeTerminal.instances[0]?.element?.scrollHeight).toBe(360);
    expect(document.getElementById("terminal-surface")?.style.minHeight).toBe("630px");
    expect(posted).toContainEqual(
      expect.objectContaining({
        type: "diagnostic",
        event: "terminal-ready",
        metrics: expect.objectContaining({ mobileLayout: "source" }),
      }),
    );
  });

  it("falls back to a visible source terminal when snapshot serialization fails", async () => {
    FakeSerializeAddon.throwNextRange = true;
    const posted = boot("\u001b[?1049hfull screen");
    await settle();

    expect(FakeTerminal.instances).toHaveLength(1);
    expect(FakeTerminal.instances[0]).toMatchObject({
      cols: 228,
      rows: 70,
      opened: true,
      disposed: false,
    });
    expect(document.getElementById("terminal-surface")?.style.visibility).toBe("visible");
    expect(posted).toContainEqual(expect.objectContaining({ type: "error", fatal: false }));
    expect(posted).toContainEqual(
      expect.objectContaining({
        type: "diagnostic",
        event: "terminal-ready",
        metrics: expect.objectContaining({ mobileLayout: "source" }),
      }),
    );
  });

  it("rebuilds a phone-width snapshot when content remains after the cursor", async () => {
    const posted = boot("initial\r\n");
    await settle();
    const [source, projection] = FakeTerminal.instances;

    sendWebViewMessage({ type: "write", data: "\u001b[2Hupdated" });
    await settle(220);

    const snapshot = FakeTerminal.instances[2];
    expect(source?.opened).toBe(false);
    expect(projection?.disposed).toBe(true);
    expect(snapshot).toMatchObject({ cols: 45, rows: 42, opened: true, disposed: false });
    expect(snapshot?.options.cursorInactiveStyle).toBe("none");
    expect(snapshot?.allData).toContain("updated");
    expect(posted.some((message) => message.type === "mobile-reflow-refresh")).toBe(false);
    expect(posted).toContainEqual(
      expect.objectContaining({
        type: "diagnostic",
        event: "mobile-reflow-layout",
        metrics: expect.objectContaining({ layout: "snapshot" }),
      }),
    );
  });

  it("projects a snapshot when the source application disables automatic wrapping", async () => {
    const posted = boot("initial\r\n");
    await settle();

    sendWebViewMessage({ type: "write", data: "\u001b[?7lno-wrap-output" });
    await settle(220);

    expect(FakeTerminal.instances[0]?.opened).toBe(false);
    expect(FakeTerminal.instances[2]).toMatchObject({ cols: 45, rows: 42, opened: true });
    expect(FakeTerminal.instances[2]?.allData).toContain("no-wrap-output");
    expect(posted).toContainEqual(
      expect.objectContaining({
        type: "diagnostic",
        event: "mobile-reflow-layout",
        metrics: expect.objectContaining({ layout: "snapshot" }),
      }),
    );
  });

  it("projects cursor-gap snapshots without restoring desktop cursor columns", async () => {
    const posted = boot("abc\u001b[10C");
    await settle();

    expect(FakeTerminal.instances).toHaveLength(2);
    expect(FakeTerminal.instances[0]).toMatchObject({ opened: false, cols: 228, rows: 70 });
    expect(FakeTerminal.instances[1]).toMatchObject({ opened: true, cols: 45, rows: 42 });
    expect(FakeTerminal.instances[1]?.allData).toBe("abc");
    expect(FakeTerminal.instances[1]?.__mobileSnapshotCursor).toEqual({
      contentRow: 0,
      col: 13,
    });
    expect(posted).toContainEqual(
      expect.objectContaining({
        type: "diagnostic",
        event: "terminal-ready",
        metrics: expect.objectContaining({ mobileLayout: "snapshot" }),
      }),
    );
  });

  it("resets the mapped snapshot cursor when the terminal is cleared", async () => {
    boot("abc\u001b[10C");
    await settle();
    const snapshot = FakeTerminal.instances[1];

    sendWebViewMessage({ type: "clear" });

    expect(snapshot?.__mobileSnapshotCursor).toEqual({ contentRow: 0, col: 0 });
    expect(snapshot?.options.cursorInactiveStyle).toBe("none");
  });

  it("keeps a locked history viewport stable until a complex live snapshot is complete", async () => {
    boot("initial\r\n");
    await settle();
    sendWebViewMessage({ type: "set-auto-scroll-disabled", disabled: true });
    const oldProjection = FakeTerminal.instances[1];
    const oldSurface = oldProjection?.openedSurface;
    oldProjection.normalBuffer.baseY = 100;
    oldProjection.normalBuffer.viewportY = 60;
    FakeTerminal.nextOpenedWriteBaseY = 200;
    FakeTerminal.deferNextOpenedWrite = true;

    sendWebViewMessage({ type: "write", data: "\u001b[2Hupdated" });
    await settle(150);

    const pendingProjection = FakeTerminal.instances[2];
    expect(pendingProjection).toMatchObject({ cols: 45, rows: 42, opened: true });
    expect(oldSurface?.style.visibility).toBe("visible");
    expect(pendingProjection?.openedSurface?.style.visibility).toBe("hidden");
    expect(oldProjection.disposed).toBe(false);
    expect(document.getElementById("terminal-container")?.children).toHaveLength(2);

    FakeTerminal.releaseDeferredOpenedWrites();
    await settle();

    expect(pendingProjection?.openedSurface?.style.visibility).toBe("visible");
    expect(pendingProjection?.scrollToLineCalls).toContain(60);
    expect(oldProjection.disposed).toBe(true);
    expect(document.getElementById("terminal-container")?.children).toHaveLength(1);
    expect(document.querySelectorAll("#terminal-surface")).toHaveLength(1);
  });

  it("follows the latest output by default after a complex snapshot replacement", async () => {
    boot("initial\r\n");
    await settle();
    const oldProjection = FakeTerminal.instances[1];
    oldProjection.normalBuffer.baseY = 100;
    oldProjection.normalBuffer.viewportY = 60;
    FakeTerminal.nextOpenedWriteBaseY = 200;

    sendWebViewMessage({ type: "write", data: "\u001b[2Hupdated" });
    await settle(220);

    const replacement = FakeTerminal.instances[2];
    expect(replacement?.scrollToBottomCalls).toBeGreaterThan(0);
    expect(replacement?.normalBuffer.viewportY).toBe(200);
  });

  it("does not replace the visible projection while a touch gesture is active", async () => {
    boot("initial\r\n");
    await settle();
    fireSurfaceTouch("touchstart", [{ x: 180, y: 280 }]);

    sendWebViewMessage({ type: "write", data: "\u001b[2Hupdated" });
    await settle(180);
    expect(FakeTerminal.instances).toHaveLength(2);

    fireSurfaceTouch("touchend", []);
    await settle(240);
    expect(FakeTerminal.instances).toHaveLength(3);
  });

  it("resumes a deferred adaptive refresh without switching to a snapshot", async () => {
    const posted = boot("initial\r\n");
    await settle();

    sendWebViewMessage({ type: "write", data: "\u001b[2Jstable screen" });
    fireSurfaceTouch("touchstart", [{ x: 180, y: 280 }]);
    await settle(180);

    expect(posted.some((message) => message.type === "mobile-reflow-refresh")).toBe(false);
    expect(FakeTerminal.instances).toHaveLength(2);

    fireSurfaceTouch("touchend", []);
    await settle(220);

    expect(posted.filter((message) => message.type === "mobile-reflow-refresh")).toHaveLength(1);
    expect(FakeTerminal.instances).toHaveLength(2);
  });

  it("falls back to the source grid when a hidden snapshot write fails", async () => {
    const posted = boot("initial\r\n");
    await settle();
    const oldProjection = FakeTerminal.instances[1];
    const oldSurface = oldProjection?.openedSurface;
    FakeTerminal.throwNextOpenedWrite = true;

    sendWebViewMessage({ type: "write", data: "\u001b[2Hupdated" });
    await settle(180);

    const failedProjection = FakeTerminal.instances[2];
    expect(failedProjection?.disposed).toBe(true);
    expect(oldProjection.disposed).toBe(true);
    expect(oldSurface?.style.visibility).toBe("visible");
    expect(FakeTerminal.instances[0]).toMatchObject({ opened: true, cols: 228, rows: 70 });
    expect(document.getElementById("terminal-container")?.children).toHaveLength(1);
    expect(document.querySelectorAll("#terminal-surface")).toHaveLength(1);
    expect(posted).toContainEqual(expect.objectContaining({ type: "error", fatal: false }));
  });

  it("keeps the visible terminal usable when clear interrupts a snapshot fit", async () => {
    boot("initial\r\n");
    await settle();
    const oldProjection = FakeTerminal.instances[1];
    const oldSurface = oldProjection?.openedSurface;
    FakeTerminal.afterNextOpenedWriteCallback = () => {
      sendWebViewMessage({ type: "clear" });
    };

    sendWebViewMessage({ type: "write", data: "\u001b[2Hupdated" });
    await settle(180);

    expect(FakeTerminal.instances[2]?.disposed).toBe(true);
    expect(oldProjection.disposed).toBe(false);
    expect(oldSurface?.id).toBe("terminal-surface");
    expect(document.getElementById("terminal-container")?.children).toHaveLength(1);

    sendWebViewMessage({ type: "write", data: "after-clear\r\n" });
    await settle();
    expect(oldProjection.allData).toContain("after-clear\r\n");
  });

  it("keeps history re-init atomic and restores distance from the bottom", async () => {
    boot("current history\r\n");
    await settle();
    const oldProjection = FakeTerminal.instances[1];
    const oldSurface = oldProjection?.openedSurface;
    oldProjection.normalBuffer.baseY = 120;
    oldProjection.normalBuffer.viewportY = 80;
    FakeTerminal.nextOpenedWriteBaseY = 240;
    FakeTerminal.deferNextOpenedWrite = true;

    sendWebViewMessage({
      type: "init",
      cols: 228,
      rows: 70,
      initialData: "older history\r\ncurrent history\r\n",
      fontScale: 1,
      textScaleMode: "mobile-reflow",
      preserveScroll: true,
      preserveFullInitialData: true,
    });
    await settle(40);

    const replacement = FakeTerminal.instances.at(-1);
    expect(oldSurface?.style.visibility).toBe("visible");
    expect(replacement?.openedSurface?.style.visibility).toBe("hidden");
    expect(oldProjection.disposed).toBe(false);

    FakeTerminal.releaseDeferredOpenedWrites();
    await settle();

    expect(replacement?.openedSurface?.style.visibility).toBe("visible");
    expect(replacement?.scrollToLineCalls).toContain(200);
    expect(oldProjection.disposed).toBe(true);
    expect(document.getElementById("terminal-container")?.children).toHaveLength(1);
  });

  it("coalesces complex but stable normal output into one RN projection refresh", async () => {
    const posted = boot("initial\r\n");
    await settle();

    sendWebViewMessage({ type: "write", data: "\u001b[2Jstable screen" });
    sendWebViewMessage({ type: "write", data: "\u001b[2Kmore stable output" });
    await settle(220);

    expect(posted.filter((message) => message.type === "mobile-reflow-refresh")).toHaveLength(1);
  });

  it("replays bare line feeds and tabs whose cursor columns depend on the grid width", async () => {
    const posted = boot("initial\r\n");
    await settle();
    const projection = FakeTerminal.instances[1];

    sendWebViewMessage({ type: "write", data: "column\tvalue\nnext" });
    await settle(220);

    expect(projection?.allData).not.toContain("column\tvalue\nnext");
    expect(posted.filter((message) => message.type === "mobile-reflow-refresh")).toHaveLength(1);
  });

  it("waits for an ANSI sequence split across network chunks before replaying", async () => {
    const posted = boot("initial\r\n");
    await settle();

    sendWebViewMessage({ type: "write", data: "\u001b[38;2;10" });
    await settle(220);
    expect(posted.some((message) => message.type === "mobile-reflow-refresh")).toBe(false);

    sendWebViewMessage({ type: "write", data: ";20;30mcolored\u001b[0m\r\n" });
    await settle(220);
    expect(posted.filter((message) => message.type === "mobile-reflow-refresh")).toHaveLength(1);
  });

  it("waits for a CRLF split across network chunks without switching layouts", async () => {
    const posted = boot("initial\r\n");
    await settle();

    sendWebViewMessage({ type: "write", data: "line\r" });
    await settle(80);
    expect(FakeTerminal.instances[0]?.opened).toBe(false);
    expect(posted.some((message) => message.type === "mobile-reflow-refresh")).toBe(false);

    sendWebViewMessage({ type: "write", data: "\nnext" });
    await settle(220);
    expect(FakeTerminal.instances[0]?.opened).toBe(false);
    expect(posted.filter((message) => message.type === "mobile-reflow-refresh")).toHaveLength(1);
  });

  it("rebuilds at larger font metrics after pinch zoom instead of keeping a wide canvas", async () => {
    const posted = boot("a long logical line that can wrap at several phone widths");
    await settle();

    fireSurfaceTouch("touchstart", [
      { x: 130, y: 240 },
      { x: 230, y: 240 },
    ]);
    fireSurfaceTouch("touchmove", [
      { x: 80, y: 240 },
      { x: 280, y: 240 },
    ]);
    fireSurfaceTouch("touchend", []);
    await settle(220);

    expect(posted.filter((message) => message.type === "mobile-reflow-refresh")).toHaveLength(1);
    expect(posted).toContainEqual({ type: "font-scale-changed", fontScale: 2 });

    sendWebViewMessage({
      type: "init",
      cols: 228,
      rows: 70,
      initialData: "a long logical line that can wrap at several phone widths",
      fontScale: 2,
      textScaleMode: "mobile-reflow",
      preserveScroll: true,
      preserveFullInitialData: true,
    });
    await settle();

    const projection = FakeTerminal.instances.at(-1);
    expect(projection).toMatchObject({ cols: 22, rows: 21, opened: true });
    expect(document.getElementById("terminal-surface")?.style.visibility).toBe("visible");
  });

  it("measures each snapshot replacement at its target font across repeated pinch zoom", async () => {
    const posted = boot("\u001b[?1049h\u001b[2J\u001b[Hfull screen");
    await settle();

    fireSurfaceTouch("touchstart", [
      { x: 130, y: 240 },
      { x: 230, y: 240 },
    ]);
    fireSurfaceTouch("touchmove", [
      { x: 80, y: 240 },
      { x: 280, y: 240 },
    ]);
    fireSurfaceTouch("touchend", []);
    await settle(220);

    const enlarged = FakeTerminal.instances.at(-1);
    expect(enlarged).toMatchObject({ cols: 22, rows: 21, opened: true });
    expect(enlarged?.options.fontSize).toBe(20);
    expect(enlarged?.openedSurface?.style.transform).toContain("scale(1)");

    fireSurfaceTouch("touchstart", [
      { x: 80, y: 240 },
      { x: 280, y: 240 },
    ]);
    fireSurfaceTouch("touchmove", [
      { x: 155, y: 240 },
      { x: 205, y: 240 },
    ]);
    fireSurfaceTouch("touchend", []);
    await settle(220);

    const reduced = FakeTerminal.instances.at(-1);
    expect(reduced).toMatchObject({ cols: 90, rows: 84, opened: true });
    expect(reduced?.options.fontSize).toBe(5);
    expect(reduced?.openedSurface?.style.transform).toContain("scale(1)");
    expect(enlarged?.disposed).toBe(true);
    expect(document.querySelectorAll("#terminal-surface")).toHaveLength(1);
    expect(document.getElementById("terminal-container")?.children).toHaveLength(1);
    expect(posted.filter((message) => message.type === "mobile-reflow-refresh")).toHaveLength(0);
  });

  it("uses the exact half-size font metrics at the smallest text preset", async () => {
    boot("a long logical line that should remain readable at the smallest preset");
    await settle();

    sendWebViewMessage({
      type: "init",
      cols: 228,
      rows: 70,
      initialData: "a long logical line that should remain readable at the smallest preset",
      fontScale: 0.5,
      textScaleMode: "mobile-reflow",
      preserveScroll: true,
      preserveFullInitialData: true,
    });
    await settle();

    const projection = FakeTerminal.instances.at(-1);
    expect(projection?.options.fontSize).toBe(5);
  });

  it("resizes rows in place when the keyboard changes only viewport height", async () => {
    const posted = boot("initial\r\n");
    await settle();
    const projection = FakeTerminal.instances[1];

    Object.defineProperty(window, "innerHeight", { value: 420, configurable: true });
    window.dispatchEvent(new Event("resize"));
    await settle(80);

    expect(projection).toMatchObject({ cols: 45, rows: 28, disposed: false });
    expect(posted.some((message) => message.type === "mobile-reflow-refresh")).toBe(false);
  });

  it("requests one replay when an orientation change alters phone columns", async () => {
    const posted = boot("initial\r\n");
    await settle();

    Object.defineProperty(window, "innerWidth", { value: 640, configurable: true });
    window.dispatchEvent(new Event("resize"));
    await settle(220);

    expect(posted.filter((message) => message.type === "mobile-reflow-refresh")).toHaveLength(1);
  });

  it("ignores a delayed write callback from a terminal generation that was replaced", async () => {
    boot("initial\r\n");
    await settle();

    sendWebViewMessage({ type: "write", data: "slow-live\r\n" });
    sendWebViewMessage({
      type: "init",
      cols: 228,
      rows: 70,
      initialData: "replacement\r\n",
      fontScale: 1,
      textScaleMode: "mobile-reflow",
      preserveScroll: true,
      preserveFullInitialData: true,
    });
    await settle(160);

    const projection = FakeTerminal.instances.at(-1);
    expect(projection?.allData).toContain("replacement\r\n");
    expect(projection?.allData).not.toContain("slow-live\r\n");
  });

  it("cleans up cancelled replacement surfaces after rapid consecutive replays", async () => {
    boot("initial\r\n");
    await settle();

    for (let index = 0; index < 3; index++) {
      sendWebViewMessage({
        type: "init",
        cols: 228,
        rows: 70,
        initialData: `replacement-${index}\r\n`,
        fontScale: 1,
        textScaleMode: "mobile-reflow",
        preserveScroll: true,
        preserveFullInitialData: true,
      });
    }
    await settle(160);

    const surfaces = document.getElementById("terminal-container")?.children ?? [];
    expect(surfaces).toHaveLength(1);
    expect(document.querySelectorAll("#terminal-surface")).toHaveLength(1);
    expect(
      FakeTerminal.instances.filter((terminal) => terminal.opened && !terminal.disposed),
    ).toHaveLength(1);
  });

  it("returns to adaptive layout after continuous stable control output becomes quiet", async () => {
    const posted = boot("initial\r\n");
    await settle();

    for (let index = 0; index < 7; index++) {
      sendWebViewMessage({ type: "write", data: `\u001b[2Kframe-${index}` });
      await settle(90);
    }
    await settle(180);

    expect(FakeTerminal.instances[0]?.opened).toBe(false);
    expect(posted.filter((message) => message.type === "mobile-reflow-refresh")).toHaveLength(1);
  });

  it("keeps OSC 8 link columns aligned across leading spaces and phone wraps", () => {
    const values = [" ", " ", " ", "l", "i", "n", "k"];
    const source = {
      cols: 12,
      buffer: {
        normal: {
          length: 1,
          getLine: () => ({
            isWrapped: false,
            getCell: (col: number) => ({
              getWidth: () => 1,
              getChars: () => values[col] ?? "",
              isAttributeDefault: () => true,
              extended: { urlId: col >= 3 && col <= 6 ? 1 : 0 },
            }),
          }),
        },
      },
      _core: {
        _oscLinkService: {
          getLinkData: (id: number) => (id === 1 ? { uri: "https://example.com" } : null),
        },
      },
    };

    expect(collectProjectedOscLinks(source, 5)).toEqual([
      { row: 0, startCol: 3, endCol: 5, uri: "https://example.com" },
      { row: 1, startCol: 0, endCol: 2, uri: "https://example.com" },
    ]);
  });
});
