/**
 * Workflow Pattern Phase 4 — Mirror of `EntityValidatorResponseModel` (server).
 *
 * Entity readiness validators are stored as DATA in the DB. Each validator
 * carries a predicate (DSL JSON) the UI evaluates client-side via
 * `PredicateEvaluator`. Status promotion runs the same DSL on the server
 * tier so client and server agree on completeness — see drift test.
 */
export interface EntityValidator {
  id: number;
  entityType: string;
  validatorId: string;
  /** Raw predicate JSON string from the DB. Parse before evaluating. */
  predicate: string;
  /**
   * Optional applicability check (DSL JSON). When non-null and the
   * predicate against the entity returns false, this validator is
   * treated as NOT applying to this record — the step's completionMap
   * skips it (treats the gate as satisfied since there's nothing to
   * gate on). Mirrors the server's EntityReadinessService applicability
   * filter so client + server agree on completeness.
   *
   * NULL (default) = always-applicable; preserves pre-applicability
   * behavior on every shipped validator.
   */
  applicabilityPredicate?: string | null;
  displayNameKey: string;
  missingMessageKey: string;
  isSeedData: boolean;
}
