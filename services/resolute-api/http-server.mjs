import { createServer } from 'node:http';
import { Readable } from 'node:stream';

// Shared by the deployed entry point and isolated HTTP acceptance tests.
export function createApiServer(handler) {
  const server=createServer({maxHeaderSize:24576},async(req,res)=>{
  try {
    const request=new Request('http://service.invalid'+req.url,{method:req.method,headers:req.headers,
      ...(['GET','HEAD'].includes(req.method)?{}:{body:Readable.toWeb(req),duplex:'half'})});
    const response=await handler(request);
    res.writeHead(response.status,Object.fromEntries(response.headers));
    if(response.body)Readable.fromWeb(response.body).pipe(res);else res.end();
  } catch {res.writeHead(503,{'Cache-Control':'private, no-store'});res.end();}
});
server.requestTimeout=25000;server.headersTimeout=10000;server.keepAliveTimeout=5000;
server.maxConnections=32;
  return server;
}
