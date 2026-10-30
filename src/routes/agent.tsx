import { createFileRoute } from "@tanstack/react-router";
import { AgentScreen } from "../components/agent/AgentScreen";

export const Route = createFileRoute("/agent")({ component: AgentScreen });
