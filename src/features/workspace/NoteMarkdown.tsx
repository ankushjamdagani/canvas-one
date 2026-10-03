import * as React from 'react';
import { parseMarkdown, type Block, type Inline } from '@/lib/miniMarkdown';

function renderInline(nodes: readonly Inline[]): React.ReactNode[] {
  return nodes.map((node, index) => {
    switch (node.type) {
      case 'text':
        return node.text;
      case 'strong':
        return <strong key={index} className="font-semibold">{renderInline(node.children)}</strong>;
      case 'em':
        return <em key={index}>{renderInline(node.children)}</em>;
      case 'del':
        return <del key={index}>{renderInline(node.children)}</del>;
      case 'code':
        return <code key={index} className="rounded bg-black/5 px-1 font-mono text-[11px]">{node.text}</code>;
      case 'link':
        return (
          <a
            key={index}
            href={node.href}
            target="_blank"
            rel="noopener noreferrer"
            className="nodrag nopan pointer-events-auto text-primary underline underline-offset-2"
            onClick={(event) => event.stopPropagation()}
          >
            {renderInline(node.children)}
          </a>
        );
    }
  });
}

function renderLines(lines: readonly (readonly Inline[])[]): React.ReactNode[] {
  return lines.flatMap((line, index) => (index === 0 ? [renderInline(line)] : [<br key={`br-${index}`} />, renderInline(line)]));
}

function renderBlock(block: Block, index: number): React.ReactNode {
  switch (block.type) {
    case 'heading':
      return <p key={index} className="font-semibold text-[13px] mt-1 first:mt-0">{renderInline(block.children)}</p>;
    case 'quote':
      return <blockquote key={index} className="border-l-2 border-control-border-strong pl-2 text-secondary-text">{renderLines(block.lines)}</blockquote>;
    case 'list': {
      const Tag = block.ordered ? 'ol' : 'ul';
      return (
        <Tag key={index} className={block.ordered ? 'list-decimal pl-4' : 'list-disc pl-4'}>
          {block.items.map((item, i) => <li key={i}>{renderInline(item)}</li>)}
        </Tag>
      );
    }
    case 'paragraph':
      return <p key={index}>{renderLines(block.lines)}</p>;
  }
}

/** Renders a note's Markdown as React elements (no HTML injection). */
export function NoteMarkdown({ text, ...rest }: { text: string } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...rest}>
      {parseMarkdown(text).map(renderBlock)}
    </div>
  );
}
