import { registerLocaleData } from '@angular/common';
import localeFr from '@angular/common/locales/fr';
import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { appConfig } from './app/app.config';

// Formats français : dates (30/09/2026), montants (1 234,56 €).
registerLocaleData(localeFr);

bootstrapApplication(AppComponent, appConfig).catch(err => console.error(err));
