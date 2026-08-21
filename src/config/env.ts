import { z } from "zod";
import { backendBaseEnvShape, loadEnv, portSchema, urlSchema } from "@aca/config";

/** .env stores PEM keys with literal `\n` escapes (LOCAL_SETUP.md step 7); turn them back into real newlines. */
const pemKey = z
  .string()
  .min(1)
  .transform((value) => value.replace(/\\n/g, "\n"));

const ApiEnvSchema = z.object({
  ...backendBaseEnvShape,
  PORT: portSchema.default(3000),
  API_DATABASE_URL: urlSchema,

  PUBLIC_APP_URL: urlSchema,

  GITHUB_APP_CLIENT_ID: z.string().min(1),
  GITHUB_APP_CLIENT_SECRET: z.string().min(1),
  GITHUB_CALLBACK_URL: urlSchema,
  GITHUB_API_BASE_URL: urlSchema.default("https://api.github.com"),

  JWT_ACCESS_PRIVATE_KEY: pemKey,
  JWT_ACCESS_PUBLIC_KEY: pemKey,
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),

  REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(2_592_000),

  TOKEN_ENCRYPTION_KEY_V1: z.string().min(32),
  TOKEN_ENCRYPTION_KEY_V2: z.string().min(32).optional(),
  TOKEN_ENCRYPTION_ACTIVE_VERSION: z.coerce.number().int().positive().default(1),

  TOKEN_REFRESH_MARGIN_SECONDS: z.coerce.number().int().positive().default(300),
  OAUTH_STATE_TTL_SECONDS: z.coerce.number().int().positive().default(600),

  // SCOPE_LIMITS.md "Rate Limits".
  RATE_LIMIT_REFRESH_PER_MINUTE: z.coerce.number().int().positive().default(10),
  // Not yet named in SCOPE_LIMITS.md; follows the same per-minute pattern as
  // the other auth-adjacent limit until a dedicated entry is added there.
  RATE_LIMIT_INTERNAL_GITHUB_TOKEN_PER_MINUTE: z.coerce.number().int().positive().default(30),

  // adr/0006-email-password-auth.md
  PASSWORD_HASH_MEMORY_COST_KIB: z.coerce.number().int().positive().default(19_456),
  PASSWORD_HASH_TIME_COST: z.coerce.number().int().positive().default(2),
  PASSWORD_HASH_PARALLELISM: z.coerce.number().int().positive().default(1),
  EMAIL_VERIFICATION_TTL_SECONDS: z.coerce.number().int().positive().default(86_400),
  PASSWORD_RESET_TTL_SECONDS: z.coerce.number().int().positive().default(3_600),
  LOGIN_LOCKOUT_THRESHOLD: z.coerce.number().int().positive().default(5),
  LOGIN_LOCKOUT_DURATION_SECONDS: z.coerce.number().int().positive().default(900),
  RATE_LIMIT_LOGIN_PER_MINUTE: z.coerce.number().int().positive().default(10),
  RATE_LIMIT_SIGNUP_PER_HOUR: z.coerce.number().int().positive().default(5),
  RATE_LIMIT_FORGOT_PASSWORD_PER_HOUR: z.coerce.number().int().positive().default(5),

  // API_GATEWAY_SERVICE_PLAN.md
  INDEXER_SERVICE_URL: urlSchema,
  RATE_LIMIT_IMPORT_PER_HOUR: z.coerce.number().int().positive().default(5),
  OWNERSHIP_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(60),
  SSE_HEARTBEAT_SECONDS: z.coerce.number().int().positive().default(15),
});

export type ApiEnv = z.infer<typeof ApiEnvSchema>;

export function loadApiEnv(): ApiEnv {
  return loadEnv(ApiEnvSchema);
}
