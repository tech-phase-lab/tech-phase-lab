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
let hash = '';
let callbackProps;
const target = { exports: {} };
new Function('require', 'module', 'exports', 'window', compiled)(id => {
  if (id === 'react') return { ...React, useSyncExternalStore: (_subscribe, snapshot) => snapshot() };
  if (id === '@clerk/nextjs') return {
    useAuth: () => ({ isLoaded: true, isSignedIn: false }),
    SignIn: () => React.createElement('p', null, 'Sign in'),
    SignUp: () => React.createElement('p', null, 'Sign up'),
    SignOutButton: ({ children }) => children,
    AuthenticateWithRedirectCallback: props => { callbackProps = props; return null; },
  };
  if (id.endsWith('.module.css')) return { default: {} };
  if (id === 'next/link') return { default: ({ children }) => children };
  if (id === '../research-tool-shell') return { default: ({ children }) => children };
  if (id === '../use-research-language') return { useResearchLanguage: () => ['ja', () => {}] };
  if (id === '@/lib/research/member-recovery') return { recoverMember: () => { throw Error('Unexpected effect'); } };
  if (id === '../identity-provider') return { useIdentityRefresh: () => async () => {} };
  if (id === './preview-controls') return { default: () => null };
  return require(id);
}, target, target.exports, { location: { get hash() { return hash; } } });
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
