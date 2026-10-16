import { createFileRoute } from "@tanstack/react-router";
import { QrTablesScreen } from "../components/tables/QrTablesScreen";
export const Route = createFileRoute("/tables/qr")({ component: QrTablesScreen });
