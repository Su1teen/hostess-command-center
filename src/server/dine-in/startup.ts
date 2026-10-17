import { definePlugin } from "nitro";
import { ensureOutboxWorker } from "./outbox";

// Nitro loads plugins at process startup, before its lazy SSR handler receives traffic.
export default definePlugin(() => {
  ensureOutboxWorker();
});
