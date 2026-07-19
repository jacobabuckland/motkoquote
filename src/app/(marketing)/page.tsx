import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SiteHeader } from "./_components/site-header";
import { Reveal } from "./_components/reveal";
import { ScreenFrame } from "./_components/screen-frame";
import { ProductCarousel } from "./_components/product-carousel";
import { ListeningBars, QuoteMark } from "./_components/speech-unit";

export const metadata: Metadata = {
  title: "Motko — Say the job. Send the quote.",
  description:
    "Talk Motko through the work like you'd tell your mate. It writes the quote, prices it from your rates, and chases the payment. Built with UK tradespeople.",
  alternates: { canonical: "/" },
  openGraph: {
    title: "Motko — Say the job. Send the quote.",
    description:
      "Talk it through. Motko prices it from your rates and gets you paid.",
    url: "/",
    siteName: "Motko",
    type: "website",
    locale: "en_GB",
  },
  twitter: {
    card: "summary_large_image",
    title: "Motko — Say the job. Send the quote.",
    description:
      "Talk it through. Motko prices it from your rates and gets you paid.",
  },
};

const HERO_LINES = [
  "Full rewire, three-bed semi, ten sockets downstairs\u2026",
  "Skim three ceilings in Dereham.",
  "Boiler swap, combi for a combi.",
];

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://motko.app";

// Structured data for search/AI surfaces. Organization + SoftwareApplication,
// linked by @id. Free offer reflects early-access pricing.
const JSON_LD = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${SITE_URL}/#organization`,
      name: "Motko",
      url: SITE_URL,
      description:
        "Voice-first quoting and invoicing built with UK tradespeople.",
    },
    {
      "@type": "SoftwareApplication",
      name: "Motko",
      applicationCategory: "BusinessApplication",
      operatingSystem: "iOS, Web",
      url: SITE_URL,
      description:
        "Talk Motko through the job and it writes the quote, prices it from your rates, and chases the payment.",
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "GBP",
      },
      publisher: { "@id": `${SITE_URL}/#organization` },
    },
  ],
};

export default async function LandingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // Logged-in visitors don't want a sales page — send them to the app.
  if (user) redirect("/dashboard");

  // The native app is a sales channel of one: whoever opens it already chose
  // Motko. Skip the marketing site entirely and drop them into signup.
  const userAgent = (await headers()).get("user-agent") ?? "";
  if (userAgent.includes("MotkoApp")) redirect("/signup");

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
      />
      <SiteHeader />
      <main>
        {/* ─────────────── HERO ─────────────── */}
        <section className="mkt-section pt-10 lg:pt-16">
          <div className="mkt-container grid items-center gap-12 lg:grid-cols-[45fr_55fr] lg:gap-16">
            <div>
              <Reveal>
                <h1 className="mkt-h1 max-w-[12ch]">Say the job. Send the quote.</h1>
              </Reveal>
              <Reveal delay={60}>
                <p className="mkt-body mt-6 max-w-[42ch] text-[color:var(--muted)]">
                  Talk Motko through the work like you&rsquo;d tell your mate. It
                  writes the quote, prices it from your rates, and chases the
                  payment.
                </p>
              </Reveal>
              <Reveal delay={120}>
                <div className="mt-8 flex flex-wrap items-center gap-6">
                  <Link href="/signup" className="mkt-btn mkt-btn-primary">
                    Start free
                  </Link>
                  <a href="#how-it-works" className="mkt-textlink">
                    See how it works
                  </a>
                </div>
                <p className="mt-4 text-[13px] text-[color:var(--muted)]">
                  Free while we&rsquo;re in early access &middot; no card &middot;
                  your data stays yours.
                </p>
                <div className="mt-6 flex flex-wrap items-center gap-3">
                  <AppStoreButton />
                  <span className="text-[13px] text-[color:var(--muted)]">
                    Prefer an app? Get it on your iPhone.
                  </span>
                </div>
              </Reveal>
              <Reveal delay={180}>
                <p className="mt-8 text-[13px] text-[color:var(--muted)]">
                  Built with tradespeople in Norfolk &mdash; sparkies,
                  plasterers, plumbers.
                </p>
              </Reveal>
            </div>

            {/* Signature unit: speech becoming a document. */}
            <Reveal delay={120}>
              <HeroUnit />
            </Reveal>
          </div>
        </section>

        {/* ─────────────── HOW IT WORKS ─────────────── */}
        <section id="how-it-works" className="mkt-section bg-[color:var(--card)]">
          <div className="mkt-container">
            <Reveal>
              <p className="mkt-eyebrow">How it works</p>
              <h2 className="mkt-h2 mt-3 max-w-[18ch]">
                From doorstep to paid, one conversation.
              </h2>
            </Reveal>

            <div className="mt-16 flex flex-col gap-16 lg:gap-24">
              <Step
                n="01"
                title="Talk it through"
                body="Stand in the room and say the job out loud — the rooms, the sockets, the access, the timeline. No forms, no typing."
                visual={<StepSpeech />}
                flip={false}
              />
              <Step
                n="02"
                title="Motko prices it"
                body="It turns your words into a clean scope of work and a quote, priced from your rates and your materials — not a number plucked from thin air."
                visual={<ScreenFrame screen="quote" />}
                flip={true}
              />
              <Step
                n="03"
                title="Send it. Sign it. Get paid."
                body="Your customer reads it, accepts it and signs on their phone. Motko invoices and chases until the money lands."
                visual={<ScreenFrame screen="accept" />}
                flip={false}
              />
            </div>
          </div>
        </section>

        {/* ─────────────── PRODUCT CAROUSEL ─────────────── */}
        <ProductCarousel />

        {/* ─────────────── PROOF ─────────────── */}
        <section className="mkt-section">
          <div className="mkt-container max-w-[820px]">
            <Reveal>
              <div className="h-[3px] w-6 bg-[color:var(--green)]" />
              <blockquote className="mkt-speech mt-6 text-[28px] leading-[1.25] lg:text-[40px]">
                Better than MyBuilder for that.
              </blockquote>
              <p className="mkt-body mt-5 text-[color:var(--muted)]">
                Daniel, plasterer, Norfolk.
              </p>
            </Reveal>
          </div>
        </section>

        {/* ─────────────── FOUNDER NOTE ─────────────── */}
        <section className="mkt-section bg-[color:var(--card)]">
          <div className="mkt-container max-w-[720px]">
            <Reveal>
              <p className="mkt-eyebrow">Why I built Motko</p>
              <div className="mkt-body mt-6 flex flex-col gap-4 text-[color:var(--ink)]">
                <p>
                  Motko is built for a family of builders &mdash; always on the
                  go, and never really at a desk. My family are all plasterers
                  and tradespeople.
                </p>
                <p>
                  I watched them up at 6 and home in the evening, raising a
                  family and trying to hold a life together &mdash; and part of
                  that life was the bills, the quotes, the pricing. When you
                  don&rsquo;t win every job, that&rsquo;s a killer waste of time.
                </p>
                <p>
                  That&rsquo;s why I built Motko: to simplify how you quote, help
                  you look more professional, and help you win more work.
                </p>
              </div>
              <p className="mt-6 text-[14px] font-semibold text-[color:var(--muted)]">
                &mdash; The founder, Motko
              </p>
            </Reveal>
          </div>
        </section>

        {/* ─────────────── FAQ ─────────────── */}
        <section className="mkt-section bg-[color:var(--card)]">
          <div className="mkt-container max-w-[760px]">
            <Reveal>
              <h2 className="mkt-h2">Fair questions.</h2>
            </Reveal>
            <div className="mt-10 flex flex-col gap-3">
              <Faq
                q="What if it prices a job wrong?"
                delay={0}
                a={
                  <>
                    You set your rates and your margins; Motko only ever quotes
                    from those. Every quote is yours to check and edit before it
                    goes out &mdash; nothing sends without you tapping send.
                  </>
                }
              />
              <Faq
                q="What does my customer actually see?"
                delay={60}
                a={
                  <>
                    Your name, your logo, your terms &mdash; front and centre.
                    They read it, accept it and sign on their phone. No app, no
                    account needed.
                    <span className="mt-4 block max-w-[240px]">
                      <ScreenFrame screen="accept" />
                    </span>
                  </>
                }
              />
              <Faq
                q="What does it cost?"
                delay={120}
                a={
                  <>
                    Free while we&rsquo;re in early access. Founding trades get
                    looked after when pricing lands &mdash; no surprises, no
                    rug-pulls.
                  </>
                }
              />
              <Faq
                q="I'm not techy — is this hard?"
                delay={180}
                a={
                  <>
                    If you can send a voice note, you can use Motko. You talk, it
                    writes the quote. That&rsquo;s the whole thing.
                  </>
                }
              />
            </div>
          </div>
        </section>

        {/* ─────────────── CLOSING PUNCH ─────────────── */}
        <section className="bg-[color:var(--green)] px-5 py-24 text-white lg:px-8 lg:py-36">
          <div className="mx-auto max-w-[1120px]">
            <Reveal>
              <p className="mkt-h2 font-bold">Jobs go to whoever quotes first.</p>
              <p className="mkt-h2 mt-2 font-normal text-white/[0.78]">
                Be the one who quotes from the van.
              </p>
              <Link
                href="/signup"
                className="mkt-btn mkt-btn-invert mt-10"
              >
                Start free
              </Link>
              <p className="mt-5 text-[14px] text-white/70">
                Free while we&rsquo;re in early access &middot; no card &middot;
                your data stays yours.
              </p>
            </Reveal>
          </div>
        </section>

        {/* ─────────────── FOOTER ─────────────── */}
        <footer className="border-t border-[color:var(--hairline)] bg-[color:var(--canvas)]">
          <div className="mkt-container flex flex-wrap items-center gap-x-5 gap-y-2 py-8 text-[13px] text-[color:var(--muted)]">
            <span className="font-bold text-[color:var(--ink)]">Motko</span>
            <span>Say the job. Send the quote.</span>
            <span aria-hidden="true">&middot;</span>
            <Link href="/privacy" className="hover:text-[color:var(--ink)]">
              Privacy
            </Link>
            <Link href="/support" className="hover:text-[color:var(--ink)]">
              Support
            </Link>
            <Link href="/login" className="hover:text-[color:var(--ink)]">
              Sign in
            </Link>
            <span className="ml-auto">&copy; 2026 Motko</span>
          </div>
        </footer>
      </main>
    </>
  );
}

/* ── Hero unit: rotating spoken line → framed document + chip ── */
function HeroUnit() {
  return (
    <div className="relative">
      <div className="flex gap-3">
        <QuoteMark />
        <div className="mkt-hero-lines mkt-speech flex-1 pt-2 text-[color:var(--ink)]">
          {HERO_LINES.map((line) => (
            <p key={line} className="mkt-hero-line">
              {line}
            </p>
          ))}
        </div>
      </div>
      <div className="mt-3 pl-[76px]">
        <ListeningBars />
      </div>

      <div className="relative mt-8 max-w-[420px]">
        <div className="mkt-hero-frame rounded-[16px]">
          <ScreenFrame screen="sow" priority />
        </div>
        <div className="mkt-hero-chip absolute right-3 top-3 flex items-center gap-1.5 rounded-[8px] border border-[color:var(--hairline)] bg-white px-2.5 py-1.5 text-[12px] font-semibold text-[color:var(--ink)] shadow-[var(--shadow-card)]">
          <Tick />
          Priced from your rates
        </div>
      </div>
    </div>
  );
}

// The App Store listing goes live post-submission (state: "Ready to upload").
// Point at the real listing by setting NEXT_PUBLIC_APP_STORE_URL once the app
// has a numeric App Store ID; until then this falls back to the App Store search
// for "Motko" so the button is never a dead link.
function AppStoreButton() {
  const href =
    process.env.NEXT_PUBLIC_APP_STORE_URL ??
    "https://apps.apple.com/gb/search?term=motko";
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Download Motko on the App Store"
      className="inline-flex items-center gap-2.5 rounded-[10px] bg-black px-4 py-2.5 text-white transition duration-[180ms] hover:-translate-y-0.5 hover:shadow-[var(--shadow-card)]"
    >
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
      </svg>
      <span className="flex flex-col leading-none text-left">
        <span className="text-[10px] font-medium opacity-90">
          Download on the
        </span>
        <span className="-mt-0.5 text-[17px] font-semibold">App Store</span>
      </span>
    </a>
  );
}

function StepSpeech() {
  return (
    <div className="mkt-card flex flex-col gap-4 p-6">
      <div className="flex gap-2">
        <QuoteMark />
        <p className="mkt-speech pt-2 text-[color:var(--ink)]">
          Ten sockets down, five up, outside tap on the gable end&hellip;
        </p>
      </div>
      <ListeningBars />
    </div>
  );
}

function Step({
  n,
  title,
  body,
  visual,
  flip,
}: {
  n: string;
  title: string;
  body: string;
  visual: React.ReactNode;
  flip: boolean;
}) {
  return (
    <Reveal className="grid items-center gap-8 lg:grid-cols-2 lg:gap-16">
      <div className={flip ? "lg:order-2" : ""}>
        <p className="mkt-tabular text-[15px] font-semibold text-[color:var(--green)]">
          {n}
        </p>
        <div className="mt-2 h-[3px] w-6 bg-[color:var(--green)]" />
        <h3 className="mkt-h2 mt-5">{title}</h3>
        <p className="mkt-body mt-4 max-w-[44ch] text-[color:var(--muted)]">
          {body}
        </p>
      </div>
      <div className={`max-w-[420px] ${flip ? "lg:order-1" : ""}`}>{visual}</div>
    </Reveal>
  );
}

function Faq({
  q,
  a,
  delay,
}: {
  q: string;
  a: React.ReactNode;
  delay: number;
}) {
  return (
    <Reveal delay={delay}>
      <details className="mkt-faq mkt-card overflow-hidden">
        <summary className="flex min-h-[56px] items-center justify-between gap-4 px-5 py-4">
          <span className="mkt-h3">{q}</span>
          <span
            className="mkt-plus flex h-6 w-6 shrink-0 items-center justify-center text-[color:var(--green)]"
            aria-hidden="true"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 5v14M5 12h14"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </span>
        </summary>
        <div className="px-5 pb-4 text-[15px] leading-[1.55] text-[color:var(--muted)]">
          {a}
        </div>
      </details>
    </Reveal>
  );
}

function Tick() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className="text-[color:var(--green)]"
    >
      <path
        d="M20 6L9 17l-5-5"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
