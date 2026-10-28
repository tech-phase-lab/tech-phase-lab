// Source-first collector replaces the retired candidate-list migration.
const batchId=process.argv.find(a=>a.startsWith('--batch-id='));
if(batchId)process.argv.push('--batch='+batchId.slice(11));
await import('./rebuild.mjs');
