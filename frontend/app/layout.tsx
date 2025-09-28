import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "360° News Aggregator",
  description: "Pluriform overzicht van nieuwsclusters met Tavily + ChatGPT"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="nl">
      <body>{children}</body>
    </html>
  );
}
