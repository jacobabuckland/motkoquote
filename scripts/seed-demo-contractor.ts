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
  const pipeline = [
    {
      customer: "Daniel Reeve",
      transcript: "Full rewire, three-bed semi, ten sockets downstairs, five up, new consumer unit.",
      scope: ["Full rewire — three-bed semi", "10 double sockets downstairs", "5 double sockets upstairs", "New 18th-edition consumer unit", "Test & certify (EICR)"],
      total: 992.5,
      quoteStatus: "accepted",
      paid: true,
    },
    {
      customer: "Sarah Whitlock",
      transcript: "Skim three ceilings in Dereham, plus a bit of making good.",
      scope: ["Over-skim 3 ceilings", "Make good around light fittings"],
      total: 640,
      quoteStatus: "viewed",
      paid: false,
    },
    {
      customer: "Tom Bagley",
      transcript: "Boiler swap, combi for a combi, same location.",
      scope: ["Remove existing combi", "Supply & fit new combi (like-for-like)", "System flush", "Commission & register"],
      total: 1850,
      quoteStatus: "sent",
      paid: false,
    },
    {
      customer: "Priya Anand",
      transcript: "Kitchen downlights, six of them, and an outside socket by the back door.",
      scope: ["6 x LED downlights to kitchen", "1 x IP-rated outdoor socket"],
      total: 420,
      quoteStatus: "draft",
      paid: false,
    },
  ] as const;

  for (const p of pipeline) {
    const { data: job } = await admin
      .from("jobs")
      .insert({
        contractor_id: contractorId,
        customer_id: cust(p.customer),
        transcript: p.transcript,
        extracted_json: { scope_items: p.scope, timeline: "1–2 weeks" },
        status: p.quoteStatus === "draft" ? "draft" : "quoted",
      })
      .select("id")
      .single();

    const now = new Date();
    const { data: quote } = await admin
      .from("quotes")
      .insert({
        job_id: job!.id,
        total: p.total,
        line_items_json: p.scope.map((description) => ({ description, amount: null })),
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
        amount: p.total,
        due_date: new Date(now.getTime() + 14 * 864e5).toISOString().slice(0, 10),
        status: "paid",
      });
    }
  }

  console.log(
    `Seeded Harrison Electrical (contractor ${contractorId}). Login: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
