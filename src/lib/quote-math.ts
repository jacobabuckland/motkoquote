import type { LineItem } from "@/lib/schemas/job";

const VAT_RATE = 0.2;

export const lineItemTotal = (item: LineItem): number => {
  // A labour line with a per-person crew breakdown is priced from that
  // breakdown — sum(days * day_rate) across the crew, so a mixed-rate team
  // (owner £340 + apprentice £120) totals correctly on one line. The
  // multiplier still applies (e.g. 1.5x difficult access). unit_price /
  // people_count are ignored here (they're kept only as a denormalised cache
  // for consumers that don't read `people`).
  if (item.people && item.people.length > 0) {
    const crew = item.people.reduce((sum, p) => sum + p.days * p.day_rate, 0);
    return Math.round(crew * (item.multiplier ?? 1) * 100) / 100;
  }
  // Line items are read from line_items_json via a type cast, not zod
  // parsing (several call sites: quote editor, public quote page, PDF
  // renderer, contract variables) — so quotes drafted before multiplier or
  // people_count existed have them genuinely missing at runtime despite the
  // LineItem type saying they're required. Default both to 1 (no
  // adjustment) rather than producing NaN totals for every pre-existing
  // quote. people_count only matters for labour lines split across a team;
  // every other line item is effectively people_count=1, so this is a
  // no-op for non-labour totals.
  return (
    Math.round(
      item.quantity *
        item.unit_price *
        (item.multiplier ?? 1) *
        (item.people_count ?? 1) *
        100,
    ) / 100
  );
};

export const computeQuoteTotals = (
  lineItems: LineItem[],
  vatRegistered: boolean,
) => {
  const subtotal =
    Math.round(
      lineItems.reduce((sum, item) => sum + lineItemTotal(item), 0) * 100,
    ) / 100;
  const vat = vatRegistered ? Math.round(subtotal * VAT_RATE * 100) / 100 : 0;
  const total = Math.round((subtotal + vat) * 100) / 100;

  return { subtotal, vat, total };
};
