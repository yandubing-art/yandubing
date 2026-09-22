import http from "node:http";
import crypto from "node:crypto";
import { execFile } from "node:child_process";

const clientId = process.env.GMAIL_OAUTH_CLIENT_ID?.trim();
const clientSecret = process.env.GMAIL_OAUTH_CLIENT_SECRET || "";
const email = process.env.TRACKER_REPORT_EMAIL_USER?.trim() || "Valuecoreport@gmail.com";
const redirectUri = "http://127.0.0.1:8787/oauth2callback";
const scope = "https://mail.google.com/";

if (!clientId || !clientSecret) {
  console.error("Set GMAIL_OAUTH_CLIENT_ID and GMAIL_OAUTH_CLIENT_SECRET before running this script.");
  process.exit(1);
}

const state = crypto.randomBytes(24).toString("hex");
const authorizationUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
authorizationUrl.search = new URLSearchParams({
  client_id: clientId,
  redirect_uri: redirectUri,
  response_type: "code",
  scope,
  access_type: "offline",
  prompt: "consent",
  login_hint: email,
  state
}).toString();

const server = http.createServer(async (request, response) => {
  try {
    const callback = new URL(request.url || "/", redirectUri);
    if (callback.pathname !== "/oauth2callback") {
      response.writeHead(404).end("Not found");
      return;
    }
    if (callback.searchParams.get("state") !== state) throw new Error("OAuth state validation failed");
    const error = callback.searchParams.get("error");
    if (error) throw new Error(`Google authorization failed: ${error}`);
    const code = callback.searchParams.get("code");
    if (!code) throw new Error("Google authorization did not return a code");

    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code"
      })
    });
    const payload = await tokenResponse.json();
    if (!tokenResponse.ok || typeof payload.refresh_token !== "string") {
      throw new Error(`Google token exchange failed: ${payload.error_description || payload.error || tokenResponse.statusText}`);
    }
    response.writeHead(200, { "content-type": "text/plain; charset=utf-8" }).end("授权成功，可以关闭此页面。\n");
    console.log("GMAIL_OAUTH_REFRESH_TOKEN=" + payload.refresh_token);
    console.log("Copy this refresh token to the server environment only. Do not commit it to Git.");
    setTimeout(() => server.close(() => process.exit(0)), 250);
  } catch (error) {
    response.writeHead(400, { "content-type": "text/plain; charset=utf-8" }).end(String(error));
    console.error(error instanceof Error ? error.message : String(error));
    setTimeout(() => server.close(() => process.exit(1)), 250);
  }
});

server.listen(8787, "127.0.0.1", () => {
  console.log("Open this URL to authorize Gmail:");
  console.log(authorizationUrl.toString());
  if (process.platform === "win32") execFile("explorer.exe", [authorizationUrl.toString()]);
});
