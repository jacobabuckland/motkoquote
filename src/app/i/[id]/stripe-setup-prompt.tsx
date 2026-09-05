import Link from "next/link";
import { Button } from "@/components/ui/button";

type Props = {
  onboardingUrl: string;
};

/**
 * Banner prompting contractor to complete Stripe setup, shown on their own
 * pending invoice when canAcceptStripePayment returns false.
 */
export const StripeSetupPrompt = ({ onboardingUrl }: Props) => {
  return (
    <div className="rounded-card border border-line-strong bg-amber-tint p-4">
      <p className="mb-3 text-sm font-medium text-ink">
        Complete your Stripe setup to accept payments
      </p>
      <p className="mb-4 text-sm text-ink-secondary">
        Customers can&apos;t pay this invoice yet because your payment account
        isn&apos;t fully set up. Complete the onboarding to start receiving
        payments.
      </p>
      <Link href={onboardingUrl}>
        <Button type="button" variant="primary">
          Complete setup
        </Button>
      </Link>
    </div>
  );
};
