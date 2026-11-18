# ---- build ----
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npx prisma generate && npx next build

# ---- run ----
FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3000
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
COPY --from=build /app ./
EXPOSE 3000
CMD ["sh", "-c", "npx prisma db push --skip-generate && npx next start"]
