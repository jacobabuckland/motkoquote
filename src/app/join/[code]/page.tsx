"use client";

import { useEffect } from "react";
import Link from "next/link";
import { captureReferralCode } from "@/lib/referral-capture";
import { Button } from "@/components/ui/button";

interface JoinPageProps {
  params: { code: string };
}

export default function JoinPage(_props: JoinPageProps) {
  // Capture the referral code on mount so it's held for signup later
  useEffect(() => {
    captureReferralCode(window.location.href);
  }, []);

  return (
    <div
      className="fixed inset-0 flex flex-col items-center justify-center px-4"
      style={{ backgroundColor: "var(--green)" }}
    >
      {/* Wordmark */}
      <div className="mb-8 text-5xl font-bold tracking-tight text-white">
        motko
      </div>

      {/* Welcome message acknowledging the referral */}
      <div className="max-w-md text-center mb-8">
        <h1 className="text-2xl font-semibold text-white mb-4">
          You&apos;ve been invited
        </h1>
        <p className="text-white opacity-90 mb-2">
          Someone you know thought you might find this useful.
        </p>
        <p className="text-white opacity-90 text-sm">
          When you sign up with their referral code, they&apos;ll earn credit toward their subscription.
        </p>
      </div>

      {/* Proceed to signup */}
      <Link href="/signup">
        <Button className="bg-white text-green-700 hover:bg-gray-100">
          Get started
        </Button>
      </Link>

      {/* Footer link for existing users */}
      <div className="mt-8">
        <Link
          href="/login"
          className="text-sm text-white opacity-75 hover:opacity-100 underline"
        >
          Already have an account? Sign in
        </Link>
      </div>
    </div>
  );
}
