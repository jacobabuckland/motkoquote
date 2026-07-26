// Escapes a string for safe interpolation into an HTML template literal. Our
// transactional emails are assembled as raw HTML strings (Resend has no JSX
// auto-escaping), so every value that originates outside our code — a
// customer-supplied name, a contractor's company name, an LLM-drafted chase
// body — must pass through here before it reaches the markup. Covers both text
// and double-quoted attribute contexts (href="…"), which is every place we
// interpolate. `&` is replaced first so the entities we introduce aren't
// themselves re-escaped.
export const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
