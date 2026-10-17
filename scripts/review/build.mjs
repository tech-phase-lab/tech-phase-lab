import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
// Materialize fictional inputs at build time. Node-only analysis/hash modules
// never enter the public browser bundle.
const compiled=await build({entryPoints:['lib/research/comparison-sample.ts'],bundle:true,write:false,platform:'node',format:'esm'});
const {buildComparisonSample}=await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].contents).toString('base64')}`);
await writeFile('scripts/review/sample.generated.json',JSON.stringify(buildComparisonSample()));
const companies=JSON.parse(await readFile('lib/research/providers.json','utf8')).map(({ticker,name,sector})=>({ticker,name,sector}));
await writeFile('scripts/review/companies.generated.json',JSON.stringify(companies));
await build({entryPoints:['scripts/review/viewer.tsx'], bundle:true, minify:true, outfile:'public/intro/viewer.js', platform:'browser', target:['es2022'], jsx:'automatic', define:{'process.env.NODE_ENV':'"production"'}, loader:{'.module.css':'local-css'}, logLevel:'info'});
