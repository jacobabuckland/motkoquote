import type { Metadata, Viewport } from "next";
import { Archivo } from "next/font/google";
import "./globals.css";
import { ToastProvider } from "@/components/ui/toast";
import { NativeAppInit } from "@/components/native-app-init";
import { StatusBarBackdrop } from "@/components/ui/status-bar-backdrop";
import { KeyboardManager } from "@/components/keyboard-manager";
import { OfflineBanner } from "@/components/ui/offline-banner";

// One family for the whole product: Archivo is a variable grotesque with a
// width axis, so the same file serves quiet body text (wdth 100) and the
// signwritten display/money role (wdth 112, via the .display utility). The
// `wdth` axis must be requested explicitly — next/font only ships `wght` by
// default, and without it `font-variation-settings: "wdth"` silently no-ops.
const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  axes: ["wdth"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "https://motko.app",
  ),
  title: "Motko",
  description: "AI back-office for UK contractors",
  manifest: "/manifest.webmanifest",
  // The iOS WKWebView (and Safari) auto-detect phone numbers, dates and
  // addresses in server-rendered HTML and wrap them in <a> tags before React
  // hydrates. That rewrites the DOM out from under hydration and throws a
  // mismatch (React #418) on any page that prints a phone number, date or
  // address — invoices, contracts, quotes, the job hub. We never want the OS
  // to linkify a contractor's own documents, so switch the detection off.
  formatDetection: {
    telephone: false,
    date: false,
    address: false,
    email: false,
  },
};

export const viewport: Viewport = {
  themeColor: "#004225",
  // Lock the viewport so the iOS WKWebView can't pinch- or focus-zoom the app
  // off-centre (tapping an input on iOS otherwise auto-zooms and shifts the
  // layout out of the single-screen view).
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${archivo.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-ground text-ink px-safe">
        {/* Marks the Capacitor shell BEFORE first paint. NativeAppInit adds the
            same class, but it does so in an effect — and --safe-top (globals.css)
            switches a 62px top inset off inside the shell, so waiting for
            hydration means every cold load paints the inset and then collapses
            it. A layout jump that size is worse than the bug it fixes.

            Capacitor injects window.Capacitor via a document-start user script,
            so it is present by the time this runs. Wrapped in try/catch and
            deliberately doing nothing on the web: a throw here would take the
            whole page with it, and NativeAppInit remains the source of truth. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{if(window.Capacitor&&window.Capacitor.isNativePlatform&&window.Capacitor.isNativePlatform()){document.documentElement.classList.add('native-app')}}catch(e){}",
          }}
        />
        <StatusBarBackdrop />
        <NativeAppInit />
        <KeyboardManager />
        <OfflineBanner />
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
