export type TerminalOscColorQueryReplyColors = {
  foreground?: string;
  background?: string;
};

export type TerminalOscColorQuerySlot = 10 | 11;

export type TerminalOscColorQueryConsumeResult = {
  output: string;
  pending: string;
  replies: string[];
};

const ESC = '\u001b';
const OSC = `${ESC}]`;
const BEL = '\u0007';
const STRING_TERMINATOR = `${ESC}\\`;
const MAX_PENDING_QUERY_CHARS = 64;
const QUERY_PREFIXES = [
  { slot: 10, prefix: `${OSC}10;` },
  { slot: 11, prefix: `${OSC}11;` },
] as const;
const QUERY_BODIES = {
  10: [
    { body: '?', slots: [10] },
    { body: '?;?', slots: [10, 11] },
  ],
  11: [{ body: '?', slots: [11] }],
} as const satisfies Record<
  TerminalOscColorQuerySlot,
  readonly { body: string; slots: readonly TerminalOscColorQuerySlot[] }[]
>;

type QueryParseResult =
  | { kind: 'match'; slots: readonly TerminalOscColorQuerySlot[]; endIndex: number }
  | { kind: 'partial' }
  | { kind: 'none' };

type TerminatorParseResult =
  | { kind: 'complete'; endIndex: number }
  | { kind: 'partial' }
  | { kind: 'none' };

function parseTerminator(data: string, offset: number): TerminatorParseResult {
  if (offset >= data.length) {
    return { kind: 'partial' };
  }
  if (data[offset] === BEL) {
    return { kind: 'complete', endIndex: offset + 1 };
  }
  if (data.startsWith(STRING_TERMINATOR, offset)) {
    return { kind: 'complete', endIndex: offset + STRING_TERMINATOR.length };
  }
  if (data[offset] === ESC && offset + 1 >= data.length) {
    return { kind: 'partial' };
  }
  return { kind: 'none' };
}

function completeQuery(
  slot: TerminalOscColorQuerySlot,
  body: string,
  terminator: TerminatorParseResult,
): QueryParseResult {
  if (terminator.kind !== 'complete') {
    return terminator;
  }
  const slots = QUERY_BODIES[slot].find((entry) => entry.body === body)?.slots;
  return slots
    ? { kind: 'match', slots, endIndex: terminator.endIndex }
    : { kind: 'none' };
}

function parseQueryBody(
  data: string,
  bodyStart: number,
  slot: TerminalOscColorQuerySlot,
): QueryParseResult {
  if (bodyStart >= data.length) {
    return { kind: 'partial' };
  }
  if (data[bodyStart] !== '?') {
    return { kind: 'none' };
  }
  const singleQueryTerminator = parseTerminator(data, bodyStart + 1);
  if (singleQueryTerminator.kind !== 'none') {
    return completeQuery(slot, '?', singleQueryTerminator);
  }
  if (slot !== 10 || data[bodyStart + 1] !== ';') {
    return { kind: 'none' };
  }
  if (bodyStart + 2 >= data.length) {
    return { kind: 'partial' };
  }
  if (data[bodyStart + 2] !== '?') {
    return { kind: 'none' };
  }
  return completeQuery(slot, '?;?', parseTerminator(data, bodyStart + 3));
}

export function parseTerminalOscColorQuery(data: string, offset: number): QueryParseResult {
  const entry = QUERY_PREFIXES.find(({ prefix }) => data.startsWith(prefix, offset));
  if (!entry) {
    const fragment = data.slice(offset);
    return QUERY_PREFIXES.some(({ prefix }) => prefix.startsWith(fragment))
      ? { kind: 'partial' }
      : { kind: 'none' };
  }
  return parseQueryBody(data, offset + entry.prefix.length, entry.slot);
}

function cssColorToOscRgb(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  const hex = /^#([0-9a-f]{6})$/i.exec(value.trim())?.[1];
  if (!hex) {
    return null;
  }
  const red = hex.slice(0, 2).repeat(2);
  const green = hex.slice(2, 4).repeat(2);
  const blue = hex.slice(4, 6).repeat(2);
  return `rgb:${red}/${green}/${blue}`;
}

export function terminalOscColorQueryReply(
  colors: TerminalOscColorQueryReplyColors,
  slot: TerminalOscColorQuerySlot,
): string | null {
  const color = cssColorToOscRgb(slot === 10 ? colors.foreground : colors.background);
  return color ? `${OSC}${slot};${color}${STRING_TERMINATOR}` : null;
}

function terminalOscColorQueryReplies(
  colors: TerminalOscColorQueryReplyColors,
  slots: readonly TerminalOscColorQuerySlot[],
): string[] | null {
  const replies = slots.map((slot) => terminalOscColorQueryReply(colors, slot));
  return replies.every((reply): reply is string => reply !== null) ? replies : null;
}

/**
 * Answers complete OSC 10/11 queries and removes only those queries from the
 * renderer-bound stream. Partial candidates are held across PTY chunks so a
 * split ST terminator cannot leak a duplicate query to xterm.
 */
export function consumeTerminalOscColorQueries(
  data: string,
  pending: string,
  colors: TerminalOscColorQueryReplyColors,
): TerminalOscColorQueryConsumeResult {
  const input = pending + data;
  const replies: string[] = [];
  let output = '';
  let nextPending = '';
  let offset = 0;

  while (offset < input.length) {
    const candidateIndex = input.indexOf(ESC, offset);
    if (candidateIndex === -1) {
      output += input.slice(offset);
      break;
    }
    output += input.slice(offset, candidateIndex);
    const query = parseTerminalOscColorQuery(input, candidateIndex);
    if (query.kind === 'none') {
      output += input[candidateIndex];
      offset = candidateIndex + 1;
      continue;
    }
    if (query.kind === 'partial') {
      const candidate = input.slice(candidateIndex);
      if (candidate.length <= MAX_PENDING_QUERY_CHARS) {
        nextPending = candidate;
      } else {
        output += candidate;
      }
      break;
    }

    const queryReplies = terminalOscColorQueryReplies(colors, query.slots);
    if (!queryReplies) {
      output += input.slice(candidateIndex, query.endIndex);
    } else {
      replies.push(...queryReplies);
    }
    offset = query.endIndex;
  }

  return { output, pending: nextPending, replies };
}
