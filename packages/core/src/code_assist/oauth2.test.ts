/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getOauthClient, getCurrentAccountIndex, switchToNextAccount, clearCachedCredentialFile, MAX_ACCOUNTS } from './oauth2.js';
import { OAuth2Client, Credentials } from 'google-auth-library';
import * as fs from 'fs';
import * as path from 'path';
import http from 'http';
import open from 'open';
import crypto from 'crypto';
import * as os from 'os';

vi.mock('os', async (importOriginal) => {
  const originalOs = await importOriginal<typeof import('os')>();
  return {
    ...originalOs,
    homedir: vi.fn(),
    tmpdir: originalOs.tmpdir, // Ensure tmpdir is not mocked if mkdtempSync needs it
  };
});

vi.mock('google-auth-library');
vi.mock('http');
vi.mock('open');
vi.mock('crypto');

// Mock fs module selectively
vi.mock('fs', async () => {
  const actualFs = await vi.importActual<typeof fs>('fs');
  return {
    ...actualFs, // Use actual implementations for non-mocked functions like mkdtempSync
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    rmSync: vi.fn(),
    mkdirSync: vi.fn(),
    // Ensure promises version is also available if used by SUT, though not directly in these tests
    promises: {
        ...actualFs.promises,
        readFile: vi.fn(),
        writeFile: vi.fn(),
        rm: vi.fn(),
        mkdir: vi.fn(),
    }
  };
});


describe('oauth2', () => {
  let tempHomeDir: string;

  // Helper function to reset and get current account index to 0
  const resetCurrentAccountIndex = () => {
    let currentIndex = getCurrentAccountIndex();
    while (currentIndex !== 0) {
      switchToNextAccount();
      currentIndex = getCurrentAccountIndex();
    }
  };

  beforeEach(() => {
    // Create a temporary home directory for each test
    // Use actual fs.mkdtempSync for this setup
    tempHomeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-cli-test-home-'));
    vi.mocked(os.homedir).mockReturnValue(tempHomeDir);
    resetCurrentAccountIndex();

    vi.mocked(OAuth2Client).mockClear();
    vi.mocked(open).mockClear();
    vi.mocked(http.createServer).mockClear();
    vi.mocked(fs.readFileSync).mockClear();
    vi.mocked(fs.writeFileSync).mockClear();
    vi.mocked(fs.rmSync).mockClear();
    vi.mocked(fs.mkdirSync).mockClear().mockImplementation(() => undefined); // Default mock for mkdirSync

    // Default crypto mock
    vi.spyOn(crypto, 'randomBytes').mockReturnValue('default-test-state' as never);
  });

  afterEach(() => {
    // Clean up the temporary home directory
    // Use actual fs.rmSync for this cleanup
    fs.rmSync(tempHomeDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  const mockClientInstanceFactory = (config: {
      getAccessTokenResolve?: { token: string },
      getTokenInfoResolve?: any,
      getTokenInfoReject?: Error,
      generateAuthUrlReturnValue?: string,
      getTokenResolve?: { tokens: Credentials },
  } = {}) => {
      return {
          generateAuthUrl: vi.fn().mockReturnValue(config.generateAuthUrlReturnValue || 'http://default.auth.url'),
          getToken: config.getTokenResolve ? vi.fn().mockResolvedValue(config.getTokenResolve) : vi.fn().mockRejectedValue(new Error('getToken not mocked for this instance')),
          setCredentials: vi.fn(),
          getAccessToken: vi.fn().mockResolvedValue(config.getAccessTokenResolve || { token: 'default-fake-access-token' }),
          getTokenInfo: config.getTokenInfoReject ? vi.fn().mockRejectedValue(config.getTokenInfoReject) : vi.fn().mockResolvedValue(config.getTokenInfoResolve || {}),
          credentials: {},
      } as unknown as OAuth2Client;
  };

  const setupHttpServerForWebLogin = (port = 12345) => {
    let requestCallback!: http.RequestListener;
    let serverListeningCallback: (value: unknown) => void;
    const serverListeningPromise = new Promise((resolve) => (serverListeningCallback = resolve));

    const mockHttpServer = {
        listen: vi.fn((p: number, cb?: () => void) => {
            if (cb) cb();
            serverListeningCallback(undefined);
        }),
        close: vi.fn((cb?: () => void) => { if (cb) cb(); }),
        on: vi.fn(),
        address: () => ({ port }),
    };
    vi.mocked(http.createServer).mockImplementation((cb) => {
        requestCallback = cb as http.RequestListener;
        return mockHttpServer as unknown as http.Server;
    });
    return { serverListeningPromise, getRequestListener: () => requestCallback, getPort: () => port };
  };


  describe('Web Login and Single Account Scenarios', () => {
    it('should perform a web login when no cached credentials exist for the first account', async () => {
      resetCurrentAccountIndex();
      const accountIndex = 0;
      const credPath = path.join(tempHomeDir, '.gemini', `oauth_creds_${accountIndex}.json`);

      vi.mocked(fs.readFileSync).mockImplementation(() => { const err = new Error('ENOENT') as NodeJS.ErrnoException; err.code='ENOENT'; throw err; });
      vi.mocked(fs.writeFileSync).mockImplementation(() => {});

      const mockAuthUrl = 'https://example.com/auth';
      const mockCode = 'test-code-account0';
      const mockState = 'test-state-account0';
      const mockTokens = { access_token: 'test-access-token-account0', refresh_token: 'test-refresh-token-account0' } as Credentials;

      const currentTestClientInstance = mockClientInstanceFactory({
        generateAuthUrlReturnValue: mockAuthUrl,
        getTokenResolve: { tokens: mockTokens }
      });
      vi.mocked(OAuth2Client).mockImplementation(() => currentTestClientInstance);
      vi.spyOn(crypto, 'randomBytes').mockReturnValue(mockState as never);
      vi.mocked(open).mockResolvedValue({} as any);

      const { serverListeningPromise, getRequestListener, getPort } = setupHttpServerForWebLogin();

      const clientPromise = getOauthClient();
      await serverListeningPromise;

      const mockReq = { url: `/oauth2callback?code=${mockCode}&state=${mockState}` } as http.IncomingMessage;
      const mockRes = { writeHead: vi.fn(), end: vi.fn() } as unknown as http.ServerResponse;
      await getRequestListener()(mockReq, mockRes);

      const client = await clientPromise;
      expect(client).toBe(currentTestClientInstance);
      expect(open).toHaveBeenCalledWith(mockAuthUrl);
      expect(currentTestClientInstance.getToken).toHaveBeenCalledWith({
        code: mockCode,
        redirect_uri: `http://localhost:${getPort()}/oauth2callback`,
      });
      expect(currentTestClientInstance.setCredentials).toHaveBeenCalledWith(mockTokens);
      expect(fs.writeFileSync).toHaveBeenCalledWith(credPath, JSON.stringify(mockTokens, null, 2));
    });
  });

  describe('Multiple Account Cycling', () => {
    it('should use cached credentials for the current (first) account if valid', async () => {
      resetCurrentAccountIndex();
      const accountIndex = 0;
      const credPath = path.join(tempHomeDir, '.gemini', `oauth_creds_${accountIndex}.json`);
      const mockCreds = { refresh_token: `cached_token_${accountIndex}` } as Credentials;

      vi.mocked(fs.readFileSync).mockImplementation((p) => {
        if (p === credPath) return JSON.stringify(mockCreds);
        const err = new Error('File not found') as NodeJS.ErrnoException; err.code = 'ENOENT'; throw err;
      });

      const clientInstance = mockClientInstanceFactory({ getTokenInfoResolve: {} });
      vi.mocked(OAuth2Client).mockImplementationOnce(() => clientInstance);

      const client = await getOauthClient();

      expect(fs.readFileSync).toHaveBeenCalledWith(credPath, 'utf-8');
      expect(clientInstance.setCredentials).toHaveBeenCalledWith(mockCreds);
      expect(clientInstance.getTokenInfo).toHaveBeenCalledWith(expect.any(String));
      expect(client).toBe(clientInstance);
      expect(open).not.toHaveBeenCalled();
      expect(getCurrentAccountIndex()).toBe(accountIndex);
    });

    it('should cycle to the next account if first account cached credentials fail, then use second account valid cached credentials', async () => {
      resetCurrentAccountIndex();
      const firstAccountIndex = 0;
      const secondAccountIndex = 1;
      const firstCredPath = path.join(tempHomeDir, '.gemini', `oauth_creds_${firstAccountIndex}.json`);
      const secondCredPath = path.join(tempHomeDir, '.gemini', `oauth_creds_${secondAccountIndex}.json`);
      const secondMockCreds = { refresh_token: `cached_token_${secondAccountIndex}` } as Credentials;

      vi.mocked(fs.readFileSync).mockImplementation((p) => {
        if (p === firstCredPath) { const err = new Error('File not found for acc 0') as NodeJS.ErrnoException; err.code = 'ENOENT'; throw err; }
        if (p === secondCredPath) return JSON.stringify(secondMockCreds);
        const err = new Error(`Unexpected read: ${p}`) as NodeJS.ErrnoException; err.code = 'ENOENT'; throw err;
      });

      const firstClientInst = mockClientInstanceFactory({});
      const secondClientInst = mockClientInstanceFactory({ getTokenInfoResolve: {} });
      vi.mocked(OAuth2Client)
        .mockImplementationOnce(() => firstClientInst)
        .mockImplementationOnce(() => secondClientInst);

      const client = await getOauthClient();

      expect(fs.readFileSync).toHaveBeenCalledTimes(2);
      expect(fs.readFileSync).toHaveBeenNthCalledWith(1, firstCredPath, 'utf-8');
      expect(fs.readFileSync).toHaveBeenNthCalledWith(2, secondCredPath, 'utf-8');

      expect(secondClientInst.setCredentials).toHaveBeenCalledWith(secondMockCreds);
      expect(secondClientInst.getTokenInfo).toHaveBeenCalledWith(expect.any(String));
      expect(client).toBe(secondClientInst);
      expect(open).not.toHaveBeenCalled();
      expect(getCurrentAccountIndex()).toBe(secondAccountIndex);
    });

    it('should initiate web auth for the first account if all accounts fail to load cached credentials', async () => {
        resetCurrentAccountIndex();
        vi.mocked(fs.readFileSync).mockImplementation(() => { const err = new Error('ENOENT generic') as NodeJS.ErrnoException; err.code = 'ENOENT'; throw err; });
        vi.mocked(fs.writeFileSync).mockImplementation(() => {});

        const clientInstancesForLoadAttempts = Array(MAX_ACCOUNTS + 1).fill(0).map(() => mockClientInstanceFactory({getTokenInfoReject: new Error("load fail")}));
        const webAuthTokens = { refresh_token: 'web_authed_token_0' } as Credentials;
        const clientInstanceForWebAuth = mockClientInstanceFactory({
            generateAuthUrlReturnValue: 'http://webauth.url',
            getTokenResolve: { tokens: webAuthTokens }
        });

        vi.mocked(OAuth2Client).mockClear();
        clientInstancesForLoadAttempts.forEach(inst => vi.mocked(OAuth2Client).mockImplementationOnce(() => inst));
        vi.mocked(OAuth2Client).mockImplementationOnce(() => clientInstanceForWebAuth);

        vi.spyOn(crypto, 'randomBytes').mockReturnValue('web_auth_state' as never);
        vi.mocked(open).mockResolvedValue({} as any);
        const { serverListeningPromise, getRequestListener, getPort } = setupHttpServerForWebLogin();

        const clientPromise = getOauthClient();
        await serverListeningPromise;

        const mockReq = { url: `/oauth2callback?code=web_auth_code&state=web_auth_state` } as http.IncomingMessage;
        const mockRes = { writeHead: vi.fn(), end: vi.fn() } as unknown as http.ServerResponse;
        await getRequestListener()(mockReq, mockRes);
        const client = await clientPromise;

        expect(fs.readFileSync).toHaveBeenCalledTimes(MAX_ACCOUNTS + 1);
        expect(open).toHaveBeenCalledWith('http://webauth.url');
        expect(clientInstanceForWebAuth.getToken).toHaveBeenCalledWith({
            code: 'web_auth_code',
            redirect_uri: `http://localhost:${getPort()}/oauth2callback`,
        });
        const expectedCredPathForWebAuth = path.join(tempHomeDir, '.gemini', `oauth_creds_0.json`);
        expect(fs.writeFileSync).toHaveBeenCalledWith(expectedCredPathForWebAuth, JSON.stringify(webAuthTokens, null, 2));
        expect(client).toBe(clientInstanceForWebAuth);
        expect(getCurrentAccountIndex()).toBe(0);
    });

    it('should remove invalid credentials and attempt web auth if getTokenInfo fails for a cached credential', async () => {
        resetCurrentAccountIndex();
        const accountIndex = 0;
        const credPath = path.join(tempHomeDir, '.gemini', `oauth_creds_${accountIndex}.json`);
        const badCreds = { refresh_token: 'bad_cached_token' } as Credentials;

        vi.mocked(fs.readFileSync)
            .mockImplementationOnce((p) => {
                if (p === credPath) return JSON.stringify(badCreds);
                const err = new Error('ENOENT initial') as NodeJS.ErrnoException; err.code = 'ENOENT'; throw err;
            })
            .mockImplementationOnce((p) => {
                 if (p === credPath) { const err = new Error('ENOENT after del') as NodeJS.ErrnoException; err.code = 'ENOENT'; throw err; }
                 const err = new Error('ENOENT other') as NodeJS.ErrnoException; err.code = 'ENOENT'; throw err;
            });
        vi.mocked(fs.rmSync).mockImplementation(() => {});
        vi.mocked(fs.writeFileSync).mockImplementation(() => {});

        const clientInstFailsTokenInfo = mockClientInstanceFactory({ getTokenInfoReject: new Error('invalid_grant')});
        const webAuthTokens = { refresh_token: 'new_web_token' } as Credentials;
        const clientInstForWebAuth = mockClientInstanceFactory({
            generateAuthUrlReturnValue: 'http://webauth.url/for-invalid-grant-case',
            getTokenResolve: { tokens: webAuthTokens }
        });

        vi.mocked(OAuth2Client)
            .mockImplementationOnce(() => clientInstFailsTokenInfo)
            .mockImplementationOnce(() => mockClientInstanceFactory({getTokenInfoReject: new Error("load fail after delete")}))
            .mockImplementationOnce(() => clientInstForWebAuth);

        vi.spyOn(crypto, 'randomBytes').mockReturnValue('state_for_invalid_grant' as never);
        vi.mocked(open).mockResolvedValue({} as any);
        const { serverListeningPromise, getRequestListener, getPort } = setupHttpServerForWebLogin();

        const clientPromise = getOauthClient();
        await serverListeningPromise;

        const mockReq = { url: `/oauth2callback?code=code_after_invalid&state=state_for_invalid_grant` } as http.IncomingMessage;
        const mockRes = { writeHead: vi.fn(), end: vi.fn() } as unknown as http.ServerResponse;
        await getRequestListener()(mockReq, mockRes);
        await clientPromise;

        expect(fs.readFileSync).toHaveBeenCalledWith(credPath, 'utf-8');
        expect(clientInstFailsTokenInfo.setCredentials).toHaveBeenCalledWith(badCreds);
        expect(clientInstFailsTokenInfo.getTokenInfo).toHaveBeenCalledWith(expect.any(String));
        expect(fs.rmSync).toHaveBeenCalledWith(credPath);
        expect(open).toHaveBeenCalledWith('http://webauth.url/for-invalid-grant-case');
        expect(clientInstForWebAuth.getToken).toHaveBeenCalled();
        expect(fs.writeFileSync).toHaveBeenCalledWith(credPath, JSON.stringify(webAuthTokens, null, 2));
        expect(getCurrentAccountIndex()).toBe(accountIndex);
    });
  });

  describe('switchToNextAccount', () => {
    it('should cycle through account indices from 0 to MAX_ACCOUNTS-1 and back to 0', () => {
      resetCurrentAccountIndex();
      expect(getCurrentAccountIndex()).toBe(0);
      for (let i = 1; i < MAX_ACCOUNTS; i++) {
        switchToNextAccount();
        expect(getCurrentAccountIndex()).toBe(i);
      }
      switchToNextAccount();
      expect(getCurrentAccountIndex()).toBe(0);
    });
  });

  describe('clearCachedCredentialFile', () => {
    beforeEach(() => {
        vi.mocked(fs.rmSync).mockImplementation(() => {});
    });

    it('should attempt to remove the credential file for the specified account index', async () => {
      await clearCachedCredentialFile(1);
      const expectedPath = path.join(tempHomeDir, '.gemini', `oauth_creds_1.json`);
      expect(fs.rmSync).toHaveBeenCalledWith(expectedPath);
    });

    it('should attempt to remove all credential files if no index is specified', async () => {
      await clearCachedCredentialFile();
      expect(fs.rmSync).toHaveBeenCalledTimes(MAX_ACCOUNTS);
      for (let i = 0; i < MAX_ACCOUNTS; i++) {
        const expectedPath = path.join(tempHomeDir, '.gemini', `oauth_creds_${i}.json`);
        expect(fs.rmSync).toHaveBeenCalledWith(expectedPath);
      }
    });

    it('should not throw if removing a specific file fails (e.g., file not found)', async () => {
      vi.mocked(fs.rmSync).mockImplementation((p) => {
        if (p.toString().includes('oauth_creds_0.json')) {
          const error = new Error('File not found') as NodeJS.ErrnoException;
          error.code = 'ENOENT';
          throw error;
        }
      });
      await expect(clearCachedCredentialFile()).resolves.toBeUndefined();
      expect(fs.rmSync).toHaveBeenCalledTimes(MAX_ACCOUNTS);
    });
  });
});
