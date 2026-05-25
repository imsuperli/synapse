import { describe, expect, it } from 'vitest';
import { fuzzyMatch, highlightMatches, matchSearchTerms } from '../fuzzySearch';

describe('fuzzySearch', () => {
  it('matches query characters in order', () => {
    expect(fuzzyMatch('hnr', 'd-honor-copilot')).toBe(true);
    expect(fuzzyMatch('roh', 'd-honor-copilot')).toBe(false);
  });

  it('does not split numeric queries into unrelated fuzzy digits', () => {
    expect(fuzzyMatch('198', '172.30.9.198')).toBe(true);
    expect(fuzzyMatch('198', '192.168.3.25')).toBe(false);
    expect(fuzzyMatch('198', '1.98')).toBe(false);
    expect(fuzzyMatch('198', '1/98')).toBe(false);
    expect(fuzzyMatch('198', '1-98')).toBe(false);
  });

  it('matches compact IP and path queries across separators', () => {
    expect(fuzzyMatch('172309198', 'root@172.30.9.198:22')).toBe(true);
    expect(fuzzyMatch('developsynapse', '/home/u0_a280/develop/synapse')).toBe(true);
  });

  it('matches multi-token queries across different search fields', () => {
    expect(matchSearchTerms('prod 172.30.9.198', [
      'Production Bastion',
      'root@172.30.9.198:22',
    ])).toBe(true);
    expect(matchSearchTerms('prod 198', [
      'Production Bastion',
      'root@192.168.3.25:22',
    ])).toBe(false);
  });

  it('keeps adjacent matched characters in one highlighted segment', () => {
    expect(highlightMatches('d-honor-copilot', 'honor')).toEqual([
      { text: 'd-', highlight: false },
      { text: 'honor', highlight: true },
      { text: '-copilot', highlight: false },
    ]);
  });

  it('still separates non-adjacent fuzzy matches', () => {
    expect(highlightMatches('d-honor-copilot', 'hr')).toEqual([
      { text: 'd-', highlight: false },
      { text: 'h', highlight: true },
      { text: 'ono', highlight: false },
      { text: 'r', highlight: true },
      { text: '-copilot', highlight: false },
    ]);
  });

  it('highlights numeric queries only when they are contiguous', () => {
    expect(highlightMatches('root@172.30.9.198:22', '198')).toEqual([
      { text: 'root@172.30.9.', highlight: false },
      { text: '198', highlight: true },
      { text: ':22', highlight: false },
    ]);

    expect(highlightMatches('root@192.168.3.25:22', '198')).toEqual([
      { text: 'root@192.168.3.25:22', highlight: false },
    ]);

    expect(highlightMatches('root@1.98:22', '198')).toEqual([
      { text: 'root@1.98:22', highlight: false },
    ]);
  });
});
