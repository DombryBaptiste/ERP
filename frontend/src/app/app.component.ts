import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

/** Composant racine : la mise en page (menu latéral) est portée par ShellComponent. */
@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  template: '<router-outlet />'
})
export class AppComponent {}
