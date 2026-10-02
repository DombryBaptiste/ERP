# ---- Build Angular ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# ---- Serveur web (Nginx) : fichiers statiques + proxy /api vers le backend ----
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/pokestock/browser /usr/share/nginx/html
EXPOSE 80
