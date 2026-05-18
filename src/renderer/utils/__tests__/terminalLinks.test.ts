import type { Terminal } from '@xterm/xterm';
import { describe, expect, it, vi } from 'vitest';
import {
  createTerminalLinkHandler,
  createTerminalWebLinkProvider,
  sanitizeTerminalHttpUrl,
} from '../terminalLinks';

interface MockLine {
  text: string;
  isWrapped?: boolean;
}

function createMockTerminal(cols: number, lines: MockLine[]): Pick<Terminal, 'cols' | 'buffer'> {
  return {
    cols,
    buffer: {
      active: {
        getLine: (index: number) => {
          const line = lines[index];
          if (!line) {
            return undefined;
          }

          return {
            isWrapped: Boolean(line.isWrapped),
            getCell: (column: number) => {
              if (column >= cols) {
                return undefined;
              }

              const chars = line.text[column] ?? '';
              return {
                getWidth: () => 1,
                getChars: () => chars,
              };
            },
          };
        },
        getNullCell: () => ({
          getWidth: () => 1,
          getChars: () => '',
        }),
      },
    },
  } as unknown as Pick<Terminal, 'cols' | 'buffer'>;
}

describe('terminalLinks', () => {
  it('sanitizes terminal URLs without accepting non-http protocols', () => {
    expect(sanitizeTerminalHttpUrl('https://example.com/docs).')).toBe('https://example.com/docs');
    expect(sanitizeTerminalHttpUrl('http://example.com/path,')).toBe('http://example.com/path');
    expect(sanitizeTerminalHttpUrl('https://github.com/Margin-Lab/evals)，README')).toBe('https://github.com/Margin-Lab/evals');
    expect(sanitizeTerminalHttpUrl('javascript:alert(1)')).toBeNull();
  });

  it('detects wrapped terminal URLs across multiple buffer lines', () => {
    const terminal = createMockTerminal(10, [
      { text: 'https://ex' },
      { text: 'ample.com/', isWrapped: true },
      { text: 'docs', isWrapped: true },
    ]);
    const provider = createTerminalWebLinkProvider(terminal, vi.fn());
    const callback = vi.fn();

    provider.provideLinks(2, callback);

    const links = callback.mock.calls[0]?.[0];
    expect(links).toHaveLength(1);
    expect(links[0].text).toBe('https://example.com/docs');
    expect(links[0].range).toEqual({
      start: { x: 1, y: 1 },
      end: { x: 4, y: 3 },
    });
  });

  it('cuts off adjacent Chinese punctuation and prose from detected terminal URLs', () => {
    const terminal = createMockTerminal(80, [
      { text: '来源 (https://github.com/Margin-Lab/evals)，README 说明' },
    ]);
    const provider = createTerminalWebLinkProvider(terminal, vi.fn());
    const callback = vi.fn();

    provider.provideLinks(1, callback);

    const links = callback.mock.calls[0]?.[0];
    expect(links).toHaveLength(1);
    expect(links[0].text).toBe('https://github.com/Margin-Lab/evals');
  });

  it('routes link activation through the external opener only for sanitized http urls', async () => {
    const openExternalUrl = vi.fn().mockResolvedValue(undefined);
    const handler = createTerminalLinkHandler(openExternalUrl);

    handler.activate(new MouseEvent('mouseup'), 'https://example.com/docs).');
    await Promise.resolve();

    expect(openExternalUrl).toHaveBeenCalledWith('https://example.com/docs');

    handler.activate(new MouseEvent('mouseup'), 'https://github.com/Margin-Lab/evals)，README');
    await Promise.resolve();

    expect(openExternalUrl).toHaveBeenCalledWith('https://github.com/Margin-Lab/evals');

    handler.activate(new MouseEvent('mouseup'), 'file:///etc/hosts');
    await Promise.resolve();

    expect(openExternalUrl).toHaveBeenCalledTimes(2);
  });

  it('does not block document mouseup when activating a link', async () => {
    const openExternalUrl = vi.fn().mockResolvedValue(undefined);
    const handler = createTerminalLinkHandler(openExternalUrl);
    const element = document.createElement('div');
    const documentMouseUpListener = vi.fn();

    document.body.appendChild(element);
    document.addEventListener('mouseup', documentMouseUpListener);
    element.addEventListener('mouseup', (event) => {
      handler.activate(event, 'https://example.com/docs');
    });

    element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
    await Promise.resolve();

    expect(documentMouseUpListener).toHaveBeenCalledTimes(1);

    document.removeEventListener('mouseup', documentMouseUpListener);
    element.remove();
  });

  it('emits hover and leave callbacks for detected terminal URLs', () => {
    const terminal = createMockTerminal(40, [
      { text: 'visit https://example.com/docs' },
    ]);
    const onHover = vi.fn();
    const onLeave = vi.fn();
    const provider = createTerminalWebLinkProvider(terminal, vi.fn(), { onHover, onLeave });
    const callback = vi.fn();

    provider.provideLinks(1, callback);

    const link = callback.mock.calls[0]?.[0]?.[0];
    expect(link).toBeDefined();

    const hoverEvent = new MouseEvent('mousemove');
    link.hover?.(hoverEvent, link.text);
    link.leave?.(hoverEvent, link.text);

    expect(onHover).toHaveBeenCalledWith({
      event: hoverEvent,
      text: 'https://example.com/docs',
      range: {
        start: { x: 7, y: 1 },
        end: { x: 30, y: 1 },
      },
    });
    expect(onLeave).toHaveBeenCalledWith({
      event: hoverEvent,
      text: 'https://example.com/docs',
      range: {
        start: { x: 7, y: 1 },
        end: { x: 30, y: 1 },
      },
    });
  });

  it('sanitizes hovered OSC8/http links before surfacing drag interactions', () => {
    const onHover = vi.fn();
    const onLeave = vi.fn();
    const handler = createTerminalLinkHandler(vi.fn(), { onHover, onLeave });
    const event = new MouseEvent('mousemove');
    const range = {
      start: { x: 1, y: 2 },
      end: { x: 10, y: 2 },
    };

    handler.hover?.(event, 'https://example.com/docs).', range);
    handler.leave?.(event, 'https://example.com/docs).', range);
    handler.hover?.(event, 'file:///etc/hosts', range);

    expect(onHover).toHaveBeenCalledTimes(1);
    expect(onHover).toHaveBeenCalledWith({
      event,
      text: 'https://example.com/docs',
      range,
    });
    expect(onLeave).toHaveBeenCalledWith({
      event,
      text: 'https://example.com/docs',
      range,
    });
  });
});
