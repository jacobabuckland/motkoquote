"use client";

import { useRouter } from "next/navigation";
import {
  createRealtimeSession,
  saveSowDelta,
  completeSowConversation,
  createManualJob,
  saveVoiceTranscript,
  reportVoiceAbandoned,
  reportVoicePipelineFailure,
  saveContractorFirstName,
  recordTeamMember,
} from "../actions";
import { JobIntake } from "@/components/voice/job-intake";
import type { JobIntakeAdapter } from "@/components/voice/job-intake-adapter";

// Live speech-to-speech job intake for a signed-in trade. The conversation
// itself lives in <JobIntake/>, shared with the unauthenticated guest intake;
// everything below is the account-specific half — the job row, the persisted
// SoW deltas, the team/first-name writes, and the navigation to the job hub.
export default function NewJobPage() {
  const router = useRouter();

  const adapter: JobIntakeAdapter = {
    mode: "account",
    // Signed-in screen: "/" only ever reached the dashboard via the root
    // route's redirect, so name the destination directly.
    backHref: "/dashboard",
    backLabel: "Cancel",
    failureBody:
      "Your job and everything you said are saved. Try pricing it again, or come back to it later.",

    startSession: async () => {
      const { jobId, clientSecret } = await createRealtimeSession();
      return { sessionKey: jobId, clientSecret };
    },

    persistDelta: async ({ sessionKey, delta }) => {
      const { sowState } = await saveSowDelta({ jobId: sessionKey!, delta });
      return sowState;
    },

    complete: async ({
      sessionKey,
      transcript,
      conversationTurns,
      wrapReason,
      questionsAsked,
      requiredSlotsAsked,
      unaskedRequired,
    }) => {
      const jobId = sessionKey!;
      await completeSowConversation({
        jobId,
        transcript,
        conversationTurns,
        wrapReason,
        questionsAsked,
        requiredSlotsAsked,
        unaskedRequired,
      });
      router.push(`/jobs/${jobId}`);
    },

    recordFirstName: (firstName) => {
      void saveContractorFirstName({ firstName }).catch(() => {});
    },

    recordPerson: (person) => {
      void recordTeamMember(person).catch(() => {});
    },

    saveForLater: async ({ sessionKey, transcript, conversationTurns }) => {
      if (sessionKey) {
        await saveVoiceTranscript({ jobId: sessionKey, transcript, conversationTurns });
      }
      router.push("/dashboard");
    },

    reportFailure: ({ sessionKey, stage, message }) => {
      if (!sessionKey) return;
      void reportVoicePipelineFailure({ jobId: sessionKey, stage, message }).catch(() => {});
    },

    reportAbandoned: ({ sessionKey, reason }) => {
      if (!sessionKey) return;
      void reportVoiceAbandoned({ jobId: sessionKey, reason }).catch(() => {});
    },

    startManual: async () => {
      const { jobId } = await createManualJob();
      router.push(`/jobs/${jobId}`);
    },
  };

  return <JobIntake adapter={adapter} />;
}
