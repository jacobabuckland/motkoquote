import { NextResponse } from "next/server";
import { validateCompanyNumber } from "@/lib/companies-house";

export const POST = async (request: Request) => {
  let company_number: string | undefined;
  try {
    const body = await request.json();
    const { company_number: companyNum, stated_name, stated_address } = body;
    company_number = companyNum;

    if (!company_number) {
      return NextResponse.json(
        { error: "company_number is required" },
        { status: 400 },
      );
    }

    const result = await validateCompanyNumber({
      company_number,
      stated_name,
      stated_address,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("[companies-house] validation failed:", company_number ?? "unknown");
    const errorMessage = error instanceof Error ? error.message : "Validation failed";
    const status = errorMessage.includes("not found") ? 404 : 500;
    return NextResponse.json({ error: errorMessage }, { status });
  }
};
