/**
 * @vitest-environment happy-dom
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ToastProvider } from "@/components/ui/toast";

afterEach(cleanup);

describe("Issue #351: Referral copy overstates what the referee gets", () => {
  it("body copy does not claim the referee gets anything for using the code", async () => {
    const { ReferralSection } = await import("@/app/settings/referral-section");

    render(
      <ToastProvider>
        <ReferralSection
          referralCode="ABC123"
          appUrl="https://motko.app"
        />
      </ToastProvider>
    );

    const bodyText = screen.getByText((content, element) => {
      return (
        element?.tagName === "P" &&
        element.className.includes("text-text-secondary") &&
        element.className.includes("mb-3")
      );
    });

    // The current misleading text: "They get 3 free jobs, and you get 3 more..."
    // This assertion will fail once the copy is fixed.
    expect(
      bodyText.textContent,
      "Body copy must not claim the referee gets anything for using the code"
    ).not.toMatch(/they get 3 free jobs/i);

    // Even softer claims are misleading if they imply causation
    expect(
      bodyText.textContent,
      "Body copy must not imply the referee receives a benefit from the code"
    ).not.toMatch(/they get/i);
  });

  it("body copy explains what the referrer gets: +3 credits rising to +5", async () => {
    const { ReferralSection } = await import("@/app/settings/referral-section");

    render(
      <ToastProvider>
        <ReferralSection
          referralCode="ABC123"
          appUrl="https://motko.app"
        />
      </ToastProvider>
    );

    const bodyText = screen.getByText((content, element) => {
      return (
        element?.tagName === "P" &&
        element.className.includes("text-text-secondary") &&
        element.className.includes("mb-3")
      );
    });

    // Must state the referrer's reward
    expect(
      bodyText.textContent,
      "Body copy must state what the referrer gets"
    ).toMatch(/you get 3/i);

    // Must mention the scaling reward
    expect(
      bodyText.textContent,
      "Body copy must mention rising to 5"
    ).toMatch(/rising to 5/i);

    // Must mention the activation threshold
    expect(
      bodyText.textContent,
      "Body copy must mention 5 activated referrals"
    ).toMatch(/5 activated referrals/i);
  });

  it("source comment accurately states +3 rising to +5, not just +5", () => {
    const componentPath = join(
      process.cwd(),
      "src/app/settings/referral-section.tsx"
    );
    const source = readFileSync(componentPath, "utf-8");

    // Find the comment above the component export
    const commentMatch = source.match(
      /\/\/ Shows the trade their own shareable code.*?\n\/\/ .*?\n\/\/ (.*)/
    );

    expect(commentMatch, "Expected to find the component comment").toBeTruthy();

    const thirdCommentLine = commentMatch![1];

    // The current wrong comment: "The referrer's +5 unlocks when..."
    // Should say +3 rising to +5
    expect(
      thirdCommentLine,
      "Comment must mention +3, not just +5"
    ).toMatch(/\+3/);

    expect(
      thirdCommentLine,
      "Comment must mention rising to +5"
    ).toMatch(/rising to \+?5/i);
  });

  it("fallback message (when referralCode is null) remains accurate", async () => {
    const { ReferralSection } = await import("@/app/settings/referral-section");

    render(
      <ToastProvider>
        <ReferralSection
          referralCode={null}
          appUrl="https://motko.app"
        />
      </ToastProvider>
    );

    // This message is already accurate and should not change
    expect(
      screen.getByText(/Your referral code will appear here/i)
    ).toBeDefined();
  });

  it("component renders without crashing when given a valid referral code", async () => {
    const { ReferralSection } = await import("@/app/settings/referral-section");

    const { container } = render(
      <ToastProvider>
        <ReferralSection
          referralCode="ABC123"
          appUrl="https://motko.app"
        />
      </ToastProvider>
    );

    // Should render the section heading
    expect(screen.getByText("Refer a trade")).toBeDefined();

    // Should render the code
    expect(screen.getByText("ABC123")).toBeDefined();

    // Should render copy buttons
    expect(screen.getByText("Copy code")).toBeDefined();
    expect(screen.getByText("Copy link")).toBeDefined();

    // Should not crash
    expect(container.querySelector("section")).toBeTruthy();
  });
});
