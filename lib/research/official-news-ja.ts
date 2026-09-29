/** Editorial Japanese headlines for currently published official updates.
 * Based on displayed source headlines / post excerpts, not full-article analysis.
 * Exact URL matching only: unseen stories must never inherit another story's translation.
 */
const headlines: Record<string, string> = {
  "https://x.com/nebiusai/status/2104496608725372988": "NVIDIA、AIエージェント向け安全基盤「Open Agent Safety Platform」を発表",
  "https://developer.nvidia.com/blog/nvidia-open-agent-safety-platform-a-reference-for-continuous-in-silicon-agent-monitoring/": "NVIDIA、チップ上でAIエージェントを継続監視する安全基盤を紹介",
  "https://developer.nvidia.com/blog/add-runtime-controls-to-ai-agents-with-nvidia-openshell/": "NVIDIA OpenShellでAIエージェントの実行中の動作を制御",
  "https://developer.nvidia.com/blog/how-nvidia-dsx-maxlps-maximizes-ai-factory-throughput-and-efficiency/": "NVIDIA DSX MaxLPS、AIデータセンターの処理能力と効率を高める仕組み",
  "https://nebius.com/blog/posts/in-agentic-rl-faster-tokens-are-not-enough": "AIエージェントの強化学習では、生成速度の向上だけでは不十分",
  "https://investor.marvell.com/news-events/press-releases/detail/1035/marvell-technology-inc-declares-quarterly-dividend-payment": "Marvell、四半期配当の実施を発表",
  "https://x.com/nebiusai/status/2103551781217128879": "NebiusのAI開発者向けイベント、14都市で開催済み・残り6都市へ",
  "https://x.com/nebiusai/status/2103522419474681970": "Nebius、10月1日に医療向け音声AIの構築・評価を学ぶイベントを開催",
  "https://x.com/nebiusai/status/2103467473802605055": "Nebius、GTC Berlinへの出展と参加パスの20％割引を案内",
  "https://x.com/nebiusai/status/2103190045163213246": "NebiusとWEKA、共有KVキャッシュがAIエージェントの継続的な推論に与える効果を検証",
  "https://developer.nvidia.com/blog/efficient-moe-training-for-biological-foundation-models/": "生物学向け基盤モデルでMoEを効率的に学習する手法",
  "https://nebius.com/blog/posts/nebius-weka-shared-kv-cache-benchmark-hgx-b300": "NebiusとWEKA、NVIDIA HGX B300で推論用の分散KVキャッシュを性能検証",
  "https://developer.nvidia.com/blog/introducing-nv-reason-ct-open-3d-ct-vlm-for-radiologist-chain-of-thought-reasoning/": "NVIDIA、CT画像の読影時の段階的な推論を支援する公開モデル「NV-Reason-CT」を紹介",
  "https://x.com/nebiusai/status/2102879043238396244": "SemiAnalysis、NebiusにAIクラウドの最高評価「Platinum」を付与",
  "https://developer.nvidia.com/blog/validate-gpu-cluster-readiness-before-ai-workloads-land/": "AI処理の導入前にGPUクラスターの稼働準備を検証する方法",
  "https://developer.nvidia.com/blog/manage-kubernetes-node-fleets-with-nodewright/": "NodeWrightでKubernetesのノード群を管理",
  "https://developer.nvidia.com/blog/how-swe-serve-exposes-the-gap-between-local-tests-and-live-serving/": "SWE-Serveが示す、ローカルテストと本番サービス運用の差",
  "https://nebius.com/blog/posts/nebius-platinum-clustermax-3-0": "Nebius、SemiAnalysisの「ClusterMAX 3.0」でPlatinum評価を獲得",
  "https://developer.nvidia.com/blog/enabling-private-high-performance-production-ai-inference-with-nvidia-confidential-computing/": "NVIDIAの機密コンピューティングで、機密性と高性能を両立する本番AI推論"
};
export function officialHeadlineJa(url: string): string | null {
  return Object.hasOwn(headlines, url) ? headlines[url] : null;
}
