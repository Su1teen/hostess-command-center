import { createFileRoute } from "@tanstack/react-router";
import { RegularsScreen } from "../components/regulars/RegularsScreen";

export const Route = createFileRoute("/regulars")({ component: RegularsScreen });
