import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, OnInit, output, signal } from '@angular/core';
import { ReactiveFormsModule, FormControl } from '@angular/forms';
import { debounceTime, distinctUntilChanged, filter, switchMap } from 'rxjs';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { TimeTrackingService } from '../../time-tracking/services/time-tracking.service';
import { AvatarComponent } from '../../../shared/components/avatar/avatar.component';
import { FileUploadZoneComponent, UploadedFile } from '../../../shared/components/file-upload-zone/file-upload-zone.component';
import { InputComponent } from '../../../shared/components/input/input.component';
import { SelectComponent } from '../../../shared/components/select/select.component';
import { EntityActivitySectionComponent } from '../../../shared/components/entity-activity-section/entity-activity-section.component';
import { FileAttachment } from '../../../shared/models/file.model';
import { SnackbarService } from '../../../shared/services/snackbar.service';
import { MatDialog } from '@angular/material/dialog';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TimeEntry } from '../../time-tracking/models/time-entry.model';
import { KanbanService } from '../services/kanban.service';
import { DisposeJobDialogComponent, DisposeJobDialogData } from './dispose-job-dialog.component';
import { UserRef } from '../models/user-ref.model';
import { JobDetail } from '../models/job-detail.model';
import { JobBomAtRelease } from '../../parts/models/bom-revision.model';
import { Subtask } from '../models/subtask.model';
import { JobLink } from '../models/job-link.model';
import { KanbanJob } from '../models/kanban-job.model';
import { PRIORITY_COLORS } from '../models/priority-colors.const';
import { LINK_TYPE_OPTIONS } from '../models/link-type-options.const';
import { LINK_TYPE_ICONS } from '../models/link-type-icons.const';
import { LINK_TYPE_LABELS } from '../models/link-type-labels.const';
import { JobPart } from '../models/job-part.model';
import { EntityLinkComponent } from '../../../shared/components/entity-link/entity-link.component';
import { PartSearchResult } from '../models/part-search-result.model';
import { ChildJob } from '../models/child-job.model';
import { Stage } from '../../../shared/models/stage.model';
import { ConfirmDialogComponent, ConfirmDialogData } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { StatusTimelineComponent } from '../../../shared/components/status-timeline/status-timeline.component';
import { BarcodeInfoComponent } from '../../../shared/components/barcode-info/barcode-info.component';
import { CoverPhotoUploadDialogComponent, CoverPhotoDialogData } from './cover-photo-upload-dialog.component';
import { JobCostTabComponent } from './job-cost-tab.component';
import { OperationTimeTabComponent } from './operation-time-tab.component';

@Component({
  selector: 'app-job-detail-panel',
  standalone: true,
  imports: [DatePipe, ReactiveFormsModule, TranslatePipe, AvatarComponent, FileUploadZoneComponent, InputComponent, SelectComponent, EntityActivitySectionComponent, StatusTimelineComponent, BarcodeInfoComponent, JobCostTabComponent, OperationTimeTabComponent, MatMenuModule, MatTooltipModule, EntityLinkComponent],
  templateUrl: './job-detail-panel.component.html',
  styleUrl: './job-detail-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class JobDetailPanelComponent implements OnInit {
  private readonly kanbanService = inject(KanbanService);
  private readonly timeTrackingService = inject(TimeTrackingService);
  private readonly snackbar = inject(SnackbarService);
  private readonly matDialog = inject(MatDialog);
  private readonly translate = inject(TranslateService);

  readonly jobId = input.required<number>();
  readonly users = input<UserRef[]>([]);
  readonly closed = output<void>();
  readonly editRequested = output<JobDetail>();

  protected readonly job = signal<JobDetail | null>(null);
  protected readonly subtasks = signal<Subtask[]>([]);
  protected readonly links = signal<JobLink[]>([]);
  protected readonly files = signal<FileAttachment[]>([]);
  protected readonly timeEntries = signal<TimeEntry[]>([]);
  protected readonly loading = signal(true);
  // Phase 3 H4 / WU-20 — BOM revision the job was released against, plus
  // the staleness flag (true if the part's BOM has advanced since).
  protected readonly bomAtRelease = signal<JobBomAtRelease | null>(null);
  protected readonly newSubtaskControl = new FormControl('');

  // Link add form
  protected readonly linkSearchControl = new FormControl('');
  protected readonly linkTypeControl = new FormControl('RelatedTo');
  protected readonly linkTypeOptions = LINK_TYPE_OPTIONS;
  protected readonly linkTypeIcons = LINK_TYPE_ICONS;
  protected readonly linkTypeLabels = LINK_TYPE_LABELS;
  protected readonly linkSearchResults = signal<KanbanJob[]>([]);
  protected readonly selectedLinkTarget = signal<KanbanJob | null>(null);
  protected readonly showLinkResults = signal(false);

  // Child jobs
  protected readonly childJobs = signal<ChildJob[]>([]);

  // Part add form
  protected readonly jobParts = signal<JobPart[]>([]);
  protected readonly partSearchControl = new FormControl('');
  protected readonly partSearchResults = signal<PartSearchResult[]>([]);
  protected readonly selectedPart = signal<PartSearchResult | null>(null);
  protected readonly showPartResults = signal(false);

  // Activity (delegated to shared EntityActivitySectionComponent)

  // Stage move
  protected readonly availableStages = signal<Stage[]>([]);

  protected readonly isTimerLoading = signal(false);

  protected readonly hasActiveTimer = computed(() =>
    this.timeEntries().some(e => e.timerStart !== null && e.timerStop === null),
  );

  protected readonly totalTimeMinutes = computed(() =>
    this.timeEntries().reduce((sum, e) => sum + e.durationMinutes, 0),
  );

  protected readonly formattedTotalTime = computed(() => {
    const mins = this.totalTimeMinutes();
    if (mins === 0) return '0h';
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
  });


  ngOnInit(): void {
    const id = this.jobId();
    this.kanbanService.getJobDetail(id).subscribe(detail => {
      this.job.set(detail);
      this.loading.set(false);
      if (detail.childJobCount > 0) {
        this.kanbanService.getChildJobs(id).subscribe(children => this.childJobs.set(children));
      }
      // Phase 3 H4 / WU-20 — fetch the BOM-at-release pin once we know the
      // job has a part associated. Endpoint always answers 200 (with
      // bomRevisionId === null) when nothing is pinned, so we can safely
      // call regardless and handle the null case in the template.
      this.kanbanService.getJobBomAtRelease(id).subscribe({
        next: (snap) => this.bomAtRelease.set(snap),
        error: () => this.bomAtRelease.set(null),
      });
      // Load available stages for this track type
      this.kanbanService.getTrackTypes().subscribe(types => {
        const tt = types.find(t => t.id === detail.trackTypeId);
        if (tt) {
          this.availableStages.set([...tt.stages].sort((a, b) => a.sortOrder - b.sortOrder));
        }
      });
    });
    this.kanbanService.getSubtasks(id).subscribe(s => this.subtasks.set(s));
    this.kanbanService.getJobLinks(id).subscribe(l => this.links.set(l));
    this.kanbanService.getJobFiles(id).subscribe(f => this.files.set(f));
    this.kanbanService.getJobTimeEntries(id).subscribe(t => this.timeEntries.set(t));
    this.kanbanService.getJobParts(id).subscribe(p => this.jobParts.set(p));

    this.partSearchControl.valueChanges.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      filter(v => (v?.length ?? 0) >= 2),
      switchMap(term => this.kanbanService.searchParts(term!)),
    ).subscribe(results => {
      const linkedPartIds = new Set(this.jobParts().map(jp => jp.partId));
      this.partSearchResults.set(
        results.filter(p => !linkedPartIds.has(p.id)).slice(0, 8)
      );
      this.showPartResults.set(true);
    });

    this.linkSearchControl.valueChanges.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      filter(v => (v?.length ?? 0) >= 2),
      switchMap(term => this.kanbanService.searchJobs(term!)),
    ).subscribe(results => {
      // Exclude the current job and already-linked jobs
      const currentId = this.jobId();
      const linkedIds = new Set(this.links().map(l => l.linkedJobId));
      this.linkSearchResults.set(
        results.filter(j => j.id !== currentId && !linkedIds.has(j.id)).slice(0, 8)
      );
      this.showLinkResults.set(true);
    });
  }

  protected priorityColor(priority: string): string {
    return PRIORITY_COLORS[priority] ?? PRIORITY_COLORS['Normal'];
  }


  protected completedCount(): number {
    return this.subtasks().filter(s => s.isCompleted).length;
  }

  protected toggleSubtask(subtask: Subtask): void {
    const newState = !subtask.isCompleted;
    subtask.isCompleted = newState;
    subtask.completedAt = newState ? new Date() : null;
    this.subtasks.update(list => [...list]);
    this.kanbanService.toggleSubtask(this.jobId(), subtask.id, newState).subscribe();
  }

  protected addSubtask(): void {
    const text = (this.newSubtaskControl.value ?? '').trim();
    if (!text) return;
    this.kanbanService.addSubtask(this.jobId(), text).subscribe(st => {
      this.subtasks.update(list => [...list, st]);
      this.newSubtaskControl.reset();
      this.snackbar.success(this.translate.instant('kanban.subtaskAdded'));
    });
  }

  protected selectLinkTarget(job: KanbanJob): void {
    this.selectedLinkTarget.set(job);
    this.linkSearchControl.setValue(job.jobNumber + ' — ' + job.title, { emitEvent: false });
    this.showLinkResults.set(false);
  }

  protected addLink(): void {
    const target = this.selectedLinkTarget();
    const linkType = this.linkTypeControl.value ?? 'RelatedTo';
    if (!target) return;

    this.kanbanService.createJobLink(this.jobId(), target.id, linkType).subscribe(link => {
      this.links.update(list => [...list, link]);
      this.selectedLinkTarget.set(null);
      this.linkSearchControl.reset();
      this.linkTypeControl.setValue('RelatedTo');
      this.snackbar.success(this.translate.instant('kanban.linkAdded'));
    });
  }

  protected deleteLink(link: JobLink): void {
    this.kanbanService.deleteJobLink(this.jobId(), link.id).subscribe(() => {
      this.links.update(list => list.filter(l => l.id !== link.id));
      this.snackbar.success(this.translate.instant('kanban.linkRemoved'));
    });
  }

  protected dismissLinkResults(): void {
    // Small delay to allow click on result
    setTimeout(() => this.showLinkResults.set(false), 200);
  }


  protected onFileUploaded(_file: UploadedFile): void {
    this.kanbanService.getJobFiles(this.jobId()).subscribe(f => {
      this.files.set(f);
      this.snackbar.success(this.translate.instant('kanban.fileUploaded'));
    });
  }

  protected deleteFile(file: FileAttachment): void {
    this.kanbanService.deleteJobFile(file.id).subscribe(() => {
      this.files.update(list => list.filter(f => f.id !== file.id));
      this.snackbar.success(this.translate.instant('kanban.fileDeleted'));
    });
  }

  protected downloadFile(file: FileAttachment): void {
    window.open(this.kanbanService.downloadFileUrl(file.id), '_blank');
  }

  protected formatFileSize(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  protected fileIcon(contentType: string): string {
    if (contentType.startsWith('image/')) return 'image';
    if (contentType.includes('pdf')) return 'picture_as_pdf';
    if (contentType.includes('spreadsheet') || contentType.includes('excel')) return 'table_chart';
    if (contentType.includes('word') || contentType.includes('document')) return 'description';
    return 'attach_file';
  }

  protected formatDuration(minutes: number): string {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
  }

  protected selectPart(part: PartSearchResult): void {
    this.selectedPart.set(part);
    this.partSearchControl.setValue(part.partNumber + ' — ' + part.description, { emitEvent: false });
    this.showPartResults.set(false);
  }

  protected addPart(): void {
    const part = this.selectedPart();
    if (!part) return;

    this.kanbanService.addJobPart(this.jobId(), part.id).subscribe(jp => {
      this.jobParts.update(list => [...list, jp]);
      this.selectedPart.set(null);
      this.partSearchControl.reset();
      this.snackbar.success(this.translate.instant('kanban.partAdded'));
    });
  }

  protected removePart(jp: JobPart): void {
    this.kanbanService.removeJobPart(this.jobId(), jp.id).subscribe(() => {
      this.jobParts.update(list => list.filter(p => p.id !== jp.id));
      this.snackbar.success(this.translate.instant('kanban.partRemoved'));
    });
  }

  protected dismissPartResults(): void {
    setTimeout(() => this.showPartResults.set(false), 200);
  }

  protected explodeBom(): void {
    const j = this.job();
    if (!j) return;
    this.matDialog.open(ConfirmDialogComponent, {
      width: '400px',
      data: {
        title: this.translate.instant('kanban.explodeBomConfirmTitle'),
        message: this.translate.instant('kanban.explodeBomConfirmMessage', { partNumber: j.partNumber }),
        confirmLabel: this.translate.instant('kanban.explodeBom'),
        severity: 'warn',
      } satisfies ConfirmDialogData,
    }).afterClosed().subscribe(confirmed => {
      if (!confirmed) return;
      this.kanbanService.explodeBom(j.id).subscribe(result => {
        const jobCount = result.createdJobs.length;
        const buyCount = result.buyItems.length;
        const stockCount = result.stockItems.length;
        const msgParts: string[] = [];
        if (jobCount > 0) msgParts.push(this.translate.instant('kanban.bomSubJobsCreated', { count: jobCount }));
        if (buyCount > 0) msgParts.push(this.translate.instant('kanban.bomBuyItems', { count: buyCount }));
        if (stockCount > 0) msgParts.push(this.translate.instant('kanban.bomStockItems', { count: stockCount }));
        this.snackbar.success(`${this.translate.instant('kanban.bomExploded')}: ${msgParts.join(', ')}.`);
        // Reload job detail and child jobs
        this.kanbanService.getJobDetail(j.id).subscribe(detail => {
          this.job.set(detail);
        });
        this.kanbanService.getChildJobs(j.id).subscribe(children => this.childJobs.set(children));
      });
    });
  }

  protected openDispose(): void {
    const j = this.job();
    if (!j) return;
    this.matDialog.open(DisposeJobDialogComponent, {
      width: '520px',
      data: { jobId: j.id, jobNumber: j.jobNumber } satisfies DisposeJobDialogData,
    }).afterClosed().subscribe(result => {
      if (result) {
        this.job.set(result);
      }
    });
  }

  protected formatDisposition(disposition: string): string {
    const keyMap: Record<string, string> = {
      ShipToCustomer: 'kanban.dispositionShipToCustomer',
      AddToInventory: 'kanban.dispositionAddToInventory',
      CapitalizeAsAsset: 'kanban.dispositionCapitalizeAsAsset',
      Scrap: 'kanban.dispositionScrap',
      HoldForReview: 'kanban.dispositionHoldForReview',
    };
    const key = keyMap[disposition];
    return key ? this.translate.instant(key) : disposition;
  }

  protected assignJob(user: UserRef | null): void {
    const j = this.job();
    if (!j) return;

    this.kanbanService.updateJob(j.id, { assigneeId: user?.id ?? null }).subscribe({
      next: () => {
        this.job.set({
          ...j,
          assigneeId: user?.id ?? null,
          assigneeInitials: user?.initials ?? null,
          assigneeName: user?.name ?? null,
          assigneeColor: user?.color ?? null,
        });
        this.snackbar.success(user ? this.translate.instant('kanban.assignedTo', { name: user.name }) : this.translate.instant('kanban.unassignedSuccess'));
      },
      error: () => this.snackbar.error(this.translate.instant('kanban.assignFailed')),
    });
  }

  protected moveToStage(stage: Stage): void {
    const j = this.job();
    if (!j || stage.id === j.currentStageId) return;
    this.kanbanService.moveJobStage(j.id, stage.id).subscribe(() => {
      this.job.set({ ...j, currentStageId: stage.id, stageName: stage.name, stageColor: stage.color });
      this.snackbar.success(this.translate.instant('kanban.movedToStage', { stage: stage.name }));
    });
  }

  protected startTimerForJob(): void {
    const jobId = this.job()?.id;
    if (!jobId) return;
    this.isTimerLoading.set(true);
    this.timeTrackingService.startTimer({ jobId, category: 'Production' }).subscribe({
      next: () => {
        this.snackbar.success(this.translate.instant('kanban.timerStarted'));
        this.kanbanService.getJobTimeEntries(jobId).subscribe(t => this.timeEntries.set(t));
        this.isTimerLoading.set(false);
      },
      error: () => this.isTimerLoading.set(false),
    });
  }

  protected stopTimerForJob(): void {
    const active = this.timeEntries().find(e => e.timerStart !== null && e.timerStop === null);
    if (!active) return;
    this.isTimerLoading.set(true);
    this.timeTrackingService.stopTimer({ notes: undefined }).subscribe({
      next: () => {
        this.snackbar.success(this.translate.instant('kanban.timerStopped'));
        const jobId = this.job()?.id;
        if (jobId) this.kanbanService.getJobTimeEntries(jobId).subscribe(t => this.timeEntries.set(t));
        this.isTimerLoading.set(false);
      },
      error: () => this.isTimerLoading.set(false),
    });
  }

  protected openCoverPhotoDialog(): void {
    const j = this.job();
    if (!j) return;
    this.matDialog.open(CoverPhotoUploadDialogComponent, {
      width: '520px',
      data: { jobId: j.id, currentCoverPhotoUrl: j.coverPhotoUrl ?? null } satisfies CoverPhotoDialogData,
    }).afterClosed().subscribe(result => {
      if (result !== undefined) {
        this.job.update(current => current ? { ...current, coverPhotoUrl: result?.coverPhotoUrl ?? null } : current);
      }
    });
  }



  protected close(): void {
    this.closed.emit();
  }
}
