// The one money + date formatter for the whole app (G2).
// Amounts are stored in POUNDS (numeric(10,2)) in the database, so formatGBP
// takes pounds directly — never pence.

const GBP = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatGBP(pounds: number): string {
  return GBP.format(Number.isFinite(pounds) ? pounds : 0);
}

const DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Europe/London",
});

export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return DATE.format(date);
}

const DAY_MS = 86_400_000;

const startOfDayLondon = (d: Date): number => {
  // Get the London calendar date as YYYY-MM-DD
  const londonDateStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
  }).format(d);

  // Start with UTC midnight on that calendar day
  const candidate = Date.parse(`${londonDateStr}T00:00:00Z`);

  // Check what hour this UTC time corresponds to in London
  const hourInLondon = parseInt(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      hour: "2-digit",
      hour12: false,
    }).format(new Date(candidate)),
  );

  // Adjust backwards by the offset: during BST, UTC midnight is 01:00 London,
  // so we subtract 1 hour to get the actual London midnight
  return candidate - hourInLondon * 3_600_000;
};

// Renders materials_mentioned as one proper sentence — capitalises the
// first letter and guarantees terminal punctuation — so a lowercase
// fragment straight from the drafting model never reaches the customer.
export function formatMaterialsSentence(materials: string[]): string {
  const joined = materials.join(", ");
  if (!joined) return "";
  const capitalized = joined.charAt(0).toUpperCase() + joined.slice(1);
  return /[.!?]$/.test(capitalized) ? capitalized : `${capitalized}.`;
}

// Sentence-cases a single scope/work-item line for display: capitalises the
// first letter and leaves the rest untouched (so proper nouns and units keep
// their casing). The drafting model sometimes returns leading-lowercase or
// shouty fragments; this is the one place scope lines are cased for the screen.
export function formatScopeLine(line: string): string {
  const trimmed = line.trim();
  if (!trimmed) return "";
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

// Groups a UK sort code into the conventional NN-NN-NN for display. Strips any
// existing separators/spaces first so it renders the same whether payout details
// were stored as "000000" or "00-00-00". Non-digits are dropped, not rejected —
// this is display formatting, not validation.
export function formatSortCode(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  return digits.replace(/(\d{2})(?=\d)/g, "$1-");
}

// Derives a stable, human-legible bank-transfer reference from an invoice id.
// There is no dedicated invoice-reference column, so we compact the invoice
// UUID (drop dashes, uppercase) and prefix INV — short enough for a bank's
// reference field, deterministic so the same invoice always yields the same
// reference the contractor can reconcile against.
export function invoicePaymentReference(invoiceId: string): string {
  const compact = invoiceId.replace(/-/g, "").toUpperCase();
  return `INV${compact.slice(0, 10)}`;
}

export function formatRelative(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const days = Math.round(
    (startOfDayLondon(date) - startOfDayLondon(new Date())) / DAY_MS,
  );
  if (days === 0) return "today";
  if (days === -1) return "yesterday";
  if (days === 1) return "tomorrow";
  if (days < 0) return `${-days} days ago`;
  return `in ${days} days`;
}

/** Current epoch ms. Wrapped so server components can read the clock without
 *  tripping react-hooks/purity, which cannot tell server from client renders. */
export const getRenderTime = (): number => Date.now();
