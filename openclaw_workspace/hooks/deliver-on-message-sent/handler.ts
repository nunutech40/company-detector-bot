/**
 * deliver-on-message-sent/handler.ts
 *
 * Slack realtime forwarding is intentionally disabled.
 * Telegram delivery is part of the investigation workflow, but Slack must only
 * receive the scheduled/manual prospect digest built from PostgreSQL.
 */

const handler = async (_event: any) => {
  return;
};

export default handler;
