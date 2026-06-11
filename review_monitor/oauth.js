#!/usr/bin/env node
'use strict';

const command = process.argv[2] || 'help';
const scope = 'https://www.googleapis.com/auth/business.manage';
const redirectUri = process.env.GBP_REDIRECT_URI || 'http://localhost';

main().catch((error) => {
  console.error(`review_monitor_oauth: ${error.message}`);
  process.exit(1);
});

async function main() {
  if (command === 'auth-url') return authUrl();
  if (command === 'exchange-code') return exchangeCode();
  if (command === 'list-accounts') return listAccounts();
  if (command === 'list-locations') return listLocations();
  console.log('Usage: node review_monitor/oauth.js auth-url|exchange-code <code>|list-accounts|list-locations');
}

function authUrl() {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', requireEnv('GBP_CLIENT_ID'));
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', scope);
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  console.log(url.toString());
}

async function exchangeCode() {
  const code = process.argv[3] || '';
  if (!code) throw new Error('authorization code is required');
  const payload = await tokenRequest({
    code,
    client_id: requireEnv('GBP_CLIENT_ID'),
    client_secret: requireEnv('GBP_CLIENT_SECRET'),
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });
  if (!payload.refresh_token) throw new Error('Google did not return refresh_token; revoke consent and retry with prompt=consent');
  console.log('Add this value to .env.review-monitor through a secure editor:');
  console.log(`GBP_REFRESH_TOKEN=${payload.refresh_token}`);
}

async function listAccounts() {
  const token = await accessToken();
  const payload = await apiJson('https://mybusinessaccountmanagement.googleapis.com/v1/accounts', token);
  for (const account of payload.accounts || []) {
    console.log(`${account.name}\t${account.accountName || ''}\t${account.type || ''}`);
  }
}

async function listLocations() {
  const token = await accessToken();
  const accountId = requireEnv('GBP_ACCOUNT_ID');
  const fields = 'name,title,storefrontAddress,metadata';
  const url = `https://mybusinessbusinessinformation.googleapis.com/v1/accounts/${encodeURIComponent(accountId)}/locations?readMask=${encodeURIComponent(fields)}`;
  const payload = await apiJson(url, token);
  for (const location of payload.locations || []) {
    console.log(`${location.name}\t${location.title || ''}\t${location.metadata?.mapsUri || ''}`);
  }
}

async function accessToken() {
  return (await tokenRequest({
    client_id: requireEnv('GBP_CLIENT_ID'),
    client_secret: requireEnv('GBP_CLIENT_SECRET'),
    refresh_token: requireEnv('GBP_REFRESH_TOKEN'),
    grant_type: 'refresh_token',
  })).access_token;
}

async function tokenRequest(values) {
  const response = await fetch(process.env.GBP_TOKEN_URL || 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(values),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error_description || payload.error || `HTTP ${response.status}`);
  return payload;
}

async function apiJson(url, token) {
  const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error?.message || `HTTP ${response.status}`);
  return payload;
}

function requireEnv(name) {
  const value = process.env[name] || '';
  if (!value) throw new Error(`${name} is required`);
  return value;
}
