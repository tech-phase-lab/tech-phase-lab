import Link from 'next/link';
import type { Language } from '@/lib/research/data';
import base from '../research.module.css';
import styles from './company-directory.module.css';
export type DirectoryCompany = {ticker:string;name:string;sector:{ja:string;en:string};verified:boolean};
export default function CompanyDirectory({companies,lang}:{companies:DirectoryCompany[];lang:Language}) {
 const ja=lang==='ja';
 return <section id="monitored-companies" aria-labelledby="monitored-companies-title">
  <div className={base.directoryHead}>
   <div><p className={base.eyebrow}>COMPANY WATCH</p><h1 id="monitored-companies-title">{ja?`監視${companies.length}銘柄リスト`:`${companies.length}-stock watch list`}</h1></div>
   <div className={base.directoryLegend}><span><i className={base.verifiedDot} aria-hidden="true"/>{ja?'数値比較を公開済み':'Verified comparison'}</span><span><i aria-hidden="true"/>{ja?'取得状況を公開':'Intake status'}</span></div>
  </div>
  <div className={styles.tiles}>{companies.map(company=><Link key={company.ticker} href={`/research/companies/${company.ticker}`} aria-label={`${company.name}（${company.ticker}） — ${company.verified?(ja?'数値比較を公開済み':'Verified comparison'):(ja?'取得状況を公開':'Intake status')}`}>
   <strong>{company.ticker}<i className={company.verified?styles.verified:undefined} aria-hidden="true"/></strong><span>{company.name}</span><small>{company.sector[lang]}</small>
  </Link>)}</div>
  <details className={base.directoryInfo}><summary>{ja?'掲載状況について':'About coverage'}</summary><p>{ja?'緑の印は数値を照合したリサーチがある銘柄です。速報配信や全資料の分析完了を示すものではありません。':'Green marks indicate source-checked research, not live delivery or complete analysis of every release.'}</p></details>
 </section>;
}
