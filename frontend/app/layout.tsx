import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { Inter, Merriweather } from "next/font/google";
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

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  const today = new Date().toLocaleDateString("nl-NL", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <html lang="nl" className={`${inter.variable} ${merriweather.variable}`}>
      <body className="bg-paper-50 text-ink-900 antialiased font-sans">
        <div className="flex min-h-screen flex-col">
          {/* Masthead */}
          <header className="border-b border-paper-300 bg-paper-50">
            <div className="mx-auto w-full max-w-7xl px-4 py-3 sm:px-6">
              <div className="flex items-center justify-between">
                <time className="text-xs text-ink-400 capitalize hidden sm:block">{today}</time>
                <Link href="/" className="transition-opacity hover:opacity-80">
                  <h1 className="font-serif text-3xl sm:text-4xl font-bold text-ink-900 tracking-tight italic">
                    Pluriformiteit
                  </h1>
                </Link>
                <Link
                  href="/admin"
                  className="text-xs text-ink-400 hover:text-ink-900 transition-colors"
                >
                  Admin
                </Link>
              </div>
            </div>
          </header>

          {/* Main content */}
          <main className="flex-1 bg-paper-100">
            <div className="mx-auto w-full max-w-7xl px-4 py-4 sm:px-6">{children}</div>
          </main>

          {/* Footer */}
          <footer className="border-t border-paper-300 bg-paper-50">
            <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-4 py-4 text-xs text-ink-500 sm:px-6">
              <span>&copy; {new Date().getFullYear()} Pluriformiteit</span>
              <span className="hidden sm:inline">Eventdetectie · Bias-analyse · LLM-inzichten</span>
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}
