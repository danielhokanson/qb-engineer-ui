import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { DatePipe } from '@angular/common';

import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { NotificationService } from '../../services/notification.service';
import { AvatarComponent } from '../avatar/avatar.component';
import { RichTextPipe } from '../../pipes/rich-text.pipe';
import { AppNotification } from '../../models/app-notification.model';
import { NotificationTab } from '../../models/notification-tab.type';

@Component({
  selector: 'app-notification-panel',
  standalone: true,
  imports: [DatePipe, MatTooltipModule, AvatarComponent, TranslatePipe, RichTextPipe],
  templateUrl: './notification-panel.component.html',
  styleUrl: './notification-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotificationPanelComponent {
  private readonly notificationService = inject(NotificationService);
  private readonly router = inject(Router);
  private readonly translate = inject(TranslateService);

  protected readonly notifications = this.notificationService.filteredNotifications;
  protected readonly filter = this.notificationService.filter;
  protected readonly unreadCount = this.notificationService.unreadCount;
  protected readonly isEmpty = computed(() => this.notifications().length === 0);

  protected readonly tabs: { key: NotificationTab; label: string }[] = [
    { key: 'all', label: this.translate.instant('notifications.all') },
    { key: 'messages', label: this.translate.instant('notifications.messages') },
    { key: 'alerts', label: this.translate.instant('notifications.alerts') },
  ];

  protected setTab(tab: NotificationTab): void {
    this.notificationService.setTab(tab);
  }

  protected markAllRead(): void {
    this.notificationService.markAllRead();
  }

  protected dismissAll(): void {
    this.notificationService.dismissAll();
  }

  protected onNotificationClick(notification: AppNotification): void {
    this.notificationService.markAsRead(notification.id);
    if (notification.entityType && notification.entityId) {
      this.notificationService.closePanel();
      const commands = this.resolveEntityRoute(notification.entityType, notification.entityId);
      if (commands) this.router.navigate(commands.path, { queryParams: commands.query });
    }
  }

  private resolveEntityRoute(entityType: string, entityId: number): { path: (string | number)[]; query?: Record<string, unknown> } | null {
    switch (entityType.toLowerCase()) {
      case 'job': return { path: ['/board'], query: { job: entityId } };
      case 'quote': return { path: ['/quotes'], query: { id: entityId } };
      case 'salesorder': return { path: ['/sales-orders'], query: { id: entityId } };
      case 'purchaseorder': return { path: ['/purchase-orders'], query: { id: entityId } };
      case 'invoice': return { path: ['/invoices'], query: { id: entityId } };
      case 'expense': return { path: ['/expenses'], query: { id: entityId } };
      case 'lead': return { path: ['/leads'], query: { id: entityId } };
      case 'part': return { path: ['/parts'], query: { id: entityId } };
      case 'shipment': return { path: ['/shipments'], query: { id: entityId } };
      case 'customer': return { path: ['/customers', entityId, 'overview'] };
      case 'asset': return { path: ['/assets'], query: { id: entityId } };
      case 'vendor': return { path: ['/vendors'], query: { id: entityId } };
      case 'timeentry': return { path: ['/time-tracking'], query: { id: entityId } };
      case 'training': return { path: ['/training'] };
      case 'users': return { path: ['/admin/users'] };
      case 'compliance_submissions': return { path: ['/account/tax-forms'] };
      case 'reorder_suggestions': return { path: ['/inventory/replenishment'] };
      case 'customerreturn': return { path: ['/customer-returns'], query: { id: entityId } };
      case 'payment': return { path: ['/payments'], query: { id: entityId } };
      default: return null;
    }
  }

  protected togglePin(notification: AppNotification, event: MouseEvent): void {
    event.stopPropagation();
    this.notificationService.togglePin(notification.id);
  }

  protected dismiss(notification: AppNotification, event: MouseEvent): void {
    event.stopPropagation();
    this.notificationService.dismiss(notification.id);
  }

  protected getSeverityIcon(severity: string): string {
    switch (severity) {
      case 'critical': return 'error';
      case 'warning': return 'warning';
      default: return 'info';
    }
  }
}
