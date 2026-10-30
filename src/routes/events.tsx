import { createFileRoute } from "@tanstack/react-router";
import { EventsScreen } from "../components/agent/EventsScreen";

export const Route = createFileRoute("/events")({ component: EventsScreen });
