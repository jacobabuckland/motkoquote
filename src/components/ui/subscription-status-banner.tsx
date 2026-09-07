"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";

// App-wide subscription status banner. Non-blocking: it never covers content
// or traps the user — it just surfaces the read-only state when subscription
// payment has failed, explaining why creation actions are blocked.
//
// The banner appears when subscription_status is 'past_due' or 'unpaid' and
// disappears immediately when payment is restored (status returns to 'active'
// or 'trialing').
export const SubscriptionStatusBanner = () => {
  const [readOnly, setReadOnly] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    const checkSubscriptionStatus = async () => {
      try {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
          if (mounted) setLoading(false);
          return;
        }

        const { data: contractor } = await supabase
          .from("contractors")
          .select("id")
          .eq("owner_user_id", user.id)
          .maybeSingle();

        if (!contractor) {
          if (mounted) setLoading(false);
          return;
        }

        const { data: projection } = await supabase
          .from("subscription_projection")
          .select("subscription_status")
          .eq("contractor_id", contractor.id)
          .maybeSingle();

        if (mounted) {
          const status = projection?.subscription_status;
          setReadOnly(status === "past_due" || status === "unpaid");
          setLoading(false);
        }
      } catch (error) {
        console.error("Failed to check subscription status:", error);
        if (mounted) setLoading(false);
      }
    };

    checkSubscriptionStatus();

    // Poll subscription status periodically to detect when payment is restored
    const interval = setInterval(checkSubscriptionStatus, 30000);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  if (loading || !readOnly) return null;

  return (
    <div
      role="alert"
      // z-[60], above the toast layer's z-50, matching OfflineBanner's z-index
      className="sticky top-0 z-[60] bg-warning-bg px-4 py-2 text-center text-sm font-medium text-warning"
      style={{ paddingTop: "max(0.5rem, env(safe-area-inset-top))" }}
    >
      Your payment failed.{" "}
      <Link href="/settings" className="underline">
        Update your payment method
      </Link>{" "}
      to continue creating jobs, quotes, contracts, and invoices.
    </div>
  );
};
