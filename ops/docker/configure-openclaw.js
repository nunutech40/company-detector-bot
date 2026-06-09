#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const stateDir = process.env.OPENCLAW_STATE_DIR || path.join(process.env.HOME || '/root', '.openclaw');
const configPath = process.env.OPENCLAW_CONFIG_PATH || path.join(stateDir, 'openclaw.json');
const workspace = process.env.OPENCLAW_WORKSPACE || '/app/openclaw_workspace';

const providerName = process.env.LLM_PROVIDER || 'sumopod';
const baseUrl = process.env.LLM_BASE_URL || 'https://ai.sumopod.com/v1';
const primaryModel = process.env.LLM_PRIMARY_MODEL || `${providerName}/kimi-k2.6`;
const modelId = process.env.LLM_MODEL_ID || primaryModel.split('/').pop();
const additionalModels = splitList(process.env.LLM_ADDITIONAL_MODELS);

fs.mkdirSync(stateDir, { recursive: true });
fs.mkdirSync(path.dirname(configPath), { recursive: true });

const cfg = readConfig(configPath);

cfg.agents = cfg.agents || {};
cfg.agents.defaults = cfg.agents.defaults || {};
cfg.agents.defaults.model = cfg.agents.defaults.model || {};
cfg.agents.defaults.model.primary = primaryModel;
cfg.agents.list = Array.isArray(cfg.agents.list) ? cfg.agents.list : [];
upsertById(cfg.agents.list, { id: 'main', workspace });

cfg.gateway = cfg.gateway || {};
cfg.gateway.mode = cfg.gateway.mode || 'local';
cfg.gateway.port = Number(process.env.OPENCLAW_GATEWAY_PORT || cfg.gateway.port || 18789);
cfg.gateway.bind = process.env.OPENCLAW_GATEWAY_BIND || cfg.gateway.bind || 'loopback';

cfg.models = cfg.models || {};
cfg.models.providers = cfg.models.providers || {};
const provider = cfg.models.providers[providerName] || {};
provider.baseUrl = baseUrl;
delete provider.baseURL;
if (process.env.LLM_API_KEY) provider.apiKey = process.env.LLM_API_KEY;
provider.models = Array.isArray(provider.models) ? provider.models : [];
upsertModel(provider.models, modelId);
for (const id of additionalModels) upsertModel(provider.models, id);
delete provider.timeoutSeconds;
cfg.models.providers[providerName] = provider;

cfg.channels = cfg.channels || {};
if (process.env.TELEGRAM_DEFAULT_BOT_TOKEN || process.env.TELEGRAM_ASSISTANT_BOT_TOKEN) {
  cfg.channels.telegram = cfg.channels.telegram || {};
  cfg.channels.telegram.enabled = true;
  cfg.channels.telegram.accounts = cfg.channels.telegram.accounts || {};
  if (process.env.TELEGRAM_DEFAULT_BOT_TOKEN) {
    cfg.channels.telegram.accounts.default = {
      ...(cfg.channels.telegram.accounts.default || {}),
      botToken: process.env.TELEGRAM_DEFAULT_BOT_TOKEN,
      dmPolicy: 'pairing',
    };
  }
  if (process.env.TELEGRAM_ASSISTANT_BOT_TOKEN) {
    cfg.channels.telegram.accounts.assistant = {
      ...(cfg.channels.telegram.accounts.assistant || {}),
      botToken: process.env.TELEGRAM_ASSISTANT_BOT_TOKEN,
      dmPolicy: 'pairing',
    };
  }
}

writeAllowFrom('telegram-default-allowFrom.json', process.env.TELEGRAM_ALLOW_FROM);
writeAllowFrom('telegram-assistant-allowFrom.json', process.env.TELEGRAM_ASSISTANT_ALLOW_FROM);

fs.writeFileSync(configPath, `${JSON.stringify(cfg, null, 2)}\n`, { mode: 0o600 });
console.log(`OpenClaw config ready: provider=${providerName} primary=${primaryModel} config=${configPath}`);

function readConfig(filePath) {
  if (!fs.existsSync(filePath)) {
    return {
      agents: { defaults: { model: {} }, list: [] },
      gateway: { mode: 'local', port: 18789, bind: 'loopback' },
      models: { providers: {} },
      tools: { profile: 'coding' },
      channels: {},
    };
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function upsertById(rows, next) {
  const idx = rows.findIndex((row) => row.id === next.id);
  if (idx === -1) rows.push(next);
  else rows[idx] = { ...rows[idx], ...next };
}

function upsertModel(models, id) {
  if (!id) return;
  if (!models.some((model) => (model.id || model.name) === id)) {
    models.push({ id, name: id, cost: { input: 0, output: 0 } });
  }
}

function splitList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => item.includes('/') ? item.split('/').pop() : item);
}

function writeAllowFrom(filename, value) {
  const allowFrom = splitList(value);
  if (!allowFrom.length) return;
  const credentialsDir = path.join(stateDir, 'credentials');
  fs.mkdirSync(credentialsDir, { recursive: true });
  fs.writeFileSync(
    path.join(credentialsDir, filename),
    `${JSON.stringify({ version: 1, allowFrom }, null, 2)}\n`,
    { mode: 0o600 }
  );
}
