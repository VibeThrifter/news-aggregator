"use client";

import { useEffect, useState } from "react";

const format = new Intl.DateTimeFormat("nl-NL", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

/**
 * Today's date in the masthead. Filled in by the browser: a page that was rendered once on the
 * server (the front page is static) would otherwise keep the date of the last deploy.
 */
export function TodayDate({ className = "" }: { className?: string }) {
  const [today, setToday] = useState<string | null>(null);
  useEffect(() => setToday(format.format(new Date())), []);
  return <time className={className}>{today}</time>;
}
