/**
 * deliver-on-message-sent/handler.ts
 *
 * Trigger Slack delivery setiap kali AI mengirim Company Detection Report ke Telegram.
 * Ambil content langsung dari event (bukan dari file) — ini yang memastikan
 * Telegram dan Slack dapat output yang SAMA PERSIS.
 */

import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";

const WORKSPACE = "/home/nunuopc/.openclaw/workspace";
const ENV_FILE = "/home/nunuopc/.openclaw/gateway.systemd.env";

const handler = async (event: any) => {
  // Hanya handle message:sent
  if (event.type !== "message" || event.action !== "sent") {
    return;
  }

  const content: string = event.context?.content ?? "";

  // Hanya trigger kalau pesan mengandung Company Detection Report
  if (!content.includes("Company Detection Report")) {
    return;
  }

  // Kirim content yang sama ke Slack — ini yang dikirim ke Telegram
  void sendToSlack(content);
};

async function sendToSlack(reportText: string): Promise<void> {
  // Baca env vars dari gateway.systemd.env
  let token = "";
  let channel = "";

  try {
    const envContent = readFileSync(ENV_FILE, "utf8");
    for (const line of envContent.split("\n")) {
      const [key, ...rest] = line.split("=");
      const val = rest.join("=").trim().replace(/^["']|["']$/g, "");
      if (key?.trim() === "SLACK_BOT_TOKEN") token = val;
      if (key?.trim() === "SLACK_REPORT_CHANNEL") channel = val;
    }
  } catch {
    console.error("[deliver-on-message-sent] cannot read env file");
    return;
  }

  if (!token || !channel) {
    console.error("[deliver-on-message-sent] SLACK_BOT_TOKEN or SLACK_REPORT_CHANNEL not set");
    return;
  }

  const body = JSON.stringify({ channel, text: reportText });

  return new Promise((resolve) => {
    execFile(
      "curl",
      [
        "-s", "-X", "POST",
        "https://slack.com/api/chat.postMessage",
        "-H", `Authorization: Bearer ${token}`,
        "-H", "Content-Type: application/json",
        "-d", body,
      ],
      { timeout: 15_000 },
      (err, stdout) => {
        if (err) {
          console.error("[deliver-on-message-sent] curl error:", err.message);
        } else {
          try {
            const res = JSON.parse(stdout);
            if (res.ok) {
              console.log("[deliver-on-message-sent] Slack sent OK");
            } else {
              console.error("[deliver-on-message-sent] Slack error:", res.error);
            }
          } catch {
            console.error("[deliver-on-message-sent] parse error:", stdout);
          }
        }
        resolve();
      }
    );
  });
}

export default handler;
