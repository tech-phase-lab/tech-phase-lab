const date=(value:unknown)=>typeof value==='string'&&Number.isFinite(Date.parse(value))?new Date(value).toISOString():null;
const count=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:null;
/** Only explicitly defined aggregates. No endpoints, subscriber keys, errors or raw payloads. */
export function deliveryView(state:Record<string,unknown>){
 const push=(state.webPush??{}) as Record<string,unknown>;
 const discovery=(state.discoveryRuns??{}) as Record<string,unknown>;
 const measured=push.status==='ready';
 return {news:{lastFetchedAt:null,fetchedCount:null,failedCount:null,verification:'unavailable',lastPollCompletedAt:date(discovery.lastCompletedAt)},
  push:{lastSentAt:null,successCount:measured?count(push.accepted24Hours):null,failureCount:null,window:'last-24-hours',successMeaning:'push-provider-accepted-not-device-read',
   lastAttemptAt:date(push.lastAttemptAt),uncertainCount:measured?count(push.uncertain24Hours):null,expiredCount:measured?count(push.expired24Hours):null,verification:'partial'},
  unavailableFields:['news.lastFetchedAt','news.fetchedCount','news.failedCount','push.lastSentAt','push.failureCount']};
}
