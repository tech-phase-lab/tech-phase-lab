/** No row data, credentials, role changes or network access. Catalog-only ACL audit. */
export const storageRoles=['resolute_plan_writer','resolute_notification_writer','resolute_protection_writer'];
const receiptColumns=new Set(['receipt_sha256','published_at','attempts','next_attempt_at']);
const permissions={
 resolute_plan_writer:{'resolute.entitlements':['SELECT'],'resolute.plans':['SELECT','INSERT','UPDATE'],'resolute.plan_deletions':['SELECT','INSERT'],'resolute.protection_outbox':['SELECT'],'resolute_payments_live.entitlement_periods':['SELECT']},
 resolute_notification_writer:{'resolute.entitlements':['SELECT'],'resolute.notification_settings':['SELECT','INSERT','UPDATE'],'resolute.protection_outbox':['SELECT'],'resolute_payments_live.entitlement_periods':['SELECT']},
 resolute_protection_writer:{'resolute.protection_outbox':['SELECT']},
};
function fail(){throw Error('RESOLUTE_STORAGE_PERMISSIONS_UNSAFE');}
export async function verifyStoragePermissions(client,{loginRoles=[]}={}){
 if(!Array.isArray(loginRoles)||new Set(loginRoles).size!==loginRoles.length||loginRoles.some(role=>!storageRoles.includes(role)))fail();
 const {rows:scope}=await client.query("SELECT current_database() AS name,current_setting('server_version_num')::int AS version");
 if(scope[0]?.name!=='resolute')fail();
 const privileges=['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'];
 if(scope[0].version>=170000)privileges.push('MAINTAIN');
 for(const role of storageRoles){
  const {rows}=await client.query(`SELECT r.oid,rolcanlogin,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,rolinherit,
   EXISTS(SELECT 1 FROM pg_auth_members WHERE member=r.oid OR roleid=r.oid) AS membership,
   has_database_privilege(r.oid,current_database(),'CREATE') AS db_create
   FROM pg_roles r WHERE rolname=$1`,[role]);
  const identity=rows[0];
  if(!identity||Object.entries(identity).some(([k,v])=>k!=='oid'&&v!==(k==='rolcanlogin'&&loginRoles.includes(role))))fail();
  const {rows:schemas}=await client.query(`SELECT nspname,has_schema_privilege($1,oid,'CREATE') AS writable,
   has_schema_privilege($1,oid,'USAGE') AS usable
   FROM pg_namespace WHERE left(nspname,3)<>'pg_' AND nspname<>'information_schema'`,[role]);
  if(schemas.some(s=>s.writable))fail();
  for(const name of new Set(Object.keys(permissions[role]).map(table=>table.split('.')[0]))){
   if(!schemas.some(s=>s.nspname===name&&s.usable))fail();
  }
  // All non-system relations, including future/unrelated tables and column grants.
  const {rows:relations}=await client.query(`SELECT c.oid,n.nspname||'.'||c.relname AS name,
   c.relowner=$1::oid AS owned,c.relkind
   FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE left(n.nspname,3)<>'pg_' AND n.nspname<>'information_schema'
   AND c.relkind IN ('r','p','v','m','f','S')`,[identity.oid]);
  const expected=permissions[role];
  if(Object.keys(expected).some(name=>!relations.some(r=>r.name===name)))fail();
  for(const relation of relations){
   if(relation.owned)fail();
   if(relation.relkind==='S'){
    const {rows:[r]}=await client.query("SELECT has_sequence_privilege($1,$2::oid,'USAGE,SELECT,UPDATE') AS access",[role,relation.oid]);
    if(r.access)fail();continue;
   }
   const allowed=expected[relation.name]??[];
   for(const privilege of privileges){
    const {rows:[r]}=await client.query('SELECT has_table_privilege($1,$2::oid,$3) AS access,has_table_privilege($1,$2::oid,$4) AS grantable',
     [role,relation.oid,privilege,privilege+' WITH GRANT OPTION']);
    if(r.access!==allowed.includes(privilege)||r.grantable)fail();
   }
   const {rows:columns}=await client.query('SELECT attnum,attname FROM pg_attribute WHERE attrelid=$1::oid AND attnum>0 AND NOT attisdropped',[relation.oid]);
   for(const column of columns){
    for(const privilege of ['SELECT','INSERT','UPDATE','REFERENCES']){
     const {rows:[r]}=await client.query('SELECT has_column_privilege($1,$2::oid,$3::smallint,$4) AS access,has_column_privilege($1,$2::oid,$3::smallint,$5) AS grantable',
      [role,relation.oid,column.attnum,privilege,privilege+' WITH GRANT OPTION']);
     const receipt=relation.name==='resolute.protection_outbox'&&privilege==='UPDATE'&&receiptColumns.has(column.attname);
     if(r.access!==(allowed.includes(privilege)||receipt)||r.grantable)fail();
    }
   }
  }
  const {rows:dangerous}=await client.query(`SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE left(n.nspname,3)<>'pg_' AND n.nspname<>'information_schema'
   AND (p.proowner=$2::oid OR (p.prosecdef AND has_function_privilege($1,p.oid,'EXECUTE')))`,[role,identity.oid]);
  if(dangerous.length)fail();
 }
 return {rolesVerified:storageRoles.length,loginsEnabled:loginRoles.length>0,rawPaymentAccess:false,deliveryAccess:false};
}
