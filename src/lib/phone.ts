// Pure UK phone-number normalization — no I/O, safe to unit test in
// isolation. Accepts the messy formats a contractor might read off a call
// (leading 0, +44, 0044, spaces/dashes/brackets) and returns a consistent
// E.164-ish +44 form, or null if it doesn't look like a valid UK number.
export const normalizeUkPhone = (input: string): string | null => {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const digits = trimmed.replace(/[^\d+]/g, "");

  let national: string;
  if (digits.startsWith("+44")) {
    national = digits.slice(3);
  } else if (digits.startsWith("0044")) {
    national = digits.slice(4);
  } else if (digits.startsWith("44") && digits.length > 10) {
    national = digits.slice(2);
  } else if (digits.startsWith("0")) {
    national = digits.slice(1);
  } else {
    national = digits.replace(/^\+/, "");
  }

  if (!/^\d{9,10}$/.test(national)) return null;
  return `+44${national}`;
};
