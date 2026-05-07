import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';

import { createTourSvg, clearTourConnector, updateTourConnector, attachScrollRefresh, setupPopoverDraggable } from '../utils/tour-connector.utils';

export interface TourStep {
  element?: string;
  title: string;
  description: string;
  side?: 'top' | 'bottom' | 'left' | 'right';
}

export interface TourDefinition {
  id: string;
  steps: TourStep[];
}

/** Steps in driver.js popover format — used for training module walkthroughs. */
export interface DriverStep {
  element?: string;
  popover: {
    title: string;
    description: string;
    side?: 'top' | 'bottom' | 'left' | 'right';
  };
}

@Injectable({ providedIn: 'root' })
export class HelpTourService {
  private readonly router = inject(Router);
  private readonly tours = new Map<string, TourDefinition>();
  private driverInstance: unknown = null;
  private tourSvg: SVGSVGElement | null = null;

  /** True while a tour is actively running — prevents double-launch. */
  get isRunning(): boolean { return this.driverInstance !== null; }

  register(tour: TourDefinition): void {
    this.tours.set(tour.id, tour);
  }

  async start(tourId: string): Promise<void> {
    const tour = this.tours.get(tourId);
    if (!tour || tour.steps.length === 0) return;

    this.router.navigate([], {
      queryParams: { tutorial: tourId },
      queryParamsHandling: 'merge',
    });

    await this.launchDriver(
      tour.steps.map(step => ({
        element: step.element,
        popover: { title: step.title, description: step.description, side: step.side ?? 'bottom' },
      })),
      tourId,
    );
  }

  /**
   * Start a tour from pre-built driver.js step objects.
   * Used by AppComponent to resume walkthroughs from `?tutorial=<id>` on page reload.
   */
  async startSteps(steps: DriverStep[], tourId: string): Promise<void> {
    if (this.isRunning || steps.length === 0) return;
    await this.launchDriver(steps, tourId);
  }

  isRegistered(tourId: string): boolean {
    return this.tours.has(tourId);
  }

  private async launchDriver(steps: DriverStep[], _tourId: string): Promise<void> {
    const { driver } = await import('driver.js');

    this.tourSvg = createTourSvg();
    document.body.appendChild(this.tourSvg);
    const svg = this.tourSvg;
    const removeScrollRefresh = attachScrollRefresh(svg);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const driverObj = (driver as any)({
      showProgress: true,
      animate: true,
      overlayOpacity: 0,
      stagePadding: 0,
      stageRadius: 0,
      popoverClass: 'qb-tour-popover',
      steps,
      onHighlighted: () => {
        requestAnimationFrame(() => {
          updateTourConnector(svg, { center: true });
          setupPopoverDraggable();
        });
      },
      onDeselected: () => {
        clearTourConnector(svg);
      },
      onDestroyed: () => {
        removeScrollRefresh();
        this.driverInstance = null;
        svg.remove();
        this.tourSvg = null;
        this.router.navigate([], {
          queryParams: { tutorial: null },
          queryParamsHandling: 'merge',
        });
      },
    });

    this.driverInstance = driverObj;
    driverObj.drive();
  }
}
