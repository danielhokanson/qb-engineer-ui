import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';

import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { PurchaseOrderService } from '../../services/purchase-order.service';
import { UpdateAutoPoSettingsRequest } from '../../models/auto-po-settings.model';
import { InputComponent } from '../../../../shared/components/input/input.component';
import { SelectComponent, SelectOption } from '../../../../shared/components/select/select.component';
import { ToggleComponent } from '../../../../shared/components/toggle/toggle.component';
import { ValidationButtonComponent } from '../../../../shared/components/validation-button/validation-button.component';
import { LoadingBlockDirective } from '../../../../shared/directives/loading-block.directive';
import { FormValidationService } from '../../../../shared/services/form-validation.service';
import { SnackbarService } from '../../../../shared/services/snackbar.service';

@Component({
  selector: 'app-auto-po-settings-panel',
  standalone: true,
  imports: [
    ReactiveFormsModule, TranslatePipe,
    InputComponent, SelectComponent, ToggleComponent,
    ValidationButtonComponent, LoadingBlockDirective,
  ],
  templateUrl: './auto-po-settings-panel.component.html',
  styleUrl: './auto-po-settings-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AutoPoSettingsPanelComponent {
  private readonly poService = inject(PurchaseOrderService);
  private readonly snackbar = inject(SnackbarService);
  private readonly translate = inject(TranslateService);

  protected readonly loading = signal(false);
  protected readonly saving = signal(false);

  protected readonly form = new FormGroup({
    enabled: new FormControl(false, { nonNullable: true }),
    defaultMode: new FormControl('Suggest', { nonNullable: true, validators: [Validators.required] }),
    bufferDays: new FormControl(0, { nonNullable: true, validators: [Validators.required, Validators.min(0), Validators.max(365)] }),
    notifyChat: new FormControl(false, { nonNullable: true }),
  });

  protected readonly modeOptions: SelectOption[] = [
    { value: 'Suggest', label: this.translate.instant('autoPo.modeSuggest') || 'Suggest' },
    { value: 'Draft', label: this.translate.instant('autoPo.modeDraft') || 'Draft' },
    { value: 'Automatic', label: this.translate.instant('autoPo.modeAutomatic') || 'Automatic' },
  ];

  protected readonly violations = FormValidationService.getViolations(this.form, {
    defaultMode: this.translate.instant('autoPo.defaultMode') || 'Default Mode',
    bufferDays: this.translate.instant('autoPo.bufferDays') || 'Buffer Days',
  });

  constructor() {
    this.loadSettings();
  }

  private loadSettings(): void {
    this.loading.set(true);
    this.poService.getAutoPoSettings().subscribe({
      next: (settings) => {
        this.form.patchValue({
          enabled: settings.enabled,
          defaultMode: settings.defaultMode,
          bufferDays: settings.bufferDays,
          notifyChat: settings.notifyChat,
        });
        this.form.markAsPristine();
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  protected save(): void {
    if (this.form.invalid || this.saving()) return;

    this.saving.set(true);
    const request: UpdateAutoPoSettingsRequest = {
      enabled: this.form.value.enabled,
      defaultMode: this.form.value.defaultMode,
      bufferDays: this.form.value.bufferDays,
      notifyChat: this.form.value.notifyChat,
    };

    this.poService.updateAutoPoSettings(request).subscribe({
      next: () => {
        this.snackbar.success(this.translate.instant('autoPo.settingsSaved') || 'Auto-PO settings saved');
        this.saving.set(false);
        this.form.markAsPristine();
      },
      error: () => this.saving.set(false),
    });
  }
}
