import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { reportOffRailsInvoices } from "@/lib/report-off-rails-invoices";
import { rejectUnauthorizedCron } from "@/lib/cron-auth";

export const GET = async (request: NextRequest) => {
  const unauthorized = rejectUnauthorizedCron(request);
  if (unauthorized) return unauthorized;

  const admin = createAdminClient();
  const report = await reportOffRailsInvoices(admin);

  return NextResponse.json(report);
};
