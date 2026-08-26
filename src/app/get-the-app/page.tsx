"use client";

import Link from "next/link";
import { buttonClass } from "@/components/ui/button";

export default function GetTheAppPage() {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold mb-1">Get the Motko app</h1>
        <p className="text-sm text-text-secondary mb-6">
          The Motko app gives you everything you need to run your trade business
          — quotes, contracts, invoicing, and payments — all from your phone.
        </p>

        <div className="flex flex-col gap-3">
          <a href="https://motko.co.uk" className={buttonClass("primary")}>
            Download on the App Store
          </a>

          <Link href="/setup" className={buttonClass("secondary")}>
            Continue to setup
          </Link>
        </div>
      </div>
    </main>
  );
}
