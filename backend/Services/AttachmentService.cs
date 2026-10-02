using Microsoft.EntityFrameworkCore;
using PokeStock.Api.Data;
using PokeStock.Api.Dtos;
using PokeStock.Api.Models;

namespace PokeStock.Api.Services;

/// <summary>
/// Fichiers joints (photos, tickets, captures, preuves d'origine).
/// Les fichiers sont stockés sur disque dans <c>Storage:Path</c> (par défaut backend/data/uploads),
/// dans un sous-dossier par type d'élément. Pensez à sauvegarder ce dossier avec la base.
/// </summary>
public class AttachmentService(AppDbContext db, IConfiguration config, IWebHostEnvironment env)
{
    public const long MaxFileSize = 10 * 1024 * 1024; // 10 Mo

    private static readonly Dictionary<string, string> AllowedTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        [".jpg"] = "image/jpeg",
        [".jpeg"] = "image/jpeg",
        [".png"] = "image/png",
        [".webp"] = "image/webp",
        [".gif"] = "image/gif",
        [".pdf"] = "application/pdf"
    };

    private string Root => Path.GetFullPath(config["Storage:Path"] is { Length: > 0 } p
        ? Path.Combine(env.ContentRootPath, p)
        : Path.Combine(env.ContentRootPath, "data", "uploads"));

    public async Task<List<AttachmentDto>> ListAsync(AttachmentOwner owner, int ownerId)
    {
        var rows = await db.Attachments.AsNoTracking()
            .Where(a => a.OwnerType == owner && a.OwnerId == ownerId)
            .OrderBy(a => a.Kind).ThenBy(a => a.Id)
            .ToListAsync();
        return rows.Select(ToDto).ToList();
    }

    /// <summary>Première photo de chaque article (pour les vignettes de l'inventaire).</summary>
    public async Task<Dictionary<int, int>> FirstPhotoIdsAsync(IEnumerable<int> itemIds)
    {
        var ids = itemIds.ToList();
        var photos = await db.Attachments.AsNoTracking()
            .Where(a => a.OwnerType == AttachmentOwner.InventoryItem && a.Kind == AttachmentKind.Photo && ids.Contains(a.OwnerId))
            .Select(a => new { a.OwnerId, a.Id })
            .ToListAsync();
        return photos.GroupBy(p => p.OwnerId).ToDictionary(g => g.Key, g => g.Min(p => p.Id));
    }

    public async Task<AttachmentDto> SaveAsync(UploadAttachmentForm form)
    {
        var file = form.File ?? throw new BusinessException("Aucun fichier reçu.");
        if (file.Length == 0) throw new BusinessException("Le fichier est vide.");
        if (file.Length > MaxFileSize) throw new BusinessException("Fichier trop volumineux (10 Mo maximum).");

        var extension = Path.GetExtension(file.FileName);
        if (!AllowedTypes.TryGetValue(extension, out var contentType))
            throw new BusinessException("Format non accepté : images (JPG, PNG, WEBP, GIF) ou PDF uniquement.");

        await EnsureOwnerExistsAsync(form.OwnerType, form.OwnerId);

        var folder = Path.Combine(Root, form.OwnerType.ToString());
        Directory.CreateDirectory(folder);
        var storedName = $"{Guid.NewGuid():N}{extension.ToLowerInvariant()}";
        await using (var stream = File.Create(Path.Combine(folder, storedName)))
            await file.CopyToAsync(stream);

        var attachment = new Attachment
        {
            OwnerType = form.OwnerType,
            OwnerId = form.OwnerId,
            Kind = form.Kind,
            FileName = Path.GetFileName(file.FileName),
            StoredName = storedName,
            ContentType = contentType,
            Size = file.Length
        };
        db.Attachments.Add(attachment);
        await db.SaveChangesAsync();
        return ToDto(attachment);
    }

    /// <summary>Chemin physique et métadonnées d'un fichier, ou null s'il n'existe plus.</summary>
    public async Task<(string Path, string ContentType, string FileName)?> GetFileAsync(int id)
    {
        var a = await db.Attachments.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id);
        if (a is null) return null;
        var path = Path.Combine(Root, a.OwnerType.ToString(), a.StoredName);
        return File.Exists(path) ? (path, a.ContentType, a.FileName) : null;
    }

    public async Task DeleteAsync(int id)
    {
        var a = await db.Attachments.FirstOrDefaultAsync(x => x.Id == id)
                ?? throw BusinessException.NotFound("Fichier introuvable.");
        db.Attachments.Remove(a);
        await db.SaveChangesAsync();
        DeleteFile(a);
    }

    /// <summary>Supprime les fichiers d'un élément supprimé (article, achat, vente).</summary>
    public async Task DeleteForOwnerAsync(AttachmentOwner owner, params int[] ownerIds)
    {
        var rows = await db.Attachments.Where(a => a.OwnerType == owner && ownerIds.Contains(a.OwnerId)).ToListAsync();
        if (rows.Count == 0) return;
        db.Attachments.RemoveRange(rows);
        await db.SaveChangesAsync();
        rows.ForEach(DeleteFile);
    }

    private void DeleteFile(Attachment a)
    {
        var path = Path.Combine(Root, a.OwnerType.ToString(), a.StoredName);
        if (File.Exists(path)) File.Delete(path);
    }

    private async Task EnsureOwnerExistsAsync(AttachmentOwner owner, int id)
    {
        var exists = owner switch
        {
            AttachmentOwner.InventoryItem => await db.InventoryItems.AnyAsync(i => i.Id == id),
            AttachmentOwner.Purchase => await db.Purchases.AnyAsync(p => p.Id == id),
            AttachmentOwner.Sale => await db.Sales.AnyAsync(s => s.Id == id),
            _ => false
        };
        if (!exists) throw BusinessException.NotFound("Élément introuvable : enregistrez-le avant d'ajouter des fichiers.");
    }

    private static AttachmentDto ToDto(Attachment a) => new(
        a.Id, a.OwnerType, a.OwnerId, a.Kind, a.FileName, a.ContentType, a.Size,
        a.ContentType.StartsWith("image/"), a.UploadedAt, $"/api/attachments/{a.Id}/file");
}
