import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "./actions";

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
    <main className="flex flex-1 flex-col items-center justify-center p-6 gap-4">
      <h1 className="text-2xl font-semibold">{contractor.company_name}</h1>
      <p className="text-sm text-neutral-500">Signed in as {user.email}</p>
      <Link href="/setup" className="underline text-sm">
        Edit business settings
      </Link>
      <form action={signOut}>
        <button type="submit" className="underline text-sm">
          Sign out
        </button>
      </form>
    </main>
  );
}
