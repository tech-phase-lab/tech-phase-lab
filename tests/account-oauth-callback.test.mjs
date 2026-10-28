import * as accountReturn from "../lib/research/account-return.ts";
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const source = readFileSync(new URL('../app/research/account/screen.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022,
} }).outputText;
let clientSnapshot = true;
let signedIn = false;
let effects = [];
let recoveryCalls = 0;
let hash = '';
let returnPath = null;
let signInProps, signUpProps;
let callbackProps;
const target = { exports: {} };
new Function('require', 'module', 'exports', 'window', compiled)(id => {
  if (id === '@/lib/research/account-return') return accountReturn;
  if (id === 'react') return { ...React, useEffect: fn => { effects.push(fn); }, useSyncExternalStore: (_subscribe, snapshot, serverSnapshot) => clientSnapshot ? snapshot() : serverSnapshot() };
  if (id === '@clerk/nextjs') return {
    useAuth: () => ({ isLoaded: true, isSignedIn: signedIn }),
    SignIn: props => { signInProps = props; return React.createElement('p', null, 'Sign in'); },
    SignUp: props => { signUpProps = props; return React.createElement('p', null, 'Sign up'); },
    SignOutButton: ({ children }) => children,
    AuthenticateWithRedirectCallback: props => { callbackProps = props; return null; },
  };
  if (id.endsWith('.module.css')) return { default: {} };
  if (id === 'next/link') return { default: ({ children }) => children };
  if (id === '../research-tool-shell') return { default: ({ children }) => children };
  if (id === '../use-research-language') return { useResearchLanguage: () => ['ja', () => {}] };
  if (id === '@/lib/research/member-recovery') return { recoverMember: () => { recoveryCalls++; return new Promise(() => {}); } };
  if (id === '../identity-provider') return { useIdentityRefresh: () => async () => {} };
  if (id === './preview-controls') return { default: () => null };
  return require(id);
}, target, target.exports, { location: { get hash() { return hash; } }, sessionStorage: { getItem: () => returnPath } });
function render(fragment) {
  hash = fragment;
  callbackProps = undefined;
  return renderToStaticMarkup(React.createElement(target.exports.default, { status: 'signed-out', plan: 'free' }));
}
test('OAuth returns, including a nested return fragment, reach the SDK callback instead of restarting sign-in', () => {
  for (const fragment of ['#/sso-callback', '#/sso-callback?sign_in_force_redirect_url=%2Fresearch%2Faccount', '#/sso-callback?sign_in_force_redirect_url=%2Fresearch%2Faccount#/?sign_in_force_redirect_url=%2Fresearch%2Faccount']) {
    const html = render(fragment);
    assert.match(html, /ログインを完了しています/);
    assert.doesNotMatch(html, /Sign in/);
    assert.deepEqual(callbackProps, {
      signInUrl: '/research/account', signUpUrl: '/research/account/sign-up',
      signInForceRedirectUrl: '/research/account', signUpForceRedirectUrl: '/research/account',
    });
  }
});
test('normal sign-in and additional verification routes stay with the Clerk sign-in widget', () => {
  for (const fragment of ['', '#/', '#/factor-two', '#/reset-password', '#/sso-callback-fake', '#/?redirect_url=%23%2Fsso-callback']) {
    assert.match(render(fragment), /Sign in/);
    assert.equal(callbackProps, undefined);
  }
});

test('email, registration and OAuth share the originating article return destination', () => {
  returnPath = JSON.stringify({path:'/research#what-changed/mu-q3-2026',at:Date.now()});
  render('');
  assert.equal(signInProps.forceRedirectUrl, '/research#what-changed/mu-q3-2026');
  hash = '';
  renderToStaticMarkup(React.createElement(target.exports.default, {status:'signed-out',plan:'free',signingUp:true}));
  assert.equal(signUpProps.forceRedirectUrl, '/research#what-changed/mu-q3-2026');
  render('#/sso-callback');
  assert.equal(callbackProps.signInForceRedirectUrl, '/research#what-changed/mu-q3-2026');
  assert.equal(callbackProps.signUpForceRedirectUrl, '/research#what-changed/mu-q3-2026');
  returnPath = null;
});

test('server render never starts the sign-in widget before the tab return destination is known', () => {
  clientSnapshot = false;
  signInProps = undefined;
  render('');
  assert.equal(signInProps, undefined);
  clientSnapshot = true;
});

// A prefetched server page can still say signed-out after OAuth establishes the SDK session.
// Mounting Clerk SignIn here redirects the member away before server recovery finishes.
test('an established client session waits for membership instead of mounting redirecting sign-in', () => {
  signedIn = true;
  signInProps = undefined;
  signUpProps = undefined;
  try {
    const html = render('');
    assert.equal(signInProps, undefined);
    assert.match(html, /aria-busy="true"/);
    renderToStaticMarkup(React.createElement(target.exports.default, {status:'signed-out',plan:'free',signingUp:true}));
    assert.equal(signUpProps, undefined);
  } finally { signedIn = false; }
});

test('signed-out account never waits for token renewal or replaces login with a membership error', () => {
  signedIn = false; effects = []; recoveryCalls = 0;
  const html = renderToStaticMarkup(React.createElement(target.exports.default, {
    status:'signed-out',plan:'free',
    initialMember:{status:'unavailable',plan:'free',isAdmin:false,ownerMode:false,canTest:false,testing:false}
  }));
  const cleanups = effects.map(fn => fn());
  assert.equal(recoveryCalls, 0);
  assert.match(html, /Sign in/);
  assert.doesNotMatch(html, /会員情報を確認できませんでした/);
  for (const cleanup of cleanups) cleanup?.();
});
