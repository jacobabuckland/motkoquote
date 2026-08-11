import { describe, expect, it } from "vitest";
import { normalizeUkPostcode } from "@/lib/normalize-postcode";
import { placeToStructuredAddress, type PlaceResult } from "@/lib/google-maps";

describe("Issue #106: Normalise UK postcodes to canonical form when an address is captured", () => {
  describe("normalizeUkPostcode helper", () => {
    describe("Valid UK postcodes normalize to canonical form", () => {
      it("normalizes all-lowercase with no space", () => {
        expect(normalizeUkPostcode("sw1a1aa")).toBe("SW1A 1AA");
      });

      it("normalizes all-uppercase with no space", () => {
        expect(normalizeUkPostcode("SW1A1AA")).toBe("SW1A 1AA");
      });

      it("normalizes mixed case with multiple spaces", () => {
        expect(normalizeUkPostcode("sw1a  1aa")).toBe("SW1A 1AA");
      });

      it("normalizes mixed case with correct spacing", () => {
        expect(normalizeUkPostcode("Sw1a 1Aa")).toBe("SW1A 1AA");
      });

      it("normalizes with leading and trailing whitespace", () => {
        expect(normalizeUkPostcode("  sw1a  1aa  ")).toBe("SW1A 1AA");
      });

      it("is idempotent on already-canonical postcodes", () => {
        expect(normalizeUkPostcode("SW1A 1AA")).toBe("SW1A 1AA");
      });
    });

    describe("Both outward-code lengths are handled", () => {
      it("normalizes 3-character outward code (e.g. M1 1AE)", () => {
        expect(normalizeUkPostcode("m11ae")).toBe("M1 1AE");
      });

      it("normalizes 4-character outward code (e.g. DN55 1PT)", () => {
        expect(normalizeUkPostcode("dn551pt")).toBe("DN55 1PT");
      });

      it("normalizes 2-character outward code (e.g. W1 2AB)", () => {
        expect(normalizeUkPostcode("w12ab")).toBe("W1 2AB");
      });

      it("normalizes full-length 4+3 postcode (e.g. EC1A 1BB)", () => {
        expect(normalizeUkPostcode("ec1a1bb")).toBe("EC1A 1BB");
      });
    });

    describe("Unrecognised inputs are returned unchanged", () => {
      it("returns non-UK postcode unchanged (e.g. Paris)", () => {
        expect(normalizeUkPostcode("75008")).toBe("75008");
      });

      it("returns empty string unchanged", () => {
        expect(normalizeUkPostcode("")).toBe("");
      });

      it("returns whitespace-only string as empty", () => {
        expect(normalizeUkPostcode("   ")).toBe("");
      });

      it("returns arbitrary text unchanged", () => {
        expect(normalizeUkPostcode("not a postcode")).toBe("not a postcode");
      });

      it("returns too-short input unchanged", () => {
        expect(normalizeUkPostcode("SW1")).toBe("SW1");
      });

      it("returns too-long input unchanged", () => {
        expect(normalizeUkPostcode("SW1A 1AA EXTRA")).toBe("SW1A 1AA EXTRA");
      });
    });
  });

  describe("Integration with placeToStructuredAddress", () => {
    const mockPlace = (
      postcode: string | null,
      formatted = "10 Downing St, London"
    ): PlaceResult => ({
      id: "place-123",
      formattedAddress: formatted,
      addressComponents: postcode
        ? [
            { longText: "10", shortText: "10", types: ["street_number"] },
            { longText: "Downing Street", shortText: "Downing St", types: ["route"] },
            { longText: "Westminster", shortText: "Westminster", types: ["postal_town"] },
            { longText: postcode, shortText: postcode, types: ["postal_code"] },
          ]
        : [
            { longText: "10", shortText: "10", types: ["street_number"] },
            { longText: "Downing Street", shortText: "Downing St", types: ["route"] },
            { longText: "Westminster", shortText: "Westminster", types: ["postal_town"] },
          ],
      location: { lat: () => 51.503396, lng: () => -0.127764 },
      fetchFields: async () => {},
    });

    it("normalizes lowercase postcode from Places", () => {
      const place = mockPlace("sw1a1aa");
      const address = placeToStructuredAddress(place);
      expect(address.postcode).toBe("SW1A 1AA");
    });

    it("normalizes uppercase postcode with no space", () => {
      const place = mockPlace("SW1A1AA");
      const address = placeToStructuredAddress(place);
      expect(address.postcode).toBe("SW1A 1AA");
    });

    it("normalizes postcode with extra whitespace", () => {
      const place = mockPlace("  sw1a  1aa  ");
      const address = placeToStructuredAddress(place);
      expect(address.postcode).toBe("SW1A 1AA");
    });

    it("normalizes 3-character outward code", () => {
      const place = mockPlace("m11ae");
      const address = placeToStructuredAddress(place);
      expect(address.postcode).toBe("M1 1AE");
    });

    it("normalizes 4-character outward code", () => {
      const place = mockPlace("dn551pt");
      const address = placeToStructuredAddress(place);
      expect(address.postcode).toBe("DN55 1PT");
    });

    it("preserves already-canonical postcode", () => {
      const place = mockPlace("SW1A 1AA");
      const address = placeToStructuredAddress(place);
      expect(address.postcode).toBe("SW1A 1AA");
    });

    it("stores non-UK postcode unchanged", () => {
      const place = mockPlace("75008", "Paris, France");
      const address = placeToStructuredAddress(place);
      expect(address.postcode).toBe("75008");
    });

    it("omits postcode when Places returns none", () => {
      const place = mockPlace(null);
      const address = placeToStructuredAddress(place);
      expect(address.postcode).toBeUndefined();
    });

    it("omits postcode when Places returns empty string", () => {
      const place = mockPlace("");
      const address = placeToStructuredAddress(place);
      expect(address.postcode).toBeUndefined();
    });

    it("omits postcode when Places returns whitespace-only", () => {
      const place = mockPlace("   ");
      const address = placeToStructuredAddress(place);
      expect(address.postcode).toBeUndefined();
    });

    it("does not modify other address fields", () => {
      const place = mockPlace("sw1a1aa");
      const address = placeToStructuredAddress(place);

      expect(address.formatted).toBe("10 Downing St, London");
      expect(address.line1).toBe("10 Downing Street");
      expect(address.town).toBe("Westminster");
      expect(address.lat).toBe(51.503396);
      expect(address.lng).toBe(-0.127764);
      expect(address.place_id).toBe("place-123");
    });
  });
});
