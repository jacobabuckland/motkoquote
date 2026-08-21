// Where the landing page's "Download on the App Store" button points — or
// whether it appears at all.
//
// This exists because of what it replaced. The button used to fall back to an
// App Store SEARCH for "Motko" whenever the listing URL was unset, which meant
// it always rendered and always looked like a working link. A visitor who taps
// "Download on the App Store" and lands on a search results page does not
// conclude "the URL is misconfigured" — they conclude the product is not real.
// A plausible link pointing nowhere is worse than no link at all, so an absent
// or unusable value now renders nothing.
//
// The value is returned exactly as given, never repaired: no protocol is
// prepended, no path is appended, nothing is normalised. Either the configured
// URL is usable as-is or there is no button. Repairing a half-right value is
// how a wrong link gets shipped with confidence.
export const resolveAppStoreHref = (raw: string | undefined): string | null => {
  const value = raw?.trim();
  if (!value) return null;

  // The one check: it has to be an absolute http(s) URL. Not validation of the
  // listing — we have no way to know a given id is real — just a refusal to
  // render an <a href> out of something that could never navigate anywhere.
  try {
    const { protocol } = new URL(value);
    return protocol === "https:" || protocol === "http:" ? value : null;
  } catch {
    return null;
  }
};
