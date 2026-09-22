import { createFileRoute } from "@tanstack/react-router";

import { SuppliersScreen } from "../components/suppliers/SuppliersScreen";

export const Route = createFileRoute("/suppliers")({
  component: SuppliersScreen,
});
