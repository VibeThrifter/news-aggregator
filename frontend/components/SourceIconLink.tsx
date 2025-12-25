"use client";

import { useState } from "react";
import Image from "next/image";
import { ExternalLink } from "lucide-react";
import { getDomainFromUrl, getFaviconUrl } from "@/lib/format";
import { useArticleTitle } from "@/components/ArticleLookupContext";

interface SourceIconLinkProps {
  url: string;
  className?: string;
  /** Compact mode: only show favicon with domain tooltip */
  compact?: boolean;
}

export function SourceIconLink({ url, className = "", compact = false }: SourceIconLinkProps) {
  const [showTooltip, setShowTooltip] = useState(false);
  const domain = getDomainFromUrl(url);
  const favicon = getFaviconUrl(url);
  const articleTitle = useArticleTitle(url);

  if (compact) {
    return (
      <div className="relative inline-block">
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          onMouseEnter={() => setShowTooltip(true)}
          onMouseLeave={() => setShowTooltip(false)}
          onFocus={() => setShowTooltip(true)}
          onBlur={() => setShowTooltip(false)}
          className={`inline-flex items-center justify-center rounded-full border border-paper-200 bg-white p-1.5 shadow-sm transition hover:border-paper-300 hover:shadow ${className}`}
          title={domain}
        >
          <Image
            src={favicon}
            alt={domain}
            width={16}
            height={16}
            className="rounded-sm"
            unoptimized
          />
        </a>
        {showTooltip && (
          <div className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1 -translate-x-1/2">
            <div className="whitespace-nowrap rounded bg-slate-800 px-2 py-1 text-xs text-white shadow-lg">
              {domain}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="relative inline-block">
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        onFocus={() => setShowTooltip(true)}
        onBlur={() => setShowTooltip(false)}
        className={`group inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/5 px-2 py-1 text-xs text-slate-300 transition hover:border-white/40 hover:bg-white/10 hover:text-white ${className}`}
      >
        <Image
          src={favicon}
          alt=""
          width={14}
          height={14}
          className="rounded-sm"
          unoptimized
        />
        <span className="max-w-[100px] truncate">{domain}</span>
        <ExternalLink size={10} className="opacity-50 group-hover:opacity-100" />
      </a>

      {showTooltip && articleTitle && (
        <div className="pointer-events-none absolute bottom-full left-0 z-50 mb-2 w-64">
          <div className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-xs text-slate-100 shadow-xl">
            <div className="flex items-start gap-2">
              <Image
                src={favicon}
                alt=""
                width={16}
                height={16}
                className="mt-0.5 shrink-0 rounded-sm"
                unoptimized
              />
              <span className="line-clamp-3 leading-relaxed">{articleTitle}</span>
            </div>
          </div>
          <div className="absolute left-4 top-full -mt-1 h-2 w-2 rotate-45 transform border-b border-r border-slate-600 bg-slate-800" />
        </div>
      )}
    </div>
  );
}
