// Proof the microphone is hearing you, before you talk at it for two minutes.
//
// The word "Listening" is a claim; a meter that moves with your voice is
// evidence. It replaces both the static label inside the orb and the pair of
// `animate-ping` rings that used to carry the "I'm live" signal — those scaled
// to 2× their box by default, which is what bled over the scope card above.
//
// HOW THE REDUCED-MOTION FALLBACK WORKS, because it is not obvious: the level
// arrives as a CSS custom property set inline, and every bar's height is a
// calc() over it. That keeps the hot path to one property write per frame
// instead of five style objects, and it means the static fallback is a pure
// stylesheet override — `--level` is pinned in a prefers-reduced-motion block
// in globals.css, which needs `!important` precisely because this inline style
// would otherwise win. See `.level-meter` there.

// Weighted so the middle bar leads and the outer ones trail, which reads as a
// voice rather than a loading bar. Five bars: enough to look like sound, few
// enough to stay legible at 80px.
const BAR_WEIGHTS = [0.45, 0.75, 1, 0.75, 0.45];

// Speech sits around 0.05–0.25 RMS with the smoothing applied upstream; 0.22
// is a normal speaking voice at arm's length, so the meter reaches full height
// on ordinary speech rather than only on a shout.
const FULL_SCALE_RMS = 0.22;

export const MicLevelMeter = ({ level }: { level: number }) => {
  const normalised = Math.max(0, Math.min(level / FULL_SCALE_RMS, 1));

  return (
    <span
      className="level-meter"
      style={{ "--level": normalised } as React.CSSProperties}
      aria-hidden
    >
      {BAR_WEIGHTS.map((weight, i) => (
        <span
          key={i}
          className="level-meter-bar"
          style={{ "--bar-weight": weight } as React.CSSProperties}
        />
      ))}
    </span>
  );
};
