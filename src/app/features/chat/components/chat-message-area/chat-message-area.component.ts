import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, input, output, viewChild } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';

import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';

import { AvatarComponent } from '../../../../shared/components/avatar/avatar.component';
import { AuthService } from '../../../../shared/services/auth.service';
import { ChatMessage } from '../../models/chat-message.model';
import { MentionRenderPipe } from '../../pipes/mention-render.pipe';

@Component({
  selector: 'app-chat-message-area',
  standalone: true,
  imports: [ReactiveFormsModule, MatTooltipModule, AvatarComponent, TranslatePipe, MentionRenderPipe],
  templateUrl: './chat-message-area.component.html',
  styleUrl: './chat-message-area.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChatMessageAreaComponent {
  private readonly authService = inject(AuthService);

  private readonly messagesContainer = viewChild<ElementRef<HTMLElement>>('messagesContainer');

  readonly messages = input<ChatMessage[]>([]);
  readonly currentUserId = input<number>(0);
  readonly isChannel = input(false);
  readonly isReadOnly = input(false);
  readonly showFileAttach = input(true);

  // File attachment state
  readonly pendingFile = input<File | null>(null);
  readonly pendingFileAttachmentId = input<number | null>(null);
  readonly isUploading = input(false);

  readonly messageSent = output<string>();
  readonly threadOpened = output<ChatMessage>();
  readonly fileSelected = output<File>();
  readonly fileCancelled = output<void>();

  protected readonly messageControl = new FormControl('');

  protected readonly topLevelMessages = computed(() =>
    this.messages().filter(m => !m.parentMessageId),
  );

  scrollToBottom(): void {
    setTimeout(() => {
      const container = this.messagesContainer()?.nativeElement;
      if (container) {
        container.scrollTop = container.scrollHeight;
      }
    });
  }

  protected sendMessage(): void {
    const content = this.messageControl.value?.trim();
    if (!content && !this.pendingFileAttachmentId()) return;
    this.messageSent.emit(content ?? '');
    this.messageControl.setValue('');
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.sendMessage();
    }
  }

  protected onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    // Max 10MB
    if (file.size > 10 * 1024 * 1024) return;

    this.fileSelected.emit(file);
    input.value = '';
  }

  protected clearPendingFile(): void {
    this.fileCancelled.emit();
  }

  protected isOwnMessage(msg: ChatMessage): boolean {
    return msg.senderId === this.currentUserId();
  }

  protected formatTime(date: Date | string): string {
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  protected dateSeparator(index: number): string | null {
    const msgs = this.topLevelMessages();
    if (index >= msgs.length) return null;
    const current = new Date(msgs[index].createdAt);
    const currentDay = this.toDayKey(current);

    if (index === 0) {
      return this.isToday(current) ? null : this.formatDayLabel(current);
    }

    const prev = new Date(msgs[index - 1].createdAt);
    const prevDay = this.toDayKey(prev);

    if (currentDay !== prevDay) {
      return this.isToday(current) ? 'Today' : this.formatDayLabel(current);
    }
    return null;
  }

  protected formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  protected getFileIcon(contentType: string): string {
    if (contentType.startsWith('image/')) return 'image';
    if (contentType === 'application/pdf') return 'picture_as_pdf';
    if (contentType.includes('spreadsheet') || contentType.includes('excel')) return 'table_chart';
    if (contentType.includes('document') || contentType.includes('word')) return 'description';
    return 'attach_file';
  }

  protected openThread(msg: ChatMessage): void {
    this.threadOpened.emit(msg);
  }

  private toDayKey(d: Date): string {
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  }

  private isToday(d: Date): boolean {
    const now = new Date();
    return this.toDayKey(d) === this.toDayKey(now);
  }

  private formatDayLabel(d: Date): string {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    if (this.toDayKey(d) === this.toDayKey(yesterday)) return 'Yesterday';
    return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  }
}
