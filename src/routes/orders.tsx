import { createFileRoute } from "@tanstack/react-router";
import { OrdersScreen } from "../components/orders/OrdersScreen";
export const Route = createFileRoute("/orders")({ component: OrdersScreen });
