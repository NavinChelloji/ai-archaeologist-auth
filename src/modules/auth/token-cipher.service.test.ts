import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ApiEnv } from "../../config/env";
import { TokenCipherService } from "./token-cipher.service";

function fakeConfig(overrides: Partial<ApiEnv> = {}): ApiEnv {
  return {
    TOKEN_ENCRYPTION_KEY_V1: randomBytes(32).toString("base64"),
    TOKEN_ENCRYPTION_ACTIVE_VERSION: 1,
    ...overrides,
  } as ApiEnv;
}

describe("TokenCipherService", () => {
  it("round-trips a plaintext GitHub token", () => {
    const cipher = new TokenCipherService(fakeConfig());
    const encrypted = cipher.encrypt("gho_super_secret_token");

    expect(encrypted.keyVersion).toBe(1);
    expect(encrypted.ciphertext).not.toContain("gho_super_secret_token");
    expect(cipher.decrypt(encrypted)).toBe("gho_super_secret_token");
  });

  it("supports a second key version: new rows use it, old rows still decrypt with v1", () => {
    const keyV1 = randomBytes(32).toString("base64");
    const keyV2 = randomBytes(32).toString("base64");

    const cipherV1Active = new TokenCipherService(
      fakeConfig({ TOKEN_ENCRYPTION_KEY_V1: keyV1, TOKEN_ENCRYPTION_ACTIVE_VERSION: 1 })
    );
    const oldRow = cipherV1Active.encrypt("token-encrypted-before-rotation");

    const cipherV2Active = new TokenCipherService(
      fakeConfig({
        TOKEN_ENCRYPTION_KEY_V1: keyV1,
        TOKEN_ENCRYPTION_KEY_V2: keyV2,
        TOKEN_ENCRYPTION_ACTIVE_VERSION: 2,
      })
    );
    const newRow = cipherV2Active.encrypt("token-encrypted-after-rotation");

    expect(newRow.keyVersion).toBe(2);
    expect(cipherV2Active.decrypt(newRow)).toBe("token-encrypted-after-rotation");
    // the post-rotation service can still decrypt a row encrypted under v1
    expect(cipherV2Active.decrypt(oldRow)).toBe("token-encrypted-before-rotation");
  });

  it("fails fast at construction when the active version has no matching key", () => {
    expect(() => new TokenCipherService(fakeConfig({ TOKEN_ENCRYPTION_ACTIVE_VERSION: 2 }))).toThrow(
      /TOKEN_ENCRYPTION_ACTIVE_VERSION/
    );
  });

  it("rejects decryption with the wrong key version", () => {
    const cipher = new TokenCipherService(fakeConfig());
    const encrypted = cipher.encrypt("token");

    expect(() => cipher.decrypt({ ...encrypted, keyVersion: 99 })).toThrow(/No encryption key configured/);
  });
});
