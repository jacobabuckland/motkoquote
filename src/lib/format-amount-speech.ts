/**
 * Formats amounts in pence as natural British speech.
 * 1240 pence → "twelve hundred and forty pounds"
 * Treats the pence value as a whole number for speech output.
 */
export function formatAmountAsSpeech(amountInPence: number): string {
  if (amountInPence === 0) {
    return "zero";
  }

  const words = convertNumberToWords(amountInPence);
  return `${words} pounds`;
}

function convertNumberToWords(num: number): string {
  if (num === 0) return "zero";

  const ones = [
    "",
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
  ];
  const teens = [
    "ten",
    "eleven",
    "twelve",
    "thirteen",
    "fourteen",
    "fifteen",
    "sixteen",
    "seventeen",
    "eighteen",
    "nineteen",
  ];
  const tens = [
    "",
    "",
    "twenty",
    "thirty",
    "forty",
    "fifty",
    "sixty",
    "seventy",
    "eighty",
    "ninety",
  ];

  function convertLessThanThousand(n: number): string {
    if (n === 0) return "";

    const hundred = Math.floor(n / 100);
    const remainder = n % 100;
    const ten = Math.floor(remainder / 10);
    const one = remainder % 10;

    let result = "";

    if (hundred > 0) {
      result += ones[hundred] + " hundred";
      if (remainder > 0) {
        result += " and ";
      }
    }

    if (remainder >= 10 && remainder < 20) {
      result += teens[remainder - 10];
    } else {
      if (ten > 0) {
        result += tens[ten];
      }
      if (one > 0) {
        if (ten > 0) {
          result += "-";
        }
        result += ones[one];
      }
    }

    return result;
  }

  // British convention: 1100-1999 can be spoken as "X hundred"
  // e.g., 1240 → "twelve hundred and forty" (not "one thousand, two hundred and forty")
  if (num >= 1100 && num <= 1999) {
    const hundreds = Math.floor(num / 100);
    const remainder = num % 100;
    let result = convertLessThanThousand(hundreds) + " hundred";
    if (remainder > 0) {
      result += " and " + convertLessThanThousand(remainder);
    }
    return result;
  }

  let result = "";

  const thousands = Math.floor(num / 1000);
  const remainder = num % 1000;

  if (thousands > 0) {
    result += convertLessThanThousand(thousands) + " thousand";
    if (remainder > 0) {
      result += ", ";
    }
  }

  if (remainder > 0) {
    result += convertLessThanThousand(remainder);
  }

  return result.trim();
}
