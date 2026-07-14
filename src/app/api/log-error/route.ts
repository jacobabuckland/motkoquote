import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/errors";

/**
 * Receives client-side errors (error boundaries, window.onerror,
 * unhandledrejection). Always responds 200 — error reporting must never
 * surface an error to the client.
 */
export const POST = async (request: NextRequest) => {
  try {
    const body = await request.json();
    const source = typeof body?.source === "string" ? body.source : "client";
    const message = typeof body?.message === "string" ? body.message : null;
    if (!message) return NextResponse.json({ ok: true });

    const error = new Error(message);
    if (typeof body?.stack === "string") error.stack = body.stack;

    let userId: string | null = null;
    try {
      const supabase = await createClient();
      const { data } = await supabase.auth.getUser();
      userId = data.user?.id ?? null;
    } catch {
      // Unauthenticated context — still record the error.
    }

    await logError(source, error, {
      userId,
      path: typeof body?.path === "string" ? body.path : null,
      userAgent: request.headers.get("user-agent"),
      context:
        body?.context && typeof body.context === "object"
          ? (body.context as Record<string, unknown>)
          : {},
    });
  } catch {
    // Never throw.
  }

  return NextResponse.json({ ok: true });
};
