import {createMailFeedbackRuntime} from '../../lib/resolute/notification-feedback-runtime.ts';
import {mailStopRequest} from '../../lib/resolute/notification-stop-service.ts';
import {aiCheckRequest} from './ai-check.mjs';
import {rizelReviewRequest} from './rizel-review-store.mjs';
import { paymentRuntime } from './payments/runtime.mjs';
import { livePaymentRuntime } from './payments/live-runtime.mjs';
import { liveConfigSelfCheck } from './payments/live-config-check.mjs';
import {riskRequest} from './risk-store.mjs';
import {createThermometerRead} from './thermometer-read.mjs';
import {createTodayPlanRead} from './today-plan-read.mjs';
import { operateNotificationSettings } from '../../lib/resolute/notification-database.ts';
import { operateLatestAlert } from '../../lib/resolute/latest-alert-database.ts';
import { createApiServer } from './http-server.mjs';
import { authConfig } from './auth.mjs';
import { createHandler } from './handler.mjs';
import { getResoluteEntitlementsForUser } from '../../lib/resolute/database.ts';
import { operateResolutePlan } from '../../lib/resolute/plan-database.ts';
import { resoluteDatabaseConfig } from '../../lib/resolute/database-config.ts';

const config=authConfig(process.env);
const db=resoluteDatabaseConfig(process.env.ENTITLEMENT_DB_URL);
if(new URL(db.connectionString).username!=='resolute_api_reader')throw Error('Read-only DB role required');
// Booleans only: tells whether the payment Clerk key is the production instance's, without revealing it.
console.log(JSON.stringify({event:'RESOLUTE_LIVE_CONFIG_CHECK',...liveConfigSelfCheck(process.env)}));
const payments=paymentRuntime(process.env,config);
const livePayments=livePaymentRuntime(process.env,config);
// A wrong thermometer setting must not take the whole API down: the page stays 「準備中」.
let thermometer;try{thermometer=createThermometerRead(process.env);}catch{console.error('RESOLUTE_THERMOMETER_READ_MISCONFIGURED');}
// 「今日やること」: off unless RESOLUTE_TODAY_PLAN_ENABLED=true; a wrong setting answers 503 and the site shows the fixed sentence.
let todayPlan;try{todayPlan=createTodayPlanRead(process.env);}catch{console.error('RESOLUTE_TODAY_PLAN_READ_MISCONFIGURED');}
const handler=createHandler(config,getResoluteEntitlementsForUser,undefined,operateResolutePlan,operateNotificationSettings,riskRequest,rizelReviewRequest,aiCheckRequest,mailStopRequest,operateLatestAlert,thermometer,todayPlan);
const feedback=createMailFeedbackRuntime(process.env);
const server=createApiServer(async request=>await feedback(request) ?? await livePayments(request) ?? await payments(request) ?? await handler(request));
server.listen(Number(process.env.PORT || 3000),'::',()=>console.log('RESOLUTE_API_READY'));
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
