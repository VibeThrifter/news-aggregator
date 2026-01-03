"use client";

import type { EventArticle } from "@/lib/types";
import { ArticleCard } from "./ArticleCard";

interface ArticleListProps {
  articles: EventArticle[];
  /** Whether to show bias analysis badges on articles */
  showBias?: boolean;
}

export function ArticleList({ articles, showBias = true }: ArticleListProps) {
  if (!articles.length) {
    return (
      <div className="rounded-lg border border-paper-200 bg-paper-50 p-6 text-sm text-ink-500">
        Nog geen artikelen gekoppeld aan dit event.
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {articles.map((article) => (
        <ArticleCard key={article.id} article={article} showBias={showBias} />
      ))}
    </div>
  );
}
