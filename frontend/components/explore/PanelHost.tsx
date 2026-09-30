"use client";

import dynamic from "next/dynamic";

import { SPOOR_BY_ID } from "@/lib/explore/labels";
import type { SpoorId } from "@/lib/explore/types";

import { useExplore } from "./ExploreContext";

const SpoorSheet = dynamic(() => import("./sporen/SpoorSheet").then((m) => m.SpoorSheet), { ssr: false });
const SummarySheet = dynamic(() => import("./summary/SummarySheet").then((m) => m.SummarySheet), { ssr: false });
const SourcesSheet = dynamic(() => import("./sources/SourcesSheet").then((m) => m.SourcesSheet), { ssr: false });
const EntitySheet = dynamic(() => import("./entity/EntitySheet").then((m) => m.EntitySheet), { ssr: false });
const DossierSheet = dynamic(() => import("./dossier/DossierSheet").then((m) => m.DossierSheet), { ssr: false });
const CompareSheet = dynamic(() => import("./compare/CompareSheet").then((m) => m.CompareSheet), { ssr: false });
const BiasDeckSheet = dynamic(() => import("./bias/BiasDeckSheet").then((m) => m.BiasDeckSheet), { ssr: false });
const ModelSheet = dynamic(() => import("./network/ModelSheet").then((m) => m.ModelSheet), { ssr: false });
const PmDetailsSheet = dynamic(() => import("./network/PmDetailsSheet").then((m) => m.PmDetailsSheet), { ssr: false });
const FiltersSheet = dynamic(() => import("./network/FiltersSheet").then((m) => m.FiltersSheet), { ssr: false });

/** Renders the sheet that belongs to the ?p= URL parameter. */
export function PanelHost() {
  const { panel } = useExplore();
  const current = panel.panel;
  if (!current) return null;

  if (current === "samenvatting") return <SummarySheet />;
  if (current === "bronnen") return <SourcesSheet />;
  if (current === "dossier") return <DossierSheet />;
  if (current === "vergelijk") return <CompareSheet />;
  if (current === "model") return <ModelSheet />;
  if (current === "filters") return <FiltersSheet />;
  if (current.startsWith("pm:entity:")) return <PmDetailsSheet kind="entity" id={Number(current.slice("pm:entity:".length))} />;
  if (current.startsWith("pm:relation:")) return <PmDetailsSheet kind="relation" id={Number(current.slice("pm:relation:".length))} />;
  if (current.startsWith("spoor:")) {
    const id = current.slice("spoor:".length) as SpoorId;
    return SPOOR_BY_ID[id] ? <SpoorSheet spoorId={id} /> : null;
  }
  if (current.startsWith("entiteit:")) return <EntitySheet entityKey={current.slice("entiteit:".length)} />;
  if (current.startsWith("bias:")) return <BiasDeckSheet outletKey={current.slice("bias:".length)} />;
  return null;
}
