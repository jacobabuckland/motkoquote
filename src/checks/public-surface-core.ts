/**
 * The decision logic for the two production-surface checks. No I/O.
 *
 * Same separation as `scripts/factory/reconcile-core.ts`, and here it earns its
 * keep twice over: these checks assert against production, so the live half can
 * only run from `rls-check.yml` with credentials. Everything decidable without
 * a database is decided here, and is covered by
 * `tests/regression/public-surface.test.ts` in the ordinary gate.
 *
 * Without that split, the only test of this logic would be one that never runs
 * on a pull request — which is the exact failure mode the live-checks lane was
 * built to avoid.
 */

/** One row of `check_public_function_privileges()`. */
export interface FunctionPrivilege {
  function_name: string;
  identity_arguments: string;
  security_definer: boolean;
  anon_execute: boolean;
  authenticated_execute: boolean;
  public_execute: boolean;
}

/** One row of `check_public_object_inventory()`. */
export interface PublicObject {
  object_kind: "table" | "function";
  object_name: string;
}

/**
 * A production exposure that is known, reviewed, and deliberately tolerated.
 *
 * `reason` and `ticket` are required and are checked non-empty by the gate. An
 * allowlist whose entries need no justification is a list of things nobody
 * looked at, and this one governs unauthenticated access to a live database.
 *
 * AGENTS.md's rule for the public-route registry applies here too: adding an
 * entry is a `DECISION NEEDED`-equivalent notice. A human should see the
 * unauthenticated surface — that is the whole point of the check firing.
 */
export interface AllowedExposure {
  /** Function name, matching `proname`. Overloads share an entry. */
  function_name: string;
  reason: string;
  /** Where the decision to tolerate it is recorded. */
  ticket: string;
}

/**
 * Functions that bypass RLS *and* are reachable without the service role.
 *
 * `SECURITY DEFINER` is the load-bearing half. A `SECURITY INVOKER` function
 * callable by `anon` is ordinary Supabase usage — it runs as the caller, so
 * every RLS policy still applies to everything it touches, and five of this
 * project's functions are legitimately used that way from the client. Flagging
 * those would produce a check that is noise on day one and switched off by
 * day three.
 *
 * `SECURITY DEFINER` plus `anon` is the combination with no safe reading: it
 * runs as the owner, RLS does not apply, and anyone holding the publishable key
 * — which ships in the browser bundle — can call it.
 *
 * `public_execute` is included because it is how this happens by accident.
 * Postgres grants EXECUTE to PUBLIC on function creation, so a function that
 * nobody granted anything to is world-callable by default. Not one migration in
 * this repository revokes it.
 */
export function findUnsafeExposures(
  rows: FunctionPrivilege[],
  allowlist: AllowedExposure[],
): FunctionPrivilege[] {
  const allowed = new Set(allowlist.map((a) => a.function_name));

  return rows.filter(
    (r) =>
      r.security_definer &&
      (r.anon_execute || r.authenticated_execute || r.public_execute) &&
      !allowed.has(r.function_name),
  );
}

/** Human-readable, and specific enough to act on without opening a console. */
export function describeExposure(r: FunctionPrivilege): string {
  const roles = [
    r.anon_execute ? "anon" : null,
    r.authenticated_execute ? "authenticated" : null,
    r.public_execute ? "PUBLIC" : null,
  ].filter(Boolean);

  return (
    `public.${r.function_name}(${r.identity_arguments}) is SECURITY DEFINER and ` +
    `executable by ${roles.join(", ")} — reachable at /rest/v1/rpc/${r.function_name} ` +
    `with RLS bypassed. Revoke it:\n` +
    `    REVOKE EXECUTE ON FUNCTION public.${r.function_name}(${r.identity_arguments}) ` +
    `FROM anon, authenticated, PUBLIC;`
  );
}

/** An allowlist entry that explains nothing is not an allowlist entry. */
export function invalidAllowlistEntries(allowlist: AllowedExposure[]): AllowedExposure[] {
  return allowlist.filter(
    (a) =>
      a.function_name.trim().length === 0 ||
      a.reason.trim().length < 20 ||
      a.ticket.trim().length === 0,
  );
}

export interface InventoryDrift {
  /** On production, absent from the committed manifest. */
  unexpected: PublicObject[];
  /** In the manifest, absent from production. */
  missing: PublicObject[];
}

/** Structural type for objects with kind and name, accepting wider types. */
type ObjectLike = { object_kind: string; object_name: string };

/**
 * Compare production's public schema against the manifest committed in the tree.
 *
 * Both directions matter, and they fail for opposite reasons:
 *
 *   `unexpected` — something reached production without passing through this
 *   repository. That is `settle_fee_collection` exactly: created by hand, in no
 *   migration, called by no code, and invisible for weeks.
 *
 *   `missing` — the tree expects an object production does not have. That is
 *   the ghost-apply CLAUDE.md warns about: a migration recorded as applied whose
 *   DDL never landed. The ledger says yes and the column is not there.
 *
 * The migration ledger cannot catch either one. It records which files were
 * run, not what is actually in the database, so it agrees with itself in both
 * cases.
 */
export function findInventoryDrift(
  live: ObjectLike[],
  manifest: ObjectLike[],
): InventoryDrift {
  const key = (o: ObjectLike) => `${o.object_kind}:${o.object_name}`;
  const liveKeys = new Set(live.map(key));
  const manifestKeys = new Set(manifest.map(key));

  return {
    unexpected: live.filter((o) => !manifestKeys.has(key(o))) as PublicObject[],
    missing: manifest.filter((o) => !liveKeys.has(key(o))) as PublicObject[],
  };
}

/**
 * The manifest as it should be committed, printed on failure.
 *
 * A check that says "the manifest is wrong" and leaves you to reconstruct it by
 * hand is a check people learn to skip. This makes the fix a copy-paste, while
 * still requiring it to land as a reviewed commit — which is where a human sees
 * what appeared.
 */
export function renderManifest(live: PublicObject[]): string {
  const sorted = [...live].sort(
    (a, b) => a.object_kind.localeCompare(b.object_kind) || a.object_name.localeCompare(b.object_name),
  );
  return `${JSON.stringify(sorted, null, 2)}\n`;
}
