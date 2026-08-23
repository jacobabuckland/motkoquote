import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { InlineLink } from "@/components/ui/inline-link";
import { SUPPORT_INBOX } from "@/lib/email";
import { SupportForm } from "./support-form";

// Deliberately NOT at /support. That route is the public, unauthenticated
// support page the App Store submission points at, and middleware treats
// everything under /support as public — so an authenticated capture form
// cannot live there without either breaking that page or exposing an
// email-sending endpoint to anyone who finds the URL.
//
// This is the in-app one: signed in, so it already knows who is asking.
export default async function InAppSupportPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader backHref="/settings" title="Support" />
      <main className="flex flex-1 justify-center p-6">
        <div className="w-full max-w-xl">
          <h1 className="mb-2 text-2xl font-semibold">Get in touch</h1>
          <p className="mb-6 text-sm text-text-secondary">
            Send us a message and we&apos;ll reply by email. You don&apos;t need to say who
            you are — your account details come through with it. If you&apos;d rather write
            directly, we&apos;re at{" "}
            <InlineLink href={`mailto:${SUPPORT_INBOX}`}>{SUPPORT_INBOX}</InlineLink>.
          </p>
          <SupportForm replyToEmail={user.email ?? ""} />
        </div>
      </main>
    </div>
  );
}
