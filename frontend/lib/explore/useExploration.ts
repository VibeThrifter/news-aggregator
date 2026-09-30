"use client";

import { useMemo } from "react";
import useSWR from "swr";

import { getExploration } from "@/lib/api";
import { exploreSwrOptions } from "@/lib/swr-config";

import { buildExploration, type Exploration } from "./exploration";
import type { RawExploration } from "./input";

export function useExploration(identifier: string) {
  const { data, error, isLoading, mutate } = useSWR<RawExploration>(
    ["explore", identifier],
    () => getExploration(identifier),
    exploreSwrOptions,
  );
  const exploration = useMemo<Exploration | null>(() => (data ? buildExploration(data) : null), [data]);
  return { exploration, error, isLoading, retry: () => void mutate() };
}
