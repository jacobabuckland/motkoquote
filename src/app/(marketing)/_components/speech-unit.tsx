// The hanging quote mark + listening bars used in the hero and step 01.
// Not a cartoon bubble — a quiet, typographic speech treatment.
export function ListeningBars() {
  return (
    <div className="mkt-bars" aria-hidden="true">
      <span />
      <span />
      <span />
      <span />
    </div>
  );
}

export function QuoteMark() {
  return (
    <span className="mkt-quotemark select-none" aria-hidden="true">
      &ldquo;
    </span>
  );
}
