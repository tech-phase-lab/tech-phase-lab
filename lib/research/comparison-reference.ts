/** Reproducible reference scale for a reviewed comparison snapshot, not peer ranks. */
export type ReferenceInputs = {
 rev:number; prior:number; op:number; annualEps:number; close:number;
 cash:number; debt:number; currentAssets:number; currentLiabilities:number;
 operatingCash:number; capex:number; revenues:number[]; operatingIncomes:number[];
 historyStart:number; guide:number[];
};
export type ReferenceFactor = {id:string;value:number|null;metric:{ja:string;en:string};method:{ja:string;en:string}};
export type ReferenceEvaluation = {
 asOf:string; announced:string; factors:ReferenceFactor[];
 sources:{label:string;url:string}[];
 observations?:{ja:string;en:string}[];
};
const copy=(ja:string,en:string)=>({ja,en});
const round=(v:number)=>Math.round(Math.max(0,Math.min(10,v))*10)/10;
const smooth=(v:number,scale:number)=>5+5*v/(scale+Math.abs(v));
const sd=(xs:number[])=>{const mean=xs.reduce((a,b)=>a+b,0)/xs.length;return Math.sqrt(xs.reduce((a,b)=>a+(b-mean)**2,0)/xs.length);};
export function evaluateReference(d:ReferenceInputs, benchmark:{start:number;end:number}):ReferenceFactor[] {
 const numbers=[d.rev,d.prior,d.op,d.annualEps,d.close,d.cash,d.debt,d.currentAssets,d.currentLiabilities,d.operatingCash,d.capex,d.historyStart,...d.revenues,...d.operatingIncomes,...d.guide,benchmark.start,benchmark.end];
 if(!numbers.every(Number.isFinite)||[d.rev,d.prior,d.annualEps,d.close,d.currentLiabilities,d.historyStart,benchmark.start,benchmark.end,...d.revenues].some(n=>n<=0)||[d.cash,d.debt,d.capex,d.currentAssets].some(n=>n<0)||d.revenues.length!==4||d.operatingIncomes.length!==4||d.guide.length!==2||d.guide[0]>d.guide[1])throw Error('Incomplete reference evidence');
 if(d.revenues[3]!==d.rev||d.operatingIncomes[3]!==d.op)throw Error('Latest quarter mismatch');
 const pe=d.close/d.annualEps, growth=(d.rev/d.prior-1)*100, margin=d.op/d.rev*100;
 const current=d.currentAssets/d.currentLiabilities, netCash=d.cash-d.debt;
 const cashMargin=(d.operatingCash-d.capex)/d.rev*100;
 const margins=d.operatingIncomes.map((op,i)=>op/d.revenues[i]*100), dispersion=sd(margins);
 const returnPct=(d.close/d.historyStart-1)*100, benchmarkPct=(benchmark.end/benchmark.start-1)*100, excess=returnPct-benchmarkPct;
 const factor=(id:string,v:number|null,metric:{ja:string;en:string},method:{ja:string;en:string})=>({id,value:v===null?null:round(v),metric,method});
 return [
 factor('financial',(10*current/(1+current)+smooth(netCash/d.rev*100,50))/2,copy(`流動比率 ${current.toFixed(2)}倍`,`Current ratio ${current.toFixed(2)}×`),copy('流動比率を10r/(1+r)、純現金/四半期売上比率を5+5x/(50+|x|)に変換し平均。リース等の全債務は含まない。','Average of 10r/(1+r) for current ratio and 5+5x/(50+|x|) for net cash / quarterly revenue %. Not all lease obligations are included.')),
 factor('profitability',Math.max(0,10*margin/(25+Math.abs(margin))),copy(`営業利益率 ${margin.toFixed(1)}%`,`Operating margin ${margin.toFixed(1)}%`),copy('GAAP営業利益率m：max(0,10m/(25+|m|))。25%で5点。','GAAP operating margin m: max(0,10m/(25+|m|)); 25% maps to 5.')),
 factor('valuation',null,copy(`実績PER ${pe.toFixed(2)}倍`,`Annual earnings P/E ${pe.toFixed(2)}×`),copy('終値÷直近通期GAAP希薄化EPS。予想利益・成長性・同業比較を確認できていないため、割安性の採点は保留。','Closing price / latest annual GAAP diluted EPS. Valuation is not scored without verified forecasts, growth context and peer comparisons.')),
 factor('stability',null,copy(`利益率変動 ${dispersion.toFixed(1)}pt`,`Margin SD ${dispersion.toFixed(1)}pp`),copy('直近4四半期の営業利益率の母標準偏差。改善と悪化を区別しない数値のため、安定性の採点には使用しない。','Population SD of four quarterly operating margins. This does not distinguish improvement from deterioration and is not used to score stability.')),
 factor('momentum',smooth(excess,20),copy(`指数比 ${excess>=0?'+':''}${excess.toFixed(1)}pt`,`vs index ${excess>=0?'+':''}${excess.toFixed(1)}pp`),copy('7/2→10/2の株価騰落率−NASDAQ100騰落率=x、5+5x/(20+|x|)。配当を含まない。','July 2 to October 2 price return minus Nasdaq-100 price return = x; 5+5x/(20+|x|). Dividends excluded.')),
 factor('growth',smooth(growth,100),copy(`売上前年比 ${growth>=0?"+":""}${growth.toFixed(1)}%`,`Revenue YoY ${growth>=0?"+":""}${growth.toFixed(1)}%`),copy('売上前年比g：5+5g/(100+|g|)。次期会社予想は実績と分けて記載。','Revenue YoY g: 5+5g/(100+|g|). Company guidance is shown separately from actuals.')),
 factor('cash',smooth(cashMargin,25),copy(`簡易FCF率 ${cashMargin.toFixed(1)}%`,`Simple FCF margin ${cashMargin.toFixed(1)}%`),copy('営業CF−現金設備投資を売上で割った比率x：5+5x/(25+|x|)。前受金・政府補助・JV投資等で比較に限界。','x = (operating CF − cash capex)/revenue %; 5+5x/(25+|x|). Prepayments, grants and JV investment limit comparability.')),
 ];
}
