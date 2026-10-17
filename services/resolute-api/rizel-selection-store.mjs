import {selectRizel} from '../../lib/resolute/rizel-selection.ts';
/** Caller is a trusted article-ingestion worker, never a browser facts payload.
 * Serializes selection across articles, and persists exact bilingual revisions.
 * No customer feed reads this table. No scheduler is enabled by this module.
 */
export async function saveRizelSelection(pool,input) {
 const client=await pool.connect();
 try {
  await client.query('BEGIN');
  await client.query("SELECT pg_advisory_xact_lock(70773190)");
  const previous=await client.query('SELECT result FROM resolute_rizel_selections WHERE article_id=$1 AND article_revision=$2',[input.article.id,input.article.revision]);
  if(previous.rows.length){await client.query('COMMIT');return previous.rows[0].result;}
  const rows=await client.query('SELECT result FROM resolute_rizel_selections ORDER BY created_at DESC');
  const history=rows.rows.flatMap(({result})=>result.ids.map(id=>({id,usedAt:result.createdAt})));
  const result=await selectRizel({...input,history});
  await client.query('INSERT INTO resolute_rizel_selections(article_id,article_revision,result,created_at) VALUES($1,$2,$3,$4)',[input.article.id,input.article.revision,JSON.stringify(result),result.createdAt]);
  await client.query('COMMIT');return result;
 } catch(error){await client.query('ROLLBACK');throw error;} finally {client.release();}
}
