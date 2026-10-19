import { createFileRoute } from "@tanstack/react-router";
import { ShiftScreen } from "../components/orders/ShiftScreen";
export const Route = createFileRoute("/shift")({ component: ShiftScreen });
