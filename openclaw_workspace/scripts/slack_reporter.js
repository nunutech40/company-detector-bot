const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const SLACK_CHANNEL = process.env.SLACK_REPORT_CHANNEL || "#company-detection";

async function sendToSlack(reportText) {
  if (SLACK_WEBHOOK_URL) {
    // Menggunakan Incoming Webhook
    try {
      const response = await fetch(SLACK_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: reportText })
      });
      if (!response.ok) {
        console.error("Gagal mengirim ke Slack Webhook:", response.status);
      }
      return response.ok;
    } catch (e) {
      console.error("Error Slack Webhook:", e.message);
      return false;
    }
  } else if (SLACK_BOT_TOKEN) {
    // Menggunakan Slack Bot API
    try {
      const response = await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${SLACK_BOT_TOKEN}`
        },
        body: JSON.stringify({
          channel: SLACK_CHANNEL,
          text: reportText
        })
      });
      const data = await response.json();
      if (!data.ok) {
        console.error("Gagal mengirim ke Slack API:", data.error);
      }
      return data.ok;
    } catch (e) {
      console.error("Error Slack API:", e.message);
      return false;
    }
  } else {
    // console.warn("SLACK_WEBHOOK_URL atau SLACK_BOT_TOKEN belum diatur di environment.");
    return false;
  }
}

module.exports = { sendToSlack };
