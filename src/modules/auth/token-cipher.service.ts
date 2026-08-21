import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { APP_CONFIG } from "../../config/config.module";
import type { ApiEnv } from "../../config/env";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

export interface EncryptedPayload {
  /** base64: iv || authTag || ciphertext */
  ciphertext: string;
  keyVersion: number;
}

/**
 * AES-256-GCM encryption for GitHub tokens at rest, keyed per-row by
 * `key_version` (AUTH_SERVICE_PLAN.md "Token Encryption"). Rotation adds
 * `TOKEN_ENCRYPTION_KEY_V2` and bumps `TOKEN_ENCRYPTION_ACTIVE_VERSION`;
 * old rows keep decrypting with their original key until re-wrapped.
 */
@Injectable()
export class TokenCipherService {
  private readonly keysByVersion = new Map<number, Buffer>();
  private readonly activeVersion: number;

  constructor(@Inject(APP_CONFIG) config: ApiEnv) {
    this.keysByVersion.set(1, deriveKey(config.TOKEN_ENCRYPTION_KEY_V1));
    if (config.TOKEN_ENCRYPTION_KEY_V2) {
      this.keysByVersion.set(2, deriveKey(config.TOKEN_ENCRYPTION_KEY_V2));
    }

    this.activeVersion = config.TOKEN_ENCRYPTION_ACTIVE_VERSION;
    if (!this.keysByVersion.has(this.activeVersion)) {
      throw new Error(
        `TOKEN_ENCRYPTION_ACTIVE_VERSION=${this.activeVersion} has no matching TOKEN_ENCRYPTION_KEY_V${this.activeVersion}`
      );
    }
  }

  encrypt(plaintext: string): EncryptedPayload {
    const key = this.keysByVersion.get(this.activeVersion);
    if (!key) {
      throw new Error(`No key configured for active version ${this.activeVersion}`);
    }

    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return {
      ciphertext: Buffer.concat([iv, authTag, encrypted]).toString("base64"),
      keyVersion: this.activeVersion,
    };
  }

  decrypt(payload: EncryptedPayload): string {
    const key = this.keysByVersion.get(payload.keyVersion);
    if (!key) {
      throw new Error(`No encryption key configured for version ${payload.keyVersion}`);
    }

    const packed = Buffer.from(payload.ciphertext, "base64");
    const iv = packed.subarray(0, IV_LENGTH);
    const authTag = packed.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const encrypted = packed.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  }
}

/** `openssl rand -base64 32` yields 32 raw bytes once decoded — AES-256's exact key size. Anything else is hashed down to 32 bytes so a misconfigured secret still behaves deterministically rather than crashing the cipher. */
function deriveKey(secret: string): Buffer {
  const decoded = Buffer.from(secret, "base64");
  return decoded.length === 32 ? decoded : createHash("sha256").update(secret).digest();
}
