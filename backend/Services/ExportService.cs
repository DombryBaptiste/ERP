using ClosedXML.Excel;
using Microsoft.EntityFrameworkCore;
using PokeStock.Api.Data;
using PokeStock.Api.Dtos;
using PokeStock.Api.Models;
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;

namespace PokeStock.Api.Services;

/// <summary>
/// Exports comptables obligatoires d'une micro-entreprise d'achat-revente :
/// - livre des recettes : chaque encaissement (date, référence, client, nature, montant, mode de règlement),
///   les remboursements apparaissant en négatif à leur date ;
/// - registre des achats : chaque achat (date, référence, fournisseur, nature, montant, mode de règlement),
///   plus, à part, les transferts depuis la collection personnelle (pour la traçabilité).
/// Formats : Excel (.xlsx) ou PDF.
/// </summary>
public class ExportService(AppDbContext db, PreferencesService preferences)
{
    public record BookLine(DateTime Date, string Reference, string Party, string Description, string Payment, decimal Amount);

    public record ExportFile(byte[] Content, string ContentType, string FileName);

    private const string XlsxType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

    // ---------------------------------------------------------------
    // Données
    // ---------------------------------------------------------------

    public async Task<List<BookLine>> ReceiptsAsync(int year)
    {
        var (start, end) = Range(year);
        var sales = await db.Sales.AsNoTracking()
            .Include(s => s.Items).ThenInclude(i => i.InventoryItem)
            .Where(s => s.SaleDate >= start && s.SaleDate < end)
            .ToListAsync();
        var refunds = await db.SaleRefunds.AsNoTracking()
            .Include(r => r.Sale)
            .Where(r => r.RefundDate >= start && r.RefundDate < end && r.Amount > 0)
            .ToListAsync();

        var lines = sales.Select(s => new BookLine(
            s.SaleDate,
            s.InvoiceNumber is null ? s.SaleNumber : $"{s.SaleNumber} / {s.InvoiceNumber}",
            s.Customer ?? "Client particulier",
            $"Vente ({s.Platform.Label()}) : {Describe(s.Items.Select(i => (i.InventoryItem.Name, i.Quantity)))}",
            s.PaymentMethod.Label(),
            s.TotalAmount));

        var refundLines = refunds.Select(r => new BookLine(
            r.RefundDate,
            $"{r.Sale.SaleNumber} (remb.)",
            r.Sale.Customer ?? "Client particulier",
            "Remboursement" + (r.Reason is null ? "" : $" : {r.Reason}"),
            r.Sale.PaymentMethod.Label(),
            -r.Amount));

        return lines.Concat(refundLines).OrderBy(l => l.Date).ThenBy(l => l.Reference).ToList();
    }

    public async Task<(List<BookLine> Purchases, List<BookLine> Transfers)> PurchasesAsync(int year)
    {
        var (start, end) = Range(year);
        var purchases = await db.Purchases.AsNoTracking()
            .Include(p => p.Items).ThenInclude(i => i.Item)
            .Where(p => p.PurchaseDate >= start && p.PurchaseDate < end)
            .OrderBy(p => p.PurchaseDate).ThenBy(p => p.PurchaseNumber)
            .ToListAsync();

        BookLine ToLine(Purchase p) => new(
            p.PurchaseDate, p.PurchaseNumber, p.Supplier,
            Describe(p.Items.Select(i => (i.Item.Name, i.Quantity))),
            p.PaymentMethod?.Label() ?? (p.Source == PurchaseSource.PersonalCollection ? "—" : "Non renseigné"),
            p.TotalAmount);

        return (
            purchases.Where(p => p.Source == PurchaseSource.Supplier).Select(ToLine).ToList(),
            purchases.Where(p => p.Source == PurchaseSource.PersonalCollection).Select(ToLine).ToList());
    }

    // ---------------------------------------------------------------
    // Fichiers
    // ---------------------------------------------------------------

    public async Task<ExportFile> ReceiptsFileAsync(int year, string format)
    {
        var lines = await ReceiptsAsync(year);
        var title = $"Livre des recettes {year}";
        var name = $"livre-des-recettes-{year}";
        return IsPdf(format)
            ? new ExportFile(await PdfAsync(title, [("Encaissements", lines)]), "application/pdf", name + ".pdf")
            : new ExportFile(Excel(title, [("Livre des recettes", lines)], "Client"), XlsxType, name + ".xlsx");
    }

    public async Task<ExportFile> PurchasesFileAsync(int year, string format)
    {
        var (purchases, transfers) = await PurchasesAsync(year);
        var title = $"Registre des achats {year}";
        var name = $"registre-des-achats-{year}";
        var sections = new List<(string, List<BookLine>)> { ("Achats", purchases) };
        if (transfers.Count > 0) sections.Add(("Transferts depuis la collection personnelle (hors achats)", transfers));
        return IsPdf(format)
            ? new ExportFile(await PdfAsync(title, sections), "application/pdf", name + ".pdf")
            : new ExportFile(Excel(title, sections, "Fournisseur"), XlsxType, name + ".xlsx");
    }

    private static byte[] Excel(string title, List<(string Name, List<BookLine> Lines)> sections, string partyLabel)
    {
        using var workbook = new XLWorkbook();
        foreach (var (name, lines) in sections)
        {
            // Nom d'onglet Excel : 31 caractères maximum.
            var ws = workbook.Worksheets.Add(name.Length > 31 ? name[..31] : name);
            ws.Cell(1, 1).Value = $"{title} — {name}";
            ws.Cell(1, 1).Style.Font.Bold = true;
            ws.Cell(1, 1).Style.Font.FontSize = 14;

            string[] headers = ["Date", "Référence", partyLabel, "Nature", "Mode de règlement", "Montant (€)"];
            for (var c = 0; c < headers.Length; c++)
            {
                var cell = ws.Cell(3, c + 1);
                cell.Value = headers[c];
                cell.Style.Font.Bold = true;
                cell.Style.Font.FontColor = XLColor.White;
                cell.Style.Fill.BackgroundColor = XLColor.FromHtml("#283593");
            }

            var row = 4;
            foreach (var l in lines)
            {
                ws.Cell(row, 1).Value = l.Date;
                ws.Cell(row, 2).Value = l.Reference;
                ws.Cell(row, 3).Value = l.Party;
                ws.Cell(row, 4).Value = l.Description;
                ws.Cell(row, 5).Value = l.Payment;
                ws.Cell(row, 6).Value = (double)l.Amount;
                row++;
            }

            ws.Cell(row, 5).Value = "TOTAL";
            ws.Cell(row, 5).Style.Font.Bold = true;
            ws.Cell(row, 6).Value = (double)lines.Sum(l => l.Amount);
            ws.Cell(row, 6).Style.Font.Bold = true;

            ws.Column(1).Style.DateFormat.Format = "dd/mm/yyyy";
            ws.Column(6).Style.NumberFormat.Format = "#,##0.00 €;-#,##0.00 €";
            ws.Column(1).Width = 12;
            ws.Column(2).Width = 22;
            ws.Column(3).Width = 26;
            ws.Column(4).Width = 60;
            ws.Column(5).Width = 18;
            ws.Column(6).Width = 14;
            ws.SheetView.FreezeRows(3);
        }

        using var stream = new MemoryStream();
        workbook.SaveAs(stream);
        return stream.ToArray();
    }

    private async Task<byte[]> PdfAsync(string title, List<(string Name, List<BookLine> Lines)> sections)
    {
        var company = (await preferences.GetAsync()).Company;
        var owner = string.IsNullOrWhiteSpace(company.FullName) ? "" : $"{company.TradeName ?? company.FullName} — {company.FullName} EI";
        var siret = string.IsNullOrWhiteSpace(company.Siret) ? "" : $"SIRET {company.Siret}";

        return Document.Create(doc => doc.Page(page =>
        {
            page.Size(PageSizes.A4.Landscape());
            page.Margin(30);
            page.DefaultTextStyle(t => t.FontSize(9));

            page.Header().Column(col =>
            {
                col.Item().Text(title).FontSize(16).Bold().FontColor("#283593");
                if (owner.Length > 0) col.Item().Text($"{owner}   {siret}").FontColor(Colors.Grey.Darken1);
                col.Item().Text($"Édité le {DateTime.Today:dd/MM/yyyy}").FontColor(Colors.Grey.Darken1);
            });

            page.Content().PaddingVertical(12).Column(col =>
            {
                col.Spacing(16);
                foreach (var (name, lines) in sections)
                {
                    col.Item().Text(name).FontSize(12).Bold();
                    col.Item().Table(table =>
                    {
                        table.ColumnsDefinition(c =>
                        {
                            c.ConstantColumn(62);
                            c.RelativeColumn(2);
                            c.RelativeColumn(2.5f);
                            c.RelativeColumn(6);
                            c.RelativeColumn(1.6f);
                            c.RelativeColumn(1.4f);
                        });
                        table.Header(h =>
                        {
                            foreach (var label in new[] { "Date", "Référence", "Tiers", "Nature", "Règlement", "Montant" })
                                h.Cell().Background("#283593").Padding(4).Text(label).FontColor(Colors.White).Bold();
                        });
                        foreach (var l in lines)
                        {
                            table.Cell().Element(Cell).Text(l.Date.ToString("dd/MM/yyyy"));
                            table.Cell().Element(Cell).Text(l.Reference);
                            table.Cell().Element(Cell).Text(l.Party);
                            table.Cell().Element(Cell).Text(l.Description);
                            table.Cell().Element(Cell).Text(l.Payment);
                            table.Cell().Element(Cell).AlignRight().Text(InvoicePdfService.Money(l.Amount));
                        }
                        table.Cell().ColumnSpan(5).Element(Cell).AlignRight().Text("TOTAL").Bold();
                        table.Cell().Element(Cell).AlignRight().Text(InvoicePdfService.Money(lines.Sum(l => l.Amount))).Bold();
                    });
                    if (lines.Count == 0) col.Item().Text("Aucune opération sur la période.").Italic();
                }
            });

            page.Footer().AlignCenter().Text(t =>
            {
                t.Span("Page ").FontSize(8);
                t.CurrentPageNumber().FontSize(8);
                t.Span(" / ").FontSize(8);
                t.TotalPages().FontSize(8);
            });
        })).GeneratePdf();
    }

    private static IContainer Cell(IContainer c) => c.BorderBottom(0.5f).BorderColor("#d5dae3").Padding(4);

    private static string Describe(IEnumerable<(string Name, int Quantity)> items) =>
        string.Join(", ", items.Select(i => i.Quantity > 1 ? $"{i.Name} ×{i.Quantity}" : i.Name));

    private static (DateTime Start, DateTime End) Range(int year) => (new DateTime(year, 1, 1), new DateTime(year + 1, 1, 1));

    private static bool IsPdf(string format) => string.Equals(format, "pdf", StringComparison.OrdinalIgnoreCase);
}
