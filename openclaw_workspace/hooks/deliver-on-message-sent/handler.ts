/**
 * deliver-on-message-sent/handler.ts
 *
 * Trigger Slack delivery setiap kali AI mengirim reply ke Telegram
 * yang mengandung "Company Detection Report".
 *
 * Ini memastikan Slack selalu dapat report yang sama dengan Telegram
 * tanpa bergantung AI untuk jalankan finish_investigation.sh.
 */

import { execFile } from "node:child_process";

const WORKSPACE = "/home/nunuopc/.openclaw/workspace";
const DELIVER_SCRIPT = `${WORKSPACE}/scripts/deliver_report_with_env.sh`;

const handler = async (event: any) => {
  // Hanya handle message:sent
  if (event.type !== "message" || event.action !== "sent") {
    return;
  }

  const content: string = event.context?.content ?? "";

  // Hanya trigger kalau pesan mengandung Company Detection Report
  // Ini mencegah trigger untuk setiap pesan biasa
  if (!content.includes("Company Detection Report")) {
    return;
  }

  // Jalankan deliver_report_with_env.sh di background
  // Fire-and-forget — tidak block response ke user
  void runDelivery();
};

async function runDelivery(): Promise<void> {
  return new Promise((resolve) => {
    execFile("bash", [DELIVER_SCRIPT], { timeout: 30_000 }, (err, stdout, stderr) => {
      if (err) {
        console.error("[deliver-on-message-sent] delivery failed:", err.message);
      } else {
        console.log("[deliver-on-message-sent] delivery done:", stdout.trim());
      }
      resolve();
    });
  });
}

export default handler;
