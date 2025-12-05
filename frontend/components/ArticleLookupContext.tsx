"use client";

import { createContext, useContext, useMemo } from "react";
import type { EventArticle } from "@/lib/types";

type ArticleLookup = Map<string, EventArticle>;

const ArticleLookupContext = createContext<ArticleLookup>(new Map());

interface ArticleLookupProviderProps {
  articles: EventArticle[];
  children: React.ReactNode;
}

export function ArticleLookupProvider({ articles, children }: ArticleLookupProviderProps) {
  const lookup = useMemo(() => {
    const map = new Map<string, EventArticle>();
    for (const article of articles) {
      map.set(article.url, article);
    }
    return map;
  }, [articles]);

  return (
    <ArticleLookupContext.Provider value={lookup}>
      {children}
    </ArticleLookupContext.Provider>
  );
}

export function useArticleLookup() {
  return useContext(ArticleLookupContext);
}

export function useArticleTitle(url: string): string | null {
  const lookup = useArticleLookup();
  return lookup.get(url)?.title ?? null;
}
