"use client";

import { AlertTriangle } from "lucide-react";

export default function EventError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto max-w-3xl rounded-2xl border border-red-200 bg-red-50 p-6 text-red-800">
      <div className="flex items-center gap-2 font-semibold">
        <AlertTriangle size={18} /> Er ging iets mis bij het tonen van dit event
      </div>
      <button
        type="button"
        onClick={reset}
        className="mt-4 min-h-[44px] rounded-full border border-red-300 bg-white px-5 text-sm font-semibold"
      >
        Opnieuw proberen
      </button>
    </div>
  );
}
