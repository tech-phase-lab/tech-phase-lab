import 'server-only';
import {readFile} from 'node:fs/promises';
import {parsePrivateRizelRegistry} from './rizel-private-registry';
import type {CopyEntry} from './rizel-selection';
/** Secret-mounted registry outside the public checkout. No path from the request. */
export async function readPrivateRizelBank():Promise<CopyEntry[]> {
 const path=process.env.RESOLUTE_RIZEL_PRIVATE_BANK_PATH;
 if(!path)throw Error('PRIVATE_BANK_NOT_CONFIGURED');
 return parsePrivateRizelRegistry(await readFile(path,'utf8'));
}
/** Twelve fixed layout examples, scoped to the preview branch's server only.
 * This is not the selection bank, a database connection, or a publish operation.
 */
export async function readPrivateRizelPreview():Promise<CopyEntry[]> {
 if(process.env.VERCEL_ENV!=='preview')throw Error('PRIVATE_PREVIEW_ONLY');
 const raw=process.env.RESOLUTE_RIZEL_LAYOUT_PREVIEW_JSON;
 if(!raw)throw Error('PRIVATE_PREVIEW_NOT_CONFIGURED');
 return parsePrivateRizelRegistry(raw,true);
}
