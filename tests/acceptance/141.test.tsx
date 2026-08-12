/**
 * @vitest-environment happy-dom
 *
 * Issue #141: Render the live transcript during voice intake
 *
 * These tests verify that the live transcript is rendered during voice intake.
 * They currently fail because the transcript rendering hasn't been implemented yet.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRouter } from "next/navigation";
import NewJobPage from "@/app/jobs/new/page";

// Required cleanup since globals: true is not set
afterEach(cleanup);

// Mock Next.js router
vi.mock("next/navigation", () => ({
  useRouter: vi.fn(),
}));

// Mock all server actions
vi.mock("@/app/jobs/actions", () => ({
  createRealtimeSession: vi.fn().mockResolvedValue({
    jobId: "test-job-id",
    clientSecret: "test-secret",
  }),
  saveSowDelta: vi.fn().mockResolvedValue({ sowState: null }),
  completeSowConversation: vi.fn().mockResolvedValue(undefined),
  createManualJob: vi.fn().mockResolvedValue({ jobId: "manual-job-id" }),
  saveVoiceTranscript: vi.fn().mockResolvedValue(undefined),
  reportVoicePipelineFailure: vi.fn().mockResolvedValue(undefined),
  saveContractorFirstName: vi.fn().mockResolvedValue(undefined),
  recordTeamMember: vi.fn().mockResolvedValue(undefined),
}));

describe("Issue #141: Render the live transcript during voice intake", () => {
  let mockRouter: { push: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockRouter = { push: vi.fn() };
    vi.mocked(useRouter).mockReturnValue(
      mockRouter as unknown as ReturnType<typeof useRouter>,
    );
  });

  describe("Transcript container exists and renders", () => {
    it("transcript container with data-testid='voice-transcript' is present on the page", () => {
      render(<NewJobPage />);

      // The transcript container should be rendered even on the initial explainer screen
      // (it will be empty until a session starts, but the container should exist)
      const transcriptContainer = screen.queryByTestId("voice-transcript");

      // This will FAIL until the transcript rendering is implemented
      expect(transcriptContainer).toBeTruthy();
    });

    it("transcript container is empty when page first loads", () => {
      render(<NewJobPage />);

      const transcriptContainer = screen.queryByTestId("voice-transcript");

      // This will FAIL until implementation
      expect(transcriptContainer).toBeTruthy();

      // Should have no content initially
      if (transcriptContainer) {
        expect(transcriptContainer.textContent?.trim()).toBe("");
      }
    });

    it("transcript container has no placeholder text in empty state", () => {
      render(<NewJobPage />);

      const transcriptContainer = screen.queryByTestId("voice-transcript");

      // This will FAIL until implementation
      expect(transcriptContainer).toBeTruthy();

      // Should not have any child elements when empty (no placeholder)
      if (transcriptContainer) {
        expect(transcriptContainer.children.length).toBe(0);
      }
    });
  });

  describe("Transcript container has fixed bounds", () => {
    it("transcript container has overflow styles for scrolling", () => {
      render(<NewJobPage />);

      const transcriptContainer = screen.queryByTestId("voice-transcript");

      // This will FAIL until implementation
      expect(transcriptContainer).toBeTruthy();

      if (transcriptContainer) {
        const computedStyle = window.getComputedStyle(transcriptContainer);

        // Should have overflow set to auto or scroll so it doesn't push layout
        const overflowY = computedStyle.overflowY || computedStyle.overflow;
        expect(overflowY).toMatch(/auto|scroll/);
      }
    });

    it("transcript container has a max-height constraint", () => {
      render(<NewJobPage />);

      const transcriptContainer = screen.queryByTestId("voice-transcript");

      // This will FAIL until implementation
      expect(transcriptContainer).toBeTruthy();

      if (transcriptContainer) {
        const computedStyle = window.getComputedStyle(transcriptContainer);

        // Should have a max-height set (not 'none')
        expect(computedStyle.maxHeight).not.toBe("none");
      }
    });
  });

  describe("Transcript structure accommodates text rendering", () => {
    it("transcript container accepts text content without wrapping it in extra elements", () => {
      render(<NewJobPage />);

      const transcriptContainer = screen.queryByTestId("voice-transcript");

      // This will FAIL until implementation
      expect(transcriptContainer).toBeTruthy();

      // The container should be capable of displaying plain text or simple divs/spans
      // This tests that the structure is set up correctly for transcript rendering
      if (transcriptContainer) {
        // Just verify it's a valid DOM element with text rendering capability
        expect(transcriptContainer.tagName).toMatch(/DIV|SECTION|ARTICLE/);
      }
    });
  });

  describe("Transcript appears in the correct location", () => {
    it("transcript container is positioned after the page header", () => {
      render(<NewJobPage />);

      // The page should have a header
      const header = screen.queryByRole("banner");
      expect(header).toBeTruthy();

      // And the transcript should exist
      const transcriptContainer = screen.queryByTestId("voice-transcript");

      // This will FAIL until implementation
      expect(transcriptContainer).toBeTruthy();

      if (header && transcriptContainer) {
        // Transcript should appear after the header in document order
        const headerRect = header.getBoundingClientRect();
        const transcriptRect = transcriptContainer.getBoundingClientRect();

        expect(transcriptRect.top).toBeGreaterThan(headerRect.bottom - 1);
      }
    });

    it("transcript container is within the main content area", () => {
      render(<NewJobPage />);

      const main = screen.queryByRole("main");
      expect(main).toBeTruthy();

      const transcriptContainer = screen.queryByTestId("voice-transcript");

      // This will FAIL until implementation
      expect(transcriptContainer).toBeTruthy();

      if (main && transcriptContainer) {
        // Transcript should be a descendant of main
        expect(main.contains(transcriptContainer)).toBe(true);
      }
    });
  });
});
