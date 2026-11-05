import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";

test("Profiles preserve current cookies, isolate accounts and import both portal and sign-in sessions", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "cc-auth-"));
  try {
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
        import assert from 'node:assert/strict';
        import {openProfile, openCheckProfile, closeProfile, saveSession, authenticate, importChrome} from './src/auth.js';
        import path from 'node:path';
        import {chromium} from 'playwright';
        const cookie = (name, value, expires = -1) => ({
          name, value, domain: 'example.test', path: '/', expires,
          secure: true, httpOnly: true, sameSite: 'Lax'
        });
        const expiry = Math.floor(Date.now() / 1000) + 86400;
        let context = await openProfile('account-1');
        try {
          await context.addCookies([
            cookie('refresh', 'old', expiry), cookie('revoked', 'old', expiry),
            cookie('session', 'saved'), cookie('revoked-session', 'old')
          ]);
          await saveSession(context, 'account-1');
          await context.addCookies([cookie('refresh', 'rotated', expiry), cookie('session', 'rotated')]);
          await context.clearCookies({name: 'revoked'});
          await context.clearCookies({name: 'revoked-session'});
          await context.pages()[0].goto('data:text/html,old-login-page');
          await context.newPage();
        } finally { await closeProfile(context); }
        context = await openProfile('account-1');
        try {
          assert.deepEqual(context.pages().map(p => p.url()), ['about:blank']);
          const cookies = await context.cookies('https://example.test');
          assert.equal(cookies.find(c => c.name === 'refresh').value, 'rotated');
          assert.equal(cookies.find(c => c.name === 'session').value, 'rotated');
          assert.equal(cookies.some(c => c.name === 'revoked'), false);
          assert.equal(cookies.some(c => c.name === 'revoked-session'), false);
          await context.addCookies([cookie('session', 'renewed')]);
          await saveSession(context, 'account-1');
        } finally { await closeProfile(context); }
        context = await openProfile('account-1');
        try {
          assert.equal((await context.cookies()).find(c => c.name === 'session').value, 'renewed');
        } finally { await closeProfile(context); }
        context = await openProfile('account-2');
        try { assert.equal((await context.cookies()).length, 0); }
        finally { await closeProfile(context); }
        const held = await chromium.launchPersistentContext(path.join(process.env.DATA_DIR, 'profiles', 'account-3'), {
          channel: 'chrome', headless: true, args: ['--remote-debugging-port=0'],
        });
        try {
          const original = held.pages()[0];
          await original.route('https://cartaocontinente.pt/**', route => route.fulfill({ body: 'Trial tab' }));
          await original.goto('https://cartaocontinente.pt/AMinhaConta.aspx');
          await held.addCookies([cookie('trial', 'three')]);
          for (let i = 0; i < 2; i++) {
            const check = await openCheckProfile('account-3');
            try {
              assert.equal(check.source, 'open-tab');
              assert.match(check.page.url(), /^about:blank#/);
              assert.deepEqual((await check.context.cookies('https://example.test')).map(c => c.value), ['three']);
            } finally { await check.close(); }
            assert.deepEqual(held.pages(), [original]);
          }
        } finally { await held.close(); }
        const restarted = await openCheckProfile('account-3');
        try { assert.equal(restarted.source, 'reopened'); }
        finally { await restarted.close(); }
        const launch = chromium.launchPersistentContext.bind(chromium);
        const visited = [];
        chromium.launchPersistentContext = async (dir, options) => {
          const loginContext = await launch(dir, {...options, headless: true});
          await loginContext.route('https://cartaocontinente.pt/**', route => {
            const pathname = new URL(route.request().url()).pathname;
            visited.push(pathname);
            const menu = '<form action="/AMinhaConta.aspx"><div class="MyAccountLeftMenu"><a href="#" onclick="document.querySelector(&quot;.TituloDadosConta&quot;).hidden=false;return false">Cupões</a></div></form>';
            return route.fulfill({
                contentType: 'text/html; charset=utf-8',
              body: menu + '<div class="TituloDadosConta" ' + (pathname === '/AMinhaConta.aspx' ? '' : 'hidden') + '>Os meus cupões</div>'
            });
          });
          return loginContext;
        };
        await authenticate('account-2');
        assert.deepEqual(visited, ['/IniciarSessao.aspx', '/AMinhaConta.aspx']);
        const sourceBrowser = await chromium.launch({channel: 'chrome', headless: true});
        try {
          const source = await sourceBrowser.newContext();
          await source.route('https://cartaocontinente.pt/**', route => route.fulfill({
            contentType: 'text/html; charset=utf-8',
            body: '<div class="TituloDadosConta">Os meus cupões</div>'
          }));
          const sourcePage = await source.newPage();
          await sourcePage.goto('https://cartaocontinente.pt/AMinhaConta.aspx');
          await source.addCookies([
            {...cookie('portal-auth', 'portal-session', expiry), domain: 'cartaocontinente.pt'},
            {...cookie('sign-in-auth', 'remembered-session', expiry), domain: 'login.continente.pt'},
            {...cookie('shopping-auth', 'unrelated'), domain: '.continente.pt'},
            cookie('other-website', 'unrelated')
          ]);
          await sourcePage.evaluate(() => localStorage.setItem('portal-preference', 'saved'));
          let disconnected = false;
          chromium.connectOverCDP = async () => ({contexts: () => [source], close: async () => {disconnected = true;}});
          await importChrome('account-2');
          assert.equal(disconnected, true);
          assert.equal(sourcePage.isClosed(), false);
          context = await openProfile('account-2');
          try {
            const cookies = await context.cookies();
            assert.equal(cookies.find(c => c.name === 'portal-auth').value, 'portal-session');
            assert.equal(cookies.find(c => c.name === 'sign-in-auth').value, 'remembered-session');
            assert.equal(cookies.find(c => c.name === 'sign-in-auth').expires, expiry);
            assert.equal(cookies.some(c => ['shopping-auth','other-website'].includes(c.name)), false);
            await context.pages()[0].goto('https://cartaocontinente.pt/AMinhaConta.aspx');
            assert.equal(await context.pages()[0].evaluate(() => localStorage.getItem('portal-preference')), 'saved');
          } finally {await closeProfile(context);}
        } finally {await sourceBrowser.close();}
        console.log('verified');
      `,
      ],
      {
        cwd: new URL("../", import.meta.url),
        env: { ...process.env, DATA_DIR: dir },
        timeout: 60000,
      },
    );
    assert.match(stdout, /verified/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
