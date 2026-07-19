// Guard against contractor/app-directed language leaking onto a customer
// document. The two note channels (customer_note vs contractor_flag) keep
// them apart at the schema level; this is the belt-and-braces render-side
// check the tests assert on, so a regression where an internal instruction
// ("verify Liam's rate before issuing", "markup to be applied by the app")
// is filed as a customer note is caught before it can print.

const CONTRACTOR_DIRECTED_PATTERNS: RegExp[] = [
  /\bverify\b/i,
  /\bconfirm\b.*\bbefore\b/i,
  /\bbefore issuing\b/i,
  /\bto be applied by the app\b/i,
  /\bapplied by the app\b/i,
  /\badjust once\b/i,
  /\bcheck (?:with|the) (?:contractor|supplier)\b/i,
  /\bapprentice rate\b/i,
];

// True when a customer-facing string reads as if it were addressed to the
// contractor or the app rather than the customer.
export const containsContractorDirectedLanguage = (text: string): boolean =>
  CONTRACTOR_DIRECTED_PATTERNS.some((pattern) => pattern.test(text));
