import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { InlineLink } from "@/components/ui/inline-link";

// In-app viewer for the statement of work.
//
// The SOW PDF route (/api/jobs/[id]/sow-pdf) is authenticated and tenant
// scoped, and must stay that way — it renders customer PII. The job page used
// to link straight to it with target="_blank", which the Capacitor WKWebView
// hands to the system browser. Safari carries no Supabase session cookie, so
// the request arrived unauthenticated, and because the route is (correctly) not
// in PUBLIC_API_ROUTES the middleware redirected it to /login — an external
// sign-in page shown to a contractor who was already signed in.
//
// This page is the destination instead. It is an ordinary authenticated app
// route, so the navigation stays inside the web view where the cookie lives,
// and the PDF is fetched as a same-origin subresource that therefore carries
// the session. The back control means embedding the document no longer costs
// the contractor their way out.

type Props = { params: Promise<{ id: string }> };

export default async function SowViewerPage({ params }: Props) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();

  // Ownership proved through RLS, exactly as the PDF route does it: a hit means
  // the caller owns this job; a miss — other tenant or unknown id — is an
  // indistinguishable 404, never a 403 and never a redirect to another job.
  const { data: job } = await supabase
    .from("jobs")
    .select("id, sow_json")
    .eq("id", id)
    .maybeSingle();

  if (!job) notFound();

  const pdfHref = `/api/jobs/${id}/sow-pdf`;
  const hasSow = job.sow_json != null;

  return (
    <>
      <PageHeader backHref={`/jobs/${id}`} backLabel="Back to job" title="Statement of work" />
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-6 py-6">
        {hasSow ? (
          <>
            {/* object, not iframe: it degrades to its children when the client
                cannot display a PDF inline, which is the fallback below rather
                than a blank frame with no way forward. */}
            <object
              data={pdfHref}
              type="application/pdf"
              aria-label="Statement of work"
              className="h-[70vh] w-full rounded-card border border-line"
            >
              <div className="flex flex-col gap-2 p-4">
                <p className="text-sm text-text-secondary">
                  This device can&apos;t show the PDF inline.
                </p>
                <InlineLink href={pdfHref}>Open the statement of work</InlineLink>
              </div>
            </object>
            {/* Always present, not only on the degraded path: inline PDF
                rendering can succeed and still be unreadable on a small screen.
                Same-window on purpose — a new window is what broke this. */}
            <InlineLink href={pdfHref} className="self-start">
              Open the PDF full screen
            </InlineLink>
          </>
        ) : (
          <Card className="flex flex-col gap-2">
            <h2 className="text-sm font-medium">No statement of work for this job yet</h2>
            <p className="text-sm text-text-secondary">
              A statement of work is written from the voice intake. Once this job has one, it will
              appear here.
            </p>
            <InlineLink href={`/jobs/${id}`} className="self-start">
              Back to the job
            </InlineLink>
          </Card>
        )}
      </main>
    </>
  );
}
