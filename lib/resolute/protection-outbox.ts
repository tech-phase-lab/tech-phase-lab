import type {PoolClient} from 'pg';
import {parseProtectionEvent,ProtectionUnavailable,type ProtectionEvent} from './protection-ledger.ts';
export type ProtectionBarrier=(client:Pick<PoolClient,'query'>,userId:string)=>Promise<void>;
export function createProtectionBarrier(publish:(event:ProtectionEvent)=>Promise<string>,now:()=>number=Date.now):ProtectionBarrier {
 return async(client,userId)=>{
  if(!/^user_[A-Za-z0-9]{1,128}$/.test(userId))throw new ProtectionUnavailable();
  const start=now();
  const result=await client.query(`SELECT revision,kind,occurred_at,attempts,
   next_attempt_at<=statement_timestamp() AS due FROM resolute.protection_outbox
   WHERE clerk_user_id=$1 AND published_at IS NULL ORDER BY revision,kind LIMIT 17`,[userId]);
  for(const [index,row] of result.rows.entries()){
   if(index>=16||!row.due||now()-start>=10000)throw new ProtectionUnavailable();
   const event=parseProtectionEvent({version:1,userId,revision:Number(row.revision),kind:row.kind,at:new Date(row.occurred_at).toISOString()});
   try{
    const receipt=await publish(event);
    if(!/^[0-9a-f]{64}$/.test(receipt))throw new ProtectionUnavailable();
    await client.query(`UPDATE resolute.protection_outbox SET receipt_sha256=$4,published_at=statement_timestamp(),
     next_attempt_at='infinity' WHERE clerk_user_id=$1 AND revision=$2 AND kind=$3 AND published_at IS NULL`,
     [userId,event.revision,event.kind,receipt]);
   }catch{
    // A failed receipt update is safe: retry reads back the same immutable event.
    try{await client.query(`UPDATE resolute.protection_outbox SET attempts=LEAST(attempts+1,30),
     next_attempt_at=statement_timestamp()+make_interval(secs=>LEAST(900,5*power(2,LEAST(attempts,8)))::int)
     WHERE clerk_user_id=$1 AND revision=$2 AND kind=$3 AND published_at IS NULL`,[userId,event.revision,event.kind]);}catch{}
    throw new ProtectionUnavailable();
   }
  }
 };
}
