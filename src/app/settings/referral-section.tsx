import { Card } from "@/components/ui/card";
import { CopyLinkButton } from "@/components/ui/copy-link-button";
import { ShareLinkButton } from "@/components/ui/share-link-button";

type Props = {
  referralCode: string | null;
  appUrl: string;
};

// Shows the trade their own shareable code + link. The code is the source of
// truth; the link (which pre-fills ?ref= on the signup page) is just a carrier.
// The referrer's +3, rising to 5, unlocks when the referred trade lands their first paid job.
export const ReferralSection = ({ referralCode, appUrl }: Props) => {
  const shareLink = referralCode ? `${appUrl}/signup?ref=${referralCode}` : null;

  return (
    <section>
      <h2 className="mb-1 text-lg font-semibold">Refer a trade</h2>
      <p className="mb-3 text-sm text-text-secondary">
        Share your code with another trade. You get 3 free jobs when they land
        their first paid job (rising to 5 at 5 activated referrals).
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
              <CopyLinkButton url={referralCode} label="Copy code" copiedMessage="Code copied." />
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
              <p className="truncate text-sm text-text-secondary">{shareLink}</p>
              {/* Share sheet first, copy beside it. Two frozen contracts meet on
                  this row and BOTH have to be satisfied: tests/acceptance/351
                  requires "Copy link", tests/acceptance/356 requires "Share
                  link". Neither asserts the other is absent, so both render.

                  It also happens to be the better shape. On a phone the share
                  sheet is the point — the whole job is getting this link to
                  another human, and the clipboard leaves that job half done.
                  Copy stays for anyone pasting it somewhere specific, and it is
                  the only thing that works on a desktop browser, where
                  ShareLinkButton falls back to the clipboard anyway. */}
              <div className="flex shrink-0 items-center gap-3">
                <ShareLinkButton url={shareLink} title="Join Motko" label="Share link" />
                <CopyLinkButton url={shareLink} label="Copy link" />
              </div>
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
