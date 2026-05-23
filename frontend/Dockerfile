FROM node:20-alpine AS build

WORKDIR /app/frontend

ARG VITE_API_BASE=/api/v1
ENV VITE_API_BASE=${VITE_API_BASE}

COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

FROM nginx:1.27-alpine

COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html

EXPOSE 80
