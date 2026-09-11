import { z } from "zod";

const companySchema = z.object({
  company_number: z.string(),
  title: z.string(),
  company_status: z.string().optional(),
  address_snippet: z.string().optional(),
});

const searchResponseSchema = z.object({
  items: z.array(companySchema),
});

const registeredOfficeAddressSchema = z.object({
  address_line_1: z.string().optional(),
  address_line_2: z.string().optional(),
  locality: z.string().optional(),
  region: z.string().optional(),
  postal_code: z.string().optional(),
  country: z.string().optional(),
});

const companyProfileSchema = z.object({
  company_number: z.string(),
  company_name: z.string(),
  company_status: z.string().optional(),
  registered_office_address: registeredOfficeAddressSchema.optional(),
});

export type CompaniesHouseResult = z.infer<typeof companySchema>;
export type CompanyProfile = z.infer<typeof companyProfileSchema>;

const API_BASE = "https://api.company-information.service.gov.uk";

/**
 * What is wrong with the configured key, or null if nothing detectable is.
 *
 * WHY THIS EXISTS. On 11 Sep the search still failed after the trim fix, and the
 * body — now readable — said:
 *
 *   400: {"error":"Invalid Authorization header","type":"ch:service"}
 *
 * That is CH saying it could not PARSE the header, which is a different claim
 * from "this key is not one of ours" (401). The encoding here is correct, so the
 * remaining suspect is the value in the environment, and every cause below
 * survives a paste into a Vercel variable invisibly and survives `trim()`.
 *
 * NEVER RETURNS THE KEY, or any part of it. These strings reach the contractor's
 * screen through the route's error path and the events table, so they name the
 * defect and the length and nothing else. The length alone separates "the whole
 * key is there" from "half of it is".
 */
export const describeKeyDefect = (rawKey: string): string | null => {
  const key = rawKey.trim();
  const len = key.length;

  if (len === 0) return "COMPANIES_HOUSE_API_KEY is empty once whitespace is stripped";

  if (/^["'][\s\S]*["']$/.test(key)) {
    return `COMPANIES_HOUSE_API_KEY is wrapped in quotation marks (length ${len}) — store the key without them`;
  }

  if (/^(basic|bearer)\s/i.test(key)) {
    return `COMPANIES_HOUSE_API_KEY already carries an auth scheme prefix (length ${len}) — store only the key itself`;
  }

  if (/\s/.test(key)) {
    return `COMPANIES_HOUSE_API_KEY contains whitespace inside it (length ${len}) — it was probably pasted with a line break`;
  }

  if (key.includes(":")) {
    return `COMPANIES_HOUSE_API_KEY contains a colon (length ${len}) — the colon is the empty-password separator and is added here, not stored`;
  }

  // The one that `trim()` cannot help with. A key copied via a document or chat
  // window can pick up a non-breaking space, a smart quote or an en-dash; utf8
  // encodes those as multiple bytes, so CH decodes a credential that is not
  // Latin-1 and rejects the header outright.
  const nonAscii = [...key].find((ch) => ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) > 0x7e);
  if (nonAscii !== undefined) {
    return `COMPANIES_HOUSE_API_KEY contains a non-ASCII character (U+${nonAscii
      .charCodeAt(0)
      .toString(16)
      .toUpperCase()
      .padStart(4, "0")} at position ${[...key].indexOf(nonAscii)}, length ${len}) — retype it rather than pasting it`;
  }

  return null;
};

const authHeader = () => {
  const apiKey = process.env.COMPANIES_HOUSE_API_KEY;
  if (!apiKey) {
    throw new Error("COMPANIES_HOUSE_API_KEY is not configured");
  }

  // Fail here rather than letting CH fail. Every defect below produces the same
  // opaque "Invalid Authorization header" from Companies House, which names none
  // of them; this names exactly one.
  const defect = describeKeyDefect(apiKey);
  if (defect) throw new Error(defect);
  // TRIMMED, and not defensively-for-the-sake-of-it. The key is pasted into a
  // Vercel environment variable by hand, and a trailing newline or space
  // survives that paste invisibly. Here it would be base64-encoded INTO the
  // credential, so Companies House decodes a username that is not the key and
  // rejects the request — with a 400, not a 401, because the header parsed and
  // its contents did not. That is the shape of the failure recorded on 10 Sep.
  //
  // The scheme itself is correct and should not be changed: CH uses HTTP Basic
  // with the API key as the USERNAME and an EMPTY password, which is what the
  // trailing colon is.
  return `Basic ${Buffer.from(`${apiKey.trim()}:`).toString("base64")}`;
};

/**
 * Companies House explains itself in the response BODY. The status alone does
 * not, and throwing only the status is why 10 Sep's 400 could not be diagnosed.
 *
 * Both call sites threw `${status}` and discarded the body, so the events table
 * recorded "Companies House search failed: 400" — accurate, and it names
 * neither which parameter CH objected to nor whether the credential was even
 * read. CH returns an `errors` array saying exactly that.
 *
 * Truncated, because this string reaches the contractor's screen via the route's
 * error path as well as the events table, and an unbounded provider body has no
 * business in either.
 */
const describeFailure = async (response: Response): Promise<string> => {
  let detail = "";
  try {
    detail = (await response.text()).slice(0, 300).trim();
  } catch {
    // A body that cannot be read is not worth failing over — the status still
    // gets reported below.
  }
  return detail ? `${response.status}: ${detail}` : `${response.status}`;
};

export const searchCompanies = async (
  query: string,
): Promise<CompaniesHouseResult[]> => {
  const response = await fetch(
    `${API_BASE}/search/companies?q=${encodeURIComponent(query)}&items_per_page=5`,
    { headers: { Authorization: authHeader() } },
  );

  if (!response.ok) {
    throw new Error(`Companies House search failed: ${await describeFailure(response)}`);
  }

  const data = searchResponseSchema.parse(await response.json());
  return data.items;
};

export const getCompanyByNumber = async (
  companyNumber: string,
): Promise<CompanyProfile> => {
  const response = await fetch(
    `${API_BASE}/company/${encodeURIComponent(companyNumber)}`,
    { headers: { Authorization: authHeader() } },
  );

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`Company number not found`);
    }
    throw new Error(`Companies House API error: ${await describeFailure(response)}`);
  }

  const data = companyProfileSchema.parse(await response.json());
  return data;
};

export const normalizeCompanyName = (name: string): string => {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
};

export const compareCompanyNames = (
  stated: string,
  registered: string,
): { matches: boolean; mismatch?: string } => {
  const normalizedStated = normalizeCompanyName(stated);
  const normalizedRegistered = normalizeCompanyName(registered);

  if (normalizedStated === normalizedRegistered) {
    return { matches: true };
  }

  return {
    matches: false,
    mismatch: `Stated: "${stated}", Registered: "${registered}"`,
  };
};

export type ValidationResult = {
  company_number: string;
  registered_name: string;
  registered_address?: string;
  stated_name: string | undefined;
  stated_address: string | undefined;
  name_matches?: boolean;
  name_mismatch?: boolean;
};

/**
 * Validates a company number and cross-checks against stated details.
 * Core validation logic shared by the API route and internal callers.
 */
export const validateCompanyNumber = async (params: {
  company_number: string;
  stated_name?: string | null;
  stated_address?: string | null;
}): Promise<ValidationResult> => {
  const { company_number, stated_name, stated_address } = params;

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

  return {
    company_number: companyData.company_number,
    registered_name: companyData.company_name,
    registered_address,
    stated_name: stated_name ?? undefined,
    stated_address: stated_address ?? undefined,
    name_matches: nameComparison?.matches,
    name_mismatch: nameComparison?.mismatch !== undefined,
  };
};
