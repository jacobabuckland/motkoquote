/**
 * @vitest-environment happy-dom
 *
 * Issue #160: Improve the empty state on the jobs list
 *
 * These tests verify that:
 * 1. A helper function determines the correct empty state props based on job count
 * 2. When there are zero jobs, the empty state includes an action link
 * 3. When jobs exist but are filtered out, the empty state has no action
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { buildEmptyStateProps } from "@/lib/job-history";

afterEach(cleanup);

describe("Issue #160: Improve the empty state on the jobs list", () => {
  describe("buildEmptyStateProps helper", () => {
    it("returns props with action when there are zero jobs total", () => {
      const props = buildEmptyStateProps({
        filter: "all",
        hasAnyJobs: false,
      });

      expect(props.title).toBe("No jobs yet");
      expect(props.description).toBe(
        "Quotes you send will show up here to track from start to paid."
      );
      expect(props.action).toBeDefined();

      // Render the action to verify it's the right element
      const { container } = render(<>{props.action}</>);
      const link = container.querySelector("a");
      expect(link).toBeTruthy();
      expect(link?.getAttribute("href")).toBe("/jobs/new");
      expect(link?.textContent).toBe("Create your first quote");
    });

    it("returns props without action when jobs exist but filter is empty", () => {
      const props = buildEmptyStateProps({
        filter: "in_progress",
        hasAnyJobs: true,
      });

      expect(props.title).toBe("Nothing in progress");
      expect(props.description).toBe(
        "Live jobs — sent, accepted, awaiting payment — will appear here."
      );
      expect(props.action).toBeUndefined();
    });

    it("includes action for all filters when there are zero jobs", () => {
      const filters = ["all", "in_progress", "completed", "declined", "archived"] as const;

      for (const filter of filters) {
        const props = buildEmptyStateProps({
          filter,
          hasAnyJobs: false,
        });

        expect(props.action).toBeDefined();

        // Verify it's the correct action
        const { container } = render(<>{props.action}</>);
        const link = container.querySelector("a");
        expect(link?.getAttribute("href")).toBe("/jobs/new");
        expect(link?.textContent).toBe("Create your first quote");
        cleanup();
      }
    });

    it("excludes action for all filters when jobs exist but are filtered out", () => {
      const filters = ["all", "in_progress", "completed", "declined", "archived"] as const;

      for (const filter of filters) {
        const props = buildEmptyStateProps({
          filter,
          hasAnyJobs: true,
        });

        expect(props.action).toBeUndefined();
      }
    });
  });

  describe("Integration: action link properties", () => {
    it("action link uses primary button styling", () => {
      const props = buildEmptyStateProps({
        filter: "all",
        hasAnyJobs: false,
      });

      const { container } = render(<>{props.action}</>);
      const link = container.querySelector("a");

      expect(link?.className).toContain("bg-primary");
    });

    it("action link is a Next.js Link component", () => {
      const props = buildEmptyStateProps({
        filter: "all",
        hasAnyJobs: false,
      });

      expect(props.action).toBeDefined();

      // Render and verify it's a proper link element
      const { container } = render(<>{props.action}</>);
      const link = container.querySelector("a");
      expect(link).toBeTruthy();
    });

    it("action link text is exactly 'Create your first quote'", () => {
      const props = buildEmptyStateProps({
        filter: "all",
        hasAnyJobs: false,
      });

      const { container } = render(<>{props.action}</>);
      const link = container.querySelector("a");
      expect(link?.textContent).toBe("Create your first quote");
    });
  });
});
