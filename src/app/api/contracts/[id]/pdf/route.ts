import { NextResponse, type NextRequest } from "next/server";
import { renderContractPdf } from "@/lib/pdf/render-contract";

export const GET = async (
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  const buffer = await renderContractPdf(id);

  if (!buffer) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="contract-${id}.pdf"`,
    },
  });
};
