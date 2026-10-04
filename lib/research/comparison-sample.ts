import { buildTwelveFinancials } from "./twelve-data-financials.ts";
import type { ComparisonResult } from "./comparison.ts";

/** Fictional companies and fabricated financial inputs, solely for UI interaction.
 * Keep out of stock search, provider caches, normal comparison API and real tickers.
 */
export function buildComparisonSample(): ComparisonResult {
  const now=Date.parse("2026-10-04T10:00:00Z"),retrievedAt=new Date(now).toISOString();
  const specs=[
    {ticker:"DEMO-A",name:"Atlas Demo",growth:40,margin:32,fcf:18,pe:18,ratio:2.1,cash:100,debt:60,change:24,margins:[32,30,28,29]},
    {ticker:"DEMO-B",name:"Beacon Demo",growth:65,margin:16,fcf:-6,pe:34,ratio:1.2,cash:35,debt:90,change:48,margins:[16,8,-3,12]},
    {ticker:"DEMO-C",name:"Cedar Demo",growth:8,margin:24,fcf:22,pe:12,ratio:1.8,cash:80,debt:50,change:-14,margins:[24,25,24,25]},
  ];
  const companies=specs.map(d=>{
    const ends=["2026-08-31","2026-05-31","2026-02-28","2025-11-30","2025-08-31"];
    const revenue=100*(1+d.growth/100);
    const financials=buildTwelveFinancials({ticker:d.ticker,retrievedAt,accountingBasis:"us-gaap",
      income:{meta:{symbol:d.ticker,currency:"USD",period:"Quarterly"},income_statement:ends.map((fiscal_date,i)=>({fiscal_date,
        quarter:[4,3,2,1,4][i],year:i<4?2026:2025,sales:i===4?100:revenue,operating_income:(i===4?100:revenue)*(d.margins[i]??20)/100,eps_diluted:2}))},
      cashFlow:{meta:{symbol:d.ticker,currency:"USD",period:"Quarterly"},cash_flow:[{fiscal_date:ends[0],quarter:4,year:2026,
        operating_activities:{operating_cash_flow:revenue*d.fcf/100+20},investing_activities:{capital_expenditures:-20}}]},
      statistics:{retrievedAt,payload:{meta:{symbol:d.ticker,currency:"USD"},statistics:{valuations_metrics:{forward_pe:d.pe},financials:{most_recent_quarter:ends[0],balance_sheet:{current_ratio_mrq:d.ratio,total_cash_mrq:d.cash,total_debt_mrq:d.debt}}}}},
      series:{retrievedAt,adjust:"splits",payload:{meta:{symbol:d.ticker,currency:"USD",interval:"1day"},values:[{datetime:"2026-10-02",close:100+d.change},{datetime:"2026-07-03",close:100}]}}
    },now);
    return {...financials,name:d.name,peer:"fictional-demo",caution:{ja:"架空のサンプルです。",en:"Fictional sample."}};
  });
  return {companies,comparable:true,reasons:[],generatedAt:retrievedAt,
    conclusion:{ja:"Atlasは収益性、Beaconは成長性で上回ります",en:"Atlas leads in profitability; Beacon leads in growth"}};
}
