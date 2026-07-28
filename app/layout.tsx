import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ??
    requestHeaders.get("host") ??
    "sidebet.openai.site";
  const protocol =
    requestHeaders.get("x-forwarded-proto") ??
    (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  const socialImage = `${origin}/og-sidebet.png`;

  return {
    metadataBase: new URL(origin),
    title: {
      default: "Sidebet — Friendly wagers, finally settled",
      template: "%s · Sidebet",
    },
    description:
      "Create friend-to-friend bet offers, negotiate the terms, and settle debts offline.",
    openGraph: {
      title: "Sidebet — Friendly wagers, finally settled",
      description:
        "Make the call, negotiate the odds, and keep a clean record of who owes who.",
      type: "website",
      images: [{ url: socialImage, width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Sidebet — Friendly wagers, finally settled",
      description:
        "Make the call, negotiate the odds, and keep a clean record of who owes who.",
      images: [socialImage],
    },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#142018",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        {children}
      </body>
    </html>
  );
}
