namespace PokeStock.Api.Services;

/// <summary>
/// Erreur métier (validation, stock insuffisant...). Convertie en réponse JSON { message }
/// par <see cref="Middleware.ErrorHandlingMiddleware"/>.
/// </summary>
public class BusinessException(string message, int statusCode = StatusCodes.Status400BadRequest) : Exception(message)
{
    public int StatusCode { get; } = statusCode;

    public static BusinessException NotFound(string message) => new(message, StatusCodes.Status404NotFound);
    public static BusinessException Conflict(string message) => new(message, StatusCodes.Status409Conflict);
}
