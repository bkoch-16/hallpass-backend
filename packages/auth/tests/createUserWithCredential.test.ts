import { describe, it, expect, vi } from "vitest";
import { createUserWithCredential, EmailInUseError } from "../src/index.js";
import type { Auth } from "../src/index.js";

function fakeAuth(overrides: {
  findUserByEmail?: ReturnType<typeof vi.fn>;
  createUser?: ReturnType<typeof vi.fn>;
  linkAccount?: ReturnType<typeof vi.fn>;
  deleteUser?: ReturnType<typeof vi.fn>;
} = {}): Auth {
  const internalAdapter = {
    findUserByEmail: overrides.findUserByEmail ?? vi.fn().mockResolvedValue(null),
    createUser: overrides.createUser ?? vi.fn().mockResolvedValue({ id: "1", email: "a@test.com", name: "A" }),
    linkAccount: overrides.linkAccount ?? vi.fn().mockResolvedValue({}),
    deleteUser: overrides.deleteUser ?? vi.fn().mockResolvedValue(undefined),
  };
  const password = { hash: vi.fn().mockResolvedValue("hashed") };
  return { $context: Promise.resolve({ internalAdapter, password }) } as unknown as Auth;
}

describe("createUserWithCredential", () => {
  it("creates a user and links a credential account", async () => {
    const auth = fakeAuth();

    const result = await createUserWithCredential(auth, { email: "A@Test.com", password: "pw", name: "A" });

    expect(result.id).toBe(1);
  });

  it("throws EmailInUseError when the email already exists", async () => {
    const auth = fakeAuth({ findUserByEmail: vi.fn().mockResolvedValue({ user: {}, accounts: [] }) });

    await expect(
      createUserWithCredential(auth, { email: "a@test.com", password: "pw", name: "A" }),
    ).rejects.toThrow(EmailInUseError);
  });

  it("rolls back the created user when linkAccount fails", async () => {
    const deleteUser = vi.fn().mockResolvedValue(undefined);
    const auth = fakeAuth({
      createUser: vi.fn().mockResolvedValue({ id: "5", email: "a@test.com", name: "A" }),
      linkAccount: vi.fn().mockRejectedValue(new Error("db down")),
      deleteUser,
    });

    await expect(
      createUserWithCredential(auth, { email: "a@test.com", password: "pw", name: "A" }),
    ).rejects.toThrow("db down");
    expect(deleteUser).toHaveBeenCalledWith("5");
  });

  it("surfaces both errors when the rollback also fails", async () => {
    const auth = fakeAuth({
      createUser: vi.fn().mockResolvedValue({ id: "5", email: "a@test.com", name: "A" }),
      linkAccount: vi.fn().mockRejectedValue(new Error("db down")),
      deleteUser: vi.fn().mockRejectedValue(new Error("cleanup failed")),
    });

    await expect(
      createUserWithCredential(auth, { email: "a@test.com", password: "pw", name: "A" }),
    ).rejects.toThrow(AggregateError);
  });
});
