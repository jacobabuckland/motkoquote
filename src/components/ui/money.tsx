import { formatGBP } from "@/lib/format";

// THE MONEY RULE, in one place.
//
// Every monetary amount in the product renders in the display face with
// tabular numerals. Money is never set in body type again — an amount is the
// thing the contractor came to the screen for, and it should look like it was
// stamped on a document, not typed into a form.
//
// Always render money through this component rather than calling formatGBP
// into a bare <span>: that's what keeps the rule true as screens get added,
// and it's the single place to change if the formatting ever moves.
type Props = {
  /** Amount in POUNDS (never pence) — matches formatGBP and the DB columns. */
  amount: number;
  /**
   * `row` for amounts inside a list row or a body line (the default),
   * `hero` for the one big figure a screen is built around.
   */
  size?: "row" | "hero" | "total";
  className?: string;
};

const sizeClasses: Record<NonNullable<Props["size"]>, string> = {
  row: "text-[1.0625rem] font-bold",
  total: "text-2xl font-bold",
  hero: "text-4xl font-bold sm:text-5xl",
};

export const Money = ({ amount, size = "row", className = "" }: Props) => (
  <span className={`display ${sizeClasses[size]} ${className}`}>
    {formatGBP(amount)}
  </span>
);
