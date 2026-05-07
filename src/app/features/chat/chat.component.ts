import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, effect, inject, OnDestroy, OnInit, signal, computed, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute } from '@angular/router';

import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog } from '@angular/material/dialog';

import { formatDate } from '../../shared/utils/date.utils';
import { AvatarComponent } from '../../shared/components/avatar/avatar.component';
import { AuthService } from '../../shared/services/auth.service';
import { TranslateService, TranslatePipe } from '@ngx-translate/core';
import { ChatHubService } from '../../shared/services/chat-hub.service';
import { ChatService } from './services/chat.service';
import { ChatBroadcastService } from './services/chat-broadcast.service';
import { ChatConversation } from './models/chat-conversation.model';
import { ChatMessage } from './models/chat-message.model';
import { ChatMessageEvent } from './models/chat-message-event.model';
import { ChatRoom } from './models/chat-room.model';
import { CreateChannelDialogComponent } from './components/create-channel-dialog/create-channel-dialog.component';
import { ChannelBrowserDialogComponent } from './components/channel-browser-dialog/channel-browser-dialog.component';
import { ChannelSettingsDialogComponent, ChannelSettingsDialogData, ChannelSettingsDialogResult } from './components/channel-settings-dialog/channel-settings-dialog.component';
import { MentionRenderPipe } from './pipes/mention-render.pipe';

interface UserListItem {
  id: number;
  initials: string;
  name: string;
  color: string;
}

type ChatView = 'list' | 'dm' | 'channel' | 'userPicker';

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [ReactiveFormsModule, MatTooltipModule, AvatarComponent, TranslatePipe, MentionRenderPipe],
  templateUrl: './chat.component.html',
  styleUrl: './chat.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChatComponent implements OnInit, OnDestroy {
  private readonly chatService = inject(ChatService);
  private readonly chatHub = inject(ChatHubService);
  private readonly authService = inject(AuthService);
  private readonly http = inject(HttpClient);
  private readonly translate = inject(TranslateService);
  private readonly route = inject(ActivatedRoute);
  private readonly dialog = inject(MatDialog);
  private readonly chatBroadcast = inject(ChatBroadcastService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly messagesContainer = viewChild<ElementRef<HTMLElement>>('messagesContainer');

  readonly panelOpen = signal(false);
  readonly isRoutedPage = signal(false);
  protected readonly view = signal<ChatView>('list');
  protected readonly conversations = signal<ChatConversation[]>([]);
  protected readonly channels = signal<ChatRoom[]>([]);
  protected readonly selectedConversation = signal<ChatConversation | null>(null);
  protected readonly selectedChannel = signal<ChatRoom | null>(null);
  protected readonly messages = signal<ChatMessage[]>([]);
  protected readonly messageControl = new FormControl('');
  readonly totalUnread = signal(0);
  protected readonly channelSectionsExpanded = signal<Record<string, boolean>>({
    dms: true,
    channels: true,
    teams: true,
  });

  // File attachment state
  protected readonly pendingFile = signal<File | null>(null);
  protected readonly pendingFileAttachmentId = signal<number | null>(null);
  protected readonly isUploading = signal(false);

  // Thread state
  protected readonly threadParentMessage = signal<ChatMessage | null>(null);
  protected readonly threadReplies = signal<ChatMessage[]>([]);
  protected readonly threadReplyControl = new FormControl('');

  // New conversation state
  protected readonly allUsers = signal<UserListItem[]>([]);
  protected readonly userSearchControl = new FormControl('');
  protected readonly userSearchTerm = signal('');
  protected readonly filteredUsers = computed(() => {
    const term = this.userSearchTerm().toLowerCase();
    const currentUserId = this.authService.user()?.id;
    const existingUserIds = new Set(this.conversations().map(c => c.userId));
    return this.allUsers()
      .filter(u => u.id !== currentUserId)
      .filter(u => !term || u.name.toLowerCase().includes(term))
      .filter(u => !existingUserIds.has(u.id));
  });

  // Computed channel groups
  protected readonly dmConversations = this.conversations;
  protected readonly groupChannels = computed(() =>
    this.channels().filter(c => c.channelType === 'Group' || c.channelType === 'Custom' || c.channelType === 'System' || c.channelType === 'Broadcast'));
  protected readonly teamChannels = computed(() =>
    this.channels().filter(c => c.channelType === 'TeamAuto'));

  protected readonly isPopoutOpen = this.chatBroadcast.isPopoutOpen;

  private hubConnected = false;

  constructor() {
    effect(() => {
      const msg = this.chatBroadcast.lastMessage();
      if (!msg || !this.isRoutedPage()) return;

      if (msg.type === 'openConversation') {
        if (msg.channelId) {
          const channel = this.channels().find(c => c.id === msg.channelId);
          if (channel) this.selectChannel(channel);
        } else if (msg.userId) {
          const conv = this.conversations().find(c => c.userId === msg.userId);
          if (conv) {
            this.selectConversation(conv);
          } else {
            this.http.get<UserListItem[]>('/api/v1/users').pipe(
              takeUntilDestroyed(this.destroyRef),
            ).subscribe(users => {
              const user = users.find(u => u.id === msg.userId);
              if (user) this.selectUser(user);
            });
          }
        }
      } else if (msg.type === 'focusWindow') {
        window.focus();
      }
    });
  }

  ngOnInit(): void {
    if (this.route.snapshot.routeConfig !== null) {
      this.isRoutedPage.set(true);
      this.panelOpen.set(true);
      this.loadConversations();
      this.loadChannels();
      this.connectHub();
    }
  }

  popOut(): void {
    this.chatBroadcast.openPopout();
    this.panelOpen.set(false);
  }

  focusPopout(): void {
    this.chatBroadcast.focusPopout();
  }

  toggle(): void {
    const isOpen = !this.panelOpen();
    this.panelOpen.set(isOpen);

    if (isOpen) {
      this.loadConversations();
      this.loadChannels();
      this.connectHub();
    } else {
      this.selectedConversation.set(null);
      this.selectedChannel.set(null);
      this.messages.set([]);
      this.view.set('list');
    }
  }

  selectConversation(conv: ChatConversation): void {
    if (!this.isRoutedPage() && this.isPopoutOpen()) {
      this.chatBroadcast.openConversationInPopout({ userId: conv.userId });
      return;
    }
    this.selectedConversation.set(conv);
    this.selectedChannel.set(null);
    this.view.set('dm');
    this.loadMessages(conv.userId);
    this.chatService.markAsRead(conv.userId).subscribe();
  }

  selectChannel(channel: ChatRoom): void {
    if (!this.isRoutedPage() && this.isPopoutOpen()) {
      this.chatBroadcast.openConversationInPopout({ channelId: channel.id });
      return;
    }
    this.selectedChannel.set(channel);
    this.selectedConversation.set(null);
    this.view.set('channel');
    this.loadChannelMessages(channel.id);
    this.chatService.markChannelRead(channel.id).subscribe();
    this.chatHub.joinChannel(channel.id);
  }

  backToList(): void {
    const ch = this.selectedChannel();
    if (ch) this.chatHub.leaveChannel(ch.id);
    this.selectedConversation.set(null);
    this.selectedChannel.set(null);
    this.messages.set([]);
    this.view.set('list');
    this.loadConversations();
    this.loadChannels();
  }

  protected openUserPicker(): void {
    this.view.set('userPicker');
    this.userSearchControl.setValue('');
    this.userSearchTerm.set('');
    if (this.allUsers().length === 0) {
      this.http.get<UserListItem[]>('/api/v1/users').subscribe(users => {
        this.allUsers.set(users);
      });
    }
    this.userSearchControl.valueChanges.subscribe(v => this.userSearchTerm.set(v ?? ''));
  }

  protected selectUser(user: UserListItem): void {
    const conv: ChatConversation = {
      userId: user.id,
      userName: user.name,
      userInitials: user.initials,
      userColor: user.color,
      lastMessage: null,
      lastMessageAt: null,
      unreadCount: 0,
    };
    this.selectedConversation.set(conv);
    this.selectedChannel.set(null);
    this.view.set('dm');
    this.loadMessages(user.id);
  }

  protected cancelUserPicker(): void {
    this.view.set('list');
  }

  protected openCreateChannel(): void {
    this.dialog.open(CreateChannelDialogComponent, { width: '520px' })
      .afterClosed().subscribe((result: ChatRoom | undefined) => {
        if (result) {
          this.loadChannels();
          this.selectChannel(result);
        }
      });
  }

  protected openBrowseChannels(): void {
    this.dialog.open(ChannelBrowserDialogComponent, { width: '520px' })
      .afterClosed().subscribe((result: ChatRoom | undefined) => {
        if (result) {
          this.loadChannels();
          this.selectChannel(result);
        }
      });
  }

  protected openChannelSettings(): void {
    const channel = this.selectedChannel();
    if (!channel) return;

    this.dialog.open(ChannelSettingsDialogComponent, {
      width: '520px',
      data: { channel } satisfies ChannelSettingsDialogData,
    }).afterClosed().subscribe((result: ChannelSettingsDialogResult) => {
      if (result === 'left') {
        this.backToList();
      } else if (result === 'updated') {
        this.loadChannels();
      }
    });
  }

  protected toggleMuteChannel(channel: ChatRoom, event: Event): void {
    event.stopPropagation();
    const currentMember = channel.members.find(m => m.userId === this.authService.user()?.id);
    const isMuted = currentMember?.isMuted ?? false;
    this.chatService.muteChannel(channel.id, !isMuted).subscribe(() => {
      this.loadChannels();
    });
  }

  protected isChannelMuted(channel: ChatRoom): boolean {
    const currentMember = channel.members.find(m => m.userId === this.authService.user()?.id);
    return currentMember?.isMuted ?? false;
  }

  protected toggleSection(section: string): void {
    this.channelSectionsExpanded.update(s => ({ ...s, [section]: !s[section] }));
  }

  sendMessage(): void {
    const content = this.messageControl.value?.trim();
    if (!content && !this.pendingFileAttachmentId()) return;

    const conv = this.selectedConversation();
    const channel = this.selectedChannel();
    const fileId = this.pendingFileAttachmentId() ?? undefined;

    const onSent = (msg: ChatMessage) => {
      this.messages.update((msgs) => [...msgs, msg]);
      this.messageControl.setValue('');
      this.clearPendingFile();
      this.scrollToBottom();
    };

    if (conv) {
      this.chatService.sendMessage(conv.userId, content ?? '', fileId).subscribe(onSent);
    } else if (channel) {
      this.chatService.sendChatRoomMessage(channel.id, content ?? '', fileId).subscribe(onSent);
    }
  }

  onKeydown(event: KeyboardEvent): void {
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

    this.pendingFile.set(file);
    input.value = '';

    // Upload immediately
    const channel = this.selectedChannel();
    if (channel) {
      this.isUploading.set(true);
      this.chatService.uploadChatFile(channel.id, file).subscribe({
        next: (attachment) => {
          this.pendingFileAttachmentId.set(attachment.id);
          this.isUploading.set(false);
        },
        error: () => {
          this.pendingFile.set(null);
          this.isUploading.set(false);
        },
      });
    }
  }

  protected clearPendingFile(): void {
    this.pendingFile.set(null);
    this.pendingFileAttachmentId.set(null);
  }

  protected formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  protected isImageFile(contentType: string): boolean {
    return contentType.startsWith('image/');
  }

  protected getFileIcon(contentType: string): string {
    if (contentType.startsWith('image/')) return 'image';
    if (contentType === 'application/pdf') return 'picture_as_pdf';
    if (contentType.includes('spreadsheet') || contentType.includes('excel')) return 'table_chart';
    if (contentType.includes('document') || contentType.includes('word')) return 'description';
    return 'attach_file';
  }

  protected openThread(msg: ChatMessage): void {
    this.threadParentMessage.set(msg);
    this.threadReplies.set([]);
    this.threadReplyControl.setValue('');
    this.chatService.getThread(msg.id).subscribe(replies => {
      this.threadReplies.set(replies);
    });
  }

  protected closeThread(): void {
    this.threadParentMessage.set(null);
    this.threadReplies.set([]);
  }

  protected sendThreadReply(): void {
    const content = this.threadReplyControl.value?.trim();
    const parent = this.threadParentMessage();
    if (!content || !parent) return;

    this.chatService.replyInThread(parent.id, content).subscribe(reply => {
      this.threadReplies.update(r => [...r, reply]);
      this.threadReplyControl.setValue('');
      // Update parent's reply count in main messages list
      this.messages.update(msgs => msgs.map(m =>
        m.id === parent.id ? { ...m, threadReplyCount: m.threadReplyCount + 1, threadLastReplyAt: new Date() } : m,
      ));
      this.threadParentMessage.update(p => p ? { ...p, threadReplyCount: p.threadReplyCount + 1 } : p);
    });
  }

  protected onThreadKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.sendThreadReply();
    }
  }

  // Filter out thread replies from main message list
  protected readonly topLevelMessages = computed(() =>
    this.messages().filter(m => !m.parentMessageId),
  );

  ngOnDestroy(): void {
    this.chatHub.clearMessageCallbacks();
  }

  protected getChannelIcon(channel: ChatRoom): string {
    if (channel.iconName) return channel.iconName;
    switch (channel.channelType) {
      case 'System': return 'forum';
      case 'Broadcast': return 'campaign';
      case 'TeamAuto': return 'group';
      case 'Custom': return 'tag';
      default: return 'chat';
    }
  }

  protected isInputDisabled(): boolean {
    const ch = this.selectedChannel();
    if (!ch) return false;
    return ch.isReadOnly;
  }

  private loadConversations(): void {
    this.chatService.getConversations().subscribe((convs) => {
      this.conversations.set(convs);
      this.updateUnreadCount();
    });
  }

  private loadChannels(): void {
    this.chatService.getChannels().subscribe((chs) => {
      this.channels.set(chs);
      this.updateUnreadCount();
    });
  }

  private updateUnreadCount(): void {
    const dmUnread = this.conversations().reduce((sum, c) => sum + c.unreadCount, 0);
    const chUnread = this.channels().reduce((sum, c) => sum + c.unreadCount, 0);
    this.totalUnread.set(dmUnread + chUnread);
  }

  private loadMessages(otherUserId: number): void {
    this.chatService.getMessages(otherUserId).subscribe((msgs) => {
      this.messages.set(msgs);
      this.scrollToBottom();
    });
  }

  private loadChannelMessages(channelId: number): void {
    this.chatService.getChatRoomMessages(channelId).subscribe((msgs) => {
      this.messages.set(msgs);
      this.scrollToBottom();
    });
  }

  private async connectHub(): Promise<void> {
    if (this.hubConnected) return;

    this.chatHub.onMessageReceived((event: unknown) => {
      const msg = event as ChatMessageEvent;
      const currentUserId = this.authService.user()?.id;
      const selectedUserId = this.selectedConversation()?.userId;

      if (msg.senderId === selectedUserId || msg.recipientId === selectedUserId) {
        const chatMessage: ChatMessage = { ...msg, isRead: true, chatRoomId: null, fileAttachment: null, linkedEntityType: null, linkedEntityId: null, parentMessageId: msg.parentMessageId ?? null, threadReplyCount: msg.threadReplyCount ?? 0, threadLastReplyAt: null, mentions: [] };
        this.messages.update((msgs) => {
          const updated = [...msgs, chatMessage];
          updated.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
          return updated;
        });
        this.scrollToBottom();

        if (msg.senderId !== currentUserId) {
          this.chatService.markAsRead(msg.senderId).subscribe();
        }
      }

      this.loadConversations();
    });

    this.chatHub.onRoomMessageReceived((event: unknown) => {
      const data = event as { roomId: number; message: ChatMessageEvent };
      const selectedChannelId = this.selectedChannel()?.id;
      if (data.roomId === selectedChannelId) {
        const chatMessage: ChatMessage = {
          ...data.message,
          isRead: true,
          chatRoomId: data.roomId,
          fileAttachment: null,
          linkedEntityType: null,
          linkedEntityId: null,
          parentMessageId: data.message.parentMessageId ?? null,
          threadReplyCount: data.message.threadReplyCount ?? 0,
          threadLastReplyAt: null,
          mentions: [],
        };
        this.messages.update((msgs) => [...msgs, chatMessage]);
        this.scrollToBottom();
        this.chatService.markChannelRead(data.roomId).subscribe();
      }
      this.loadChannels();
    });

    await this.chatHub.connect();
    this.hubConnected = true;
  }

  private scrollToBottom(): void {
    setTimeout(() => {
      const container = this.messagesContainer()?.nativeElement;
      if (container) {
        container.scrollTop = container.scrollHeight;
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

  protected dateSeparator(index: number): string | null {
    const msgs = this.messages();
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

  protected formatDate(date: Date | string | null): string {
    if (!date) return '';
    const d = typeof date === 'string' ? new Date(date) : date;
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const minutes = Math.floor(diff / 60000);

    if (minutes < 1) return this.translate.instant('chat.justNow');
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d`;
    return formatDate(date);
  }
}
