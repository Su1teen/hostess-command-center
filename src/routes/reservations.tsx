import { createFileRoute, redirect } from "@tanstack/react-router";

/** Compatibility deep link: reservations live inside the Hall screen now. */
export const Route = createFileRoute("/reservations")({
  beforeLoad: () => {
    throw redirect({ to: "/", search: { reservations: true } });
  },
});
