import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import * as networkHelpers from '../lib/research/company-network.ts';
import { companyNetworkFor } from '../lib/research/company-network.server.ts';
import { companyIntroductions, companyIntroductionFields, companyIntroductionFor } from '../lib/research/company-introductions.ts';

test('every published company has six bilingual answers and dated primary sources', () => {
  const identities = new Set();
  for (const company of companyIntroductions) {
    assert.ok(!identities.has(company.cik));
    identities.add(company.cik);
    assert.match(company.reviewedOn, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(company.sources.length > 0);
    for (const source of company.sources) {
      assert.ok(new Set(['www.sec.gov', 'americas.kioxia.com', 'coreweave.com', 'lambda.ai', 'nebius.com', 'news.skhynix.com', 'ourbrand.asml.com', 'www.amphenol-cs.com', 'www.amphenol.com', 'www.asml.com', 'www.asteralabs.com', 'www.corning.com', 'www.crusoe.ai', 'www.eaton.com', 'www.extremenetworks.com', 'www.johnsoncontrols.com', 'www.legrand.com', 'www.marvell.com', 'www.molex.com', 'www.nikon.com', 'www.nvidia.com', 'www.se.com', 'dev.epicgames.com', 'developers.meta.com', 'support.apple.com', 'thewaltdisneycompany.com', 'unity.com', 'www.appliedmaterials.com', 'www.asm.com', 'www.capitalone.com', 'www.instacart.com', 'www.intel.com', 'www.latticesemi.com', 'www.nintendo.com', 'www.onsemi.com', 'www.paypal.com', 'www.playstation.com', 'www.sifive.com', 'www.sony-semicon.com', 'www.sony.com', 'www.synopsys.com', 'www.tel.com', 'www.walmart.com', 'www.xbox.com', 'docs.github.com', 'docs.jfrog.com', 'quickbooks.intuit.com', 'ramp.com', 'tipalti.com', 'www.abrigo.com', 'www.adp.com', 'www.concur.com', 'www.fiserv.com', 'www.fisglobal.com', 'www.harness.io', 'www.jackhenry.com', 'www.manh.com', 'www.meridianlink.com', 'www.netapp.com', 'www.nutanix.com', 'www.paychex.com', 'www.paylocity.com', 'www.pega.com', 'www.sap.com', 'www.servicenow.com', 'www.splunk.com', 'www.workday.com', 'blog.google', 'cloud.google.com', 'corporate.comcast.com', 'docs.cloud.google.com', 'docs.databricks.com', 'investors.thewaltdisneycompany.com', 'ironcladapp.com', 'partner.expediagroup.com', 'www.atlassian.com', 'www.bookingholdings.com', 'www.bytedance.com', 'www.crowdstrike.com', 'www.dell.com', 'www.hpe.com', 'www.icertis.com', 'www.marriott.com', 'www.netflix.com', 'www.palantir.com', 'www.peacocktv.com', 'www.pingidentity.com', 'www.sailpoint.com', 'enphase.com', 'fluenceenergy.com', 'help.speak.com', 'international.nubank.com.br', 'ir.happen.com', 'ir.talenenergy.com', 'media.byd.com', 'robinhood.com', 'semiconductor.samsung.com', 'www.babbel.com', 'www.cat.com', 'www.chevrolet.com', 'www.constellationenergy.com', 'www.cummins.com', 'www.ets.org', 'www.finxact.com', 'www.ford.com', 'www.fuelcellenergy.com', 'www.marqeta.com', 'www.micron.com', 'www.pearsonpte.com', 'www.sea.com', 'www.speak.com', 'blacksky.com', 'fireflyspace.com', 'investors.globalstar.com', 'quantumai.google', 's28.q4cdn.com', 'shield.ai', 'space-solutions.airbus.com', 'starlink.com', 'vantor.com', 'www.anduril.com', 'www.dwavequantum.com', 'www.ga-asi.com', 'www.ibm.com', 'www.l3harris.com', 'www.northropgrumman.com', 'www.planet.com', 'www.quantinuum.com', 'www.rtx.com', 'www.spacex.com', 'www.xanadu.ai', 'aem.com.sg', 'chipmostechnologiesinc.gcs-web.com', 'investor.silabs.com', 'investors.st.com', 'ir.qorvo.com', 'www.chipbond.com.tw', 'www.chromaate.com', 'www.himax.com.tw', 'www.infineon.com', 'www.monolithicpower.com', 'www.murata.com', 'www.nordicsemi.com', 'www.nxp.com', 'www.qorvo.com', 'www.silabs.com', 'www.tsmc.com', 'www.umc.com', 'gomotive.com', 'learn.microsoft.com', 's25.q4cdn.com', 'www.altera.com', 'www.amd.com', 'www.braze.com', 'www.dfinsolutions.com', 'www.ericsson.com', 'www.geotab.com', 'www.lytx.com', 'www.microchip.com', 'www.netradyne.com', 'www.paloaltonetworks.com', 'www.rubrik.com', 'www.salesforce.com', 'www.twilio.com', 'www.veeam.com', 'www.verizonconnect.com', 'www.vonage.com', 'ir.baidu.com', 'data.alibabagroup.com', 'www.take2games.com', 'news.sap.com', 'usa.visa.com', 'newsroom.mastercard.com', 'appian.com', 'knowledgebase.zetaglobal.com', 'newsroom.intel.com', 'www.bloomenergy.com', 'investor.vistracorp.com', 'www.gevernova.com', 'investors.digitalocean.com', 'ir.elastic.co', 'ir.gitlab.com', 'investors.jfrog.com', 'www.boxinvestorrelations.com', 'www.uipath.com', 'investors.dropbox.com', 'ir.dynatrace.com', 'investors.asana.com', 'ir.monday.com', 'ir.freshworks.com', 'www.ringcentral.com', 'www.bill.com', 'ir.appfolioinc.com', 'investors.blackline.com', 'news.samsung.com', 'www.adobe.com', 'www.hubspot.com', 'www1.hkexnews.hk', 'www.ngk-global.com', 'investor.tsmc.com', 'www.te.com', 'www.cloudflare.com', 'www.oracle.com', 'investors.teradyne.com', 'ontoinnovation.com', 'www.f5.com', 'aws.amazon.com', 'docs.aws.amazon.com', 'mailchimp.com', 'investor.mks.com', 'www.usiglobal.com', 'www.keysight.com', 'www.cadence.com', 'www.rohde-schwarz.com', 'investor.sitime.com', 'www.ti.com', 'www.analog.com', 'www.akm.com', 'credosemi.com', 'www.broadcom.com', 'www.qualcomm.com', 'business.adobe.com', 'developer.apple.com', 'squareup.com', 'stripe.com', 'www.aboutamazon.com', 'www.affirm.com', 'www.automationanywhere.com', 'www.blueprism.com', 'www.databricks.com', 'www.disneyplus.com', 'www.floqast.com', 'www.microsoft.com', 'www.realpage.com', 'www.shopify.com', 'www.snowflake.com', 'www.trintech.com', 'www.wix.com', 'www.yardi.com']).has(new URL(source.url).hostname), `Unreviewed source host: ${source.url}`);
      assert.ok(source.label.trim());
    }
    for (const lang of ['ja', 'en']) {
      assert.deepEqual(Object.keys(company[lang]), [...companyIntroductionFields]);
      for (const answer of Object.values(company[lang])) assert.ok(answer.trim().length > 15);
    }
  }
});

test('requires both issuer identity and ticker; supports share classes and non-monitored issuers', () => {
  assert.equal(companyIntroductionFor({cik:1652044,ticker:'GOOG'}), companyIntroductionFor({cik:1652044,ticker:'GOOGL'}));
  assert.equal(companyIntroductionFor({cik:909832,ticker:' cost '})?.name, 'Costco');
  assert.equal(companyIntroductionFor({cik:1,ticker:'NVDA'}), null);
  assert.equal(companyIntroductionFor({cik:1045810,ticker:'NVDL'}), null);
  assert.equal(companyIntroductionFor({cik:1,ticker:'UNKNOWN'}), null);
});

const require = createRequire(import.meta.url);
function compileComponent(file, extra = {}) {
  const compiled = ts.transpileModule(readFileSync(new URL(`../app/research/stocks/${file}.tsx`, import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const mod = {exports:{}};
  new Function('require','module','exports',compiled)(name => name.endsWith('.css') ? {default:{}} : extra[name] ?? require(name), mod, mod.exports);
  return mod.exports;
}
const networkComponent = compileComponent('company-network', {'@/lib/research/company-network':networkHelpers});
const panel = compileComponent('company-introduction', {'./company-network':networkComponent});
const {renderToStaticMarkup} = require('react-dom/server');
const {createElement} = require('react');
test('renders all six localized answers with expandable source links', () => {
  const introduction = companyIntroductionFor({cik:1045810,ticker:'NVDA'});
  for (const lang of ['ja','en']) {
    const html = renderToStaticMarkup(createElement(panel.CompanyIntroductionPanel,{introduction,lang,network:companyNetworkFor({cik:introduction.cik,ticker:introduction.tickers[0]})}));
    assert.equal((html.match(/<dt>/g)??[]).length,4);
    assert.equal((html.match(/<dd>/g)??[]).length,4);
    assert.match(html, /<details/);
    assert.match(html, /2026-10-13/);
    assert.ok(html.includes(lang==='ja'?'どこと繋がる？':'Who does it work with?'));
    assert.ok(!html.includes(lang==='ja'?'Who does it work with?':'どこと繋がる？'));
    assert.ok(html.indexOf('data-topic="risks"') < html.indexOf('data-topic="competition"'));
    assert.ok(!html.includes('href="/research/stocks'));
    assert.match(html, /aria-current="true" aria-label="NVIDIA"/);
    assert.ok(!html.includes("Show connections for"));
    assert.ok(!html.includes("最初に戻る"));
    assert.ok(!html.includes("Connection details"));

    assert.ok(!html.includes('q=undefined'));
  }
});

test('all issuers render same-page selection maps in both languages', () => {
  for (const introduction of companyIntroductions) {
    for (const lang of ['ja','en']) {
      const html = renderToStaticMarkup(createElement(panel.CompanyIntroductionPanel,{introduction,lang,network:companyNetworkFor({cik:introduction.cik,ticker:introduction.tickers[0]})}));
      assert.ok(!html.includes('href="/research/stocks'));
      assert.ok(!html.includes(lang==='ja'?'最初に戻る':'Reset'));
      const network = companyNetworkFor({cik:introduction.cik,ticker:introduction.tickers[0]});
      const focus = networkHelpers.networkFocus(network, network.root, 'two');
      const visible = network.root === 'NVDA' ? network.nodes : network.nodes.filter(node => !(node.kind === 'industry' && focus.competitors.has(node.id)) && (focus.distances.has(node.id) || focus.competitors.has(node.id)));
      assert.equal((html.match(/<button/g)??[]).length,3 + visible.length);
      assert.ok(html.includes(`aria-current="true" aria-label="${introduction.name}"`), introduction.tickers[0]);
      assert.ok(html.includes(lang==='ja'?'どこと繋がる？':'Who does it work with?'));
    }
  }
});

test('Lumentum shows actual competitors, excludes anonymous rivals and removes out-of-range cards', () => {
  const introduction = companyIntroductionFor({cik:1633978,ticker:'LITE'});
  const network = companyNetworkFor({cik:1633978,ticker:'LITE'});
  const html = renderToStaticMarkup(createElement(panel.CompanyIntroductionPanel,{introduction,lang:'ja',network}));
  assert.ok(html.includes('Coherent (COHR)'));
  assert.ok(html.includes('IPG Photonics (IPGP)'));
  assert.ok(html.includes('Applied Optoelectronics (AAOI)'));
  const aaoi = introduction.maps.competition.find(entry => entry.ticker === 'AAOI');
  assert.ok(aaoi.sourceIndexes.some(index => introduction.sources[index].url.endsWith('/aaoi20251231_10k.htm')));
  assert.ok(!html.includes('光通信メーカー'));
  assert.ok(!html.includes('レーザーメーカー'));
  assert.ok(!html.includes('aria-label="Nikon"'));
});

test('selected-sector maps render relevant headings without changing the reviewed NVIDIA context', () => {
  const targets = new Set(['IONQ','RGTI','QBTS','QUBT','RKLB','ASTS','PL','BKSY','AVAV','KTOS','RDW','BE','VST','MELI','SOFI','DUOL','TSLA','WDC','STX','HPQ','SNOW','IBM','OKTA','S','CHKP','DOCU','ABNB','SPOT','ASAN','DIS','GTLB','NTAP','PAYX','ADP','BILL','APPN','NCNO','ALKT','RPD','SAP','AMAT','AMD','ARM','QCOM','CDNS','RBLX','DASH','SONY','V','MA','APH','ANET','MRVL','VRT','ALAB','NBIS','ASML','CRDO','MU','INTC']);
  for (const introduction of companyIntroductions) {
    const graph = companyNetworkFor({cik:introduction.cik,ticker:introduction.tickers[0]});
    if (!targets.has(graph.root)) {
      assert.equal(graph.layerLabels, undefined, graph.root);
      continue;
    }
    for (const lang of ['ja','en']) {
      const html = renderToStaticMarkup(createElement(networkComponent.CompanyNetworkMap,{graph,lang}));
      if (!['IBM','GTLB','NTAP','PAYX','ADP','BILL','APPN','NCNO','ALKT','RPD','SAP','AMAT','AMD','ARM','QCOM','CDNS','RBLX','DASH','SONY','V','MA','APH','ANET','MRVL','VRT','ALAB','NBIS','ASML','CRDO','MU','INTC'].includes(graph.root)) assert.ok(!html.includes(lang==='ja'?'サーバー・ネットワーク・電源':'Servers, networking &amp; power'), graph.root);
      if (['IONQ','RGTI','QBTS','QUBT','RKLB','ASTS','PL','BKSY','AVAV','KTOS','RDW'].includes(graph.root)) assert.ok(!html.includes(lang==='ja'?'クラウド・AIサービス':'Cloud &amp; AI services'), graph.root);
      assert.ok(Object.values(graph.layerLabels).some(text => html.includes(text[lang].replaceAll('&','&amp;'))), graph.root);
      assert.equal((html.match(/aria-current="true"/g)??[]).length,1);
    }
  }
});

test('diversified competitors use the compared product in selected maps only', () => {
  for (const [ticker,cik] of [['HPQ',47217],['WDC',106040],['STX',1137789],['MELI',1099590]]) {
    const graph = companyNetworkFor({ticker,cik});
    const peers = networkHelpers.networkFocus(graph,graph.root,'direct').competitors;
    for (const id of peers) {
      const node = graph.nodes.find(item => item.id === id);
      assert.equal(node.layer,ticker==='HPQ'?5:ticker==='MELI'?7:2,id);
      assert.ok(node.businessLabel?.ja && node.businessLabel?.en,id);
    }
    for (const lang of ['ja','en']) {
      const html = renderToStaticMarkup(createElement(networkComponent.CompanyNetworkMap,{graph,lang}));
      assert.ok(html.includes(ticker==='HPQ'?(lang==='ja'?'プリンター・消耗品':'Printers &amp; supplies'):ticker==='MELI'?(lang==='ja'?'ブラジルの通販':'Brazilian commerce'):(lang==='ja'?'企業向けSSD':'Enterprise SSDs')));
      if (ticker==='MELI') assert.ok(!html.includes(lang==='ja'?'クラウド・AIサービス':'Cloud &amp; AI services'));
    }
  }
  const asml = companyNetworkFor({ticker:'ASML',cik:937966});
  assert.equal(asml.nodes.find(node=>node.id==='Canon').layer,2);
  assert.equal(asml.nodes.find(node=>node.id==='Canon').businessLabel.en,'DUV lithography');
});

test('mixed-list rivals keep product-specific captions and do not erase non-company alternatives', () => {
  const cases = [["SNOW", 1640147], ["IBM", 51143], ["OKTA", 1660134], ["S", 1583708], ["CHKP", 1015922], ["DOCU", 1261333], ["ABNB", 1559720], ["SPOT", 1639920], ["ASAN", 1477720], ["DIS", 1744489]];
  for (const [ticker,cik] of cases) {
    const graph=companyNetworkFor({ticker,cik});
    for (const id of networkHelpers.networkFocus(graph,graph.root,'direct').competitors) {
      const node=graph.nodes.find(item=>item.id===id);
      assert.ok(node.businessLabel?.ja && node.businessLabel?.en,`${ticker}:${id}`);
      assert.ok(![0,1,2,3,4].includes(node.layer),`${ticker}:${id}`);
    }
  }
  const okta=companyIntroductionFor({ticker:'OKTA',cik:1660134});
  assert.match(okta.en.competition,/In-house.*open-source/);
  assert.ok(okta.maps.competition.every(entry=>entry.kind==='company'));
  const spot=companyIntroductionFor({ticker:'SPOT',cik:1639920});
  assert.ok(['AAPL','AMZN','GOOG','META'].every(t=>spot.maps.competition.some(e=>e.ticker===t)));
  assert.ok(spot.maps.competition.some(e=>e.name==='ByteDance'));
});

test('banking, payroll and automation rivals retain compared-product captions', () => {
  const cases = [["GTLB", 1653482], ["NTAP", 1002047], ["PAYX", 723531], ["ADP", 8670], ["BILL", 1786352], ["APPN", 1441683], ["NCNO", 1902733], ["ALKT", 1529274], ["RPD", 1560327], ["SAP", 1000184]];
  for (const [ticker,cik] of cases) {
    const graph=companyNetworkFor({ticker,cik});
    for (const id of networkHelpers.networkFocus(graph,graph.root,'direct').competitors) {
      const node=graph.nodes.find(item=>item.id===id);
      assert.ok(node.businessLabel?.ja && node.businessLabel?.en,`${ticker}:${id}`);
      assert.ok(node.layer>=5,`${ticker}:${id}`);
    }
  }
  const payx=companyIntroductionFor({ticker:'PAYX',cik:723531});
  assert.ok(payx.maps.competition.some(e=>e.ticker==='PCTY'));
  const rpd=companyNetworkFor({ticker:'RPD',cik:1560327});
  assert.match(rpd.nodes.find(n=>n.id==='CSCO').businessLabel.en,/Splunk/);
  assert.equal(rpd.nodes.find(n=>n.id==='CSCO').layer,7);
  const ntap=companyNetworkFor({ticker:'NTAP',cik:1002047});
  assert.equal(ntap.nodes.find(n=>n.id==='IBM').businessLabel.en,'FlashSystem');
  assert.equal(ntap.nodes.find(n=>n.id==='IBM').layer,5);
});

test('standards, internal tools and payment rails stay alternatives without fake competitor companies', () => {
  const ids = [["AMAT", 6951], ["AMD", 2488], ["ARM", 1973239], ["QCOM", 804328], ["CDNS", 813672], ["RBLX", 1315098], ["DASH", 1792789], ["SONY", 313838], ["V", 1403161], ["MA", 1141391]];
  for (const [ticker,cik] of ids) {
    const intro=companyIntroductionFor({ticker,cik});
    assert.ok(intro.maps.competition.every(e=>e.kind==='company'),ticker);
    const graph=companyNetworkFor({ticker,cik});
    for (const id of networkHelpers.networkFocus(graph,graph.root,'direct').competitors) {
      const node=graph.nodes.find(n=>n.id===id);
      assert.ok(node.businessLabel?.ja && node.businessLabel?.en,`${ticker}:${id}`);
    }
  }
  const arm=companyIntroductionFor({ticker:'ARM',cik:1973239});
  assert.match(arm.en.competition,/RISC-V is an open instruction-set architecture, not a company/);
  assert.ok(!arm.maps.competition.some(e=>e.name==='RISC-V'));
  const visa=companyIntroductionFor({ticker:'V',cik:1403161});
  assert.match(visa.en.competition,/Cash, checks and instant account transfers/);
  assert.ok(visa.maps.competition.some(e=>e.ticker==='COF' && e.name.includes('Discover')));
  assert.ok(!visa.maps.competition.some(e=>e.ticker==='DFS'));
  const roblox=companyIntroductionFor({ticker:'RBLX',cik:1315098});
  assert.ok(roblox.maps.competition.some(e=>e.name==='Epic Games'));
  assert.ok(roblox.maps.competition.some(e=>e.ticker==='U'));
  const sony=companyNetworkFor({ticker:'SONY',cik:313838});
  assert.equal(sony.nodes.find(n=>n.id==='ON').layer,3);
  assert.match(sony.nodes.find(n=>n.id==='ON').businessLabel.en,/Hyperlux/);
});

test('connectivity, GPU cloud, memory and foundry competitors retain distinct product roles', () => {
  for (const [ticker,cik] of [["APH", 820313], ["ANET", 1596532], ["MRVL", 1835632], ["VRT", 1674101], ["ALAB", 1736297], ["NBIS", 1513845], ["ASML", 937966], ["CRDO", 1807794], ["MU", 723125], ["INTC", 50863]]) {
    const graph=companyNetworkFor({ticker,cik});
    for (const id of networkHelpers.networkFocus(graph,graph.root,'direct').competitors) {
      const node=graph.nodes.find(n=>n.id===id);
      assert.ok(node.businessLabel?.ja && node.businessLabel?.en,`${ticker}:${id}`);
    }
  }
  const nbis=companyIntroductionFor({ticker:'NBIS',cik:1513845});
  assert.ok(nbis.maps.competition.some(e=>e.ticker==='MSFT'));
  assert.ok(nbis.maps.relationships.some(e=>e.ticker==='MSFT'));
  const intel=companyIntroductionFor({ticker:'INTC',cik:50863});
  assert.ok(intel.maps.competition.some(e=>e.ticker==='TSM'));
  assert.ok(intel.maps.relationships.some(e=>e.ticker==='TSM'));
  const asml=companyNetworkFor({ticker:'ASML',cik:937966});
  for (const name of ['Nikon','Canon']) assert.match(asml.nodes.find(n=>n.name===name).businessLabel.en,/DUV/);
  const mu=companyNetworkFor({ticker:'MU',cik:723125});
  for (const name of ['Kioxia','Sandisk']) {
    const label=mu.nodes.find(n=>n.name===name).businessLabel.en;
    assert.match(label,/NAND/); assert.ok(!label.includes('HBM'));
  }
  const credo=companyIntroductionFor({ticker:'CRDO',cik:1807794});
  assert.ok(credo.maps.competition.some(e=>e.ticker==='APH'));
  assert.ok(!credo.maps.relationships.some(e=>e.ticker==='APH'));
  const alab=companyNetworkFor({ticker:'ALAB',cik:1736297});
  assert.match(alab.nodes.find(n=>n.id==='MCHP').businessLabel.en,/Switchtec PCIe switches/);
});
