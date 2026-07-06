import { createRequireAuth } from "@hallpass/express-middleware";
import { auth } from "../auth.js";

export const requireAuth = createRequireAuth(auth);
