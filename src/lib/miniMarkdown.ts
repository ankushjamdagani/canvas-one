/**
 * A small, safe Markdown subset for comments: **bold**, *italic*, ~~strike~~, `code`,
 * [links](https://…), `-`/`*` and `1.` lists, `>` quotes and `#` headings. Output is a plain
 * AST (rendered as React elements, never HTML strings), and only http(s) and mailto links
 * are kept.
 */

export type Inline =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'strong' | 'em' | 'del'; readonly children: readonly Inline[] }
  | { readonly type: 'code'; readonly text: string }
  | { readonly type: 'link'; readonly href: string; readonly children: readonly Inline[] };

export type Block =
  | { readonly type: 'paragraph'; readonly lines: readonly (readonly Inline[])[] }
  | { readonly type: 'heading'; readonly level: 1 | 2 | 3; readonly children: readonly Inline[] }
  | { readonly type: 'quote'; readonly lines: readonly (readonly Inline[])[] }
  | { readonly type: 'list'; readonly ordered: boolean; readonly items: readonly (readonly Inline[])[] };

const LINK = /^\[([^\]\n]+)\]\(((?:https?:\/\/|mailto:)[^\s)]+)\)/;
const ESCAPABLE = '\\`*_~[]()#>-';

function findClose(src: string, from: number, marker: string): number {
  let i = from;
  while (i < src.length) {
    if (src[i] === '\\') { i += 2; continue; }
    if (src.startsWith(marker, i)) return i;
    i += 1;
  }
  return -1;
}

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let buffer = '';
  const flush = () => {
    if (buffer) out.push({ type: 'text', text: buffer });
    buffer = '';
  };
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '\\' && i + 1 < src.length && ESCAPABLE.includes(src[i + 1])) {
      buffer += src[i + 1];
      i += 2;
      continue;
    }
    if (ch === '`') {
      const end = src.indexOf('`', i + 1);
      if (end > i + 1) {
        flush();
        out.push({ type: 'code', text: src.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if (ch === '[') {
      const match = LINK.exec(src.slice(i));
      if (match) {
        flush();
        out.push({ type: 'link', href: match[2], children: parseInline(match[1]) });
        i += match[0].length;
        continue;
      }
    }
    const pair = src.startsWith('**', i) ? '**' : src.startsWith('~~', i) ? '~~' : null;
    if (pair) {
      let end = findClose(src, i + 2, pair);
      // In a run like `***`, the closing marker is the last two characters.
      while (end > 0 && pair === '**' && src[end + 2] === '*') end += 1;
      if (end > i + 2) {
        flush();
        out.push({ type: pair === '**' ? 'strong' : 'del', children: parseInline(src.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }
    if (ch === '*' || ch === '_') {
      const boundaryBefore = ch === '*' || i === 0 || !/[A-Za-z0-9]/.test(src[i - 1]);
      const end = boundaryBefore ? findClose(src, i + 1, ch) : -1;
      const inner = end > i + 1 ? src.slice(i + 1, end) : '';
      const boundaryAfter = ch === '*' || end + 1 >= src.length || !/[A-Za-z0-9]/.test(src[end + 1]);
      if (inner && !/^\s|\s$/.test(inner) && boundaryAfter) {
        flush();
        out.push({ type: 'em', children: parseInline(inner) });
        i = end + 1;
        continue;
      }
    }
    buffer += ch;
    i += 1;
  }
  flush();
  return out;
}

const BULLET = /^\s*[-*]\s+(.*)$/;
const ORDERED = /^\s*\d+[.)]\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;
const HEADING = /^(#{1,3})\s+(.*)$/;

export function parseMarkdown(src: string): Block[] {
  const blocks: Block[] = [];
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') { i += 1; continue; }
    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length as 1 | 2 | 3, children: parseInline(heading[2]) });
      i += 1;
      continue;
    }
    const kind = BULLET.test(line) ? 'ul' : ORDERED.test(line) ? 'ol' : QUOTE.test(line) ? 'quote' : null;
    if (kind) {
      const pattern = kind === 'ul' ? BULLET : kind === 'ol' ? ORDERED : QUOTE;
      const items: Inline[][] = [];
      while (i < lines.length) {
        const match = pattern.exec(lines[i]);
        if (!match || (kind === 'quote' && lines[i].trim() === '')) break;
        items.push(parseInline(match[1]));
        i += 1;
      }
      blocks.push(kind === 'quote' ? { type: 'quote', lines: items } : { type: 'list', ordered: kind === 'ol', items });
      continue;
    }
    const paragraph: Inline[][] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !HEADING.test(lines[i]) &&
      !BULLET.test(lines[i]) &&
      !ORDERED.test(lines[i]) &&
      !QUOTE.test(lines[i])
    ) {
      paragraph.push(parseInline(lines[i]));
      i += 1;
    }
    blocks.push({ type: 'paragraph', lines: paragraph });
  }
  return blocks;
}

function inlineText(nodes: readonly Inline[]): string {
  return nodes.map((n) => (n.type === 'text' || n.type === 'code' ? n.text : inlineText(n.children))).join('');
}

/** The note with Markdown syntax stripped, one string per displayed line (for exports and titles). */
export function markdownToPlainLines(src: string): string[] {
  const lines: string[] = [];
  for (const block of parseMarkdown(src)) {
    if (block.type === 'heading') lines.push(inlineText(block.children));
    else if (block.type === 'paragraph' || block.type === 'quote') block.lines.forEach((l) => lines.push(inlineText(l)));
    else block.items.forEach((item, idx) => lines.push(`${block.ordered ? `${idx + 1}.` : '•'} ${inlineText(item)}`));
  }
  return lines;
}

export type FormatKind = 'bold' | 'italic' | 'strike' | 'code' | 'link' | 'list';

export type FormatResult = { readonly text: string; readonly selectionStart: number; readonly selectionEnd: number };

const WRAPPERS: Record<'bold' | 'italic' | 'strike' | 'code', { mark: string; placeholder: string }> = {
  bold: { mark: '**', placeholder: 'bold text' },
  italic: { mark: '*', placeholder: 'italic text' },
  strike: { mark: '~~', placeholder: 'struck text' },
  code: { mark: '`', placeholder: 'code' },
};

/** Applies a toolbar format to the selection; wrapping again unwraps (toggle). */
export function applyFormat(text: string, start: number, end: number, kind: FormatKind): FormatResult {
  if (kind === 'list') {
    const lineStart = text.lastIndexOf('\n', start - 1) + 1;
    const nextBreak = text.indexOf('\n', end);
    const lineEnd = nextBreak < 0 ? text.length : nextBreak;
    const block = text.slice(lineStart, lineEnd).split('\n');
    const allBulleted = block.every((l) => BULLET.test(l));
    const next = block.map((l) => (allBulleted ? l.replace(/^(\s*)[-*]\s+/, '$1') : BULLET.test(l) ? l : `- ${l}`)).join('\n');
    return {
      text: text.slice(0, lineStart) + next + text.slice(lineEnd),
      selectionStart: lineStart,
      selectionEnd: lineStart + next.length,
    };
  }
  if (kind === 'link') {
    const label = text.slice(start, end) || 'link text';
    const url = 'https://';
    const inserted = `[${label}](${url})`;
    const urlStart = start + label.length + 3;
    return {
      text: text.slice(0, start) + inserted + text.slice(end),
      selectionStart: urlStart,
      selectionEnd: urlStart + url.length,
    };
  }
  const { mark, placeholder } = WRAPPERS[kind];
  const before = text.slice(0, start);
  const selected = text.slice(start, end);
  const after = text.slice(end);
  if (before.endsWith(mark) && after.startsWith(mark) && selected) {
    return {
      text: before.slice(0, -mark.length) + selected + after.slice(mark.length),
      selectionStart: start - mark.length,
      selectionEnd: end - mark.length,
    };
  }
  const body = selected || placeholder;
  return {
    text: before + mark + body + mark + after,
    selectionStart: start + mark.length,
    selectionEnd: start + mark.length + body.length,
  };
}
