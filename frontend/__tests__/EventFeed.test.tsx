import { fireEvent, render, screen } from "@testing-library/react";
import type { SWRResponse } from "swr";

import EventFeed from "@/components/EventFeed";
import type { EventFeedMeta, EventListItem } from "@/lib/api";

jest.mock("swr", () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock("@/lib/api", () => ({
  ...jest.requireActual("@/lib/api"),
  listEvents: jest.fn(),
}));

jest.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  usePathname: () => "/",
}));

type EventFeedResponse = {
  data: EventListItem[];
  meta?: EventFeedMeta;
};

const useSWR = jest.requireMock("swr").default as jest.Mock;
const listEvents = jest.requireMock("@/lib/api").listEvents as jest.Mock;

function buildResponse(
  overrides: Partial<SWRResponse<EventFeedResponse, Error>>,
): SWRResponse<EventFeedResponse, Error> {
  return {
    data: undefined,
    error: undefined,
    isLoading: false,
    isValidating: false,
    mutate: jest.fn(),
    ...overrides,
  } as SWRResponse<EventFeedResponse, Error>;
}

const sampleEvent: EventListItem = {
  id: 42,
  slug: "voorbeeld-event",
  title: "Voorbeeld event",
  description: "Korte samenvatting van het event.",
  article_count: 5,
  first_seen_at: "2025-10-01T10:00:00Z",
  last_updated_at: "2025-10-02T14:30:00Z",
  spectrum_distribution: {
    mainstream: 3,
    links: 2,
  },
};

afterEach(() => {
  jest.clearAllMocks();
});

describe("EventFeed", () => {
  it("renders events when the feed loads successfully", () => {
    useSWR.mockReturnValue(
      buildResponse({
        data: {
          data: [sampleEvent],
          meta: {
            last_updated_at: "2025-10-02T15:00:00Z",
            llm_provider: "Mistral",
            total_events: 1,
          },
        },
      }),
    );

    render(<EventFeed />);

    expect(screen.getAllByText("Voorbeeld event").length).toBeGreaterThan(0);
    const eventLinks = screen
      .getAllByRole("link")
      .filter((link) => link.getAttribute("href") === "/event/voorbeeld-event");
    expect(eventLinks.length).toBeGreaterThan(0);
  });

  it("renders an error state when the feed fails to load", () => {
    useSWR.mockReturnValue(
      buildResponse({
        error: new Error("Backend niet bereikbaar"),
      }),
    );

    render(<EventFeed />);

    expect(screen.getByText("Backend niet bereikbaar")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Probeer opnieuw" })).toBeInTheDocument();
  });

  it("renders an empty state when no events are available", () => {
    const mutate = jest.fn();
    useSWR.mockReturnValue(
      buildResponse({
        data: { data: [], meta: {} },
        mutate,
      }),
    );

    render(<EventFeed />);

    expect(screen.getByText("Er zijn nog geen events beschikbaar.")).toBeInTheDocument();
    const refreshButton = screen.getByRole("button", { name: "Ververs feed" });
    expect(refreshButton).toBeInTheDocument();

    fireEvent.click(refreshButton);
    expect(mutate).toHaveBeenCalledWith(undefined, { revalidate: true });
  });

  it("loads the next page under the news with Meer nieuws", async () => {
    const recent = new Date().toISOString();
    useSWR.mockReturnValue(
      buildResponse({
        data: {
          data: [{ ...sampleEvent, last_updated_at: recent }],
          meta: { has_more: true, next_offset: 120 },
        },
      }),
    );
    listEvents.mockResolvedValue({
      data: [{ ...sampleEvent, id: 43, slug: "tweede-pagina", title: "Nieuws van de tweede pagina", last_updated_at: recent }],
      meta: { has_more: false, next_offset: 121 },
    });

    render(<EventFeed />);
    fireEvent.click(screen.getByRole("button", { name: "Meer nieuws" }));

    expect(await screen.findByText("Nieuws van de tweede pagina")).toBeInTheDocument();
    expect(listEvents).toHaveBeenCalledWith(expect.objectContaining({ offset: 120 }));
    // The last page was not full: no button any more
    expect(screen.queryByRole("button", { name: "Meer nieuws" })).not.toBeInTheDocument();
  });
});
