import { randomInt } from "node:crypto";
import { UserRole } from "@hallpass/types";
import { isPrismaError } from "@hallpass/express-middleware";

// Students are looked up by PIN by the external parent voice tool, so every
// student needs a unique pinCode. Six digits with no leading zero keeps it
// unambiguous when read aloud or entered on a keypad.
export function generatePinCode(): string {
  return String(randomInt(100_000, 1_000_000));
}

const MAX_PIN_ATTEMPTS = 5;

// Runs `create` with a freshly generated pinCode for STUDENTs, retrying on the
// (astronomically rare) pinCode collision. Non-student roles get no pin and run
// `create(undefined)` once. Any non-pin error — including an email conflict —
// propagates to the caller unchanged.
export async function createUserWithPin<T>(
  role: UserRole,
  create: (pinCode: string | undefined) => Promise<T>,
): Promise<T> {
  if (role !== UserRole.STUDENT) {
    return create(undefined);
  }
  for (let attempt = 0; attempt < MAX_PIN_ATTEMPTS; attempt++) {
    try {
      return await create(generatePinCode());
    } catch (err) {
      // A pinCode collision on the User_pinCode_key unique index surfaces as a
      // P2002 with pinCode in meta.target. Distinguish it from an email
      // collision so we retry only pin generation and never mask an email conflict.
      if (isPrismaError(err, "P2002", "pinCode")) {
        continue;
      }
      throw err;
    }
  }
  throw new Error("Unable to allocate a unique pinCode after multiple attempts");
}
