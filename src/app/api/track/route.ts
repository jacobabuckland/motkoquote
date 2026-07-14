import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { trackEvent } from "@/lib/track";

/**
 * Receives client-side funnel events. The event name is validated against the
 * server-side allowlist inside trackEvent, so arbitrary names are dropped.
 * Always responds 200 — instrumentation must never surface an error to the
 * client.
 */
export const POST = async (request: NextRequest) => {
  try {
    const body = await request.json();
    const event = typeof body?.event === "string" ? body.event : null;
    if (!event) return NextResponse.json({ ok: true });

    const properties =
      body?.properties && typeof body.properties === "object"
        ? (body.properties as Record<string, unknown>)
        : {};

    let userId: string | null = null;
    try {
      const supabase = await createClient();
      const { data } = await supabase.auth.getUser();
      userId = data.user?.id ?? null;
    } catch {
      // Unauthenticated context — still record the event.
    }

    await trackEvent(event, properties, {
      userId,
      path: typeof body?.path === "string" ? body.path : null,
      sessionId: typeof body?.session_id === "string" ? body.session_id : null,
    });
  } catch {
    // Never throw.
  }

  return NextResponse.json({ ok: true });
};
