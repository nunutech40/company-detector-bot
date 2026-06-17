FROM golang:1.22-bookworm AS go-builder

WORKDIR /src/go-service
COPY go-service/go.mod ./
COPY go-service/ ./
RUN go build -o /out/company-check ./cmd/company-check \
    && go build -o /out/tool-status ./cmd/tool-status \
    && go build -o /out/last-report ./cmd/last-report

FROM node:24-bookworm-slim AS runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends bash ca-certificates curl git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY dashboard/package*.json ./dashboard/
COPY webhook/package*.json ./webhook/
COPY openclaw_workspace/package*.json ./openclaw_workspace/
COPY review_monitor/package*.json ./review_monitor/
COPY feedback_monitor/package*.json ./feedback_monitor/

RUN cd dashboard && npm ci --omit=dev \
    && cd ../webhook && npm ci --omit=dev \
    && cd ../openclaw_workspace && npm ci --omit=dev \
    && cd ../review_monitor && npm install --omit=dev \
    && cd ../feedback_monitor && npm install --omit=dev \
    && npm install -g openclaw@2026.5.12

COPY dashboard/ ./dashboard/
COPY webhook/ ./webhook/
COPY openclaw_workspace/ ./openclaw_workspace/
COPY review_monitor/ ./review_monitor/
COPY feedback_monitor/ ./feedback_monitor/
COPY ops/docker/ ./ops/docker/
COPY --from=go-builder /out/company-check /app/go-service/bin/company-check
COPY --from=go-builder /out/tool-status /app/go-service/bin/tool-status
COPY --from=go-builder /out/last-report /app/go-service/bin/last-report

RUN chmod +x /app/go-service/bin/company-check /app/go-service/bin/tool-status /app/go-service/bin/last-report \
    /app/openclaw_workspace/scripts/*.sh \
    && chmod +x /app/ops/docker/*.sh /app/ops/docker/*.js /app/review_monitor/*.js /app/feedback_monitor/*.js \
    && mkdir -p /app/openclaw_workspace/reports /app/openclaw_workspace/evidence /app/openclaw_workspace/exports /app/review_monitor/state

ENV OPENCLAW_WORKSPACE=/app/openclaw_workspace
ENV COMPANY_CHECK_BIN=/app/go-service/bin/company-check
ENV OPENCLAW_STATE_DIR=/root/.openclaw
ENV OPENCLAW_CONFIG_PATH=/root/.openclaw/openclaw.json

CMD ["node", "dashboard/app.js"]
