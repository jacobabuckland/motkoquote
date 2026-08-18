import { describe, it, expect } from "vitest";
import { matchJobBySpokenReference, type JobSummary } from "./match-job";

describe("matchJobBySpokenReference", () => {
  const sampleJobs: JobSummary[] = [
    {
      id: "job-1",
      customer_name: "Henderson",
      job_reference: "MK-1001",
      updated_at: "2026-08-10T10:00:00Z",
    },
    {
      id: "job-2",
      customer_name: "Smith",
      job_reference: "MK-1002",
      updated_at: "2026-08-15T10:00:00Z",
    },
    {
      id: "job-3",
      customer_name: "Jones",
      job_reference: "MK-1003",
      updated_at: "2026-08-17T10:00:00Z", // Most recent
    },
  ];

  describe("customer name matching", () => {
    it("matches by customer name (case-insensitive)", () => {
      const result = matchJobBySpokenReference("the Henderson job", sampleJobs);
      expect(result).toEqual(sampleJobs[0]);
    });

    it("matches by lowercase customer name", () => {
      const result = matchJobBySpokenReference("henderson", sampleJobs);
      expect(result).toEqual(sampleJobs[0]);
    });

    it("matches by uppercase customer name", () => {
      const result = matchJobBySpokenReference("HENDERSON", sampleJobs);
      expect(result).toEqual(sampleJobs[0]);
    });

    it("matches with variations in phrasing", () => {
      const result = matchJobBySpokenReference("the smith one", sampleJobs);
      expect(result).toEqual(sampleJobs[1]);
    });

    it("returns ambiguous when multiple jobs match", () => {
      const multipleSmithJobs = [
        ...sampleJobs,
        {
          id: "job-4",
          customer_name: "Smith & Co",
          job_reference: "MK-1004",
          updated_at: "2026-08-16T10:00:00Z",
        },
      ];

      const result = matchJobBySpokenReference("smith", multipleSmithJobs);
      expect(result).toBe("ambiguous");
    });

    it("returns null when no jobs match", () => {
      const result = matchJobBySpokenReference("the Brown job", sampleJobs);
      expect(result).toBeNull();
    });
  });

  describe("job reference matching", () => {
    it("matches by exact job reference", () => {
      const result = matchJobBySpokenReference("MK-1001", sampleJobs);
      expect(result).toEqual(sampleJobs[0]);
    });

    it("matches job reference without dash", () => {
      const result = matchJobBySpokenReference("MK1001", sampleJobs);
      expect(result).toEqual(sampleJobs[0]);
    });

    it("matches job reference with space instead of dash", () => {
      const result = matchJobBySpokenReference("MK 1001", sampleJobs);
      expect(result).toEqual(sampleJobs[0]);
    });

    it("matches job reference case-insensitively", () => {
      const result = matchJobBySpokenReference("mk-1001", sampleJobs);
      expect(result).toEqual(sampleJobs[0]);
    });

    it("returns null for non-matching job reference", () => {
      const result = matchJobBySpokenReference("MK-9999", sampleJobs);
      expect(result).toBeNull();
    });
  });

  describe("recency matching", () => {
    it("matches 'the last job' to most recent", () => {
      const result = matchJobBySpokenReference("the last job", sampleJobs);
      expect(result).toEqual(sampleJobs[2]); // Jones job is most recent
    });

    it("matches 'most recent' to most recent", () => {
      const result = matchJobBySpokenReference("most recent", sampleJobs);
      expect(result).toEqual(sampleJobs[2]);
    });

    it("matches 'latest job' to most recent", () => {
      const result = matchJobBySpokenReference("latest job", sampleJobs);
      expect(result).toEqual(sampleJobs[2]);
    });

    it("matches 'the one I finished yesterday' to most recent", () => {
      const result = matchJobBySpokenReference(
        "the one I finished yesterday",
        sampleJobs
      );
      expect(result).toEqual(sampleJobs[2]);
    });
  });

  describe("edge cases", () => {
    it("returns null for empty jobs list", () => {
      const result = matchJobBySpokenReference("Henderson", []);
      expect(result).toBeNull();
    });

    it("returns null for empty spoken string", () => {
      const result = matchJobBySpokenReference("", sampleJobs);
      expect(result).toBeNull();
    });

    it("returns null for whitespace-only spoken string", () => {
      const result = matchJobBySpokenReference("   ", sampleJobs);
      expect(result).toBeNull();
    });

    it("handles jobs with similar names", () => {
      const similarJobs: JobSummary[] = [
        {
          id: "job-1",
          customer_name: "John Smith",
          job_reference: "MK-1001",
          updated_at: "2026-08-10T10:00:00Z",
        },
        {
          id: "job-2",
          customer_name: "Jane Smith",
          job_reference: "MK-1002",
          updated_at: "2026-08-11T10:00:00Z",
        },
        {
          id: "job-3",
          customer_name: "Smith Ltd",
          job_reference: "MK-1003",
          updated_at: "2026-08-12T10:00:00Z",
        },
      ];

      const result = matchJobBySpokenReference("smith", similarJobs);
      expect(result).toBe("ambiguous");
    });

    it("matches partial customer name", () => {
      const jobs: JobSummary[] = [
        {
          id: "job-1",
          customer_name: "Henderson & Associates Ltd",
          job_reference: "MK-1001",
          updated_at: "2026-08-10T10:00:00Z",
        },
      ];

      const result = matchJobBySpokenReference("henderson", jobs);
      expect(result).toEqual(jobs[0]);
    });
  });

  describe("ambiguous scenarios", () => {
    it("returns ambiguous for multiple Smith jobs", () => {
      const smithJobs: JobSummary[] = [
        {
          id: "job-1",
          customer_name: "Smith",
          job_reference: "MK-1001",
          updated_at: "2026-08-10T10:00:00Z",
        },
        {
          id: "job-2",
          customer_name: "Smith",
          job_reference: "MK-1002",
          updated_at: "2026-08-11T10:00:00Z",
        },
        {
          id: "job-3",
          customer_name: "Smith",
          job_reference: "MK-1003",
          updated_at: "2026-08-12T10:00:00Z",
        },
      ];

      const result = matchJobBySpokenReference("the Smith job", smithJobs);
      expect(result).toBe("ambiguous");
    });

    it("returns single match when only one job matches substring", () => {
      const jobs: JobSummary[] = [
        {
          id: "job-1",
          customer_name: "Smithson",
          job_reference: "MK-1001",
          updated_at: "2026-08-10T10:00:00Z",
        },
        {
          id: "job-2",
          customer_name: "Jones",
          job_reference: "MK-1002",
          updated_at: "2026-08-11T10:00:00Z",
        },
      ];

      const result = matchJobBySpokenReference("smith", jobs);
      expect(result).toEqual(jobs[0]);
    });
  });
});
