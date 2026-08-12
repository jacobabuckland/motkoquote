/* eslint-disable react/no-unescaped-entities */
"use client";

import { formatGBP } from "@/lib/format";
import { getGreeting } from "@/lib/greeting";
import { CountUp } from "./count-up";

interface DashboardHeroProps {
  outstandingTotal: number;
}

export function DashboardHero({ outstandingTotal }: DashboardHeroProps) {
  if (outstandingTotal === 0) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-lg">You're all square</p>
      </div>
    );
  }

  const currentHour = new Date().getHours();
  const greeting = getGreeting(currentHour);

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-secondary-text">
        {greeting} — you're owed
      </p>
      <div className="text-4xl font-semibold tabular-nums">
        <CountUp
          target={outstandingTotal}
          duration={600}
          format={(n) => formatGBP(n)}
        />
      </div>
    </div>
  );
}
