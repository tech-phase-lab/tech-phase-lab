import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { authConfig } from './auth.mjs';
import { createHandler } from './handler.mjs';
import { getResoluteEntitlementsForUser } from '../../lib/resolute/database.ts';
import { resoluteDatabaseConfig } from '../../lib/resolute/database-config.ts';

const config=authConfig(process.env);
const db=resoluteDatabaseConfig(process.env.ENTITLEMENT_DB_URL);
if(new URL(db.connectionString).username!=='resolute_api_reader')throw Error('Read-only DB role required');
const handler=createHandler(config,getResoluteEntitlementsForUser);
const server=createServer({maxHeaderSize:24576},async(req,res)=>{
  try {
    const request=new Request('http://service.invalid'+req.url,{method:req.method,headers:req.headers});
    const response=await handler(request);
    res.writeHead(response.status,Object.fromEntries(response.headers));
    if(response.body)Readable.fromWeb(response.body).pipe(res);else res.end();
  } catch {res.writeHead(503,{'Cache-Control':'private, no-store'});res.end();}
});
server.requestTimeout=25000;server.headersTimeout=10000;server.keepAliveTimeout=5000;
server.maxConnections=32;
server.listen(Number(process.env.PORT || 3000),'::',()=>console.log('RESOLUTE_API_READY'));
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
