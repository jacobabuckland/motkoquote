import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { ToastProvider } from "@/components/ui/toast";
import { NativeAppInit } from "@/components/native-app-init";

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
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <NativeAppInit />
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
