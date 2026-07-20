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
    extended: { urlId: number };
  };
};

class FakeTerminal {
  static instances: FakeTerminal[] = [];

  cols: number;
  rows: number;
  options: Record<string, unknown>;
  modes: Record<string, unknown> = { mouseTrackingMode: "none" };
  element: { scrollWidth: number; scrollHeight: number } | null = null;
  allData = "";
  opened = false;
  disposed = false;
  unstable = false;
  cursorGap = false;
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

  open(): void {
    this.opened = true;
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
      for (const listener of this.writeParsedListeners) listener();
    };
    if (!this.opened && data.includes("slow-live")) {
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

  clear(): void {}
  reset(): void {}
  refresh(): void {}
  clearSelection(): void {}
  selectAll(): void {}
  select(): void {}
  scrollLines(): void {}
  scrollToBottom(): void {}
  scrollToLine(): void {}
  getSelection(): string {
    return "";
  }
  dispose(): void {
    this.disposed = true;
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
  private terminal: FakeTerminal | null = null;

  activate(terminal: FakeTerminal): void {
    this.terminal = terminal;
  }

  serialize(): string {
    return this.terminal?.allData ?? "";
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
      "mobileSourceTerm = source; return collectMobileProjectedOscLinks(targetCols);",
  ) as (
    source: Record<string, unknown>,
    targetCols: number,
  ) => Array<{ row: number; startCol: number; endCol: number; uri: string }>;
  return collect(source, targetCols);
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
    const resolvePosition = new Function(`${functionSource}; return resolveCursorOverlayPosition;`)() as (
      buffer: { baseY: number; cursorY: number; viewportY: number; cursorX: number },
      cols: number,
      rows: number,
      cellW: number,
      cellH: number,
    ) => { x: number; y: number; height: number } | null;

    expect(resolvePosition({ baseY: 0, cursorY: 2, viewportY: 0, cursorX: 4 }, 45, 42, 8, 15))
      .toEqual({ x: 32, y: 30, height: 15 });
    expect(resolvePosition({ baseY: 20, cursorY: 2, viewportY: 30, cursorX: 4 }, 45, 42, 8, 15))
      .toBeNull();
    expect(resolvePosition({ baseY: 20, cursorY: 0, viewportY: 20, cursorX: 0 }, 45, 42, 8, 15))
      .toEqual({ x: 0, y: 0, height: 15 });
  });

  beforeEach(() => {
    Object.defineProperty(window, "innerWidth", { value: 360, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 630, configurable: true });
  });

  it("keeps a desktop-grid source model and exposes a phone-width normal-buffer projection", async () => {
    const posted = boot();
    await settle();

    expect(FakeTerminal.instances).toHaveLength(2);
    const [source, projection] = FakeTerminal.instances;
    expect(source).toMatchObject({ cols: 228, rows: 70, opened: false });
    expect(source?.options.fontSize).toBe(10);
    expect(source?.options.scrollback).toBe(256);
    expect(projection).toMatchObject({ cols: 45, rows: 42, opened: true });
    expect(projection?.options.fontSize).toBe(10);
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

  it("opens the exact desktop grid for alternate-screen snapshots", async () => {
    const posted = boot("\u001b[?1049h\u001b[2J\u001b[Hfull screen");
    await settle();

    expect(FakeTerminal.instances).toHaveLength(1);
    expect(FakeTerminal.instances[0]).toMatchObject({
      cols: 228,
      rows: 70,
      opened: true,
      disposed: false,
    });
    expect(posted).toContainEqual({ type: "ready", cols: 228, rows: 70 });
    expect(posted).toContainEqual(
      expect.objectContaining({
        type: "diagnostic",
        event: "terminal-ready",
        metrics: expect.objectContaining({ mobileLayout: "source" }),
      }),
    );
    expect(posted).toContainEqual(
      expect.objectContaining({
        type: "diagnostic",
        event: "fit-scale",
        metrics: expect.objectContaining({
          fitScale: 1,
          expectedHeight: 1050,
        }),
      }),
    );
  });

  it.each([24, 70, 120])(
    "keeps fixed-grid terminal text at the shared size for a %s-row desktop viewport",
    async (rows) => {
      const posted = boot("\u001b[?1049h\u001b[2J\u001b[Hfull screen", { cols: 228, rows });
      await settle();

      const fit = posted.find(
        (message) => message.type === "diagnostic" && message.event === "fit-scale",
      );
      expect(fit).toEqual(
        expect.objectContaining({
          metrics: expect.objectContaining({ fitScale: 1, rows }),
        }),
      );
      expect(FakeTerminal.instances[0]?.options.fontSize).toBe(10);
    },
  );

  it("falls back to the source grid when a live program leaves content after the cursor", async () => {
    const posted = boot("initial\r\n");
    await settle();
    const [source, projection] = FakeTerminal.instances;

    sendWebViewMessage({ type: "write", data: "\u001b[2Hupdated" });
    await settle();

    expect(source?.opened).toBe(true);
    expect(projection?.disposed).toBe(true);
    expect(posted).toContainEqual(
      expect.objectContaining({
        type: "diagnostic",
        event: "mobile-reflow-layout",
        metrics: expect.objectContaining({ layout: "source" }),
      }),
    );
  });

  it("keeps the source grid when the application disables automatic wrapping", async () => {
    const posted = boot("initial\r\n");
    await settle();

    sendWebViewMessage({ type: "write", data: "\u001b[?7lno-wrap-output" });
    await settle();

    expect(FakeTerminal.instances[0]?.opened).toBe(true);
    expect(posted).toContainEqual(
      expect.objectContaining({
        type: "diagnostic",
        event: "mobile-reflow-layout",
        metrics: expect.objectContaining({ layout: "source" }),
      }),
    );
  });

  it("keeps the source grid when the cursor sits in unwritten horizontal space", async () => {
    const posted = boot("abc\u001b[10C");
    await settle();

    expect(FakeTerminal.instances).toHaveLength(1);
    expect(FakeTerminal.instances[0]).toMatchObject({ opened: true, cols: 228, rows: 70 });
    expect(posted).toContainEqual(
      expect.objectContaining({
        type: "diagnostic",
        event: "terminal-ready",
        metrics: expect.objectContaining({ mobileLayout: "source" }),
      }),
    );
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

    expect(FakeTerminal.instances[0]?.opened).toBe(true);
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
