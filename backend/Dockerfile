# ---- Build ----
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src
COPY PokeStock.Api.csproj .
RUN dotnet restore
COPY . .
RUN dotnet publish -c Release -o /app/publish /p:UseAppHost=false

# ---- Exécution ----
FROM mcr.microsoft.com/dotnet/aspnet:8.0
# Polices nécessaires à la génération des PDF (QuestPDF)
RUN apt-get update && apt-get install -y --no-install-recommends libfontconfig1 fonts-dejavu-core && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/publish .
ENV ASPNETCORE_HTTP_PORTS=8080
EXPOSE 8080
ENTRYPOINT ["dotnet", "PokeStock.Api.dll"]
