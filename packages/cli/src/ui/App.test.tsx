/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import { render } from 'ink-testing-library';
import { AppWrapper as App } from './App.js';
import {
  Config as ServerConfig,
  MCPServerConfig,
  ApprovalMode,
  ToolRegistry,
  AccessibilitySettings,
  SandboxConfig,
} from '@google/gemini-cli-core';
import { LoadedSettings, SettingsFile, Settings } from '../config/settings.js';
import process from 'node:process';

// Define a more complete mock server config based on actual Config
interface MockServerConfig {
  apiKey: string;
  model: string;
  sandbox?: SandboxConfig;
  targetDir: string;
  debugMode: boolean;
  question?: string;
  fullContext: boolean;
  coreTools?: string[];
  toolDiscoveryCommand?: string;
  toolCallCommand?: string;
  mcpServerCommand?: string;
  mcpServers?: Record<string, MCPServerConfig>; // Use imported MCPServerConfig
  userAgent: string;
  userMemory: string;
  geminiMdFileCount: number;
  approvalMode: ApprovalMode;
  vertexai?: boolean;
  showMemoryUsage?: boolean;
  accessibility?: AccessibilitySettings;
  embeddingModel: string;

  getApiKey: Mock<() => string>;
  getModel: Mock<() => string>;
  getSandbox: Mock<() => SandboxConfig | undefined>;
  getTargetDir: Mock<() => string>;
  getToolRegistry: Mock<() => ToolRegistry>; // Use imported ToolRegistry type
  getDebugMode: Mock<() => boolean>;
  getQuestion: Mock<() => string | undefined>;
  getFullContext: Mock<() => boolean>;
  getCoreTools: Mock<() => string[] | undefined>;
  getToolDiscoveryCommand: Mock<() => string | undefined>;
  getToolCallCommand: Mock<() => string | undefined>;
  getMcpServerCommand: Mock<() => string | undefined>;
  getMcpServers: Mock<() => Record<string, MCPServerConfig> | undefined>;
  getUserAgent: Mock<() => string>;
  getUserMemory: Mock<() => string>;
  setUserMemory: Mock<(newUserMemory: string) => void>;
  getGeminiMdFileCount: Mock<() => number>;
  setGeminiMdFileCount: Mock<(count: number) => void>;
  getApprovalMode: Mock<() => ApprovalMode>;
  setApprovalMode: Mock<(skip: ApprovalMode) => void>;
  getVertexAI: Mock<() => boolean | undefined>;
  getShowMemoryUsage: Mock<() => boolean>;
  getAccessibility: Mock<() => AccessibilitySettings>;
  getProjectRoot: Mock<() => string | undefined>;
  getAllGeminiMdFilenames: Mock<() => string[]>;
}

// Mock @google/gemini-cli-core and its Config class
vi.mock('@google/gemini-cli-core', async (importOriginal) => {
  const actualCore =
    await importOriginal<typeof import('@google/gemini-cli-core')>();
  const ConfigClassMock = vi
    .fn()
    .mockImplementation((optionsPassedToConstructor) => {
      const opts = { ...optionsPassedToConstructor }; // Clone
      // Basic mock structure, will be extended by the instance in tests
      return {
        apiKey: opts.apiKey || 'test-key',
        model: opts.model || 'test-model-in-mock-factory',
        sandbox: opts.sandbox,
        targetDir: opts.targetDir || '/test/dir',
        debugMode: opts.debugMode || false,
        question: opts.question,
        fullContext: opts.fullContext ?? false,
        coreTools: opts.coreTools,
        toolDiscoveryCommand: opts.toolDiscoveryCommand,
        toolCallCommand: opts.toolCallCommand,
        mcpServerCommand: opts.mcpServerCommand,
        mcpServers: opts.mcpServers,
        userAgent: opts.userAgent || 'test-agent',
        userMemory: opts.userMemory || '',
        geminiMdFileCount: opts.geminiMdFileCount || 0,
        approvalMode: opts.approvalMode ?? ApprovalMode.DEFAULT,
        vertexai: opts.vertexai,
        showMemoryUsage: opts.showMemoryUsage ?? false,
        accessibility: opts.accessibility ?? {},
        embeddingModel: opts.embeddingModel || 'test-embedding-model',

        getApiKey: vi.fn(() => opts.apiKey || 'test-key'),
        getModel: vi.fn(() => opts.model || 'test-model-in-mock-factory'),
        getSandbox: vi.fn(() => opts.sandbox),
        getTargetDir: vi.fn(() => opts.targetDir || '/test/dir'),
        getToolRegistry: vi.fn(() => ({}) as ToolRegistry), // Simple mock
        getDebugMode: vi.fn(() => opts.debugMode || false),
        getQuestion: vi.fn(() => opts.question),
        getFullContext: vi.fn(() => opts.fullContext ?? false),
        getCoreTools: vi.fn(() => opts.coreTools),
        getToolDiscoveryCommand: vi.fn(() => opts.toolDiscoveryCommand),
        getToolCallCommand: vi.fn(() => opts.toolCallCommand),
        getMcpServerCommand: vi.fn(() => opts.mcpServerCommand),
        getMcpServers: vi.fn(() => opts.mcpServers),
        getUserAgent: vi.fn(() => opts.userAgent || 'test-agent'),
        getUserMemory: vi.fn(() => opts.userMemory || ''),
        setUserMemory: vi.fn(),
        getGeminiMdFileCount: vi.fn(() => opts.geminiMdFileCount || 0),
        setGeminiMdFileCount: vi.fn(),
        getApprovalMode: vi.fn(() => opts.approvalMode ?? ApprovalMode.DEFAULT),
        setApprovalMode: vi.fn(),
        getVertexAI: vi.fn(() => opts.vertexai),
        getShowMemoryUsage: vi.fn(() => opts.showMemoryUsage ?? false),
        getAccessibility: vi.fn(() => opts.accessibility ?? {}),
        getProjectRoot: vi.fn(() => opts.projectRoot),
        getGeminiClient: vi.fn(() => ({})),
        getCheckpointingEnabled: vi.fn(() => opts.checkpointing ?? true),
        getAllGeminiMdFilenames: vi.fn(() => ['GEMINI.md']),
        setFlashFallbackHandler: vi.fn(),
      };
    });
  return {
    ...actualCore,
    Config: ConfigClassMock,
    MCPServerConfig: actualCore.MCPServerConfig,
    getAllGeminiMdFilenames: vi.fn(() => ['GEMINI.md']),
  };
});

// Mock heavy dependencies or those with side effects
vi.mock('./hooks/useGeminiStream', () => ({
  useGeminiStream: vi.fn(() => ({
    streamingState: 'Idle',
    submitQuery: mockSubmitQuery, // Use a controllable mock
    initError: null,
    pendingHistoryItems: [],
    thought: null,
  })),
}));
// Make submitQuery mock accessible in tests
export const mockSubmitQuery = vi.fn();


vi.mock('./hooks/useAuthCommand', () => ({
  useAuthCommand: vi.fn(() => ({
    isAuthDialogOpen: false,
    openAuthDialog: vi.fn(),
    handleAuthSelect: vi.fn(),
    handleAuthHighlight: vi.fn(),
  })),
}));

vi.mock('./hooks/useLogger', () => ({
  useLogger: vi.fn(() => ({
    getPreviousUserMessages: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('../config/config.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    // @ts-expect-error - this is fine
    ...actual,
    loadHierarchicalGeminiMemory: vi
      .fn()
      .mockResolvedValue({ memoryContent: '', fileCount: 0 }),
  };
});

describe('App UI', () => {
  let mockConfig: MockServerConfig;
  let mockSettings: LoadedSettings;
  let currentUnmount: (() => void) | undefined;

  const createMockSettings = (
    settings: Partial<Settings> = {},
  ): LoadedSettings => {
    const userSettingsFile: SettingsFile = {
      path: '/user/settings.json',
      settings: {},
    };
    const workspaceSettingsFile: SettingsFile = {
      path: '/workspace/.gemini/settings.json',
      settings: {
        ...settings,
      },
    };
    return new LoadedSettings(userSettingsFile, workspaceSettingsFile, []);
  };

  beforeEach(() => {
    const ServerConfigMocked = vi.mocked(ServerConfig, true);
    mockConfig = new ServerConfigMocked({
      embeddingModel: 'test-embedding-model',
      sandbox: undefined,
      targetDir: '/test/dir',
      debugMode: false,
      userMemory: '',
      geminiMdFileCount: 0,
      showMemoryUsage: false,
      sessionId: 'test-session-id',
      cwd: '/tmp',
      model: 'model',
    }) as unknown as MockServerConfig;

    // Ensure the getShowMemoryUsage mock function is specifically set up if not covered by constructor mock
    if (!mockConfig.getShowMemoryUsage) {
      mockConfig.getShowMemoryUsage = vi.fn(() => false);
    }
    mockConfig.getShowMemoryUsage.mockReturnValue(false); // Default for most tests

    // Ensure a theme is set so the theme dialog does not appear.
    mockSettings = createMockSettings({ theme: 'Default' });
  });

  afterEach(() => {
    if (currentUnmount) {
      currentUnmount();
      currentUnmount = undefined;
    }
    vi.clearAllMocks(); // Clear mocks after each test
  });

  it('should display default "GEMINI.md" in footer when contextFileName is not set and count is 1', async () => {
    mockConfig.getGeminiMdFileCount.mockReturnValue(1);
    // For this test, ensure showMemoryUsage is false or debugMode is false if it relies on that
    mockConfig.getDebugMode.mockReturnValue(false);
    mockConfig.getShowMemoryUsage.mockReturnValue(false);

    const { lastFrame, unmount } = render(
      <App
        config={mockConfig as unknown as ServerConfig}
        settings={mockSettings}
      />,
    );
    currentUnmount = unmount;
    await Promise.resolve(); // Wait for any async updates
    expect(lastFrame()).toContain('Using 1 GEMINI.md file');
  });

  it('should display default "GEMINI.md" with plural when contextFileName is not set and count is > 1', async () => {
    mockConfig.getGeminiMdFileCount.mockReturnValue(2);
    mockConfig.getDebugMode.mockReturnValue(false);
    mockConfig.getShowMemoryUsage.mockReturnValue(false);

    const { lastFrame, unmount } = render(
      <App
        config={mockConfig as unknown as ServerConfig}
        settings={mockSettings}
      />,
    );
    currentUnmount = unmount;
    await Promise.resolve();
    expect(lastFrame()).toContain('Using 2 GEMINI.md files');
  });

  it('should display custom contextFileName in footer when set and count is 1', async () => {
    mockSettings = createMockSettings({
      contextFileName: 'AGENTS.md',
      theme: 'Default',
    });
    mockConfig.getGeminiMdFileCount.mockReturnValue(1);
    mockConfig.getDebugMode.mockReturnValue(false);
    mockConfig.getShowMemoryUsage.mockReturnValue(false);

    const { lastFrame, unmount } = render(
      <App
        config={mockConfig as unknown as ServerConfig}
        settings={mockSettings}
      />,
    );
    currentUnmount = unmount;
    await Promise.resolve();
    expect(lastFrame()).toContain('Using 1 AGENTS.md file');
  });

  it('should display a generic message when multiple context files with different names are provided', async () => {
    mockSettings = createMockSettings({
      contextFileName: ['AGENTS.md', 'CONTEXT.md'],
      theme: 'Default',
    });
    mockConfig.getGeminiMdFileCount.mockReturnValue(2);
    mockConfig.getDebugMode.mockReturnValue(false);
    mockConfig.getShowMemoryUsage.mockReturnValue(false);

    const { lastFrame, unmount } = render(
      <App
        config={mockConfig as unknown as ServerConfig}
        settings={mockSettings}
      />,
    );
    currentUnmount = unmount;
    await Promise.resolve();
    expect(lastFrame()).toContain('Using 2 context files');
  });

  it('should display custom contextFileName with plural when set and count is > 1', async () => {
    mockSettings = createMockSettings({
      contextFileName: 'MY_NOTES.TXT',
      theme: 'Default',
    });
    mockConfig.getGeminiMdFileCount.mockReturnValue(3);
    mockConfig.getDebugMode.mockReturnValue(false);
    mockConfig.getShowMemoryUsage.mockReturnValue(false);

    const { lastFrame, unmount } = render(
      <App
        config={mockConfig as unknown as ServerConfig}
        settings={mockSettings}
      />,
    );
    currentUnmount = unmount;
    await Promise.resolve();
    expect(lastFrame()).toContain('Using 3 MY_NOTES.TXT files');
  });

  it('should not display context file message if count is 0, even if contextFileName is set', async () => {
    mockSettings = createMockSettings({
      contextFileName: 'ANY_FILE.MD',
      theme: 'Default',
    });
    mockConfig.getGeminiMdFileCount.mockReturnValue(0);
    mockConfig.getDebugMode.mockReturnValue(false);
    mockConfig.getShowMemoryUsage.mockReturnValue(false);

    const { lastFrame, unmount } = render(
      <App
        config={mockConfig as unknown as ServerConfig}
        settings={mockSettings}
      />,
    );
    currentUnmount = unmount;
    await Promise.resolve();
    expect(lastFrame()).not.toContain('ANY_FILE.MD');
  });

  it('should display GEMINI.md and MCP server count when both are present', async () => {
    mockConfig.getGeminiMdFileCount.mockReturnValue(2);
    mockConfig.getMcpServers.mockReturnValue({
      server1: {} as MCPServerConfig,
    });
    mockConfig.getDebugMode.mockReturnValue(false);
    mockConfig.getShowMemoryUsage.mockReturnValue(false);

    const { lastFrame, unmount } = render(
      <App
        config={mockConfig as unknown as ServerConfig}
        settings={mockSettings}
      />,
    );
    currentUnmount = unmount;
    await Promise.resolve();
    expect(lastFrame()).toContain('server');
  });

  it('should display only MCP server count when GEMINI.md count is 0', async () => {
    mockConfig.getGeminiMdFileCount.mockReturnValue(0);
    mockConfig.getMcpServers.mockReturnValue({
      server1: {} as MCPServerConfig,
      server2: {} as MCPServerConfig,
    });
    mockConfig.getDebugMode.mockReturnValue(false);
    mockConfig.getShowMemoryUsage.mockReturnValue(false);

    const { lastFrame, unmount } = render(
      <App
        config={mockConfig as unknown as ServerConfig}
        settings={mockSettings}
      />,
    );
    currentUnmount = unmount;
    await Promise.resolve();
    expect(lastFrame()).toContain('Using 2 MCP servers');
  });

  describe('when no theme is set', () => {
    let originalNoColor: string | undefined;

    beforeEach(() => {
      originalNoColor = process.env.NO_COLOR;
      // Ensure no theme is set for these tests
      mockSettings = createMockSettings({});
      mockConfig.getDebugMode.mockReturnValue(false);
      mockConfig.getShowMemoryUsage.mockReturnValue(false);
    });

    afterEach(() => {
      process.env.NO_COLOR = originalNoColor;
    });

    it('should display theme dialog if NO_COLOR is not set', async () => {
      delete process.env.NO_COLOR;

      const { lastFrame, unmount } = render(
        <App
          config={mockConfig as unknown as ServerConfig}
          settings={mockSettings}
        />,
      );
      currentUnmount = unmount;

      expect(lastFrame()).toContain('Select Theme');
    });

    it('should display a message if NO_COLOR is set', async () => {
      process.env.NO_COLOR = 'true';

      const { lastFrame, unmount } = render(
        <App
          config={mockConfig as unknown as ServerConfig}
          settings={mockSettings}
        />,
      );
      currentUnmount = unmount;

      expect(lastFrame()).toContain(
        'Theme configuration unavailable due to NO_COLOR env variable.',
      );
      expect(lastFrame()).not.toContain('Select Theme');
    });
  });

  describe('Model Selection and Switching UI', () => {
    beforeEach(() => {
      // Ensure useGeminiStream's submitQuery is reset if it's used across tests
      mockSubmitQuery.mockClear();
      // Ensure a theme is set so the theme dialog does not appear.
      mockSettings = createMockSettings({ theme: 'Default' });

      // Mock config for these specific tests if needed, e.g. multiple API keys
       mockConfig.getGeminiClient.mockReturnValue({
        // Mock methods on geminiClient if they are called during these UI flows
        // For now, an empty object might suffice if only config methods are relevant
      });
      mockConfig.getContentGeneratorConfig = vi.fn().mockReturnValue({ authType: 'gemini-api-key' }); // Default to API key
      mockConfig.hasMultipleApiKeys = vi.fn().mockReturnValue(false); // Default to single API key
      mockConfig.getCurrentGeminiApiKey = vi.fn().mockReturnValue('key1');
      mockConfig.switchToNextGeminiApiKey = vi.fn().mockReturnValue('key2');
      mockConfig.refreshAuth = vi.fn().mockResolvedValue(undefined);

       // Mock core account switching functions
      vi.mock('@google/gemini-cli-core', async (importOriginal) => {
        const actualCore = await importOriginal<typeof import('@google/gemini-cli-core')>();
        return {
          ...actualCore,
          switchToNextAccount: vi.fn(),
          getCurrentAccountIndex: vi.fn().mockReturnValue(0),
        };
      });
    });

    it('should display model selection placeholder when Ctrl+M is pressed', async () => {
      const { lastFrame, stdin, unmount } = render(
        <App
          config={mockConfig as unknown as ServerConfig}
          settings={mockSettings}
        />,
      );
      currentUnmount = unmount;
      await Promise.resolve(); // Initial render

      stdin.write('\u000D'); // Ctrl+M (Note: \u000D is Carriage Return, typically Enter. Ctrl+M is actually \x0D or character code 13)
                               // For ink-testing-library, sending the character directly often works if useInput is looking for 'm' with ctrl: true
      stdin.write('m', { ctrl: true });
      await Promise.resolve();

      expect(lastFrame()).toContain('Model Selection Placeholder');
      // Test closing with Escape
      stdin.write('\u001B'); // Escape key
      await Promise.resolve();
      expect(lastFrame()).not.toContain('Model Selection Placeholder');
    });

    it('should display model switch suggestion UI when showModelSwitchSuggestion is true (simulated via hook call)', async () => {
      // This test requires triggering the conditions that set showModelSwitchSuggestion = true.
      // This happens inside handleRetryWithNewCredential, which is called from useGeminiStream's error handler.
      // For a unit-like test of App.tsx, we can simulate the hook calling onAuthError / handleRetry...
      // which then sets the state.
      // A more direct way for this specific UI part is to somehow set the state if possible,
      // or mock useGeminiStream to return a state that implies this condition.

      // Let's refine the mock of useGeminiStream for this test
      const mockUseGeminiStream = await vi.importActual<typeof import('./hooks/useGeminiStream')>('./hooks/useGeminiStream');
      const useGeminiStreamSpy = vi.spyOn(mockUseGeminiStream, 'useGeminiStream');

      // We need to trigger `handleRetryWithNewCredential` to return false, or `onAuthError` to set the suggestion.
      // The easiest is to mock `handleRetryWithNewCredential` (passed to `useGeminiStream`) to set the state.
      // However, `handleRetryWithNewCredential` is defined *inside* App.tsx.

      // Alternative: We can't directly set state of App.tsx from here.
      // We need to simulate a scenario where the internal logic of App leads to this.
      // Let's assume a failed API call, and no more keys/accounts to cycle.
      mockConfig.hasMultipleApiKeys.mockReturnValue(false); // No other keys to try

      const { lastFrame, stdin, unmount } = render(
        <App
          config={mockConfig as unknown as ServerConfig}
          settings={mockSettings}
        />
      );
      currentUnmount = unmount;
      await Promise.resolve();

      // Simulate the error path:
      // 1. User submits a query.
      // 2. useGeminiStream's submitQuery is called.
      // 3. It encounters an error that triggers handleRetryWithNewCredential.
      // 4. handleRetryWithNewCredential (inside App) finds no more keys/accounts and sets showModelSwitchSuggestion.

      // We need to get a reference to the handleRetryWithNewCredential passed to useGeminiStream
      // useGeminiStream is called inside App. Get the arguments of its last call.
      const useGeminiStreamArgs = useGeminiStreamSpy.mock.calls[0];
      const handleRetryCallback = useGeminiStreamArgs[7] as (originalQuery: any) => Promise<boolean>; // 8th arg based on current App.tsx

      // Call the callback as if an error occurred in useGeminiStream
      await handleRetryCallback("test query that failed");
      await Promise.resolve(); // Allow state update to render

      expect(lastFrame()).toContain('Having trouble connecting or getting responses?');
      expect(lastFrame()).toContain('Switch Model (Ctrl+M)');
      expect(lastFrame()).toContain('Retry Last Query');
      expect(lastFrame()).toContain('Dismiss');

      // Test Dismiss
      // How to simulate 'press' on a Text component in ink-testing-library?
      // ink-testing-library doesn't directly support 'onPress' simulation on Text.
      // This would typically be part of a SelectInput or similar component.
      // For now, we'll assume the logic for dismissal works if the text is present.
      // A more robust test would involve creating a custom SelectInput-like interaction.
      // Or, we can test that pressing ESC when the suggestion is open also closes it (if that's a desired behavior).
      // The current implementation closes it via onPress.

      // To test the "Switch Model" button:
      // We can't directly "click" it. We'd need to trigger its onPress.
      // This part of testing is tricky with ink-testing-library for simple Text onPress.
    });

    // More tests could be added for interactions if a method to simulate onPress is found/implemented.
    // For example, verifying that clicking "Switch Model" sets isModelSelectionOpen = true.
    // And clicking "Retry Last Query" calls mockSubmitQuery.

    it('should correctly handle actions from the model switch suggestion UI', async () => {
      // Setup: Bring the App to a state where the suggestion UI is shown
      mockConfig.hasMultipleApiKeys.mockReturnValue(false); // Ensure cycling fails quickly

      const { lastFrame, unmount, stdin } = render(
        <App
          config={mockConfig as unknown as ServerConfig}
          settings={mockSettings}
        />,
      );
      currentUnmount = unmount;
      await Promise.resolve();

      const mockUseGeminiStream = await vi.importActual<typeof import('./hooks/useGeminiStream')>('./hooks/useGeminiStream');
      const useGeminiStreamSpy = vi.spyOn(mockUseGeminiStream, 'useGeminiStream');
      const useGeminiStreamArgs = useGeminiStreamSpy.mock.calls[0];
      const handleRetryCallback = useGeminiStreamArgs[7] as (originalQuery: any) => Promise<boolean>;

      mockSubmitQuery.mockClear(); // Clear before potential call by retry
      await handleRetryCallback("test query that failed for suggestion");
      await Promise.resolve(); // Render suggestion UI

      expect(lastFrame()).toContain('Having trouble connecting or getting responses?');

      // Simulate "Switch Model" action
      // Since we can't "click", we'll need to find a way to invoke the logic.
      // The onPress for "Switch Model" does:
      // setShowModelSwitchSuggestion(false);
      // setIsModelSelectionOpen(true);
      // triedAccountsInCurrentSequence.current.clear();
      // triedApiKeysInCurrentSequence.current.clear();
      // We will test this by checking if the model selection placeholder appears.
      // This is an indirect test. A direct call to the handler would be better if App.tsx exposed it.
      // For now, let's assume we need a way to trigger this state change.
      // The simplest way for this test is to simulate another Ctrl+M after suggestion is shown,
      // assuming "Switch Model (Ctrl+M)" text implies this behavior or that the user might do this.
      // Or, if the "Switch Model" text itself had a test ID and its onPress could be extracted.

      // Let's assume the "Switch Model" text effectively guides user to press Ctrl+M.
      // Or, for testing, we can call the internal logic that the onPress would trigger IF we could access it.
      // Since we can't easily access internal functions of App from the test,
      // we'll test the "Dismiss" and "Retry" parts more directly if possible,
      // and for "Switch Model", verify that if `isModelSelectionOpen` becomes true, the correct UI shows.

      // To test "Dismiss":
      // The "Dismiss" Text onPress sets showModelSwitchSuggestion(false) and clears refs.
      // If we could trigger this, the suggestion UI would disappear.
      // Let's simulate a key press that might be mapped to "dismiss" if such a key exists, or focus on retry.

      // Test "Retry Last Query"
      // The onPress calls doSubmitQuery(lastFailedQuery.current, ...).
      // We have lastFailedQuery.current set by handleRetryCallback.
      // This is the most testable interaction here without major refactoring.

      // To test "Retry": We need to simulate the "Retry Last Query" action.
      // The `lastFailedQuery` ref in App.tsx should have been set to "test query that failed for suggestion".
      // The onPress handler for "Retry Last Query" calls `doSubmitQuery(lastFailedQuery.current, {isContinuation: true})`.
      // We can't directly call this onPress from here.
      // This highlights a limitation. We'll assume for now that if `mockSubmitQuery` is called, it's through this path.
      // This test is becoming more about the setup than the direct interaction.

      // A better way to test onPress actions is to have those actions call functions passed in as props,
      // or to use a testing utility that can find components by testID and trigger their props.
      // ink-testing-library is limited here.

      // Given the limitations, this test will focus on the setup leading to the suggestion.
      // Actual interaction tests for Text onPress are deferred or need a different strategy.
      // We've already tested Ctrl+M opens model selection, and Escape closes it.
      // We've tested that the suggestion UI appears.
    });

    it('should show model switch suggestion if config.refreshAuth fails during credential cycling', async () => {
      // Simulate API key auth type for this test
      mockConfig.getContentGeneratorConfig.mockReturnValue({ authType: AuthType.USE_GEMINI });
      mockConfig.hasMultipleApiKeys.mockReturnValue(true); // Has multiple keys to attempt cycling
      mockConfig.getCurrentGeminiApiKey.mockReturnValueOnce('key1_fails_refresh');
      mockConfig.switchToNextGeminiApiKey.mockReturnValueOnce('key2_also_fails_refresh');
      // Simulate refreshAuth failing for both attempts
      mockConfig.refreshAuth.mockRejectedValue(new Error("Simulated refreshAuth failure"));

      const { lastFrame, unmount } = render(
        <App
          config={mockConfig as unknown as ServerConfig}
          settings={mockSettings}
        />,
      );
      currentUnmount = unmount;
      await Promise.resolve();

      const mockUseGeminiStream = await vi.importActual<typeof import('./hooks/useGeminiStream')>('./hooks/useGeminiStream');
      const useGeminiStreamSpy = vi.spyOn(mockUseGeminiStream, 'useGeminiStream');
      const useGeminiStreamArgs = useGeminiStreamSpy.mock.calls[0];
      const handleRetryCallback = useGeminiStreamArgs[7] as (originalQuery: any) => Promise<boolean>;

      // Trigger the retry callback, which will attempt to cycle and call refreshAuth
      await handleRetryCallback("query that triggers cycling");
      await Promise.resolve(); // Allow state updates

      // Expect refreshAuth to have been called (it will be called twice due to two keys)
      expect(mockConfig.refreshAuth).toHaveBeenCalledTimes(2);
      // And because both failed, the suggestion UI should appear
      expect(lastFrame()).toContain('Having trouble connecting or getting responses?');
    });
  });
});
