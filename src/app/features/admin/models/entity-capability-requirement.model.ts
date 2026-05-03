/**
 * Wire shape for one capability-requirement row, returned by the admin
 * list / get endpoints under `/api/v1/admin/entity-capability-requirements`.
 * Mirrors the server-side `EntityCapabilityRequirementResponseModel`.
 *
 * The `predicate` field is the raw JSON predicate the server evaluates
 * against the entity (e.g. `{ "type": "fieldPresent", "field": "taxId" }`);
 * the admin UI surfaces it as a textarea.
 */
export interface EntityCapabilityRequirementResponseModel {
  id: number;
  entityType: string;
  capabilityCode: string;
  requirementId: string;
  predicate: string;
  displayNameKey: string;
  missingMessageKey: string;
  sortOrder: number;
  isSeedData: boolean;
}

/**
 * Wire shape for create / update of one capability-requirement row.
 * Mirrors the server-side `UpsertEntityCapabilityRequirementRequestModel`.
 */
export interface UpsertEntityCapabilityRequirementRequestModel {
  entityType: string;
  capabilityCode: string;
  requirementId: string;
  predicate: string;
  displayNameKey: string;
  missingMessageKey: string;
  sortOrder: number;
}
