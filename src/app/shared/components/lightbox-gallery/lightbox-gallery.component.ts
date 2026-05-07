import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  HostListener,
  input,
  output,
  signal,
  viewChild, OnInit,
} from '@angular/core';

import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';

import { GalleryItem } from '../../models/gallery-item.model';

@Component({
  selector: 'app-lightbox-gallery',
  standalone: true,
  imports: [MatTooltipModule, TranslatePipe],
  templateUrl: './lightbox-gallery.component.html',
  styleUrl: './lightbox-gallery.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LightboxGalleryComponent implements OnInit {
  readonly items = input.required<GalleryItem[]>();
  readonly startIndex = input<number>(0);

  readonly closed = output<void>();

  readonly currentIndex = signal(0);
  readonly transitioning = signal(false);

  readonly thumbnailStrip = viewChild<ElementRef<HTMLDivElement>>('thumbnailStrip');

  readonly currentItem = computed(() => {
    const list = this.items();
    const idx = this.currentIndex();
    return list.length > 0 ? list[idx] : null;
  });

  readonly counter = computed(() => {
    const list = this.items();
    return list.length > 0 ? `${this.currentIndex() + 1} / ${list.length}` : '';
  });

  readonly hasPrev = computed(() => this.currentIndex() > 0);
  readonly hasNext = computed(() => this.currentIndex() < this.items().length - 1);

  private touchStartX = 0;
  private touchStartY = 0;

  ngOnInit(): void {
    this.currentIndex.set(this.startIndex());
  }

  @HostListener('document:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    switch (event.key) {
      case 'Escape':
        this.close();
        break;
      case 'ArrowLeft':
        this.prev();
        break;
      case 'ArrowRight':
        this.next();
        break;
    }
  }

  close(): void {
    this.closed.emit();
  }

  onBackdropClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (target.classList.contains('lightbox__backdrop')) {
      this.close();
    }
  }

  prev(): void {
    if (this.hasPrev()) {
      this.navigateTo(this.currentIndex() - 1);
    }
  }

  next(): void {
    if (this.hasNext()) {
      this.navigateTo(this.currentIndex() + 1);
    }
  }

  goTo(index: number): void {
    if (index >= 0 && index < this.items().length) {
      this.navigateTo(index);
    }
  }

  onTouchStart(event: TouchEvent): void {
    this.touchStartX = event.changedTouches[0].clientX;
    this.touchStartY = event.changedTouches[0].clientY;
  }

  onTouchEnd(event: TouchEvent): void {
    const deltaX = event.changedTouches[0].clientX - this.touchStartX;
    const deltaY = event.changedTouches[0].clientY - this.touchStartY;
    const minSwipeDistance = 50;

    if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > minSwipeDistance) {
      if (deltaX < 0) {
        this.next();
      } else {
        this.prev();
      }
    }
  }

  getFileIcon(type: 'image' | 'pdf' | 'other'): string {
    switch (type) {
      case 'pdf':
        return 'picture_as_pdf';
      case 'other':
        return 'insert_drive_file';
      default:
        return 'image';
    }
  }

  private navigateTo(index: number): void {
    this.transitioning.set(true);
    setTimeout(() => {
      this.currentIndex.set(index);
      this.scrollThumbnailIntoView(index);
      setTimeout(() => this.transitioning.set(false), 20);
    }, 150);
  }

  private scrollThumbnailIntoView(index: number): void {
    const strip = this.thumbnailStrip()?.nativeElement;
    if (!strip) return;

    const thumb = strip.children[index] as HTMLElement;
    if (thumb) {
      thumb.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  }
}
