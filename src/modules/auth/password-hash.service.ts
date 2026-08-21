import { Inject, Injectable } from "@nestjs/common";
import * as argon2 from "argon2";
import { APP_CONFIG } from "../../config/config.module";
import type { ApiEnv } from "../../config/env";

/** Argon2id password hashing (adr/0006-email-password-auth.md "Token Encryption" sibling decision). */
@Injectable()
export class PasswordHashService {
  constructor(@Inject(APP_CONFIG) private readonly config: ApiEnv) {}

  hash(password: string): Promise<string> {
    return argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: this.config.PASSWORD_HASH_MEMORY_COST_KIB,
      timeCost: this.config.PASSWORD_HASH_TIME_COST,
      parallelism: this.config.PASSWORD_HASH_PARALLELISM,
    });
  }

  verify(hash: string, password: string): Promise<boolean> {
    return argon2.verify(hash, password);
  }
}
