import type { ReactNode } from "react";

// A deliberately small markdown renderer for the assistant's replies: bold,
// italics, inline code, links, bullet and numbered lists, paragraphs.
//
// It builds React ELEMENTS from the text and never touches innerHTML, so
// nothing in a reply (the model echoes customer-typed text) can become a tag,
// a script or an event handler: `<img onerror=…>` renders as the literal
// characters. Links are only made for http(s) and mailto addresses; anything
// else, javascript: included, stays text. No dependency, by choice. Tables and
// strikethrough are not handled and show as written.

const INLINE = /(\*\*[^*\n]+\*\*|\*[^*\s][^*\n]*\*|`[^`\n]+`|\[[^\]\n]+\]\([^)\s]+\))/g;
const SAFE_HREF = /^(https?:\/\/|mailto:)/i;

const renderInline = (text: string, keyPrefix: string): ReactNode[] =>
  text.split(INLINE).map((part, index) => {
    const key = `${keyPrefix}-${index}`;
    if (part.length > 4 && part.startsWith("**") && part.endsWith("**")) {
      return <strong key={key}>{part.slice(2, -2)}</strong>;
    }
    if (part.length > 2 && part.startsWith("*") && part.endsWith("*")) {
      return <em key={key}>{part.slice(1, -1)}</em>;
    }
    if (part.length > 2 && part.startsWith("`") && part.endsWith("`")) {
      return (
        <code key={key} className="rounded-sm bg-muted-fill px-1 text-xs">
          {part.slice(1, -1)}
        </code>
      );
    }
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part);
    if (link) {
      const [, label, href] = link;
      return SAFE_HREF.test(href!) ? (
        <a
          key={key}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-4"
        >
          {label}
        </a>
      ) : (
        part
      );
    }
    return part;
  });

const BULLET = /^\s*[-*]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const HEADING = /^#{1,6}\s+(.*)$/;

export const Markdown = ({ text }: { text: string }) => {
  const blocks: ReactNode[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const key = `p${blocks.length}`;
    blocks.push(
      <p key={key}>
        {paragraph.map((line, index) => (
          <span key={`${key}-${index}`}>
            {index > 0 && <br />}
            {renderInline(line, `${key}-${index}`)}
          </span>
        ))}
      </p>,
    );
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    const key = `l${blocks.length}`;
    const Tag = list.ordered ? "ol" : "ul";
    blocks.push(
      <Tag key={key} className={`ml-5 ${list.ordered ? "list-decimal" : "list-disc"}`}>
        {list.items.map((item, index) => (
          <li key={`${key}-${index}`}>{renderInline(item, `${key}-${index}`)}</li>
        ))}
      </Tag>,
    );
    list = null;
  };

  for (const line of text.split("\n")) {
    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    const heading = bullet || numbered ? null : HEADING.exec(line);
    if (line.trim() === "") {
      flushParagraph();
      flushList();
    } else if (bullet || numbered) {
      flushParagraph();
      const ordered = numbered !== null;
      if (list && list.ordered !== ordered) flushList();
      list ??= { ordered, items: [] };
      list.items.push((bullet ?? numbered)![1]!);
    } else if (heading) {
      flushParagraph();
      flushList();
      blocks.push(
        <p key={`h${blocks.length}`}>
          <strong>{renderInline(heading[1]!, `h${blocks.length}`)}</strong>
        </p>,
      );
    } else {
      flushList();
      paragraph.push(line);
    }
  }
  flushParagraph();
  flushList();

  return <div className="flex flex-col gap-2">{blocks}</div>;
};
