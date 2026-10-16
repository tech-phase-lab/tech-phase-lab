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
      assert.ok(new Set(['ast-science.com','group.ntt','investors.planet.com','ir.rdw.com','www.group.ntt','www.ionq.com','www.kratosdefense.com','www.rigetti.com','investor.rambus.com','ir.macom.com','investors.power.com','www.diodes.com','www.silabs.com','www.ceva-ip.com','ir.navitassemi.com','www.ipgphotonics.com','www.akamai.com','www.ir.akamai.com','sec.okta.com','www.sentinelone.com','www.checkpoint.com','investors.twilio.com','investors.sofi.com','investors.duolingo.com','press.aboutamazon.com','notifications.qualys.com','corporate.walmart.com','www.paycom.com','newsroom.paypal-corp.com','news.airbnb.com','cloud.google.com','newsroom.spotify.com','advertising.amazon.com','www.thetradedesk.com','about.doordash.com','www.mercadopago.com.mx','newsroom.st.com','www.synaptics.com','www.onsemi.com','investors.indie.inc','www.impinj.com','www.latticesemi.com','www.maxlinear.com','blog.viavisolutions.com','pr.tsmc.com','investors.ontoinnovation.com','investors.teradyne.com','news.siemens.com','gf.com','ir.towersemi.com','www.te.com','www.corning.com','ir.cohu.com','ir.amkor.com','www.nokia.com','www.arrow.com','www.avnet.com','www.ciena.com','newsroom.cisco.com','www.westerndigital.com','www.seagate.com','newsroom.cadence.com','investors.flex.com','investor.fortinet.com','www.investors.8x8.com','ir.ringcentral.com','blog.dropbox.com','www.dropbox.com','www.five9.com','developer.monday.com','www.freshworks.com','www.klaviyo.com','support.sproutsocial.com','investors.sproutsocial.com','www.bmwgroup.com','www.volkswagen-group.com','company.instacart.com','investor.uber.com','ir.doordash.com','investors.autodesk.com','www.ptc.com','www.bentley.com','www.veeva.com','ir.manh.com','www.atlassian.com','www.dynatrace.com','www.opentext.com','customerservice.costco.com','investor.nvidia.com','investor.servicenow.com','newsroom.servicenow.com','www.intuit.com','investors.intuit.com','azure.microsoft.com','learning.sap.com','investor.analog.com','ir.zscaler.com','www.datadoghq.com','holdings.panasonic','www.catl.com','blogs.microsoft.com','news.adobe.com','investor.salesforce.com','blog.box.com','newsroom.workday.com','newsroom.pinterest.com', 'ir.appliedmaterials.com', 'investor.marvell.com', 'investor.onsemi.com', 'www.apple.com', 'www.anthropic.com', 'about.fb.com', 'nvidianews.nvidia.com', 'www.sec.gov', 'www.iren.com', 'iren.gcs-web.com', 'www.fool.com', 'blog.google', 'openai.com', 'd18rn0p25nwr6d.cloudfront.net', 'docs.gitlab.com', 'www.sonatype.com', 'docs.broadcom.com', 'investor.lumentum.com', 'www.intuitivemachines.com', 'www.macom.com', 'www.poet-technologies.com', 'buy.hpe.com', 'docs.unity.com', 'help.sap.com', 'www.fortinet.com', 'www.zscaler.com', 'www.cisco.com', 'www.coherent.com', 'www.innolight.com', 'www.lumentum.com', 'www.phison.com', 'www.siliconmotion.com', 'www.webex.com', 'www.zoom.com', 'americas.kioxia.com', 'coreweave.com', 'lambda.ai', 'nebius.com', 'news.skhynix.com', 'ourbrand.asml.com', 'www.amphenol-cs.com', 'www.amphenol.com', 'www.asml.com', 'www.asteralabs.com', 'www.corning.com', 'www.crusoe.ai', 'www.eaton.com', 'www.extremenetworks.com', 'www.johnsoncontrols.com', 'www.legrand.com', 'www.marvell.com', 'www.molex.com', 'www.nikon.com', 'www.nvidia.com', 'www.se.com', 'dev.epicgames.com', 'developers.meta.com', 'support.apple.com', 'thewaltdisneycompany.com', 'unity.com', 'www.appliedmaterials.com', 'www.asm.com', 'www.capitalone.com', 'www.instacart.com', 'www.intel.com', 'www.latticesemi.com', 'www.nintendo.com', 'www.onsemi.com', 'www.paypal.com', 'www.playstation.com', 'www.sifive.com', 'www.sony-semicon.com', 'www.sony.com', 'www.synopsys.com', 'www.tel.com', 'www.walmart.com', 'www.xbox.com', 'docs.github.com', 'docs.jfrog.com', 'quickbooks.intuit.com', 'ramp.com', 'tipalti.com', 'www.abrigo.com', 'www.adp.com', 'www.concur.com', 'www.fiserv.com', 'www.fisglobal.com', 'www.harness.io', 'www.jackhenry.com', 'www.manh.com', 'www.meridianlink.com', 'www.netapp.com', 'www.nutanix.com', 'www.paychex.com', 'www.paylocity.com', 'www.pega.com', 'www.sap.com', 'www.servicenow.com', 'www.splunk.com', 'www.workday.com', 'blog.google', 'cloud.google.com', 'corporate.comcast.com', 'docs.cloud.google.com', 'docs.databricks.com', 'investors.thewaltdisneycompany.com', 'ironcladapp.com', 'partner.expediagroup.com', 'www.atlassian.com', 'www.bookingholdings.com', 'www.bytedance.com', 'www.crowdstrike.com', 'www.dell.com', 'www.hpe.com', 'www.icertis.com', 'www.marriott.com', 'www.netflix.com', 'www.palantir.com', 'www.peacocktv.com', 'www.pingidentity.com', 'www.sailpoint.com', 'enphase.com', 'fluenceenergy.com', 'help.speak.com', 'international.nubank.com.br', 'ir.happen.com', 'ir.talenenergy.com', 'media.byd.com', 'robinhood.com', 'semiconductor.samsung.com', 'www.babbel.com', 'www.cat.com', 'www.chevrolet.com', 'www.constellationenergy.com', 'www.cummins.com', 'www.ets.org', 'www.finxact.com', 'www.ford.com', 'www.fuelcellenergy.com', 'www.marqeta.com', 'www.micron.com', 'www.pearsonpte.com', 'www.sea.com', 'www.speak.com', 'blacksky.com', 'fireflyspace.com', 'investors.globalstar.com', 'quantumai.google', 's28.q4cdn.com', 'shield.ai', 'space-solutions.airbus.com', 'starlink.com', 'vantor.com', 'www.anduril.com', 'www.dwavequantum.com', 'www.ga-asi.com', 'www.ibm.com', 'www.l3harris.com', 'www.northropgrumman.com', 'www.planet.com', 'www.quantinuum.com', 'www.rtx.com', 'www.spacex.com', 'www.xanadu.ai', 'aem.com.sg', 'chipmostechnologiesinc.gcs-web.com', 'investor.silabs.com', 'investors.st.com', 'ir.qorvo.com', 'www.chipbond.com.tw', 'www.chromaate.com', 'www.himax.com.tw', 'www.infineon.com', 'www.monolithicpower.com', 'www.murata.com', 'www.nordicsemi.com', 'www.nxp.com', 'www.qorvo.com', 'www.silabs.com', 'www.tsmc.com', 'www.umc.com', 'gomotive.com', 'learn.microsoft.com', 's25.q4cdn.com', 'www.altera.com', 'www.amd.com', 'www.braze.com', 'www.dfinsolutions.com', 'www.ericsson.com', 'www.geotab.com', 'www.lytx.com', 'www.microchip.com', 'www.netradyne.com', 'www.paloaltonetworks.com', 'www.rubrik.com', 'www.salesforce.com', 'www.twilio.com', 'www.veeam.com', 'www.verizonconnect.com', 'www.vonage.com', 'ir.baidu.com', 'data.alibabagroup.com', 'www.take2games.com', 'news.sap.com', 'usa.visa.com', 'newsroom.mastercard.com', 'appian.com', 'knowledgebase.zetaglobal.com', 'newsroom.intel.com', 'www.bloomenergy.com', 'investor.vistracorp.com', 'www.gevernova.com', 'investors.digitalocean.com', 'ir.elastic.co', 'ir.gitlab.com', 'investors.jfrog.com', 'www.boxinvestorrelations.com', 'www.uipath.com', 'investors.dropbox.com', 'ir.dynatrace.com', 'investors.asana.com', 'ir.monday.com', 'ir.freshworks.com', 'www.ringcentral.com', 'www.bill.com', 'ir.appfolioinc.com', 'investors.blackline.com', 'news.samsung.com', 'www.adobe.com', 'www.hubspot.com', 'www1.hkexnews.hk', 'www.ngk-global.com', 'investor.tsmc.com', 'www.te.com', 'www.cloudflare.com', 'www.oracle.com', 'investors.teradyne.com', 'ontoinnovation.com', 'www.f5.com', 'aws.amazon.com', 'docs.aws.amazon.com', 'mailchimp.com', 'investor.mks.com', 'www.usiglobal.com', 'www.keysight.com', 'www.cadence.com', 'www.rohde-schwarz.com', 'investor.sitime.com', 'www.ti.com', 'www.analog.com', 'www.akm.com', 'credosemi.com', 'www.broadcom.com', 'www.qualcomm.com', 'business.adobe.com', 'developer.apple.com', 'squareup.com', 'stripe.com', 'www.aboutamazon.com', 'www.affirm.com', 'www.automationanywhere.com', 'www.blueprism.com', 'www.databricks.com', 'www.disneyplus.com', 'www.floqast.com', 'www.microsoft.com', 'www.realpage.com', 'www.shopify.com', 'www.snowflake.com', 'www.trintech.com', 'www.wix.com', 'www.yardi.com']).has(new URL(source.url).hostname), `Unreviewed source host: ${source.url}`);
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
      const focus = networkHelpers.networkFocus(network, network.root, network.root === 'NBIS' ? 'direct' : 'two');
      const visible = network.nodes.filter(node => (node.id === network.root || networkHelpers.isStockMapCompany(node)) && (network.root === 'NVDA' || focus.distances.has(node.id) || focus.competitors.has(node.id)));
      for (const node of network.nodes.filter(node => node.id !== network.root && !networkHelpers.isStockMapCompany(node))) assert.ok(!html.includes('aria-label=\"' + node.name.replaceAll('&','&amp;') + '\"'), introduction.tickers[0]+':'+node.id);
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
  const targets = new Set(['IONQ','RGTI','QBTS','QUBT','ASTS','PL','BKSY','AVAV','KTOS','RDW','MTSI','POWI','SITM','RMBS','DIOD','SLAB','CEVA','NVTS','IPGP','AKAM','OKTA','S','CHKP','TWLO','DOCU','SOFI','DUOL','APPF','QLYS','WMT','PAYC','UBER','NFLX','SHOP','APP','ABNB','SPOT','ROKU','TTD','DASH','MELI','PYPL','XYZ','UMC','STM','HIMX','CRUS','SYNA','AMBA','INDI','PI','LSCC','MXL','VIAV','ONTO','TER','ENTG','CAMT','ACLS','ASX','GFS','TSEM','GLW','TEL','ICHR','UCTT','FORM','AMKR','JBL','COHU','SANM','ARW','AVT','PLAB','ETN','PLTR','KEYS','FLEX','EGHT','PEGA','NICE','DBX','FIVN','RNG','MNDY','FRSH','KVYO','BRZE','SPT','PTC','BSY','VEEV','MANH','HUBS','TEAM','DT','OTEX','COST','NTNX','CRWD','NET','INTU','TXN','ADI','DDOG','ZS','MSFT','ADBE','CRM','BOX','WDAY','DELL','HPE','ADSK','AAPL','AMZN','GOOG','META','ON','IONQ','RGTI','QBTS','QUBT','RKLB','ASTS','PL','BKSY','AVAV','KTOS','RDW','BE','VST','MELI','SOFI','DUOL','TSLA','WDC','STX','HPQ','SNOW','IBM','OKTA','S','CHKP','DOCU','ABNB','SPOT','ASAN','DIS','GTLB','NTAP','PAYX','ADP','BILL','APPN','NCNO','ALKT','RPD','SAP','AMAT','AMD','ARM','QCOM','CDNS','RBLX','DASH','SONY','V','MA','APH','ANET','MRVL','VRT','ALAB','NBIS','ASML','CRDO','MU','INTC','SIMO','AAOI','GEV','IREN','LRCX','KLAC','SMCI','CSCO','CRWV','ORCL','PANW','NOW','NXPI','MPWR','CIEN','FTNT','UBER','APP','LITE','RDDT','PINS','SNAP','ENTG','MTSI','POWI','ZM','DOCN','ESTC','FROG']);
  for (const introduction of companyIntroductions) {
    const graph = companyNetworkFor({cik:introduction.cik,ticker:introduction.tickers[0]});
    if (!targets.has(graph.root)) {
      assert.equal(graph.layerLabels, undefined, graph.root);
      continue;
    }
    for (const lang of ['ja','en']) {
      const html = renderToStaticMarkup(createElement(networkComponent.CompanyNetworkMap,{graph,lang}));
      if (!['IBM','GTLB','NTAP','PAYX','ADP','BILL','APPN','NCNO','ALKT','RPD','SAP','AMAT','AMD','ARM','QCOM','CDNS','RBLX','DASH','SONY','V','MA','APH','ANET','MRVL','VRT','ALAB','NBIS','ASML','CRDO','MU','INTC','SIMO','AAOI','GEV','IREN','LRCX','KLAC','SMCI','CSCO','CRWV','ORCL','PANW','NOW','NXPI','MPWR','CIEN','FTNT','UBER','APP','LITE','RDDT','PINS','SNAP','ENTG','MTSI','POWI','ZM','DOCN','ESTC','FROG'].includes(graph.root)) assert.ok(!html.includes(lang==='ja'?'サーバー・ネットワーク・電源':'Servers, networking &amp; power'), graph.root);
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
  assert.equal(asml.nodes.find(node=>node.id==='Canon').layer,asml.nodes.find(node=>node.id===asml.root).layer);
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
  for (const name of ['Nikon','Canon']) {
    const peer=asml.nodes.find(n=>n.name===name);
    assert.match(peer.businessLabel.en,/DUV/);
    assert.equal(peer.layer,asml.nodes.find(n=>n.id===asml.root).layer);
  }
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

test('equipment peers share their selected process tier and scoped products keep distinct roles', () => {
  for (const [ticker,cik] of [['AMAT',6951],['CDNS',813672],['LRCX',707549],['KLAC',319201]]) {
    const g=companyNetworkFor({ticker,cik}),layer=g.nodes.find(n=>n.id===g.root).layer;
    for (const id of networkHelpers.networkFocus(g,g.root,'direct').competitors) {
      const n=g.nodes.find(n=>n.id===id); assert.equal(n.layer,layer,ticker+':'+id);
      assert.ok(n.businessLabel?.ja && n.businessLabel?.en);
    }
  }
  const iren=companyIntroductionFor({ticker:'IREN',cik:1878848});
  assert.ok(iren.maps.competition.some(e=>e.ticker==='MSFT'));
  assert.ok(iren.maps.relationships.some(e=>e.ticker==='MSFT'));
  const smci=companyIntroductionFor({ticker:'SMCI',cik:1375365});
  for (const name of ['Foxconn','Quanta Computer']) assert.ok(smci.maps.competition.some(e=>e.name===name));
  const cisco=companyNetworkFor({ticker:'CSCO',cik:858877});
  assert.match(cisco.nodes.find(n=>n.id==='CRWD').businessLabel.en,/Endpoint/);
  assert.match(cisco.nodes.find(n=>n.id==='ZM').businessLabel.en,/Web meetings/);
  const simo=companyIntroductionFor({ticker:'SIMO',cik:1329394});
  assert.match(simo.en.competition,/Customer-designed controllers remain alternatives/);
});

test('coverage review preserves prose peers and separates cloud, advertising, power and freight scopes', () => {
  for (const [ticker,cik,id] of [['ORCL',1341439,'SAP'],['MPWR',1280452,'Infineon'],['CIEN',936395,'ZTE'],['FTNT',1262039,'MSFT'],['APP',1751008,'U']]) {
    const c=companyIntroductionFor({ticker,cik}); assert.ok(c.maps.competition.some(e=>(e.ticker||e.name)===id),ticker+id);
  }
  const crwv=companyIntroductionFor({ticker:'CRWV',cik:1769628});
  assert.ok(crwv.maps.relationships.some(e=>e.ticker==='MSFT'&&e.role==='customer'));
  assert.ok(crwv.maps.competition.filter(e=>e.kind==='company').every(e=>e.label.en.includes('editorial')));
  for (const [ticker,cik] of [['NOW',1373715],['CIEN',936395],['FTNT',1262039],['APP',1751008]]) {
    const g=companyNetworkFor({ticker,cik}),layer=g.nodes.find(n=>n.id===g.root).layer;
    for (const id of networkHelpers.networkFocus(g,g.root,'direct').competitors) {
      const n=g.nodes.find(n=>n.id===id);assert.equal(n.layer,layer,ticker+id);assert.ok(n.businessLabel?.ja&&n.businessLabel?.en);
    }
  }
  const app=companyNetworkFor({ticker:'APP',cik:1751008});assert.match(app.nodes.find(n=>n.id==='U').businessLabel.en,/Advertising/);
  const mpwr=companyNetworkFor({ticker:'MPWR',cik:1280452});assert.match(mpwr.nodes.find(n=>n.id==='NXPI').businessLabel.en,/PMIC/);
  const uber=companyIntroductionFor({ticker:'UBER',cik:1543151});assert.ok(uber.maps.competition.some(e=>e.ticker==='CHRW'&&/Freight/.test(e.label.en)));
  assert.match(uber.en.competition,/public transit and direct merchant ordering remain alternatives/);
});

test('space and optics relations retain evidence dates and distinguish customer, competitor and demonstrations', () => {
  const lite=companyIntroductionFor({ticker:'LITE',cik:1633978}),rocket=companyIntroductionFor({ticker:'RKLB',cik:1819994});
  assert.ok(lite.maps.competition.some(e=>e.ticker==='AAOI'));
  const avgo=lite.maps.competition.find(e=>e.ticker==='AVGO');assert.match(avgo.label.en,/EML.*editorial/);
  for (const [ticker,date,role] of [['CIEN','2017','partner'],['GLW','2026','partner'],['MTSI','2019','ecosystem'],['POET','2022','customer']]) {
    const e=lite.maps.relationships.find(e=>e.ticker===ticker);assert.equal(e.role,role);assert.ok(e.label.en.includes(date));assert.ok(e.sourceIndexes.length);
  }
  assert.ok(rocket.maps.relationships.some(e=>e.ticker==='PL'&&e.role==='customer'));
  const lunr=rocket.maps.competition.find(e=>e.ticker==='LUNR');assert.match(lunr.label.en,/Lanteris defense/);
  assert.ok(lunr.sourceIndexes.some(i=>rocket.sources[i].url.includes('lunr-20251231')));
  const g=companyNetworkFor({ticker:'LITE',cik:1633978});assert.equal(g.layerLabels[3].en,'Chip design & connectivity');assert.match(g.nodes.find(n=>n.id==='AVGO').businessLabel.en,/EML/);assert.match(g.nodes.find(n=>n.id==='GLW').businessLabel.en,/Fiber/);
});

test('coverage review retains social and power prose peers and scopes materials and software comparisons', () => {
  for (const [ticker,cik,peers] of [['RDDT',1713445,['META','ByteDance']],['PINS',1506293,['META','ByteDance','AMZN']],['SNAP',1564408,['META','ByteDance']],['POWI',833640,['STM','Infineon']],['MTSI',1493594,['SWKS']]]) {
    const c=companyIntroductionFor({ticker,cik}); for(const id of peers) assert.ok(c.maps.competition.some(e=>(e.ticker||e.name)===id),ticker+id);
  }
  const m=companyIntroductionFor({ticker:'MTSI',cik:1493594}); assert.match(m.en.competition,/October 5, 2026/); assert.ok(!m.maps.competition.some(e=>e.ticker==='QRVO'));
  const entg=companyIntroductionFor({ticker:'ENTG',cik:1101302}); assert.ok(!entg.maps.competition.some(e=>e.ticker==='MRK'));
  assert.match(entg.en.competition,/Merck KGaA is distinct/);
  for (const [ticker,cik] of [['RDDT',1713445],['ENTG',1101302],['ZM',1585521],['ESTC',1707753],['FROG',1800667]]) {
    const g=companyNetworkFor({ticker,cik}),layer=g.nodes.find(n=>n.id===g.root).layer;
    for (const id of networkHelpers.networkFocus(g,g.root,'direct').competitors) {const n=g.nodes.find(n=>n.id===id);assert.equal(n.layer,ticker==='RDDT'&&id==='GOOG'?6:layer,ticker+id);assert.ok(n.businessLabel?.ja&&n.businessLabel?.en);}
  }
  const zm=companyNetworkFor({ticker:'ZM',cik:1585521});assert.match(zm.nodes.find(n=>n.id==='FIVN').businessLabel.en,/Contact center/);
  const estc=companyIntroductionFor({ticker:'ESTC',cik:1707753});assert.ok(estc.maps.competition.some(e=>e.ticker==='AMZN'));assert.ok(estc.maps.relationships.some(e=>e.ticker==='AMZN'&&e.role==='supplier'));
  const frog=companyNetworkFor({ticker:'FROG',cik:1800667});assert.match(frog.nodes.find(n=>n.id==='MSFT').businessLabel.en,/Packages/);
  for (const [ticker,cik] of [['FROG',1800667],['DOCN',1582961],['ESTC',1707753]]) assert.match(companyNetworkFor({ticker,cik}).layerLabels[6].en,/cloud/i);
});

test('Reddit includes named cloud suppliers and dated data partners independently of rivalry', () => {
  const c=companyIntroductionFor({ticker:'RDDT',cik:1713445});
  for(const [id,role,year] of [['GOOG','partner','2024'],['AMZN','supplier','2025'],['OpenAI','partner','2024']]) {
    const e=c.maps.relationships.find(e=>(e.ticker||e.name)===id);assert.equal(e.role,role);assert.ok(e.label.en.includes(year));assert.ok(e.sourceIndexes.length);
  }
  assert.ok(c.maps.competition.some(e=>e.ticker==='GOOG')); // Advertising rivalry coexists with Google Cloud/data partnership.
  const g=companyNetworkFor({ticker:'RDDT',cik:1713445}),direct=networkHelpers.networkFocus(g,g.root,'direct'),two=networkHelpers.networkFocus(g,g.root,'two');
  assert.ok(g.edges.some(e=>e.kind==='partner'&&[e.from,e.to].includes('GOOG')&&[e.from,e.to].includes('RDDT')));
  assert.ok(g.edges.some(e=>e.kind==='supply'&&e.from==='AMZN'&&e.to==='RDDT'));
  assert.ok(g.nodes.some(n=>n.id==='OpenAI'&&!n.ticker));
  assert.ok(two.visibleEdges.length>direct.visibleEdges.length);assert.ok(g.nodes.length<=41&&g.edges.length<=61);
});

test('Nebius separates capacity customers, sovereign partner, compatibility and listed GPU rivals', () => {
  const g=companyNetworkFor({ticker:'NBIS',cik:1513845}),c=companyIntroductionFor({ticker:'NBIS',cik:1513845});
  const layer=id=>g.nodes.find(n=>n.id===id).layer;
  assert.equal(layer('NBIS'),0);assert.equal(layer('NVDA'),1);assert.equal(layer('META'),2);assert.equal(layer('PLTR'),3);assert.equal(layer('Anthropic'),4);assert.equal(layer('IREN'),5);
  assert.ok(c.maps.competition.some(e=>e.ticker==='IREN'));assert.ok(!c.maps.competition.some(e=>e.ticker==='META'));
  assert.ok(!g.edges.some(e=>e.from==='NVDA'&&['GOOG','CRWV','AMZN','MSFT','META'].includes(e.to)));
  for(const id of ['Anthropic','OpenAI'])assert.match(c.maps.relationships.find(e=>e.name===id).label.en,/not an?.*contract/i);
  for(const lang of ['ja','en']) {
    const html=renderToStaticMarkup(createElement(networkComponent.CompanyNetworkMap,{graph:g,lang}));
    assert.ok(html.includes('Palantir')||html.includes('PLTR'));assert.ok(html.includes('Anthropic'));assert.ok(html.includes('OpenAI'));
    assert.ok(!html.includes('aria-label="Lambda"'));assert.ok(!html.includes('aria-label="Crusoe"'));
    assert.ok(html.includes(lang==='ja'?'技術対応':'Compatibility'));
  }
});
test('IREN identifies Anthropic as a reported contract and preserves NVIDIA two-way business scope', () => {
  const c=companyIntroductionFor({ticker:'IREN',cik:1878848}),nv=c.maps.relationships.find(e=>e.ticker==='NVDA'),a=c.maps.relationships.find(e=>e.name==='Anthropic');
  assert.equal(nv.role,'partner');assert.match(nv.label.en,/2027/);assert.equal(a.role,'customer');assert.match(a.label.en,/Reported contract/);assert.match(a.label.en,/not confirmed/);
  assert.ok(a.sourceIndexes.some(i=>c.sources[i].url.includes('fool.com')));assert.ok(a.sourceIndexes.some(i=>c.sources[i].url.includes('iren-reports-fy26')));
});
test('stock maps exclude private and unresolved entities while retaining the two requested AI exceptions', () => {
  const node=(id,ticker)=>({id,name:id,kind:'company',layer:6,...(ticker?{ticker}: {})});
  for(const id of ['Lambda','Crusoe','Databricks','ByteDance','Altera','Carl Zeiss SMT','Unknown private entity'])assert.equal(networkHelpers.isStockMapCompany(node(id)),false,id);
  for(const id of ['OpenAI','Anthropic','Samsung','SK hynix','Kioxia','Canon'])assert.equal(networkHelpers.isStockMapCompany(node(id)),true,id);
  assert.equal(networkHelpers.isStockMapCompany({...node('Anonymous'),'kind':'industry'}),false);
});
