import { type EmailOtpType } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/errors";
import { trackEvent } from "@/lib/track";

export const GET = async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = searchParams.get("next") ?? "/";

  if (token_hash && type) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.verifyOtp({ type, token_hash });

    if (!error) {
      if (type === "signup" || type === "email") {
        await trackEvent(
          "signup_completed",
          { method: "email_link" },
          { userId: data.user?.id ?? null },
        );
      }
      redirect(next);
    }

    console.error("auth/confirm verifyOtp failed:", type, error.message);
    await logError("auth_confirm", error, { context: { type } });
  }

  redirect("/auth/error");
};
