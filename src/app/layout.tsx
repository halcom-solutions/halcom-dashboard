import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/toast";
import { APP_NAME } from "@/config/app";
import { THEME_INIT_SCRIPT } from "@/features/theme/theme";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: APP_NAME,
  description: "Pelacak request BOQ, RFQ, dan PO untuk Sales, SOA, dan Purchasing Halcom.",
  // An internal tool behind a sign-in: keep it out of search results (Caddy sends the same instruction as a header).
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // suppressHydrationWarning: the head script may add the `dark` class before React hydrates.
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      {/* suppressHydrationWarning: browser extensions add attributes to <body> (for example cz-shortcut-listen) before React hydrates. */}
      <body suppressHydrationWarning className="min-h-full flex flex-col">
        {children}
        {/* Every page, the sign-in and password pages too, shows the result of a form as a toast. */}
        <Toaster />
      </body>
    </html>
  );
}
