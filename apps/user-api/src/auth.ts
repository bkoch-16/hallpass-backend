import { createAuth } from "@hallpass/auth";
import { env } from "./env";

export const auth = createAuth({
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
});
