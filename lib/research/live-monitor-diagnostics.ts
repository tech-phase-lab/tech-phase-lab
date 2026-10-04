export const monitorFallbackReasons = [
  "not-configured",
  "invalid-config",
  "upstream-4xx",
  "upstream-5xx",
  "upstream-other-status",
  "oversized-response",
  "invalid-json",
  "invalid-payload",
  "timeout",
  "network",
] as const;

export type MonitorFallbackReason = (typeof monitorFallbackReasons)[number];

const monitorFallbackReasonSet = new Set<string>(monitorFallbackReasons);

export function parseMonitorFallbackReason(value: unknown): MonitorFallbackReason | null {
  return typeof value === "string" && monitorFallbackReasonSet.has(value)
    ? value as MonitorFallbackReason
    : null;
}

export function monitorFallbackLabel(reason: MonitorFallbackReason | null): string | null {
  switch (reason) {
    case "not-configured": return "監視サービス設定待ち";
    case "invalid-config": return "監視サービス設定の検証失敗";
    case "upstream-4xx": return "上流サービスが4xx応答";
    case "upstream-5xx": return "上流サービスが5xx応答";
    case "upstream-other-status": return "上流サービスが想定外の応答";
    case "oversized-response": return "上流応答が安全なサイズ上限を超過";
    case "invalid-json": return "上流応答のJSON解析失敗";
    case "invalid-payload": return "上流応答の内容検証失敗";
    case "timeout": return "上流サービスの応答タイムアウト";
    case "network": return "上流サービスへのネットワーク接続失敗";
    case null: return null;
  }
}
