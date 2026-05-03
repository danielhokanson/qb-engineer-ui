/**
 * Wire shape for the per-entity completeness response from
 * `GET /api/v1/entities/{entityType}/{entityId}/completeness`. Mirrors the
 * server-side `EntityCompletenessResponseModel`.
 *
 * Items where `ok === false` count as "incomplete for that capability".
 * `EntityCompletenessChipComponent` and `EntityCompletenessBadgeComponent`
 * surface the counts and per-capability missing-field breakdown via the
 * popover.
 */
export interface EntityCompleteness {
  entityType: string;
  entityId: number;
  capabilities: EntityCompletenessCapability[];
}

export interface EntityCompletenessCapability {
  capabilityCode: string;
  capabilityName: string;
  ok: boolean;
  missingFields: EntityCompletenessMissingField[];
}

export interface EntityCompletenessMissingField {
  requirementId: string;
  /** i18n key — short label rendered in the popover row. */
  displayNameKey: string;
  /** i18n key — fuller explanation. */
  missingMessageKey: string;
}
