// Acceptance: no link in the app may open an AUTHENTICATED /api route with
// target="_blank".
//
// The iOS shell is a WKWebView pointed at the live origin. target="_blank"
// hands the navigation to the system browser, which carries none of the
// Supabase `sb-*` session cookies. A route absent from PUBLIC_API_ROUTES then
// falls through the proxy to a /login redirect, so a contractor who is signed
// in inside the app is shown a sign-in page in Safari.
//
// This bit exactly once — the statement-of-work PDF was the only authenticated
// route linked this way, while the quote and contract PDF links worked purely
// because their routes happen to be public. The invariant is what stops the
// next one landing.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { PUBLIC_API_ROUTES } from "@/lib/supabase/middleware";

const APP_DIR = path.join(__dirname, "..", "..", "src", "app");

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    return statSync(full).isDirectory()
      ? walk(full)
      : /\.(tsx|ts)$/.test(entry)
        ? [full]
        : [];
  });

// The JSX element that owns a given attribute offset. Walks back to the tag's
// `<`, then forward tracking brace depth so a `>` inside an expression or a
// template literal doesn't end the element early.
const enclosingElement = (source: string, attrIndex: number): string => {
  let start = attrIndex;
  while (start > 0 && source[start] !== "<") start -= 1;

  let depth = 0;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") depth -= 1;
    else if (ch === ">" && depth === 0) return source.slice(start, i + 1);
  }
  return source.slice(start);
};

// "/api/quotes/${quote.id}/pdf" and "/api/quotes/[id]/pdf" both reduce to
// ["api", "quotes", "*", "pdf"], so a link matches a registry pattern when
// their reduced segment lists are equal.
const reduce = (route: string): string[] =>
  route
    .split("/")
    .filter(Boolean)
    .map((segment) =>
      segment.includes("${") || /^\[.+\]$/.test(segment) ? "*" : segment,
    );

const isPublic = (href: string): boolean => {
  const target = reduce(href);
  return PUBLIC_API_ROUTES.some((pattern) => {
    const candidate = reduce(pattern);
    return (
      candidate.length === target.length &&
      candidate.every((segment, i) => segment === target[i])
    );
  });
};

type BlankApiLink = { file: string; href: string };

const collectBlankApiLinks = (): BlankApiLink[] => {
  const found: BlankApiLink[] = [];

  for (const file of walk(APP_DIR)) {
    const source = readFileSync(file, "utf8");
    let index = source.indexOf('target="_blank"');

    while (index !== -1) {
      const element = enclosingElement(source, index);
      // href={`…`} or href="…"
      const match =
        /href=\{`([^`]+)`\}/.exec(element) ?? /href="([^"]+)"/.exec(element);
      const href = match?.[1];
      if (href?.startsWith("/api/")) {
        found.push({ file: path.relative(APP_DIR, file), href });
      }
      index = source.indexOf('target="_blank"', index + 1);
    }
  }

  return found;
};

describe("target=\"_blank\" links never point at an authenticated API route", () => {
  it("finds the app's blank-target API links at all (the scanner works)", () => {
    // A scanner that silently matches nothing would make the assertion below
    // vacuously true forever. The quote and contract PDF links are public and
    // legitimately use target="_blank", so there is always something to find.
    const links = collectBlankApiLinks();
    expect(links.length).toBeGreaterThan(0);
  });

  it("every such link resolves to a route in PUBLIC_API_ROUTES", () => {
    const offenders = collectBlankApiLinks().filter((link) => !isPublic(link.href));

    expect(
      offenders,
      `These links open an authenticated API route in the system browser, where ` +
        `there is no session cookie, so the middleware will redirect them to ` +
        `/login. Either point the link at an in-app page (see ` +
        `src/app/jobs/[id]/sow/page.tsx) or, only if the route is genuinely ` +
        `public, register it in PUBLIC_API_ROUTES:\n` +
        offenders.map((o) => `  ${o.file} → ${o.href}`).join("\n"),
    ).toEqual([]);
  });

  it("the statement-of-work PDF route is still authenticated", () => {
    // The fix must not have been "make it public". This route serves customer
    // PII and is the only control preventing one trade rendering another's job.
    expect(isPublic("/api/jobs/${job.id}/sow-pdf")).toBe(false);
  });
});

describe("the statement-of-work links go through the in-app viewer", () => {
  const jobPage = readFileSync(path.join(APP_DIR, "jobs", "[id]", "page.tsx"), "utf8");

  it("no longer links the PDF route directly", () => {
    expect(jobPage).not.toContain("/api/jobs/${job.id}/sow-pdf");
  });

  it("links the authenticated viewer route instead, in both places", () => {
    const occurrences = jobPage.split("/jobs/${job.id}/sow").length - 1;
    expect(occurrences).toBe(2);
  });
});
