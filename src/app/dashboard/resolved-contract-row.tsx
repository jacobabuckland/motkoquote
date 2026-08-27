"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SwipeToReveal } from "@/components/ui/swipe-to-reveal";
import { InlineLink } from "@/components/ui/inline-link";
import { StatusChip } from "@/components/ui/status-chip";
import { useToast } from "@/components/ui/toast";
import { statusDateLabel } from "@/lib/contract-status-date";
import { archiveContract, restoreContract } from "./contract-archive-actions";
import * as haptics from "@/lib/haptics";

// A resolved contract on the dashboard, or in the archive.
//
// Two things distinguish it from the plain row it replaces: it carries the date
// it was signed or declined, because a repeat customer otherwise produces
// several identical rows and the only way to tell them apart is to open each
// one; and it can be pulled aside to be archived, because the list is
// append-only and gets worse the longer the product is used.
//
// THE SWIPE ARCHIVES, IT NEVER DELETES. This is the one place the gesture's
// meaning differs from the draft rows in My work, and the difference is not
// cosmetic: a signed contract is a legal artefact. Hence the neutral action
// colour rather than `bg-red`, and hence no confirm — there is nothing to
// confirm, because nothing is destroyed and the toast can put it straight back.

type Props = {
  contractId: string;
  customerName: string;
  status: string;
  statusDate: string | null;
  jobId?: string;
  /** Archived rows restore instead of archiving. Same row, opposite direction. */
  archived?: boolean;
};

export const ResolvedContractRow = ({
  contractId,
  customerName,
  status,
  statusDate,
  jobId,
  archived = false,
}: Props) => {
  const router = useRouter();
  const toast = useToast();
  const [isPending, startTransition] = useTransition();
  // The row leaves the screen before the server has answered, and comes back if
  // the answer is no. Local rather than a router.refresh() round trip, because
  // a list that waits on the network to acknowledge a swipe feels broken.
  const [hidden, setHidden] = useState(false);

  const onArchive = () => {
    setHidden(true);
    startTransition(async () => {
      try {
        await archiveContract(contractId);
        haptics.success();
        toast("Contract archived", {
          durationMs: 5000,
          action: {
            label: "Undo",
            onClick: () => {
              // Optimistic in the same way the archive was: the row returns at
              // once and only goes again if the restore itself fails.
              setHidden(false);
              startTransition(async () => {
                try {
                  await restoreContract(contractId);
                  router.refresh();
                } catch {
                  setHidden(true);
                  haptics.error();
                  toast("Couldn't undo — the contract is still archived.");
                }
              });
            },
          },
        });
        router.refresh();
      } catch {
        // Never leave the list hiding a row that was not archived.
        setHidden(false);
        haptics.error();
        toast("Couldn't archive that contract. It's still here.");
      }
    });
  };

  const onRestore = () => {
    setHidden(true);
    startTransition(async () => {
      try {
        await restoreContract(contractId);
        haptics.success();
        toast("Contract restored");
        router.refresh();
      } catch {
        setHidden(false);
        haptics.error();
        toast("Couldn't restore that contract.");
      }
    });
  };

  if (hidden) return null;

  const dateLine = statusDateLabel(status, statusDate);

  return (
    <SwipeToReveal
      onOpen={haptics.select}
      action={
        <button
          type="button"
          disabled={isPending}
          onClick={archived ? onRestore : onArchive}
          aria-label={`${archived ? "Restore" : "Archive"} the contract for ${customerName}`}
          // Neutral, NOT bg-red. The gesture is borrowed from delete; the
          // consequence is not, and the colour is what says so before the tap.
          className="flex w-full items-center justify-center bg-line-strong px-3 text-sm font-semibold text-ink transition-opacity duration-150 disabled:opacity-60"
        >
          {archived ? "Restore" : "Archive"}
        </button>
      }
    >
      <div className="flex items-center justify-between gap-3 border-b border-line bg-card px-4 py-3 last:border-b-0">
        <div className="flex min-w-0 flex-col">
          {jobId ? (
            <Link
              href={`/jobs/${jobId}`}
              className="truncate text-sm font-semibold text-ink underline underline-offset-4 decoration-line-strong"
            >
              {customerName}
            </Link>
          ) : (
            <span className="truncate text-sm font-semibold">{customerName}</span>
          )}
          {dateLine && (
            <span className="truncate text-xs text-text-secondary">{dateLine}</span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <StatusChip status={status === "signed" ? "Signed" : "Declined"} />
          <InlineLink href={`/c/${contractId}`}>View contract</InlineLink>
        </div>
      </div>
    </SwipeToReveal>
  );
};
