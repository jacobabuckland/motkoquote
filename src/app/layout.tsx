import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { ToastProvider } from "@/components/ui/toast";
import { ErrorListener } from "@/components/error-listener";
import { FeedbackValve } from "@/components/feedback-valve";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Motko",
  description: "AI back-office for UK contractors",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <ToastProvider>
          <ErrorListener />
          {children}
          <FeedbackValve />
        </ToastProvider>
      </body>
    </html>
  );
}
