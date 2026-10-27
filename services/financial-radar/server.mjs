import http from 'node:http';
import pg from 'pg';
import {databaseConfig,tokens,handler} from './core.mjs';
let pool;
try {
  // Never run the public API with provisioning credentials present.
  if(process.env.TECH_PHASE_RADAR_PROVISION_DATABASE_URL || process.env.TECH_PHASE_RADAR_DB_PASSWORD) throw Error('PROVISIONING_CREDENTIALS_PRESENT');
  const auth=tokens(process.env);pool=new pg.Pool(databaseConfig(process.env));
  pool.on('error',()=>console.error('RADAR_DATABASE_UNAVAILABLE'));
  await pool.query('SELECT genre,ticker FROM public.tech_phase_financial_radar LIMIT 0');
  const server=http.createServer({requestTimeout:10000,headersTimeout:10000,maxHeaderSize:8192},handler(pool,auth,{log:event=>console.error(event)}));
  server.maxConnections=100;server.setTimeout(10000,socket=>socket.destroy());
  server.listen(Number(process.env.PORT||3000),'::',()=>console.log('RADAR_API_READY'));
  process.on('SIGTERM',()=>{server.close(async()=>{await pool.end();process.exit(0);});setTimeout(()=>process.exit(1),10000).unref();});
}catch{console.error('RADAR_STARTUP_FAILED');await pool?.end();process.exitCode=1;}
