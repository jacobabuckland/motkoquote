import { NextResponse } from "next/server";
import { getCompanyByNumber, compareCompanyNames } from "@/lib/companies-house";

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

    const companyData = await getCompanyByNumber(company_number);

    const registered_address = companyData.registered_office_address
      ? [
          companyData.registered_office_address.address_line_1,
          companyData.registered_office_address.address_line_2,
          companyData.registered_office_address.locality,
          companyData.registered_office_address.region,
          companyData.registered_office_address.postal_code,
        ]
          .filter(Boolean)
          .join(", ")
      : undefined;

    // Compare company name if stated_name provided
    const nameComparison =
      stated_name && companyData.company_name
        ? compareCompanyNames(stated_name, companyData.company_name)
        : undefined;

    return NextResponse.json({
      company_number: companyData.company_number,
      registered_name: companyData.company_name,
      registered_address,
      stated_name,
      stated_address,
      name_matches: nameComparison?.matches,
      name_mismatch: nameComparison?.mismatch,
    });
  } catch (error) {
    console.error("[companies-house] validation failed:", company_number ?? "unknown");
    const errorMessage = error instanceof Error ? error.message : "Validation failed";
    const status = errorMessage.includes("not found") ? 404 : 500;
    return NextResponse.json({ error: errorMessage }, { status });
  }
};
