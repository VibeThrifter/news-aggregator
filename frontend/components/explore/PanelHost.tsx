"use client";

import { useEffect } from "react";
import dynamic from "next/dynamic";

import { legacyFindingId } from "@/lib/explore/findings";

import { useExplore } from "./ExploreContext";

const SummarySheet = dynamic(() => import("./summary/SummarySheet").then((m) => m.SummarySheet), { ssr: false });
const EntitySheet = dynamic(() => import("./entity/EntitySheet").then((m) => m.EntitySheet), { ssr: false });
const DossierSheet = dynamic(() => import("./dossier/DossierSheet").then((m) => m.DossierSheet), { ssr: false });
const CompareSheet = dynamic(() => import("./compare/CompareSheet").then((m) => m.CompareSheet), { ssr: false });
const BiasDeckSheet = dynamic(() => import("./bias/BiasDeckSheet").then((m) => m.BiasDeckSheet), { ssr: false });
const ModelSheet = dynamic(() => import("./network/ModelSheet").then((m) => m.ModelSheet), { ssr: false });
const PmDetailsSheet = dynamic(() => import("./network/PmDetailsSheet").then((m) => m.PmDetailsSheet), { ssr: false });
const FiltersSheet = dynamic(() => import("./network/FiltersSheet").then((m) => m.FiltersSheet), { ssr: false });
const ArticleSheet = dynamic(() => import("./article/ArticleSheet").then((m) => m.ArticleSheet), { ssr: false });

/**
 * Deep links to a finding: `?f=<findingId>`, and the links of the old clue model
 * (`?p=spoor:<spoor>&c=<clueId>`, e.g. from the board) which now open the finding in its tab.
 */
function useFindingLink() {
  const { panel, toFinding, exploration } = useExplore();
  const f = panel.param("f");
  const legacy = panel.panel?.startsWith("spoor:") ? panel.param("c") : null;
  useEffect(() => {
    const id = f ?? (legacy ? legacyFindingId(legacy) : null);
    if (!id) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("f");
    url.searchParams.delete("c");
    if (url.searchParams.get("p")?.startsWith("spoor:")) url.searchParams.delete("p");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    if (exploration.findingById.has(id)) window.setTimeout(() => toFinding(id), 300);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f, legacy]);
}

/** Renders the sheet that belongs to the ?p= URL parameter. */
export function PanelHost() {
  const { panel } = useExplore();
  useFindingLink();
  const current = panel.panel;
  if (!current) return null;

  if (current === "samenvatting") return <SummarySheet />;
  if (current === "dossier") return <DossierSheet />;
  if (current === "vergelijk") return <CompareSheet />;
  if (current === "model") return <ModelSheet />;
  if (current === "filters") return <FiltersSheet />;
  if (current.startsWith("pm:entity:")) return <PmDetailsSheet kind="entity" id={Number(current.slice("pm:entity:".length))} />;
  if (current.startsWith("pm:relation:")) return <PmDetailsSheet kind="relation" id={Number(current.slice("pm:relation:".length))} />;
  if (current.startsWith("entiteit:")) return <EntitySheet entityKey={current.slice("entiteit:".length)} />;
  if (current.startsWith("bias:")) return <BiasDeckSheet outletKey={current.slice("bias:".length)} />;
  if (current.startsWith("artikel:")) return <ArticleSheet articleId={Number(current.slice("artikel:".length))} />;
  return null;
}
