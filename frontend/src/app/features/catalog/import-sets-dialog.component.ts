import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { concatMap, from } from 'rxjs';
import { normalizeText } from '../../core/products';
import { AvailableSet } from '../../core/models';
import { CatalogService } from '../../core/services/api.services';
import { NotifyService } from '../../core/services/notify.service';

interface SerieGroup {
  name: string;
  sets: AvailableSet[];
}

/**
 * Import de séries dans le catalogue depuis TCGdex. Les séries cochées sont importées une par une
 * (quelques secondes chacune) ; les cotes déjà saisies sont conservées en cas de mise à jour.
 * Ferme la boîte avec true si au moins une série a été importée.
 */
@Component({
  selector: 'app-import-sets-dialog',
  imports: [FormsModule, MatDialogModule, MatButtonModule, MatCheckboxModule, MatFormFieldModule, MatInputModule,
    MatIconModule, MatProgressBarModule],
  template: `
    <h2 mat-dialog-title>Importer des séries</h2>
    <mat-dialog-content>
      @if (loading()) {
        <mat-progress-bar mode="indeterminate" />
        <p class="muted small">Chargement des séries disponibles…</p>
      } @else if (running() || done()) {
        <p>
          {{ running() ? 'Import en cours' : 'Import terminé' }} :
          <strong>{{ progress().done }} / {{ progress().total }}</strong> série(s)
          @if (running()) { — {{ progress().current }} }
        </p>
        <mat-progress-bar mode="determinate" [value]="progress().total ? progress().done * 100 / progress().total : 0" />
        <ul class="log">
          @for (line of log(); track $index) { <li>{{ line }}</li> }
        </ul>
      } @else {
        <p class="muted small">
          Les fiches (nom, image, n° Cardmarket) viennent de TCGdex. Une série déjà importée est mise à jour :
          vos cotes sont conservées.
        </p>
        <mat-checkbox [(ngModel)]="rareOnly">
          Seulement les cartes rares (sans communes, peu communes, rares, holos, ni ex / V / VMAX / VSTAR classiques)
        </mat-checkbox>
        <mat-form-field class="search">
          <mat-label>Filtrer</mat-label>
          <mat-icon matPrefix>search</mat-icon>
          <input matInput [ngModel]="filter()" (ngModelChange)="filter.set($event)" placeholder="Nom de série ou de bloc">
        </mat-form-field>
        @for (g of groups(); track g.name) {
          <div class="group">
            <div class="group-head">
              <strong>{{ g.name }}</strong>
              <button mat-button type="button" (click)="toggleGroup(g)">
                {{ isGroupSelected(g) ? 'Tout décocher' : 'Tout cocher' }}
              </button>
            </div>
            <div class="sets">
              @for (s of g.sets; track s.setId) {
                <mat-checkbox [checked]="selected().has(s.setId)" (change)="toggle(s.setId)">
                  {{ s.name }}
                  @if (s.importedCount) { <span class="muted small">({{ s.importedCount }} déjà)</span> }
                </mat-checkbox>
              }
            </div>
          </div>
        }
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      @if (done()) {
        <button mat-flat-button (click)="close()">Fermer</button>
      } @else {
        <button mat-button (click)="close()" [disabled]="running()">Annuler</button>
        <button mat-flat-button (click)="start()" [disabled]="running() || selected().size === 0">
          <mat-icon>download</mat-icon> Importer {{ selected().size || '' }} série(s)
        </button>
      }
    </mat-dialog-actions>
  `,
  styles: `
    .search { width: 100%; margin-top: 8px; }
    .group { margin-bottom: 12px; }
    .group-head { display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--app-border); }
    .sets { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); }
    .log { max-height: 240px; overflow: auto; font-size: 13px; padding-left: 18px; }
  `
})
export class ImportSetsDialogComponent {
  private readonly api = inject(CatalogService);
  private readonly notify = inject(NotifyService);
  private readonly ref = inject(MatDialogRef<ImportSetsDialogComponent, boolean>);

  readonly loading = signal(true);
  readonly running = signal(false);
  readonly done = signal(false);
  readonly available = signal<AvailableSet[]>([]);
  readonly selected = signal(new Set<string>());
  readonly filter = signal('');
  readonly progress = signal({ done: 0, total: 0, current: '' });
  readonly log = signal<string[]>([]);
  rareOnly = true;
  private imported = 0;

  readonly groups = computed<SerieGroup[]>(() => {
    const f = normalizeText(this.filter());
    const groups: SerieGroup[] = [];
    for (const s of this.available()) {
      if (f && !normalizeText(`${s.name} ${s.serieName}`).includes(f)) continue;
      let g = groups.find(x => x.name === s.serieName);
      if (!g) groups.push(g = { name: s.serieName, sets: [] });
      g.sets.push(s);
    }
    return groups;
  });

  constructor() {
    this.ref.disableClose = true;
    this.api.availableSets().subscribe({
      next: sets => { this.available.set(sets); this.loading.set(false); },
      error: err => { this.loading.set(false); this.notify.error(err, 'Impossible de charger les séries TCGdex.'); }
    });
  }

  toggle(setId: string): void {
    this.selected.update(current => {
      const next = new Set(current);
      if (next.has(setId)) next.delete(setId); else next.add(setId);
      return next;
    });
  }

  isGroupSelected(g: SerieGroup): boolean {
    return g.sets.every(s => this.selected().has(s.setId));
  }

  toggleGroup(g: SerieGroup): void {
    const select = !this.isGroupSelected(g);
    this.selected.update(current => {
      const next = new Set(current);
      g.sets.forEach(s => select ? next.add(s.setId) : next.delete(s.setId));
      return next;
    });
  }

  start(): void {
    // Dans l'ordre affiché (récent -> ancien).
    const ids = this.available().map(s => s.setId).filter(id => this.selected().has(id));
    const names = new Map(this.available().map(s => [s.setId, s.name]));
    this.running.set(true);
    this.progress.set({ done: 0, total: ids.length, current: names.get(ids[0]) ?? '' });

    from(ids).pipe(concatMap(id => this.api.importSet(id, this.rareOnly))).subscribe({
      next: r => {
        this.imported++;
        this.log.update(l => [...l, `${r.setName} : ${r.total} carte(s) (${r.added} nouvelle(s), ${r.updated} mise(s) à jour)`]);
        this.progress.update(p => ({ ...p, done: p.done + 1, current: names.get(ids[p.done + 1]) ?? '' }));
      },
      error: err => {
        this.notify.error(err);
        this.log.update(l => [...l, `Arrêt : ${this.progress().current} n'a pas pu être importée.`]);
        this.running.set(false);
        this.done.set(true);
      },
      complete: () => {
        this.running.set(false);
        this.done.set(true);
        this.notify.success(`${this.imported} série(s) importée(s).`);
      }
    });
  }

  close(): void {
    this.ref.close(this.imported > 0);
  }
}
