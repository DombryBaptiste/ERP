import { BreakpointObserver } from '@angular/cdk/layout';
import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatToolbarModule } from '@angular/material/toolbar';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { map } from 'rxjs';

interface NavLink {
  path: string;
  icon: string;
  label: string;
}

/** Mise en page principale : navigation latérale fixe + barre supérieure. */
@Component({
  selector: 'app-shell',
  imports: [
    RouterOutlet, RouterLink, RouterLinkActive,
    MatSidenavModule, MatToolbarModule, MatListModule, MatIconModule, MatButtonModule
  ],
  templateUrl: './shell.component.html',
  styleUrl: './shell.component.scss'
})
export class ShellComponent {
  /** Sur mobile/tablette, le menu devient un tiroir escamotable. */
  readonly isHandset = toSignal(
    inject(BreakpointObserver).observe('(max-width: 959.98px)').pipe(map(result => result.matches)),
    { initialValue: false }
  );

  readonly links: NavLink[] = [
    { path: '/dashboard', icon: 'dashboard', label: 'Tableau de bord' },
    { path: '/purchases', icon: 'shopping_cart', label: 'Achats' },
    { path: '/inventory', icon: 'inventory_2', label: 'Inventaire' },
    { path: '/sales', icon: 'point_of_sale', label: 'Ventes' },
    { path: '/alerts', icon: 'notifications_active', label: 'Alertes' },
    { path: '/statistics', icon: 'insights', label: 'Statistiques' },
    { path: '/tax', icon: 'account_balance', label: 'Fiscalité' },
    { path: '/books', icon: 'menu_book', label: 'Registres' },
    { path: '/settings', icon: 'settings', label: 'Paramètres' }
  ];
}
