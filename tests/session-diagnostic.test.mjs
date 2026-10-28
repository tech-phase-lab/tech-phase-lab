import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionDiagnostic } from '../lib/membership/session-diagnostic.ts';
test('session diagnostics distinguish missing cookies and middleware rejection without exposing credentials', () => {
 const h=new Headers({'cookie':'__session_suffix=private.jwt; __client_uat_suffix=123; other=secret', 'x-clerk-auth-reason':'session-token-expired','x-clerk-auth-status':'signed-out'});
 assert.deepEqual(sessionDiagnostic(h), {reason:'session-token-expired',middlewareSignedIn:false,sessionCookiePresent:true,clientCookiePresent:true});
 assert.deepEqual(sessionDiagnostic(new Headers()), {reason:'unclassified',middlewareSignedIn:false,sessionCookiePresent:false,clientCookiePresent:false});
});
test('raw reason and cookie contents never enter diagnostics; signed-in middleware remains distinguishable', () => {
 const h=new Headers({'cookie':'other=__session_stolen=secret', 'x-clerk-auth-reason':'secret.jwt.user@example.com','x-clerk-auth-status':'signed-in'});
 assert.deepEqual(sessionDiagnostic(h), {reason:'unclassified',middlewareSignedIn:true,sessionCookiePresent:false,clientCookiePresent:false});
});
