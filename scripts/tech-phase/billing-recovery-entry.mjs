import {runSandboxRecovery} from '../../services/tech-phase-billing/recovery.mjs';
try {
  const result=await runSandboxRecovery(process.env);
  console.log(JSON.stringify({event:'TECH_PHASE_SANDBOX_RECOVERY',...result}));
  // A recorded payment hold is a business state, not a failed reconciliation.
  // Keep it observable without reporting a fresh container crash every hour.
  if(result.outcome==='review-required')console.warn(JSON.stringify({event:'TECH_PHASE_SANDBOX_REVIEW_REQUIRED',changed:result.changed}));
  if(result.reviewRequired>0)console.warn(JSON.stringify({event:'TECH_PHASE_SANDBOX_REVIEW_REQUIRED',count:result.reviewRequired}));
  if(result.outcome==='partial-failure')process.exitCode=1;
} catch {
  console.error(JSON.stringify({event:'TECH_PHASE_SANDBOX_RECOVERY_FAILED'}));
  process.exitCode=1;
}
