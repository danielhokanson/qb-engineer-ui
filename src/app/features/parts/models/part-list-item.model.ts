import { WorkflowRun } from '../../../shared/models/workflow-run.model';
import { InventoryClass } from './inventory-class.type';
import { PartStatus } from './part-status.type';
import { ProcurementSource } from './procurement-source.type';

/**
 * Compact in-progress workflow summary embedded on list rows. Drives the
 * "resume workflow" indicator. Null on the part means no draft in flight.
 */
export interface PendingWorkflowSummary {
  runId: number;
  definitionId: string;
  currentStepId: string | null;
  mode: 'guided' | 'express';
  lastActivityAt: string;
}

export interface PartListItem {
  id: number;
  partNumber: string;
  /** Short canonical identifier (required). Primary list column. */
  name: string;
  /** Long-form notes (optional). Shown only when present. */
  description: string | null;
  revision: string;
  status: PartStatus;
  // Pillar 1 — three orthogonal axes (legacy single-axis partType retired pre-beta).
  procurementSource: ProcurementSource;
  inventoryClass: InventoryClass;
  bomEntryCount: number;
  createdAt: Date;
  /**
   * Effective sales price as resolved server-side via IPartPricingResolver.
   * Always present; <code>0</code> when {@link effectivePriceSource} is "Default".
   */
  effectivePrice: number;
  effectivePriceCurrency: string;
  effectivePriceSource: 'PriceListEntry' | 'PartPrice' | 'VendorPartTier' | 'Default';
  /**
   * Non-null when an in-progress workflow run exists for this part.
   * The parts list shows a row-level indicator + resume affordance.
   */
  pendingWorkflow?: PendingWorkflowSummary | null;
}

/**
 * Row type for the parts table. Carries either a real {@link PartListItem}
 * (no `_draftRun`) or a synthetic ghost-row representing an entity-less
 * workflow draft (`_draftRun` is the WorkflowRun the draft tracks). Ghost
 * rows render at the top of the table, color-coded, with a click that
 * resumes the workflow instead of opening detail.
 */
export interface PartListRow extends PartListItem {
  _draftRun?: WorkflowRun;
}
