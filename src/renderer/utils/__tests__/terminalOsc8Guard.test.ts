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

  it('closes an unterminated OSC 8 hyperlink before CSI cursor movement redraws more text', () => {
    const guard = createTerminalOsc8Guard();

    expect(guard.sanitize(`${osc8OpenBel}docs\u001b[12;1Hplain`)).toBe(`${osc8OpenBel}docs${osc8CloseBel}\u001b[12;1Hplain`);
  });

  it('closes an unterminated OSC 8 hyperlink before split CSI cursor movement', () => {
    const guard = createTerminalOsc8Guard();

    expect(guard.sanitize(`${osc8OpenBel}docs\u001b[`)).toBe(`${osc8OpenBel}docs`);
    expect(guard.sanitize('12;1Hplain')).toBe(`${osc8CloseBel}\u001b[12;1Hplain`);
  });

  it('closes an unterminated OSC 8 hyperlink before screen clearing controls', () => {
    const guard = createTerminalOsc8Guard();

    expect(guard.sanitize(`${osc8OpenBel}docs\u001b[2J\u001b[Hplain`)).toBe(`${osc8OpenBel}docs${osc8CloseBel}\u001b[2J\u001b[Hplain`);
  });

  it('closes an unterminated OSC 8 hyperlink before SGR reset after linked text', () => {
    const guard = createTerminalOsc8Guard();

    expect(guard.sanitize(`${osc8OpenBel}docs\u001b[0mplain`)).toBe(`${osc8OpenBel}docs${osc8CloseBel}\u001b[0mplain`);
  });

  it('keeps same-line OSC 8 styling through non-reset SGR styling', () => {
    const guard = createTerminalOsc8Guard();

    expect(guard.sanitize(`${osc8OpenBel}\u001b[32mdocs${osc8CloseBel}`)).toBe(`${osc8OpenBel}\u001b[32mdocs${osc8CloseBel}`);
  });
});
