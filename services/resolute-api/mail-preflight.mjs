import {inspectMailConfiguration} from '../../lib/resolute/notification-mail-preflight.ts';

// Read-only: prints names and booleans, never values or exception details.
const report=inspectMailConfiguration(process.env);
console.log(JSON.stringify(report));
if(!report.configurationValid)process.exitCode=1;
