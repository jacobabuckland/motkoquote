import { createClient } from "@/lib/supabase/server";
import { signOut } from "./actions";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="flex flex-1 flex-col items-center justify-center p-6 gap-4">
      <h1 className="text-2xl font-semibold">TradeQuote</h1>
      <p className="text-sm text-neutral-500">Signed in as {user?.email}</p>
      <form action={signOut}>
        <button type="submit" className="underline text-sm">
          Sign out
        </button>
      </form>
    </main>
  );
}
