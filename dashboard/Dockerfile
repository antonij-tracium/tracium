FROM node:24-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit
COPY . .
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.31-alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/templates/default.conf.template
ENV API_UPSTREAM=http://api:8090
EXPOSE 3000
CMD ["nginx", "-g", "daemon off;"]
