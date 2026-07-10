import { NextResponse, type NextRequest } from "next/server";
import { searchCompanies } from "@/lib/companies-house";

export const GET = async (request: NextRequest) => {
  const query = request.nextUrl.searchParams.get("q");

  if (!query || query.trim().length < 2) {
    return NextResponse.json({ items: [] });
  }

  try {
    const items = await searchCompanies(query);
    return NextResponse.json({ items });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Search failed" },
      { status: 502 },
    );
  }
};
