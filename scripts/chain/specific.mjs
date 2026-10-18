import {contains, normalize, hits} from './evidence.mjs';
import {createRequire} from 'node:module';
const {parse}=createRequire(import.meta.url)('node-html-parser');

const partnership = /\b(?:partner(?:ship|s|ed|ing)?|collaborat(?:e|es|ed|ing|ion|ions)|joint venture|jointly|co-develop\w*)\b/i;
const investment = /\b(?:invest(?:s|ed|ing|ment)?|equity investment|acquir\w*|stake)\b/i;
const transaction = /\b(?:suppl\w*|purchas\w*|deploy\w*|adopt\w*|select\w*|deliver\w*|integrat\w*|power(?:s|ed|ing)?|provid\w*|manufactur\w*|customer|contract|agreement)\b/i;
const competitive = /\b(?:competitor\w*|compet(?:e|es|ing|ition)|rival\w*)\b/i;
const irrelevant = /sign in|sign up|privacy policy|cookie settings|forward-looking statements|may differ materially/i;
const products = [
  [/sovereign AI stack/i, '主権AI基盤'],
  [/Oracle\s+(?:AI\s+)?Database@AWS/i, 'Database@AWS'],
  [/DGX\s+(?:Cloud|Spark|Station)/i, null],
  [/fuel[- ]cell/i, '燃料電池'], [/Blackwell/i, 'Blackwell'], [/Rubin/i, 'Rubin'],
  [/\bHBM(?:[234](?:E)?)?\b/i, '積層メモリー'], [/\bGPU\w*\b/i, 'GPU'],
  [/AI[- ](?:native )?(?:compute |cloud )?infrastructure/i, 'AI基盤'],
  [/AI[- ](?:data cent(?:er|re)|factor(?:y|ies))/i, 'AIデータセンター'],
  [/\bdata cent(?:er|re)s?\b/i, 'データセンター'], [/\bcloud\b/i, 'クラウド'],
  [/\bmemory\b/i, 'メモリー'], [/\bsemiconductors?\b/i, '半導体'],
  [/\boptical\b/i, '光通信'], [/\bnetworking\b/i, 'ネットワーク'],
  [/\brobotics?\b/i, 'ロボット'], [/\bquantum\b/i, '量子計算'],
];
const lengthOK = s => Array.from(s).length <= 30;
const reEscape = s => s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
function canonicalNames(q, companies) {
  // Replace all aliases simultaneously to avoid corrupting a longer alias.
  const aliases = companies.flatMap(c => [c.name,...(c.aliases??[]),c.id].filter(Boolean).map(a=>({a,id:c.id}))).sort((a,b)=>b.a.length-a.a.length);
  const lookup = new Map(aliases.map(a=>[a.a.toLowerCase(),a.id]));
  return q.replace(new RegExp(`(?<![\\w])(?:${aliases.map(x=>reEscape(x.a)).join('|')})(?![\\w])`,'gi'),m=>lookup.get(m.toLowerCase()));
}
function directedInvestment(q, issuer, other) {
  if(!issuer)return null;
  const canonical=canonicalNames(q,[issuer,other]);
  for(const [investor,recipient] of [[issuer,other],[other,issuer]]){
    const match=canonical.match(new RegExp(`${reEscape(investor.id)}\\s+(?:(has|will|is)\\s+)?invest(?:s|ed|ing)?\\s+\\$\\s*(\\d+(?:\\.\\d+)?)\\s*(billion|million)\\s+(?:in|into)\\s+${reEscape(recipient.id)}\\b`,'i'));
    if(match)return {investor,recipient,amount:Number((Number(match[2])*(/billion/i.test(match[3])?10:0.01)).toFixed(6)),planned:match[1]?.toLowerCase()==='will'};
  }
  return null;
}
function bilateralPartnership(q,issuer,other){
  if(!partnership.test(q))return false;
  const c=canonicalNames(q,[issuer,other]),a=reEscape(issuer.id),b=reEscape(other.id);
  // Both parties must be grammatical participants, rather than a quotation
  // attribution or an unrelated product name next to the word collaboration.
  for(const [x,y] of [[a,b],[b,a]]){
    if(new RegExp(`${x}(?:[’']s)?\\s+and\\s+${y}(?:[’']s)?[^.;]{0,65}\\b(?:partner(?:ship|s|ed|ing)?|collaborat(?:e|es|ed|ing|ion)|jointly)\\b`,'i').test(c))return true;
    if(new RegExp(`${x}[^.;]{0,55}\\b(?:partner(?:ship|s|ed|ing)?|collaborat(?:e|es|ed|ing|ion))\\b[^.;]{0,25}\\bwith\\s+${y}\\b`,'i').test(c))return true;
    if(new RegExp(`(?:partnership|collaboration)\\s+(?:between|among)\\s+${x}\\s+and\\s+${y}\\b`,'i').test(c))return true;
    if(new RegExp(`(?:collaboration|partnership)[,:]\\s*${x}\\s+and\\s+${y}\\b`,'i').test(c))return true;
  }
  return false;
}

/** Only punctuation-delimited independent clauses can shorten a quote. Subject
 * names must start the clause and an actual predicate must follow them. A numeric
 * window or removing words inside a clause is intentionally not supported. */
export function independentQuote(statement, issuer, other) {
  if (Array.from(statement).length <= 200) return statement;
  const clauses = statement.split(/;\s*|\s+[—–]\s+|,\s+(?=and\s+[A-Z])/).map(x=>x.trim());
  for (const clause of clauses) {
    if (Array.from(clause).length > 200 || !contains(clause,issuer) || !contains(clause,other)) continue;
    const first = Math.min(...hits(clause,issuer).map(x=>x.start),...hits(clause,other).map(x=>x.start));
    if (!/^(?:and\s+)?$/i.test(clause.slice(0,first))) continue;
    if (/\b(?:if|unless|would|could|might|not|never)\b/i.test(clause)) continue;
    if (partnership.test(clause)||investment.test(clause)||transaction.test(clause)||competitive.test(clause)) return clause;
  }
  return null;
}

/** A deliberately closed vocabulary: unsupported prose becomes a visible rejection.
 * No facts are imported from an old candidate, article title or another sentence.
 * Type direction is separately inferred; these descriptions avoid assigning roles.
 */
export function concreteJapanese(quote, counterparty, type, issuer) {
  const q = normalize(quote), label = counterparty.id;
  if (type === '競合') {
    const productRule=products.find(([re])=>re.test(q));
    const product=productRule&&(productRule[1]??q.match(productRule[0])[0]);
    const text = competitive.test(q) && product ? `${label}と${product}で競合` : null;
    return text && lengthOK(text) ? text : null;
  }
  const inv=directedInvestment(q,issuer,counterparty);
  if(inv){const text=`${inv.investor.id}が${inv.recipient.id}に${inv.amount}億ドル出資${inv.planned?'予定':''}`;return lengthOK(text)?text:null;}
  // Spending to deploy another company's equipment is not an equity investment
  // in that company. Preserve the spending ceiling and future tense explicitly.
  if(issuer){
    const canonical=canonicalNames(q,[issuer,counterparty]);
    for(const [buyer,vendor] of [[issuer,counterparty],[counterparty,issuer]]){
      const spending=canonical.match(new RegExp(`${reEscape(buyer.id)}\\s+(will\\s+)?invest\\s+(up to\\s+)?\\$\\s*(\\d+(?:\\.\\d+)?)\\s*(billion|million)\\s+to\\s+deploy\\s+${reEscape(vendor.id)}[’']s\\s+(?:advanced\\s+)?fuel[- ]cell\\s+technology`,'i'));
      if(!spending)continue;
      const amount=Number((Number(spending[3])*(/billion/i.test(spending[4])?10:0.01)).toFixed(6));
      const text=`${buyer.id}が${spending[2]?'最大':''}${amount}億ドルで燃料電池導入${spending[1]?'予定':''}`;
      return lengthOK(text)?text:null;
    }
  }
  // Bind each translated action to its own object. Independent occurrence of
  // e.g. "AI factory" and "manufacturing" is not AI-factory manufacturing.
  let fact=null;
  const partnershipAmount=q.match(/\$\s*(\d+(?:\.\d+)?)\s*(billion|million)\s+(?:strategic\s+)?AI infrastructure partnership/i);
  if(partnershipAmount){const amount=Number((Number(partnershipAmount[1])*(/billion/i.test(partnershipAmount[2])?10:0.01)).toFixed(6));fact=`${amount}億ドル規模のAI基盤提携`;}
  if(/deliver\s+a\s+VMware AI Factory\s+that\s+pairs\s+VCF\s+with\s+AMD Instinct GPUs/i.test(q))fact='VMware製AI基盤を提供';
  else if(/develop\s+smarter algorithms based on quantum computers\s+to\s+achieve cost savings due to more efficient cargo loading and distribution/i.test(q))fact='貨物積載・配送向け量子アルゴリズム開発';
  else if(/deploy(?:ing|s|ed)?\s+[^.;]{0,35}GPU health monitoring and software recommendations/i.test(q))fact='GPU健全性監視・ソフト推奨を導入';
  else if(/create\s+a\s+cloud platform for robotics and physical AI/i.test(q))fact='ロボット向けクラウド基盤構築';
  else if(/advance\s+next-generation memory/i.test(q))fact=`次世代メモリー技術開発${/multiyear/i.test(q)?'で複数年提携':''}`;
  else if(/accelerat(?:e|ing)\s+the\s+buildout of AI factories/i.test(q))fact='AI工場の建設を促進';
  else if(/jointly develop\s+multiple generations of custom data center and PC products/i.test(q))fact='データセンター・PC製品共同開発';
  else if(/accelerat(?:e|ing)\s+(?:customer\s+)?migration\s+to\s+Oracle\s+(?:AI\s+)?Database@AWS/i.test(q))fact='Database@AWSへの移行促進';
  const capPattern='(?:(?:up to|at least)\\s+)?\\d+(?:\\.\\d+)?\\s*(?:GW|MW|gigawatts?|megawatts?)';
  const capacity=q.match(new RegExp(`\\b(${capPattern})`,'i'))?.[1];
  const capJa=capacity?.replace(/up to\s+/i,'最大').replace(/at least\s+/i,'').replace(/gigawatts?/i,'GW').replace(/megawatts?/i,'MW').replace(/\s+/g,'')+(/at least/i.test(capacity??'')?'以上':'');
  if(!fact&&new RegExp(`deploy\\s+${capPattern}\\s+to\\s+accelerate\\s+AI infrastructure build[- ]out`,'i').test(q))fact=`${capJa}導入でAI基盤拡張`;
  if(!fact&&/\bpower\s+(?:[A-Za-z]+[’']s\s+)?AI infrastructure(?: build[- ]out)?\b/i.test(q))fact='AI基盤への電力供給';
  const deliveryDays=q.match(/deliver(?:ed|s)?\s+[^.;]{0,35}fuel cell system\s+to\s+[^.;]{0,30}\s+in\s+(?:just\s+)?(\d+)\s+days/i)?.[1];
  if(!fact&&deliveryDays&&type==='納入・採用先'){
    const text=`${label}に燃料電池を${deliveryDays}日で納入`;return lengthOK(text)?text:null;
  }
  if(!fact){
    // The modifiers may include a vendor/possessive and capacity; crossing a
    // conjunction, purpose clause or another verb is forbidden.
    const modifiers='(?:(?!and\\b|for\\b|to\\b|manufactur|develop|build|provid|suppl|deploy)[A-Za-z0-9’\'.,@-]+\\s+){0,8}';
    const bindings=[
      ['deploy(?:s|ed|ing|ment of)?|adopt(?:s|ed|ing)?|install(?:s|ed|ing)?','導入'],
      ['suppl(?:y|ies|ied|ying)|deliver(?:s|ed|ing)?|provid(?:e|es|ed|ing)','提供'],
      ['(?:jointly\\s+)?develop(?:s|ed|ing)?|co-develop(?:s|ed|ing)?','開発'],
      ['manufactur(?:e|es|ed|ing)|produc(?:e|es|ed|ing)','生産'],
      ['purchas(?:e|es|ed|ing)|procur(?:e|es|ed|ing)','調達'],
      ['integrat(?:e|es|ed|ing)','統合'],
    ];
    const objectRules=[...products,[/\bsystems?\b/i,'システム']];
    outer:for(const [verb,action] of bindings)for(const [productRe,ja] of objectRules){
      const match=q.match(new RegExp(`\\b(?:${verb})\\s+(?:(?:${capPattern})\\s*(?:\\((?:GW|MW)\\)\\s*)?(?:of\\s+)?)?${modifiers}(${productRe.source.replace(/\\b/g,'')})`,'i'));
      if(!match)continue;
      const product=ja??match[1];
      // Preserve scope: "GPU health monitoring" is not hardware deployment.
      if(product==='GPU'&&/GPU\s+(?:health|monitoring|software)/i.test(match[0]+q.slice((match.index??0)+match[0].length, (match.index??0)+match[0].length+20)))continue;
      const boundCapacity=match[0].match(new RegExp(capPattern,'i'))?.[0];
      const cap=boundCapacity?capJa:'';
      fact=`${cap??''}${product}の${action}`;break outer;
    }
  }
  if(fact&&/\b(?:intend|intends|plan|plans)\s+to\b/i.test(q))fact+='を計画';
  else if(fact&&/\bwill\b/i.test(q))fact+='予定';
  let connector='と';
  if(type==='納入・採用先'&&fact&&/調達/.test(fact))connector='が';
  const text=fact?`${label}${connector}${fact}`:null;
  return text && lengthOK(text) ? text : null;
}

function relationType(q, issuer, other, competition, ownFiling=false) {
  if (competition && competitive.test(q)) return '競合';
  if (bilateralPartnership(q,issuer,other) || directedInvestment(q,issuer,other)) return '提携・出資・技術対応';
  // Classify vendor/customer only when the actual grammar identifies direction.
  // Do not treat two names anywhere in an agreement as a vendor/customer claim.
  const names = [issuer, other].map(c => c.id);
  const canonical = canonicalNames(q,[issuer,other]);
  const escaped = names.map(n=>n.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'));
  // Issuer-authored filing bullet points may omit "we". The filing CIK, not
  // a company product mentioned later in another issuer's article, anchors it.
  if(ownFiling&&new RegExp(`^[•\\s]*Announced\\s+a\\s+(?:strategic\\s+)?(?:collaboration|partnership)\\s+with\\s+${escaped[1]}\\s+to\\b`,'i').test(canonical))return '提携・出資・技術対応';
  if (new RegExp(`${escaped[0]}.{0,45}\\b(?:suppl\\w*|provid\\w*|deliver\\w*).{0,90}\\bto ${escaped[1]}\\b`, 'i').test(canonical)) return '納入・採用先';
  if (new RegExp(`${escaped[1]}.{0,45}\\b(?:suppl\\w*|provid\\w*|deliver\\w*).{0,90}\\bto ${escaped[0]}\\b`, 'i').test(canonical)) return '供給・採用元';
  const objectGap=`(?:(?!\\b(?:${escaped.join('|')}|help|power|for|and)\\b).){0,70}`;
  if (new RegExp(`${escaped[0]}.{0,35}\\b(?:deploy\\w*|adopt\\w*|select\\w*|purchas\\w*|procur\\w*)${objectGap}${escaped[1]}[’']s`, 'i').test(canonical)) return '供給・採用元';
  if (new RegExp(`${escaped[1]}.{0,35}\\b(?:deploy\\w*|adopt\\w*|select\\w*|purchas\\w*|procur\\w*)${objectGap}${escaped[0]}[’']s`, 'i').test(canonical)) return '納入・採用先';
  return null;
}

/** Discover from source text, never from the historical relation table.
 * Returns accepted proposals AND rejected proposals with reasons. Caller must
 * validate source/date/domain and count rejects rather than silently dropping them.
 */
export function candidatesFromSource({source, issuer, universe, filing}) {
  const companies = universe instanceof Map ? [...universe.values()] : Array.isArray(universe) ? universe : universe.companies;
  const body = normalize(source.body ?? '');
  const sentences = [...new Intl.Segmenter('en', {granularity:'sentence'}).segment(body)].map(s=>s.segment.trim());
  // bodyOf normalizes paragraph boundaries. Preserve the independently visible
  // headline/paragraph as a candidate when it is also an exact body substring.
  // Never use metadata titles, navigation or text absent from extracted body.
  if(source.html){
    const html=parse(source.html);
    const heading=normalize(html.querySelector('h1')?.structuredText??'');
    if(heading&&Array.from(heading).length<=200&&body.includes(heading))sentences.push(heading);
    html.querySelectorAll('script,style,nav,footer,header,aside,noscript,button,form,[aria-hidden="true"]').forEach(n=>n.remove());
    for(const node of html.querySelectorAll('h1,h2,p,blockquote')){
      const statement=normalize(node.structuredText);
      if(statement&&Array.from(statement).length<=200&&body.includes(statement))sentences.push(statement);
    }
  }
  const statements=[...new Set(sentences)];
  const own10k = filing?.form === '10-K' && Number(filing.cik) === Number(issuer.cik);
  const rows = [];
  for (const other of companies) {
    if (other.id === issuer.id || !contains(body, other)) continue;
    const proposals = statements.filter(s => contains(s, issuer) && contains(s, other) && !irrelevant.test(s) && (partnership.test(s) || investment.test(s) || transaction.test(s) || competitive.test(s)));
    for (const statement of proposals) {
      const quote = independentQuote(statement, issuer, other);
      const claim=quote??statement;
      const inCompetition = own10k && (source.competition ?? []).some(s=>normalize(s).includes(claim));
      const isCompetition = competitive.test(claim) && !partnership.test(claim) && !investment.test(claim);
      const type = relationType(claim, issuer, other, isCompetition && inCompetition,Boolean(filing&&Number(filing.cik)===Number(issuer.cik)));
      const reasons = [];
      if (/\b(?:not|never|no longer)\b.{0,35}\b(?:partner|collaborat|suppl|invest|deploy|adopt|purchas)|\b(?:terminat|cancel|end)(?:ed|ing|s)?\b.{0,35}\b(?:partnership|agreement|contract)/i.test(statement)) reasons.push('relationship_negated_or_ended');
      if (companies.filter(c=>contains(claim,c)).length>2) reasons.push('multi_party_scope_unproven');
      if (/\b(?:if|unless|may|might|could|would)\b/i.test(claim)) reasons.push('conditional_claim');
      if (!quote) reasons.push('complete_quote_over_200');
      if (isCompetition && !inCompetition) reasons.push('competition_not_own_10k_section');
      if (!type) reasons.push('relationship_direction_unproven');
      const text = quote && type ? concreteJapanese(quote, other, type, issuer) : null;
      if (quote && type && !text) reasons.push('specific_fact_missing');
      rows.push({from:issuer.id,to:other.id,type:type ?? (isCompetition ? '競合' : null),text_ja:text,source_url:source.url ?? source.finalUrl,source_date:filing?.date ?? source.date,evidence_quote:quote,reasons});
    }
  }
  // Repeated navigation/body text is one discovered claim, not extra rejections.
  return rows.filter((r,i,a)=>a.findIndex(x=>x.from===r.from&&x.to===r.to&&x.type===r.type&&x.evidence_quote===r.evidence_quote&&x.reasons.join()===r.reasons.join())===i);
}
