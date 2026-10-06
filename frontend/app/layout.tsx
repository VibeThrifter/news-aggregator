import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { Inter, Merriweather } from "next/font/google";
import { TodayDate } from "@/components/TodayDate";
import "@/styles/globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const merriweather = Merriweather({
  weight: ["400", "700", "900"],
  subsets: ["latin"],
  variable: "--font-serif",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Pluriformiteit",
  description: "Pluriform overzicht van Nederlandse nieuwsevents met eventdetectie en bias-analyse.",
  applicationName: "Pluriformiteit",
};

// Pinch-zoom stays enabled (accessibility); inputs use >=16px text so iOS does not auto-zoom.
// viewportFit "cover" exposes env(safe-area-inset-*) for the bottom dock and sheets.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#ffffff",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="nl" className={`${inter.variable} ${merriweather.variable}`}>
      <body className="bg-paper-100 text-ink-900 antialiased font-sans">
        <div className="flex min-h-screen flex-col">
          {/* Masthead */}
          <header>
            <div className="mx-auto grid w-full max-w-7xl grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 pb-1 pt-4 sm:px-6 sm:pt-5">
              {/* Only the first letter is a capital in a Dutch date */}
              <TodayDate className="hidden text-sm text-ink-500 first-letter:uppercase sm:block" />
              <Link href="/" className="col-start-1 justify-self-start transition-opacity hover:opacity-80 sm:col-start-2 sm:justify-self-center">
                <span className="font-serif text-[28px] font-black leading-none tracking-tight text-ink-900 sm:text-[34px]">Pluriformiteit</span>
              </Link>
              <Link
                href="/admin"
                className="col-start-3 justify-self-end rounded-full px-3 py-2 text-sm font-medium text-ink-500 transition-colors hover:bg-paper-200 hover:text-ink-900"
              >
                Beheer
              </Link>
            </div>
          </header>

          {/* Main content */}
          <main className="flex-1">
            <div className="mx-auto w-full max-w-7xl px-4 py-4 sm:px-6">{children}</div>
          </main>

          {/* Footer */}
          <footer>
            <div className="mx-auto flex w-full max-w-7xl items-center justify-between border-t border-paper-200 px-4 py-6 text-xs text-ink-400 sm:px-6">
              <span>&copy; {new Date().getFullYear()} Pluriformiteit</span>
              <span className="hidden sm:inline">Eventdetectie · Bias-analyse · LLM-inzichten</span>
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}
