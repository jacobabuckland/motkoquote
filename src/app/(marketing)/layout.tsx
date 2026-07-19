import type { Viewport } from "next";
import { Instrument_Serif } from "next/font/google";
import "./marketing.css";

// The root layout locks zoom for the native iOS WKWebView shell. The public
// marketing pages are a browser experience, so re-enable pinch-zoom here for
// accessibility (WCAG 1.4.4). This viewport overrides the root for /(marketing).
export const viewport: Viewport = {
  themeColor: "#004225",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

// The single permitted type addition: one characterful serif italic, self-hosted
// by next/font, used ONLY for the human "speech" voice (hero rotator, step 01
// fragment, testimonial). Everything else stays the app sans.
const instrumentSerif = Instrument_Serif({
  weight: "400",
  style: "italic",
  subsets: ["latin"],
  variable: "--font-serif",
  display: "swap",
});

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className={`mkt ${instrumentSerif.variable}`}>{children}</div>
  );
}
