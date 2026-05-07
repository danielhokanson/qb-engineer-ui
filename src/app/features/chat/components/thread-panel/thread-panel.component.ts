import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, effect, inject, input, output, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';

import { TranslatePipe } from '@ngx-translate/core';

import { AvatarComponent } from '../../../../shared/components/avatar/avatar.component';
import { AuthService } from '../../../../shared/services/auth.service';
import { ChatService } from '../../services/chat.service';
import { ChatMessage } from '../../models/chat-message.model';
import { MentionRenderPipe } from '../../pipes/mention-render.pipe';

@Component({
  selector: 'app-thread-panel',
  standalone: true,
  imports: [ReactiveFormsModule, AvatarComponent, TranslatePipe, MentionRenderPipe],
  templateUrl: './thread-panel.component.html',
  styleUrl: './thread-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ThreadPanelComponent {
  private readonly chatService = inject(ChatService);
  private readonly authService = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly repliesContainer = viewChild<ElementRef<HTMLElement>>('repliesContainer');

  readonly parentMessage = input<ChatMessage | null>(null);
  readonly open = input(false);
  readonly closed = output<void>();
  readonly replySent = output<void>();

  protected readonly replies = signal<ChatMessage[]>([]);
  protected readonly replyControl = new FormControl('');
  protected readonly isLoading = signal(false);

  constructor() {
    effect(() => {
      const parent = this.parentMessage();
      if (parent && this.open()) {
        this.loadThread(parent.id);
      } else {
        this.replies.set([]);
        this.replyControl.setValue('');
      }
    });
  }

  protected isOwnMessage(msg: ChatMessage): boolean {
    return msg.senderId === this.authService.user()?.id;
  }

  protected formatTime(date: Date | string): string {
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  protected sendReply(): void {
    const content = this.replyControl.value?.trim();
    const parent = this.parentMessage();
    if (!content || !parent) return;

    this.chatService.replyInThread(parent.id, content).pipe(
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(reply => {
      this.replies.update(r => [...r, reply]);
      this.replyControl.setValue('');
      this.scrollToBottom();
      this.replySent.emit();
    });
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.sendReply();
    }
  }

  protected close(): void {
    this.closed.emit();
  }

  addReply(reply: ChatMessage): void {
    this.replies.update(r => [...r, reply]);
    this.scrollToBottom();
  }

  private loadThread(messageId: number): void {
    this.isLoading.set(true);
    this.chatService.getThread(messageId).pipe(
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(threadReplies => {
      this.replies.set(threadReplies);
      this.isLoading.set(false);
      this.scrollToBottom();
    });
  }

  private scrollToBottom(): void {
    setTimeout(() => {
      const container = this.repliesContainer()?.nativeElement;
      if (container) {
        container.scrollTop = container.scrollHeight;
      }
    });
  }
}
