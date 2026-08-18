"use client";

import Link from "next/link";
import { Card } from "@/components/ui/card";
import { buttonClass } from "@/components/ui/button";

type Props = {
  // What the guest just tried to do, as a noun phrase: "Saving this quote",
  // "Sending to a customer". Stated plainly so the prompt explains itself.
  action: string;
  detail?: string;
};

// Shown in place, at the point of use, when a guest reaches something that
// genuinely needs an account. It is a prompt, never a wall: it appears inline
// beneath or beside whatever they were doing and navigates nowhere on its own,
// so the in-progress job and any generated quote stay exactly where they were.
export const AccountPrompt = ({ action, detail }: Props) => (
  <Card className="flex w-full flex-col gap-3">
    <div className="flex flex-col gap-1">
      <h2 className="text-sm font-semibold">{action} needs an account</h2>
      <p className="text-sm text-text-secondary">
        {detail ??
          "Quoting by voice is free and doesn't need one — this bit does, because it's tied to your business."}
      </p>
    </div>
    <div className="flex flex-wrap gap-3">
      <Link href="/signup" className={buttonClass("primary")}>
        Create an account
      </Link>
      <Link href="/login" className={buttonClass("secondary")}>
        Sign in
      </Link>
    </div>
    <p className="text-xs text-text-muted">
      Your quote stays on this device. Creating an account starts a fresh job.
    </p>
  </Card>
);
