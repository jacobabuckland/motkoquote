"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { reportRunProblem } from "@/app/actions";
import { recentClientLog } from "@/lib/client-log";

// "Something's wrong here" — attached to the run it was filed against.
//
// The reporting loop before this was: a tester notices something, tells Jacob
// in a message, and Jacob works out which job they meant. The run id is the
// only part of that a person should never have to supply, and it is the part
// they were supplying.
//
// Nothing here can break the page it sits on. The submit is fire-and-forget
// against a server action that itself swallows every failure (track never
// throws), the control settles on its terminal state before anything else
// happens, and there is no navigation: the reporter stays on the run they are
// looking at, which is the whole point of reporting from here.
export const ReportRunProblem = ({ runId }: { runId: string }) => {
  const pathname = usePathname();
  const [note, setNote] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  // Snapshotted at first render rather than read at submit time: by the time
  // someone has typed a description of what went wrong, the lines that explain
  // it may have been pushed out of a 25-line ring by whatever the page did
  // since. A lazy initialiser rather than an effect — the value is never
  // rendered, so the empty array the server produces cannot mismatch anything.
  const [log] = useState<string[]>(() => recentClientLog());

  const submit = async () => {
    if (state !== "idle" || note.trim().length === 0) return;
    setState("sending");
    try {
      await reportRunProblem({
        run_id: runId,
        route: pathname,
        note: note.trim(),
        client_log: log,
      });
    } catch {
      // Deliberately swallowed. A report that fails to send is not worth
      // showing this person an error about — they already came here to tell us
      // something was broken, and a second failure message is noise. The
      // failure is loud in the server logs (analytics.ts counts them).
    }
    setState("sent");
  };

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-sm font-semibold">Something wrong with this quote?</h2>
        <p className="text-xs text-text-secondary">
          Tell us what you expected. It gets sent with this run attached, so nobody has to ask you
          which job you meant.
        </p>
      </div>
      <Textarea
        label="What went wrong"
        value={note}
        onChange={(event) => setNote(event.target.value)}
        maxLength={2000}
        placeholder="e.g. I said five thousand for the whole job and the quote says five pounds"
        disabled={state === "sent"}
      />
      <Button
        type="button"
        onClick={submit}
        disabled={state !== "idle" || note.trim().length === 0}
        className="self-start"
      >
        {state === "sent" ? "Sent ✓" : state === "sending" ? "Sending…" : "Send report"}
      </Button>
    </Card>
  );
};
