"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { JobIntake } from "@/components/voice/job-intake";
import type { JobIntakeAdapter } from "@/components/voice/job-intake-adapter";
import { AccountPrompt } from "@/components/guest/account-prompt";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { mergeSowToolDelta, EMPTY_SOW_STATE } from "@/lib/schemas/sow";
import { generateGuestReference } from "@/lib/guest/quote";
import {
  clearGuestArtefact,
  hasGuestArtefact,
  readGuestArtefact,
  startGuestArtefact,
  updateGuestArtefact,
} from "@/lib/guest/session";
import { draftGuestQuoteAction } from "./actions";

// The first screen. Cold launch lands here with no session and no account —
// voice capture is one tap away and nothing was asked of the visitor, so there
// is no "continue without an account" to opt into. Sign In sits in the top bar
// for a returning trade (and for a reviewer with credentials).
export default function GuestStartPage() {
  const router = useRouter();
  // Guards the "you already have a quote in progress" warning: only ONE guest
  // artefact is ever retained, so starting a second job discards the first and
  // the guest is told before that happens.
  const [pendingDiscard, setPendingDiscard] = useState<boolean | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPendingDiscard(hasGuestArtefact());
  }, []);

  const adapter: JobIntakeAdapter = {
    mode: "guest",
    backLabel: "Back",
    failureBody:
      "Nothing's lost — what you said is still on this device. Try pricing it again.",
    headerAction: (
      <Link
        href="/login"
        className="inline-flex min-h-11 items-center text-sm font-medium text-accent underline underline-offset-4"
      >
        Sign in
      </Link>
    ),

    startSession: async () => {
      const response = await fetch("/api/guest/realtime-session", { method: "POST" });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Couldn't start the voice session. Try again in a moment.");
      }
      const { clientSecret } = (await response.json()) as { clientSecret: string };

      // The artefact is created here, once the call is actually starting, so a
      // guest who opens the screen and leaves doesn't leave a stub behind.
      startGuestArtefact(generateGuestReference());

      // No session key: a guest quote is a rendered artefact, not a job
      // aggregate, so there is no id to carry and nothing to reference.
      return { sessionKey: null, clientSecret };
    },

    // The same deterministic merge the account path runs server-side, run here
    // instead. Nothing is written anywhere; the merged state is mirrored onto
    // the local artefact so a backgrounded app comes back to it.
    persistDelta: async ({ current, delta }) => {
      const merged = mergeSowToolDelta(current, delta);
      updateGuestArtefact({ sow: merged });
      return merged;
    },

    complete: async ({ sow, transcript }) => {
      const artefact = readGuestArtefact() ?? startGuestArtefact(generateGuestReference());
      updateGuestArtefact({
        sow: sow ?? EMPTY_SOW_STATE,
        transcript: transcript ? transcript.split("\n") : [],
      });

      const quote = await draftGuestQuoteAction({
        sow: sow ?? EMPTY_SOW_STATE,
        reference: artefact.reference,
        createdAt: artefact.createdAt,
      });

      updateGuestArtefact({ quote });
      router.push("/start/quote");
    },

    // Saving, and the typed-quote draft that needs somewhere to be saved, are
    // account-based. Both are omitted rather than stubbed, and the prompt below
    // takes their place at the point of use.
    manualUnavailable: (
      <AccountPrompt
        action="Typing a quote in"
        detail="Motko keeps a typed draft against your business, so this one needs an account. Talking a job through doesn't."
      />
    ),
  };

  // Rehydration hasn't run yet — render nothing rather than flashing the
  // warning at someone who has no artefact.
  if (pendingDiscard === null) return null;

  if (pendingDiscard) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-6 p-6">
        <Card className="flex w-full max-w-sm flex-col gap-3">
          <h1 className="text-base font-semibold">You have a quote in progress</h1>
          <p className="text-sm text-text-secondary">
            Only the most recent quote is kept on this device. Starting a new job
            replaces it.
          </p>
          <div className="flex flex-col gap-2">
            <Button type="button" onClick={() => router.push("/start/quote")}>
              Back to my quote
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                clearGuestArtefact();
                setPendingDiscard(false);
              }}
            >
              Start a new job (replaces it)
            </Button>
          </div>
        </Card>
      </main>
    );
  }

  return <JobIntake adapter={adapter} />;
}
