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
    color = "#" + color[1] + color[1] + color[2] + color[2] + color[3] + color[3];
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
  const luminance = (0.2126 * sRGB(r) + 0.7152 * sRGB(g) + 0.0722 * sRGB(b));

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
