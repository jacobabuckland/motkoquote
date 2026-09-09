import { NextResponse } from "next/server";
import { validateCompanyNumber } from "@/lib/companies-house";
import { logError } from "@/lib/analytics";

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
    const errorMessage = error instanceof Error ? error.message : "Validation failed";
    const status = errorMessage.includes("not found") ? 404 : 500;
    // Was a console.error naming the company number and NOT the error, so a
    // credential fault here was as invisible as it was on the search route —
    // see that file for why a caught error never reaches Sentry. A 404 is the
    // API answering correctly about a number that does not exist, so it is not
    // an application error and is not recorded as one.
    if (status !== 404) {
      await logError("server", "Companies House validation failed", {
        reason: errorMessage,
        company_number: company_number ?? "unknown",
      });
    }
    return NextResponse.json({ error: errorMessage }, { status });
  }
};
