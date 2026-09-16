/**
 * Turning what a contractor SAID about a cost into net, VAT and paid state.
 *
 * Voice cost capture carried one number and nothing else. `completeCostCapture`
 * parsed a single `amount_words` straight into `amountNet`, hardcoded the VAT
 * treatment, and had no paid parameter at all — so on 16 Sep:
 *
 *   * "a hundred quid plus twenty VAT, a hundred and twenty on the card" saved
 *     amountNet = 120.00 and vatAmount = null. The gross became the net, which
 *     overstates the cost and loses £20 of recoverable VAT.
 *   * a helper who is not VAT registered was filed as standard-rated.
 *   * "paid on the card" and "paid him in cash" both saved paid = false, so the
 *     money page reported £457.50 still to pay against a true £177.50 — a
 *     double-payment risk if the contractor trusts it.
 *
 * The database schema already had `vatAmount`, `vatTreatment` and `paid`, with
 * `vatTreatment` defaulting to "unknown". Only the voice path never filled them.
 *
 * WHAT THIS DOES AND DOES NOT DECIDE. The model reports WORDS and a basis; the
 * arithmetic happens here, the same division of labour the amount parser
 * already has ("the model supplies words, code decides"). Where the basis is
 * genuinely unknown this REFUSES, so the assistant asks rather than guessing —
 * Jacob's call, 16 Sep. Recording a gross figure as net is silent and wrong;
 * one extra question is neither.
 *
 * Splitting a gross figure at a known rate is arithmetic, not invention: VAT is
 * defined as that fraction. Inventing is what the old path did by assuming the
 * basis.
 */

/** What the contractor said the amount was. */
export type AmountBasis = "net" | "gross" | "unknown";

export type CostVatTreatment = "standard" | "zero" | "exempt" | "reverse_charge" | "unknown";

/** The UK standard rate, as a fraction of the net amount. */
const STANDARD_RATE = 0.2;

export type CostBasisInput = {
  /** The single amount, in pence, already parsed from the contractor's words. */
  amountPence: number;
  basis: AmountBasis;
  treatment: CostVatTreatment;
  /** A VAT amount in pence, where the contractor stated one separately. */
  statedVatPence?: number | null;
};

export type CostBasisResolution =
  | { ok: true; amountNet: number; vatAmount: number | null; vatTreatment: CostVatTreatment }
  | { ok: false; reason: "ambiguous_basis" };

/** Round to whole pence, away from zero, so a split never loses a penny to drift. */
const pence = (value: number): number => Math.round(value);

/**
 * Resolve one spoken amount into the fields a cost row stores.
 *
 * Returns `ok: false` only for the one case the assistant must ask about: an
 * amount whose basis nobody stated, on a treatment where net and gross differ.
 */
export const resolveCostBasis = (input: CostBasisInput): CostBasisResolution => {
  const { amountPence, basis, treatment, statedVatPence } = input;

  // A stated VAT amount settles it whatever the basis words were: net and VAT
  // are the two figures the row stores, and gross is their sum.
  if (statedVatPence != null && statedVatPence >= 0) {
    const amountNet = basis === "gross" ? amountPence - statedVatPence : amountPence;
    return { ok: true, amountNet, vatAmount: statedVatPence, vatTreatment: treatment };
  }

  // No VAT to separate out. Net and gross are the same number, so the basis
  // cannot be ambiguous even when nobody said which it was.
  if (treatment === "zero" || treatment === "exempt" || treatment === "reverse_charge") {
    return { ok: true, amountNet: amountPence, vatAmount: 0, vatTreatment: treatment };
  }

  if (treatment === "standard") {
    if (basis === "gross") {
      const amountNet = pence(amountPence / (1 + STANDARD_RATE));
      return { ok: true, amountNet, vatAmount: amountPence - amountNet, vatTreatment: "standard" };
    }
    if (basis === "net") {
      return {
        ok: true,
        amountNet: amountPence,
        vatAmount: pence(amountPence * STANDARD_RATE),
        vatTreatment: "standard",
      };
    }
    // Standard-rated and nobody said which figure was spoken. The two answers
    // are 20% apart, so this is the question worth asking.
    return { ok: false, reason: "ambiguous_basis" };
  }

  // TREATMENT UNKNOWN, AND SO IS THE BASIS. THAT IS THE SAME QUESTION.
  //
  // This used to record the figure as given and leave the treatment honestly
  // unknown — "nothing to separate and nothing to assume". The reasoning was
  // wrong about which case it was serving. A contractor who just names a
  // figure, which is the commonest way anyone says an amount, produces
  // `unknown/unknown` and NOT `unknown/standard` — so the refusal built for
  // exactly that person never ran, and the assistant never asked. Measured on
  // 16 Sep: "a hundred and twenty" at a merchant saved as £120.00 net with no
  // VAT, and the only question asked was whether the amount was right.
  //
  // Recording it as exact net is not neutral. It is a claim that the figure
  // carries no VAT, on spending that usually does, and it is the silent wrong
  // number this module exists to prevent.
  //
  // A basis the contractor DID give is still enough: we know what the figure
  // means even when the rate is unstated, so only the basis is worth a
  // question.
  if (basis === "unknown") {
    return { ok: false, reason: "ambiguous_basis" };
  }

  return { ok: true, amountNet: amountPence, vatAmount: null, vatTreatment: "unknown" };
};

/** What the assistant asks when the basis is the missing piece. */
export const AMBIGUOUS_BASIS_QUESTION =
  "Was that before or after VAT?";
