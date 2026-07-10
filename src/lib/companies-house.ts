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

export type CompaniesHouseResult = z.infer<typeof companySchema>;

const API_BASE = "https://api.company-information.service.gov.uk";

const authHeader = () => {
  const apiKey = process.env.COMPANIES_HOUSE_API_KEY;
  if (!apiKey) {
    throw new Error("COMPANIES_HOUSE_API_KEY is not configured");
  }
  return `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`;
};

export const searchCompanies = async (
  query: string,
): Promise<CompaniesHouseResult[]> => {
  const response = await fetch(
    `${API_BASE}/search/companies?q=${encodeURIComponent(query)}&items_per_page=5`,
    { headers: { Authorization: authHeader() } },
  );

  if (!response.ok) {
    throw new Error(`Companies House search failed: ${response.status}`);
  }

  const data = searchResponseSchema.parse(await response.json());
  return data.items;
};
