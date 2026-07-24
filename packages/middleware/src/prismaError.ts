export function isPrismaError(err: unknown, code: string, target?: string): boolean {
  if (!err || typeof err !== "object" || (err as { code?: unknown }).code !== code) {
    return false;
  }
  if (target === undefined) {
    return true;
  }
  const metaTarget = (err as { meta?: { target?: unknown } }).meta?.target;
  return Array.isArray(metaTarget) ? metaTarget.includes(target) : metaTarget === target;
}
