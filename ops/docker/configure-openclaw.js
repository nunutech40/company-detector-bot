#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const stateDir = process.env.OPENCLAW_STATE_DIR || path.join(process.env.HOME || '/root', '.openclaw');
const configPath = process.env.OPENCLAW_CONFIG_PATH || path.join(stateDir, 'openclaw.json');
const runtimeEnvPath = path.join(stateDir, 'company-detector.env');
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
cfg.agents.defaults.models = cfg.agents.defaults.models || {};
cfg.agents.defaults.models['deepseek/deepseek-chat'] = { alias: 'DeepSeek' };
cfg.agents.defaults.models['minimax/MiniMax-M2.7'] = { alias: 'Minimax' };
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
provider.api = process.env.LLM_API || 'openai-completions';
delete provider.baseURL;
if (process.env.LLM_API_KEY) provider.apiKey = process.env.LLM_API_KEY;
provider.models = Array.isArray(provider.models) ? provider.models : [];
upsertModel(provider.models, modelId);
for (const id of additionalModels) upsertModel(provider.models, id);
delete provider.timeoutSeconds;
cfg.models.providers[providerName] = provider;
configureFallbackProviders(cfg);

cfg.plugins = cfg.plugins || {};
cfg.plugins.entries = cfg.plugins.entries || {};
for (const id of ['deepseek', 'llm-task', 'minimax']) {
  cfg.plugins.entries[id] = { ...(cfg.plugins.entries[id] || {}), enabled: true };
}
cfg.tools = cfg.tools || {};
cfg.tools.profile = 'full';
cfg.tools.alsoAllow = Array.from(new Set([...(cfg.tools.alsoAllow || []), 'llm-task']));
cfg.tools.loopDetection = {
  enabled: true,
  historySize: 20,
  warningThreshold: 2,
  criticalThreshold: 3,
  unknownToolThreshold: 3,
  globalCircuitBreakerThreshold: 10,
  detectors: {
    genericRepeat: true,
    knownPollNoProgress: true,
    pingPong: true,
  },
  postCompactionGuard: { windowSize: 3 },
};

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
writeRuntimeEnv(runtimeEnvPath);

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

function writeRuntimeEnv(filePath) {
  // Agent-launched finalizer commands only need DB access. Keep integration
  // tokens in container environment/OpenClaw config instead of duplicating them.
  const keys = ['DATABASE_URL'];
  const lines = keys
    .filter((key) => process.env[key])
    .map((key) => `${key}=${shellQuote(process.env[key])}`);
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`, { mode: 0o600 });
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function configureFallbackProviders(config) {
  if (process.env.DEEPSEEK_API_KEY) {
    config.models.providers.deepseek = {
      api: 'openai-completions',
      apiKey: process.env.DEEPSEEK_API_KEY,
      baseUrl: 'https://api.deepseek.com',
      models: [{
        id: 'deepseek-chat',
        name: 'DeepSeek V3',
        input: ['text'],
        contextWindow: 65536,
        maxTokens: 8192,
        cost: { input: 0.27, output: 1.1 },
      }],
    };
  }
  if (process.env.MINIMAX_API_KEY) {
    config.models.providers.minimax = {
      api: 'anthropic-messages',
      apiKey: process.env.MINIMAX_API_KEY,
      authHeader: true,
      baseUrl: 'https://api.minimax.io/anthropic',
      models: [{
        id: 'MiniMax-M2.7',
        name: 'MiniMax M2.7',
        input: ['text'],
        contextWindow: 204800,
        maxTokens: 8192,
        reasoning: true,
        cost: { input: 0.3, output: 1.2, cacheRead: 0.06, cacheWrite: 0.375 },
      }],
    };
  }
}
