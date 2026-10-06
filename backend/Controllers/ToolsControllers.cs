using Microsoft.AspNetCore.Mvc;
using PokeStock.Api.Dtos;
using PokeStock.Api.Models;
using PokeStock.Api.Services;

namespace PokeStock.Api.Controllers;

/// <summary>Fichiers joints : photos, tickets, captures d'annonces, preuves d'origine.</summary>
[ApiController]
[Route("api/attachments")]
public class AttachmentsController(AttachmentService service) : ControllerBase
{
    [HttpGet]
    public Task<List<AttachmentDto>> List([FromQuery] AttachmentOwner ownerType, [FromQuery] int ownerId) =>
        service.ListAsync(ownerType, ownerId);

    [HttpPost]
    [RequestSizeLimit(AttachmentService.MaxFileSize + 1024 * 1024)]
    public Task<AttachmentDto> Upload([FromForm] UploadAttachmentForm form) => service.SaveAsync(form);

    [HttpPut("order")]
    public async Task<IActionResult> ReorderPhotos(ReorderAttachmentsInput input)
    {
        await service.ReorderPhotosAsync(input);
        return NoContent();
    }

    /// <summary>Contenu du fichier (affiché dans le navigateur, ou téléchargé avec ?download=true).</summary>
    [HttpGet("{id:int}/file")]
    public async Task<IActionResult> GetFile(int id, [FromQuery] bool download = false)
    {
        var file = await service.GetFileAsync(id);
        if (file is null) return NotFound(new { message = "Fichier introuvable." });
        var (path, contentType, fileName) = file.Value;
        return download ? PhysicalFile(path, contentType, fileName) : PhysicalFile(path, contentType);
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id)
    {
        await service.DeleteAsync(id);
        return NoContent();
    }
}

/// <summary>Alertes : valeur de marché en hausse, stock dormant.</summary>
[ApiController]
[Route("api/alerts")]
public class AlertsController(AlertService service) : ControllerBase
{
    [HttpGet]
    public Task<AlertsDto> Get() => service.GetAsync();
}

/// <summary>Exports comptables (livre des recettes, registre des achats) en Excel ou PDF.</summary>
[ApiController]
[Route("api/exports")]
public class ExportsController(ExportService service) : ControllerBase
{
    [HttpGet("receipts")]
    public async Task<IActionResult> Receipts([FromQuery] int? year, [FromQuery] string format = "xlsx")
    {
        var file = await service.ReceiptsFileAsync(year ?? DateTime.Today.Year, format);
        return File(file.Content, file.ContentType, file.FileName);
    }

    [HttpGet("purchases")]
    public async Task<IActionResult> Purchases([FromQuery] int? year, [FromQuery] string format = "xlsx")
    {
        var file = await service.PurchasesFileAsync(year ?? DateTime.Today.Year, format);
        return File(file.Content, file.ContentType, file.FileName);
    }
}

/// <summary>Préférences : informations de l'entreprise (factures) et seuils d'alerte.</summary>
[ApiController]
[Route("api/settings")]
public class SettingsController(PreferencesService service) : ControllerBase
{
    [HttpGet]
    public Task<AppPreferences> Get() => service.GetAsync();

    [HttpPut]
    public Task<AppPreferences> Save(AppPreferences preferences) => service.SaveAsync(preferences);
}

/// <summary>Réglages du bulk (cartes en vrac vendues au lot).</summary>
[ApiController]
[Route("api/bulk/settings")]
public class BulkSettingsController(BulkSettingsService service) : ControllerBase
{
    [HttpGet]
    public Task<BulkSettings> Get() => service.GetAsync();

    [HttpPut]
    public Task<BulkSettings> Save(BulkSettings settings) => service.SaveAsync(settings);
}
