import { type EmailOtpType } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const GET = async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  const supabase = await createClient();

  // Two email-link shapes can land here. The default Supabase template
  // ({{ .ConfirmationURL }}) sends the user through Supabase's own verify
  // endpoint, which redirects back with a PKCE `code`. A custom template using
  // {{ .TokenHash }} arrives with token_hash + type instead. Support both so
  // confirmation works regardless of which email template is configured.
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      redirect(next);
    }
    console.error("auth/confirm exchangeCodeForSession failed:", error.message);
  } else if (token_hash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash });
    if (!error) {
      redirect(next);
    }
    console.error("auth/confirm verifyOtp failed:", type, error.message);
  } else {
    console.error(
      "auth/confirm missing params — got:",
      [...searchParams.keys()].join(",") || "(none)",
    );
  }

  redirect("/auth/error");
};
