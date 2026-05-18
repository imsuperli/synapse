import type {
  IBufferCellPosition,
  IBufferRange,
  IDisposable,
  ILink,
  ILinkHandler,
  ILinkProvider,
  Terminal,
} from '@xterm/xterm';

export type ExternalUrlOpener = (url: string) => Promise<unknown> | unknown;

export interface TerminalLinkInteractionPayload {
  event: MouseEvent;
  text: string;
  range: IBufferRange;
}

export interface TerminalLinkInteractionHandlers {
  onHover?: (payload: TerminalLinkInteractionPayload) => void;
  onLeave?: (payload: TerminalLinkInteractionPayload) => void;
}

type TerminalBufferLike = Pick<Terminal, 'buffer' | 'cols'>;

interface LogicalLineSegment {
  bufferLineNumber: number;
  text: string;
  columnsByCharIndex: number[];
  startIndex: number;
}

const WEB_LINK_REGEX = /https?:\/\/[^\s<>"'`{}|\\^]+/gi;
const TRIMMABLE_TRAILING_PUNCTUATION = new Set(['.', ',', '!', '?', ':', ';']);
const HARD_URL_BOUNDARY_CHARS = new Set([
  '，',
  '。',
  '、',
  '；',
  '：',
  '！',
  '？',
  '）',
  '］',
  '｝',
  '】',
  '》',
  '〉',
  '」',
  '』',
  '”',
  '’',
]);
const WRAPPING_TRAILING_PAIRS: Record<string, string> = {
  ')': '(',
  ']': '[',
  '}': '{',
};

function countOccurrences(value: string, char: string): number {
  let count = 0;

  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === char) {
      count += 1;
    }
  }

  return count;
}

function findHardUrlBoundaryIndex(value: string): number {
  for (let index = 0; index < value.length; index += 1) {
    if (HARD_URL_BOUNDARY_CHARS.has(value[index])) {
      return index;
    }
  }

  return -1;
}

function trimTerminalUrlCandidate(candidate: string): string {
  let trimmed = candidate.trim();
  const hardBoundaryIndex = findHardUrlBoundaryIndex(trimmed);
  if (hardBoundaryIndex >= 0) {
    trimmed = trimmed.slice(0, hardBoundaryIndex);
  }

  while (trimmed) {
    const trailingChar = trimmed[trimmed.length - 1];

    if (TRIMMABLE_TRAILING_PUNCTUATION.has(trailingChar)) {
      trimmed = trimmed.slice(0, -1);
      continue;
    }

    const openingChar = WRAPPING_TRAILING_PAIRS[trailingChar];
    if (!openingChar) {
      break;
    }

    if (countOccurrences(trimmed, trailingChar) > countOccurrences(trimmed, openingChar)) {
      trimmed = trimmed.slice(0, -1);
      continue;
    }

    break;
  }

  return trimmed;
}

export function sanitizeTerminalHttpUrl(candidate: string): string | null {
  const trimmed = trimTerminalUrlCandidate(candidate);
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }

    return trimmed;
  } catch {
    return null;
  }
}

async function openTerminalHttpUrl(
  url: string,
  openExternalUrl: ExternalUrlOpener,
  event?: MouseEvent,
): Promise<void> {
  const sanitizedUrl = sanitizeTerminalHttpUrl(url);
  if (!sanitizedUrl) {
    return;
  }

  event?.preventDefault();

  try {
    await openExternalUrl(sanitizedUrl);
  } catch (error) {
    console.error('Failed to open terminal link:', error);
  }
}

function readBufferLineSegment(
  terminal: TerminalBufferLike,
  bufferLineNumber: number,
): Omit<LogicalLineSegment, 'startIndex'> | null {
  const bufferLine = terminal.buffer.active.getLine(bufferLineNumber - 1);
  if (!bufferLine) {
    return null;
  }

  const columnsByCharIndex: number[] = [];
  const reusableCell = terminal.buffer.active.getNullCell();
  let text = '';

  for (let columnIndex = 0; columnIndex < terminal.cols; columnIndex += 1) {
    const cell = bufferLine.getCell(columnIndex, reusableCell);
    const width = cell?.getWidth() ?? 1;
    if (width === 0) {
      continue;
    }

    const chars = cell?.getChars() || ' ';
    text += chars;

    for (let charIndex = 0; charIndex < chars.length; charIndex += 1) {
      columnsByCharIndex.push(columnIndex + 1);
    }
  }

  return {
    bufferLineNumber,
    text,
    columnsByCharIndex,
  };
}

function collectLogicalLineSegments(
  terminal: TerminalBufferLike,
  bufferLineNumber: number,
): LogicalLineSegment[] {
  const segments: LogicalLineSegment[] = [];
  let firstLineNumber = bufferLineNumber;

  while (firstLineNumber > 1 && terminal.buffer.active.getLine(firstLineNumber - 1)?.isWrapped) {
    firstLineNumber -= 1;
  }

  let startIndex = 0;
  for (let currentLineNumber = firstLineNumber; currentLineNumber >= 1; currentLineNumber += 1) {
    const segment = readBufferLineSegment(terminal, currentLineNumber);
    if (!segment) {
      break;
    }

    segments.push({
      ...segment,
      startIndex,
    });
    startIndex += segment.text.length;

    const nextLine = terminal.buffer.active.getLine(currentLineNumber);
    if (!nextLine?.isWrapped) {
      break;
    }
  }

  return segments;
}

function resolveBufferPosition(
  segments: LogicalLineSegment[],
  logicalIndex: number,
): IBufferCellPosition | null {
  for (const segment of segments) {
    const localIndex = logicalIndex - segment.startIndex;
    if (localIndex < 0 || localIndex >= segment.columnsByCharIndex.length) {
      continue;
    }

    return {
      x: segment.columnsByCharIndex[localIndex],
      y: segment.bufferLineNumber,
    };
  }

  return null;
}

function createLink(
  displayText: string,
  start: IBufferCellPosition,
  end: IBufferCellPosition,
  openExternalUrl: ExternalUrlOpener,
  interactionHandlers?: TerminalLinkInteractionHandlers,
): ILink {
  const range = { start, end };

  return {
    range,
    text: displayText,
    decorations: {
      pointerCursor: true,
      underline: true,
    },
    activate: (event, text) => {
      void openTerminalHttpUrl(text, openExternalUrl, event);
    },
    hover: (event, text) => {
      interactionHandlers?.onHover?.({
        event,
        text,
        range,
      });
    },
    leave: (event, text) => {
      interactionHandlers?.onLeave?.({
        event,
        text,
        range,
      });
    },
  };
}

export function createTerminalWebLinkProvider(
  terminal: TerminalBufferLike,
  openExternalUrl: ExternalUrlOpener,
  interactionHandlers?: TerminalLinkInteractionHandlers,
): ILinkProvider {
  return {
    provideLinks(bufferLineNumber, callback) {
      const segments = collectLogicalLineSegments(terminal, bufferLineNumber);
      if (segments.length === 0) {
        callback(undefined);
        return;
      }

      const logicalText = segments.map((segment) => segment.text).join('');
      const links: ILink[] = [];

      for (const match of logicalText.matchAll(WEB_LINK_REGEX)) {
        if (match.index === undefined) {
          continue;
        }

        const displayText = sanitizeTerminalHttpUrl(match[0]);
        if (!displayText) {
          continue;
        }

        const start = resolveBufferPosition(segments, match.index);
        const end = resolveBufferPosition(segments, match.index + displayText.length - 1);
        if (!start || !end) {
          continue;
        }

        if (start.y > bufferLineNumber || end.y < bufferLineNumber) {
          continue;
        }

        links.push(createLink(displayText, start, end, openExternalUrl, interactionHandlers));
      }

      callback(links.length > 0 ? links : undefined);
    },
  };
}

export function createTerminalLinkHandler(
  openExternalUrl: ExternalUrlOpener,
  interactionHandlers?: TerminalLinkInteractionHandlers,
): ILinkHandler {
  return {
    activate: (event, text) => {
      void openTerminalHttpUrl(text, openExternalUrl, event);
    },
    hover: (event, text, range) => {
      const sanitizedUrl = sanitizeTerminalHttpUrl(text);
      if (!sanitizedUrl) {
        return;
      }

      interactionHandlers?.onHover?.({
        event,
        text: sanitizedUrl,
        range,
      });
    },
    leave: (event, text, range) => {
      const sanitizedUrl = sanitizeTerminalHttpUrl(text);
      if (!sanitizedUrl) {
        return;
      }

      interactionHandlers?.onLeave?.({
        event,
        text: sanitizedUrl,
        range,
      });
    },
    allowNonHttpProtocols: false,
  };
}

export function registerTerminalWebLinks(
  terminal: Terminal,
  openExternalUrl: ExternalUrlOpener,
  interactionHandlers?: TerminalLinkInteractionHandlers,
): IDisposable {
  return terminal.registerLinkProvider(
    createTerminalWebLinkProvider(terminal, openExternalUrl, interactionHandlers),
  );
}
