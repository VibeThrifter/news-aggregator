import type { Metadata } from "next";
import { Suspense } from "react";

import { KaartPage } from "@/components/kaart/KaartPage";

export const metadata: Metadata = {
  title: "Waar speelt het nieuws? · Pluriformiteit",
  description: "Kaart van Nederland en wereldbol met de plekken waar het nieuws van deze week speelt.",
};

export default function Kaart() {
  return (
    <Suspense fallback={null}>
      <KaartPage />
    </Suspense>
  );
}
