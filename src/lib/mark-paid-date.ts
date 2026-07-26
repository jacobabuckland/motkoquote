// Pure validation for the backdated date a trade may pick when marking an
// invoice paid off-rails. Kept out of the "use server" action file so it's
// directly unit-testable (a server-action module may only export async actions).

// How far back a trade may backdate an off-rails payment. Generous but bounded —
// money paid over three months ago shouldn't be settled through the quick action.
export const MAX_BACKDATE_DAYS = 90;

// Resolve a picked yyyy-mm-dd date to a settlement timestamp, rejecting the
// future and anything older than the window. Returns null on an invalid choice;
// an omitted date means "now".
export const resolveManualPaidAt = (
  paidOn: string | undefined,
  now: number,
  maxBackdateDays = MAX_BACKDATE_DAYS,
): string | null => {
  if (!paidOn) return new Date(now).toISOString();
  const picked = new Date(`${paidOn}T12:00:00.000Z`).getTime();
  if (Number.isNaN(picked)) return null;
  if (picked > now) return null;
  if (now - picked > maxBackdateDays * 86_400_000) return null;
  return new Date(picked).toISOString();
};
