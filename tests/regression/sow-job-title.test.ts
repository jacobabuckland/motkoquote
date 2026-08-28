import { describe, expect, it } from "vitest";
import { deriveJobTitle, type SowState } from "@/lib/schemas/sow";

// The statement of work was headed "Job". job_type is frequently the empty
// string — the classifier had nothing confident to say — and both the SoW PDF
// and the job page's h1 fell straight through to the literal word, while the
// material for a real title sat one field away in rooms[].work_items.

const sow = (
  job_type: string,
  rooms: { name: string; work_items: string[] }[] = [],
): Pick<SowState, "job_type" | "rooms"> =>
  ({
    job_type,
    rooms: rooms.map((r) => ({ ...r, dimensions: null })),
  }) as unknown as Pick<SowState, "job_type" | "rooms">;

describe("deriveJobTitle", () => {
  it("uses the stated job type when there is one", () => {
    expect(deriveJobTitle(sow("Consumer unit replacement"))).toBe("Consumer unit replacement");
  });

  it("derives a title from captured work when the job type is empty", () => {
    expect(
      deriveJobTitle(
        sow("", [
          { name: "Kitchen", work_items: ["Replace six sockets", "Move the cooker spur"] },
        ]),
      ),
    ).toBe("Replace six sockets & move the cooker spur");
  });

  it("draws across rooms, in the order captured", () => {
    expect(
      deriveJobTitle(
        sow("", [
          { name: "Kitchen", work_items: ["Replace six sockets"] },
          { name: "Landing", work_items: ["Two-way switch"] },
        ]),
      ),
    ).toBe("Replace six sockets & two-way switch");
  });

  it("does not repeat the same work item", () => {
    expect(
      deriveJobTitle(
        sow("", [
          { name: "Kitchen", work_items: ["Replace sockets"] },
          { name: "Utility", work_items: ["replace sockets"] },
        ]),
      ),
    ).toBe("Replace sockets");
  });

  it("treats a whitespace-only job type as absent", () => {
    expect(deriveJobTitle(sow("   ", [{ name: "Hall", work_items: ["Rewire"] }]))).toBe("Rewire");
  });

  it("falls back to the extraction's job type before the work items", () => {
    expect(deriveJobTitle(sow("", [{ name: "Hall", work_items: ["Rewire"] }]), "Rewire job")).toBe(
      "Rewire job",
    );
  });

  it("truncates on a word boundary rather than mid-word", () => {
    const long = "Replace the entire consumer unit including all the associated circuit protection and the earthing arrangements";
    const title = deriveJobTitle(sow("", [{ name: "Hall", work_items: [long] }]));

    expect(title.endsWith("…")).toBe(true);
    expect(title.length).toBeLessThanOrEqual(81);
    // The last word before the ellipsis must be whole.
    expect(long).toContain(title.slice(0, -1));
    expect(title).not.toMatch(/[,&\s]…$/);
  });

  it("still says Job when genuinely nothing was captured", () => {
    // An honest blank beats a fabricated description of work.
    expect(deriveJobTitle(sow("", []))).toBe("Job");
    expect(deriveJobTitle(sow("", [{ name: "Hall", work_items: [] }]))).toBe("Job");
    expect(deriveJobTitle(null)).toBe("Job");
  });
});
