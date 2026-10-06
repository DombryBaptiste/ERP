using System.Globalization;
using PokeStock.Api.Dtos;
using PokeStock.Api.Models;
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;

namespace PokeStock.Api.Services;

/// <summary>
/// Génère la facture PDF d'une vente (bibliothèque QuestPDF).
/// Mentions d'une micro-entreprise en franchise de TVA : identité + « EI », SIRET, adresse, numéro et date,
/// client, désignation, quantités, prix, total, « TVA non applicable, art. 293 B du CGI », conditions de paiement.
/// </summary>
public class InvoicePdfService
{
    private static readonly CultureInfo Fr = CultureInfo.GetCultureInfo("fr-FR");
    private const string Accent = "#283593";

    public byte[] Generate(Sale sale, CompanyInfo company)
    {
        if (sale.InvoiceNumber is null || sale.InvoiceDate is null)
            throw new BusinessException("Aucune facture n'a été émise pour cette vente.");
        if (string.IsNullOrWhiteSpace(company.FullName) || string.IsNullOrWhiteSpace(company.Siret) || string.IsNullOrWhiteSpace(company.Address))
            throw new BusinessException("Complétez « Mon entreprise » (nom, SIRET, adresse) dans Paramètres avant d'éditer une facture.");

        var isProfessional = !string.IsNullOrWhiteSpace(sale.CustomerSiren);

        return Document.Create(doc => doc.Page(page =>
        {
            page.Size(PageSizes.A4);
            page.Margin(40);
            page.DefaultTextStyle(t => t.FontSize(10).FontColor("#1d2330"));

            // ---------- En-tête : vendeur + numéro ----------
            page.Header().Row(row =>
            {
                row.RelativeItem().Column(col =>
                {
                    col.Item().Text(company.TradeName ?? company.FullName).FontSize(18).Bold().FontColor(Accent);
                    if (!string.IsNullOrWhiteSpace(company.TradeName))
                        col.Item().Text($"{company.FullName} EI");
                    else
                        col.Item().Text("Entrepreneur individuel (EI)");
                    foreach (var line in Lines(company.Address)) col.Item().Text(line);
                    col.Item().Text($"SIRET : {FormatSiret(company.Siret!)}");
                    if (!string.IsNullOrWhiteSpace(company.Email)) col.Item().Text(company.Email);
                    if (!string.IsNullOrWhiteSpace(company.Phone)) col.Item().Text(company.Phone);
                });
                row.ConstantItem(200).AlignRight().Column(col =>
                {
                    col.Item().AlignRight().Text("FACTURE").FontSize(24).Bold().FontColor(Accent);
                    col.Item().AlignRight().Text($"N° {sale.InvoiceNumber}").Bold();
                    col.Item().AlignRight().Text($"Date d'émission : {sale.InvoiceDate:dd/MM/yyyy}");
                    col.Item().AlignRight().Text($"Date de la vente : {sale.SaleDate:dd/MM/yyyy}");
                    col.Item().AlignRight().Text($"Réf. vente : {sale.SaleNumber}").FontColor(Colors.Grey.Darken1);
                });
            });

            page.Content().PaddingVertical(24).Column(col =>
            {
                col.Spacing(18);

                // ---------- Client ----------
                col.Item().Row(row =>
                {
                    row.RelativeItem();
                    row.ConstantItem(250).Background("#f3f5f9").Padding(12).Column(c =>
                    {
                        c.Item().Text("Facturé à").FontSize(9).FontColor(Colors.Grey.Darken1);
                        c.Item().Text(sale.Customer ?? "").Bold();
                        foreach (var line in Lines(sale.CustomerAddress)) c.Item().Text(line);
                        if (isProfessional) c.Item().Text($"SIREN : {sale.CustomerSiren}");
                    });
                });

                // ---------- Lignes ----------
                col.Item().Table(table =>
                {
                    table.ColumnsDefinition(c =>
                    {
                        c.RelativeColumn(6);
                        c.RelativeColumn(1.2f);
                        c.RelativeColumn(2);
                        c.RelativeColumn(2);
                    });

                    table.Header(h =>
                    {
                        h.Cell().Element(HeaderCell).Text("Désignation");
                        h.Cell().Element(HeaderCell).AlignRight().Text("Qté");
                        h.Cell().Element(HeaderCell).AlignRight().Text("Prix unitaire");
                        h.Cell().Element(HeaderCell).AlignRight().Text("Total");
                    });

                    foreach (var item in sale.Items.OrderBy(i => i.Id))
                    {
                        table.Cell().Element(BodyCell).Text(item.InventoryItem.Name);
                        table.Cell().Element(BodyCell).AlignRight().Text(item.Quantity.ToString(Fr));
                        table.Cell().Element(BodyCell).AlignRight().Text(UnitMoney(item.SalePrice));
                        table.Cell().Element(BodyCell).AlignRight().Text(Money(item.Quantity * item.SalePrice));
                    }
                });

                // ---------- Totaux ----------
                col.Item().AlignRight().Width(250).Column(c =>
                {
                    c.Item().Row(r =>
                    {
                        r.RelativeItem().Text("Total HT");
                        r.RelativeItem().AlignRight().Text(Money(sale.TotalAmount));
                    });
                    c.Item().Row(r =>
                    {
                        r.RelativeItem().Text("TVA");
                        r.RelativeItem().AlignRight().Text("0,00 €");
                    });
                    c.Item().PaddingTop(6).BorderTop(1).BorderColor(Accent).PaddingTop(6).Row(r =>
                    {
                        r.RelativeItem().Text("Total à payer").Bold().FontSize(12);
                        r.RelativeItem().AlignRight().Text(Money(sale.TotalAmount)).Bold().FontSize(12).FontColor(Accent);
                    });
                });

                // ---------- Mentions ----------
                col.Item().Column(c =>
                {
                    c.Spacing(3);
                    c.Item().Text(company.VatMention).Bold();
                    c.Item().Text("Nature de l'opération : livraison de biens.");
                    c.Item().Text($"Payée le {sale.SaleDate:dd/MM/yyyy} — mode de règlement : {sale.PaymentMethod.Label()}.");
                    if (!string.IsNullOrWhiteSpace(company.Iban)) c.Item().Text($"IBAN : {company.Iban}");
                    if (isProfessional)
                    {
                        c.Item().Text("Pas d'escompte pour paiement anticipé. En cas de retard de paiement : pénalités au taux de 3 fois le taux " +
                                      "d'intérêt légal et indemnité forfaitaire pour frais de recouvrement de 40 € (art. L441-10 du Code de commerce).")
                            .FontSize(8).FontColor(Colors.Grey.Darken1);
                    }
                });
            });

            page.Footer().Column(col =>
            {
                if (!string.IsNullOrWhiteSpace(company.InvoiceFooter))
                    col.Item().AlignCenter().Text(company.InvoiceFooter).Italic().FontColor(Colors.Grey.Darken1);
                col.Item().AlignCenter().Text(t =>
                {
                    t.Span($"{company.TradeName ?? company.FullName} — SIRET {FormatSiret(company.Siret!)} — page ").FontSize(8).FontColor(Colors.Grey.Medium);
                    t.CurrentPageNumber().FontSize(8).FontColor(Colors.Grey.Medium);
                    t.Span(" / ").FontSize(8).FontColor(Colors.Grey.Medium);
                    t.TotalPages().FontSize(8).FontColor(Colors.Grey.Medium);
                });
            });
        })).GeneratePdf();
    }

    private static IContainer HeaderCell(IContainer c) =>
        c.Background(Accent).PaddingVertical(6).PaddingHorizontal(8).DefaultTextStyle(t => t.FontColor(Colors.White).Bold());

    private static IContainer BodyCell(IContainer c) =>
        c.BorderBottom(1).BorderColor("#e3e7ee").PaddingVertical(6).PaddingHorizontal(8);

    private static IEnumerable<string> Lines(string? text) =>
        (text ?? "").Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

    /// <summary>Montant au format français (espaces normales : la police n'a pas toujours l'espace fine).</summary>
    /// <summary>Prix unitaire : jusqu'à 4 décimales quand il le faut (cartes de bulk à 0,1333 €).</summary>
    public static string UnitMoney(decimal value) =>
        value == Math.Round(value, 2)
            ? Money(value)
            : Math.Round(value, 4).ToString("#,##0.00##", Fr).Replace(' ', ' ').Replace(' ', ' ') + " €";

    public static string Money(decimal value) =>
        value.ToString("N2", Fr).Replace(' ', ' ').Replace(' ', ' ') + " €";

    private static string FormatSiret(string siret) =>
        siret.Length == 14 ? $"{siret[..3]} {siret[3..6]} {siret[6..9]} {siret[9..]}" : siret;
}
