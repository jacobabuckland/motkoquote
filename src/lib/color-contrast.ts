/**
 * Returns a contrasting text color (dark or light) for a given background color.
 * Meets WCAG AA contrast ratio (4.5:1 minimum).
 *
 * Dark backgrounds → light text (#FFFFFF)
 * Light backgrounds → dark text (#000000)
 */
export function getContrastingTextColor(backgroundColor: string): string {
  // Normalize the color
  let color = backgroundColor.trim();

  // Add # prefix if missing
  if (color && !color.startsWith("#")) {
    color = "#" + color;
  }

  // Expand 3-char hex to 6-char
  if (color.match(/^#[0-9A-Fa-f]{3}$/)) {
    color =
      "#" + color[1] + color[1] + color[2] + color[2] + color[3] + color[3];
  }

  // Validate hex color format
  if (!color.match(/^#[0-9A-Fa-f]{6}$/)) {
    // Invalid color: default to dark green (#004225) which needs light text
    return "#FFFFFF";
  }

  // Extract RGB components
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);

  // Calculate relative luminance using sRGB formula
  const luminance = 0.2126 * sRGB(r) + 0.7152 * sRGB(g) + 0.0722 * sRGB(b);

  // Use dark text for light backgrounds (luminance > 0.5)
  // Use light text for dark backgrounds (luminance <= 0.5)
  return luminance > 0.5 ? "#000000" : "#FFFFFF";
}

/**
 * Convert sRGB color component to linear RGB for luminance calculation
 */
function sRGB(component: number): number {
  const c = component / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/**
 * Relative luminance per WCAG, or null when the string is not a colour we can
 * read. Null rather than a fallback number: a caller deciding whether a colour
 * is safe must be able to tell "unsafe" from "unparseable", and quietly
 * treating a bad value as black would call it safe.
 */
export function relativeLuminance(color: string): number | null {
  let hex = color.trim();
  if (hex && !hex.startsWith("#")) hex = "#" + hex;
  if (hex.match(/^#[0-9A-Fa-f]{3}$/)) {
    hex = "#" + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
  }
  if (!hex.match(/^#[0-9A-Fa-f]{6}$/)) return null;
  return (
    0.2126 * sRGB(parseInt(hex.slice(1, 3), 16)) +
    0.7152 * sRGB(parseInt(hex.slice(3, 5), 16)) +
    0.0722 * sRGB(parseInt(hex.slice(5, 7), 16))
  );
}

/** WCAG contrast ratio between two colours, 1–21. Null if either is unreadable. */
export function contrastRatio(a: string, b: string): number | null {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  if (la == null || lb == null) return null;
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * The lightest surface a branded document ever paints text on.
 *
 * Paper is white and both web surface tokens (`--ground` #f7f6f2, `--card`)
 * are within a hair of it, so checking against pure white is the strictest
 * single case and covers every one of them. One constant beats three that can
 * drift apart.
 */
export const DOCUMENT_PAPER = "#FFFFFF";

/** WCAG AA for body text. Deliberately the body floor, not the large-text 3:1. */
export const BRAND_TEXT_MIN_CONTRAST = 4.5;

/**
 * May the contractor's brand colour be used to PAINT TEXT on a document?
 *
 * The decision behind this (2026-08-25) was to constrain the design rather than
 * the input: a trade may store whatever colour is genuinely theirs, and the
 * renderers decline to use it in the one role where it can make something
 * unreadable. The reported account has `#FEF7B8`, a pale yellow — 1.1:1 on
 * white, so a company name set in it is invisible on the customer's copy, and
 * worse on paper than on a backlit screen.
 *
 * Fills are not this role and must not be routed through here: a monogram uses
 * `getContrastingTextColor` to pick initials that contrast with the fill, so
 * the fill cannot fail whatever colour it is. Nor are rules and accent bars —
 * a 3pt bar carries no text, so a pale one reads as unbranded rather than as
 * broken, which is a degradation and not a failure.
 *
 * An unparseable colour returns false: fall back to ink rather than hand a
 * renderer a value it cannot paint.
 */
export function brandColorReadableAsText(
  brandColor: string | null | undefined,
  background: string = DOCUMENT_PAPER,
): boolean {
  if (!brandColor) return false;
  const ratio = contrastRatio(brandColor, background);
  return ratio != null && ratio >= BRAND_TEXT_MIN_CONTRAST;
}
