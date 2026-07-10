import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role client for privileged, server-only operations
 * (webhooks, background jobs). Bypasses Row Level Security.
 * Never import this into client components.
 */
export const createAdminClient = () =>
  createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
