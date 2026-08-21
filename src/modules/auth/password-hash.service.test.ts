import { describe, expect, it } from "vitest";
import type { ApiEnv } from "../../config/env";
import { PasswordHashService } from "./password-hash.service";

// Minimal cost so the suite stays fast — production values come from env defaults.
const config = {
  PASSWORD_HASH_MEMORY_COST_KIB: 1024,
  PASSWORD_HASH_TIME_COST: 1,
  PASSWORD_HASH_PARALLELISM: 1,
} as ApiEnv;

describe("PasswordHashService", () => {
  it("round-trips a password", async () => {
    const service = new PasswordHashService(config);
    const hash = await service.hash("correct horse battery staple");

    expect(hash).not.toContain("correct horse battery staple");
    await expect(service.verify(hash, "correct horse battery staple")).resolves.toBe(true);
  });

  it("rejects the wrong password", async () => {
    const service = new PasswordHashService(config);
    const hash = await service.hash("correct horse battery staple");

    await expect(service.verify(hash, "wrong password")).resolves.toBe(false);
  });
});
