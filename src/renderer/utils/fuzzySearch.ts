export interface HighlightSegment {
  text: string;
  highlight: boolean;
}

type SearchValue = string | number | null | undefined;

function getSearchTokens(query: string): string[] {
  return query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

function isCompactableChar(char: string): boolean {
  return /[\p{L}\p{N}]/u.test(char);
}

function compactSearchValue(value: string): string {
  return Array.from(value).filter(isCompactableChar).join('');
}

function shouldUseLiteralTokenMatch(token: string): boolean {
  return /\d/.test(token) || /[./\\:_@-]/.test(token);
}

function isSubsequence(query: string, target: string): boolean {
  let queryIndex = 0;
  for (let i = 0; i < target.length && queryIndex < query.length; i++) {
    if (target[i] === query[queryIndex]) {
      queryIndex++;
    }
  }

  return queryIndex === query.length;
}

function searchTokenMatches(token: string, target: string): boolean {
  if (target.includes(token)) {
    return true;
  }

  if (shouldUseLiteralTokenMatch(token)) {
    const compactToken = compactSearchValue(token);
    if (compactToken.length === 0) {
      return false;
    }

    return compactSearchValue(target).includes(compactToken);
  }

  return isSubsequence(token, target);
}

/**
 * 模糊搜索匹配。包含数字、IP 或路径分隔符的查询按连续片段匹配，避免把 198 拆成 1/9/8 误命中。
 * @param query 搜索关键词
 * @param target 目标字符串
 * @returns 是否匹配
 */
export function fuzzyMatch(query: string, target: string): boolean {
  const tokens = getSearchTokens(query);
  if (tokens.length === 0) return true;

  const lowerTarget = target.toLowerCase();
  return tokens.every((token) => searchTokenMatches(token, lowerTarget));
}

export function matchSearchTerms(query: string, targets: SearchValue[]): boolean {
  const tokens = getSearchTokens(query);
  if (tokens.length === 0) return true;

  const normalizedTargets = targets
    .map((value) => String(value ?? '').trim().toLowerCase())
    .filter(Boolean);

  if (normalizedTargets.length === 0) {
    return false;
  }

  return tokens.every((token) => (
    normalizedTargets.some((target) => searchTokenMatches(token, target))
  ));
}

function findSubsequenceIndices(query: string, target: string): number[] | null {
  const matchedIndices: number[] = [];
  let queryIndex = 0;

  for (let i = 0; i < target.length && queryIndex < query.length; i++) {
    if (target[i] === query[queryIndex]) {
      matchedIndices.push(i);
      queryIndex++;
    }
  }

  return queryIndex === query.length ? matchedIndices : null;
}

function addRange(matchedIndices: Set<number>, start: number, end: number): void {
  for (let i = start; i < end; i++) {
    matchedIndices.add(i);
  }
}

function addSubstringMatches(matchedIndices: Set<number>, lowerText: string, token: string): boolean {
  let index = lowerText.indexOf(token);
  if (index === -1) {
    return false;
  }

  while (index !== -1) {
    addRange(matchedIndices, index, index + token.length);
    index = lowerText.indexOf(token, index + Math.max(token.length, 1));
  }

  return true;
}

function buildCompactIndex(text: string): { compactText: string; indexMap: number[] } {
  const compactChars: string[] = [];
  const indexMap: number[] = [];
  let textIndex = 0;

  for (const char of text) {
    if (isCompactableChar(char)) {
      compactChars.push(char);
      indexMap.push(textIndex);
    }

    textIndex += char.length;
  }

  return {
    compactText: compactChars.join(''),
    indexMap,
  };
}

function addCompactMatches(matchedIndices: Set<number>, lowerText: string, token: string): boolean {
  const compactToken = compactSearchValue(token);
  if (!compactToken) {
    return false;
  }

  const { compactText, indexMap } = buildCompactIndex(lowerText);
  let compactIndex = compactText.indexOf(compactToken);
  if (compactIndex === -1) {
    return false;
  }

  while (compactIndex !== -1) {
    const start = indexMap[compactIndex];
    const end = indexMap[compactIndex + compactToken.length - 1] + 1;
    addRange(matchedIndices, start, end);
    compactIndex = compactText.indexOf(compactToken, compactIndex + Math.max(compactToken.length, 1));
  }

  return true;
}

/**
 * 高亮匹配的文本
 * @param text 原始文本
 * @param query 搜索关键词
 * @returns 包含高亮标记的文本片段数组
 */
export function highlightMatches(text: string, query: string): HighlightSegment[] {
  const tokens = getSearchTokens(query);
  if (tokens.length === 0) return [{ text, highlight: false }];

  const lowerText = text.toLowerCase();
  const matchedIndices = new Set<number>();

  for (const token of tokens) {
    if (addSubstringMatches(matchedIndices, lowerText, token)) {
      continue;
    }

    if (shouldUseLiteralTokenMatch(token)) {
      addCompactMatches(matchedIndices, lowerText, token);
      continue;
    }

    const fuzzyIndices = findSubsequenceIndices(token, lowerText);
    if (fuzzyIndices) {
      fuzzyIndices.forEach((index) => matchedIndices.add(index));
    }
  }

  const result: HighlightSegment[] = [];
  let segmentStart = 0;
  let segmentHighlight = matchedIndices.has(0);

  for (let i = 1; i < text.length; i++) {
    const highlight = matchedIndices.has(i);
    if (highlight !== segmentHighlight) {
      result.push({
        text: text.slice(segmentStart, i),
        highlight: segmentHighlight,
      });
      segmentStart = i;
      segmentHighlight = highlight;
    }
  }

  if (text.length > 0) {
    result.push({
      text: text.slice(segmentStart),
      highlight: segmentHighlight,
    });
  }

  return result;
}
