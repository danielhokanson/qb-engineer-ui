import { APP_INITIALIZER, ApplicationConfig, isDevMode, inject, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideServiceWorker } from '@angular/service-worker';
import { provideCharts, withDefaultRegisterables } from 'ng2-charts';
import { Chart } from 'chart.js';
import { SankeyController, Flow } from 'chartjs-chart-sankey';
import { provideMarkdown } from 'ngx-markdown';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { provideTranslateHttpLoader } from '@ngx-translate/http-loader';
import { MAT_DIALOG_DEFAULT_OPTIONS, MatDialogConfig } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';

Chart.register(SankeyController, Flow);

import { routes } from './app.routes';
import { authInterceptor } from './shared/interceptors/auth.interceptor';
import { capabilityGateInterceptor } from './shared/interceptors/capability-gate.interceptor';
import { etagInterceptor } from './shared/interceptors/etag.interceptor';
import { httpErrorInterceptor } from './shared/interceptors/http-error.interceptor';
import { dateTransformInterceptor } from './shared/interceptors/date-transform.interceptor';
import { kioskTokenInterceptor } from './shared/interceptors/kiosk-token.interceptor';
import { demoApiInterceptor } from './shared/interceptors/demo-api.interceptor';

function initTranslations(): () => Promise<void> {
  const translate = inject(TranslateService);
  return async () => {
    const saved = localStorage.getItem('language') || 'en';
    await firstValueFrom(translate.use(saved));
  };
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideAnimationsAsync(),
    provideRouter(routes),
    provideHttpClient(withInterceptors([demoApiInterceptor, authInterceptor, kioskTokenInterceptor, capabilityGateInterceptor, etagInterceptor, httpErrorInterceptor, dateTransformInterceptor])),
    provideCharts(withDefaultRegisterables()),
    provideMarkdown(),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
    provideTranslateService({
      defaultLanguage: 'en',
    }),
    provideTranslateHttpLoader({
      prefix: '/assets/i18n/',
      suffix: '.json',
    }),
    {
      provide: APP_INITIALIZER,
      useFactory: initTranslations,
      multi: true,
    },
    {
      // App-wide dialog defaults: backdrop click + ESC do NOT auto-close.
      // Per Dan: clicking the CDK overlay area shouldn't close a dialog
      // out from under work in progress. Each dialog still owns its
      // explicit cancel/close button. Individual dialogs that genuinely
      // want backdrop-close (image lightbox, transient hint, etc.) opt
      // out by passing `disableClose: false` to MatDialog.open().
      provide: MAT_DIALOG_DEFAULT_OPTIONS,
      useValue: { disableClose: true } satisfies MatDialogConfig,
    },
  ]
};
