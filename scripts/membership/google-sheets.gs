// Bound to the owner's private Google spreadsheet. No web-app deployment needed.
function setupTechPhase() {
  var ui = SpreadsheetApp.getUi();
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty('SYNC_TOKEN') || Utilities.getUuid()+Utilities.getUuid();
  props.setProperties({SYNC_TOKEN:token, SHEET_ID:SpreadsheetApp.getActiveSpreadsheet().getId()});
  ui.alert('Vercelに設定する値', 'Key: MEMBER_SHEET_SYNC_TOKEN\nValue: '+token+'\n\nこの値は公開せず、Vercelの環境変数に保存してください。保存・再デプロイ後に startTechPhase を実行します。', ui.ButtonSet.OK);
}
function startTechPhase() {
  syncTechPhase(); // Do not start a recurring trigger until a real sync succeeds.
  ScriptApp.getProjectTriggers().forEach(function(t){if(t.getHandlerFunction()==='syncTechPhase') ScriptApp.deleteTrigger(t);});
  ScriptApp.newTrigger('syncTechPhase').timeBased().everyMinutes(15).create();
}
function stopTechPhase() {
  ScriptApp.getProjectTriggers().forEach(function(t){if(t.getHandlerFunction()==='syncTechPhase') ScriptApp.deleteTrigger(t);});
}
function syncTechPhase() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    var p = PropertiesService.getScriptProperties();
    if (!p.getProperty('SYNC_TOKEN') || !p.getProperty('SHEET_ID')) throw new Error('先に setupTechPhase を実行してください。');
    var response = UrlFetchApp.fetch('https://tech-phase-lab-git-codex-research-preview-chehon7144-5412.vercel.app/api/research/member/sync', {headers:{Authorization:'Bearer '+p.getProperty('SYNC_TOKEN')},muteHttpExceptions:true,followRedirects:false});
    if (response.getResponseCode()!==200) throw new Error('同期失敗 HTTP '+response.getResponseCode()+'。既存データは保持しました。');
    var data = JSON.parse(response.getContentText());
    if (data.version!==1 || data.complete!==true || !Array.isArray(data.members) || data.members.length!==data.total) throw new Error('不完全な取得結果です。既存データは保持しました。');
    var seen = {};
    var text = function(v){var s=String(v||''); return /^[\s\x00-\x1f]*[=+@-]/.test(s)?"'"+s:s;};
    var date = function(v){if(!v)return '';var d=new Date(v);return isNaN(d.getTime())?'':d;};
    var rows = data.members.map(function(m){
      if(!m.id || seen[m.id])throw new Error('会員IDが重複しています。');
      seen[m.id]=true;
      return [text(m.id),text(m.kind),text(m.name),text(m.email),text(m.plan),m.verified?'はい':'いいえ',date(m.createdAt),date(m.lastSignInAt),date(m.proExpiresAt)];
    });
    var ss=SpreadsheetApp.openById(p.getProperty('SHEET_ID'));ss.setSpreadsheetTimeZone('Asia/Tokyo');
    var sh=ss.getSheetByName('会員自動同期')||ss.insertSheet('会員自動同期');
    var oldLast=sh.getLastRow();
    var header=['会員ID','区分','表示名','メールアドレス','プラン','メール確認済み','登録日時（JST）','最終ログイン（JST）','PRO有効期限（JST）'];
    sh.getRange(5,1,rows.length+1,9).setValues([header].concat(rows));
    // Full current snapshot also removes retired accounts; never append duplicates.
    if(oldLast>rows.length+5)sh.getRange(rows.length+6,1,oldLast-rows.length-5,9).clearContent();
    sh.getRange('A1').setValue('Tech Phase 登録者管理');
    sh.getRange('A2:F2').setValues([['一般会員',data.members.filter(function(m){return m.kind==='一般';}).length,'運営',data.members.filter(function(m){return m.kind==='運営';}).length,'同期成功日時',new Date()]]);
    sh.getRange('F2').setNumberFormat('yyyy/mm/dd hh:mm:ss');
    sh.getRange('A3').setValue('約15分ごとに更新。会員自動同期シートへの手入力は次回更新で置き換わります。');
    sh.getRange(5,1,1,9).setBackground('#183C34').setFontColor('#ffffff').setFontWeight('bold');
    sh.setFrozenRows(5);sh.setColumnWidths(1,9,170);sh.setColumnWidth(1,300);sh.setColumnWidth(4,250);
    if(rows.length)sh.getRange(6,7,rows.length,3).setNumberFormat('yyyy/mm/dd hh:mm:ss');
  } finally {lock.releaseLock();}
}
