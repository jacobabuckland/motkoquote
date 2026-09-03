import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { renderSowPdf } from "@/lib/pdf/render-sow";

export const GET = async (
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;

  // The SOW is an internal contractor document (not a customer-facing capability
  // URL like the quote/contract PDFs), so this route is authenticated and tenant
  // scoped. Authenticate with the user-scoped client and prove ownership through
  // RLS: a hit on jobs for this id means the caller owns it; a miss (other tenant
  // or unknown id) is an indistinguishable 404. Without this, the admin client
  // below would render any job's customer PII for any logged-in trade.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: owned } = await supabase
    .from("jobs")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (!owned) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const buffer = await renderSowPdf(id);

  if (!buffer) {
    return NextResponse.json({ error: "No statement of work for this job yet" }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="sow-${id}.pdf"`,
    },
  });
};
