/**
 * @vitest-environment happy-dom
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Disclosure } from "@/components/ui/disclosure";
import {
  SETUP_LEGAL_SECTION_ID,
  SETUP_LEGAL_SECTION_HREF,
  SETUP_LEGAL_SECTION_TITLE,
  CONTRACT_PROFILE_FIELDS,
} from "@/lib/business-profile-gaps";

/**
 * The dashboard's business-details link has to OPEN the section it points at.
 *
 * P1·8 built this: the banner names the missing field and links to
 * `/setup#setup-legal` rather than to the page, because "Add them in Setup"
 * dropped a contractor at the top of six collapsed sections. On 8 Sep a trade
 * followed that link, found the details already present in the sections he
 * could see, and concluded the app was broken.
 *
 * Disclosure has auto-expand-on-deep-link for exactly this. It was inert for
 * this link, and the reason is visible in the component's own history: the
 * `id` was deliberately moved to the ROOT element so `#<id>` would anchor to
 * the section heading — the content div is `max-height: 0` while collapsed, so
 * an anchor into it scrolled to nothing. But the expand condition still asked
 * whether the hash target is INSIDE the content:
 *
 *     contentRef.current.contains(target)
 *
 * A node does not contain its own ancestor. The root holding the id is the
 * content div's PARENT, so the check is false for the one href built to use it,
 * and the section stayed shut. Nothing caught it: no test covered the
 * deep-link path at all.
 *
 * So the link scrolled to a closed section and the contractor saw a heading.
 */

afterEach(() => {
  cleanup();
  window.location.hash = "";
});

const renderSection = () =>
  render(
    <Disclosure id={SETUP_LEGAL_SECTION_ID} title={SETUP_LEGAL_SECTION_TITLE} defaultOpen={false}>
      <div>
        <label htmlFor="business_structure">Business structure</label>
        <input id="business_structure" />
      </div>
    </Disclosure>,
  );

const section = () => screen.getByRole("button", { name: SETUP_LEGAL_SECTION_TITLE });

describe("the link the dashboard actually sends", () => {
  it("points at the section's own id", () => {
    // If this href ever stops matching the element id, the rest is moot.
    expect(SETUP_LEGAL_SECTION_HREF).toBe(`/setup#${SETUP_LEGAL_SECTION_ID}`);
  });

  it("is where every missing contract field sends the contractor", () => {
    for (const field of CONTRACT_PROFILE_FIELDS) {
      expect(field.setupHref).toBe(SETUP_LEGAL_SECTION_HREF);
    }
  });

  it("opens the section when the hash names it", () => {
    // The whole item. This was false before: the id is on the root, and the
    // expand check asked whether the target was inside the CONTENT.
    window.location.hash = `#${SETUP_LEGAL_SECTION_ID}`;
    renderSection();
    expect(section()).toHaveAttribute("aria-expanded", "true");
  });

  it("still opens when the hash names a field INSIDE the section", () => {
    // The case the original check was written for. It must keep working — a
    // future link straight to one input should not regress to a closed panel.
    window.location.hash = "#business_structure";
    renderSection();
    expect(section()).toHaveAttribute("aria-expanded", "true");
  });
});

describe("it stays shut when nothing asked for it", () => {
  it("is closed with no hash at all", () => {
    renderSection();
    expect(section()).toHaveAttribute("aria-expanded", "false");
  });

  it("is closed when the hash names a different section", () => {
    // Opening every section on any hash would be the same defect inverted:
    // the contractor lands on six open panels and still cannot see which one
    // the banner meant.
    window.location.hash = "#setup-rates";
    renderSection();
    expect(section()).toHaveAttribute("aria-expanded", "false");
  });

  it("is closed when the hash matches nothing on the page", () => {
    window.location.hash = "#nothing-here";
    renderSection();
    expect(section()).toHaveAttribute("aria-expanded", "false");
  });
});
