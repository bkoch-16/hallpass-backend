import { timingSafeEqual, createHash } from "node:crypto";

export function constantTimeEquals(a: string, b: string): boolean {
  const hash = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(hash(a), hash(b));
}
