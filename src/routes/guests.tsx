import { createFileRoute } from "@tanstack/react-router";
import { GuestsScreen } from "../components/guests/GuestsScreen";

export const Route = createFileRoute("/guests")({ component: GuestsScreen });
