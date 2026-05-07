import { ChangeDetectionStrategy, Component, inject, signal, computed } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';

import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';

import { DialogComponent } from '../../../../shared/components/dialog/dialog.component';
import { InputComponent } from '../../../../shared/components/input/input.component';
import { TextareaComponent } from '../../../../shared/components/textarea/textarea.component';
import { ValidationButtonComponent } from '../../../../shared/components/validation-button/validation-button.component';
import { FormValidationService } from '../../../../shared/services/form-validation.service';
import { AvatarComponent } from '../../../../shared/components/avatar/avatar.component';
import { AuthService } from '../../../../shared/services/auth.service';
import { ChatService } from '../../services/chat.service';
import { ChatRoom } from '../../models/chat-room.model';

export interface ChannelSettingsDialogData {
  channel: ChatRoom;
}

export type ChannelSettingsDialogResult = 'left' | 'updated' | undefined;

@Component({
  selector: 'app-channel-settings-dialog',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    MatTooltipModule,
    DialogComponent,
    InputComponent,
    TextareaComponent,
    ValidationButtonComponent,
    AvatarComponent,
  ],
  templateUrl: './channel-settings-dialog.component.html',
  styleUrl: './channel-settings-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChannelSettingsDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<ChannelSettingsDialogComponent>);
  private readonly data = inject<ChannelSettingsDialogData>(MAT_DIALOG_DATA);
  private readonly chatService = inject(ChatService);
  private readonly authService = inject(AuthService);

  protected readonly channel = signal<ChatRoom>(this.data.channel);
  protected readonly saving = signal(false);
  protected readonly leaving = signal(false);

  protected readonly form = new FormGroup({
    name: new FormControl(this.data.channel.name, [Validators.required, Validators.maxLength(200)]),
    description: new FormControl(this.data.channel.description ?? '', [Validators.maxLength(500)]),
    iconName: new FormControl(this.data.channel.iconName ?? ''),
  });

  protected readonly violations = FormValidationService.getViolations(this.form, {
    name: 'Channel Name',
  });

  protected readonly currentUserRole = computed(() => {
    const userId = this.authService.user()?.id;
    const member = this.channel().members.find(m => m.userId === userId);
    return member?.role ?? 'Member';
  });

  protected readonly canEdit = computed(() => {
    const role = this.currentUserRole();
    return role === 'Owner' || role === 'Admin';
  });

  protected readonly canLeave = computed(() => {
    const ch = this.channel();
    return ch.channelType !== 'DirectMessage' && ch.channelType !== 'System';
  });

  protected readonly sortedMembers = computed(() => {
    const roleOrder: Record<string, number> = { Owner: 0, Admin: 1, Member: 2 };
    return [...this.channel().members].sort((a, b) =>
      (roleOrder[a.role] ?? 2) - (roleOrder[b.role] ?? 2),
    );
  });

  protected getRoleBadgeClass(role: string): string {
    switch (role) {
      case 'Owner': return 'role-badge--owner';
      case 'Admin': return 'role-badge--admin';
      default: return '';
    }
  }

  protected save(): void {
    if (this.form.invalid || this.saving() || !this.canEdit()) return;

    this.saving.set(true);
    const { name, description, iconName } = this.form.getRawValue();

    this.chatService.updateChannel(this.channel().id, {
      name: name ?? undefined,
      description: description ?? undefined,
      iconName: iconName ?? undefined,
    }).subscribe({
      next: () => {
        this.saving.set(false);
        this.dialogRef.close('updated' as ChannelSettingsDialogResult);
      },
      error: () => {
        this.saving.set(false);
      },
    });
  }

  protected leaveChannel(): void {
    if (this.leaving()) return;
    this.leaving.set(true);

    this.chatService.leaveChannel(this.channel().id).subscribe({
      next: () => {
        this.leaving.set(false);
        this.dialogRef.close('left' as ChannelSettingsDialogResult);
      },
      error: () => {
        this.leaving.set(false);
      },
    });
  }

  protected close(): void {
    this.dialogRef.close();
  }
}
