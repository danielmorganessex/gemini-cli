/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { OAuth2Client, Credentials } from 'google-auth-library';
import * as http from 'http';
import url from 'url';
import crypto from 'crypto';
import * as net from 'net';
import open from 'open';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import * as os from 'os';

//  OAuth Client ID used to initiate OAuth2Client class.
const OAUTH_CLIENT_ID =
  '681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com';

// OAuth Secret value used to initiate OAuth2Client class.
// Note: It's ok to save this in git because this is an installed application
// as described here: https://developers.google.com/identity/protocols/oauth2#installed
// "The process results in a client ID and, in some cases, a client secret,
// which you embed in the source code of your application. (In this context,
// the client secret is obviously not treated as a secret.)"
const OAUTH_CLIENT_SECRET = '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';

// OAuth Scopes for Cloud Code authorization.
const OAUTH_SCOPE = [
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
];

const HTTP_REDIRECT = 301;
const SIGN_IN_SUCCESS_URL =
  'https://developers.google.com/gemini-code-assist/auth_success_gemini';
const SIGN_IN_FAILURE_URL =
  'https://developers.google.com/gemini-code-assist/auth_failure_gemini';

const GEMINI_DIR = '.gemini';
const CREDENTIAL_FILENAME_PREFIX = 'oauth_creds_';
const MAX_ACCOUNTS = 5; // Maximum number of accounts to support

let currentAccountIndex = 0;

/**
 * An Authentication URL for updating the credentials of a Oauth2Client
 * as well as a promise that will resolve when the credentials have
 * been refreshed (or which throws error when refreshing credentials failed).
 */
export interface OauthWebLogin {
  authUrl: string;
  loginCompletePromise: Promise<void>;
}

export async function getOauthClient(): Promise<OAuth2Client> {
  for (let i = 0; i < MAX_ACCOUNTS; i++) {
    const client = new OAuth2Client({
      clientId: OAUTH_CLIENT_ID,
      clientSecret: OAUTH_CLIENT_SECRET,
    });
    try {
      if (await loadCachedCredentials(client, currentAccountIndex)) {
        // Found valid cached credentials.
        return client;
      }
    } catch (error) {
      // Ignore error and try next account
    }
    currentAccountIndex = (currentAccountIndex + 1) % MAX_ACCOUNTS;
  }

  // If no cached credentials found for any account, try to authenticate a new one
  currentAccountIndex = 0; // Reset to the first account for new login
  let client = new OAuth2Client({
    clientId: OAUTH_CLIENT_ID,
    clientSecret: OAUTH_CLIENT_SECRET,
  });

  // Attempt to load credentials for the currentAccountIndex one last time
  // in case a new account was added manually or by another process.
  if (await loadCachedCredentials(client, currentAccountIndex)) {
    return client;
  }


  // If still no valid credentials, initiate web login for the current account index
  const webLogin = await authWithWeb(client, currentAccountIndex);

  console.log(
    `\n\nCode Assist login required for account ${currentAccountIndex + 1}.\n` +
      `Attempting to open authentication page in your browser.\n` +
      `Otherwise navigate to:\n\n${webLogin.authUrl}\n\n`,
  );
  await open(webLogin.authUrl);
  console.log('Waiting for authentication...');

  try {
    await webLogin.loginCompletePromise;
  } catch (error) {
    console.error(`Authentication failed for account ${currentAccountIndex + 1}:`, error);
    // Attempt to cycle to the next account if authentication fails
    currentAccountIndex = (currentAccountIndex + 1) % MAX_ACCOUNTS;
    // We need to re-throw or handle this more gracefully, possibly by prompting the user
    // or trying the next available slot if the current one fails authentication.
    // For now, re-throwing to indicate failure.
    throw error;
  }

  return client;
}

async function authWithWeb(client: OAuth2Client, accountIndex: number): Promise<OauthWebLogin> {
  const port = await getAvailablePort();
  const redirectUri = `http://localhost:${port}/oauth2callback`;
  const state = crypto.randomBytes(32).toString('hex');
  const authUrl: string = client.generateAuthUrl({
    redirect_uri: redirectUri,
    access_type: 'offline',
    scope: OAUTH_SCOPE,
    state,
  });

  const loginCompletePromise = new Promise<void>((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        if (req.url!.indexOf('/oauth2callback') === -1) {
          res.writeHead(HTTP_REDIRECT, { Location: SIGN_IN_FAILURE_URL });
          res.end();
          reject(new Error('Unexpected request: ' + req.url));
          return;
        }
        // acquire the code from the querystring, and close the web server.
        const qs = new url.URL(req.url!, 'http://localhost:3000').searchParams;
        if (qs.get('error')) {
          res.writeHead(HTTP_REDIRECT, { Location: SIGN_IN_FAILURE_URL });
          res.end();
          reject(new Error(`Error during authentication: ${qs.get('error')}`));
          return;
        } else if (qs.get('state') !== state) {
          res.end('State mismatch. Possible CSRF attack');
          reject(new Error('State mismatch. Possible CSRF attack'));
          return;
        } else if (qs.get('code')) {
          const { tokens } = await client.getToken({
            code: qs.get('code')!,
            redirect_uri: redirectUri,
          });
          client.setCredentials(tokens);
          await cacheCredentials(client.credentials, accountIndex);

          res.writeHead(HTTP_REDIRECT, { Location: SIGN_IN_SUCCESS_URL });
          res.end();
          resolve();
        } else {
          reject(new Error('No code found in request'));
        }
      } catch (e) {
        reject(e);
      } finally {
        server.close();
      }
    });
    server.listen(port);
  });

  return {
    authUrl,
    loginCompletePromise,
  };
}

export function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    let port = 0;
    try {
      const server = net.createServer();
      server.listen(0, () => {
        const address = server.address()! as net.AddressInfo;
        port = address.port;
      });
      server.on('listening', () => {
        server.close();
        server.unref();
      });
      server.on('error', (e) => reject(e));
      server.on('close', () => resolve(port));
    } catch (e) {
      reject(e);
    }
  });
}

async function loadCachedCredentials(client: OAuth2Client, accountIndex: number): Promise<boolean> {
  try {
    const keyFile =
      process.env.GOOGLE_APPLICATION_CREDENTIALS || getCachedCredentialPath(accountIndex);

    const creds = await fs.readFile(keyFile, 'utf-8');
    client.setCredentials(JSON.parse(creds));

    // This will verify locally that the credentials look good.
    const { token } = await client.getAccessToken();
    if (!token) {
      return false;
    }

    // This will check with the server to see if it hasn't been revoked.
    await client.getTokenInfo(token);

    return true;
  } catch (error) {
    // If specific errors indicate rate limiting or other recoverable issues,
    // we could return a specific value or throw a custom error to trigger cycling.
    // For now, any error during load/validation means we treat credentials as invalid.
    if (error.message.includes('invalid_grant') || error.message.includes('revoked')) {
        // Credentials might be stale or revoked, try to remove them
        await clearCachedCredentialFile(accountIndex);
    }
    // console.debug(`Failed to load cached credentials for account ${accountIndex}:`, error.message);
    return false;
  }
}

async function cacheCredentials(credentials: Credentials, accountIndex: number) {
  const filePath = getCachedCredentialPath(accountIndex);
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  const credString = JSON.stringify(credentials, null, 2);
  await fs.writeFile(filePath, credString);
}

function getCachedCredentialPath(accountIndex: number): string {
  return path.join(os.homedir(), GEMINI_DIR, `${CREDENTIAL_FILENAME_PREFIX}${accountIndex}.json`);
}

export async function clearCachedCredentialFile(accountIndex?: number) {
  try {
    if (accountIndex === undefined) {
        // Clear all account credentials if no index is specified
        for (let i = 0; i < MAX_ACCOUNTS; i++) {
            try {
                await fs.rm(getCachedCredentialPath(i));
            } catch (e) {
                // Ignore if a specific file doesn't exist
            }
        }
    } else {
        await fs.rm(getCachedCredentialPath(accountIndex));
    }
  } catch (_) {
    /* empty */
  }
}

export function getCurrentAccountIndex(): number {
    return currentAccountIndex;
}

export function switchToNextAccount(): void {
    currentAccountIndex = (currentAccountIndex + 1) % MAX_ACCOUNTS;
    // Potentially, we might want to trigger a re-authentication or client refresh here
    // For now, just updating the index. The next call to getOauthClient will use it.
}
