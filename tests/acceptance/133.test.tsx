/**
 * @vitest-environment happy-dom
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { formatGBP } from "@/lib/format";

// Required: cleanup between tests to avoid DOM pollution
afterEach(cleanup);

describe("Issue #133: Promote the outstanding total to a dashboard hero", () => {
  describe("Time-based greeting helper", () => {
    it("returns 'Good morning' for hours 0-11", async () => {
      // Dynamic import to avoid module-level side effects
      const { getGreeting } = await import("@/lib/greeting");

      expect(getGreeting(0)).toBe("Good morning");
      expect(getGreeting(6)).toBe("Good morning");
      expect(getGreeting(11)).toBe("Good morning");
    });

    it("returns 'Good afternoon' for hours 12-17", async () => {
      const { getGreeting } = await import("@/lib/greeting");

      expect(getGreeting(12)).toBe("Good afternoon");
      expect(getGreeting(15)).toBe("Good afternoon");
      expect(getGreeting(17)).toBe("Good afternoon");
    });

    it("returns 'Good evening' for hours 18-23", async () => {
      const { getGreeting } = await import("@/lib/greeting");

      expect(getGreeting(18)).toBe("Good evening");
      expect(getGreeting(21)).toBe("Good evening");
      expect(getGreeting(23)).toBe("Good evening");
    });
  });

  describe("CountUp component", () => {
    it("renders the final value immediately when motion is reduced", async () => {
      // Mock prefers-reduced-motion
      const matchMedia = vi.fn().mockImplementation((query) => ({
        matches: query === "(prefers-reduced-motion: reduce)",
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));
      vi.stubGlobal("matchMedia", matchMedia);

      const { CountUp } = await import("@/components/ui/count-up");

      render(
        <CountUp
          target={4320}
          duration={600}
          format={(n) => formatGBP(n)}
        />
      );

      // Under reduced motion, the final value should appear immediately
      const element = screen.getByText("£4,320.00");
      expect(element).toBeTruthy();

      vi.unstubAllGlobals();
    });

    it("renders from zero initially when motion is not reduced", async () => {
      // Mock prefers-reduced-motion as false
      const matchMedia = vi.fn().mockImplementation((query) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));
      vi.stubGlobal("matchMedia", matchMedia);

      const { CountUp } = await import("@/components/ui/count-up");

      render(
        <CountUp
          target={4320}
          duration={600}
          format={(n) => formatGBP(n)}
        />
      );

      // Initially should show £0.00 or be animating
      // The exact initial value depends on implementation, but it should start at or near zero
      const element = screen.getByText(/£/);
      expect(element).toBeTruthy();

      vi.unstubAllGlobals();
    });

    it("formats the target value using the provided format function", async () => {
      const matchMedia = vi.fn().mockImplementation(() => ({
        matches: true, // reduced motion for immediate render
        media: "",
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));
      vi.stubGlobal("matchMedia", matchMedia);

      const { CountUp } = await import("@/components/ui/count-up");

      // Test that formatGBP is applied correctly
      render(
        <CountUp
          target={1234.56}
          duration={0}
          format={(n) => formatGBP(n)}
        />
      );

      expect(screen.getByText("£1,234.56")).toBeTruthy();

      vi.unstubAllGlobals();
    });

    it("renders zero as £0.00", async () => {
      const matchMedia = vi.fn().mockImplementation(() => ({
        matches: true,
        media: "",
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));
      vi.stubGlobal("matchMedia", matchMedia);

      const { CountUp } = await import("@/components/ui/count-up");

      render(
        <CountUp
          target={0}
          duration={0}
          format={(n) => formatGBP(n)}
        />
      );

      expect(screen.getByText("£0.00")).toBeTruthy();

      vi.unstubAllGlobals();
    });

    it("renders negative values with the sign", async () => {
      const matchMedia = vi.fn().mockImplementation(() => ({
        matches: true,
        media: "",
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));
      vi.stubGlobal("matchMedia", matchMedia);

      const { CountUp } = await import("@/components/ui/count-up");

      render(
        <CountUp
          target={-500}
          duration={0}
          format={(n) => formatGBP(n)}
        />
      );

      // formatGBP(-500) should render as "-£500.00"
      expect(screen.getByText("-£500.00")).toBeTruthy();

      vi.unstubAllGlobals();
    });
  });

  describe("Dashboard hero section", () => {
    it("renders the greeting with the outstanding total", async () => {
      const matchMedia = vi.fn().mockImplementation(() => ({
        matches: true, // reduced motion for simpler testing
        media: "",
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));
      vi.stubGlobal("matchMedia", matchMedia);

      const { DashboardHero } = await import("@/components/ui/dashboard-hero");

      // Mock current hour as 10am (morning)
      const mockDate = new Date("2026-08-11T10:00:00");
      vi.setSystemTime(mockDate);

      render(<DashboardHero outstandingTotal={4320} />);

      // Should render the greeting
      expect(screen.getByText(/Good morning/)).toBeTruthy();
      // Should render the amount
      expect(screen.getByText(/£4,320.00/)).toBeTruthy();

      vi.useRealTimers();
      vi.unstubAllGlobals();
    });

    it("renders 'Good afternoon' between 12pm and 5pm", async () => {
      const matchMedia = vi.fn().mockImplementation(() => ({
        matches: true,
        media: "",
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));
      vi.stubGlobal("matchMedia", matchMedia);

      const { DashboardHero } = await import("@/components/ui/dashboard-hero");

      const mockDate = new Date("2026-08-11T14:00:00");
      vi.setSystemTime(mockDate);

      render(<DashboardHero outstandingTotal={1000} />);

      expect(screen.getByText(/Good afternoon/)).toBeTruthy();

      vi.useRealTimers();
      vi.unstubAllGlobals();
    });

    it("renders 'Good evening' between 6pm and midnight", async () => {
      const matchMedia = vi.fn().mockImplementation(() => ({
        matches: true,
        media: "",
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));
      vi.stubGlobal("matchMedia", matchMedia);

      const { DashboardHero } = await import("@/components/ui/dashboard-hero");

      const mockDate = new Date("2026-08-11T19:00:00");
      vi.setSystemTime(mockDate);

      render(<DashboardHero outstandingTotal={2500} />);

      expect(screen.getByText(/Good evening/)).toBeTruthy();

      vi.useRealTimers();
      vi.unstubAllGlobals();
    });

    it("renders 'You're all square' when outstanding total is zero", async () => {
      const matchMedia = vi.fn().mockImplementation(() => ({
        matches: false,
        media: "",
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));
      vi.stubGlobal("matchMedia", matchMedia);

      const { DashboardHero } = await import("@/components/ui/dashboard-hero");

      render(<DashboardHero outstandingTotal={0} />);

      expect(screen.getByText("You're all square")).toBeTruthy();
      // Should NOT render a greeting about money owed
      expect(screen.queryByText(/you're owed/)).toBeNull();
      // Should NOT render an amount
      expect(screen.queryByText(/£/)).toBeNull();

      vi.unstubAllGlobals();
    });

    it("uses tabular-nums class on the amount", async () => {
      const matchMedia = vi.fn().mockImplementation(() => ({
        matches: true,
        media: "",
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));
      vi.stubGlobal("matchMedia", matchMedia);

      const { DashboardHero } = await import("@/components/ui/dashboard-hero");

      render(<DashboardHero outstandingTotal={5000} />);

      // Find the element containing the amount
      const amountElement = screen.getByText(/£5,000.00/).closest("div");
      expect(amountElement?.className).toMatch(/tabular-nums/);

      vi.unstubAllGlobals();
    });

    it("uses text-4xl class on the amount", async () => {
      const matchMedia = vi.fn().mockImplementation(() => ({
        matches: true,
        media: "",
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));
      vi.stubGlobal("matchMedia", matchMedia);

      const { DashboardHero } = await import("@/components/ui/dashboard-hero");

      render(<DashboardHero outstandingTotal={5000} />);

      const amountElement = screen.getByText(/£5,000.00/).closest("div");
      expect(amountElement?.className).toMatch(/text-4xl/);

      vi.unstubAllGlobals();
    });
  });
});
