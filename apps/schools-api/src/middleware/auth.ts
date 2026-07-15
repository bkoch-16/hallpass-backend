import {
  createRequireAuth,
  createRequireAuthOrApiKey,
} from "@hallpass/express-middleware";
import { auth } from "../auth.js";
import { env } from "../env.js";

export const requireAuth = createRequireAuth(auth);
export const requireAuthOrApiKey = createRequireAuthOrApiKey(
  auth,
  env.PARENT_TOOL_API_KEY,
);
