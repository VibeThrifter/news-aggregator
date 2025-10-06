import React from "react";
import { render, screen, waitFor } from "@testing-library/react";

import { ClusterGrid } from "@/components/ClusterGrid";
import { ArticleList } from "@/components/ArticleList";
import { InsightsFallback } from "@/components/InsightsFallback";
import type { Cluster, EventArticle } from "@/lib/api";

jest.mock("framer-motion", () => ({
  __esModule: true,
  motion: new Proxy(
    {},
    {
      get: () =>
        // eslint-disable-next-line react/display-name
        ({ children, ...rest }: { children: React.ReactNode }) => <div {...rest}>{children}</div>,
    },
  ),
}));

jest.mock("@/lib/api", () => {
  const actual = jest.requireActual("@/lib/api");
  return {
    ...actual,
    triggerInsightsRegeneration: jest.fn().mockResolvedValue({ data: {} }),
  };
});

const { triggerInsightsRegeneration } = jest.requireMock("@/lib/api") as {
  triggerInsightsRegeneration: jest.Mock;
};

afterEach(() => {
  jest.clearAllMocks();
});

const sampleClusters: Cluster[] = [
  {
    angle: "Politieke reactie",
    summary: "Analyse van politieke reacties.",
    sources: [
      { title: "NOS", url: "https://nos.nl", spectrum: "mainstream" },
      { title: "De Correspondent", url: "https://decorrespondent.nl", spectrum: "links" },
    ],
  },
];

const sampleArticles: EventArticle[] = [
  {
    id: 1,
    title: "Artikel",
    url: "https://example.com",
    source: "NOS",
    spectrum: "mainstream",
    published_at: "2025-10-01T07:00:00Z",
  },
];

describe("ClusterGrid", () => {
  it("renders fallback when no clusters available", () => {
    render(<ClusterGrid clusters={[]} />);

    expect(screen.getByText(/nog geen invalshoeken/i)).toBeInTheDocument();
  });

  it("renders cluster cards when data provided", () => {
    render(<ClusterGrid clusters={sampleClusters} />);

    expect(screen.getByText("Politieke reactie")).toBeInTheDocument();
    expect(screen.getByText("NOS")).toBeInTheDocument();
  });
});

describe("ArticleList", () => {
  it("renders empty state when there are no articles", () => {
    render(<ArticleList articles={[]} />);

    expect(screen.getByText(/Nog geen artikelen gekoppeld/i)).toBeInTheDocument();
  });

  it("renders article rows with spectrum badge", () => {
    render(<ArticleList articles={sampleArticles} />);

    expect(screen.getByRole("link", { name: "Artikel" })).toBeInTheDocument();
    expect(screen.getByText("Mainstream")).toBeInTheDocument();
  });
});

describe("InsightsFallback", () => {
  it("triggers insights regeneration automatically and shows feedback", async () => {
    render(<InsightsFallback eventId={42} />);

    await waitFor(() => expect(triggerInsightsRegeneration).toHaveBeenCalledWith(42, expect.any(Object)));
    await waitFor(() => expect(screen.getByText(/Insights-run gestart/i)).toBeInTheDocument());
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
