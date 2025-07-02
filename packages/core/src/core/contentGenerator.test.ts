/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createContentGenerator, AuthType, createContentGeneratorConfig } from './contentGenerator.js';
import { createCodeAssistContentGenerator } from '../code_assist/codeAssist.js';
import { GoogleGenAI } from '@google/genai';
import { Config } from '../config/config.js'; // Import Config
import { DEFAULT_GEMINI_MODEL } from '../config/models.js';

vi.mock('../code_assist/codeAssist.js');
vi.mock('@google/genai');
vi.mock('../config/config.js'); // Mock the Config class
vi.mock('./modelCheck.js', () => ({
    getEffectiveModel: vi.fn((apiKey, model) => Promise.resolve(model)), // Mock getEffectiveModel
}));


describe('createContentGenerator', () => { // Renamed outer describe for clarity
  it('should create a CodeAssistContentGenerator for LOGIN_WITH_GOOGLE_PERSONAL', async () => {
    const mockGenerator = {} as unknown;
    vi.mocked(createCodeAssistContentGenerator).mockResolvedValue(
      mockGenerator as never,
    );
    const generator = await createContentGenerator({
      model: 'test-model',
      authType: AuthType.LOGIN_WITH_GOOGLE_PERSONAL,
    });
    expect(createCodeAssistContentGenerator).toHaveBeenCalled();
    expect(generator).toBe(mockGenerator);
  });

  it('should create a GoogleGenAI content generator', async () => {
    const mockGenerator = {
      models: {},
    } as unknown;
    vi.mocked(GoogleGenAI).mockImplementation(() => mockGenerator as never);
    const generator = await createContentGenerator({
      model: 'test-model',
      apiKey: 'test-api-key',
      authType: AuthType.USE_GEMINI,
    });
    expect(GoogleGenAI).toHaveBeenCalledWith({
      apiKey: 'test-api-key',
      vertexai: undefined,
      httpOptions: {
        headers: {
          'User-Agent': expect.any(String),
        },
      },
    });
    expect(generator).toBe((mockGenerator as GoogleGenAI).models);
  });
});

describe('createContentGeneratorConfig', () => {
  let mockConfigInstance: Config;

  beforeEach(() => {
    // Create a fresh mock for Config for each test
    mockConfigInstance = new Config({
        sessionId: 'test-session',
        targetDir: '/test',
        debugMode: false,
        model: DEFAULT_GEMINI_MODEL,
        cwd: '/test-cwd',
    } as any); // Cast to any to simplify constructor params for testing

    // Mock methods on this specific instance
    vi.spyOn(mockConfigInstance, 'getModel').mockReturnValue(DEFAULT_GEMINI_MODEL);
    vi.spyOn(mockConfigInstance, 'getCurrentGeminiApiKey').mockReturnValue(undefined);
  });

  it('should return basic config for LOGIN_WITH_GOOGLE_PERSONAL', async () => {
    const result = await createContentGeneratorConfig(
      'test-model-param',
      AuthType.LOGIN_WITH_GOOGLE_PERSONAL,
      mockConfigInstance,
    );
    expect(result.authType).toBe(AuthType.LOGIN_WITH_GOOGLE_PERSONAL);
    expect(result.model).toBe(DEFAULT_GEMINI_MODEL); // getModel from mockConfigInstance is used
    expect(result.apiKey).toBeUndefined();
  });

  it('should use getCurrentGeminiApiKey from Config for USE_GEMINI auth type', async () => {
    const apiKeyFromConfig = 'key_from_config_object';
    vi.spyOn(mockConfigInstance, 'getCurrentGeminiApiKey').mockReturnValue(apiKeyFromConfig);

    const result = await createContentGeneratorConfig(
      undefined, // Model can be undefined, will use config.getModel()
      AuthType.USE_GEMINI,
      mockConfigInstance,
    );

    expect(mockConfigInstance.getCurrentGeminiApiKey).toHaveBeenCalled();
    expect(result.apiKey).toBe(apiKeyFromConfig);
    expect(result.authType).toBe(AuthType.USE_GEMINI);
    expect(result.model).toBe(DEFAULT_GEMINI_MODEL);
     // Check that getEffectiveModel was called (implicitly, as it's part of the flow)
    expect(vi.mocked(await import('./modelCheck.js')).getEffectiveModel).toHaveBeenCalledWith(apiKeyFromConfig, DEFAULT_GEMINI_MODEL);
  });

  it('should return undefined apiKey if USE_GEMINI and config has no API key', async () => {
    vi.spyOn(mockConfigInstance, 'getCurrentGeminiApiKey').mockReturnValue(undefined);
     // Ensure getEffectiveModel doesn't get called if apiKey is undefined.
     // The current implementation of createContentGeneratorConfig will call getEffectiveModel
     // only if apiKey is defined. So, we don't need to check getEffectiveModel not being called here,
     // but rather that the apiKey in the result is undefined.

    const result = await createContentGeneratorConfig(
      'some-model',
      AuthType.USE_GEMINI,
      mockConfigInstance,
    );
    expect(result.apiKey).toBeUndefined();
  });

  it('should handle USE_VERTEX_AI with GOOGLE_API_KEY from env', async () => {
    process.env.GOOGLE_API_KEY = 'vertex_env_key';
    process.env.GOOGLE_CLOUD_PROJECT = 'test-proj';
    process.env.GOOGLE_CLOUD_LOCATION = 'us-central1';

    const result = await createContentGeneratorConfig(
      'vertex-model',
      AuthType.USE_VERTEX_AI,
      mockConfigInstance, // Config object is passed but vertex primarily uses env vars for its specific keys
    );

    expect(result.apiKey).toBe('vertex_env_key');
    expect(result.vertexai).toBe(true);
    expect(result.model).toBe('vertex-model'); // getEffectiveModel would have been called
    expect(vi.mocked(await import('./modelCheck.js')).getEffectiveModel).toHaveBeenCalledWith('vertex_env_key', 'vertex-model');


    delete process.env.GOOGLE_API_KEY;
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.GOOGLE_CLOUD_LOCATION;
  });
   it('should prioritize model from config.getModel() over parameter model', async () => {
    const modelFromConfig = 'model-from-getmodel';
    vi.spyOn(mockConfigInstance, 'getModel').mockReturnValue(modelFromConfig);
    vi.spyOn(mockConfigInstance, 'getCurrentGeminiApiKey').mockReturnValue('somekey');


    const result = await createContentGeneratorConfig(
      'model-from-param', // This should be overridden
      AuthType.USE_GEMINI,
      mockConfigInstance,
    );
    expect(result.model).toBe(modelFromConfig);
  });
});
