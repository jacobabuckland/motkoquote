import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "../actions";
import { AppHeader } from "@/components/ui/app-header";
import { Card } from "@/components/ui/card";
import { buttonClass } from "@/components/ui/button";

// "Speak to Motko" hub: the single entry point that triages what the
// contractor wants to do next — quote a fresh job, or bring Motko up to
// date on the business (new rates, a new team member, changed details) so
// future quotes stay accurate.
export default async function SpeakToMotkoPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: contractor } = await supabase
    .from("contractors")
    .select("company_name")
    .eq("owner_user_id", user.id)
    .maybeSingle();

  if (!contractor) {
    redirect(user.user_metadata?.setup_incomplete ? "/setup/voice" : "/setup");
  }

  return (
    <div className="flex flex-1 flex-col">
      <AppHeader companyName={contractor.company_name} onSignOut={signOut} />
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 p-6">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold">Speak to Motko</h1>
          <p className="text-sm text-secondary-text">
            What do you need? Talk it through and Motko takes it from there.
          </p>
        </div>

        <div className="flex flex-col gap-4">
          <Card className="flex flex-col items-start gap-3">
            <h2 className="text-lg font-semibold">Quote a job</h2>
            <p className="text-sm text-secondary-text">
              Talk through the work and Motko turns it into a priced quote you
              can send in minutes.
            </p>
            <Link href="/jobs/new" className={buttonClass("primary")}>
              New quote
            </Link>
          </Card>

          <Card className="flex flex-col items-start gap-3">
            <h2 className="text-lg font-semibold">Update your business</h2>
            <p className="text-sm text-secondary-text">
              Changed your rates, taken on a new team member, or updated your
              details? Keep Motko current so every quote stays accurate.
            </p>
            <Link href="/setup" className={buttonClass("secondary")}>
              Business details
            </Link>
          </Card>
        </div>
      </main>
    </div>
  );
}
