import { zodToJsonSchema } from 'zod-to-json-schema';
// Import schemas directly (not via ./index.js) to avoid a circular import.
import { AuditEntrySchema } from './audit-entry.js';
import { DecisionSchema } from './decision.js';
import { PaymentFailedEventSchema } from './payment-failed-event.js';
import { ReplayEventSchema } from './replay-event.js';

export const CONTRACT_TITLE = 'HackGuard Contracts';
export const CONTRACT_VERSION = '0.1.0';

/**
 * Builds the OpenAPI 3.1 document whose component schemas are the frozen
 * HackGuard data contracts. Generated to packages/contracts/openapi.json by
 * `npm run generate -w @hackguard/contracts`; the Python sidecar generates
 * Pydantic models from that file (scripts/gen-pydantic.sh).
 */
export function buildOpenApiDocument() {
  const schemas = {
    PaymentFailedEvent: PaymentFailedEventSchema,
    Decision: DecisionSchema,
    AuditEntry: AuditEntrySchema,
    ReplayEvent: ReplayEventSchema,
  };

  const components: Record<string, unknown> = {};
  for (const [name, schema] of Object.entries(schemas)) {
    const result = zodToJsonSchema(schema, { name, target: 'openApi3' }) as {
      definitions?: Record<string, unknown>;
    };
    const jsonSchema = result.definitions?.[name];
    if (!jsonSchema) {
      throw new Error(`zodToJsonSchema produced no definition for ${name}`);
    }
    components[name] = jsonSchema;
  }

  return {
    openapi: '3.1.0',
    info: {
      title: CONTRACT_TITLE,
      version: CONTRACT_VERSION,
      description:
        'Single source of truth for HackGuard shared data contracts (plan §4). TS side: Zod schemas in @hackguard/contracts. Python side: Pydantic models generated from this document.',
    },
    components: { schemas: components },
  };
}
