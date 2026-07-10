// Minimal markdown block/inline parser for rendered contract bodies, shared
// by the PDF renderer (@react-pdf/renderer) and the public web page. Covers
// exactly the constructs used by the templates in ./templates.ts: headings
// (#, ##, ###), paragraphs, blockquotes (>), unordered lists (-), tables
// (|...|), horizontal rules (---), and bold/italic inline emphasis.

export type ContractInline = { text: string; bold?: boolean; italic?: boolean };

export type ContractBlock =
  | { type: "heading"; level: 1 | 2 | 3; inlines: ContractInline[] }
  | { type: "paragraph"; inlines: ContractInline[] }
  | { type: "blockquote"; inlines: ContractInline[] }
  | { type: "list"; items: ContractInline[][] }
  | { type: "table"; header: ContractInline[][]; rows: ContractInline[][][] }
  | { type: "hr" };

const INLINE_PATTERN = /\*\*([^*]+)\*\*|\*([^*]+)\*/g;

const parseInline = (text: string): ContractInline[] => {
  const inlines: ContractInline[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  INLINE_PATTERN.lastIndex = 0;

  while ((match = INLINE_PATTERN.exec(text))) {
    if (match.index > lastIndex) {
      inlines.push({ text: text.slice(lastIndex, match.index) });
    }
    if (match[1] !== undefined) {
      inlines.push({ text: match[1], bold: true });
    } else if (match[2] !== undefined) {
      inlines.push({ text: match[2], italic: true });
    }
    lastIndex = INLINE_PATTERN.lastIndex;
  }
  if (lastIndex < text.length) {
    inlines.push({ text: text.slice(lastIndex) });
  }
  return inlines;
};

const splitTableRow = (row: string): ContractInline[][] =>
  row
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => parseInline(cell.trim()));

export const parseContractMarkdown = (markdown: string): ContractBlock[] => {
  const lines = markdown.split("\n");
  const blocks: ContractBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const raw = lines[i] ?? "";
    const trimmed = raw.trim();

    if (trimmed === "") {
      i++;
      continue;
    }

    if (trimmed === "---") {
      blocks.push({ type: "hr" });
      i++;
      continue;
    }

    const headingMatch = /^(#{1,3})\s+(.*)$/.exec(trimmed);
    if (headingMatch) {
      const level = headingMatch[1]!.length as 1 | 2 | 3;
      blocks.push({ type: "heading", level, inlines: parseInline(headingMatch[2] ?? "") });
      i++;
      continue;
    }

    if (trimmed.startsWith(">")) {
      const quoteLines: string[] = [];
      while (i < lines.length && (lines[i] ?? "").trim().startsWith(">")) {
        quoteLines.push((lines[i] ?? "").trim().replace(/^>\s?/, ""));
        i++;
      }
      blocks.push({ type: "blockquote", inlines: parseInline(quoteLines.join(" ")) });
      continue;
    }

    if (trimmed.startsWith("|")) {
      const tableLines: string[] = [];
      while (i < lines.length && (lines[i] ?? "").trim().startsWith("|")) {
        tableLines.push((lines[i] ?? "").trim());
        i++;
      }
      const [headerRow, , ...bodyRows] = tableLines;
      blocks.push({
        type: "table",
        header: headerRow ? splitTableRow(headerRow) : [],
        rows: bodyRows.map(splitTableRow),
      });
      continue;
    }

    if (trimmed.startsWith("- ")) {
      const items: ContractInline[][] = [];
      while (i < lines.length && (lines[i] ?? "").trim().startsWith("- ")) {
        items.push(parseInline((lines[i] ?? "").trim().slice(2)));
        i++;
      }
      blocks.push({ type: "list", items });
      continue;
    }

    const paraLines: string[] = [];
    while (i < lines.length) {
      const lineTrimmed = (lines[i] ?? "").trim();
      if (
        lineTrimmed === "" ||
        lineTrimmed === "---" ||
        /^(#{1,3})\s+/.test(lineTrimmed) ||
        lineTrimmed.startsWith(">") ||
        lineTrimmed.startsWith("|") ||
        lineTrimmed.startsWith("- ")
      ) {
        break;
      }
      paraLines.push(lineTrimmed);
      i++;
    }
    blocks.push({ type: "paragraph", inlines: parseInline(paraLines.join(" ")) });
  }

  return blocks;
};
