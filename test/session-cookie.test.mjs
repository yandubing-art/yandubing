import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { test } from "node:test";

async function freePort() {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  server.close();
  await once(server, "close");
  return port;
}

test("login cookie ends with the browser session on desktop and mobile", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-auth-test-"));
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [path.resolve("dist/server.js")], {
    cwd: dataDir,
    env: { ...process.env, PREVIEW_MODE: "true", PORT: String(port), AUTH_COOKIE_SECURE: "true" },
    stdio: "ignore"
  });
  try {
    let ready = false;
    for (let i = 0; i < 100; i += 1) {
      if (child.exitCode !== null) throw new Error(`preview server exited: ${child.exitCode}`);
      try {
        const response = await fetch(`${base}/health`);
        if (response.ok) { ready = true; break; }
      } catch { /* wait for the listener */ }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(ready, "preview server did not start");

    const login = await fetch(`${base}/api/auth/preview-login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    });
    assert.equal(login.status, 200);
    const setCookies = login.headers.getSetCookie();
    const session = setCookies.find((value) => value.startsWith("dispatch_session_v2="));
    assert.ok(session, "new session cookie is missing");
    assert.match(session, /; HttpOnly; SameSite=Lax; Secure/);
    assert.doesNotMatch(session, /(?:Max-Age|Expires)=/i);
    assert.ok(setCookies.some((value) => value.startsWith("dispatch_session=;") && value.includes("Max-Age=0")));

    const cookie = session.split(";")[0];
    for (const page of ["/admin-login", "/login"]) {
      const active = await fetch(`${base}${page}`, { headers: { Cookie: cookie }, redirect: "manual" });
      assert.equal(active.status, 302, `${page} should retain the active session`);
      const reopened = await fetch(`${base}${page}`, { redirect: "manual" });
      assert.equal(reopened.status, 200, `${page} should require login without the session cookie`);
      const oldCookie = await fetch(`${base}${page}`, { headers: { Cookie: "dispatch_session=old-token" }, redirect: "manual" });
      assert.equal(oldCookie.status, 200, `${page} should reject the old persistent cookie`);
    }
    assert.equal((await fetch(`${base}/api/auth/me`, { headers: { Cookie: cookie } })).status, 200);
    assert.equal((await fetch(`${base}/api/auth/me`)).status, 401);

    const logout = await fetch(`${base}/api/auth/logout`, { method: "POST", headers: { Cookie: cookie } });
    assert.equal(logout.status, 200);
    assert.equal((await fetch(`${base}/api/auth/me`, { headers: { Cookie: cookie } })).status, 401);
    assert.equal(logout.headers.getSetCookie().length, 2);
  } finally {
    if (child.exitCode === null) {
      const exited = once(child, "exit");
      child.kill();
      await exited;
    }
    const resolved = fs.realpathSync(dataDir);
    assert.equal(path.dirname(resolved), fs.realpathSync(os.tmpdir()));
    assert.match(path.basename(resolved), /^dispatch-auth-test-/);
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});
