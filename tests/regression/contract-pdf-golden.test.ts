// Golden-render gate for the contract PDF.
//
// The quote PDF has had one of these since its renderer was split; the
// contract PDF had none, which is why an internal authoring annotation ("Use
// for: …", "Draft template — have a solicitor review before use") could sit in
// customer-facing output through several releases without any gate noticing.
//
// It pins the *bytes*: it stubs the admin client with one fixture row per
// template key, renders through the public entry point, and compares a hash of
// the normalised output against a committed golden. One case per key, because
// the leak this exists to catch was per-template.
//
// Regenerate deliberately and never casually:
//   UPDATE_CONTRACT_PDF_GOLDEN=1 npx vitest run tests/regression/contract-pdf-golden.test.ts
// A diff here means the customer-facing contract changed. If that was
// intended, re-baseline in its own commit so the change is reviewable on its
// own.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { normalizePdfBytes } from "../helpers/quote-pdf-fixtures";
import { CONTRACT_TEMPLATES } from "@/lib/contracts/templates";
import { renderContractTemplate } from "@/lib/contracts/render-template";
import type { ContractVariables } from "@/lib/schemas/contract";

// Every variable the templates reference, all populated, so the gate covers
// each {{#section}} branch in its rendered-on state. A blank here would silently
// shrink the document the golden is pinning.
const VARIABLES = {
  business_name: "Fenland Electrical Ltd",
  trading_name: "Fenland Electrical",
  business_structure: "a private limited company",
  company_number: "09876543",
  registered_address: "14 Mill Road, Wisbech, PE13 1AA",
  business_contact: "01945 000111",
  business_email: "meg@fenland-electrical.co.uk",
  business_phone: "01945 000111",
  trade: "Electrician",
  certifications: "NICEIC Approved Contractor",
  insurer_name: "Zurich",
  public_liability_cover: "£2,000,000",
  insurance_disclosed: "yes",
  client_name: "Mr A Barrett",
  client_address: "3 Elm Close, March, PE15 8QT",
  client_contact: "07700 900123",
  site_address: "3 Elm Close, March, PE15 8QT",
  quote_reference: "A1B2C3D4",
  contract_date: "19 Aug 2026",
  scope_of_work: "Full rewire of a three-bed semi, including consumer unit replacement.",
  exclusions: "Redecoration after making good.",
  labour_cost: "£1,700.00",
  materials_cost: "£620.00",
  subtotal: "£2,320.00",
  vat_amount: "£464.00",
  vat_number: "GB123456782",
  vat_registered: "yes",
  total_price: "£2,784.00",
  deposit_amount: "£556.80",
  payment_schedule: "30% deposit, balance on completion.",
  default_payment_terms: "Payment due within 14 days of invoice",
  payment_methods: "Bank transfer",
  bank_details: "Fenland Electrical Ltd, sort code 04-00-04, account no. 12345678",
  materials_by: "the Contractor",
  materials_notes: "Cable and accessories to BS 7671.",
  start_date: "1 Sep 2026",
  estimated_duration: "5 working days",
  completion_date: "5 Sep 2026",
  access_arrangements: "Key collected from the neighbour at no. 5.",
  warranty_period: "12 months",
  building_regs_responsibility: "the Contractor",
  cancellation_start: "Yes",
  special_terms: "Parking permit to be provided by the Client.",
  governing_law: "England & Wales",
} as unknown as ContractVariables;

const GOLDEN_PATH = path.join(__dirname, "contract-pdf-golden.json");

const readGolden = (): Record<string, string> => {
  try {
    return JSON.parse(readFileSync(GOLDEN_PATH, "utf8")) as Record<string, string>;
  } catch {
    return {};
  }
};

// Which contract row the stubbed admin client should serve for the next render.
let currentRow: Record<string, unknown> | null = null;

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: currentRow, error: null }),
        }),
      }),
    }),
  }),
}));

const rowFor = (renderedBody: string): Record<string, unknown> => ({
  id: "c0ffee00-0000-4000-8000-000000000001",
  deposit_pct: 20,
  rendered_body: renderedBody,
  status: "signed",
  signer_name: "Mr A Barrett",
  signed_at: "2026-08-19T10:00:00.000Z",
  created_at: "2026-08-19T09:00:00.000Z",
  quote: {
    total: 2784,
    job: {
      customer: { name: "Mr A Barrett" },
      contractor: {
        company_name: "Fenland Electrical Ltd",
        company_number: "09876543",
        trade: "Electrician",
        vat_registered: true,
        vat_number: "GB123456782",
        branding: { brand_color: "#004225" },
      },
    },
  },
});

// A single case: which template body to render, and with which variables.
// Named so the diagnostic below can re-render exactly the case that drifted.
type GoldenCase = { key: string; body: string; vars: ContractVariables };

const hashOf = (buffer: Buffer): string =>
  createHash("sha256").update(normalizePdfBytes(buffer), "latin1").digest("hex");

/**
 * Why this exists.
 *
 * On 2026-08-24 this gate failed in CI on `small_works` alone, passed in
 * isolation, and passed on a re-run of the same tree. Comparing hashes tells
 * you THAT bytes moved and nothing about why, so diagnosing it meant repeated
 * speculative full-suite runs. A probe run by hand afterwards showed five
 * consecutive renders in one process are byte-identical — so the drift is
 * between processes, not within one — but by then the failing process was gone
 * and its bytes with it.
 *
 * So the gate now diagnoses itself at the moment it fails, while the process
 * that produced the odd bytes is still alive. It re-renders each drifted case
 * twice more and reports whether the run is self-consistent:
 *
 *   - re-renders match this run  -> stable in-process; something ABOUT THE
 *     PROCESS differs (environment, ordering, a neighbouring file), and the
 *     bytes in hand are a real second sample to compare against the golden.
 *   - re-renders disagree        -> genuinely unstable within one process,
 *     which would be a production concern for every PDF, not a test problem.
 *
 * It does not change what passes. A green run does none of this.
 */
const firstDifference = (
  a: string,
  b: string,
): { at: number; a: string; b: string } | null => {
  if (a === b) return null;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  const window = 90;
  return {
    at: i,
    a: a.slice(Math.max(0, i - window), i + window),
    b: b.slice(Math.max(0, i - window), i + window),
  };
};

const diagnoseDrift = async (
  cases: GoldenCase[],
  hashes: Record<string, string>,
  golden: Record<string, string>,
  render: (id: string) => Promise<Buffer | null>,
  rendered: Record<string, string>,
): Promise<string> => {
  const drifted = cases.filter((c) => golden[c.key] && hashes[c.key] !== golden[c.key]);
  if (drifted.length === 0) return "";

  const lines: string[] = ["", "GOLDEN DRIFT DIAGNOSTIC", ""];
  for (const c of drifted) {
    lines.push(`  ${c.key}`);
    lines.push(`    golden:   ${golden[c.key]}`);
    lines.push(`    this run: ${hashes[c.key]}`);

    const repeats: string[] = [];
    let length = -1;
    let repeatBytes = "";
    for (let i = 0; i < 2; i += 1) {
      currentRow = rowFor(renderContractTemplate(c.body, c.vars));
      const buffer = await render("c0ffee00-0000-4000-8000-000000000001");
      if (!buffer) {
        repeats.push("(rendered nothing)");
        continue;
      }
      repeats.push(hashOf(buffer));
      repeatBytes = normalizePdfBytes(buffer);
      length = repeatBytes.length;
    }

    // The actual mechanism, not just the fact. Both samples came out of THIS
    // process, so whatever differs here is the drift itself rather than any
    // difference between the recorded run and this one.
    // Dump both samples when a directory is named, so the two can be compared
    // as DOCUMENTS rather than as byte strings. Whether the drift is visible to
    // a customer or merely internal is the question that decides whether this
    // is a production defect or an over-strict gate, and it cannot be answered
    // from a hash.
    const dumpDir = process.env.GOLDEN_DRIFT_DUMP;
    if (dumpDir) {
      writeFileSync(`${dumpDir}/${c.key}-drifted.pdf`, Buffer.from(rendered[c.key] ?? "", "latin1"));
      writeFileSync(`${dumpDir}/${c.key}-stable.pdf`, Buffer.from(repeatBytes, "latin1"));
    }

    const diff = firstDifference(rendered[c.key] ?? "", repeatBytes);
    if (diff) {
      lines.push(`    drifted length: ${(rendered[c.key] ?? "").length}`);
      lines.push(`    first differing byte: ${diff.at}`);
      lines.push(`    drifted: ${JSON.stringify(diff.a)}`);
      lines.push(`    stable:  ${JSON.stringify(diff.b)}`);
    } else if (repeatBytes) {
      lines.push("    (re-render is byte-identical to this run's output)");
    }
    lines.push(`    re-render 1: ${repeats[0]}`);
    lines.push(`    re-render 2: ${repeats[1]}`);
    lines.push(`    normalised length: ${length}`);

    const stable = repeats.every((r) => r === hashes[c.key]);
    lines.push(
      stable
        ? "    -> STABLE in-process. The drift is BETWEEN processes: look at what "
          + "differs about this run (ordering, a neighbouring file, the environment), "
          + "not at the renderer."
        : "    -> UNSTABLE within one process. This is a real nondeterminism in the "
          + "renderer and a production concern for every PDF, not a test problem.",
    );
    lines.push("");
  }
  lines.push("  Do NOT re-baseline to make this pass: one of the two outputs is");
  lines.push("  already recorded, so re-recording picks the other arbitrarily, keeps");
  lines.push("  the same failure rate, and destroys the evidence.");
  lines.push("");
  return lines.join("\n");
};

describe("contract PDF golden render", () => {
  beforeEach(() => {
    currentRow = null;
  });

  it("produces byte-identical output for every template", async () => {
    const { renderContractPdf } = await import("@/lib/pdf/render-contract");

    const hashes: Record<string, string> = {};
    // The normalised bytes of each FIRST render, kept so the diagnostic can say
    // WHICH bytes moved rather than only that a hash did. A hash tells you the
    // fact and nothing about the mechanism, which is what made the first two
    // reproductions cost a full-suite run each and yield almost nothing.
    // ~12KB per case; the whole set is under 100KB.
    const rendered: Record<string, string> = {};
    // Kept alongside the hashes so the drift diagnostic can re-render exactly
    // the case that moved, rather than guessing at its inputs.
    const cases: GoldenCase[] = [];
    for (const template of CONTRACT_TEMPLATES) {
      cases.push({ key: template.key, body: template.body, vars: VARIABLES });
      currentRow = rowFor(renderContractTemplate(template.body, VARIABLES));
      const buffer = await renderContractPdf("c0ffee00-0000-4000-8000-000000000001");
      expect(buffer, `${template.key} rendered nothing`).not.toBeNull();
      hashes[template.key] = hashOf(buffer as Buffer);
      rendered[template.key] = normalizePdfBytes(buffer as Buffer);
    }

    // Both sides of the rail gate. The five cases above all render with
    // bank_details populated, so alone they pin only half of what the gating
    // change introduced: a regression that stopped collapsing the clause, or
    // started printing the account on a rail-eligible contract, would move
    // none of them.
    //
    // Two things the recorded hashes prove, both deliberate:
    //   - The five per-template hashes are UNCHANGED by the gating work. This
    //     gate pins the RENDERER and is fed variables directly, while the gate
    //     on bank_details lives upstream in buildContractVariables. The spec's
    //     expectation that they would need re-baselining was wrong; a diff in
    //     them would still mean a real regression.
    //   - `rail-unavailable-bank-details-shown` hashes IDENTICALLY to
    //     `standard_project`, since that fixture already renders the same
    //     populated bank_details. That is the point: it proves the no-rail path
    //     is byte-for-byte what it was, so a contractor who can only be paid by
    //     transfer saw no change at all.
    const RAIL_CASES = [
      { key: "rail-available-no-bank-details", bankDetails: "" },
      {
        key: "rail-unavailable-bank-details-shown",
        bankDetails: "Fenland Electrical Ltd, sort code 04-00-04, account no. 12345678",
      },
    ];
    const standard = CONTRACT_TEMPLATES.find((t) => t.key === "standard_project");
    for (const railCase of RAIL_CASES) {
      const vars = { ...VARIABLES, bank_details: railCase.bankDetails } as ContractVariables;
      cases.push({ key: railCase.key, body: standard!.body, vars });
      currentRow = rowFor(renderContractTemplate(standard!.body, vars));
      const buffer = await renderContractPdf("c0ffee00-0000-4000-8000-000000000001");
      expect(buffer, `${railCase.key} rendered nothing`).not.toBeNull();
      hashes[railCase.key] = hashOf(buffer as Buffer);
      rendered[railCase.key] = normalizePdfBytes(buffer as Buffer);
    }

    if (process.env.UPDATE_CONTRACT_PDF_GOLDEN === "1") {
      writeFileSync(GOLDEN_PATH, `${JSON.stringify(hashes, null, 2)}\n`);
    }

    const golden = readGolden();
    expect(
      Object.keys(golden).length,
      "no golden recorded — run with UPDATE_CONTRACT_PDF_GOLDEN=1 first",
    ).toBeGreaterThan(0);
    // Diagnose BEFORE asserting, so the report is produced while the process
    // that rendered the odd bytes is still alive. A green run does none of it.
    const diagnostic = await diagnoseDrift(
      cases,
      hashes,
      golden,
      renderContractPdf,
      rendered,
    );
    expect(hashes, diagnostic).toEqual(golden);
  }, 120_000);

  // The (a)/(b) fork, asserted as a standing property rather than only
  // reconstructed after a failure.
  //
  // The drift diagnostic above re-renders the case that moved and reports
  // whether the renderer is stable WITHIN one process — which separates a real
  // renderer nondeterminism (a) from cross-process contamination (b). That is
  // the right question, but it is only ever asked once the golden has already
  // drifted, and it did not reproduce at all across 21 full-suite runs on
  // 2026-08-27 (12 at default parallelism, 4 single-process, 5 in isolation).
  //
  // So the distinction currently rests on two observations from one failure in
  // August. This asserts it every run instead, at the cost of two renders.
  //
  // It is a guard, not a reproduction, and it passes today. That is the point:
  // if the renderer ever becomes nondeterministic within a process, this fails
  // immediately and names it as (a) — a PRODUCTION concern for every PDF, since
  // quotes and invoices share the renderer, and the first contract a fresh
  // serverless instance renders would differ from the rest. Nothing asserted
  // that property, and #341's diagnostic can only observe it in the wreckage.
  it("renders the same contract identically twice in one process", async () => {
    const { renderContractPdf } = await import("@/lib/pdf/render-contract");

    const template = CONTRACT_TEMPLATES.find((t) => t.key === "small_works");
    expect(template, "small_works template is missing").toBeDefined();

    const renderOnce = async (): Promise<string> => {
      currentRow = rowFor(renderContractTemplate(template!.body, VARIABLES));
      const buffer = await renderContractPdf("c0ffee00-0000-4000-8000-000000000001");
      expect(buffer, "rendered nothing").not.toBeNull();
      // Two identical hashes of nothing would satisfy the comparison below
      // without proving anything. A real contract PDF is kilobytes.
      expect((buffer as Buffer).length, "rendered a suspiciously small PDF").toBeGreaterThan(1000);
      return hashOf(buffer as Buffer);
    };

    const first = await renderOnce();
    const second = await renderOnce();

    expect(
      second,
      "The same contract rendered two different sets of bytes inside one "
        + "process. That is cause (a): a real nondeterminism in the renderer, "
        + "not a test problem, and it applies to quote and invoice PDFs too "
        + "since they share it. Do NOT re-baseline the goldens — fix "
        + "src/lib/pdf/render-contract.ts or its font registration.",
    ).toBe(first);
  }, 120_000);

  it("returns null when the contract row is absent", async () => {
    const { renderContractPdf } = await import("@/lib/pdf/render-contract");
    currentRow = null;
    await expect(renderContractPdf("missing")).resolves.toBeNull();
  });
});
