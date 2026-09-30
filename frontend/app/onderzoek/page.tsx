import type { Metadata } from "next";

import { OnderzoekScreen } from "@/components/explore/board/OnderzoekScreen";

export const metadata: Metadata = {
  title: "Onderzoeksbord · Pluriformiteit",
};

export default function OnderzoekPage() {
  return <OnderzoekScreen />;
}
