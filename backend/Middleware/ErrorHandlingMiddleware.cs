using Microsoft.EntityFrameworkCore;
using PokeStock.Api.Services;

namespace PokeStock.Api.Middleware;

/// <summary>
/// Transforme les exceptions en réponses JSON homogènes : { "message": "..." }.
/// </summary>
public class ErrorHandlingMiddleware(RequestDelegate next, ILogger<ErrorHandlingMiddleware> logger)
{
    public async Task InvokeAsync(HttpContext context)
    {
        try
        {
            await next(context);
        }
        catch (BusinessException ex)
        {
            await WriteAsync(context, ex.StatusCode, ex.Message);
        }
        catch (DbUpdateException ex)
        {
            logger.LogError(ex, "Erreur d'enregistrement en base");
            await WriteAsync(context, StatusCodes.Status409Conflict,
                "Conflit lors de l'enregistrement en base de données. Réessayez.");
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Erreur non gérée");
            await WriteAsync(context, StatusCodes.Status500InternalServerError, "Une erreur interne est survenue.");
        }
    }

    private static async Task WriteAsync(HttpContext context, int statusCode, string message)
    {
        if (context.Response.HasStarted) return;
        context.Response.Clear();
        context.Response.StatusCode = statusCode;
        await context.Response.WriteAsJsonAsync(new { message });
    }
}
