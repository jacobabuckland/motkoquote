import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { ToastProvider } from "@/components/ui/toast";
import { NativeAppInit } from "@/components/native-app-init";
import { KeyboardManager } from "@/components/keyboard-manager";
import { OfflineBanner } from "@/components/ui/offline-banner";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
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
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-background text-foreground px-safe">
        <NativeAppInit />
        <KeyboardManager />
        <OfflineBanner />
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
