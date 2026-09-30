import type { Metadata } from "next";
import { Suspense } from "react";

import { ActorScreen, ActorSkeleton } from "@/components/explore/actor/ActorScreen";

export const revalidate = 0;

interface ActorPageProps {
  params: { slug: string };
  searchParams: Record<string, string | string[] | undefined>;
}

function displayName(props: ActorPageProps): string {
  const name = props.searchParams.n;
  if (typeof name === "string" && name.trim()) return name.trim().slice(0, 80);
  const slug = decodeURIComponent(props.params.slug);
  return /^pm-\d+$/.test(slug) ? "Wie is dit?" : slug.replace(/-/g, " ");
}

export function generateMetadata(props: ActorPageProps): Metadata {
  return { title: `${displayName(props)} · Wie is dit? · Pluriformiteit` };
}

/** Epic 12: standalone, shareable page of a person or organisation (not tied to one event). */
export default function ActorPage({ params }: ActorPageProps) {
  return (
    <Suspense fallback={<ActorSkeleton />}>
      <ActorScreen slug={decodeURIComponent(params.slug)} />
    </Suspense>
  );
}
