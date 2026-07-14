import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Server-side error logging. Writes to client_errors via the service role.
 *
 * Fire-and-forget: this must NEVER throw into the calling catch block. Callers
 * log and then continue exactly as they would have without logging — in
 * particular, webhook and API error paths must return the same status codes.
 *
 * Identical consecutive errors (same message + path) within a 30s window are
 * deduped so a hot loop cannot flood the table.
 */

const MESSAGE_MAX = 500;
const STACK_MAX = 4000;
const DEDUPE_WINDOW_MS = 30_000;

const truncate = (value: string, max: number): string =>
  value.length > max ? value.slice(0, max) : value;

const toMessageAndStack = (error: unknown): { message: string; stack: string | null } => {
  if (error instanceof Error) {
    return {
      message: truncate(error.message || error.name || "Unknown error", MESSAGE_MAX),
      stack: error.stack ? truncate(error.stack, STACK_MAX) : null,
    };
  }
  if (typeof error === "string") {
    return { message: truncate(error, MESSAGE_MAX), stack: null };
  }
  try {
    return { message: truncate(JSON.stringify(error), MESSAGE_MAX), stack: null };
  } catch {
    return { message: "Unserialisable error", stack: null };
  }
};

const recentErrors = new Map<string, number>();

const shouldDedupe = (message: string, path: string | null): boolean => {
  const key = `${message}::${path ?? ""}`;
  const now = Date.now();
  const last = recentErrors.get(key);
  if (last !== undefined && now - last < DEDUPE_WINDOW_MS) {
    return true;
  }
  recentErrors.set(key, now);
  // Trim stale keys so the map cannot grow unbounded.
  if (recentErrors.size > 500) {
    for (const [k, ts] of recentErrors) {
      if (now - ts >= DEDUPE_WINDOW_MS) recentErrors.delete(k);
    }
  }
  return false;
};

export interface ErrorContext {
  userId?: string | null;
  contractorId?: string | null;
  path?: string | null;
  userAgent?: string | null;
  context?: Record<string, unknown>;
}

export const logError = async (
  source: string,
  error: unknown,
  context: ErrorContext = {},
): Promise<void> => {
  try {
    const { message, stack } = toMessageAndStack(error);
    const path = context.path ?? null;
    if (shouldDedupe(message, path)) return;

    const admin = createAdminClient();
    await admin.from("client_errors").insert({
      source,
      message,
      stack,
      user_id: context.userId ?? null,
      contractor_id: context.contractorId ?? null,
      path,
      user_agent: context.userAgent ?? null,
      context: context.context ?? {},
    });
  } catch {
    // Error logging must never break the product.
  }
};
