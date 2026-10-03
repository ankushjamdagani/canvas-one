import { describe, expect, it } from 'vitest';
import { applyFormat, markdownToPlainLines, parseInline, parseMarkdown } from './miniMarkdown';

describe('miniMarkdown', () => {
  it('parses nested inline marks', () => {
    expect(parseInline('a **b *c*** `d`')).toEqual([
      { type: 'text', text: 'a ' },
      { type: 'strong', children: [{ type: 'text', text: 'b ' }, { type: 'em', children: [{ type: 'text', text: 'c' }] }] },
      { type: 'text', text: ' ' },
      { type: 'code', text: 'd' },
    ]);
  });

  it('leaves snake_case and unmatched markers alone', () => {
    expect(parseInline('snake_case_name and 2 * 3')).toEqual([{ type: 'text', text: 'snake_case_name and 2 * 3' }]);
    expect(parseInline('**open')).toEqual([{ type: 'text', text: '**open' }]);
  });

  it('keeps only http(s) and mailto links', () => {
    expect(parseInline('[ok](https://x.dev/a)')).toEqual([
      { type: 'link', href: 'https://x.dev/a', children: [{ type: 'text', text: 'ok' }] },
    ]);
    expect(parseInline('[bad](javascript:alert(1))')).toEqual([{ type: 'text', text: '[bad](javascript:alert(1))' }]);
  });

  it('honours backslash escapes', () => {
    expect(parseInline('\\*not italic\\*')).toEqual([{ type: 'text', text: '*not italic*' }]);
  });

  it('groups lists, quotes, headings and paragraphs', () => {
    const blocks = parseMarkdown('# T\nline one\nline two\n\n- a\n- b\n\n1. x\n2. y\n\n> q');
    expect(blocks.map((b) => b.type)).toEqual(['heading', 'paragraph', 'list', 'list', 'quote']);
    expect(blocks[1]).toMatchObject({ lines: [expect.anything(), expect.anything()] });
    expect(blocks[3]).toMatchObject({ ordered: true });
  });

  it('strips markup for plain-text export', () => {
    expect(markdownToPlainLines('**Hi** there\n- [a](https://x.dev)\n- b')).toEqual(['Hi there', '• a', '• b']);
  });

  it('wraps, unwraps and placeholders selections', () => {
    expect(applyFormat('hello world', 0, 5, 'bold')).toEqual({ text: '**hello** world', selectionStart: 2, selectionEnd: 7 });
    expect(applyFormat('**hello** world', 2, 7, 'bold').text).toBe('hello world');
    expect(applyFormat('x', 1, 1, 'italic').text).toBe('x*italic text*');
    expect(applyFormat('a', 0, 1, 'link').text).toBe('[a](https://)');
  });

  it('toggles bullets over the selected lines', () => {
    expect(applyFormat('a\nb', 0, 3, 'list').text).toBe('- a\n- b');
    expect(applyFormat('- a\n- b', 0, 7, 'list').text).toBe('a\nb');
  });
});
