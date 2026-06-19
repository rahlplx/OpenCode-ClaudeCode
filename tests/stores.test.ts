import { describe, it, expect, beforeEach } from "vitest";
import { useAppSettingsStore } from "../src/client/stores/appSettingsStore";
import { useChatInputStore } from "../src/client/stores/chatInputStore";
import { useChatSoundPreferencesStore } from "../src/client/stores/chatSoundPreferencesStore";
import { useTerminalPreferencesStore } from "../src/client/stores/terminalPreferencesStore";
import { useDiffCommitStore } from "../src/client/stores/diffCommitStore";

describe("appSettingsStore", () => {
  beforeEach(() => {
    useAppSettingsStore.setState({
      settings: null,
      hydrationStatus: "idle",
    });
  });

  it("starts with null settings and idle hydration", () => {
    const state = useAppSettingsStore.getState();
    expect(state.settings).toBeNull();
    expect(state.hydrationStatus).toBe("idle");
  });

  it("sets hydration status", () => {
    useAppSettingsStore.getState().setHydrationStatus("loading");
    expect(useAppSettingsStore.getState().hydrationStatus).toBe("loading");
  });

  it("sets from server", () => {
    const mockSettings = {
      analyticsEnabled: false,
      browserSettingsMigrated: true,
      theme: "dark" as const,
      chatSoundPreference: "never" as const,
      chatSoundId: "pop" as const,
      terminal: { scrollbackLines: 5000, minColumnWidth: 80 },
      editor: { preset: "vscode" as const, commandTemplate: "code {path}" },
      defaultProvider: "last_used" as const,
      providerDefaults: {
        claude: {
          model: "claude-sonnet-4-6",
          modelOptions: { reasoningEffort: "high" as const, contextWindow: "200k" as const },
          planMode: false,
        },
        codex: {
          model: "gpt-5.5",
          modelOptions: { reasoningEffort: "high" as const, fastMode: false },
          planMode: false,
        },
      },
      warning: null,
      filePathDisplay: "~/.opencode/settings.json",
    };
    useAppSettingsStore.getState().setFromServer(mockSettings);
    expect(useAppSettingsStore.getState().settings).toEqual(mockSettings);
    expect(useAppSettingsStore.getState().hydrationStatus).toBe("ready");
  });
});

describe("chatInputStore", () => {
  beforeEach(() => {
    useChatInputStore.setState({
      drafts: {},
      attachmentDrafts: {},
    });
  });

  it("starts with empty drafts", () => {
    const state = useChatInputStore.getState();
    expect(state.drafts).toEqual({});
    expect(state.attachmentDrafts).toEqual({});
  });
});

describe("chatSoundPreferencesStore", () => {
  it("has default sound preference", () => {
    const state = useChatSoundPreferencesStore.getState();
    expect(state.chatSoundPreference).toBeDefined();
    expect(state.chatSoundId).toBeDefined();
  });

  it("sets sound preference", () => {
    useChatSoundPreferencesStore.getState().setChatSoundPreference("always");
    expect(useChatSoundPreferencesStore.getState().chatSoundPreference).toBe("always");
  });

  it("sets sound id", () => {
    useChatSoundPreferencesStore.getState().setChatSoundId("ping");
    expect(useChatSoundPreferencesStore.getState().chatSoundId).toBe("ping");
  });
});

describe("terminalPreferencesStore", () => {
  it("has default editor preset", () => {
    const state = useTerminalPreferencesStore.getState();
    expect(state.editorPreset).toBeDefined();
  });

  it("sets scrollback lines", () => {
    useTerminalPreferencesStore.getState().setScrollbackLines(3000);
    expect(useTerminalPreferencesStore.getState().scrollbackLines).toBe(3000);
  });

  it("sets min column width", () => {
    useTerminalPreferencesStore.getState().setMinColumnWidth(500);
    expect(useTerminalPreferencesStore.getState().minColumnWidth).toBe(500);
  });
});

describe("diffCommitStore", () => {
  it("has initial state", () => {
    const state = useDiffCommitStore.getState();
    expect(state).toBeDefined();
  });
});
