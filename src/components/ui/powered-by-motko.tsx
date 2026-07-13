// Small muted attribution for customer-facing pages (/q, /c, /i/[id]/paid).
export const PoweredByMotko = () => (
  <p className="text-center text-xs text-text-muted">
    Powered by{" "}
    <a
      href="https://motko.app"
      target="_blank"
      rel="noopener noreferrer"
      className="underline underline-offset-2 hover:text-text-secondary"
    >
      Motko
    </a>
  </p>
);
