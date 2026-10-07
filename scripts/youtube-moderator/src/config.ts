export type Mode = "suggest" | "auto";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`環境変数 ${name} が設定されていません。`);
  }
  return value;
}

function optional(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

const DEFAULT_NG_WORDS = ["詐欺", "ドル箱", "ゼウス"];

export function loadConfig() {
  const rawMode = optional("MODERATION_MODE") ?? "suggest";
  if (rawMode !== "suggest" && rawMode !== "auto") {
    throw new Error(`MODERATION_MODE は "suggest" か "auto" を指定してください（現在: ${rawMode}）。`);
  }

  return {
    // suggest: YouTube 側は何も変更せず、判定案だけ通知する
    // auto:    公開・非公開を自動で反映し、迷うものだけ通知する
    mode: rawMode as Mode,
    dryRun: optional("DRY_RUN") === "1",
    youtube: {
      clientId: required("YT_CLIENT_ID"),
      clientSecret: required("YT_CLIENT_SECRET"),
      refreshToken: required("YT_REFRESH_TOKEN"),
      channelId: required("YT_CHANNEL_ID"),
    },
    ngWords: (optional("NG_WORDS")?.split(",") ?? DEFAULT_NG_WORDS)
      .map((word) => word.trim())
      .filter(Boolean),
    model: optional("CLAUDE_MODEL") ?? "claude-opus-5-5",
    notify: {
      discordWebhookUrl: optional("DISCORD_WEBHOOK_URL"),
      lineChannelAccessToken: optional("LINE_CHANNEL_ACCESS_TOKEN"),
      lineUserId: optional("LINE_USER_ID"),
    },
    stateFile: optional("STATE_FILE") ?? ".state/state.json",
  };
}

export type Config = ReturnType<typeof loadConfig>;
