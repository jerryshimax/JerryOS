/**
 * Standalone OAuth2 authentication flow for Google Tasks.
 * Run: npm run auth
 *
 * Opens browser for Google sign-in, captures the auth code via local redirect,
 * and saves tokens to ~/.config/mcp-google-tasks/tokens.json
 */

import { google } from "googleapis";
import http from "node:http";
import open from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const SCOPES = ["https://www.googleapis.com/auth/tasks"];
const TOKEN_DIR = path.join(
  process.env.HOME || process.env.USERPROFILE || ".",
  ".config",
  "mcp-google-tasks"
);
const TOKEN_PATH = path.join(TOKEN_DIR, "tokens.json");
const REDIRECT_PORT = 9876;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/oauth2callback`;

function getCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error(
      "Error: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables are required.\n\n" +
        "Set them before running:\n" +
        "  export GOOGLE_CLIENT_ID=your_client_id\n" +
        "  export GOOGLE_CLIENT_SECRET=your_client_secret\n" +
        "  npm run auth"
    );
    process.exit(1);
  }

  return { clientId, clientSecret };
}

async function authenticate(): Promise<void> {
  const { clientId, clientSecret } = getCredentials();

  const oauth2Client = new google.auth.OAuth2(
    clientId,
    clientSecret,
    REDIRECT_URI
  );

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
  });

  console.log("Opening browser for Google authentication...\n");
  console.log("If the browser doesn't open, visit this URL:\n");
  console.log(authUrl + "\n");

  // Open browser
  const cmd =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "start"
        : "xdg-open";
  open.exec(`${cmd} "${authUrl}"`);

  // Start local server to capture redirect
  const code = await new Promise<string>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url || "", `http://localhost:${REDIRECT_PORT}`);
      const code = url.searchParams.get("code");
      const error = url.searchParams.get("error");

      if (error) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end(`<h1>Authentication failed</h1><p>${error}</p>`);
        reject(new Error(error));
        server.close();
        return;
      }

      if (code) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(
          "<h1>Authentication successful!</h1><p>You can close this tab and return to the terminal.</p>"
        );
        resolve(code);
        server.close();
        return;
      }

      res.writeHead(404);
      res.end();
    });

    server.listen(REDIRECT_PORT, () => {
      console.log(
        `Waiting for authentication on port ${REDIRECT_PORT}...\n`
      );
    });

    // Timeout after 2 minutes
    setTimeout(() => {
      server.close();
      reject(new Error("Authentication timed out after 2 minutes"));
    }, 120_000);
  });

  // Exchange code for tokens
  const { tokens } = await oauth2Client.getToken(code);

  // Save tokens
  fs.mkdirSync(TOKEN_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2), { mode: 0o600 });

  console.log("Authentication successful! Tokens saved to:", TOKEN_PATH);
}

authenticate().catch((err) => {
  console.error("Authentication failed:", err.message);
  process.exit(1);
});
