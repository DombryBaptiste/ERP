using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Microsoft.OpenApi.Models;
using PokeStock.Api.Data;
using PokeStock.Api.Middleware;
using PokeStock.Api.Services;

var builder = WebApplication.CreateBuilder(args);
var config = builder.Configuration;

// ---------- Base de données MySQL (Entity Framework Core + Pomelo) ----------
var connectionString = config.GetConnectionString("Default")
    ?? throw new InvalidOperationException("La chaîne de connexion 'ConnectionStrings:Default' est manquante.");
builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseMySql(connectionString, new MySqlServerVersion(new Version(8, 0, 36))));

// Application locale, sans authentification : l'API n'écoute que sur localhost (voir launchSettings.json).

// CORS : utile si le frontend est servi sur une autre origine sans proxy.
var corsOrigins = config.GetSection("Cors:Origins").Get<string[]>() ?? new[] { "http://localhost:4200" };
builder.Services.AddCors(options =>
    options.AddDefaultPolicy(policy => policy.WithOrigins(corsOrigins).AllowAnyHeader().AllowAnyMethod()));

// ---------- API ----------
builder.Services.AddControllers()
    .AddJsonOptions(o => o.JsonSerializerOptions.Converters.Add(new JsonStringEnumConverter()));

builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(c => c.SwaggerDoc("v1", new OpenApiInfo { Title = "PokéStock API", Version = "v1" }));

// Services métier
builder.Services.AddScoped<PurchaseService>();
builder.Services.AddScoped<InventoryService>();
builder.Services.AddScoped<SaleService>();
builder.Services.AddScoped<ReportingService>();
builder.Services.AddScoped<TaxService>();
builder.Services.AddScoped<SettingsStore>();
builder.Services.AddScoped<PreferencesService>();
builder.Services.AddScoped<AttachmentService>();
builder.Services.AddScoped<AlertService>();
builder.Services.AddScoped<ExportService>();
builder.Services.AddSingleton<InvoicePdfService>();

// QuestPDF : licence Community (gratuite pour les entreprises de moins de 1 M$ de chiffre d'affaires).
QuestPDF.Settings.License = QuestPDF.Infrastructure.LicenseType.Community;

var app = builder.Build();

app.UseMiddleware<ErrorHandlingMiddleware>();

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI(); // http://localhost:5000/swagger
}

app.UseCors();
app.MapControllers();
app.MapGet("/api/health", () => Results.Ok(new { status = "ok" }));

// Création automatique du schéma MySQL.
await DbInitializer.InitializeAsync(app.Services, app.Logger);

app.Run();
