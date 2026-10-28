// Run locally with prepared environment variables. This command performs no network or DB I/O.
import { livePreflight } from '../../services/tech-phase-billing/live-preflight.mjs';
const args = process.argv.slice(2);
if (args.length !== 1 || !['web', 'api', 'recovery'].includes(args[0])) {
  console.error(JSON.stringify({ error: 'usage: node scripts/tech-phase/check_live_config.mjs web|api|recovery' }));
  process.exitCode = 2;
} else {
  try {
    const report = livePreflight(process.env, args[0]);
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.configurationReady && report.preparationSafe ? 0 : 1;
  } catch {
    console.error(JSON.stringify({ error: 'preflight-unavailable', connectionVerified: false, launchReady: false }));
    process.exitCode = 2;
  }
}
