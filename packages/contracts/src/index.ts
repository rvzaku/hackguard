/**
 * @hackguard/contracts — single source of truth for HackGuard's shared data
 * contracts (plan §4). The OpenAPI document (openapi.json) is generated from
 * these Zod schemas and is the frozen boundary consumed by the Python scoring
 * sidecar (Pydantic models generated via scripts/gen-pydantic.sh).
 */
export { PaymentFailedEventSchema, type PaymentFailedEvent } from './payment-failed-event.js';
export {
  DecisionSchema,
  RetryActionSchema,
  ShapContributionSchema,
  type Decision,
  type RetryAction,
  type ShapContribution,
} from './decision.js';
export { AuditEntrySchema, AuditActorSchema, type AuditEntry, type AuditActor } from './audit-entry.js';
export {
  ReplayEventSchema,
  ReplayEventKindSchema,
  type ReplayEvent,
  type ReplayEventKind,
} from './replay-event.js';
export { CONTRACT_TITLE, CONTRACT_VERSION } from './openapi.js';
export { buildOpenApiDocument } from './openapi.js';
