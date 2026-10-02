import { Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { RouterLink } from '@angular/router';
import { ToolsService } from '../../core/services/api.services';

/** Registres comptables obligatoires : livre des recettes et registre des achats (Excel / PDF). */
@Component({
  selector: 'app-books',
  imports: [RouterLink, MatCardModule, MatButtonModule, MatIconModule, MatFormFieldModule, MatSelectModule],
  templateUrl: './books.component.html',
  styles: `
    .books-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 20px; }
    .books-grid .card { margin-bottom: 0; }
    .book-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
    .tips li { margin-bottom: 6px; font-size: 14px; line-height: 1.5; }
    .year-select { width: 140px; }
  `
})
export class BooksComponent {
  private readonly api = inject(ToolsService);

  readonly currentYear = new Date().getFullYear();
  readonly years = Array.from({ length: 6 }, (_, i) => this.currentYear - i);
  readonly year = signal(this.currentYear);

  url(book: 'receipts' | 'purchases', format: 'xlsx' | 'pdf'): string {
    return this.api.exportUrl(book, this.year(), format);
  }
}
