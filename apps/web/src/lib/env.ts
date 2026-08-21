import { z } from 'zod';

/**
 * Env-driven web configuration. Fails fast at first access when required env
 * vars are missing. Copy .env.example to .env.local for local development.
 */
const EnvSchema = z.object({
  SCORING_BASE_URL: z.string().url().default('http://localhost:8000'),
  STRIPE_WEBHOOK_SECRET: z.string().min(1),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

export function getEnv(): Env {
  cached ??= EnvSchema.parse({
    SCORING_BASE_URL: process.env.SCORING_BASE_URL,
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
  });
  return cached;
}
