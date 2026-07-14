import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = {
  title: "Privacy Policy — Motko",
  description: "How Motko collects, uses, and protects your data.",
};

export default function PrivacyPage() {
  return (
    <div className="flex flex-1 flex-col">
      <PageHeader backHref="/" title="Motko" />
      <main className="flex flex-1 justify-center p-6">
        <article className="w-full max-w-2xl space-y-6 text-sm leading-relaxed text-foreground">
          <div>
            <h1 className="text-2xl font-semibold">Privacy Policy</h1>
            <p className="mt-1 text-text-secondary">Last updated 14 July 2026</p>
          </div>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">Who we are</h2>
            <p>
              Motko provides back-office tools for UK contractors — quoting,
              contracts, invoicing, and payment chasing. This policy explains
              what data we hold and why.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">What we collect</h2>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                <strong>Account data</strong> — your name, email, business
                details, and settings.
              </li>
              <li>
                <strong>Job data</strong> — quotes, contracts, invoices, and the
                customer details you enter to produce them.
              </li>
              <li>
                <strong>Voice notes</strong> — audio you record to draft a quote,
                and the transcript produced from it.
              </li>
              <li>
                <strong>Device data</strong> — push notification tokens for the
                devices you choose to enable notifications on.
              </li>
            </ul>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">How we use it</h2>
            <p>
              We use your data to run the service you signed up for: generating
              quotes and contracts, sending invoices, chasing payments, and
              notifying you when a customer acts. We do not sell your data.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">Processors we use</h2>
            <p>
              We share data only with the providers needed to run Motko: Supabase
              (database and authentication), Stripe (payments), OpenAI and
              Anthropic (voice transcription and drafting), Resend (email), and
              Apple/browser push services (notifications). Each processes data on
              our behalf under their own terms.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">Notifications</h2>
            <p>
              If you enable notifications we store a push token for that device
              so we can alert you to customer activity. You can turn notifications
              off at any time in Settings, which removes the token.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">Retention and deletion</h2>
            <p>
              You can delete your account from Settings. We soft-delete
              immediately and permanently remove your personal data after a
              30-day grace period, during which you can cancel by signing back
              in. Issued invoices and contracts are retained in anonymised form
              to meet legal and tax record-keeping requirements. Payment records
              held by Stripe are subject to Stripe&apos;s own retention.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">Your rights</h2>
            <p>
              You can access, correct, or delete your data, and object to certain
              processing. To exercise any right, contact us at{" "}
              <a className="text-primary underline" href="mailto:support@motko.app">
                support@motko.app
              </a>
              .
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">Contact</h2>
            <p>
              Questions about this policy? Email{" "}
              <a className="text-primary underline" href="mailto:support@motko.app">
                support@motko.app
              </a>
              .
            </p>
          </section>
        </article>
      </main>
    </div>
  );
}
