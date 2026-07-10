import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "./actions";
import { AppHeader } from "@/components/ui/app-header";
import { buttonClass } from "@/components/ui/button";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: contractor } = await supabase
    .from("contractors")
    .select("id, company_name")
    .eq("owner_user_id", user.id)
    .maybeSingle();

  if (!contractor) {
    redirect("/setup");
  }

  return (
    <div className="flex flex-1 flex-col">
      <AppHeader companyName={contractor.company_name} onSignOut={signOut} />
      <main className="flex flex-1 flex-col items-center justify-center gap-6 p-6">
        <div className="flex flex-col items-center gap-1 text-center">
          <h1 className="text-2xl font-semibold">{contractor.company_name}</h1>
          <p className="text-sm text-text-secondary">Signed in as {user.email}</p>
        </div>
        <Link href="/jobs/new" className={buttonClass("primary", "px-8")}>
          New voice note
        </Link>
      </main>
    </div>
  );
}
