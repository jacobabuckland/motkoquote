/**
 * @vitest-environment happy-dom
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { IncompleteCaptureCard } from "@/app/jobs/[id]/incomplete-capture-card";

afterEach(cleanup);

describe("One list of missing details, not two (#735)", () => {
  describe("IncompleteCaptureCard filters out customer detail slots", () => {
    it("does not show customer_name", () => {
      render(
        <IncompleteCaptureCard
          unaskedRequired={["customer_name"]}
          capEnded={false}
          href="#quote"
        />,
      );

      // The card should render nothing when only customer details are missing
      expect(screen.queryByText(/missing from this quote/i)).toBeNull();
      expect(screen.queryByText(/customer.*name/i)).toBeNull();
    });

    it("does not show customer_contact", () => {
      render(
        <IncompleteCaptureCard
          unaskedRequired={["customer_contact"]}
          capEnded={false}
          href="#quote"
        />,
      );

      expect(screen.queryByText(/missing from this quote/i)).toBeNull();
      expect(screen.queryByText(/contact/i)).toBeNull();
    });

    it("does not show site_address", () => {
      render(
        <IncompleteCaptureCard
          unaskedRequired={["site_address"]}
          capEnded={false}
          href="#quote"
        />,
      );

      expect(screen.queryByText(/missing from this quote/i)).toBeNull();
      expect(screen.queryByText(/address/i)).toBeNull();
    });

    it("does not show any customer details when all three are missing", () => {
      render(
        <IncompleteCaptureCard
          unaskedRequired={["customer_name", "customer_contact", "site_address"]}
          capEnded={false}
          href="#quote"
        />,
      );

      // Card renders nothing because only customer details are missing
      expect(screen.queryByText(/missing from this quote/i)).toBeNull();
    });
  });

  describe("IncompleteCaptureCard still shows scope-related gaps", () => {
    it("shows materials_supply", () => {
      render(
        <IncompleteCaptureCard
          unaskedRequired={["materials_supply"]}
          capEnded={false}
          href="#quote"
        />,
      );

      expect(screen.getByText("1 detail is missing from this quote")).toBeDefined();
      expect(screen.getByText("who supplies the materials")).toBeDefined();
    });

    it("shows agreed_costs", () => {
      render(
        <IncompleteCaptureCard
          unaskedRequired={["agreed_costs"]}
          capEnded={false}
          href="#quote"
        />,
      );

      expect(screen.getByText("1 detail is missing from this quote")).toBeDefined();
      expect(screen.getByText("what's been agreed on cost")).toBeDefined();
    });

    it("shows crew", () => {
      render(
        <IncompleteCaptureCard
          unaskedRequired={["crew"]}
          capEnded={false}
          href="#quote"
        />,
      );

      expect(screen.getByText("1 detail is missing from this quote")).toBeDefined();
      expect(screen.getByText("who's on site")).toBeDefined();
    });

    it("shows duration", () => {
      render(
        <IncompleteCaptureCard
          unaskedRequired={["duration"]}
          capEnded={false}
          href="#quote"
        />,
      );

      expect(screen.getByText("1 detail is missing from this quote")).toBeDefined();
      expect(screen.getByText("how to price it")).toBeDefined();
    });

    it("shows working_dates", () => {
      render(
        <IncompleteCaptureCard
          unaskedRequired={["working_dates"]}
          capEnded={false}
          href="#quote"
        />,
      );

      expect(screen.getByText("1 detail is missing from this quote")).toBeDefined();
      expect(screen.getByText("when you're doing the work")).toBeDefined();
    });

    it("shows deadline", () => {
      render(
        <IncompleteCaptureCard
          unaskedRequired={["deadline"]}
          capEnded={false}
          href="#quote"
        />,
      );

      expect(screen.getByText("1 detail is missing from this quote")).toBeDefined();
      expect(screen.getByText("the deadline")).toBeDefined();
    });

    it("shows multiple scope slots", () => {
      render(
        <IncompleteCaptureCard
          unaskedRequired={["materials_supply", "agreed_costs", "crew"]}
          capEnded={false}
          href="#quote"
        />,
      );

      expect(screen.getByText("3 details are missing from this quote")).toBeDefined();
      expect(screen.getByText("who supplies the materials")).toBeDefined();
      expect(screen.getByText("what's been agreed on cost")).toBeDefined();
      expect(screen.getByText("who's on site")).toBeDefined();
    });
  });

  describe("Mixed case: scope slots AND customer details", () => {
    it("shows only the scope slots, filters out customer details", () => {
      render(
        <IncompleteCaptureCard
          unaskedRequired={[
            "materials_supply",
            "customer_name",
            "agreed_costs",
            "customer_contact",
            "site_address",
          ]}
          capEnded={false}
          href="#quote"
        />,
      );

      // Should show 2 details (materials_supply and agreed_costs), not 5
      expect(screen.getByText("2 details are missing from this quote")).toBeDefined();
      expect(screen.getByText("who supplies the materials")).toBeDefined();
      expect(screen.getByText("what's been agreed on cost")).toBeDefined();

      // Customer details should not appear
      expect(screen.queryByText(/customer.*name/i)).toBeNull();
      expect(screen.queryByText(/contact details/i)).toBeNull();
      expect(screen.queryByText(/site address/i)).toBeNull();
    });

    it("shows one scope slot when mixed with customer details", () => {
      render(
        <IncompleteCaptureCard
          unaskedRequired={["crew", "customer_name", "site_address"]}
          capEnded={false}
          href="#quote"
        />,
      );

      // Should show singular "1 detail", not "3 details"
      expect(screen.getByText("1 detail is missing from this quote")).toBeDefined();
      expect(screen.getByText("who's on site")).toBeDefined();
      expect(screen.queryByText(/customer.*name/i)).toBeNull();
      expect(screen.queryByText(/address/i)).toBeNull();
    });
  });

  describe("The criterion: one warning, in the right place", () => {
    it("a quote missing only a phone number produces no IncompleteCaptureCard", () => {
      // customer_contact represents missing phone/email
      render(
        <IncompleteCaptureCard
          unaskedRequired={["customer_contact"]}
          capEnded={false}
          href="#quote"
        />,
      );

      // Nothing renders on the job page
      expect(screen.queryByText(/missing from this quote/i)).toBeNull();

      // (The editor's "Before you send" flag would show this, tested separately)
    });

    it("a quote missing only customer details produces no IncompleteCaptureCard", () => {
      render(
        <IncompleteCaptureCard
          unaskedRequired={["customer_name", "customer_contact", "site_address"]}
          capEnded={false}
          href="#quote"
        />,
      );

      // The card does not render at all
      expect(screen.queryByText(/missing from this quote/i)).toBeNull();
      expect(screen.queryByRole("link")).toBeNull();
    });
  });

  describe("Edge case: cap-ended with no scope slots", () => {
    it("shows the cap notice even when only customer details were missing", () => {
      // The call hit its limit, and only customer details are outstanding.
      // The cap notice is about call termination, not about gaps, so it shows.
      render(
        <IncompleteCaptureCard
          unaskedRequired={["customer_name", "customer_contact"]}
          capEnded={true}
          href="#quote"
        />,
      );

      // No heading about missing details
      expect(screen.queryByText(/missing from this quote/i)).toBeNull();

      // But the cap notice should appear (existing behaviour from incomplete-capture-card.tsx:55-64)
      expect(screen.getByText("The call reached its limit")).toBeDefined();
    });

    it("folds the cap into the scope-gaps card, not a separate notice", () => {
      render(
        <IncompleteCaptureCard
          unaskedRequired={["materials_supply", "customer_name"]}
          capEnded={true}
          href="#quote"
        />,
      );

      // One card with one heading
      expect(screen.getByText("1 detail is missing from this quote")).toBeDefined();
      expect(screen.getByText("who supplies the materials")).toBeDefined();

      // Cap notice is subordinate text, not a second heading
      expect(screen.queryByText("The call reached its limit")).toBeNull();
      expect(screen.getByText(/ended on its time or question limit/)).toBeDefined();

      // Customer name does not appear
      expect(screen.queryByText(/customer.*name/i)).toBeNull();
    });
  });

  describe("Existing behaviour preserved", () => {
    it("renders nothing when unaskedRequired is empty", () => {
      render(
        <IncompleteCaptureCard unaskedRequired={[]} capEnded={false} href="#quote" />,
      );

      expect(screen.queryByText(/missing from this quote/i)).toBeNull();
    });

    it("uses singular grammar for one scope slot", () => {
      render(
        <IncompleteCaptureCard
          unaskedRequired={["deadline"]}
          capEnded={false}
          href="#quote"
        />,
      );

      expect(screen.getByText("1 detail is missing from this quote")).toBeDefined();
      expect(screen.getByText(/fill it in/)).toBeDefined();
    });

    it("uses plural grammar for multiple scope slots", () => {
      render(
        <IncompleteCaptureCard
          unaskedRequired={["materials_supply", "crew"]}
          capEnded={false}
          href="#quote"
        />,
      );

      expect(screen.getByText("2 details are missing from this quote")).toBeDefined();
      expect(screen.getByText(/fill them in/)).toBeDefined();
    });

    it("links to the editor", () => {
      render(
        <IncompleteCaptureCard
          unaskedRequired={["materials_supply"]}
          capEnded={false}
          href="#quote"
        />,
      );

      const link = screen.getByRole("link");
      expect(link).toHaveAttribute("href", "#quote");
    });
  });
});
