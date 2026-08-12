/**
 * Rate limit store abstraction.
 * Supports both Supabase (production) and in-memory (tests) implementations.
 */

export interface RateLimitCheckResult {
  count: number;
  windowStart: Date;
}

export interface RateLimitStore {
  /**
   * Atomically check and increment the request count for a client.
   * Returns the new count and window start time, or throws on error.
   */
  checkAndIncrement(
    clientKey: string,
    routeKey: string,
    windowSeconds: number
  ): Promise<RateLimitCheckResult>;
}

export interface RateLimitRecord {
  client_key: string;
  route_key: string;
  request_count: number;
  window_start: string; // ISO timestamp
}

/**
 * Supabase store implementation for production.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export class SupabaseRateLimitStore implements RateLimitStore {
  constructor(private supabase: SupabaseClient) {}

  async checkAndIncrement(
    clientKey: string,
    routeKey: string,
    windowSeconds: number
  ): Promise<RateLimitCheckResult> {
    const now = new Date();
    const windowStartThreshold = new Date(now.getTime() - windowSeconds * 1000);

    // Try to get the existing record
    const { data: existing, error: selectError } = await this.supabase
      .from("rate_limits")
      .select("*")
      .eq("client_key", clientKey)
      .eq("route_key", routeKey)
      .maybeSingle();

    if (selectError) {
      throw new Error(`Failed to check rate limit: ${selectError.message}`);
    }

    // If no existing record or window has expired, insert/update with count=1
    if (!existing || new Date(existing.window_start) < windowStartThreshold) {
      const { data: upserted, error: upsertError } = await this.supabase
        .from("rate_limits")
        .upsert(
          {
            client_key: clientKey,
            route_key: routeKey,
            request_count: 1,
            window_start: now.toISOString(),
          },
          {
            onConflict: "client_key,route_key",
          }
        )
        .select()
        .single();

      if (upsertError || !upserted) {
        throw new Error(`Failed to upsert rate limit: ${upsertError?.message}`);
      }

      return {
        count: 1,
        windowStart: new Date(upserted.window_start),
      };
    }

    // Increment within the current window (atomic update)
    const { data: updated, error: updateError } = await this.supabase
      .from("rate_limits")
      .update({ request_count: existing.request_count + 1 })
      .eq("client_key", clientKey)
      .eq("route_key", routeKey)
      .select()
      .single();

    if (updateError || !updated) {
      throw new Error(`Failed to increment rate limit: ${updateError?.message}`);
    }

    return {
      count: updated.request_count,
      windowStart: new Date(updated.window_start),
    };
  }
}
