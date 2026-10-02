import { Routes } from '@angular/router';
import { ShellComponent } from './layout/shell.component';

export const routes: Routes = [
  {
    path: '',
    component: ShellComponent,
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      {
        path: 'dashboard', title: 'Tableau de bord — PokéStock',
        loadComponent: () => import('./features/dashboard/dashboard.component').then(m => m.DashboardComponent)
      },
      {
        path: 'purchases', title: 'Achats — PokéStock',
        loadComponent: () => import('./features/purchases/purchase-list.component').then(m => m.PurchaseListComponent)
      },
      {
        path: 'purchases/new', title: 'Nouvel achat — PokéStock',
        loadComponent: () => import('./features/purchases/purchase-form.component').then(m => m.PurchaseFormComponent)
      },
      {
        path: 'purchases/:id', title: 'Achat — PokéStock',
        loadComponent: () => import('./features/purchases/purchase-form.component').then(m => m.PurchaseFormComponent)
      },
      {
        path: 'inventory', title: 'Inventaire — PokéStock',
        loadComponent: () => import('./features/inventory/inventory-list.component').then(m => m.InventoryListComponent)
      },
      {
        path: 'inventory/new', title: 'Nouvel article — PokéStock',
        loadComponent: () => import('./features/inventory/inventory-form.component').then(m => m.InventoryFormComponent)
      },
      {
        path: 'inventory/:id', title: 'Article — PokéStock',
        loadComponent: () => import('./features/inventory/inventory-form.component').then(m => m.InventoryFormComponent)
      },
      {
        path: 'sales', title: 'Ventes — PokéStock',
        loadComponent: () => import('./features/sales/sales-list.component').then(m => m.SalesListComponent)
      },
      {
        path: 'sales/new', title: 'Nouvelle vente — PokéStock',
        loadComponent: () => import('./features/sales/sales-form.component').then(m => m.SalesFormComponent)
      },
      {
        path: 'sales/:id', title: 'Vente — PokéStock',
        loadComponent: () => import('./features/sales/sales-form.component').then(m => m.SalesFormComponent)
      },
      {
        path: 'statistics', title: 'Statistiques — PokéStock',
        loadComponent: () => import('./features/statistics/statistics.component').then(m => m.StatisticsComponent)
      },
      {
        path: 'tax', title: 'Fiscalité — PokéStock',
        loadComponent: () => import('./features/tax/tax.component').then(m => m.TaxComponent)
      },
      {
        path: 'alerts', title: 'Alertes — PokéStock',
        loadComponent: () => import('./features/alerts/alerts.component').then(m => m.AlertsComponent)
      },
      {
        path: 'books', title: 'Registres — PokéStock',
        loadComponent: () => import('./features/books/books.component').then(m => m.BooksComponent)
      },
      {
        path: 'settings', title: 'Paramètres — PokéStock',
        loadComponent: () => import('./features/settings/settings.component').then(m => m.SettingsComponent)
      }
    ]
  },
  { path: '**', redirectTo: '' }
];
