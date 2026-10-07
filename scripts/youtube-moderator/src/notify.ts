import nodemailer from "nodemailer";
import type { Config } from "./config.ts";

const DISCORD_LIMIT = 1900;
const LINE_LIMIT = 4900;

/** 長いメッセージを、行の区切りでなるべく崩さずに分割する。 */
function chunk(text: string, limit: number): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const line of text.split("\n")) {
    if (current && current.length + line.length + 1 > limit) {
      chunks.push(current);
      current = "";
    }
    current = current ? `${current}\n${line}` : line;
    while (current.length > limit) {
      chunks.push(current.slice(0, limit));
      current = current.slice(limit);
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

async function sendDiscord(webhookUrl: string, text: string) {
  for (const part of chunk(text, DISCORD_LIMIT)) {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // @everyone などのメンションが本文から発火しないようにする
      body: JSON.stringify({ content: part, allowed_mentions: { parse: [] } }),
    });
    if (!response.ok) throw new Error(`Discord への通知に失敗しました (${response.status})`);
  }
}

async function sendLine(token: string, userId: string, text: string) {
  const parts = chunk(text, LINE_LIMIT);
  // LINE は1回のプッシュで最大5メッセージ
  for (let i = 0; i < parts.length; i += 5) {
    const response = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        to: userId,
        messages: parts.slice(i, i + 5).map((part) => ({ type: "text", text: part })),
      }),
    });
    if (!response.ok) throw new Error(`LINE への通知に失敗しました (${response.status})`);
  }
}

async function sendGmail(user: string, appPassword: string, to: string, text: string) {
  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user, pass: appPassword },
    connectionTimeout: 30_000,
    socketTimeout: 30_000,
  });
  // 1行目を件名にする（例:「🍭 コメント自動審査（公開 3 / 非公開 1 / 要確認 1）」）
  const [subject, ...body] = text.split("\n");
  await transporter.sendMail({ from: user, to, subject, text: body.join("\n").trim() });
}

export async function notify(config: Config, text: string): Promise<void> {
  if (config.dryRun) {
    // Actions のログは公開されるため、DRY_RUN でも本文は出さず件名だけ出す
    console.log(`通知（DRY_RUN のため送信しません）: ${text.split("\n")[0]}`);
    return;
  }

  const { gmailUser, gmailAppPassword, mailTo, discordWebhookUrl, lineChannelAccessToken, lineUserId } = config.notify;
  const tasks: Promise<void>[] = [];
  if (gmailUser && gmailAppPassword && mailTo) tasks.push(sendGmail(gmailUser, gmailAppPassword, mailTo, text));
  if (discordWebhookUrl) tasks.push(sendDiscord(discordWebhookUrl, text));
  if (lineChannelAccessToken && lineUserId) tasks.push(sendLine(lineChannelAccessToken, lineUserId, text));

  if (tasks.length === 0) {
    throw new Error(
      "通知先が設定されていません（GMAIL_USER と GMAIL_APP_PASSWORD、DISCORD_WEBHOOK_URL、または LINE_CHANNEL_ACCESS_TOKEN と LINE_USER_ID）。",
    );
  }
  await Promise.all(tasks);
}
