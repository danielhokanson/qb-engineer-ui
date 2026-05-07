import {
  ChangeDetectionStrategy, Component, inject, input, output, signal,
} from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';

import { TextareaComponent } from '../../../../shared/components/textarea/textarea.component';
import { QualityService } from '../../../quality/services/quality.service';

type InspectStep = 'inspect' | 'submitting' | 'done';

@Component({
  selector: 'app-scan-inspect-flow',
  standalone: true,
  imports: [ReactiveFormsModule, TranslatePipe, TextareaComponent],
  templateUrl: './scan-inspect-flow.component.html',
  styleUrl: './scan-inspect-flow.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ScanInspectFlowComponent {
  private readonly qualityService = inject(QualityService);

  // Inputs
  readonly partId = input.required<number>();
  readonly partNumber = input.required<string>();
  readonly qcTemplateId = input<number | null>(null);

  // Outputs
  readonly completed = output<void>();
  readonly cancelled = output<void>();

  // State
  protected readonly step = signal<InspectStep>('inspect');
  protected readonly result = signal<'Pass' | 'Fail' | null>(null);
  protected readonly notesControl = new FormControl('');
  protected readonly submitting = signal(false);
  protected readonly error = signal<string | null>(null);

  protected setResult(value: 'Pass' | 'Fail'): void {
    this.result.set(value);
  }

  protected submitInspection(): void {
    const inspectionResult = this.result();
    if (!inspectionResult || this.submitting()) return;

    this.submitting.set(true);
    this.error.set(null);
    this.step.set('submitting');

    this.qualityService.createInspection({
      templateId: this.qcTemplateId() ?? undefined,
      notes: this.notesControl.value || undefined,
    }).subscribe({
      next: (inspection) => {
        // Update the inspection with the pass/fail result
        this.qualityService.updateInspection(inspection.id, {
          status: inspectionResult === 'Pass' ? 'Passed' : 'Failed',
          notes: this.notesControl.value || undefined,
        }).subscribe({
          next: () => {
            this.submitting.set(false);
            this.step.set('done');
            setTimeout(() => this.completed.emit(), 1500);
          },
          error: () => {
            this.submitting.set(false);
            this.step.set('inspect');
            this.error.set('Failed to update inspection result');
          },
        });
      },
      error: () => {
        this.submitting.set(false);
        this.step.set('inspect');
        this.error.set('Failed to create inspection');
      },
    });
  }

  protected cancel(): void {
    this.cancelled.emit();
  }
}
