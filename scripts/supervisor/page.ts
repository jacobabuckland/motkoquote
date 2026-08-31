/**
 * The Factory Supervisor page: resolving it, and replacing one section of it.
 *
 * Shared by the hourly digest (`publish.ts`) and the weekly metrics and retro
 * (`publish-weekly.ts`), because both do the same thing to different sections
 * and a second copy of this logic is a second place for the page layout to be
 * misunderstood.
 *
 * Page layout, in this order:
 *
 *   # Latest — <timestamp>   ← replaced wholesale each digest run
 *   # Metrics                ← replaced weekly by M1
 *   # Retro                  ← replaced weekly by R2/R3
 *   # Run log                ← appended to, one line per run
 *
 * Run log is LAST so appending to it is a plain append to the page, with
 * nothing to move. Every other section is replaced in place, which Notion has
 * no primitive for — it is delete-the-children-then-append, and the section
 * boundary has to be found by walking the page.
 */

import { notion } from "./notion";

export const SECTION_TITLES = {
  latest: "Latest —",
  metrics: "Metrics",
  retro: "Retro",
  runLog: "Run log",
} as const;

const PAGE_TITLE = "Factory Supervisor";

export interface Block {
  id: string;
  type: string;
  [key: string]: unknown;
}

export function plain(content: string): unknown {
  return { type: "text", text: { content } };
}

export function headingText(block: Block): string {
  const body = block[block.type] as { rich_text?: { plain_text?: string }[] } | undefined;
  return (body?.rich_text ?? []).map((t) => t.plain_text ?? "").join("").trim();
}

export function isHeading(block: Block): boolean {
  return block.type.startsWith("heading_");
}

export async function children(pageId: string): Promise<Block[]> {
  const out: Block[] = [];
  let cursor: string | undefined;
  do {
    const q = cursor
      ? `blocks/${pageId}/children?page_size=100&start_cursor=${cursor}`
      : `blocks/${pageId}/children?page_size=100`;
    const page = await notion<{ results: Block[]; has_more: boolean; next_cursor: string | null }>(q);
    out.push(...(page.results ?? []));
    cursor = page.has_more && page.next_cursor ? page.next_cursor : undefined;
  } while (cursor);
  return out;
}

/**
 * Notion caps a rich-text node at 2000 characters and rejects the whole request
 * if one is longer — which would lose the digest rather than truncate it.
 */
export function chunk(text: string, size = 1900): string[] {
  if (text.length <= size) return [text];
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

/** Markdown links become real Notion links; everything else is plain text. */
export function richText(text: string): unknown[] {
  const out: unknown[] = [];
  const pattern = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) out.push(...chunk(text.slice(last, match.index)).map(plain));
    out.push({ type: "text", text: { content: match[1].slice(0, 1900), link: { url: match[2] } } });
    last = pattern.lastIndex;
  }
  if (last < text.length) out.push(...chunk(text.slice(last)).map(plain));

  return out.length > 0 ? out : [plain("")];
}

/**
 * Markdown-ish → Notion blocks.
 *
 * Heading levels are shifted down one, because the page itself owns h1 and a
 * second h1 inside the body reads as a sibling section rather than as content —
 * which would break the section-boundary walk this file depends on.
 */
export function toBlocks(markdown: string): unknown[] {
  return markdown
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const trimmed = line.trim();

      const heading = trimmed.match(/^(#{1,3})\s+(.*)$/);
      if (heading) {
        const level = Math.min(heading[1].length + 1, 3);
        return {
          object: "block",
          type: `heading_${level}`,
          [`heading_${level}`]: { rich_text: richText(heading[2]) },
        };
      }

      const bullet = trimmed.match(/^[-*]\s+(.*)$/);
      if (bullet) {
        return {
          object: "block",
          type: "bulleted_list_item",
          bulleted_list_item: { rich_text: richText(bullet[1]) },
        };
      }

      return { object: "block", type: "paragraph", paragraph: { rich_text: richText(trimmed) } };
    });
}

export async function append(pageId: string, blocks: unknown[], after?: string): Promise<void> {
  // Notion accepts at most 100 children per request.
  for (let i = 0; i < blocks.length; i += 100) {
    const body: Record<string, unknown> = { children: blocks.slice(i, i + 100) };
    if (after && i === 0) body.after = after;
    await notion(`blocks/${pageId}/children`, { method: "PATCH", body: JSON.stringify(body) });
  }
}

/**
 * Replace one top-level section: everything from its heading to the next
 * heading, exclusive.
 *
 * Throws when the section is absent rather than creating it, and that is the
 * important half. A page whose shape this does not recognise is one someone has
 * restructured by hand, and rewriting it on a guess would destroy their edit
 * silently, once an hour.
 */
export async function replaceSection(
  pageId: string,
  blocks: Block[],
  sectionPrefix: string,
  newHeading: string,
  body: string,
): Promise<void> {
  const start = blocks.findIndex((b) => isHeading(b) && headingText(b).startsWith(sectionPrefix));
  if (start === -1) {
    throw new Error(
      `Factory Supervisor page ${pageId} has no "${sectionPrefix}" section. ` +
        "Refusing to rewrite a page whose shape I do not recognise — restore the four headings " +
        `(${Object.values(SECTION_TITLES).join(", ")}) or point SUPERVISOR_PAGE_ID at the right page.`,
    );
  }

  const nextHeading = blocks.findIndex((b, i) => i > start && isHeading(b));
  const end = nextHeading === -1 ? blocks.length : nextHeading;

  const heading = blocks[start];
  await notion(`blocks/${heading.id}`, {
    method: "PATCH",
    body: JSON.stringify({ [heading.type]: { rich_text: [plain(newHeading)] } }),
  });

  for (const stale of blocks.slice(start + 1, end)) {
    await notion(`blocks/${stale.id}`, { method: "DELETE" });
  }

  await append(pageId, toBlocks(body), heading.id);
}

/** Append one line at the very end of the page — the run log lives there. */
export async function appendRunLog(pageId: string, line: string): Promise<void> {
  await append(pageId, [
    { object: "block", type: "paragraph", paragraph: { rich_text: [plain(line)] } },
  ]);
}

/**
 * Resolve the page, in the order docs/supervisor/S0-checks.md fixes. Five
 * steps, and the fifth is a loud failure rather than a guess — a page created
 * in the wrong place is not something a later run can tidy up.
 */
export async function resolvePage(recorded: string | null | undefined): Promise<string> {
  const configured = process.env.SUPERVISOR_PAGE_ID;
  if (configured) return configured;
  if (recorded) return recorded;

  // Search, so a page already created and shared with the integration is
  // adopted rather than duplicated.
  const found = await notion<{ results: { id: string; object: string }[] }>("search", {
    method: "POST",
    body: JSON.stringify({ query: PAGE_TITLE, filter: { property: "object", value: "page" } }),
  });
  const hit = (found.results ?? []).find((r) => r.object === "page");
  if (hit) return hit.id;

  const parent = process.env.SUPERVISOR_PARENT_PAGE_ID;
  if (!parent) {
    throw new Error(
      "CAPABILITY FAULT: no Factory Supervisor page. Set SUPERVISOR_PAGE_ID to an existing page, " +
        "or SUPERVISOR_PARENT_PAGE_ID to a page the integration can write to so one can be created. " +
        "Refusing to guess a parent — a page created in the wrong place cannot be moved by a later run.",
    );
  }

  const created = await notion<{ id: string }>("pages", {
    method: "POST",
    body: JSON.stringify({
      parent: { page_id: parent },
      properties: { title: [{ type: "text", text: { content: PAGE_TITLE } }] },
      children: [
        heading(`${SECTION_TITLES.latest} (no run yet)`),
        heading(SECTION_TITLES.metrics),
        heading(SECTION_TITLES.retro),
        heading(SECTION_TITLES.runLog),
      ],
    }),
  });
  return created.id;
}

function heading(text: string): unknown {
  return { object: "block", type: "heading_1", heading_1: { rich_text: [plain(text)] } };
}
