import { beforeEach, describe, expect, it, vi } from "vitest";
import { DRAFT_ALREADY_SENT, DRAFT_HAS_RECORDS } from "@/lib/draft-delete-guard";

// The My work swipe deletes a draft outright, so the action must re-check what
// it is deleting server-side. A client that posts any jobId it likes is the
// case this covers: the guard runs on what the database returns, not on what
// the row looked like when it was rendered.

type JobRow = {
  id: string;
  quotes?: { status: string; contracts?: { id: string }[]; invoices?: { id: string }[] }[];
  job_costs?: { id: string }[];
} | null;

let deleted: string[] = [];

const runDelete = async (job: JobRow, jobId = "11111111-1111-4111-8111-111111111111") => {
  deleted = [];
  vi.resetModules();

  vi.doMock("@/lib/supabase/server", () => ({
    createClient: async () => ({
      auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
      from: (table: string) => ({
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: job, error: null }) }),
        }),
        delete: () => ({
          eq: async (_column: string, value: string) => {
            if (table === "jobs") deleted.push(value);
            return { error: null };
          },
        }),
      }),
    }),
  }));
  vi.doMock("next/cache", () => ({ revalidatePath: () => {} }));

  const { deleteDraftJob } = await import("@/app/jobs/actions");
  return deleteDraftJob({ jobId });
};

describe("deleteDraftJob", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("deletes the job row, letting the draft quote cascade with it", async () => {
    await runDelete({
      id: "11111111-1111-4111-8111-111111111111",
      quotes: [{ status: "draft", contracts: [], invoices: [] }],
    });

    expect(deleted).toEqual(["11111111-1111-4111-8111-111111111111"]);
  });

  it("refuses a job whose quote has already been sent", async () => {
    await expect(
      runDelete({ id: "11111111-1111-4111-8111-111111111111", quotes: [{ status: "sent" }] }),
    ).rejects.toThrow(DRAFT_ALREADY_SENT);

    expect(deleted).toEqual([]);
  });

  it("refuses a job carrying an invoice, so a financial record can't be destroyed", async () => {
    await expect(
      runDelete({
        id: "11111111-1111-4111-8111-111111111111",
        quotes: [{ status: "draft", contracts: [], invoices: [{ id: "invoice-1" }] }],
      }),
    ).rejects.toThrow(DRAFT_HAS_RECORDS);

    expect(deleted).toEqual([]);
  });

  it("refuses a jobId that reads back as nothing — another trade's row, under RLS", async () => {
    await expect(runDelete(null)).rejects.toThrow("Draft not found");

    expect(deleted).toEqual([]);
  });

  it("refuses a jobId that isn't one", async () => {
    await expect(
      runDelete({ id: "x", quotes: [{ status: "draft" }] }, "not-a-uuid"),
    ).rejects.toThrow();

    expect(deleted).toEqual([]);
  });
});
