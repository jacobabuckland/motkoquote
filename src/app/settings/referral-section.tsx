import { Card } from "@/components/ui/card";
import { CopyLinkButton } from "@/components/ui/copy-link-button";

type Props = {
  referralCode: string | null;
  appUrl: string;
};

// Shows the trade their own shareable code + link. The code is the source of
// truth; the link (which pre-fills ?ref= on the signup page) is just a carrier.
// The referrer's +5 unlocks when the referred trade lands their first paid job.
export const ReferralSection = ({ referralCode, appUrl }: Props) => {
  const shareLink = referralCode ? `${appUrl}/signup?ref=${referralCode}` : null;

  return (
    <section>
      <h2 className="mb-1 text-lg font-semibold">Refer a trade</h2>
      <p className="mb-3 text-sm text-text-secondary">
        Share your code with another trade. When they land their first paid job,
        you get 5 more fee-free jobs.
      </p>
      <Card className="space-y-4">
        {referralCode && shareLink ? (
          <>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-medium text-text-secondary">Your code</p>
                <p className="font-mono text-lg font-semibold tracking-wider">
                  {referralCode}
                </p>
              </div>
              <CopyLinkButton url={referralCode} label="Copy code" />
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
              <p className="truncate text-sm text-text-secondary">{shareLink}</p>
              <CopyLinkButton url={shareLink} label="Copy link" />
            </div>
          </>
        ) : (
          <p className="text-sm text-text-secondary">
            Your referral code will appear here once your business setup is
            complete.
          </p>
        )}
      </Card>
    </section>
  );
};
