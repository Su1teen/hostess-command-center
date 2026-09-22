import { createFileRoute } from "@tanstack/react-router";

import { MenuScreen } from "../components/menu/MenuScreen";

export const Route = createFileRoute("/menu")({
  component: MenuScreen,
});
