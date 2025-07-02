/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Config, ConfigParameters, SandboxConfig } from './config.js';
import * as path from 'path';
import { setGeminiMdFilename as mockSetGeminiMdFilename } from '../tools/memoryTool.js';
import {
  DEFAULT_TELEMETRY_TARGET,
  DEFAULT_OTLP_ENDPOINT,
} from '../telemetry/index.js';

// Mock dependencies that might be called during Config construction or createServerConfig
vi.mock('../tools/tool-registry', () => {
  const ToolRegistryMock = vi.fn();
  ToolRegistryMock.prototype.registerTool = vi.fn();
  ToolRegistryMock.prototype.discoverTools = vi.fn();
  ToolRegistryMock.prototype.getAllTools = vi.fn(() => []); // Mock methods if needed
  ToolRegistryMock.prototype.getTool = vi.fn();
  ToolRegistryMock.prototype.getFunctionDeclarations = vi.fn(() => []);
  return { ToolRegistry: ToolRegistryMock };
});

// Mock individual tools if their constructors are complex or have side effects
vi.mock('../tools/ls');
vi.mock('../tools/read-file');
vi.mock('../tools/grep');
vi.mock('../tools/glob');
vi.mock('../tools/edit');
vi.mock('../tools/shell');
vi.mock('../tools/write-file');
vi.mock('../tools/web-fetch');
vi.mock('../tools/read-many-files');
vi.mock('../tools/memoryTool', () => ({
  MemoryTool: vi.fn(),
  setGeminiMdFilename: vi.fn(),
  getCurrentGeminiMdFilename: vi.fn(() => 'GEMINI.md'), // Mock the original filename
  DEFAULT_CONTEXT_FILENAME: 'GEMINI.md',
  GEMINI_CONFIG_DIR: '.gemini',
}));

vi.mock('../core/contentGenerator.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../core/contentGenerator.js')>();
  return {
    ...actual,
    createContentGeneratorConfig: vi.fn(),
  };
});

vi.mock('../core/client.js', () => ({
  GeminiClient: vi.fn().mockImplementation(() => ({
    // Mock any methods on GeminiClient that might be used.
  })),
}));

vi.mock('../telemetry/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../telemetry/index.js')>();
  return {
    ...actual,
    initializeTelemetry: vi.fn(),
  };
});

describe('Server Config (config.ts)', () => {
  const MODEL = 'gemini-pro';
  const SANDBOX: SandboxConfig = {
    command: 'docker',
    image: 'gemini-cli-sandbox',
  };
  const TARGET_DIR = '/path/to/target';
  const DEBUG_MODE = false;
  const QUESTION = 'test question';
  const FULL_CONTEXT = false;
  const USER_MEMORY = 'Test User Memory';
  const TELEMETRY_SETTINGS = { enabled: false };
  const EMBEDDING_MODEL = 'gemini-embedding';
  const SESSION_ID = 'test-session-id';
  const baseParams: ConfigParameters = {
    cwd: '/tmp',
    embeddingModel: EMBEDDING_MODEL,
    sandbox: SANDBOX,
    targetDir: TARGET_DIR,
    debugMode: DEBUG_MODE,
    question: QUESTION,
    fullContext: FULL_CONTEXT,
    userMemory: USER_MEMORY,
    telemetry: TELEMETRY_SETTINGS,
    sessionId: SESSION_ID,
    model: MODEL,
  };

  beforeEach(() => {
    // Reset mocks if necessary
    vi.clearAllMocks();
  });

  // i can't get vi mocking to import in core. only in cli. can't fix it now.
  // describe('refreshAuth', () => {
  //   it('should refresh auth and update config', async () => {
  //     const config = new Config(baseParams);
  //     const newModel = 'gemini-ultra';
  //     const authType = AuthType.USE_GEMINI;
  //     const mockContentConfig = {
  //       model: newModel,
  //       apiKey: 'test-key',
  //     };

  //     (createContentGeneratorConfig as vi.Mock).mockResolvedValue(
  //       mockContentConfig,
  //     );

  //     await config.refreshAuth(authType);

  //     expect(createContentGeneratorConfig).toHaveBeenCalledWith(
  //       newModel,
  //       authType,
  //     );
  //     expect(config.getContentGeneratorConfig()).toEqual(mockContentConfig);
  //     expect(GeminiClient).toHaveBeenCalledWith(config);
  //   });
  // });

  it('Config constructor should store userMemory correctly', () => {
    const config = new Config(baseParams);

    expect(config.getUserMemory()).toBe(USER_MEMORY);
    // Verify other getters if needed
    expect(config.getTargetDir()).toBe(path.resolve(TARGET_DIR)); // Check resolved path
  });

  it('Config constructor should default userMemory to empty string if not provided', () => {
    const paramsWithoutMemory: ConfigParameters = { ...baseParams };
    delete paramsWithoutMemory.userMemory;
    const config = new Config(paramsWithoutMemory);

    expect(config.getUserMemory()).toBe('');
  });

  it('Config constructor should call setGeminiMdFilename with contextFileName if provided', () => {
    const contextFileName = 'CUSTOM_AGENTS.md';
    const paramsWithContextFile: ConfigParameters = {
      ...baseParams,
      contextFileName,
    };
    new Config(paramsWithContextFile);
    expect(mockSetGeminiMdFilename).toHaveBeenCalledWith(contextFileName);
  });

  it('Config constructor should not call setGeminiMdFilename if contextFileName is not provided', () => {
    new Config(baseParams); // baseParams does not have contextFileName
    expect(mockSetGeminiMdFilename).not.toHaveBeenCalled();
  });

  it('should set default file filtering settings when not provided', () => {
    const config = new Config(baseParams);
    expect(config.getFileFilteringRespectGitIgnore()).toBe(true);
  });

  it('should set custom file filtering settings when provided', () => {
    const paramsWithFileFiltering: ConfigParameters = {
      ...baseParams,
      fileFiltering: {
        respectGitIgnore: false,
      },
    };
    const config = new Config(paramsWithFileFiltering);
    expect(config.getFileFilteringRespectGitIgnore()).toBe(false);
  });

  it('Config constructor should set telemetry to true when provided as true', () => {
    const paramsWithTelemetry: ConfigParameters = {
      ...baseParams,
      telemetry: { enabled: true },
    };
    const config = new Config(paramsWithTelemetry);
    expect(config.getTelemetryEnabled()).toBe(true);
  });

  it('Config constructor should set telemetry to false when provided as false', () => {
    const paramsWithTelemetry: ConfigParameters = {
      ...baseParams,
      telemetry: { enabled: false },
    };
    const config = new Config(paramsWithTelemetry);
    expect(config.getTelemetryEnabled()).toBe(false);
  });

  it('Config constructor should default telemetry to default value if not provided', () => {
    const paramsWithoutTelemetry: ConfigParameters = { ...baseParams };
    delete paramsWithoutTelemetry.telemetry;
    const config = new Config(paramsWithoutTelemetry);
    expect(config.getTelemetryEnabled()).toBe(TELEMETRY_SETTINGS.enabled);
  });

  it('should have a getFileService method that returns FileDiscoveryService', () => {
    const config = new Config(baseParams);
    const fileService = config.getFileService();
    expect(fileService).toBeDefined();
  });

  describe('Telemetry Settings', () => {
    it('should return default telemetry target if not provided', () => {
      const params: ConfigParameters = {
        ...baseParams,
        telemetry: { enabled: true },
      };
      const config = new Config(params);
      expect(config.getTelemetryTarget()).toBe(DEFAULT_TELEMETRY_TARGET);
    });

    it('should return provided OTLP endpoint', () => {
      const endpoint = 'http://custom.otel.collector:4317';
      const params: ConfigParameters = {
        ...baseParams,
        telemetry: { enabled: true, otlpEndpoint: endpoint },
      };
      const config = new Config(params);
      expect(config.getTelemetryOtlpEndpoint()).toBe(endpoint);
    });

    it('should return default OTLP endpoint if not provided', () => {
      const params: ConfigParameters = {
        ...baseParams,
        telemetry: { enabled: true },
      };
      const config = new Config(params);
      expect(config.getTelemetryOtlpEndpoint()).toBe(DEFAULT_OTLP_ENDPOINT);
    });

    it('should return provided logPrompts setting', () => {
      const params: ConfigParameters = {
        ...baseParams,
        telemetry: { enabled: true, logPrompts: false },
      };
      const config = new Config(params);
      expect(config.getTelemetryLogPromptsEnabled()).toBe(false);
    });

    it('should return default logPrompts setting (true) if not provided', () => {
      const params: ConfigParameters = {
        ...baseParams,
        telemetry: { enabled: true },
      };
      const config = new Config(params);
      expect(config.getTelemetryLogPromptsEnabled()).toBe(true);
    });

    it('should return default logPrompts setting (true) if telemetry object is not provided', () => {
      const paramsWithoutTelemetry: ConfigParameters = { ...baseParams };
      delete paramsWithoutTelemetry.telemetry;
      const config = new Config(paramsWithoutTelemetry);
      expect(config.getTelemetryLogPromptsEnabled()).toBe(true);
    });

    it('should return default telemetry target if telemetry object is not provided', () => {
      const paramsWithoutTelemetry: ConfigParameters = { ...baseParams };
      delete paramsWithoutTelemetry.telemetry;
      const config = new Config(paramsWithoutTelemetry);
      expect(config.getTelemetryTarget()).toBe(DEFAULT_TELEMETRY_TARGET);
    });

    it('should return default OTLP endpoint if telemetry object is not provided', () => {
      const paramsWithoutTelemetry: ConfigParameters = { ...baseParams };
      delete paramsWithoutTelemetry.telemetry;
      const config = new Config(paramsWithoutTelemetry);
      expect(config.getTelemetryOtlpEndpoint()).toBe(DEFAULT_OTLP_ENDPOINT);
    });
  });

  describe('API Key Management', () => {
    const baseParamsWithoutApiKeys: ConfigParameters = { ...baseParams };
    delete baseParamsWithoutApiKeys.geminiApiKeys;

    beforeEach(() => {
      // Clear any environment variables set by previous tests
      delete process.env.GEMINI_API_KEY;
      for (let i = 0; i < 100; i++) {
        delete process.env[`GEMINI_API_KEY_${i}`];
      }
    });

    it('should initialize with no API keys if none are provided', () => {
      const config = new Config(baseParamsWithoutApiKeys);
      expect(config.getCurrentGeminiApiKey()).toBeUndefined();
      expect(config.hasMultipleApiKeys()).toBe(false);
    });

    it('should load a single API key from GEMINI_API_KEY environment variable', () => {
      process.env.GEMINI_API_KEY = 'env_single_key';
      const config = new Config(baseParamsWithoutApiKeys);
      expect(config.getCurrentGeminiApiKey()).toBe('env_single_key');
      expect(config.hasMultipleApiKeys()).toBe(false);
    });

    it('should load API keys from GEMINI_API_KEY_N environment variables', () => {
      process.env.GEMINI_API_KEY_1 = 'env_key_1';
      process.env.GEMINI_API_KEY_2 = 'env_key_2';
      const config = new Config(baseParamsWithoutApiKeys);
      expect(config.getCurrentGeminiApiKey()).toBe('env_key_1');
      expect(config.hasMultipleApiKeys()).toBe(true);
      config.switchToNextGeminiApiKey();
      expect(config.getCurrentGeminiApiKey()).toBe('env_key_2');
    });

    it('should load API keys from params.geminiApiKeys array', () => {
      const paramsWithKeys: ConfigParameters = {
        ...baseParamsWithoutApiKeys,
        geminiApiKeys: ['param_key_1', 'param_key_2'],
      };
      const config = new Config(paramsWithKeys);
      expect(config.getCurrentGeminiApiKey()).toBe('param_key_1');
      expect(config.hasMultipleApiKeys()).toBe(true);
      config.switchToNextGeminiApiKey();
      expect(config.getCurrentGeminiApiKey()).toBe('param_key_2');
    });

    it('should prioritize params.geminiApiKeys over GEMINI_API_KEY env var if both provided', () => {
      process.env.GEMINI_API_KEY = 'env_single_key';
      const paramsWithKeys: ConfigParameters = {
        ...baseParamsWithoutApiKeys,
        geminiApiKeys: ['param_key_1'],
      };
      const config = new Config(paramsWithKeys);
      expect(config.getCurrentGeminiApiKey()).toBe('param_key_1');
    });

    it('should combine params.geminiApiKeys and GEMINI_API_KEY_N env vars, prioritizing params and avoiding duplicates', () => {
      process.env.GEMINI_API_KEY_1 = 'env_key_1'; // Will be loaded
      process.env.GEMINI_API_KEY_2 = 'param_key_1'; // Duplicate of a param key, should be ignored from env
      process.env.GEMINI_API_KEY_3 = 'env_key_3'; // Will be loaded
      const paramsWithKeys: ConfigParameters = {
        ...baseParamsWithoutApiKeys,
        geminiApiKeys: ['param_key_1', 'param_key_2'],
      };
      const config = new Config(paramsWithKeys);
      // Expected order: param_key_1, param_key_2, env_key_1, env_key_3
      expect(config.getCurrentGeminiApiKey()).toBe('param_key_1');
      config.switchToNextGeminiApiKey();
      expect(config.getCurrentGeminiApiKey()).toBe('param_key_2');
      config.switchToNextGeminiApiKey();
      expect(config.getCurrentGeminiApiKey()).toBe('env_key_1');
      config.switchToNextGeminiApiKey();
      expect(config.getCurrentGeminiApiKey()).toBe('env_key_3');
      expect(config.hasMultipleApiKeys()).toBe(true);
    });


    it('should correctly cycle through multiple API keys using switchToNextGeminiApiKey', () => {
      const paramsWithKeys: ConfigParameters = {
        ...baseParamsWithoutApiKeys,
        geminiApiKeys: ['key1', 'key2', 'key3'],
      };
      const config = new Config(paramsWithKeys);
      expect(config.getCurrentGeminiApiKey()).toBe('key1');
      expect(config.switchToNextGeminiApiKey()).toBe('key2');
      expect(config.getCurrentGeminiApiKey()).toBe('key2');
      expect(config.switchToNextGeminiApiKey()).toBe('key3');
      expect(config.getCurrentGeminiApiKey()).toBe('key3');
      expect(config.switchToNextGeminiApiKey()).toBe('key1'); // Cycle back
      expect(config.getCurrentGeminiApiKey()).toBe('key1');
    });

    it('switchToNextGeminiApiKey should return undefined if no keys are configured', () => {
      const config = new Config(baseParamsWithoutApiKeys);
      expect(config.switchToNextGeminiApiKey()).toBeUndefined();
    });

    it('hasMultipleApiKeys should return true if more than one key is present', () => {
      const paramsWithKeys: ConfigParameters = {
        ...baseParamsWithoutApiKeys,
        geminiApiKeys: ['key1', 'key2'],
      };
      const config = new Config(paramsWithKeys);
      expect(config.hasMultipleApiKeys()).toBe(true);
    });

    it('hasMultipleApiKeys should return false if only one key is present', () => {
      process.env.GEMINI_API_KEY = 'single_key';
      const config = new Config(baseParamsWithoutApiKeys);
      expect(config.hasMultipleApiKeys()).toBe(false);
    });

     it('hasMultipleApiKeys should return false if no keys are present', () => {
      const config = new Config(baseParamsWithoutApiKeys);
      expect(config.hasMultipleApiKeys()).toBe(false);
    });

    it('should handle GEMINI_API_KEY and GEMINI_API_KEY_N together correctly, avoiding duplicates from GEMINI_API_KEY', () => {
      process.env.GEMINI_API_KEY = 'env_single_key';
      process.env.GEMINI_API_KEY_1 = 'env_key_1';
      process.env.GEMINI_API_KEY_2 = 'env_single_key'; // This is a duplicate of GEMINI_API_KEY

      const config = new Config(baseParamsWithoutApiKeys);
      // Expected: env_single_key, env_key_1
      expect(config.getCurrentGeminiApiKey()).toBe('env_single_key');
      config.switchToNextGeminiApiKey();
      expect(config.getCurrentGeminiApiKey()).toBe('env_key_1');
      config.switchToNextGeminiApiKey();
      expect(config.getCurrentGeminiApiKey()).toBe('env_single_key'); // Cycle back
      expect(config.hasMultipleApiKeys()).toBe(true); // Two unique keys
    });
  });
});
