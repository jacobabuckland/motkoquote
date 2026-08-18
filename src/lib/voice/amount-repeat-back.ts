/**
 * Generates a verbal repeat-back phrase for confirming an amount.
 * Example: "That's two hundred and eighty pounds — is that right?"
 */
export function generateAmountRepeatBack(amountPence: number): string {
  const pounds = Math.floor(amountPence / 100);
  const pence = amountPence % 100;

  let verbal = "That's ";

  // Convert number to words
  verbal += numberToWords(pounds);
  verbal += " pound";
  if (pounds !== 1) {
    verbal += "s";
  }

  if (pence > 0) {
    verbal += " and ";
    verbal += numberToWords(pence);
    verbal += " pence";
  }

  verbal += " — is that right?";

  return verbal;
}

function numberToWords(n: number): string {
  if (n === 0) return "zero";

  const ones = [
    "", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
    "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
    "seventeen", "eighteen", "nineteen",
  ];

  const tens = [
    "", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety",
  ];

  if (n < 20) {
    return ones[n] || "";
  }

  if (n < 100) {
    const tensPart = Math.floor(n / 10);
    const onesPart = n % 10;
    return tens[tensPart] + (onesPart > 0 ? "-" + ones[onesPart] : "");
  }

  if (n < 1000) {
    const hundreds = Math.floor(n / 100);
    const remainder = n % 100;
    let result = ones[hundreds] + " hundred";
    if (remainder > 0) {
      result += " and " + numberToWords(remainder);
    }
    return result;
  }

  if (n < 1000000) {
    const thousands = Math.floor(n / 1000);
    const remainder = n % 1000;
    let result = numberToWords(thousands) + " thousand";
    if (remainder > 0) {
      if (remainder < 100) {
        result += " and " + numberToWords(remainder);
      } else {
        result += " " + numberToWords(remainder);
      }
    }
    return result;
  }

  return n.toString(); // Fallback for very large numbers
}
