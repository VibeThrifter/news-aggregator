import EventDetailScreen from "./EventDetailScreen";

interface DetailPageProps {
  params: {
    id: string;
  };
}

export const revalidate = 0;

export default function EventDetailPage({ params }: DetailPageProps) {
  const eventIdentifier = decodeURIComponent(params.id);
  return <EventDetailScreen eventId={eventIdentifier} />;
}
