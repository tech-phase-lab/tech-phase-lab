import { twelveFactorMethods } from "@/lib/research/twelve-data-factors";
import styles from "./styles.module.css";
export default function ScoreMethod({lang,embedded=false}:{lang:"ja"|"en";embedded?:boolean}) {
  const ja=lang==="ja";
  const content=<>
    <p>{ja?"7項目を0〜10点で評価し、総合点は同じ重みで平均します。高いほど各指標の条件が良好です。総合点の差が0.3点未満なら拮抗と表示します。比較可能な7項目が全社で揃わない場合は総合順位を出しません。":"Seven factors are scored from 0 to 10 and averaged with equal weights. Higher scores indicate more favorable measured conditions. A gap below 0.3 is treated as close. Overall rankings require all seven comparable factors for every company."}</p>
    <p>{ja?"黄色の横棒・数値は、その項目で最も高いスコア。同率首位は両方を強調し、全社同点や欠損がある項目は強調しません。銘柄名は白系、通常の横棒は控えめなシャンパン色、ステータスの線は落ち着いたブロンズで表示します。":"Gold bars and numbers mark the highest factor score. Tied leaders are highlighted unless all companies tie. Incomplete factors have no highlighted leader. Company names use a consistent off-white. Standard bars use muted champagne; status lines use a muted bronze."}</p>
    <p>{ja?"成長性：四半期売上の前年同期比を使用。0%＝5点、+50%＝10点、−50%＝0点。":"Growth: quarterly revenue year-over-year change. 0% = 5, +50% = 10, −50% = 0."}</p>
    <p>{ja?"収益性：直近四半期の営業利益率を使用。0%＝0点、25%＝5点、50%＝10点。":"Profitability: latest quarterly operating margin. 0% = 0, 25% = 5, 50% = 10."}</p>
    <p>{ja?"資金創出：営業CFから設備投資支出を引いた簡易FCFの売上比率。−25%＝0点、0%＝5点、+25%＝10点。買収支出等は網羅しません。":"Cash generation: operating cash flow less cash capital expenditure, divided by revenue. −25% = 0, 0% = 5, +25% = 10. This does not capture all acquisition spending."}</p>
    {Object.entries(twelveFactorMethods).map(([id,m])=><p key={id}>{m[lang]}</p>)}
    <p>{ja?"点数は共通基準による参考評価で、同業順位・将来の株価予測・売買推奨ではありません。欠損は「—」で表示し、0点にはしません。予想PERの利益予想期間・更新日は提供元の応答で確認できない場合があります。取得日時はデータ更新日と区別します。":"Scores are common-scale reference assessments, not peer rankings, price forecasts or trading recommendations. Missing values are shown as —, not zero. The provider response may not establish the earnings forecast horizon or update date for forward P/E. Retrieval time is distinct from the data update time."}</p>
    <p>{ja?"長所・短所は取得済みの数値から抽出します。インサイダー売買、国別の売上構成、訴訟などは別の根拠が必要で、数値スコアだけでは網羅しません。":"Strengths and weaknesses are derived from available figures. Insider transactions, geographic exposure and litigation require separate evidence and are not covered by numerical scores alone."}</p>
  </>;
  return embedded ? <div className={styles.scoreMethod}>{content}</div> : <details className={styles.scoreMethod}><summary>{ja?"スコアの見方":"How to read the scores"}</summary>{content}</details>;
}
