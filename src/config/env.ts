import { z } from "zod";
import { backendBaseEnvShape, loadEnv, portSchema, urlSchema } from "@aca/config";

const ApiEnvSchema = z.object({
  ...backendBaseEnvShape,
  PORT: portSchema.default(3000),
  API_DATABASE_URL: urlSchema,
});

export type ApiEnv = z.infer<typeof ApiEnvSchema>;

export function loadApiEnv(): ApiEnv {
  return loadEnv(ApiEnvSchema);
}
