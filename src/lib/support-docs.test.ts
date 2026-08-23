import { describe, it, expect } from "vitest";
import { SUPPORT_DOCS_URL } from "./support-docs";

describe("SUPPORT_DOCS_URL", () => {
  it("is an absolute https URL", () => {
    expect(new URL(SUPPORT_DOCS_URL).protocol).toBe("https:");
  });

  // The failure this exists to stop: pasting back the workspace URL Notion
  // shows an editor (app.notion.com/p/…). That link is private — it renders a
  // sign-in wall for anyone outside the workspace, which is every customer —
  // and it is indistinguishable from the published one at a glance, because
  // both carry the same page id.
  it("points at the published site, not the private workspace URL", () => {
    const { hostname } = new URL(SUPPORT_DOCS_URL);

    expect(hostname.endsWith(".notion.site")).toBe(true);
    expect(hostname).not.toBe("app.notion.com");
  });

  it("carries no copy-link tracking parameter", () => {
    expect(new URL(SUPPORT_DOCS_URL).searchParams.has("source")).toBe(false);
  });
});
