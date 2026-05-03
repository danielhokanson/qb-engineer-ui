import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject, input, signal, viewChild } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { Observable, of, switchMap, tap } from 'rxjs';

import { EntityPickerComponent } from '../../../../shared/components/entity-picker/entity-picker.component';
import { LoadingBlockDirective } from '../../../../shared/directives/loading-block.directive';
import { SnackbarService } from '../../../../shared/services/snackbar.service';
import { WorkflowService } from '../../../../shared/services/workflow.service';
import { PartDetail } from '../../models/part-detail.model';
import { PartsService } from '../../services/parts.service';
import { VendorQuickCreateDialogComponent, VendorQuickCreateDialogData } from '../../../vendors/components/vendor-quick-create-dialog/vendor-quick-create-dialog.component';
import { VendorListItem } from '../../../vendors/models/vendor-list-item.model';

/**
 * Vendor step — used by Subcontract combos (S1 / S2) to pick the
 * subcontract vendor that performs the operation. Lead time + per-vendor
 * terms live on the VendorPart row entered in the subsequent VendorParts
 * step; this step's only output is <c>preferredVendorId</c> on the Part.
 *
 * Save model: explicit save-on-Continue (registered with WorkflowService).
 */
@Component({
  selector: 'app-part-vendor-step',
  standalone: true,
  imports: [
    ReactiveFormsModule, TranslatePipe,
    EntityPickerComponent, LoadingBlockDirective,
  ],
  templateUrl: './part-vendor-step.component.html',
  styleUrl: './part-vendor-step.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PartVendorStepComponent {
  private readonly partsService = inject(PartsService);
  private readonly workflowService = inject(WorkflowService);
  private readonly snackbar = inject(SnackbarService);
  private readonly translate = inject(TranslateService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly matDialog = inject(MatDialog);

  readonly stepId = input<string>('vendor');
  readonly componentName = input<string>('PartVendorStepComponent');
  readonly runId = input<number | null>(null);
  readonly entityId = input<number | null>(null);
  readonly entity = input<unknown>(null);

  protected readonly saving = signal(false);

  protected readonly form = new FormGroup({
    preferredVendorId: new FormControl<number | null>(null),
  });

  /** The (only) entity-picker on this step. */
  private readonly vendorPicker = viewChild(EntityPickerComponent);

  /**
   * Inline-create vendor — opens VendorQuickCreateDialog pre-filled with
   * whatever the user typed in the picker, then on success drops the new
   * vendor's id into the form and the picker via setSelected().
   */
  protected onCreateNewVendor(typedTerm: string): void {
    this.matDialog.open<VendorQuickCreateDialogComponent, VendorQuickCreateDialogData, VendorListItem | null>(
      VendorQuickCreateDialogComponent,
      { width: '420px', data: { initialCompanyName: typedTerm } },
    ).afterClosed().subscribe((created) => {
      if (!created) return;
      this.form.controls.preferredVendorId.setValue(created.id);
      this.form.markAsDirty();
      this.vendorPicker()?.setSelected(created.id, created.companyName);
    });
  }

  constructor() {
    effect(() => {
      const part = this.entity() as PartDetail | null;
      if (!part) return;
      this.form.patchValue({
        preferredVendorId: part.preferredVendorId ?? null,
      }, { emitEvent: false });
    });

    this.workflowService.registerStepForm(
      this.form,
      {
        preferredVendorId: this.translate.instant('parts.workflow.vendor.preferredVendorLabel'),
      },
      () => this.save(),
    );
    this.destroyRef.onDestroy(() => this.workflowService.unregisterStepForm());
  }

  private save(): Observable<unknown> {
    const runId = this.runId();
    if (runId == null) return of(null);
    if (this.form.pristine) return of(null);
    const value = this.form.getRawValue();
    this.saving.set(true);
    return this.workflowService.patchStep(runId, this.stepId(), {
      preferredVendorId: value.preferredVendorId ?? null,
    }).pipe(
      switchMap((run) => {
        if (run.entityId == null) return of(null);
        return this.partsService.getPartById(run.entityId).pipe(
          tap((detail) => this.workflowService.currentEntity.set(detail)),
        );
      }),
      tap({
        next: () => {
          this.saving.set(false);
          this.form.markAsPristine();
        },
        error: () => {
          this.saving.set(false);
          this.snackbar.error(this.translate.instant('parts.workflow.vendor.saveFailed'));
        },
      }),
    );
  }
}
