import { fireEvent, render, screen } from "@testing-library/react";
import type { SWRResponse } from "swr";

import EventFeed from "@/components/EventFeed";
import type { EventFeedMeta, EventListItem } from "@/lib/api";

jest.mock("swr", () => ({
  __esModule: true,
  default: jest.fn(),
}));

type EventFeedResponse = {
  data: EventListItem[];
  meta?: EventFeedMeta;
};

type MockedSWR = jest.MockedFunction<
  <Data = EventFeedResponse>(
    key: string,
    fetcher: () => Promise<{ data: EventListItem[]; meta?: EventFeedMeta }> | EventFeedResponse,
  ) => SWRResponse<Data, Error>
>;

const useSWR = jest.requireMock("swr").default as MockedSWR;

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

    expect(screen.getByText("Voorbeeld event")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Bekijk event" })).toHaveAttribute("href", "/event/voorbeeld-event");
    expect(screen.getByText(/Mistral/i)).toBeInTheDocument();
  });

  it("renders an error state when the feed fails to load", () => {
    useSWR.mockReturnValue(
      buildResponse({
        error: new Error("Backend niet bereikbaar"),
      }),
    );

    render(<EventFeed />);

    expect(screen.getAllByText("Backend niet bereikbaar")).toHaveLength(2);
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
});
