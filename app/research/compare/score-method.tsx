import { twelveFactorMethods } from "@/lib/research/twelve-data-factors";
import styles from "./styles.module.css";
export default function ScoreMethod({lang,embedded=false}:{lang:"ja"|"en";embedded?:boolean}) {
  const ja=lang==="ja";
  const content=<>
    <p>{ja?"7項目を0〜10点で評価し、総合点は同じ重みで平均します。高いほど各指標の条件が良好です。総合点の差が0.3点未満なら拮抗と表示します。比較可能な7項目が全社で揃わない場合は総合順位を出しません。":"Each of the seven factors gets a score from 0 to 10, and all seven count equally toward the average. Higher scores reflect more favorable results for the measures used. Scores less than 0.3 points apart are considered close. We only show an overall ranking when all seven factors can be compared across every company."}</p>
    <p>{ja?"黄色の横棒・数値は、その項目で最も高いスコア。同率首位は両方を強調し、全社同点や欠損がある項目は強調しません。銘柄名は白系、通常の横棒は控えめなシャンパン色、ステータスの線は落ち着いたブロンズで表示します。":"Gold highlights the highest score for each factor. Tied scores are highlighted too, unless every company ties. No leader is highlighted when a factor has incomplete data."}</p>
    <p>{ja?"成長性：四半期売上の前年同期比を使用。0%＝5点、+50%＝10点、−50%＝0点。":"Growth: the change in quarterly revenue from the same quarter a year earlier. A 0% change scores 5, +50% scores 10, and −50% scores 0."}</p>
    <p>{ja?"収益性：直近四半期の営業利益率を使用。0%＝0点、25%＝5点、50%＝10点。":"Profitability: operating margin for the latest quarter. A 0% margin scores 0, 25% scores 5, and 50% scores 10."}</p>
    <p>{ja?"資金創出：営業CFから設備投資支出を引いた簡易FCFの売上比率。−25%＝0点、0%＝5点、+25%＝10点。買収支出等は網羅しません。":"Cash generation: operating cash flow minus cash capital expenditures, divided by revenue. A −25% margin scores 0, 0% scores 5, and +25% scores 10. This measure doesn't include all acquisition spending."}</p>
    {Object.entries(twelveFactorMethods).map(([id,m])=><p key={id}>{m[lang]}</p>)}
    <p>{ja?"点数は共通基準による参考評価で、同業順位・将来の株価予測・売買推奨ではありません。欠損は「—」で表示し、0点にはしません。予想PERの利益予想期間・更新日は提供元の応答で確認できない場合があります。取得日時はデータ更新日と区別します。":"These reference scores use the same scale for every company. They aren't peer rankings, price forecasts, or trading recommendations. Missing values appear as —, not zero. The data provider may not specify the earnings forecast period or last update date used for forward P/E. The time we retrieved the data may differ from the time it was last updated."}</p>
    <p>{ja?"長所・短所は取得済みの数値から抽出します。インサイダー売買、国別の売上構成、訴訟などは別の根拠が必要で、数値スコアだけでは網羅しません。":"Strengths and weaknesses are based on the available figures. Insider transactions, geographic exposure, and litigation need separate research; the scores alone don't cover them."}</p>
  </>;
  return embedded ? <div className={styles.scoreMethod}>{content}</div> : <details className={styles.scoreMethod}><summary>{ja?"スコアの見方":"How to read the scores"}</summary>{content}</details>;
}
