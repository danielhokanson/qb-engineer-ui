import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { ReactiveFormsModule, FormControl, FormGroup, Validators } from '@angular/forms';

import { MatDialog } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { AdminService } from '../../services/admin.service';
import { AdminTeam, TeamMember, KioskTerminal } from '../../models/admin-team.model';
import { AdminUser } from '../../models/admin-user.model';
import { ConfirmDialogComponent, ConfirmDialogData } from '../../../../shared/components/confirm-dialog/confirm-dialog.component';
import { SnackbarService } from '../../../../shared/services/snackbar.service';
import { DataTableComponent } from '../../../../shared/components/data-table/data-table.component';
import { ColumnCellDirective } from '../../../../shared/directives/column-cell.directive';
import { ColumnDef } from '../../../../shared/models/column-def.model';
import { LoadingBlockDirective } from '../../../../shared/directives/loading-block.directive';
import { DialogComponent } from '../../../../shared/components/dialog/dialog.component';
import { InputComponent } from '../../../../shared/components/input/input.component';
import { TextareaComponent } from '../../../../shared/components/textarea/textarea.component';
import { ToggleComponent } from '../../../../shared/components/toggle/toggle.component';
import { AvatarComponent } from '../../../../shared/components/avatar/avatar.component';
import { FormValidationService } from '../../../../shared/services/form-validation.service';
import { ValidationButtonComponent } from '../../../../shared/components/validation-button/validation-button.component';

@Component({
  selector: 'app-teams-panel',
  standalone: true,
  imports: [
    ReactiveFormsModule, DataTableComponent, ColumnCellDirective,
    LoadingBlockDirective, DialogComponent, InputComponent,
    TextareaComponent, ToggleComponent, AvatarComponent, ValidationButtonComponent, TranslatePipe, MatTooltipModule,
  ],
  templateUrl: './teams-panel.component.html',
  styleUrl: './teams-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TeamsPanelComponent implements OnInit {
  private readonly adminService = inject(AdminService);
  private readonly dialog = inject(MatDialog);
  private readonly snackbar = inject(SnackbarService);
  private readonly translate = inject(TranslateService);

  protected readonly teams = signal<AdminTeam[]>([]);
  protected readonly terminals = signal<KioskTerminal[]>([]);
  protected readonly loading = signal(false);
  protected readonly saving = signal(false);

  // Team dialog
  protected readonly showTeamDialog = signal(false);
  protected readonly editingTeam = signal<AdminTeam | null>(null);
  protected readonly teamForm = new FormGroup({
    name: new FormControl('', [Validators.required, Validators.maxLength(100)]),
    color: new FormControl('#0d9488'),
    description: new FormControl('', [Validators.maxLength(500)]),
    isActive: new FormControl(true),
  });
  protected readonly teamViolations = FormValidationService.getViolations(this.teamForm, {
    name: 'Team Name',
  });

  // Member assignment dialog
  protected readonly showMemberDialog = signal(false);
  protected readonly memberTeam = signal<AdminTeam | null>(null);
  protected readonly teamMembers = signal<TeamMember[]>([]);
  protected readonly allUsers = signal<AdminUser[]>([]);
  protected readonly memberLoading = signal(false);
  protected readonly selectedUserIds = signal<Set<number>>(new Set());

  protected readonly teamColors = [
    '#0d9488', '#7c3aed', '#c2410c', '#15803d', '#1d4ed8',
    '#be123c', '#92400e', '#6d28d9', '#065f46', '#1e40af',
  ];

  protected readonly columns: ColumnDef[] = [
    { field: 'color', header: '', width: '36px' },
    { field: 'name', header: 'Team Name', sortable: true },
    { field: 'description', header: 'Description', sortable: true },
    { field: 'memberCount', header: 'Members', sortable: true, width: '100px', align: 'center' },
    { field: 'actions', header: 'Actions', width: '140px', align: 'right' },
  ];

  protected readonly terminalColumns: ColumnDef[] = [
    { field: 'name', header: 'Terminal Name', sortable: true },
    { field: 'teamName', header: 'Team', sortable: true },
    { field: 'deviceToken', header: 'Device Token', sortable: true, width: '200px' },
    { field: 'actions', header: '', width: '60px', align: 'right' },
  ];

  ngOnInit(): void {
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.adminService.getTeams().subscribe({
      next: (teams) => { this.teams.set(teams); this.loading.set(false); },
      error: () => { this.loading.set(false); this.snackbar.error(this.translate.instant('teamsPanel.loadFailed')); },
    });
    this.adminService.getKioskTerminals().subscribe({
      next: (terminals) => this.terminals.set(terminals),
      error: () => {},
    });
  }

  protected openCreateTeam(): void {
    this.editingTeam.set(null);
    this.teamForm.reset({ name: '', color: '#0d9488', description: '', isActive: true });
    this.showTeamDialog.set(true);
  }

  protected openEditTeam(team: AdminTeam): void {
    this.editingTeam.set(team);
    this.teamForm.patchValue({
      name: team.name,
      color: team.color ?? '#0d9488',
      description: team.description ?? '',
      isActive: true,
    });
    this.showTeamDialog.set(true);
  }

  protected closeTeamDialog(): void {
    this.showTeamDialog.set(false);
  }

  protected saveTeam(): void {
    if (this.teamForm.invalid) return;
    const form = this.teamForm.getRawValue();
    const editing = this.editingTeam();

    this.saving.set(true);

    if (editing) {
      this.adminService.updateTeam(editing.id, {
        id: editing.id,
        name: form.name!,
        color: form.color,
        description: form.description,
        isActive: form.isActive!,
      }).subscribe({
        next: () => {
          this.saving.set(false);
          this.closeTeamDialog();
          this.load();
          this.snackbar.success(this.translate.instant('teamsPanel.teamUpdated'));
        },
        error: () => { this.saving.set(false); this.snackbar.error(this.translate.instant('teamsPanel.updateFailed')); },
      });
    } else {
      this.adminService.createTeam({
        name: form.name!,
        color: form.color ?? undefined,
        description: form.description ?? undefined,
      }).subscribe({
        next: () => {
          this.saving.set(false);
          this.closeTeamDialog();
          this.load();
          this.snackbar.success(this.translate.instant('teamsPanel.teamCreated'));
        },
        error: () => { this.saving.set(false); this.snackbar.error(this.translate.instant('teamsPanel.createFailed')); },
      });
    }
  }

  protected deleteTeam(team: AdminTeam): void {
    this.dialog.open(ConfirmDialogComponent, {
      width: '400px',
      data: {
        title: 'Delete Team?',
        message: `This will delete "${team.name}" and unassign all its members. Active kiosk terminals must be removed first.`,
        confirmLabel: 'Delete',
        severity: 'danger',
      } satisfies ConfirmDialogData,
    }).afterClosed().subscribe(confirmed => {
      if (!confirmed) return;
      this.adminService.deleteTeam(team.id).subscribe({
        next: () => { this.load(); this.snackbar.success(this.translate.instant('teamsPanel.teamDeleted')); },
        error: () => this.snackbar.error(this.translate.instant('teamsPanel.deleteFailed')),
      });
    });
  }

  // ── Member Management ──

  protected openMembers(team: AdminTeam): void {
    this.memberTeam.set(team);
    this.memberLoading.set(true);
    this.showMemberDialog.set(true);

    // Load team members and all users in parallel
    this.adminService.getTeamMembers(team.id).subscribe({
      next: (members) => {
        this.teamMembers.set(members);
        this.selectedUserIds.set(new Set(members.map(m => m.id)));
      },
      error: () => this.snackbar.error(this.translate.instant('teamsPanel.loadMembersFailed')),
    });

    this.adminService.getUsers().subscribe({
      next: (users) => {
        this.allUsers.set(users.filter(u => u.isActive));
        this.memberLoading.set(false);
      },
      error: () => { this.memberLoading.set(false); },
    });
  }

  protected closeMemberDialog(): void {
    this.showMemberDialog.set(false);
  }

  protected toggleUser(userId: number): void {
    this.selectedUserIds.update(ids => {
      const updated = new Set(ids);
      if (updated.has(userId)) {
        updated.delete(userId);
      } else {
        updated.add(userId);
      }
      return updated;
    });
  }

  protected isUserSelected(userId: number): boolean {
    return this.selectedUserIds().has(userId);
  }

  protected saveMembers(): void {
    const team = this.memberTeam();
    if (!team) return;

    this.saving.set(true);
    this.adminService.assignTeamMembers(team.id, [...this.selectedUserIds()]).subscribe({
      next: () => {
        this.saving.set(false);
        this.closeMemberDialog();
        this.load();
        this.snackbar.success(this.translate.instant('teamsPanel.membersUpdated', { name: team.name }));
      },
      error: () => { this.saving.set(false); this.snackbar.error(this.translate.instant('teamsPanel.assignFailed')); },
    });
  }

  protected openKiosk(): void {
    window.open('/display/shop-floor/clock', '_blank');
  }

  protected openKioskDisplay(): void {
    window.open('/display/shop-floor', '_blank');
  }

  protected removeTerminal(terminal: KioskTerminal): void {
    this.dialog.open(ConfirmDialogComponent, {
      width: '400px',
      data: {
        title: this.translate.instant('teamsPanel.removeTerminalTitle'),
        message: this.translate.instant('teamsPanel.removeTerminalConfirm', { name: terminal.name }),
        confirmLabel: this.translate.instant('teamsPanel.remove'),
        severity: 'danger',
      } satisfies ConfirmDialogData,
    }).afterClosed().subscribe(confirmed => {
      if (!confirmed) return;
      this.adminService.deleteKioskTerminal(terminal.id).subscribe({
        next: () => {
          this.load();
          this.snackbar.success(this.translate.instant('teamsPanel.terminalRemoved'));
        },
        error: () => this.snackbar.error(this.translate.instant('teamsPanel.terminalRemoveFailed')),
      });
    });
  }
}
