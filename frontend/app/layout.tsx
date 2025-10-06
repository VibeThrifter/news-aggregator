import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@/styles/globals.css";

export const metadata: Metadata = {
  title: "360° Nieuwsaggregator",
  description: "Moderne Nederlandse nieuwsaggregator met eventdetectie en pluriforme analyses.",
  applicationName: "360° Nieuwsaggregator",
  viewport: {
    width: "device-width",
    initialScale: 1,
    maximumScale: 1,
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="nl">
      <body className="bg-slate-900 text-slate-100 antialiased">
        <div className="flex min-h-screen flex-col">
          <header className="border-b border-slate-700 bg-slate-800">
            <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-brand-400">
                  360° Nieuwsaggregator
                </p>
                <h1 className="text-lg font-semibold text-slate-100 sm:text-xl">
                  Pluriform overzicht van Nederlandse nieuwsevents
                </h1>
              </div>
              <div className="hidden rounded-lg border border-slate-600 bg-slate-700/50 px-3 py-2 text-right text-xs text-slate-300 sm:block">
                <p className="font-medium text-slate-100">MVP Status</p>
                <p>Frontend shell actief</p>
              </div>
            </div>
          </header>
          <main className="flex-1">
            <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 lg:px-8">{children}</div>
          </main>
          <footer className="border-t border-slate-700 bg-slate-800">
            <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4 text-xs text-slate-400 sm:px-6">
              <span>&copy; {new Date().getFullYear()} 360° Nieuwsaggregator</span>
              <span>Eventdetectie · LLM-inzichten · CSV-exports</span>
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}
