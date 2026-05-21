const fs = require("fs");
const path = require("path");

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

async function uploadFileToSlack(filePath, options = {}) {
  if (!SLACK_BOT_TOKEN) return false;

  try {
    const stat = fs.statSync(filePath);
    const filename = options.filename || path.basename(filePath);
    const title = options.title || filename;

    const uploadUrlResponse = await fetch("https://slack.com/api/files.getUploadURLExternal", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": `Bearer ${SLACK_BOT_TOKEN}`
      },
      body: new URLSearchParams({
        filename,
        length: String(stat.size)
      })
    });
    const uploadUrlData = await uploadUrlResponse.json();
    if (!uploadUrlData.ok) {
      console.error("Gagal meminta Slack upload URL:", uploadUrlData.error);
      return false;
    }

    const uploadResponse = await fetch(uploadUrlData.upload_url, {
      method: "POST",
      headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
      body: fs.readFileSync(filePath)
    });
    if (!uploadResponse.ok) {
      console.error("Gagal upload file ke Slack:", uploadResponse.status);
      return false;
    }

    const completeResponse = await fetch("https://slack.com/api/files.completeUploadExternal", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SLACK_BOT_TOKEN}`
      },
      body: JSON.stringify({
        channel_id: SLACK_CHANNEL,
        initial_comment: options.initialComment || "",
        files: [{ id: uploadUrlData.file_id, title }]
      })
    });
    const completeData = await completeResponse.json();
    if (!completeData.ok) {
      console.error("Gagal complete Slack file upload:", completeData.error);
      return false;
    }

    return true;
  } catch (e) {
    console.error("Error Slack file upload:", e.message);
    return false;
  }
}

module.exports = { sendToSlack, uploadFileToSlack };
