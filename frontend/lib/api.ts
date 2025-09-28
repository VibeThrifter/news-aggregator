import type { AggregationResponse } from "@/lib/types";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";

export async function fetchAggregation(query: string): Promise<AggregationResponse> {
  const res = await fetch(`${API_BASE}/api/news360`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ query })
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(errorText || "Kon aggregatie niet ophalen");
  }

  return res.json();
}
