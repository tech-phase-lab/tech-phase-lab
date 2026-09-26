"use client";

import { useState } from "react";
import Link from "next/link";
import { fetchState, filterSources, intakeCounts, pdfEvidenceCounts, secEvidenceCounts, secEvidenceState, sourceTitle, coverageCounts, providers, providerByTicker, sectorNames, type IntakeSnapshot } from "@/lib/research/intake";
import { useLiveIntake, type MonitorState } from "@/lib/research/use-live-intake";
import styles from "./intake.module.css";

const stateNames = { error: "取得エラー", fetched: "取得済み", unfetched: "未取得" };
const reviewNames = { pending: "確認待ち", approved: "採用", held: "保留", rejected: "却下" };
const historyNames: Record<string, string> = { "first-fetch": "初回取得", changed: "応答の変化を検出", "fetch-error": "取得に失敗", approved: "採用を記録", held: "保留を記録", rejected: "却下を記録" };
const errorNames: Record<string, string> = { "http-403": "配信元が取得を拒否（HTTP 403）", timeout: "応答待ちでタイムアウト", "no-links": "発表リンクを抽出できませんでした", "no-extractable-text": "本文として使える文字を抽出できませんでした", "sec-exhibit-unavailable": "SEC添付資料から十分な根拠本文を取得できませんでした", "invalid-pdf": "PDF形式を検証できませんでした", "pdf-encrypted": "暗号化PDFのため本文を抽出できませんでした", "pdf-page-limit": "PDFが安全なページ数上限を超えました", "pdf-no-text": "画像主体または根拠として十分な文字を抽出できませんでした", "pdf-timeout": "PDF解析が安全な時間上限を超えました", "pdf-extract-failed": "PDF本文の解析に失敗しました", "fetch-error": "資料の取得に失敗" };
const impactNames = { positive: "好影響", negative: "悪影響", mixed: "好悪材料", neutral: "中立", uncertain: "判断保留" };
const confidenceNames = { high: "高", medium: "中", low: "低" };
function time(value: string | null) {
  if (!value) return "未取得";
  return new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(new Date(value));
}
function bodyEvidence(source: IntakeSnapshot["sources"][number]) {
  if (!source.sha256) return "未取得";
  if ((source.extracted_chars ?? 0) > 0) return `抽出済み ${source.extracted_chars?.toLocaleString("ja-JP")}文字`;
  return source.content_type === "application/pdf" ? "PDF取得済み・根拠本文の補完待ち" : "原文取得済み・抽出テキストなし";
}
function duration(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "計測待ち";
  return value < 10_000 ? `${(value / 1000).toFixed(1)}秒` : `${Math.round(value / 1000)}秒`;
}
const sourceFormatNames: Record<string, string> = {
  rss: "RSS / Atom", "sec-json": "SEC Submissions JSON", sitemap: "公式サイトマップ",
  "news-json": "企業公式JSON", "twse-material-json": "TWSE重要開示JSON", html: "企業公式HTML",
};
function sourceFormatName(value: string) {
  return value.split("+").map(format => sourceFormatNames[format] ?? format).join(" + ");
}
function discoveryEvidence(run: IntakeSnapshot["discoveryRuns"][number]) {
  if (!run.source_format) return "旧記録 · 経路詳細なし";
  const checked = run.sources_checked ?? 1;
  const configured = run.sources_configured ?? 1;
  if (run.status === "degraded") return `${checked}/${configured}経路を確認 · 復旧なし`;
  const format = run.source_format ? sourceFormatName(run.source_format) : "公式経路";
  return `${checked}/${configured}経路を確認 · ${format}`;
}
function backupStatus(backup: MonitorState["backup"]) {
  if (!backup) return "DB保護：状態取得待ち";
  if (backup.status === "failed" || backup.healthy === false) return "DB保護：要確認（直近バックアップ失敗）";
  if (backup.status === "overdue" || backup.overdue) return "DB保護：要確認（バックアップ期限超過）";
  if (backup.healthy !== true || !backup.lastSuccessAt) return "DB保護：初回バックアップ待ち";
  return `DB保護：正常 · ${backup.backupCount}世代 · 最終成功 ${time(backup.lastSuccessAt)} JST`;
}
function monitorStatus(monitor: MonitorState | null) {
  if (monitor?.health?.status === "degraded") return "自動監視に確認が必要です";
  if (monitor?.health?.status === "starting") return "自動監視を起動しています";
  return "公式発表を自動監視しています";
}
function monitorIssue(monitor: MonitorState | null) {
  const issues = monitor?.health?.issues ?? [];
  if (issues.includes("monitor-stale")) return "巡回更新が停止しています";
  if (issues.includes("backup-failed")) return "DBバックアップに失敗しています";
  if (issues.includes("backup-overdue")) return "DBバックアップが期限を超過しています";
  if (issues.includes("incident-watch-failed")) return "障害台帳の内部監視を再試行しています";
  if (issues.includes("body-fetch-failed")) return "本文取得キューの内部処理を再試行しています";
  if (issues.includes("body-fetch-stale")) return "本文取得キューの永続ポーリング記録が期限を超過しています";
  if (issues.includes("discovery-poll-stale")) return "公式一覧の永続巡回記録が期限を超過しています";
  if (issues.includes("priority-source-pending")) return "優先5銘柄に現プロセス未確認の公式経路があります";
  if (issues.includes("priority-source-degraded")) return "優先5銘柄に要確認の公式経路があります";
  if (issues.includes("priority-source-metrics-failed")) return "優先5銘柄の実績保存を再試行しています";
  return null;
}
function incidentStatus(monitor: MonitorState | null) {
  const incidents = monitor?.incidents;
  if (!incidents) return "障害台帳：状態取得待ち";
  const watch = monitor?.incidentWatch?.healthy === true ? "内部監視正常" : "内部監視確認中";
  const delivery = incidents.deliveryEnabled
    ? incidents.deadNotifications
      ? `通知停止 ${incidents.deadNotifications}件 · 再送確認が必要`
      : `通知送信ON · 待機 ${incidents.pendingNotifications}件 · 配信済み ${incidents.deliveredNotifications}件`
    : `通知候補 ${incidents.heldNotifications}件を保留中（外部送信OFF）`;
  if (incidents.open) return `障害台帳：未復旧 ${incidents.open}件 · ${watch} · ${delivery}`;
  return `障害台帳：未復旧なし · ${watch} · ${delivery}`;
}
function cacheStatus(cache: MonitorState["fetchCache"]) {
  if (!cache) return "一時応答キャッシュ：状態取得待ち";
  const used = (cache.bytes / 1024 / 1024).toFixed(1);
  const maximum = (cache.maxBytes / 1024 / 1024).toFixed(0);
  return `一時応答キャッシュ：${cache.entries}/${cache.maxEntries}件 · ${used}/${maximum}MiB`;
}
function priceTargetStreamStatus(stream: MonitorState["priceTargetStream"]) {
  if (!stream) return "目標株価共有SSE：状態取得待ち";
  const state = !stream.active
    ? stream.checkedSinceStart ? "待機中（直近読取あり）" : "待機中（未読取）"
    : stream.healthy ? "正常" : "要確認";
  const sent = (stream.bytesSent / 1024).toFixed(1);
  const reads = `正常読取 ${stream.snapshotReads}/${stream.readAttempts}回・失敗 ${stream.readFailures}回（連続 ${stream.consecutiveFailures}）・回復 ${stream.recoveries}回`;
  return `目標株価共有SSE：${state} · 接続中 ${stream.clients}/${stream.maxClients} · 受付 ${stream.connectionsAccepted}・切断 ${stream.disconnects}・上限拒否 ${stream.connectionsRejected} · ${reads}・変更 ${stream.changes}回・送信 ${sent}KiB · 最終試行 ${time(stream.lastReadAt)} JST · 計測開始 ${time(stream.startedAt)} JST`;
}
function webPushStatus(push: MonitorState["webPush"]) {
  if (!push) return "スマホ通知試験：状態取得待ち";
  if (!push.enabled || push.status === "disabled") return "スマホ通知試験：外部送信OFF";
  const state = push.status === "error" ? "要確認" : push.status === "waiting" ? "起動確認中" : "稼働中";
  return `スマホ通知試験：${state} · 登録端末 ${push.activeDevices}/${push.maxDevices} · 24時間 試行 ${push.attempted24Hours}・送信受付 ${push.accepted24Hours}・不確定 ${push.uncertain24Hours}・期限切れ ${push.expired24Hours} · 内部巡回 ${push.polls}回・失敗 ${push.failures}回（連続 ${push.consecutiveFailures}）・回復 ${push.recoveries}回 · 最終送信試行 ${time(push.lastAttemptAt)} JST`;
}
function discoveryCacheStatus(cache: MonitorState["discoveryCache"]) {
  if (!cache) return "公式一覧の再利用：状態取得待ち";
  return `公式一覧の再利用：保存 ${cache.persistedSources}経路 · 条件付き確認 ${cache.conditionalRequests}回 · 304再利用 ${cache.notModifiedResponses}回 · 新規取得 ${cache.freshResponses}回 · 無効化 ${cache.invalidatedSources}件`;
}
function discoveryRunStatus(runs: MonitorState["discoveryRuns"]) {
  if (!runs?.lastCompletedAt) return "公式一覧の永続実測：初回巡回待ち";
  const deployment = runs.completedSinceStart == null
    ? ""
    : runs.completedSinceStart ? " · 現プロセス巡回済み" : " · 再起動後の巡回待ち";
  const freshness = runs.pollOverdue
    ? `要確認・最終完了 ${time(runs.lastCompletedAt)} JST`
    : `稼働確認 ${time(runs.lastCompletedAt)} JST`;
  const latency = runs.requestDurationAverageMs24Hours == null
    ? "応答時間の実測待ち"
    : `応答平均 ${duration(runs.requestDurationAverageMs24Hours)}・最大 ${duration(runs.requestDurationMaxMs24Hours)}`;
  return `公式一覧の永続実測：${freshness}${deployment} · 24時間 ${runs.runs24Hours}バッチ・${runs.checks24Hours}経路 · 要確認 ${runs.degraded24Hours}件 · 新規 ${runs.newSources24Hours}件 · ${latency}`;
}
function prioritySourceStatus(coverage: MonitorState["prioritySources"]) {
  if (!coverage) return "優先5銘柄：現プロセス確認待ち";
  const configuration = coverage.omitted > 0
    ? ` · 設定外 ${coverage.omitted}社`
    : "";
  const completion = coverage.completionLatencyMs == null
    ? ""
    : ` · 再起動後 ${duration(coverage.completionLatencyMs)}で対象確認`;
  return `優先5銘柄：現プロセス ${coverage.checkedSinceStart}/${coverage.configuredCount}社確認 · 正常 ${coverage.healthy}社 · 要確認 ${coverage.degraded}社 · 待機 ${coverage.pending}社${completion}${configuration}`;
}
function durablePrioritySourceStatus(run: MonitorState["prioritySourceRuns"]) {
  if (!run?.lastCompletedAt) return "優先5銘柄の永続実績：完了記録待ち";
  const health = run.degraded
    ? `正常 ${run.healthy}社・要確認 ${run.degraded}社`
    : `正常 ${run.healthy}社`;
  return `優先5銘柄の永続実績：${run.configuredCount}/${run.configuredCount}社 · ${health} · 再起動後 ${duration(run.completionLatencyMs)}で初回確認 · 最終観測 ${time(run.lastObservedAt)} JST · 24時間 ${run.completedRuns24Hours}起動`;
}
function priorityPersistenceStatus(state: MonitorState["priorityPersistence"]) {
  if (!state?.lastAttemptAt) return "優先5銘柄の実績保存：初回完了待ち";
  if (state.healthy === false) return "優先5銘柄の実績保存：要確認・次回巡回で再試行";
  return `優先5銘柄の実績保存：正常 · 最終成功 ${time(state.lastSuccessAt)} JST`;
}
function bodyFetchStatus(bodyFetch: MonitorState["bodyFetch"], backlog?: MonitorState["bodyBacklog"], pending = 0) {
  const eligible = backlog?.eligible ?? pending;
  const circuitCount = backlog?.activeHostCircuits ?? 0;
  const nextProbe = backlog?.nextHostProbeAt ? `・最短再確認 ${time(backlog.nextHostProbeAt)} JST` : "";
  const hostDeferred = backlog?.hostDeferred ? ` · 同一ホスト遮断中 ${backlog.hostDeferred}件（${circuitCount}経路${nextProbe}）` : "";
  const dueProbes = backlog?.dueHostCircuits
    ? ` · 復旧確認待ち ${backlog.dueHostCircuits}経路（今回 ${backlog.scheduledHostProbes ?? 0}件）`
    : "";
  const deferred = backlog ? `${hostDeferred}${dueProbes} · エラー再試行待ち ${backlog.retryDeferred}件（アクセス制限 ${backlog.accessRestricted}件・レート制限 ${backlog.rateLimited ?? 0}件） · 定期再確認待ち ${backlog.recheckDeferred}件` : "";
  const detectedWait = backlog?.detectedNeverFetchedMeasured
    ? `・最長待機 ${duration(backlog.detectedNeverFetchedAgeMaxMs)}・最古検知 ${time(backlog.oldestDetectedNeverFetchedAt ?? null)} JST${backlog.detectedNeverFetchedUnmeasured ? `・時刻検証不可 ${backlog.detectedNeverFetchedUnmeasured}件` : ""}`
    : backlog?.detectedNeverFetchedUnmeasured ? `・時刻検証不可 ${backlog.detectedNeverFetchedUnmeasured}件` : "";
  const neverFetchedDetail = backlog?.detectedNeverFetched != null && backlog?.baselineNeverFetched != null
    ? `（新着検知 ${backlog.detectedNeverFetched}件${detectedWait}・履歴基準 ${backlog.baselineNeverFetched}件）`
    : "";
  const fairness = backlog?.fairnessScheduled
    ? ` · 最古新着の保守枠：今回予約（待機 ${duration(backlog.fairnessAgeMs)}${backlog.fairnessSharedHost ? "・同一ホスト内で切替" : ""}）`
    : "";
  const scheduledTotal = (backlog?.scheduledDetectedNeverFetched ?? 0)
    + (backlog?.scheduledBaselineNeverFetched ?? 0)
    + (backlog?.scheduledExtractionPending ?? 0)
    + (backlog?.scheduledRecheck ?? 0);
  const scheduled = scheduledTotal
    ? ` · 今回予約：新着本文 ${backlog?.scheduledDetectedNeverFetched ?? 0}件・履歴本文 ${backlog?.scheduledBaselineNeverFetched ?? 0}件・抽出不足 ${backlog?.scheduledExtractionPending ?? 0}件・再確認 ${backlog?.scheduledRecheck ?? 0}件`
    : "";
  const evidenceState = backlog && backlog.neverFetched != null
    ? ` · 証拠状態：本文未取得 ${backlog.neverFetched}件${neverFetchedDetail}・抽出不足 ${backlog.extractionPending ?? 0}件・抽出済み ${backlog.extracted ?? 0}件${scheduled}${fairness}`
    : "";
  if (!bodyFetch?.lastPollAt) return "本文取得：初回ポーリング待ち";
  if (bodyFetch.healthy === false) return `本文取得：要確認 · 内部処理を再試行予定（連続 ${bodyFetch.consecutiveFailures}回・${bodyFetch.retrySeconds ?? 0}秒後） · 取得可能 ${eligible}件${deferred}${evidenceState}`;
  if (!bodyFetch.lastBatchAt) return `本文取得：${time(bodyFetch.lastPollAt)} JSTに確認 · 取得可能 ${eligible}件${deferred}${evidenceState} · 取得実績待ち`;
  return `本文取得：直近 ${bodyFetch.lastBatchChecks}件 · エラー ${bodyFetch.lastBatchErrors}件 · 304 ${bodyFetch.lastBatchNotModified}件 · ${duration(bodyFetch.lastBatchDurationMs)} · 取得可能 ${eligible}件${deferred}${evidenceState}`;
}
function bodyHostProbeStatus(probes?: MonitorState["bodyHostProbes"]) {
  if (!probes?.lastCompletedAt) return "遮断経路の復旧確認：実績待ち";
  const outcome = probes.lastOutcome === "recovered"
    ? "回復"
    : probes.lastOutcome === "restricted" ? "再遮断" : "一時障害";
  const lastWait = probes.lastEligibilityWaitMs == null
    ? ""
    : `・期限到来から ${duration(probes.lastEligibilityWaitMs)}後に試行`;
  const wait24Hours = probes.eligibilityWaitSamples24Hours > 0
    ? ` · 期限→試行の内部待機 平均 ${duration(probes.eligibilityWaitAverageMs24Hours)}・最大 ${duration(probes.eligibilityWaitMaxMs24Hours)}（${probes.eligibilityWaitSamples24Hours}件）`
    : " · 期限→試行の内部待機：実測待ち";
  return `遮断経路の復旧確認：直近 ${outcome}・${time(probes.lastCompletedAt)} JST${lastWait} · 24時間 ${probes.probes24Hours}回（回復 ${probes.recovered24Hours}・再遮断 ${probes.restricted24Hours}・一時障害 ${probes.failed24Hours}）${wait24Hours}`;
}
function durableBodyFetchStatus(bodyFetch: MonitorState["bodyFetch"]) {
  const durable = bodyFetch?.durable;
  if (!durable?.lastPolledAt) return "本文取得の永続稼働：初回ポーリング待ち";
  const deployment = durable.polledSinceStart == null
    ? ""
    : durable.polledSinceStart ? " · 現プロセス確認済み" : " · 再起動後の確認待ち";
  const poll = durable.pollOverdue
    ? `要確認・最終ポーリング ${time(durable.lastPolledAt)} JST`
    : `稼働確認 ${time(durable.lastPolledAt)} JST・待機 ${durable.pendingAtLastPoll ?? 0}件`;
  if (!durable.lastCompletedAt) return `本文取得の永続稼働：${poll}${deployment} · 処理バッチなし`;
  const latency = durable.detectionLatencySamples24Hours > 0
    ? ` · 検知→初回本文 平均 ${duration(durable.detectionLatencyAverageMs24Hours)}・最大 ${duration(durable.detectionLatencyMaxMs24Hours)}（${durable.detectionLatencySamples24Hours}件）`
    : " · 検知→初回本文 実測待ち";
  const eligibilityWait = durable.eligibilityWaitSamples24Hours > 0
    ? ` · 取得可能→試行の内部待機 平均 ${duration(durable.eligibilityWaitAverageMs24Hours)}・最大 ${duration(durable.eligibilityWaitMaxMs24Hours)}（${durable.eligibilityWaitSamples24Hours}件）`
    : " · 取得可能→試行の内部待機 実測待ち";
  const requestDuration = durable.requestDurationSamples24Hours > 0
    ? ` · 本文取得・抽出処理 平均 ${duration(durable.requestDurationAverageMs24Hours)}・最大 ${duration(durable.requestDurationMaxMs24Hours)}（${durable.requestDurationSamples24Hours}件）`
    : " · 本文取得・抽出処理 実測待ち";
  const requestSuccessDuration = (durable.requestSuccessDurationSamples24Hours ?? 0) > 0
    ? `正常 平均 ${duration(durable.requestSuccessDurationAverageMs24Hours)}・最大 ${duration(durable.requestSuccessDurationMaxMs24Hours)}（${durable.requestSuccessDurationSamples24Hours}件）`
    : "正常 0件";
  const requestErrorDuration = (durable.requestErrorDurationSamples24Hours ?? 0) > 0
    ? `失敗 平均 ${duration(durable.requestErrorDurationAverageMs24Hours)}・最大 ${duration(durable.requestErrorDurationMaxMs24Hours)}（${durable.requestErrorDurationSamples24Hours}件）`
    : "失敗 0件";
  const requestDurationOutcomes = (
    (durable.requestSuccessDurationSamples24Hours ?? 0)
    + (durable.requestErrorDurationSamples24Hours ?? 0)
  ) > 0
    ? ` · 処理時間内訳：${requestSuccessDuration}／${requestErrorDuration}`
    : " · 処理時間内訳：実測待ち";
  const selection = (durable.selectedDetectedNeverFetched24Hours ?? 0)
    + (durable.selectedBaselineNeverFetched24Hours ?? 0)
    + (durable.selectedExtractionPending24Hours ?? 0)
    + (durable.selectedRecheck24Hours ?? 0);
  const selectedOutcome = (
    label: string, selected = 0, errors = 0, notModified = 0, fetched = 0,
    updated = 0, unmeasured = 0,
  ) => {
    const outcomes = [
      fetched > 0 ? `抽出成功 ${fetched}件` : "",
      updated > 0 ? `証拠更新 ${updated}件` : "",
      errors > 0 ? `失敗 ${errors}件` : "",
      notModified > 0 ? `304再利用 ${notModified}件` : "",
      unmeasured > 0 ? `結果未計測 ${unmeasured}件` : "",
    ].filter(Boolean);
    return `${label} ${selected}件${outcomes.length ? `（${outcomes.join("・")}）` : ""}`;
  };
  const selectionStatus = selection > 0
    ? ` · 24時間予約：${selectedOutcome("新着本文", durable.selectedDetectedNeverFetched24Hours, durable.errorDetectedNeverFetched24Hours, durable.notModifiedDetectedNeverFetched24Hours, durable.fetchedDetectedNeverFetched24Hours, durable.updatedDetectedNeverFetched24Hours, durable.outcomeUnmeasuredDetectedNeverFetched24Hours)}・${selectedOutcome("履歴本文", durable.selectedBaselineNeverFetched24Hours, durable.errorBaselineNeverFetched24Hours, durable.notModifiedBaselineNeverFetched24Hours, durable.fetchedBaselineNeverFetched24Hours, durable.updatedBaselineNeverFetched24Hours, durable.outcomeUnmeasuredBaselineNeverFetched24Hours)}・${selectedOutcome("抽出不足", durable.selectedExtractionPending24Hours, durable.errorExtractionPending24Hours, durable.notModifiedExtractionPending24Hours, durable.fetchedExtractionPending24Hours, durable.updatedExtractionPending24Hours, durable.outcomeUnmeasuredExtractionPending24Hours)}・${selectedOutcome("再確認", durable.selectedRecheck24Hours, durable.errorRecheck24Hours, durable.notModifiedRecheck24Hours, durable.fetchedRecheck24Hours, durable.updatedRecheck24Hours, durable.outcomeUnmeasuredRecheck24Hours)}`
    : " · 24時間予約内訳：実測待ち";
  return `本文取得の永続稼働：${poll}${deployment} · 24時間 ${durable.runs24Hours}バッチ・${durable.checks24Hours}件 · エラー ${durable.errors24Hours}件 · 304 ${durable.notModified24Hours}件${selectionStatus}${latency}${eligibilityWait}${requestDuration}${requestDurationOutcomes} · 最終完了 ${time(durable.lastCompletedAt)} JST`;
}
function secEvidenceStatus(evidence: MonitorState["secEvidence"]) {
  if (!evidence) return "SEC本文証跡：状態取得待ち";
  const kinds = evidence.errorKinds ?? {
    accessRestricted: 0, rateLimited: 0, timeout: 0,
    server: 0, missingExhibit: 0, other: evidence.error,
  };
  return `SEC本文証跡：EX-99.1 ${evidence.exhibit}件 · 提出本文 ${evidence.direct}件 · 未取得 ${evidence.pending}件 · エラー ${evidence.error}件（アクセス制限 ${kinds.accessRestricted}・レート制限 ${kinds.rateLimited}・タイムアウト ${kinds.timeout}・公式側5xx ${kinds.server}・添付根拠なし ${kinds.missingExhibit}・その他 ${kinds.other}） · 最終確認 ${time(evidence.lastCheckedAt)} JST`;
}
function signalIntakeStatus(signal: MonitorState["signalIntake"]) {
  if (!signal) return "公式補完経路：状態取得待ち";
  const routes = signal.routes;
  const evidence = signal.publicationEvidence;
  const kinds = routes.errorKinds ?? {
    accessRestricted: 0, rateLimited: 0, timeout: 0, server: 0,
    invalidResponse: 0, articlePartial: 0, other: routes.error,
  };
  const retry = routes.retry;
  const retryStatus = retry
    ? ` · 再試行：実行可能 ${retry.due}・待機 ${retry.deferred}${retry.nextAt ? `（最短 ${time(retry.nextAt)} JST）` : ""}・予定不明 ${retry.unscheduled}`
    : "";
  const retryLabels = {
    accessRestricted: "アクセス制限", rateLimited: "レート制限", timeout: "タイムアウト",
    server: "公式側5xx", invalidResponse: "応答形式", articlePartial: "記事一部失敗", other: "その他",
  } as const;
  const retryKindStatus = retry?.byErrorKind
    ? Object.entries(retry.byErrorKind).flatMap(([kind, state]) => {
        if (!state || state.due + state.deferred + state.unscheduled === 0) return [];
        const label = retryLabels[kind as keyof typeof retryLabels] ?? "その他";
        return [`${label}：実行可能 ${state.due}・待機 ${state.deferred}${state.nextAt ? `（最短 ${time(state.nextAt)} JST）` : ""}・予定不明 ${state.unscheduled}`];
      }).join("／")
    : "";
  const retryKindDetail = retryKindStatus ? ` · 区分別再試行：${retryKindStatus}` : "";
  const article = signal.articleRetrieval;
  const articleRetry = article?.retry;
  const articleRetryStatus = articleRetry
    ? ` · 子記事再試行：実行可能 ${articleRetry.due}・待機 ${articleRetry.deferred}${articleRetry.nextAt ? `（最短 ${time(articleRetry.nextAt)} JST）` : ""}・予定不明 ${articleRetry.unscheduled}`
    : "";
  const articleRetryKindStatus = articleRetry?.byErrorKind
    ? Object.entries(articleRetry.byErrorKind).flatMap(([kind, state]) => {
        if (!state || state.due + state.deferred + state.unscheduled === 0) return [];
        const label = retryLabels[kind as keyof typeof retryLabels] ?? "その他";
        return [`${label}：実行可能 ${state.due}・待機 ${state.deferred}${state.nextAt ? `（最短 ${time(state.nextAt)} JST）` : ""}・予定不明 ${state.unscheduled}`];
      }).join("／")
    : "";
  const articleStatus = article
    ? ` · 子記事本文失敗 ${article.error}件（アクセス制限 ${article.errorKinds.accessRestricted}・レート制限 ${article.errorKinds.rateLimited}・タイムアウト ${article.errorKinds.timeout}・公式側5xx ${article.errorKinds.server}・応答形式 ${article.errorKinds.invalidResponse}・記事一部失敗 ${article.errorKinds.articlePartial}・その他 ${article.errorKinds.other}）${articleRetryStatus}${articleRetryKindStatus ? ` · 子記事区分別再試行：${articleRetryKindStatus}` : ""}`
    : "";
  const measuredRecoveries = article?.recoveries24Hours;
  const measuredRecoveryStatus = measuredRecoveries?.count
    ? ` · 子記事回復の実測：24時間 ${measuredRecoveries.count}件・失敗開始→回復 平均 ${duration(measuredRecoveries.latencyAverageMs)}・最大 ${duration(measuredRecoveries.latencyMaxMs)}・試行 平均 ${measuredRecoveries.attemptsAverage}回・最大 ${measuredRecoveries.attemptsMax}回（最終 ${time(measuredRecoveries.lastRecoveredAt)} JST）`
    : measuredRecoveries ? " · 子記事回復の実測：24時間の標本なし" : "";
  const transitions = signal.routeTransitions24Hours;
  const outcome = transitions?.lastOutcome
    ? { recovered: "回復", failed: "障害", changed: "区分変化" }[transitions.lastOutcome]
    : null;
  const transitionStatus = transitions
    ? ` · 24時間の状態変化：回復 ${transitions.recoveries}・再失敗 ${transitions.failures}・区分変化 ${transitions.changes}${outcome && transitions.lastOccurredAt ? `（最終 ${outcome} ${time(transitions.lastOccurredAt)} JST）` : ""}`
    : "";
  const routeRecoveries = signal.routeRecoveries24Hours;
  const routeRecoveryStatus = routeRecoveries?.count
    ? ` · 経路回復の実測：24時間 ${routeRecoveries.count}件・障害開始→回復 平均 ${duration(routeRecoveries.latencyAverageMs)}・最大 ${duration(routeRecoveries.latencyMaxMs)}・試行 平均 ${routeRecoveries.attemptsAverage}回・最大 ${routeRecoveries.attemptsMax}回（最終 ${time(routeRecoveries.lastRecoveredAt)} JST）`
    : routeRecoveries ? " · 経路回復の実測：24時間の標本なし" : "";
  const routeRetryWait = signal.routeRetryWait24Hours;
  const routeRetryWaitStatus = routeRetryWait?.count
    ? ` · 経路再試行の内部待機：24時間 ${routeRetryWait.count}件・平均 ${duration(routeRetryWait.waitAverageMs)}・最大 ${duration(routeRetryWait.waitMaxMs)}（最終試行 ${time(routeRetryWait.lastAttemptedAt)} JST）`
    : routeRetryWait ? " · 経路再試行の内部待機：24時間の標本なし" : "";
  const activeOutages = routes.activeOutages;
  const activeOutageStatus = activeOutages
    ? activeOutages.measured
      ? ` · 継続中の経路障害：実測 ${activeOutages.measured}件・最長 ${duration(activeOutages.ageMaxMs)}・試行 平均 ${activeOutages.attemptsAverage}回・最大 ${activeOutages.attemptsMax}回（最古開始 ${time(activeOutages.oldestStartedAt)} JST）${activeOutages.unmeasured ? `・計測前 ${activeOutages.unmeasured}件` : ""}`
      : ` · 継続中の経路障害：実測なし${activeOutages.unmeasured ? `・計測前 ${activeOutages.unmeasured}件` : ""}`
    : "";
  const activeOutageKindStatus = activeOutages?.byErrorKind
    ? Object.entries(activeOutages.byErrorKind).flatMap(([kind, state]) => {
        if (!state || state.measured + state.unmeasured === 0) return [];
        const label = retryLabels[kind as keyof typeof retryLabels] ?? "その他";
        return [state.measured
          ? `${label}：実測 ${state.measured}件・最長 ${duration(state.ageMaxMs)}・試行 平均 ${state.attemptsAverage}回・最大 ${state.attemptsMax}回${state.unmeasured ? `・計測前 ${state.unmeasured}件` : ""}`
          : `${label}：計測前 ${state.unmeasured}件`];
      }).join("／")
    : "";
  const activeOutageKindDetail = activeOutageKindStatus ? ` · 区分別継続障害：${activeOutageKindStatus}` : "";
  return `公式補完経路：直近成功 ${routes.fresh}/${routes.configured}経路 · 期限超過 ${routes.stale} · 要確認 ${routes.error}（アクセス制限 ${kinds.accessRestricted}・レート制限 ${kinds.rateLimited}・タイムアウト ${kinds.timeout}・公式側5xx ${kinds.server}・応答形式 ${kinds.invalidResponse}・記事一部失敗 ${kinds.articlePartial}・その他 ${kinds.other}）${retryStatus}${retryKindDetail}${activeOutageStatus}${activeOutageKindDetail}${articleStatus}${measuredRecoveryStatus}${transitionStatus}${routeRecoveryStatus}${routeRetryWaitStatus} · 初回待ち ${routes.pending} · 公表証拠 ${evidence.total}件（日時あり ${evidence.timestamp}・日付のみ ${evidence.dateOnly}・時刻未取得 ${evidence.missing}）`;
}
function generationStatus(generation: MonitorState["generation"]) {
  if (!generation) return "AI下書き生成：状態取得待ち";
  if (!generation.enabled) {
    return generation.requested && !generation.configured
      ? "AI下書き生成：設定不足のため停止（外部送信なし）"
      : "AI下書き生成：OFF（外部送信なし）";
  }
  const retry = generation.retry
    ? generation.nextRetryWaitSeconds === 0
      ? ` · 再試行 ${generation.retry}件（実行可能）`
      : generation.nextRetryAt
        ? ` · 再試行 ${generation.retry}件（最短 ${time(generation.nextRetryAt)} JST）`
        : ` · 再試行 ${generation.retry}件`
    : "";
  const tokenUse = generation.budgetTokensLast24Hours ?? 0;
  return `AI下書き生成：ON（非公開・人間承認必須） · 待機 ${generation.queued ?? 0}件${retry} · 24時間 ${generation.attemptsLast24Hours ?? 0}/${generation.dailyLimit}回 · 予算計上 ${tokenUse.toLocaleString("ja-JP")}/${generation.tokenLimit.toLocaleString("ja-JP")} tokens`;
}

export default function IntakeDashboard({ snapshot: initialSnapshot, titles }: { snapshot: IntakeSnapshot; titles: Record<string, string> }) {
  const [query, setQuery] = useState("");
  const [ticker, setTicker] = useState("all");
  const [state, setState] = useState("all");
  const [review, setReview] = useState("all");
  const [sector, setSector] = useState("all");
  const [pdfEvidenceFilter, setPdfEvidenceFilter] = useState("all");
  const [secEvidenceFilter, setSecEvidenceFilter] = useState("all");
  const [page, setPage] = useState(1);
  const live = useLiveIntake(initialSnapshot);
  const snapshot = live.snapshot;
  const counts = intakeCounts(snapshot.sources);
  const pdfEvidence = pdfEvidenceCounts(snapshot.sources);
  const secEvidence = secEvidenceCounts(snapshot.sources);
  const coverage = coverageCounts(snapshot);
  const events = snapshot.events ?? [];
  const briefs = snapshot.briefs ?? [];
  const visible = filterSources(snapshot.sources, query, ticker, state, review, titles, sector, pdfEvidenceFilter, secEvidenceFilter);
  const selectedProviders = providers.filter(p => (sector === "all" || p.sector === sector) && (ticker === "all" || ticker === p.ticker));
  const displayed = visible.slice((page - 1) * 20, page * 20);
  const pages = Math.max(1, Math.ceil(visible.length / 20));
  const title = (url: string) => titles[url] || sourceTitle(url);
  function reset() { setQuery(""); setTicker("all"); setState("all"); setReview("all"); setSector("all"); setPdfEvidenceFilter("all"); setSecEvidenceFilter("all"); setPage(1); }
  function chooseSector(value: string) { setSector(value); setTicker("all"); setPage(1); }
  return <div className={styles.app}>
    <a className={styles.skip} href="#intake-main">本文へ移動</a>
    <header className={styles.header}><Link href="/research" className={styles.brand}><b>TP</b><span>TECH PHASE<small>RESEARCH / OPERATIONS</small></span></Link><span className={styles.badge}>運営用プレビュー</span></header>
    <main id="intake-main" className={styles.main}>
      <div className={styles.heading}><div><p className={styles.eyebrow}>AI COMPANY COVERAGE</p><h1>AI関連銘柄の資料・取得状況</h1><p>企業公式・取引所・SECの一次情報から、原文と照合する資料を選びます。</p></div><div className={styles.headingLinks}><Link href="/research/review">速報レビュー →</Link><Link href="/research">リサーチ画面へ ↗</Link></div></div>
      <aside className={styles.notice}><strong>{live.mode === "automatic" ? monitorStatus(live.monitor) : "自動監視サービスの接続待ち"}</strong><span>{live.mode === "automatic" ? `最終巡回：${time(live.monitor?.lastCycleAt ?? null)} JST` : `保存記録の出力日時：${time(snapshot.generatedAt)} JST`}</span>{live.mode === "automatic" && <><span>直近巡回：{duration(live.monitor?.lastCycleDurationMs)}（{live.monitor?.lastCycleCompanies ?? 0}社）</span><span>{discoveryRunStatus(live.monitor?.discoveryRuns)}</span><span>{prioritySourceStatus(live.monitor?.prioritySources)}</span><span>{durablePrioritySourceStatus(live.monitor?.prioritySourceRuns)}</span><span>{priorityPersistenceStatus(live.monitor?.priorityPersistence)}</span><span>{signalIntakeStatus(live.monitor?.signalIntake)}</span><span>{bodyFetchStatus(live.monitor?.bodyFetch, live.monitor?.bodyBacklog, live.monitor?.pendingBodies)}</span><span>{bodyHostProbeStatus(live.monitor?.bodyHostProbes)}</span><span>{durableBodyFetchStatus(live.monitor?.bodyFetch)}</span><span>{secEvidenceStatus(live.monitor?.secEvidence)}</span><span>{priceTargetStreamStatus(live.monitor?.priceTargetStream)}</span><span>{webPushStatus(live.monitor?.webPush)}</span><span>{generationStatus(live.monitor?.generation)}</span><span>{discoveryCacheStatus(live.monitor?.discoveryCache)}</span><span>{cacheStatus(live.monitor?.fetchCache)}</span><span>{backupStatus(live.monitor?.backup)}</span><span>{incidentStatus(live.monitor)}</span>{monitorIssue(live.monitor) && <span role="alert" className={styles.alert}>運用警告：{monitorIssue(live.monitor)}</span>}</>}<p>{live.mode === "automatic" ? "公式経路を銘柄ごとに3〜5秒の基準間隔で巡回します。間隔は保証速度ではなく、直近応答時間と検知後の本文取得時間を別に実測します。公式補完経路の直近成功も完全な網羅性を意味しません。" : "現在は保存済み記録を表示しています。監視サービス接続後は3秒ごとに自動更新されます。"}</p></aside>
      <section aria-labelledby="events-title" className={styles.queue}><div className={styles.sectionTitle}><h2 id="events-title">新着の公式発表</h2><span>初回取り込みを除く自動検知：{events.length}件</span></div>
        <p className={styles.coverageNote}>監視開始前の過去資料は速報として扱いません。ここには監視開始後に新しく現れた公式URLだけを表示します。発表元の公開時刻が秒単位で得られない場合、公開から検知までの時間は未計測です。</p>
        {events.length === 0 ? <div className={styles.empty}><h3>監視開始後の新着はまだありません</h3><p>常駐監視の接続後、新しい公式発表を検知すると自動で追加されます。</p></div> : <ul className={styles.sources}>{events.slice(0, 20).map(event => <li key={event.id}><article className={styles.source}>
          <div className={styles.tags}><b>{event.ticker}</b><span className={styles.good}>公式URLを新規検知</span></div>
          <h3>{event.title || title(event.url)}</h3>
          <dl className={styles.dates}><div><dt>初回検知（JST）</dt><dd>{time(event.detected_at)}</dd></div><div><dt>本文取得（JST）</dt><dd>{time(event.body_fetched_at ?? null)}</dd></div><div><dt>検知→本文取得</dt><dd>{duration(event.detection_to_body_ms)}</dd></div><div><dt>発表日</dt><dd>{event.published_on ?? "原文で確認"}</dd></div></dl>
          <div className={styles.sourceFooter}><a href={event.url} target="_blank" rel="noopener noreferrer">公式原文を開く ↗</a><span>要約前の確定情報</span></div>
        </article></li>)}</ul>}
      </section>
      <section aria-labelledby="briefs-title" className={styles.queue}><div className={styles.sectionTitle}><h2 id="briefs-title">人間確認済みの速報要約</h2><span>公開ゲート通過：{briefs.length}件</span></div>
        <p className={styles.coverageNote}>現在の公式原文とSHAが一致し、根拠引用・数値を照合したうえで人間が承認した版だけを表示します。未承認、原文変更、最新取得エラーのある要約は表示しません。</p>
        {briefs.length === 0 ? <div className={styles.empty}><h3>承認済みの速報要約はまだありません</h3><p>下書きは運営レビューを通過するまで公開候補に含めません。</p></div> : <ul className={styles.briefs}>{briefs.slice(0, 12).map(brief => <li key={`${brief.url}-${brief.source_sha256}`}><article className={styles.brief}>
          <div className={styles.briefHead}><div className={styles.tags}><b>{brief.ticker}</b><span className={styles.good}>人間確認済み</span><span className={styles.neutral}>{impactNames[brief.impact_label]}</span></div><span className={styles.confidence}>確信度 {confidenceNames[brief.confidence]}</span></div>
          <h3>{brief.title || title(brief.url)}</h3>
          <div className={styles.briefCopy}><section><h4>確認できた事実</h4><p>{brief.summary_ja}</p></section><section><h4>影響と未確認事項</h4><p>{brief.impact_ja}</p></section></div>
          <details className={styles.briefEvidence}><summary>照合した公式原文の抜粋</summary><div><section><h4>事実要約の根拠</h4>{brief.evidence.summary.map((item, index) => <blockquote key={`summary-${index}`}>{item.text}{item.truncated ? <small>（表示上限のため続きは公式原文で確認）</small> : null}</blockquote>)}</section><section><h4>影響判断の根拠</h4>{brief.evidence.impact.map((item, index) => <blockquote key={`impact-${index}`}>{item.text}{item.truncated ? <small>（表示上限のため続きは公式原文で確認）</small> : null}</blockquote>)}</section></div><p>英語原文から人間が照合した抜粋です。解釈や重要度ではありません。</p></details>
          <dl className={styles.briefDates}><div><dt>発表日</dt><dd>{brief.published_on ?? "原文で確認"}</dd></div><div><dt>初回検知（JST）</dt><dd>{time(brief.detected_at)}</dd></div><div><dt>公式原文の最終確認（JST）</dt><dd>{time(brief.source_checked_at)}</dd></div><div><dt>下書き作成（JST）</dt><dd>{time(brief.generated_at)}</dd></div><div><dt>編集確認（JST）</dt><dd>{time(brief.reviewed_at)}</dd></div><div><dt>作成方法</dt><dd>{brief.generation_method === "ai-assisted" ? "AI下書き＋人間確認" : "人間作成"}</dd></div></dl>
          <div className={styles.sourceFooter}><a href={brief.url} target="_blank" rel="noopener noreferrer">根拠となる公式原文 ↗</a><span>原文識別値 {brief.source_sha256.slice(0, 12)}…</span></div>
        </article></li>)}</ul>}
      </section>
      <section aria-label="銘柄の対応状況" className={styles.stats}>
        {[["登録銘柄", coverage.registered], ["一覧取得に成功", coverage.discovered], ["一覧の確認が必要", coverage.needsCheck], ["一覧未検証", coverage.untested]].map(([label, count]) => <div key={label}><span>{label}</span><strong>{count}<small>銘柄</small></strong></div>)}
      </section>
      <nav aria-label="分野で絞り込み" className={styles.sectors}>{[["all", "すべて"], ...Object.entries(sectorNames)].map(([key, label]) => <button key={key} aria-pressed={sector === key} onClick={() => chooseSector(key)}>{label}</button>)}</nav>
      <section aria-labelledby="health-title"><div className={styles.sectionTitle}><h2 id="health-title">公式一覧の取得状況</h2><span>一覧と本文の取得は別々に確認</span></div>
        <p className={styles.coverageNote}>企業公式の発表・ブログに加え、対象企業のSEC提出書類と取引所の重要開示を補完利用します。AI以外の発表や過去分も含みます。<br />PDF根拠：抽出済み {pdfEvidence.extracted}件 ／ 補完待ち {pdfEvidence.pending}件 ／ エラー {pdfEvidence.error}件（全{pdfEvidence.total}件）<br />SEC根拠：EX-99.1取得 {secEvidence.exhibit}件 ／ 提出本文 {secEvidence.direct}件 ／ 未取得 {secEvidence.pending}件 ／ エラー {secEvidence.error}件（全{secEvidence.total}件）</p>
        <div className={styles.health}>{selectedProviders.map(provider => {
          const symbol = provider.ticker;
          const runs = snapshot.discoveryRuns.filter(r => r.ticker === symbol).toSorted((a, b) => b.id - a.id);
          const latest = runs[0];
          const totals = intakeCounts(snapshot.sources.filter(s => s.ticker === symbol));
          const companyPdfEvidence = pdfEvidenceCounts(snapshot.sources.filter(s => s.ticker === symbol));
          const companySecEvidence = secEvidenceCounts(snapshot.sources.filter(s => s.ticker === symbol));
          const available = latest?.status === "ok" || latest?.status === "fallback";
          const monitor = live.monitor?.companies?.[symbol];
          return <article key={symbol}><div className={styles.healthTop}><h3>{symbol}</h3><span className={available ? styles.good : styles.warning}>{latest?.status === "ok" ? "公式経路から取得" : latest?.status === "fallback" ? "公式バックアップ経路で取得" : latest ? "一覧の確認が必要" : "一覧未検証"}</span></div>
            <p className={styles.companyName}>{provider.name} <small>{sectorNames[provider.sector]}</small></p>
            <p>{latest?.status === "ok" ? `${latest.candidates}件の公式リンクを検出` : latest?.status === "fallback" ? `公式バックアップを含む${latest.candidates}件を検出` : errorNames[latest?.error ?? ""] || "取得記録なし"}</p>
            <p className={styles.muted}>本文・PDF：取得済み {totals.fetched} ／ 未取得 {totals.unfetched} ／ エラー {totals.error}</p>
            {companyPdfEvidence.total > 0 && <p className={styles.muted}>PDF根拠：抽出済み {companyPdfEvidence.extracted} ／ 補完待ち {companyPdfEvidence.pending} ／ エラー {companyPdfEvidence.error}</p>}
            {companySecEvidence.total > 0 && <p className={styles.muted}>SEC根拠：EX-99.1 {companySecEvidence.exhibit} ／ 提出本文 {companySecEvidence.direct} ／ 未取得 {companySecEvidence.pending} ／ エラー {companySecEvidence.error}</p>}
            <p className={styles.meta}>一覧の確認日時：{latest ? time(latest.at) : "未確認"} JST</p>
            {latest && <p className={styles.meta}>取得経路の証跡：{discoveryEvidence(latest)}</p>}
            {monitor && <p className={styles.meta}>基準間隔 {monitor.basePollSeconds ?? monitor.nextPollSeconds ?? "—"}秒 ／ 直近の公式応答 {duration(monitor.requestDurationMs)}{monitor.nextPollSeconds && monitor.basePollSeconds && monitor.nextPollSeconds > monitor.basePollSeconds ? ` ／ 次回まで${monitor.nextPollSeconds}秒（失敗時バックオフ）` : ""}</p>}
            <div className={styles.cardActions}><Link href={`/research/companies/${symbol}`}>銘柄ページ →</Link><a href={provider.indexUrl} target="_blank" rel="noopener noreferrer">公式{provider.format === "rss" ? "RSS" : "一覧"} ↗</a><button disabled={!totals.total} onClick={() => { setTicker(symbol); setQuery(""); setState("all"); setReview("all"); setPage(1); requestAnimationFrame(() => document.getElementById("queue-title")?.scrollIntoView({ block: "start" })); }}>資料を表示（{totals.total}）</button></div>
            <details className={styles.runHistory}><summary>{symbol}の直近の一覧取得履歴（{runs.length}件）</summary><ul>{runs.map(r => <li key={r.id}><time>{time(r.at)} JST</time><span>{r.status === "ok" ? `${r.candidates}件検出` : r.status === "fallback" ? `公式バックアップで${r.candidates}件検出` : errorNames[r.error ?? ""] || "取得異常"}<small>{discoveryEvidence(r)}</small></span></li>)}</ul></details>
          </article>;
        })}</div>
      </section>
      <section aria-labelledby="queue-title" className={styles.queue}><div className={styles.sectionTitle}><h2 id="queue-title">確認する資料</h2><span>編集上の確認待ち：{counts.pending}件</span></div>
        <p className={styles.coverageNote}>全{counts.total}資料 ／ 取得済み {counts.fetched} ／ 未取得 {counts.unfetched} ／ エラー {counts.error}　表示分野：{sector === "all" ? "すべて" : sectorNames[sector]}</p>
        <div className={styles.filters}>
          <label className={styles.search}>資料名・会社名・URLを検索<input type="search" value={query} onChange={e => { setQuery(e.target.value); setPage(1); }} placeholder="NVIDIA、financial、AI…" /></label>
          <label>銘柄<select value={ticker} onChange={e => { setTicker(e.target.value); setPage(1); }}><option value="all">すべての銘柄</option>{providers.filter(p => sector === "all" || p.sector === sector).map(p => <option key={p.ticker} value={p.ticker}>{p.ticker} · {p.name}</option>)}</select></label>
          <label>取得状態<select value={state} onChange={e => { setState(e.target.value); setPage(1); }}><option value="all">すべての取得状態</option><option value="error">取得エラー</option><option value="unfetched">未取得</option><option value="fetched">取得済み</option></select></label>
          <label>PDF根拠<select value={pdfEvidenceFilter} onChange={e => { setPdfEvidenceFilter(e.target.value); setPage(1); }}><option value="all">すべての資料</option><option value="pending">PDF補完待ち</option><option value="extracted">PDF抽出済み</option><option value="error">PDF取得エラー</option></select></label>
          <label>SEC根拠<select value={secEvidenceFilter} onChange={e => { setSecEvidenceFilter(e.target.value); setPage(1); }}><option value="all">すべての資料</option><option value="exhibit">EX-99.1取得済み</option><option value="direct">SEC提出本文</option><option value="pending">SEC本文未取得</option><option value="error">SEC根拠エラー</option></select></label>
          <label>編集状態<select value={review} onChange={e => { setReview(e.target.value); setPage(1); }}><option value="all">すべての編集状態</option>{Object.entries(reviewNames).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
        </div>
        <div className={styles.results}><p aria-live="polite">{visible.length}件が該当 · {page} / {pages}ページ</p><button onClick={reset}>絞り込みを解除</button></div>
        {visible.length === 0 ? <div className={styles.empty}><h3>条件に合う資料はありません</h3><p>検索語や取得状態を変更してください。</p><button onClick={reset}>すべての資料を表示</button></div> : <ul className={styles.sources}>{displayed.map(s => {
          const status = fetchState(s);
          const secState = secEvidenceState(s);
          const history = snapshot.history.filter(h => h.url === s.url);
          return <li key={s.url}><article className={styles.source}>
            <div className={styles.tags}><b>{s.ticker}</b><span className={styles.neutral}>{sectorNames[providerByTicker[s.ticker]?.sector]}</span><span className={status === "error" ? styles.warning : status === "fetched" ? styles.good : styles.neutral}>{stateNames[status]}</span>{secState && <span className={secState === "exhibit" ? styles.good : secState === "error" ? styles.warning : styles.neutral}>{secState === "exhibit" ? "EX-99.1根拠" : secState === "direct" ? "SEC提出本文" : secState === "pending" ? "SEC本文未取得" : "SEC根拠要確認"}</span>}<span className={styles.neutral}>{reviewNames[s.status]}</span></div>
            <h3>{title(s.url)}</h3><p className={styles.domain}>{new URL(s.url).hostname}</p>
            {s.error && <p className={styles.error}>{errorNames[s.error] || "資料の取得に失敗"}。{s.sha256 ? "以前の取得記録はありますが、最新の試行は失敗しています。" : "本文は未取得です。"}</p>}
            <dl className={styles.dates}><div><dt>資料の発表日</dt><dd>{s.published_on ?? "未確認"}</dd></div><div><dt>初回の検知日時（JST）</dt><dd>{time(s.discovered_at)}</dd></div><div><dt>最後の取得試行（JST）</dt><dd>{time(s.checked_at)}</dd></div><div><dt>要約用の原文証拠</dt><dd>{bodyEvidence(s)}</dd></div></dl>
            <div className={styles.sourceFooter}><span><a href={s.url} target="_blank" rel="noopener noreferrer">公式原文を開く ↗</a>{s.evidence_kind === "sec-exhibit-99.1" && s.evidence_url && s.evidence_url !== s.url && <>　<a href={s.evidence_url} target="_blank" rel="noopener noreferrer">取得した添付根拠 ↗</a></>}</span><span>取得の成功は、内容の確認完了を意味しません</span></div>
            <details className={styles.history}><summary>資料の直近の取得・確認履歴（{history.length}件）</summary>
              {s.sha256 && <p className={styles.fingerprint}>最後に取得した内容の識別値 <code>{s.sha256}</code></p>}
              {history.length ? <ol>{history.map(h => <li key={h.id}><time>{time(h.at)} JST</time><strong>{historyNames[h.kind] || h.kind}</strong>{h.sha256 && <code>{h.sha256.slice(0, 12)}…</code>}</li>)}</ol> : <p>資料取得・編集判断の記録はまだありません。</p>}
              <p className={styles.meta}>担当者名・判断理由は、この共有用の記録に含めていません。応答の変化は、財務内容の訂正と確定したものではありません。</p>
            </details>
          </article></li>;
        })}</ul>}
        {pages > 1 && <nav aria-label="資料のページ切り替え" className={styles.pagination}><button disabled={page === 1} onClick={() => { setPage(p => p - 1); requestAnimationFrame(() => document.getElementById("queue-title")?.scrollIntoView()); }}>前の20件</button><span>{page} / {pages}</span><button disabled={page === pages} onClick={() => { setPage(p => p + 1); requestAnimationFrame(() => document.getElementById("queue-title")?.scrollIntoView()); }}>次の20件</button></nav>}
      </section>
      <footer className={styles.footer}>TECH PHASE RESEARCH · 取得状況の確認版<br />新着の網羅性・速度を保証する画面ではありません。</footer>
    </main>
  </div>;
}
