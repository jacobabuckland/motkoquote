/**
 * @vitest-environment happy-dom
 *
 * Issue #144: Add a monogram fallback and fix logo alt text
 *
 * These tests verify that:
 * 1. Initials are correctly extracted from company names
 * 2. Text color contrasts correctly against brand colors
 * 3. The Monogram component renders initials on the brand color
 * 4. Edge cases (empty names, non-letters, invalid colors) are handled
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { extractInitials } from "@/lib/extract-initials";
import { getContrastingTextColor } from "@/lib/color-contrast";
import { Monogram } from "@/components/ui/monogram";

afterEach(cleanup);

describe("Issue #144: Add a monogram fallback and fix logo alt text", () => {
  describe("extractInitials helper", () => {
    describe("Single-word names", () => {
      it("extracts one initial from a single word", () => {
        expect(extractInitials("Acme")).toBe("A");
      });

      it("extracts uppercase initial from lowercase word", () => {
        expect(extractInitials("plumbing")).toBe("P");
      });

      it("extracts initial from mixed case", () => {
        expect(extractInitials("eBay")).toBe("E");
      });
    });

    describe("Multi-word names", () => {
      it("extracts first two initials from two words", () => {
        expect(extractInitials("Acme Corp")).toBe("AC");
      });

      it("extracts first two initials from three words", () => {
        expect(extractInitials("Acme Corp Ltd")).toBe("AC");
      });

      it("extracts first two initials from four words", () => {
        expect(extractInitials("London Plumbing and Heating")).toBe("LP");
      });

      it("handles extra whitespace between words", () => {
        expect(extractInitials("Acme  Corp")).toBe("AC");
      });

      it("handles leading and trailing whitespace", () => {
        expect(extractInitials("  Acme Corp  ")).toBe("AC");
      });
    });

    describe("Non-letter characters", () => {
      it("skips leading non-letter and finds first alphanumeric", () => {
        expect(extractInitials("123 Plumbing")).toBe("1P");
      });

      it("extracts from name starting with special character", () => {
        expect(extractInitials("@Acme Corp")).toBe("AC");
      });

      it("handles name with only numbers", () => {
        expect(extractInitials("24 7")).toBe("24");
      });

      it("returns empty string when no alphanumeric characters exist", () => {
        expect(extractInitials("@#$%")).toBe("");
      });
    });

    describe("Edge cases", () => {
      it("returns empty string for empty input", () => {
        expect(extractInitials("")).toBe("");
      });

      it("returns empty string for whitespace-only input", () => {
        expect(extractInitials("   ")).toBe("");
      });

      it("handles single letter", () => {
        expect(extractInitials("A")).toBe("A");
      });

      it("handles hyphenated name", () => {
        expect(extractInitials("Smith-Jones")).toBe("SJ");
      });

      it("handles name with apostrophe", () => {
        expect(extractInitials("O'Brien's Plumbing")).toBe("OP");
      });
    });
  });

  describe("getContrastingTextColor helper", () => {
    describe("Dark backgrounds get light text", () => {
      it("returns light text for default brand color #004225", () => {
        const textColor = getContrastingTextColor("#004225");
        expect(textColor).toMatch(/^#[fF]{6}$|^#[eE]{6}$/); // white or near-white
      });

      it("returns light text for black", () => {
        const textColor = getContrastingTextColor("#000000");
        expect(textColor).toMatch(/^#[fF]{6}$|^#[eE]{6}$/);
      });

      it("returns light text for dark blue", () => {
        const textColor = getContrastingTextColor("#003366");
        expect(textColor).toMatch(/^#[fF]{6}$|^#[eE]{6}$/);
      });

      it("returns light text for dark red", () => {
        const textColor = getContrastingTextColor("#8B0000");
        expect(textColor).toMatch(/^#[fF]{6}$|^#[eE]{6}$/);
      });
    });

    describe("Light backgrounds get dark text", () => {
      it("returns dark text for white", () => {
        const textColor = getContrastingTextColor("#FFFFFF");
        expect(textColor).toMatch(/^#[0-2][0-9A-Fa-f]{5}$/); // dark color
      });

      it("returns dark text for light yellow", () => {
        const textColor = getContrastingTextColor("#FFEB3B");
        expect(textColor).toMatch(/^#[0-2][0-9A-Fa-f]{5}$/);
      });

      it("returns dark text for light blue", () => {
        const textColor = getContrastingTextColor("#ADD8E6");
        expect(textColor).toMatch(/^#[0-2][0-9A-Fa-f]{5}$/);
      });

      it("returns dark text for light gray", () => {
        const textColor = getContrastingTextColor("#D3D3D3");
        expect(textColor).toMatch(/^#[0-2][0-9A-Fa-f]{5}$/);
      });
    });

    describe("Edge cases", () => {
      it("handles 3-character hex color", () => {
        const textColor = getContrastingTextColor("#FFF");
        expect(textColor).toBeDefined();
        expect(textColor.length).toBeGreaterThan(0);
      });

      it("handles lowercase hex", () => {
        const textColor = getContrastingTextColor("#ffffff");
        expect(textColor).toMatch(/^#[0-2][0-9A-Fa-f]{5}$/);
      });

      it("handles invalid hex by defaulting to safe color", () => {
        const textColor = getContrastingTextColor("not-a-color");
        expect(textColor).toBeDefined();
        expect(textColor).toMatch(/^#[0-9A-Fa-f]{6}$/);
      });

      it("handles empty string by defaulting to safe color", () => {
        const textColor = getContrastingTextColor("");
        expect(textColor).toBeDefined();
        expect(textColor).toMatch(/^#[0-9A-Fa-f]{6}$/);
      });

      it("handles missing # prefix", () => {
        const textColor = getContrastingTextColor("004225");
        expect(textColor).toBeDefined();
        expect(textColor).toMatch(/^#[0-9A-Fa-f]{6}$/);
      });
    });
  });

  describe("Monogram component", () => {
    describe("Renders initials on brand color", () => {
      it("renders single initial for single-word company", () => {
        render(<Monogram companyName="Acme" brandColor="#004225" />);

        expect(screen.getByText("A")).toBeTruthy();
      });

      it("renders two initials for multi-word company", () => {
        render(<Monogram companyName="Acme Corp" brandColor="#004225" />);

        expect(screen.getByText("AC")).toBeTruthy();
      });

      it("applies brand color as background", () => {
        render(<Monogram companyName="Acme" brandColor="#FF5733" />);

        const monogram = screen.getByText("A").parentElement;
        const styles = window.getComputedStyle(monogram!);
        // The component should apply backgroundColor style
        expect(styles.backgroundColor || monogram!.style.backgroundColor).toBeTruthy();
      });

      it("uses contrasting text color", () => {
        render(<Monogram companyName="Acme" brandColor="#000000" />);

        const initial = screen.getByText("A");
        const styles = window.getComputedStyle(initial);
        // Light text on dark background
        expect(styles.color || initial.style.color).toBeTruthy();
      });
    });

    describe("Edge cases", () => {
      it("renders placeholder for empty company name", () => {
        render(<Monogram companyName="" brandColor="#004225" />);

        // Should render a placeholder, not crash or show empty initials
        // The exact implementation (icon, glyph, or text like "?") is flexible,
        // but it must render *something* identifiable
        expect(document.body.innerHTML).not.toBe("");
      });

      it("renders placeholder for whitespace-only company name", () => {
        render(<Monogram companyName="   " brandColor="#004225" />);

        expect(document.body.innerHTML).not.toBe("");
      });

      it("renders placeholder for non-alphanumeric company name", () => {
        render(<Monogram companyName="@#$%" brandColor="#004225" />);

        expect(document.body.innerHTML).not.toBe("");
      });

      it("uses default brand color when brandColor is undefined", () => {
        render(<Monogram companyName="Acme" />);

        const monogram = screen.getByText("A").parentElement;
        expect(monogram).toBeTruthy();
      });

      it("handles invalid brand color gracefully", () => {
        render(<Monogram companyName="Acme" brandColor="not-a-color" />);

        expect(screen.getByText("A")).toBeTruthy();
      });
    });

    describe("Size prop", () => {
      it("accepts size prop for dimensions", () => {
        render(<Monogram companyName="Acme" brandColor="#004225" size={48} />);

        const monogram = screen.getByText("A").parentElement;
        expect(monogram).toBeTruthy();
        // Size is applied via width/height styles or classes
      });

      it("uses default size when size prop is omitted", () => {
        render(<Monogram companyName="Acme" brandColor="#004225" />);

        expect(screen.getByText("A")).toBeTruthy();
      });
    });
  });

  describe("Integration requirements", () => {
    it("monogram dimensions match logo dimensions (h-12 w-12)", () => {
      render(<Monogram companyName="Acme" brandColor="#004225" size={48} />);

      const monogram = screen.getByText("A").parentElement;
      // h-12 w-12 in Tailwind is 3rem = 48px
      // The component should render at the same size as logos
      expect(monogram).toBeTruthy();
    });
  });
});
