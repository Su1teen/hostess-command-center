import { handleBookingApi } from "../guest/api";
import { createLiteHandler } from "./handler";

/** /lite — server-rendered Command Center for very old tablets (see handler.ts). */
export const handleLite = createLiteHandler(handleBookingApi);
