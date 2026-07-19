"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Reveal } from "./reveal";
import { ScreenFrame } from "./screen-frame";
import { NotificationCard } from "./notification-card";
import { VoiceCard } from "./voice-card";

type Card = {
  key: string;
  claim: string;
  line: string;
  visual: "voice" | "job" | "dashboard" | "notification";
};

const CARDS: Card[] = [
  {
    key: "voice",
    visual: "voice",
    claim: "Just say the job out loud",
    line: "Talk Motko through the work and it builds the quote as you speak.",
  },
  {
    key: "job",
    visual: "job",
    claim: "Always know whose move it is",
    line: "Sent, viewed, accepted, paid — the job says who's holding it up.",
  },
  {
    key: "notification",
    visual: "notification",
    claim: "Know the second you're paid",
    line: "The money hits and your phone tells you. No logging in to check.",
  },
  {
    key: "dashboard",
    visual: "dashboard",
    claim: "Your whole book of work on one screen",
    line: "Every quote and invoice in one place, sorted by what needs you next.",
  },
];

export function ProductCarousel() {
  const scroller = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  const onScroll = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const cards = Array.from(el.children) as HTMLElement[];
    const center = el.scrollLeft + el.clientWidth / 2;
    let best = 0;
    let bestDist = Infinity;
    cards.forEach((c, i) => {
      const cCenter = c.offsetLeft + c.offsetWidth / 2;
      const d = Math.abs(cCenter - center);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    });
    setActive(best);
  }, []);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [onScroll]);

  const scrollToIndex = useCallback((i: number) => {
    const el = scroller.current;
    if (!el) return;
    const cards = Array.from(el.children) as HTMLElement[];
    const clamped = Math.max(0, Math.min(cards.length - 1, i));
    const target = cards[clamped];
    if (target) {
      el.scrollTo({ left: target.offsetLeft, behavior: "smooth" });
    }
  }, []);

  const nudge = (dir: -1 | 1) => scrollToIndex(active + dir);

  return (
    <section className="mkt-section" aria-labelledby="what-you-get">
      <div className="mkt-container">
        <Reveal className="flex items-end justify-between gap-4">
          <div>
            <p className="mkt-eyebrow">What you get</p>
            <h2 id="what-you-get" className="mkt-h2 mt-3 max-w-[16ch]">
              The back office, without the office.
            </h2>
          </div>
          {/* Arrows: desktop-only (hidden on touch). */}
          <div className="hidden shrink-0 gap-2 lg:flex">
            <CarouselArrow dir="prev" onClick={() => nudge(-1)} disabled={active === 0} />
            <CarouselArrow
              dir="next"
              onClick={() => nudge(1)}
              disabled={active === CARDS.length - 1}
            />
          </div>
        </Reveal>
      </div>

      {/* Full-bleed scroller: left padding aligns to the container, right edge
          bleeds so the next card always peeks — that peek invites the swipe. */}
      <div
        ref={scroller}
        role="group"
        aria-label="Product screenshots"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") {
            e.preventDefault();
            nudge(1);
          } else if (e.key === "ArrowLeft") {
            e.preventDefault();
            nudge(-1);
          }
        }}
        className="mt-10 flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-smooth pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{
          paddingInline: "max(20px, calc((100vw - 1120px) / 2 + 32px))",
          paddingRight: "48px",
          scrollPaddingLeft: "max(20px, calc((100vw - 1120px) / 2 + 32px))",
        }}
      >
        {CARDS.map((card, i) => (
          <Reveal
            key={card.key}
            as="div"
            delay={i * 60}
            className="w-[300px] shrink-0 snap-center lg:w-[360px] lg:snap-start"
          >
            <article
              tabIndex={0}
              className="mkt-card group h-full p-5 transition duration-[180ms] hover:-translate-y-0.5 hover:shadow-[var(--shadow-lift)]"
            >
              <div className="aspect-[4/5] overflow-hidden rounded-[12px]">
                {card.visual === "voice" ? (
                  <VoiceCard />
                ) : card.visual === "notification" ? (
                  <NotificationCard />
                ) : (
                  <div className="h-full w-full [&>div]:h-full [&_svg]:h-full [&_svg]:w-full [&_svg]:object-cover [&_svg]:object-top [&_img]:h-full [&_img]:object-cover [&_img]:object-top">
                    <ScreenFrame screen={card.visual} className="!rounded-none !border-0 !shadow-none" />
                  </div>
                )}
              </div>
              <h3 className="mkt-h3 mt-5">{card.claim}</h3>
              <p className="mkt-body mt-2 text-[color:var(--muted)]">{card.line}</p>
            </article>
          </Reveal>
        ))}
      </div>

      {/* Progress dots: active = green pill (animated width). */}
      <div className="mkt-container mt-6 flex items-center gap-2">
        {CARDS.map((c, i) => (
          <button
            key={c.key}
            type="button"
            aria-label={`Go to ${c.claim}`}
            aria-current={i === active}
            onClick={() => scrollToIndex(i)}
            className="flex h-6 w-6 items-center justify-center rounded-full"
          >
            <span
              aria-hidden
              className="block h-2 rounded-full transition-all duration-200"
              style={{
                width: i === active ? 16 : 8,
                background: i === active ? "var(--green)" : "var(--hairline)",
              }}
            />
          </button>
        ))}
      </div>
    </section>
  );
}

function CarouselArrow({
  dir,
  onClick,
  disabled,
}: {
  dir: "prev" | "next";
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={dir === "prev" ? "Previous card" : "Next card"}
      className="flex h-11 w-11 items-center justify-center rounded-full border border-[color:var(--hairline)] bg-[color:var(--canvas)] text-[color:var(--ink)] transition duration-[180ms] hover:-translate-y-0.5 hover:shadow-[var(--shadow-card)] disabled:opacity-30 disabled:hover:translate-y-0 disabled:hover:shadow-none"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d={dir === "prev" ? "M15 18l-6-6 6-6" : "M9 6l6 6-6 6"}
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
