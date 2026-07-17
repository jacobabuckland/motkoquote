// Quiet maker's mark on customer-facing pages (/q, /c, /i/[id]/paid).
// Understated attribution — reads as a maker's mark, not an ad.
export const MADE_WITH_MOTKO_URL =
  "https://motko.app?utm_source=document&utm_medium=footer&utm_campaign=viral";

export const MadeWithMotko = () => (
  <p className="mt-6 text-center text-xs text-text-muted">
    made with{" "}
    <a
      href={MADE_WITH_MOTKO_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="underline underline-offset-2 hover:text-text-secondary"
    >
      motko
    </a>
  </p>
);
