import {runOwnerRecovery} from '../../services/tech-phase-billing/recovery.mjs';
try {
  const result=await runOwnerRecovery(process.env);
  console.log(JSON.stringify({event:'TECH_PHASE_SANDBOX_RECOVERY',...result}));
  if(result.outcome==='review-required')process.exitCode=1;
} catch {
  console.error(JSON.stringify({event:'TECH_PHASE_SANDBOX_RECOVERY_FAILED'}));
  process.exitCode=1;
}
