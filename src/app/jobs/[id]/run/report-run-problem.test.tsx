/**
 * @vitest-environment happy-dom
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { reportRunProblem } = vi.hoisted(() => ({
  reportRunProblem: vi.fn(async (_input?: unknown) => undefined),
}));

vi.mock("@/app/actions", () => ({ reportRunProblem }));
vi.mock("next/navigation", () => ({ usePathname: () => "/jobs/job-1/run" }));
vi.mock("@/lib/client-log", () => ({ recentClientLog: () => ["[error] boom"] }));

import { ReportRunProblem } from "./report-run-problem";

afterEach(() => {
  cleanup();
  reportRunProblem.mockClear();
  reportRunProblem.mockResolvedValue(undefined);
});

const type = (value: string) => {
  fireEvent.change(screen.getByLabelText("What went wrong"), { target: { value } });
};

describe("ReportRunProblem", () => {
  it("sends the run, the route and the buffered log with the note", async () => {
    render(<ReportRunProblem runId="job-1" />);

    type("said five thousand, quote says five pounds");
    fireEvent.click(screen.getByRole("button", { name: "Send report" }));

    await waitFor(() => expect(reportRunProblem).toHaveBeenCalledTimes(1));
    expect(reportRunProblem).toHaveBeenCalledWith({
      run_id: "job-1",
      route: "/jobs/job-1/run",
      note: "said five thousand, quote says five pounds",
      client_log: ["[error] boom"],
    });
  });

  it("settles on its terminal label rather than resting on the spinner", async () => {
    render(<ReportRunProblem runId="job-1" />);

    type("something");
    fireEvent.click(screen.getByRole("button", { name: "Send report" }));

    await waitFor(() => screen.getByRole("button", { name: "Sent ✓" }));
  });

  it("cannot be sent empty", () => {
    render(<ReportRunProblem runId="job-1" />);

    const button = screen.getByRole("button", { name: "Send report" });
    fireEvent.click(button);

    expect(reportRunProblem).not.toHaveBeenCalled();
    expect(button.hasAttribute("disabled")).toBe(true);
  });

  it("still settles when the report fails to send, so a broken report never breaks the page", async () => {
    reportRunProblem.mockRejectedValueOnce(new Error("offline"));
    render(<ReportRunProblem runId="job-1" />);

    type("something");
    fireEvent.click(screen.getByRole("button", { name: "Send report" }));

    await waitFor(() => screen.getByRole("button", { name: "Sent ✓" }));
  });
});
