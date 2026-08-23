import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { resolveAppHomeHref } from "@/lib/app-home";
import { SUPPORT_DOCS_URL } from "@/lib/support-docs";

export const metadata: Metadata = {
  title: "Support — Motko",
  description: "Get help with Motko.",
};

export default async function SupportPage() {
  const backHref = await resolveAppHomeHref();

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader backHref={backHref} title="Motko" />
      <main className="flex flex-1 justify-center p-6">
        <article className="w-full max-w-2xl space-y-6 text-sm leading-relaxed text-foreground">
          <div>
            <h1 className="text-2xl font-semibold">Support</h1>
            <p className="mt-1 text-text-secondary">
              We&apos;re here to help you get the most out of Motko.
            </p>
          </div>

          {/* Self-serve first: most of what lands in the inbox is answered by a
              guide, so the help centre sits above the email address rather than
              below it.

              target="_blank" is safe here in a way it is not for an app route.
              The WKWebView hands a blank target to the system browser (see
              tests/acceptance/blank-target-public-routes.test.ts), which is the
              right outcome for a public external site: it needs no session
              cookie, and the contractor keeps their place in the app. */}
          <section className="space-y-2">
            <h2 className="text-lg font-semibold">Help centre</h2>
            <p>
              Step-by-step guides to everything in Motko — setting up your
              business, quoting by voice, contracts, invoices, getting paid, and
              what it costs.
            </p>
            <p>
              <a
                className="text-primary underline"
                href={SUPPORT_DOCS_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                Browse the help centre
              </a>
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">Get in touch</h2>
            <p>
              Email us at{" "}
              <a className="text-primary underline" href="mailto:support@motko.app">
                support@motko.app
              </a>{" "}
              and we&apos;ll get back to you as soon as we can. Include your
              business name and a short description of the problem so we can help
              faster.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">Common questions</h2>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                <strong>Not getting notifications?</strong> Open Settings, tap
                &quot;Enable notifications&quot;, and send yourself a test. Make
                sure notifications are allowed for Motko in your device settings.
              </li>
              <li>
                <strong>A payment isn&apos;t showing as paid?</strong> Payments
                can take a moment to confirm. If it still hasn&apos;t updated
                after a few minutes, email us.
              </li>
              <li>
                <strong>Want to delete your account?</strong> You can do this any
                time from Settings. See our{" "}
                <a className="text-primary underline" href="/privacy">
                  Privacy Policy
                </a>{" "}
                for what happens to your data.
              </li>
            </ul>
          </section>
        </article>
      </main>
    </div>
  );
}
