/**
 * Seed the demo contractor "Harrison Electrical" — realistic UK electrician
 * with jobs across every pipeline state and one paid invoice (£992.50).
 *
 * Doubles as the App Store reviewer seed and the fixture the marketing capture
 * script (scripts/capture-marketing-shots.ts) logs in as.
 *
 * Run:  pnpm dlx tsx scripts/seed-demo-contractor.ts
 * Needs: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in the environment.
 *
 * Idempotent-ish: it looks up the demo auth user by email first and reuses it.
 */
import { createClient } from "@supabase/supabase-js";

const DEMO_EMAIL = "demo@harrisonelectrical.co.uk";
const DEMO_PASSWORD = "MotkoDemo!2026";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  throw new Error(
    "Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before seeding.",
  );
}

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false },
});

async function ensureUser(): Promise<string> {
  // Try to find an existing demo user (list is paginated; demo lives on page 1).
  const { data: list } = await admin.auth.admin.listUsers();
  const existing = list?.users.find((u) => u.email === DEMO_EMAIL);
  if (existing) return existing.id;

  const { data, error } = await admin.auth.admin.createUser({
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) throw error ?? new Error("createUser failed");
  return data.user.id;
}

async function main() {
  const userId = await ensureUser();

  // Contractor -----------------------------------------------------------
  const { data: contractor } = await admin
    .from("contractors")
    .upsert(
      {
        owner_user_id: userId,
        company_name: "Harrison Electrical",
        company_number: "09876543",
        trade: "Electrician",
        vat_registered: true,
        vat_number: "GB123456789",
        day_rate: 280,
        overtime_rate: 42,
        callout_min: 90,
        travel_rate: 0.45,
        markup_pct: 15,
        branding: { accent: "#004225", town: "Dereham, Norfolk" },
        business_profile: {
          trading_name: "Harrison Electrical",
          business_structure: "Limited company",
          registered_address: "12 Quebec Road, Dereham, Norfolk, NR19 2DS",
          business_phone: "01362 555 0142",
          business_email: "hello@harrisonelectrical.co.uk",
          certifications: "NICEIC Approved Contractor",
          insurer_name: "Tradesman Direct",
          public_liability_cover: "£2,000,000",
          default_payment_terms: "Payment due within 14 days of invoice",
          payment_methods: "Bank transfer",
          default_warranty_period: "12 months",
        },
      },
      { onConflict: "owner_user_id" },
    )
    .select("id")
    .single();

  const contractorId = contractor!.id as string;

  // Customers ------------------------------------------------------------
  const customers = [
    { name: "Daniel Reeve", contact: { email: "daniel.reeve@example.co.uk", phone: "07700 900321" } },
    { name: "Sarah Whitlock", contact: { email: "s.whitlock@example.co.uk", phone: "07700 900654" } },
    { name: "Tom Bagley", contact: { email: "tom.bagley@example.co.uk", phone: "07700 900987" } },
    { name: "Priya Anand", contact: { email: "priya.anand@example.co.uk", phone: "07700 900112" } },
  ];
  const { data: insertedCustomers } = await admin
    .from("customers")
    .insert(customers.map((c) => ({ ...c, contractor_id: contractorId })))
    .select("id, name");
  const cust = (name: string) =>
    insertedCustomers!.find((c) => c.name === name)!.id as string;

  // Jobs + quotes across the full pipeline ------------------------------
  // status flow: draft → sent → viewed → accepted → (invoice) paid
  // Line items use the full LineItem shape (category/quantity/unit/unit_price)
  // so the public quote page's computeQuoteTotals produces a real subtotal, VAT
  // line and total — not £0. Harrison is VAT-registered, so displayed total is
  // subtotal × 1.2.
  const li = (
    description: string,
    category: "labour" | "materials" | "travel" | "callout" | "other",
    quantity: number,
    unit: string,
    unit_price: number,
  ) => ({ description, category, quantity, unit, unit_price });

  const pipeline = [
    {
      customer: "Daniel Reeve",
      transcript: "Full rewire, three-bed semi, ten sockets downstairs, five up, new consumer unit.",
      lineItems: [
        li("Full rewire — three-bed semi (labour)", "labour", 3, "day", 280),
        li("New 18th-edition consumer unit", "materials", 1, "unit", 165),
        li("Double sockets — supply & fit", "materials", 15, "each", 18),
        li("Test & certify (EICR)", "other", 1, "certificate", 120),
      ],
      quoteStatus: "accepted",
      paid: true,
    },
    {
      customer: "Sarah Whitlock",
      transcript: "Skim three ceilings in Dereham, plus a bit of making good.",
      lineItems: [
        li("Over-skim 3 ceilings", "labour", 2, "day", 260),
        li("Make good around light fittings", "labour", 0.5, "day", 260),
      ],
      quoteStatus: "viewed",
      paid: false,
    },
    {
      customer: "Tom Bagley",
      transcript: "Boiler swap, combi for a combi, same location.",
      lineItems: [
        li("Remove existing combi & make safe", "labour", 1, "day", 280),
        li("Supply & fit new combi boiler (like-for-like)", "materials", 1, "unit", 1150),
        li("System flush", "other", 1, "job", 180),
        li("Commission & register (Gas Safe)", "other", 1, "job", 140),
      ],
      quoteStatus: "sent",
      paid: false,
    },
    {
      customer: "Priya Anand",
      transcript: "Kitchen downlights, six of them, and an outside socket by the back door.",
      lineItems: [
        li("LED downlights to kitchen — supply & fit", "materials", 6, "each", 45),
        li("IP-rated outdoor socket", "materials", 1, "each", 85),
        li("Labour", "labour", 0.5, "day", 280),
      ],
      quoteStatus: "draft",
      paid: false,
    },
  ] as const;

  const captureIds: { sent?: string; accepted?: string; job?: string } = {};

  for (const p of pipeline) {
    const { data: job } = await admin
      .from("jobs")
      .insert({
        contractor_id: contractorId,
        customer_id: cust(p.customer),
        transcript: p.transcript,
        extracted_json: {
          scope_items: p.lineItems.map((i) => i.description),
          timeline: "1–2 weeks",
        },
        status: p.quoteStatus === "draft" ? "draft" : "quoted",
      })
      .select("id")
      .single();

    // Mirror computeQuoteTotals (VAT-registered contractor): total = subtotal × 1.2.
    const subtotal =
      Math.round(
        p.lineItems.reduce((s, i) => s + i.quantity * i.unit_price, 0) * 100,
      ) / 100;
    const total = Math.round(subtotal * 1.2 * 100) / 100;

    const now = new Date();
    const { data: quote } = await admin
      .from("quotes")
      .insert({
        job_id: job!.id,
        total,
        line_items_json: p.lineItems,
        status: p.quoteStatus,
        sent_at: p.quoteStatus !== "draft" ? now.toISOString() : null,
        viewed_at:
          p.quoteStatus === "viewed" || p.quoteStatus === "accepted"
            ? now.toISOString()
            : null,
      })
      .select("id")
      .single();

    if (p.paid) {
      await admin.from("invoices").insert({
        quote_id: quote!.id,
        amount: total,
        due_date: new Date(now.getTime() + 14 * 864e5).toISOString().slice(0, 10),
        status: "paid",
      });
    }

    // Remember ids the marketing capture script consumes.
    if (p.quoteStatus === "sent" && !captureIds.sent) captureIds.sent = quote!.id as string;
    if (p.quoteStatus === "accepted") {
      captureIds.accepted = quote!.id as string;
      captureIds.job = job!.id as string;
    }
  }

  console.log(
    `Seeded Harrison Electrical (contractor ${contractorId}). Login: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`,
  );
  console.log("Marketing capture ids (export before running the capture script):");
  console.log(`  DEMO_QUOTE_SENT=${captureIds.sent ?? ""}`);
  console.log(`  DEMO_QUOTE_ACCEPTED=${captureIds.accepted ?? ""}`);
  console.log(`  DEMO_JOB=${captureIds.job ?? ""}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
