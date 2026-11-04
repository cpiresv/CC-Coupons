import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";

test("Profiles preserve current cookies, isolate accounts and open the account page before coupon navigation", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "cc-auth-"));
  try {
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
        import assert from 'node:assert/strict';
        import {openProfile, closeProfile, saveSession, authenticate} from './src/auth.js';
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
        const launch = chromium.launchPersistentContext.bind(chromium);
        const visited = [];
        chromium.launchPersistentContext = async (dir, options) => {
          const loginContext = await launch(dir, {...options, headless: true});
          await loginContext.route('https://cartaocontinente.pt/**', route => {
            const pathname = new URL(route.request().url()).pathname;
            visited.push(pathname);
            const menu = '<form action="/AMinhaConta.aspx"><div class="MyAccountLeftMenu"><a href="#">Cupões</a></div></form>';
            return route.fulfill({
                contentType: 'text/html; charset=utf-8',
              body: menu + (pathname === '/AMinhaConta.aspx' ? '<div class="TituloDadosConta">Os meus cupões</div>' : '')
            });
          });
          return loginContext;
        };
        await authenticate('account-2');
        assert.deepEqual(visited, ['/IniciarSessao.aspx', '/AMinhaConta.aspx']);
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
