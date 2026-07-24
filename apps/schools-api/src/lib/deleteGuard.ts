import type { Response } from "express";

export async function blockIfExists(
  res: Response,
  finder: () => Promise<unknown>,
  message: string,
): Promise<boolean> {
  const ref = await finder();

  if (ref) {
    res.status(409).json({ message });
    return true;
  }

  return false;
}
