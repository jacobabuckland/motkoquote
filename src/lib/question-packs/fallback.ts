import { matchJobTypeToPack } from "@/lib/question-packs/match";

// True when the classified job_type has no covering question pack — the
// interview fell back to the generic, pack-less flow instead of a
// tailored slot list. Callers log this onto SowState.used_generic_fallback
// so it's queryable after the fact (which job types show up most, to
// prioritize the next pack to author) rather than only visible in the
// moment the call happens.
export const usedGenericFallback = (jobType: string): boolean =>
  matchJobTypeToPack(jobType) === undefined;
