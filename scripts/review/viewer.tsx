import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { ComparisonResult } from '../../lib/research/comparison';
import sampleData from './sample.generated.json';
import { overallComparison } from '../../lib/research/comparison-scorecard';
import { CompanyScoreCard, ScoreOverview } from '../../app/research/compare/comparison-visuals';
import DetailPanels from '../../app/research/compare/detail-panels';
import compare from '../../app/research/compare/styles.module.css';
import registry from './companies.generated.json';
import './viewer.css';

// This standalone public viewer imports presentation and fictional comparison
// inputs only. No authenticated layout, paid articles, monitor APIs or keys.
const sample=sampleData as unknown as ComparisonResult;
const sectorNames:Record<string,string>={semiconductors:'半導体',networking:'ネットワーク','ai-cloud':'AIクラウド','power-cooling':'電力・冷却',servers:'サーバー',software:'AIソフトウェア',platforms:'大手クラウド'};
const sectorNamesEn:Record<string,string>={semiconductors:'Semiconductors',networking:'Networking','ai-cloud':'AI cloud','power-cooling':'Power & cooling',servers:'Servers',software:'AI software',platforms:'Large cloud platforms'};
function Viewer(){
  const [lang,setLang]=useState<'ja'|'en'>(new URLSearchParams(location.search).get('lang')==='en'?'en':'ja');
  const [tab,setTab]=useState<'watch'|'compare'>('compare');
  const [count,setCount]=useState(2),[ticker,setTicker]=useState<string|null>(null);
  const ja=lang==='ja',companies=sample.companies.slice(0,count),now=Date.parse(sample.generatedAt);
  const assessment=overallComparison(companies,lang,now);
  const selected=registry.find(c=>c.ticker===ticker);
  const groups=Object.entries(ja?sectorNames:sectorNamesEn).filter(([id])=>registry.some(c=>c.sector===id));
  return <>
    <header className="viewer-header"><a className="viewer-brand" href={ja?'./index.html':'./en.html'}><img src="./mark.svg" alt="" width="36" height="36"/><span>TECH PHASE<small>RESEARCH</small></span></a><div className="viewer-languages"><button aria-pressed={ja} onClick={()=>setLang('ja')}>日本語</button><button aria-pressed={!ja} onClick={()=>setLang('en')}>EN</button></div></header>
    <main className="viewer-main">
      <a className="viewer-back" href={ja?'./index.html':'./en.html'}>← {ja?'サービス紹介へ':'Service overview'}</a>
      <p className="viewer-notice">{ja?'公開前の閲覧用画面です。銘柄比較は架空データで動作を確認できます。実際の株価・速報の配信、会員登録・決済は未開始です。':'Pre-launch product preview. Comparison uses fictional data to demonstrate the interface. Live prices, news delivery, registration and payment are not enabled here.'}</p>
      <nav className="viewer-tabs" aria-label={ja?'機能を選択':'Choose a feature'}><button aria-current={tab==='compare'?'page':undefined} onClick={()=>{setTab('compare');setTicker(null)}}>{ja?'銘柄比較PRO':'Compare stocks PRO'}</button><button aria-current={tab==='watch'?'page':undefined} onClick={()=>setTab('watch')}>{ja?'監視22銘柄リスト':'22-company watchlist'}</button></nav>
      {tab==='compare'?<div className={`${compare.results} ${compare.resultView}`}>
        <div className="viewer-comparison-header"><h1>{ja?'銘柄比較PRO':'Compare stocks PRO'}</h1><div className={compare.scoreViewSwitch} role="group" aria-label={ja?'比較する社数':'Company count'}>{[2,3].map(n=><button key={n} aria-pressed={count===n} onClick={()=>setCount(n)}>{ja?`${n}社で比較`:`Compare ${n}`}</button>)}</div></div>
        <section className={compare.conclusion}><p className={compare.eyebrow}>{ja?'結果':'RESULTS'}</p><h2>{assessment.title}</h2><p>{assessment.description}</p></section>
        <div className={compare.companyCards}>{companies.map((company,i)=><CompanyScoreCard key={company.ticker} company={company} colorIndex={i} lang={lang} now={now}/>)}</div>
        <ScoreOverview companies={companies} lang={lang} now={now}/>
        <DetailPanels lang={lang}>{companies.map(c=><section key={c.ticker}><h3>{c.name}（{c.ticker}）</h3><ul>{c.preparedAnalysis?.items.map(item=><li key={item.id}><strong data-kind={item.kind}>{item.short[lang]}</strong><p>{item.detail[lang]}</p></li>)}</ul></section>)}</DetailPanels>
        <p className="viewer-footnote">{ja?'DEMO-A / B / Cは架空の企業・数値です。実在企業の評価ではありません。本サービスと共通のスコア計算・表示部品を使用しています。':'DEMO-A / B / C and their figures are fictional, not assessments of real companies. This preview uses the product’s scoring and presentation components.'}</p>
      </div>:<section className="viewer-watch">
        {selected?<><button className="viewer-back" onClick={()=>setTicker(null)}>← {ja?'監視22銘柄リスト':'22-company watchlist'}</button><h1>{selected.name}（{selected.ticker}）</h1><p className="viewer-sector">{(ja?sectorNames:sectorNamesEn)[selected.sector]}</p><section className="viewer-monitor"><h2>{ja?'リアルタイム監視':'Live monitor'}</h2><span>{ja?'閲覧用・配信未接続':'Preview · feed not connected'}</span><p>{ja?'新着情報と決算の変化を、銘柄ごとに追うための画面です。公開前のため、ここには速報や現在の株価を表示していません。':'This view is designed to track new information and earnings changes by company. Live news and current prices are not shown in this pre-launch viewer.'}</p></section><div className="viewer-watch-panels">{[ja?'直近決算':'Latest earnings',ja?'前回からの変化':'What changed',ja?'注意点':'Risks to watch',ja?'次に見るポイント':'Next checkpoints'].map(title=><article key={title}><h2>{title}</h2><p>{ja?'正式提供時に、資料の日付と根拠を添えて掲載します。':'At launch, information will include the reporting date and supporting evidence.'}</p></article>)}</div></>:<><h1>{ja?'監視22銘柄リスト':'22-company watchlist'}</h1><p className="viewer-footnote">{ja?'実際の監視対象を業種ごとに表示。銘柄を選ぶと個別ページの構成を確認できます。':'The actual coverage universe, grouped by sector. Select a company to view its page structure.'}</p><div className="viewer-groups">{groups.map(([id,name])=><section key={id}><h2>{name}<small>{registry.filter(c=>c.sector===id).length}</small></h2><div className="viewer-tiles">{registry.filter(c=>c.sector===id).map(c=><button key={c.ticker} onClick={()=>setTicker(c.ticker)}><strong>{c.ticker}</strong><span>{c.name}</span></button>)}</div></section>)}</div></>}
      </section>}
    </main>
    <footer className="viewer-footer"><span>© 2026 Tech Phase Research</span><nav>{(ja?[['terms.html','利用規約'],['privacy.html','プライバシーポリシー'],['disclosure.html','特定商取引法に基づく表記'],['contact.html','運営者・お問い合わせ']]:[['terms-en.html','Terms'],['privacy-en.html','Privacy'],['disclosure-en.html','Commercial disclosure'],['contact-en.html','Operator & contact']]).map(([href,title])=><a key={href} href={`./${href}`}>{title}</a>)}</nav></footer>
  </>;
}
createRoot(document.getElementById('product-viewer')!).render(<Viewer/>);
