import test from 'node:test';
import assert from 'node:assert/strict';
import {muWatchForMember,muWatchFacts as f} from '../lib/research/mu-watch.ts';
test('MU analysis never enters the free, unavailable or expired payload',()=>{
 for(const member of [{status:'signed-out',plan:'pro',accessExpiresAt:200},{status:'signed-in',plan:'free',accessExpiresAt:200},{status:'unavailable',plan:'pro',accessExpiresAt:200},{status:'signed-in',plan:'pro',accessExpiresAt:100},{status:'signed-in',plan:'pro'}])assert.equal(muWatchForMember(member,100),null);
 assert.equal(muWatchForMember({status:'signed-in',plan:'pro',accessExpiresAt:200},100).length,4);
});
test('MU changes preserve actual/forecast direction and quarter/release dates',()=>{
 assert.equal(((f.revenue.current/f.revenue.previous-1)*100).toFixed(1),'30.8');
 assert.equal(((f.coreDataCenterRevenue.current-f.coreDataCenterRevenue.previous)/(f.revenue.current-f.revenue.previous)*100).toFixed(1),'50.7');
 assert.equal(f.cloudOperatingMargin.current-f.cloudOperatingMargin.previous,-2);
 assert.equal(f.guidance.adjustedGrossMargin-f.adjustedGrossMargin.current,-0.75);
 assert.notEqual(f.releasedOn,f.periodEnd);
});
