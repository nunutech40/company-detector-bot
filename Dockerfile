FROM golang:1.22-bookworm AS go-builder

WORKDIR /src/go-service
COPY go-service/go.mod ./
COPY go-service/ ./
RUN go build -o /out/company-check ./cmd/company-check

FROM node:20-bookworm-slim AS runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends bash ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY dashboard/package*.json ./dashboard/
COPY webhook/package*.json ./webhook/
COPY openclaw_workspace/package*.json ./openclaw_workspace/

RUN cd dashboard && npm ci --omit=dev \
    && cd ../webhook && npm ci --omit=dev \
    && cd ../openclaw_workspace && npm ci --omit=dev

COPY dashboard/ ./dashboard/
COPY webhook/ ./webhook/
COPY openclaw_workspace/ ./openclaw_workspace/
COPY --from=go-builder /out/company-check /app/go-service/bin/company-check

RUN chmod +x /app/go-service/bin/company-check /app/openclaw_workspace/scripts/*.sh \
    && mkdir -p /app/openclaw_workspace/reports /app/openclaw_workspace/evidence /app/openclaw_workspace/exports

ENV OPENCLAW_WORKSPACE=/app/openclaw_workspace
ENV COMPANY_CHECK_BIN=/app/go-service/bin/company-check

CMD ["node", "dashboard/app.js"]
