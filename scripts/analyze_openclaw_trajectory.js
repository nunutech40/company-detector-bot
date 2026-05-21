#!/usr/bin/env node
'use strict';

const fs = require('fs');

const filePath = process.argv[2];
if (!filePath) {
  console.error('Usage: node scripts/analyze_openclaw_trajectory.js <events.jsonl>');
  process.exit(1);
}

const events = fs.readFileSync(filePath, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line));

const toolCalls = new Map();
const assistantTurns = [];
const modelCompletions = [];
const contextStats = [];
const runs = new Map();

for (const event of events) {
  const run = ensureRun(event.runId || 'no-run');
  run.eventCount += 1;
  run.types[event.type] = (run.types[event.type] || 0) + 1;

  if (event.type === 'tool.call') {
    const call = {
      id: event.data.toolCallId,
      name: event.data.name,
      arguments: event.data.arguments || {},
      resultChars: 0,
      resultPreview: '',
      isError: false,
      runId: event.runId || 'no-run',
    };
    toolCalls.set(event.data.toolCallId, call);
    run.toolCallIds.push(call.id);
  }

  if (event.type === 'tool.result') {
    const message = event.data.message || {};
    const call = toolCalls.get(message.toolCallId) || {
      id: message.toolCallId,
      name: message.toolName || 'unknown',
      arguments: {},
      resultChars: 0,
      resultPreview: '',
      isError: false,
    };
    const text = extractContentText(message.content);
    call.name = message.toolName || call.name;
    call.resultChars += text.length;
    call.resultPreview ||= compact(text, 220);
    call.isError = Boolean(message.isError || message.details?.status === 'error');
    call.details = message.details || null;
    toolCalls.set(call.id, call);
  }

  if (event.type === 'assistant.message') {
    const message = event.data.message || {};
    const usage = message.usage || null;
    assistantTurns.push({
      runId: event.runId || 'no-run',
      usage,
      textChars: extractAssistantText(message.content).length,
      toolCalls: (message.content || []).filter((item) => item.type === 'toolCall').length,
    });
  }

  if (event.type === 'model.completed') {
    const completion = {
      runId: event.runId || 'no-run',
      usage: event.data.usage || null,
      lastCallUsage: event.data.promptCache?.lastCallUsage || null,
      finalPromptChars: String(event.data.finalPromptText || '').length,
    };
    modelCompletions.push(completion);
    run.modelCompletions.push(completion);
  }

  if (event.type === 'context.compiled') {
    const context = {
      runId: event.runId || 'no-run',
      systemPromptChars: String(event.data.systemPrompt || '').length,
      userPromptChars: String(event.data.prompt || '').length,
      messageCount: Array.isArray(event.data.messages) ? event.data.messages.length : 0,
      toolCount: Array.isArray(event.data.tools) ? event.data.tools.length : null,
    };
    contextStats.push(context);
    run.contexts.push(context);
  }
}

const calls = [...toolCalls.values()];
const callsByName = groupCount(calls, (call) => call.name);
const resultCharsByName = groupSum(calls, (call) => call.name, (call) => call.resultChars);
const execBaselineCalls = calls.filter((call) => call.name === 'exec' && /company_check_go\.sh/.test(call.arguments.command || ''));
const processPolls = calls.filter((call) => call.name === 'process' && call.arguments.action === 'poll');
const webSearchCalls = calls.filter((call) => call.name === 'web_search');
const webFetchCalls = calls.filter((call) => call.name === 'web_fetch');
const largestResults = [...calls]
  .sort((a, b) => b.resultChars - a.resultChars)
  .slice(0, 10)
  .map((call) => ({
    name: call.name,
    resultChars: call.resultChars,
    args: summarizeArgs(call),
    isError: call.isError,
    preview: call.resultPreview,
  }));

const totalUsage = sumUsage(modelCompletions.map((item) => item.usage));
const lastCallUsage = modelCompletions.length ? modelCompletions[modelCompletions.length - 1].lastCallUsage : null;
const metadataReports = events
  .filter((event) => event.type === 'trace.metadata')
  .map((event) => event.data?.prompting?.systemPromptReport || event.data?.config?.prompting?.systemPromptReport)
  .filter(Boolean);
const lastMetadataReport = metadataReports[metadataReports.length - 1] || null;

const output = {
  file: filePath,
  eventCount: events.length,
  context: {
    compiledCount: contextStats.length,
    first: contextStats[0] || null,
    last: contextStats[contextStats.length - 1] || null,
    metadataReport: lastMetadataReport ? {
      systemPromptChars: lastMetadataReport.systemPrompt?.chars ?? null,
      projectContextChars: lastMetadataReport.systemPrompt?.projectContextChars ?? null,
      nonProjectContextChars: lastMetadataReport.systemPrompt?.nonProjectContextChars ?? null,
      toolSchemaChars: lastMetadataReport.tools?.schemaChars ?? null,
      injectedWorkspaceFiles: (lastMetadataReport.injectedWorkspaceFiles || []).map((file) => ({
        name: file.name,
        injectedChars: file.injectedChars,
        missing: file.missing,
      })),
    } : null,
  },
  modelUsage: {
    completedCount: modelCompletions.length,
    summedCompletedUsage: totalUsage,
    finalLastCallUsage: normalizeUsage(lastCallUsage),
    note: 'summedCompletedUsage counts model.completed usage values from the trajectory; finalLastCallUsage is what current worker/db_writer style commonly stores.',
  },
  assistantTurns: {
    count: assistantTurns.length,
    withToolCalls: assistantTurns.filter((turn) => turn.toolCalls > 0).length,
    totalToolCallsRequested: assistantTurns.reduce((sum, turn) => sum + turn.toolCalls, 0),
  },
  tools: {
    totalCalls: calls.length,
    callsByName,
    resultCharsByName,
    baselineExecCalls: execBaselineCalls.length,
    processPolls: processPolls.length,
    webSearchCalls: webSearchCalls.length,
    webFetchCalls: webFetchCalls.length,
    largestResults,
  },
  runs: [...runs.values()].map((run) => summarizeRun(run, toolCalls, assistantTurns)),
};

console.log(JSON.stringify(output, null, 2));

function extractContentText(content) {
  if (!Array.isArray(content)) return '';
  return content.map((item) => {
    if (typeof item === 'string') return item;
    return item?.text || item?.content || '';
  }).join('\n');
}

function extractAssistantText(content) {
  if (!Array.isArray(content)) return '';
  return content.map((item) => {
    if (item.type === 'text') return item.text || '';
    if (item.type === 'thinking') return item.thinking || '';
    return '';
  }).join('\n');
}

function groupCount(items, keyFn) {
  return items.reduce((acc, item) => {
    const key = keyFn(item);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function groupSum(items, keyFn, valueFn) {
  return items.reduce((acc, item) => {
    const key = keyFn(item);
    acc[key] = (acc[key] || 0) + valueFn(item);
    return acc;
  }, {});
}

function sumUsage(usages) {
  return usages.reduce((acc, usage) => {
    if (!usage) return acc;
    acc.input += Number(usage.input || 0);
    acc.output += Number(usage.output || 0);
    acc.total += Number(usage.total || usage.totalTokens || 0);
    return acc;
  }, { input: 0, output: 0, total: 0 });
}

function normalizeUsage(usage) {
  if (!usage) return null;
  return {
    input: Number(usage.input || 0),
    output: Number(usage.output || 0),
    total: Number(usage.total || usage.totalTokens || 0),
  };
}

function summarizeArgs(call) {
  if (call.name === 'exec') return compact(call.arguments.command || '', 180);
  if (call.name === 'process') return `${call.arguments.action || ''}:${call.arguments.sessionId || ''}`;
  if (call.name === 'web_search') return call.arguments.query || '';
  if (call.name === 'web_fetch') return call.arguments.url || '';
  return compact(JSON.stringify(call.arguments || {}), 180);
}

function compact(text, max) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 3)}...` : clean;
}

function ensureRun(runId) {
  if (!runs.has(runId)) {
    runs.set(runId, {
      runId,
      eventCount: 0,
      types: {},
      toolCallIds: [],
      modelCompletions: [],
      contexts: [],
    });
  }
  return runs.get(runId);
}

function summarizeRun(run, allToolCalls, allAssistantTurns) {
  const calls = run.toolCallIds.map((id) => allToolCalls.get(id)).filter(Boolean);
  const turns = allAssistantTurns.filter((turn) => turn.runId === run.runId);
  const completions = run.modelCompletions;
  return {
    runId: run.runId,
    eventCount: run.eventCount,
    types: run.types,
    context: {
      first: run.contexts[0] || null,
      last: run.contexts[run.contexts.length - 1] || null,
    },
    modelUsage: {
      summedCompletedUsage: sumUsage(completions.map((item) => item.usage)),
      finalLastCallUsage: completions.length ? normalizeUsage(completions[completions.length - 1].lastCallUsage) : null,
    },
    assistantTurns: {
      count: turns.length,
      withToolCalls: turns.filter((turn) => turn.toolCalls > 0).length,
      totalToolCallsRequested: turns.reduce((sum, turn) => sum + turn.toolCalls, 0),
    },
    tools: {
      totalCalls: calls.length,
      callsByName: groupCount(calls, (call) => call.name),
      resultCharsByName: groupSum(calls, (call) => call.name, (call) => call.resultChars),
    },
  };
}
