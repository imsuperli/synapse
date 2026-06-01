import { describe, expect, it } from 'vitest';
import { createTerminalOsc8Guard, OSC8_HYPERLINK_CLOSE } from '../terminalOsc8Guard';

const osc8OpenBel = '\u001b]8;;https://example.com\u0007';
const osc8CloseBel = OSC8_HYPERLINK_CLOSE;

describe('terminalOsc8Guard', () => {
  it('leaves a same-line balanced OSC 8 hyperlink unchanged', () => {
    const guard = createTerminalOsc8Guard();
    const data = `${osc8OpenBel}docs${osc8CloseBel} plain`;

    expect(guard.sanitize(data, { closeAtEnd: true })).toBe(data);
  });

  it('closes an unterminated OSC 8 hyperlink before the next line', () => {
    const guard = createTerminalOsc8Guard();

    expect(guard.sanitize(`${osc8OpenBel}docs\nplain`)).toBe(`${osc8OpenBel}docs${osc8CloseBel}\nplain`);
  });

  it('tracks OSC 8 state across split chunks without breaking the sequence', () => {
    const guard = createTerminalOsc8Guard();

    expect(guard.sanitize('\u001b]8;;https://example.com')).toBe('\u001b]8;;https://example.com');
    expect(guard.sanitize('\u0007docs')).toBe('\u0007docs');
    expect(guard.sanitize('\nplain')).toBe(`${osc8CloseBel}\nplain`);
  });

  it('closes an unterminated OSC 8 hyperlink at a replay boundary', () => {
    const guard = createTerminalOsc8Guard();

    expect(guard.sanitize(`${osc8OpenBel}docs`, { closeAtEnd: true })).toBe(`${osc8OpenBel}docs${osc8CloseBel}`);
  });

  it('handles ST-terminated OSC 8 hyperlinks', () => {
    const guard = createTerminalOsc8Guard();
    const openSt = '\u001b]8;;https://example.com\u001b\\';

    expect(guard.sanitize(`${openSt}docs\nplain`)).toBe(`${openSt}docs${osc8CloseBel}\nplain`);
  });
});
