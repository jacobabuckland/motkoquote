// What customers owe, in POUNDS, from the money position.
//
// The money position carries every amount in PENCE (see CustomerAggregate in
// money-position-math.ts), and <Money> takes pounds. The first version of the
// ledger figure summed pence and handed them over as pounds, so a debt of £1,840
// would have read £184,000. Every other consumer divides by 100; this is the one
// place the chat does, so it cannot be forgotten at a call site.

export const owedInPounds = (owedToYou: { totalOwed: number }[]): number =>
  owedToYou.reduce((sum, customer) => sum + customer.totalOwed, 0) / 100;
