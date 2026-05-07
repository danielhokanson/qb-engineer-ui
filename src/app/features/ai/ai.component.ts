import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';

import { MatTooltipModule } from '@angular/material/tooltip';

import { AiService, AiHelpMessage } from '../../shared/services/ai.service';
import { LoadingBlockDirective } from '../../shared/directives/loading-block.directive';
import { EmptyStateComponent } from '../../shared/components/empty-state/empty-state.component';
import { TranslateService, TranslatePipe } from '@ngx-translate/core';

export interface AiAssistantListItem {
  id: number;
  name: string;
  description: string;
  icon: string;
  color: string;
  category: string;
  starterQuestions: string[];
  isActive: boolean;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

@Component({
  selector: 'app-ai',
  standalone: true,
  imports: [ReactiveFormsModule, MatTooltipModule, LoadingBlockDirective, EmptyStateComponent, TranslatePipe],
  templateUrl: './ai.component.html',
  styleUrl: './ai.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiComponent {
  private readonly aiService = inject(AiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly translate = inject(TranslateService);

  protected readonly assistants = signal<AiAssistantListItem[]>([]);
  protected readonly loadingAssistants = signal(false);
  protected readonly sending = signal(false);
  protected readonly messageInput = new FormControl('');

  // Conversation history per assistant (keyed by ID)
  private readonly conversations = new Map<number, ChatMessage[]>();

  protected readonly assistantIdParam = toSignal(
    this.route.paramMap.pipe(map(p => p.get('assistantId') ?? 'general')),
    { initialValue: 'general' },
  );

  protected readonly activeAssistant = computed(() => {
    const param = this.assistantIdParam();
    const list = this.assistants();
    if (param === 'general') {
      return list.find(a => a.category === 'General') ?? list[0] ?? null;
    }
    const id = parseInt(param, 10);
    return list.find(a => a.id === id) ?? null;
  });

  protected readonly messages = computed(() => {
    const assistant = this.activeAssistant();
    if (!assistant) return [];
    return this.conversations.get(assistant.id) ?? [];
  });

  protected readonly hasMessages = computed(() => this.messages().length > 0);

  constructor() {
    this.loadAssistants();

    // Navigate to actual ID when 'general' resolves
    effect(() => {
      const param = this.assistantIdParam();
      const assistant = this.activeAssistant();
      if (param === 'general' && assistant && this.assistants().length > 0) {
        this.router.navigate(['..', assistant.id.toString()], { relativeTo: this.route, replaceUrl: true });
      }
    });
  }

  private loadAssistants(): void {
    this.loadingAssistants.set(true);
    this.aiService.getAssistants().subscribe({
      next: (data) => {
        this.assistants.set(data);
        this.loadingAssistants.set(false);
      },
      error: () => this.loadingAssistants.set(false),
    });
  }

  protected selectAssistant(assistant: AiAssistantListItem): void {
    this.router.navigate(['..', assistant.id.toString()], { relativeTo: this.route });
  }

  protected sendMessage(): void {
    const text = this.messageInput.value?.trim();
    const assistant = this.activeAssistant();
    if (!text || !assistant || this.sending()) return;

    this.messageInput.reset();
    this.addMessage(assistant.id, { role: 'user', content: text, timestamp: new Date() });
    this.sending.set(true);

    const history: AiHelpMessage[] = (this.conversations.get(assistant.id) ?? [])
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .slice(-10)
      .map(m => ({ role: m.role, content: m.content }));

    this.aiService.assistantChat(assistant.id, text, history).subscribe({
      next: (response) => {
        this.addMessage(assistant.id, { role: 'assistant', content: response.answer, timestamp: new Date() });
        this.sending.set(false);
      },
      error: () => {
        this.addMessage(assistant.id, { role: 'assistant', content: this.translate.instant('ai.errorMessage'), timestamp: new Date() });
        this.sending.set(false);
      },
    });
  }

  protected askStarter(question: string): void {
    this.messageInput.setValue(question);
    this.sendMessage();
  }

  protected clearChat(): void {
    const assistant = this.activeAssistant();
    if (!assistant) return;
    this.conversations.set(assistant.id, []);
    // Force reactivity by touching the signal
    this.assistants.update(a => [...a]);
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.sendMessage();
    }
  }

  private addMessage(assistantId: number, message: ChatMessage): void {
    if (!this.conversations.has(assistantId)) {
      this.conversations.set(assistantId, []);
    }
    this.conversations.get(assistantId)!.push(message);
    // Force reactivity
    this.assistants.update(a => [...a]);
  }
}
