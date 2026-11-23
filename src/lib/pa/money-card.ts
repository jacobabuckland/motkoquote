// The money card. The position's amounts are PENCE; the card holds POUNDS (what
// <Money> takes), so the conversion happens once, here.

import { sanitiseForModel } from "./data";
import type { MoneyCard, PaActions } from "./types";

const MAX_ROWS = 5;

type Position = Awaited<ReturnType<PaActions["getMoneyPosition"]>>;

export const buildMoneyCard = (position: Position, now: Date): MoneyCard => {
  const rows = position.owedToYou
    .filter((owed) => owed.totalOwed > 0)
    .map((owed) => ({
      customerName: sanitiseForModel(owed.customerName, 60) || "A customer",
      amount: owed.totalOwed / 100,
    }));
  return {
    type: "money",
    asOf: now.toISOString(),
    owed: rows.reduce((sum, row) => sum + row.amount, 0),
    owedBy: rows.slice(0, MAX_ROWS),
    moreOwedBy: Math.max(0, rows.length - MAX_ROWS),
    safeToSpend: position.safeToSpend.total / 100,
  };
};
