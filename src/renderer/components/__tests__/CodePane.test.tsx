import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CodePane } from '../CodePane';
import type {
  CodePaneFsChangedPayload,
  CodePaneGitDiffHunk,
  CodePaneIndexProgressPayload,
  CodePaneLanguageWorkspaceChangedPayload,
} from '../../../shared/types/electron-api';
import { resetMonacoLanguageBridgeForTests } from '../../services/code/MonacoLanguageBridge';
import { resetCodePaneProjectCacheForTests } from '../../stores/codePaneProjectCache';
import type { Pane } from '../../types/window';
import { WindowStatus } from '../../types/window';

vi.setConfig({ testTimeout: 15000 });

type UpdatePaneFn = (windowId: string, paneId: string, updates: Partial<Pane>) => void;
type ChangeListener = () => void;

const hoisted = vi.hoisted(() => ({
  ensureMonacoEnvironmentMock: vi.fn(),
  setLanguage: vi.fn(),
  t: (key: string, params?: Record<string, string | number>) => {
    const template = key;
    if (!params) {
      return template;
    }
    return template.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? ''));
  },
  updatePaneSpy: vi.fn(),
}));

let updatePaneImpl: UpdatePaneFn | null = null;

vi.mock('../../stores/windowStore', () => ({
  useWindowStore: (selector: (state: { updatePane: UpdatePaneFn }) => unknown) => selector({
    updatePane: hoisted.updatePaneSpy,
  }),
}));

vi.mock('../../i18n', () => ({
  useI18n: () => ({
    t: hoisted.t,
    language: 'en-US',
    setLanguage: hoisted.setLanguage,
  }),
}));

vi.mock('../ui/AppTooltip', () => ({
  AppTooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

class FakeModel {
  private listeners = new Set<ChangeListener>();
  private versionId = 1;

  constructor(
    private value: string,
    private language: string,
    readonly uri: { path: string; fsPath?: string; toString?: () => string },
  ) {}

  onDidChangeContent(listener: ChangeListener) {
    this.listeners.add(listener);
    return {
      dispose: () => {
        this.listeners.delete(listener);
      },
    };
  }

  getLanguageId() {
    return this.language;
  }

  setLanguage(language: string) {
    this.language = language;
  }

  getValue() {
    return this.value;
  }

  getWordAtPosition(position: { lineNumber: number; column: number }) {
    const lines = this.value.split('\n');
    const line = lines[position.lineNumber - 1] ?? '';
    const index = Math.max(position.column - 1, 0);
    if (index >= line.length) {
      return null;
    }

    const isWordCharacter = (character: string) => /[A-Za-z0-9_$]/.test(character);
    if (!isWordCharacter(line[index] ?? '')) {
      return null;
    }

    let start = index;
    let end = index;
    while (start > 0 && isWordCharacter(line[start - 1] ?? '')) {
      start -= 1;
    }
    while (end < line.length && isWordCharacter(line[end] ?? '')) {
      end += 1;
    }

    return {
      word: line.slice(start, end),
      startColumn: start + 1,
      endColumn: end + 1,
    };
  }

  setValue(value: string) {
    this.value = value;
    this.versionId += 1;
    for (const listener of Array.from(this.listeners)) {
      listener();
    }
  }

  getAlternativeVersionId() {
    return this.versionId;
  }

  getVersionId() {
    return this.versionId;
  }

  dispose() {
    this.listeners.clear();
  }
}

function createFakeEditor() {
  let model: FakeModel | null = null;
  let position = { lineNumber: 1, column: 1 };
  let selection = {
    startLineNumber: 1,
    startColumn: 1,
    endLineNumber: 1,
    endColumn: 1,
    isEmpty: () => true,
  };
  const mouseDownListeners = new Set<(event: any) => void>();
  const mouseMoveListeners = new Set<(event: any) => void>();
  const mouseLeaveListeners = new Set<() => void>();
  let decorationIds: string[] = [];

  return {
    addAction: vi.fn(),
    addCommand: vi.fn(),
    deltaDecorations: vi.fn((oldDecorations: string[], newDecorations: Array<{ range: unknown }>) => {
      decorationIds = newDecorations.map((_, index) => `decoration-${index + 1}`);
      return decorationIds;
    }),
    dispose: vi.fn(),
    focus: vi.fn(),
    getPosition: vi.fn(() => position),
    getSelection: vi.fn(() => selection),
    onMouseDown: vi.fn((listener: (event: any) => void) => {
      mouseDownListeners.add(listener);
      return {
        dispose: () => {
          mouseDownListeners.delete(listener);
        },
      };
    }),
    onMouseMove: vi.fn((listener: (event: any) => void) => {
      mouseMoveListeners.add(listener);
      return {
        dispose: () => {
          mouseMoveListeners.delete(listener);
        },
      };
    }),
    onMouseLeave: vi.fn((listener: () => void) => {
      mouseLeaveListeners.add(listener);
      return {
        dispose: () => {
          mouseLeaveListeners.delete(listener);
        },
      };
    }),
    revealLineInCenter: vi.fn(),
    restoreViewState: vi.fn(),
    saveViewState: vi.fn(() => null),
    setPosition: vi.fn((nextPosition: { lineNumber: number; column: number }) => {
      position = nextPosition;
    }),
    setSelection: vi.fn((nextSelection: typeof selection) => {
      selection = nextSelection;
    }),
    updateOptions: vi.fn(),
    setModel: vi.fn((nextModel: FakeModel | null) => {
      model = nextModel;
      fakeMonacoState.lastEditorModel = nextModel;
    }),
    getModel: () => model,
    fireMouseDown: (event: any) => {
      for (const listener of Array.from(mouseDownListeners)) {
        listener(event);
      }
    },
    fireMouseMove: (event: any) => {
      for (const listener of Array.from(mouseMoveListeners)) {
        listener(event);
      }
    },
    fireMouseLeave: () => {
      for (const listener of Array.from(mouseLeaveListeners)) {
        listener();
      }
    },
  };
}

function createFakeDiffEditor() {
  const modifiedEditor = createFakeEditor();

  return {
    dispose: vi.fn(),
    getModifiedEditor: () => modifiedEditor,
    setModel: vi.fn((models: { original: FakeModel; modified: FakeModel }) => {
      fakeMonacoState.lastDiffModel = models;
      modifiedEditor.setModel(models.modified);
    }),
  };
}

const fakeMonacoState = {
  lastDiffModel: null as { original: FakeModel; modified: FakeModel } | null,
  lastEditorModel: null as FakeModel | null,
  lastEditorOptions: null as Record<string, unknown> | null,
  lastDiffEditorOptions: null as Record<string, unknown> | null,
  definitionProviders: new Map<string, { provideDefinition: (...args: any[]) => Promise<unknown> }>(),
  hoverProviders: new Map<string, { provideHover: (...args: any[]) => Promise<unknown> }>(),
  referenceProviders: new Map<string, { provideReferences: (...args: any[]) => Promise<unknown> }>(),
  documentHighlightProviders: new Map<string, { provideDocumentHighlights: (...args: any[]) => Promise<unknown> }>(),
  documentSymbolProviders: new Map<string, { provideDocumentSymbols: (...args: any[]) => Promise<unknown> }>(),
  inlayHintsProviders: new Map<string, { provideInlayHints: (...args: any[]) => Promise<unknown> }>(),
  semanticTokensProviders: new Map<string, { provideDocumentSemanticTokens: (...args: any[]) => Promise<unknown> }>(),
  implementationProviders: new Map<string, { provideImplementation: (...args: any[]) => Promise<unknown> }>(),
  completionProviders: new Map<string, { provideCompletionItems: (...args: any[]) => Promise<unknown> }>(),
  signatureHelpProviders: new Map<string, { provideSignatureHelp: (...args: any[]) => Promise<unknown> }>(),
  markerListeners: new Set<() => void>(),
  markersByPath: new Map<string, Map<string, Array<{
    severity: number;
    message: string;
    startLineNumber: number;
    startColumn: number;
    endLineNumber?: number;
    endColumn?: number;
  }>>>(),
  models: new Map<string, FakeModel>(),
  setMarkers(
    path: string,
    markers: Array<{
      severity: number;
      message: string;
      startLineNumber: number;
      startColumn: number;
      endLineNumber?: number;
      endColumn?: number;
    }>,
    owner = '__test__',
  ) {
    const markersByOwner = this.markersByPath.get(path) ?? new Map();
    markersByOwner.set(owner, markers);
    this.markersByPath.set(path, markersByOwner);
    for (const listener of Array.from(this.markerListeners)) {
      listener();
    }
  },
  getMarkers(path: string) {
    return Array.from(this.markersByPath.get(path)?.values() ?? []).flat();
  },
  reset() {
    this.lastDiffModel = null;
    this.lastEditorModel = null;
    this.lastEditorOptions = null;
    this.lastDiffEditorOptions = null;
    this.definitionProviders.clear();
    this.hoverProviders.clear();
    this.referenceProviders.clear();
    this.documentHighlightProviders.clear();
    this.documentSymbolProviders.clear();
    this.inlayHintsProviders.clear();
    this.semanticTokensProviders.clear();
    this.implementationProviders.clear();
    this.completionProviders.clear();
    this.signatureHelpProviders.clear();
    this.markerListeners.clear();
    this.markersByPath.clear();
    this.models.clear();
  },
};

const fakeMonaco = {
  MarkerSeverity: {
    Hint: 1,
    Info: 2,
    Warning: 4,
    Error: 8,
  },
  languages: {
    DocumentHighlightKind: {
      Text: 0,
      Read: 1,
      Write: 2,
    },
    InlayHintKind: {
      Type: 1,
      Parameter: 2,
    },
    registerDefinitionProvider: vi.fn((language: string, provider: { provideDefinition: (...args: any[]) => Promise<unknown> }) => {
      fakeMonacoState.definitionProviders.set(language, provider);
      return { dispose: vi.fn() };
    }),
    registerHoverProvider: vi.fn((language: string, provider: { provideHover: (...args: any[]) => Promise<unknown> }) => {
      fakeMonacoState.hoverProviders.set(language, provider);
      return { dispose: vi.fn() };
    }),
    registerReferenceProvider: vi.fn((language: string, provider: { provideReferences: (...args: any[]) => Promise<unknown> }) => {
      fakeMonacoState.referenceProviders.set(language, provider);
      return { dispose: vi.fn() };
    }),
    registerDocumentHighlightProvider: vi.fn((language: string, provider: { provideDocumentHighlights: (...args: any[]) => Promise<unknown> }) => {
      fakeMonacoState.documentHighlightProviders.set(language, provider);
      return { dispose: vi.fn() };
    }),
    registerDocumentSymbolProvider: vi.fn((language: string, provider: { provideDocumentSymbols: (...args: any[]) => Promise<unknown> }) => {
      fakeMonacoState.documentSymbolProviders.set(language, provider);
      return { dispose: vi.fn() };
    }),
    registerInlayHintsProvider: vi.fn((language: string, provider: { provideInlayHints: (...args: any[]) => Promise<unknown> }) => {
      fakeMonacoState.inlayHintsProviders.set(language, provider);
      return { dispose: vi.fn() };
    }),
    registerDocumentSemanticTokensProvider: vi.fn((language: string, provider: { provideDocumentSemanticTokens: (...args: any[]) => Promise<unknown> }) => {
      fakeMonacoState.semanticTokensProviders.set(language, provider);
      return { dispose: vi.fn() };
    }),
    registerImplementationProvider: vi.fn((language: string, provider: { provideImplementation: (...args: any[]) => Promise<unknown> }) => {
      fakeMonacoState.implementationProviders.set(language, provider);
      return { dispose: vi.fn() };
    }),
    registerCompletionItemProvider: vi.fn((language: string, provider: { provideCompletionItems: (...args: any[]) => Promise<unknown> }) => {
      fakeMonacoState.completionProviders.set(language, provider);
      return { dispose: vi.fn() };
    }),
    registerSignatureHelpProvider: vi.fn((language: string, provider: { provideSignatureHelp: (...args: any[]) => Promise<unknown> }) => {
      fakeMonacoState.signatureHelpProviders.set(language, provider);
      return { dispose: vi.fn() };
    }),
  },
  KeyCode: {
    KeyS: 49,
    KeyF: 33,
    KeyH: 35,
    F2: 60,
    F12: 70,
  },
  KeyMod: {
    CtrlCmd: 2048,
    Shift: 1024,
    Alt: 512,
  },
  Uri: {
    file: (path: string) => ({
      path,
      fsPath: path,
      toString: () => `file://${path}`,
    }),
    parse: (value: string) => {
      const parsedPath = decodeURIComponent(value.split('://')[1] ?? value);
      return {
        path: parsedPath,
        toString: () => value,
      };
    },
  },
  editor: {
    create: vi.fn((_element: HTMLElement, options?: Record<string, unknown>) => {
      fakeMonacoState.lastEditorOptions = options ?? null;
      return createFakeEditor();
    }),
    createDiffEditor: vi.fn((_element: HTMLElement, options?: Record<string, unknown>) => {
      fakeMonacoState.lastDiffEditorOptions = options ?? null;
      return createFakeDiffEditor();
    }),
    createModel: vi.fn((content: string, language: string, uri: { path: string; fsPath?: string; toString?: () => string }) => {
      const model = new FakeModel(content, language, uri);
      fakeMonacoState.models.set(uri.path, model);
      return model;
    }),
    setModelLanguage: vi.fn((model: FakeModel, language: string) => {
      model.setLanguage(language);
    }),
    setModelMarkers: vi.fn((model: FakeModel, owner: string, markers: Array<{
      severity: number;
      message: string;
      startLineNumber: number;
      startColumn: number;
      endLineNumber?: number;
      endColumn?: number;
    }>) => {
      fakeMonacoState.setMarkers(model.uri.path, markers, owner);
    }),
    getModelMarkers: vi.fn(({ resource }: { resource: { path: string } }) => (
      fakeMonacoState.getMarkers(resource.path)
    )),
    onDidChangeMarkers: vi.fn((listener: () => void) => {
      fakeMonacoState.markerListeners.add(listener);
      return {
        dispose: () => {
          fakeMonacoState.markerListeners.delete(listener);
        },
      };
    }),
    defineTheme: vi.fn(),
    setTheme: vi.fn(),
  },
};

vi.mock('../../utils/monacoEnvironment', () => ({
  ensureMonacoEnvironment: hoisted.ensureMonacoEnvironmentMock,
}));

function createPane(overrides?: Partial<NonNullable<Pane['code']>>): Pane {
  const rootPath = '/workspace/project';

  return {
    id: 'pane-code-1',
    kind: 'code',
    cwd: rootPath,
    command: '',
    status: WindowStatus.Paused,
    pid: null,
    code: {
      rootPath,
      openFiles: [],
      activeFilePath: null,
      selectedPath: null,
      viewMode: 'editor',
      diffTargetPath: null,
      ...overrides,
    },
  };
}

function mergePane(current: Pane, updates: Partial<Pane>): Pane {
  return {
    ...current,
    ...updates,
    code: updates.code
      ? {
        ...current.code,
        ...updates.code,
      }
      : current.code,
  };
}

function renderCodePane(initialPane: Pane) {
  let latestPane = initialPane;

  function Harness() {
    const [pane, setPane] = React.useState(initialPane);
    latestPane = pane;
    updatePaneImpl = (_windowId, _paneId, updates) => {
      setPane((current) => mergePane(current, updates));
    };

    return (
      <CodePane
        windowId="win-code-1"
        pane={pane}
        isActive
        onActivate={vi.fn()}
        onClose={vi.fn()}
      />
    );
  }

  const view = render(<Harness />);
  return {
    ...view,
    getPane: () => latestPane,
  };
}

async function openFileFromTree(fileName: string, options?: { doubleClick?: boolean }) {
  const treeButton = await screen.findByRole('button', { name: fileName }, { timeout: 3000 });
  await act(async () => {
    if (options?.doubleClick) {
      fireEvent.doubleClick(treeButton);
    } else {
      fireEvent.click(treeButton);
    }
  });
}

async function triggerEditorAction(actionLabel: string) {
  const user = userEvent.setup();
  const menuTrigger = await screen.findByRole('button', { name: 'codePane.editorActionsMenu' }, { timeout: 3000 });
  await user.click(menuTrigger);

  const menuItem = await screen.findByRole('menuitem', { name: actionLabel }, { timeout: 3000 });
  await user.click(menuItem);
}

async function emitFsChanged(payload: CodePaneFsChangedPayload) {
  const callback = vi.mocked(window.electronAPI.onCodePaneFsChanged).mock.calls.at(-1)?.[0];
  if (!callback) {
    throw new Error('expected file system change listener to be registered');
  }

  await act(async () => {
    callback({}, payload);
    await Promise.resolve();
  });
}

async function emitFsChangedAndFlush(payload: CodePaneFsChangedPayload, advanceMs = 48) {
  await emitFsChanged(payload);

  await act(async () => {
    vi.advanceTimersByTime(advanceMs);
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function emitDiagnosticsChanged(payload: {
  rootPath: string;
  filePath: string;
  diagnostics: Array<{
    filePath: string;
    owner: string;
    severity: 'hint' | 'info' | 'warning' | 'error';
    message: string;
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
    source?: string;
    code?: string;
  }>;
}) {
  const callback = vi.mocked(window.electronAPI.onCodePaneDiagnosticsChanged).mock.calls.at(-1)?.[0];
  if (!callback) {
    throw new Error('expected diagnostics listener to be registered');
  }

  await act(async () => {
    callback({}, payload);
    await Promise.resolve();
  });
}

async function emitIndexProgress(payload: CodePaneIndexProgressPayload) {
  const callback = vi.mocked(window.electronAPI.onCodePaneIndexProgress).mock.calls.at(-1)?.[0];
  if (!callback) {
    throw new Error('expected index progress listener to be registered');
  }

  await act(async () => {
    callback({}, payload);
    await Promise.resolve();
  });
}

async function emitLanguageWorkspaceChanged(payload: CodePaneLanguageWorkspaceChangedPayload) {
  const callback = vi.mocked(window.electronAPI.onCodePaneLanguageWorkspaceChanged).mock.calls.at(-1)?.[0];
  if (!callback) {
    throw new Error('expected language workspace listener to be registered');
  }

  await act(async () => {
    callback({}, payload);
    await Promise.resolve();
  });
}

async function emitRunSessionChanged(payload: {
  rootPath: string;
  session: {
    id: string;
    targetId: string;
    label: string;
    detail: string;
    kind: 'application' | 'test' | 'task';
    languageId: string;
    state: 'starting' | 'running' | 'passed' | 'failed' | 'stopped';
    workingDirectory: string;
    startedAt: string;
    endedAt?: string;
    exitCode?: number | null;
  };
}) {
  const callback = vi.mocked(window.electronAPI.onCodePaneRunSessionChanged).mock.calls.at(-1)?.[0];
  if (!callback) {
    throw new Error('expected run session listener to be registered');
  }

  await act(async () => {
    callback({}, payload);
    await Promise.resolve();
  });
}

async function emitRunSessionOutput(payload: {
  rootPath: string;
  sessionId: string;
  chunk: string;
  stream: 'stdout' | 'stderr' | 'system';
}) {
  const callback = vi.mocked(window.electronAPI.onCodePaneRunSessionOutput).mock.calls.at(-1)?.[0];
  if (!callback) {
    throw new Error('expected run session output listener to be registered');
  }

  await act(async () => {
    callback({}, payload);
    await Promise.resolve();
  });
}

async function emitDebugSessionChanged(payload: {
  rootPath: string;
    session: {
      id: string;
      targetId: string;
      label: string;
      detail: string;
      languageId: string;
      adapterType: string;
      request?: 'launch' | 'attach';
      state: 'starting' | 'paused' | 'running' | 'stopped' | 'error';
      workingDirectory: string;
    startedAt: string;
    endedAt?: string;
    stopReason?: string;
    currentFrame?: {
      id: string;
      name: string;
      filePath?: string;
      lineNumber?: number;
      column?: number;
    } | null;
  };
}) {
  const callback = vi.mocked(window.electronAPI.onCodePaneDebugSessionChanged).mock.calls.at(-1)?.[0];
  if (!callback) {
    throw new Error('expected debug session listener to be registered');
  }

  await act(async () => {
    callback({}, payload);
    await Promise.resolve();
  });
}

async function emitDebugSessionOutput(payload: {
  rootPath: string;
  sessionId: string;
  chunk: string;
  stream: 'stdout' | 'stderr' | 'system';
}) {
  const callback = vi.mocked(window.electronAPI.onCodePaneDebugSessionOutput).mock.calls.at(-1)?.[0];
  if (!callback) {
    throw new Error('expected debug session output listener to be registered');
  }

  await act(async () => {
    callback({}, payload);
    await Promise.resolve();
  });
}

describe('CodePane', () => {
  beforeAll(() => {
    vi.stubGlobal('Worker', class WorkerMock {});
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    resetMonacoLanguageBridgeForTests();
    resetCodePaneProjectCacheForTests();
    fakeMonacoState.reset();
    updatePaneImpl = null;
    hoisted.updatePaneSpy.mockReset();
    hoisted.ensureMonacoEnvironmentMock.mockReset();
    hoisted.updatePaneSpy.mockImplementation((windowId: string, paneId: string, updates: Partial<Pane>) => {
      updatePaneImpl?.(windowId, paneId, updates);
    });
    hoisted.ensureMonacoEnvironmentMock.mockImplementation(async () => fakeMonaco);

    vi.mocked(window.electronAPI.codePaneListDirectory).mockReset();
    vi.mocked(window.electronAPI.codePaneReadFile).mockReset();
    vi.mocked(window.electronAPI.codePaneWriteFile).mockReset();
    vi.mocked(window.electronAPI.codePaneCreateFile).mockReset();
    vi.mocked(window.electronAPI.codePaneCreateDirectory).mockReset();
    vi.mocked(window.electronAPI.codePaneRenamePath).mockReset();
    vi.mocked(window.electronAPI.codePaneGetExternalLibrarySections).mockReset();
    vi.mocked(window.electronAPI.codePaneGetGitStatus).mockReset();
    vi.mocked(window.electronAPI.codePaneGetGitRepositorySummary).mockReset();
    vi.mocked(window.electronAPI.codePaneGetGitGraph).mockReset();
    vi.mocked(window.electronAPI.codePaneGetGitCommitDetails).mockReset();
    vi.mocked(window.electronAPI.codePaneCompareGitCommits).mockReset();
    vi.mocked(window.electronAPI.codePaneGetGitDiffHunks).mockReset();
    vi.mocked(window.electronAPI.codePaneGitStage).mockReset();
    vi.mocked(window.electronAPI.codePaneGitUnstage).mockReset();
    vi.mocked(window.electronAPI.codePaneGitRemove).mockReset();
    vi.mocked(window.electronAPI.codePaneGitDiscard).mockReset();
    vi.mocked(window.electronAPI.codePaneGitStageHunk).mockReset();
    vi.mocked(window.electronAPI.codePaneGitUnstageHunk).mockReset();
    vi.mocked(window.electronAPI.codePaneGitDiscardHunk).mockReset();
    vi.mocked(window.electronAPI.codePaneGitCommit).mockReset();
    vi.mocked(window.electronAPI.codePaneGitStash).mockReset();
    vi.mocked(window.electronAPI.codePaneGitUpdateProject).mockReset();
    vi.mocked(window.electronAPI.codePaneGitCheckout).mockReset();
    vi.mocked(window.electronAPI.codePaneGetGitBranches).mockReset();
    vi.mocked(window.electronAPI.codePaneGitRenameBranch).mockReset();
    vi.mocked(window.electronAPI.codePaneGitDeleteBranch).mockReset();
    vi.mocked(window.electronAPI.codePaneGetGitRebasePlan).mockReset();
    vi.mocked(window.electronAPI.codePaneGitApplyRebasePlan).mockReset();
    vi.mocked(window.electronAPI.codePaneGitCherryPick).mockReset();
    vi.mocked(window.electronAPI.codePaneGitRebaseControl).mockReset();
    vi.mocked(window.electronAPI.codePaneGitResolveConflict).mockReset();
    vi.mocked(window.electronAPI.codePaneGetGitConflictDetails).mockReset();
    vi.mocked(window.electronAPI.codePaneGitApplyConflictResolution).mockReset();
    vi.mocked(window.electronAPI.codePaneGitHistory).mockReset();
    vi.mocked(window.electronAPI.codePaneGitBlame).mockReset();
    vi.mocked(window.electronAPI.codePaneReadGitBaseFile).mockReset();
    vi.mocked(window.electronAPI.codePaneReadGitRevisionFile).mockReset();
    vi.mocked(window.electronAPI.codePaneWatchRoot).mockReset();
    vi.mocked(window.electronAPI.codePaneUnwatchRoot).mockReset();
    vi.mocked(window.electronAPI.codePaneSearchFiles).mockReset();
    vi.mocked(window.electronAPI.codePaneSearchContents).mockReset();
    vi.mocked(window.electronAPI.codePaneDidOpenDocument).mockReset();
    vi.mocked(window.electronAPI.codePaneDidChangeDocument).mockReset();
    vi.mocked(window.electronAPI.codePaneDidSaveDocument).mockReset();
    vi.mocked(window.electronAPI.codePaneDidCloseDocument).mockReset();
    vi.mocked(window.electronAPI.codePanePrewarmLanguageWorkspace).mockReset();
    vi.mocked(window.electronAPI.codePaneAttachLanguageWorkspace).mockReset();
    vi.mocked(window.electronAPI.codePaneGetLanguageWorkspaceState).mockReset();
    vi.mocked(window.electronAPI.codePaneDetachLanguageWorkspace).mockReset();
    vi.mocked(window.electronAPI.codePaneGetDefinition).mockReset();
    vi.mocked(window.electronAPI.codePaneGetHover).mockReset();
    vi.mocked(window.electronAPI.codePaneGetReferences).mockReset();
    vi.mocked(window.electronAPI.codePaneGetDocumentHighlights).mockReset();
    vi.mocked(window.electronAPI.codePaneGetDocumentSymbols).mockReset();
    vi.mocked(window.electronAPI.codePaneGetInlayHints).mockReset();
    vi.mocked(window.electronAPI.codePaneGetCallHierarchy).mockReset();
    vi.mocked(window.electronAPI.codePaneResolveCallHierarchy).mockReset();
    vi.mocked(window.electronAPI.codePaneGetTypeHierarchy).mockReset();
    vi.mocked(window.electronAPI.codePaneResolveTypeHierarchy).mockReset();
    vi.mocked(window.electronAPI.codePaneGetSemanticTokens).mockReset();
    vi.mocked(window.electronAPI.codePaneGetSemanticTokenLegend).mockReset();
    vi.mocked(window.electronAPI.codePaneGetImplementations).mockReset();
    vi.mocked(window.electronAPI.codePaneGetCompletionItems).mockReset();
    vi.mocked(window.electronAPI.codePaneGetSignatureHelp).mockReset();
    vi.mocked(window.electronAPI.codePaneRenameSymbol).mockReset();
    vi.mocked(window.electronAPI.codePaneFormatDocument).mockReset();
    vi.mocked(window.electronAPI.codePaneLintDocument).mockReset();
    vi.mocked(window.electronAPI.codePaneGetWorkspaceSymbols).mockReset();
    vi.mocked(window.electronAPI.codePaneGetCodeActions).mockReset();
    vi.mocked(window.electronAPI.codePaneRunCodeAction).mockReset();
    vi.mocked(window.electronAPI.codePanePrepareRefactor).mockReset();
    vi.mocked(window.electronAPI.codePaneApplyRefactor).mockReset();
    vi.mocked(window.electronAPI.codePaneListRunTargets).mockReset();
    vi.mocked(window.electronAPI.codePaneRunTarget).mockReset();
    vi.mocked(window.electronAPI.codePaneStopRunTarget).mockReset();
    vi.mocked(window.electronAPI.codePaneDebugStart).mockReset();
    vi.mocked(window.electronAPI.codePaneDebugStop).mockReset();
    vi.mocked(window.electronAPI.codePaneDebugPause).mockReset();
    vi.mocked(window.electronAPI.codePaneDebugContinue).mockReset();
    vi.mocked(window.electronAPI.codePaneDebugStepOver).mockReset();
    vi.mocked(window.electronAPI.codePaneDebugStepInto).mockReset();
    vi.mocked(window.electronAPI.codePaneDebugStepOut).mockReset();
    vi.mocked(window.electronAPI.codePaneListDebugSessions).mockReset();
    vi.mocked(window.electronAPI.codePaneGetDebugSessionDetails).mockReset();
    vi.mocked(window.electronAPI.codePaneDebugEvaluate).mockReset();
    vi.mocked(window.electronAPI.codePaneSetBreakpoint).mockReset();
    vi.mocked(window.electronAPI.codePaneRemoveBreakpoint).mockReset();
    vi.mocked(window.electronAPI.codePaneGetExceptionBreakpoints).mockReset();
    vi.mocked(window.electronAPI.codePaneSetExceptionBreakpoints).mockReset();
    vi.mocked(window.electronAPI.codePaneListTests).mockReset();
    vi.mocked(window.electronAPI.codePaneRunTests).mockReset();
    vi.mocked(window.electronAPI.codePaneRerunFailedTests).mockReset();
    vi.mocked(window.electronAPI.codePaneGetProjectContribution).mockReset();
    vi.mocked(window.electronAPI.codePaneRefreshProjectModel).mockReset();
    vi.mocked(window.electronAPI.codePaneRunProjectCommand).mockReset();
    vi.mocked(window.electronAPI.onCodePaneFsChanged).mockReset();
    vi.mocked(window.electronAPI.offCodePaneFsChanged).mockReset();
    vi.mocked(window.electronAPI.onCodePaneIndexProgress).mockReset();
    vi.mocked(window.electronAPI.offCodePaneIndexProgress).mockReset();
    vi.mocked(window.electronAPI.onCodePaneRunSessionChanged).mockReset();
    vi.mocked(window.electronAPI.offCodePaneRunSessionChanged).mockReset();
    vi.mocked(window.electronAPI.onCodePaneRunSessionOutput).mockReset();
    vi.mocked(window.electronAPI.offCodePaneRunSessionOutput).mockReset();
    vi.mocked(window.electronAPI.onCodePaneDebugSessionChanged).mockReset();
    vi.mocked(window.electronAPI.offCodePaneDebugSessionChanged).mockReset();
    vi.mocked(window.electronAPI.onCodePaneDebugSessionOutput).mockReset();
    vi.mocked(window.electronAPI.offCodePaneDebugSessionOutput).mockReset();
    vi.mocked(window.electronAPI.onCodePaneDiagnosticsChanged).mockReset();
    vi.mocked(window.electronAPI.offCodePaneDiagnosticsChanged).mockReset();
    vi.mocked(window.electronAPI.onCodePaneLanguageWorkspaceChanged).mockReset();
    vi.mocked(window.electronAPI.offCodePaneLanguageWorkspaceChanged).mockReset();
    vi.mocked(window.electronAPI.openFolder).mockReset();
    vi.mocked(window.electronAPI.writeClipboardText).mockReset();

    vi.mocked(window.electronAPI.codePaneListDirectory).mockResolvedValue({
      success: true,
      data: [
        {
          path: '/workspace/project/src/index.ts',
          name: 'index.ts',
          type: 'file',
        },
      ],
    });
    vi.mocked(window.electronAPI.codePaneReadFile).mockResolvedValue({
      success: true,
      data: {
        content: 'export const value = 1;\n',
        mtimeMs: 100,
        size: 24,
        language: 'typescript',
        isBinary: false,
      },
    });
    vi.mocked(window.electronAPI.codePaneWriteFile).mockResolvedValue({
      success: true,
      data: {
        mtimeMs: 200,
      },
    });
    vi.mocked(window.electronAPI.codePaneCreateFile).mockResolvedValue({
      success: true,
      data: {
        path: '/workspace/project/src/new-file.ts',
        name: 'new-file.ts',
        type: 'file',
        size: 0,
        mtimeMs: 300,
      },
    });
    vi.mocked(window.electronAPI.codePaneCreateDirectory).mockResolvedValue({
      success: true,
      data: {
        path: '/workspace/project/src/new-folder',
        name: 'new-folder',
        type: 'directory',
        mtimeMs: 301,
        hasChildren: true,
      },
    });
    vi.mocked(window.electronAPI.codePaneRenamePath).mockResolvedValue({
      success: true,
      data: {
        path: '/workspace/project/src/renamed-index.ts',
        name: 'renamed-index.ts',
        type: 'file',
        size: 24,
        mtimeMs: 302,
      },
    });
    vi.mocked(window.electronAPI.codePaneGetExternalLibrarySections).mockResolvedValue({
      success: true,
      data: [],
    });
    vi.mocked(window.electronAPI.codePaneGetGitStatus).mockResolvedValue({
      success: true,
      data: [],
    });
    vi.mocked(window.electronAPI.codePaneGetGitRepositorySummary).mockResolvedValue({
      success: true,
      data: {
        repoRootPath: '/workspace/project',
        currentBranch: 'main',
        upstreamBranch: 'origin/main',
        detachedHead: false,
        headSha: '1234567890abcdef',
        aheadCount: 0,
        behindCount: 0,
        operation: 'idle',
        hasConflicts: false,
      },
    });
    vi.mocked(window.electronAPI.codePaneGetGitGraph).mockResolvedValue({
      success: true,
      data: [],
    });
    vi.mocked(window.electronAPI.codePaneGetGitCommitDetails).mockResolvedValue({
      success: true,
      data: {
        commitSha: 'abcdef1234567890',
        shortSha: 'abcdef1',
        subject: 'Commit summary',
        author: 'Test User',
        email: 'test@example.com',
        timestamp: 1_710_000_000,
        refs: [],
        files: [],
      },
    });
    vi.mocked(window.electronAPI.codePaneCompareGitCommits).mockResolvedValue({
      success: true,
      data: {
        baseCommitSha: 'abcdef1234567890',
        targetCommitSha: '1234567890abcdef',
        files: [],
      },
    });
    vi.mocked(window.electronAPI.codePaneGetGitDiffHunks).mockResolvedValue({
      success: true,
      data: {
        filePath: '/workspace/project/src/index.ts',
        stagedHunks: [],
        unstagedHunks: [],
      },
    });
    vi.mocked(window.electronAPI.codePaneGitStage).mockResolvedValue({ success: true });
    vi.mocked(window.electronAPI.codePaneGitUnstage).mockResolvedValue({ success: true });
    vi.mocked(window.electronAPI.codePaneGitRemove).mockResolvedValue({ success: true });
    vi.mocked(window.electronAPI.codePaneGitDiscard).mockResolvedValue({ success: true });
    vi.mocked(window.electronAPI.codePaneGitStageHunk).mockResolvedValue({ success: true });
    vi.mocked(window.electronAPI.codePaneGitUnstageHunk).mockResolvedValue({ success: true });
    vi.mocked(window.electronAPI.codePaneGitDiscardHunk).mockResolvedValue({ success: true });
    vi.mocked(window.electronAPI.codePaneGitCommit).mockResolvedValue({
      success: true,
      data: {
        commitSha: 'abcdef1234567890',
        shortSha: 'abcdef1',
        summary: 'Commit summary',
      },
    });
    vi.mocked(window.electronAPI.codePaneGitStash).mockResolvedValue({
      success: true,
      data: {
        reference: 'stash@{0}',
        message: 'WIP',
      },
    });
    vi.mocked(window.electronAPI.codePaneGitUpdateProject).mockResolvedValue({
      success: true,
      data: {
        mode: 'fetch',
      },
    });
    vi.mocked(window.electronAPI.codePaneGitCheckout).mockResolvedValue({ success: true });
    vi.mocked(window.electronAPI.codePaneGetGitBranches).mockResolvedValue({
      success: true,
      data: [],
    });
    vi.mocked(window.electronAPI.codePaneGitRenameBranch).mockResolvedValue({ success: true });
    vi.mocked(window.electronAPI.codePaneGitDeleteBranch).mockResolvedValue({ success: true });
    vi.mocked(window.electronAPI.codePaneGetGitRebasePlan).mockResolvedValue({
      success: true,
      data: {
        baseRef: 'origin/main',
        currentBranch: 'main',
        hasMergeCommits: false,
        commits: [],
      },
    });
    vi.mocked(window.electronAPI.codePaneGitApplyRebasePlan).mockResolvedValue({ success: true });
    vi.mocked(window.electronAPI.codePaneGitCherryPick).mockResolvedValue({ success: true });
    vi.mocked(window.electronAPI.codePaneGitRebaseControl).mockResolvedValue({ success: true });
    vi.mocked(window.electronAPI.codePaneGitResolveConflict).mockResolvedValue({ success: true });
    vi.mocked(window.electronAPI.codePaneGetGitConflictDetails).mockResolvedValue({ success: true, data: null });
    vi.mocked(window.electronAPI.codePaneGitApplyConflictResolution).mockResolvedValue({ success: true });
    vi.mocked(window.electronAPI.codePaneGitHistory).mockResolvedValue({
      success: true,
      data: {
        scope: 'file',
        targetFilePath: '/workspace/project/src/index.ts',
        entries: [],
      },
    });
    vi.mocked(window.electronAPI.codePaneGitBlame).mockResolvedValue({ success: true, data: [] });
    vi.mocked(window.electronAPI.codePaneReadGitBaseFile).mockResolvedValue({
      success: true,
      data: {
        content: 'export const value = 0;\n',
        existsInHead: true,
      },
    });
    vi.mocked(window.electronAPI.codePaneReadGitRevisionFile).mockResolvedValue({
      success: true,
      data: {
        content: 'export const value = 0;\n',
        exists: true,
      },
    });
    vi.mocked(window.electronAPI.codePaneWatchRoot).mockResolvedValue({ success: true });
    vi.mocked(window.electronAPI.codePaneUnwatchRoot).mockResolvedValue({ success: true });
    vi.mocked(window.electronAPI.codePaneSearchFiles).mockResolvedValue({ success: true, data: [] });
    vi.mocked(window.electronAPI.codePaneSearchContents).mockResolvedValue({ success: true, data: [] });
    vi.mocked(window.electronAPI.codePaneDidOpenDocument).mockResolvedValue({ success: true });
    vi.mocked(window.electronAPI.codePaneDidChangeDocument).mockResolvedValue({ success: true });
    vi.mocked(window.electronAPI.codePaneDidSaveDocument).mockResolvedValue({ success: true });
    vi.mocked(window.electronAPI.codePaneDidCloseDocument).mockResolvedValue({ success: true });
    vi.mocked(window.electronAPI.codePanePrewarmLanguageWorkspace).mockResolvedValue({ success: true });
    vi.mocked(window.electronAPI.codePaneAttachLanguageWorkspace).mockResolvedValue({ success: true, data: null });
    vi.mocked(window.electronAPI.codePaneGetLanguageWorkspaceState).mockResolvedValue({ success: true, data: null });
    vi.mocked(window.electronAPI.codePaneDetachLanguageWorkspace).mockResolvedValue({ success: true });
    vi.mocked(window.electronAPI.codePaneGetDefinition).mockResolvedValue({ success: true, data: [] });
    vi.mocked(window.electronAPI.codePaneGetHover).mockResolvedValue({ success: true, data: null });
    vi.mocked(window.electronAPI.codePaneGetReferences).mockResolvedValue({ success: true, data: [] });
    vi.mocked(window.electronAPI.codePaneGetDocumentHighlights).mockResolvedValue({ success: true, data: [] });
    vi.mocked(window.electronAPI.codePaneGetDocumentSymbols).mockResolvedValue({ success: true, data: [] });
    vi.mocked(window.electronAPI.codePaneGetInlayHints).mockResolvedValue({ success: true, data: [] });
    vi.mocked(window.electronAPI.codePaneGetCallHierarchy).mockResolvedValue({
      success: true,
      data: {
        root: null,
        items: [],
      },
    });
    vi.mocked(window.electronAPI.codePaneResolveCallHierarchy).mockResolvedValue({ success: true, data: [] });
    vi.mocked(window.electronAPI.codePaneGetTypeHierarchy).mockResolvedValue({
      success: true,
      data: {
        root: null,
        items: [],
      },
    });
    vi.mocked(window.electronAPI.codePaneResolveTypeHierarchy).mockResolvedValue({ success: true, data: [] });
    vi.mocked(window.electronAPI.codePaneGetSemanticTokens).mockResolvedValue({ success: true, data: null });
    vi.mocked(window.electronAPI.codePaneGetSemanticTokenLegend).mockResolvedValue({ success: true, data: null });
    vi.mocked(window.electronAPI.codePaneGetImplementations).mockResolvedValue({ success: true, data: [] });
    vi.mocked(window.electronAPI.codePaneGetCompletionItems).mockResolvedValue({ success: true, data: [] });
    vi.mocked(window.electronAPI.codePaneGetSignatureHelp).mockResolvedValue({ success: true, data: null });
    vi.mocked(window.electronAPI.codePaneRenameSymbol).mockResolvedValue({ success: true, data: [] });
    vi.mocked(window.electronAPI.codePaneFormatDocument).mockResolvedValue({ success: true, data: [] });
    vi.mocked(window.electronAPI.codePaneLintDocument).mockResolvedValue({ success: true, data: [] });
    vi.mocked(window.electronAPI.codePaneGetWorkspaceSymbols).mockResolvedValue({ success: true, data: [] });
    vi.mocked(window.electronAPI.codePaneGetCodeActions).mockResolvedValue({ success: true, data: [] });
    vi.mocked(window.electronAPI.codePaneRunCodeAction).mockResolvedValue({ success: true, data: [] });
    vi.mocked(window.electronAPI.codePanePrepareRefactor).mockResolvedValue({ success: true, data: null });
    vi.mocked(window.electronAPI.codePaneApplyRefactor).mockResolvedValue({ success: true, data: null });
    vi.mocked(window.electronAPI.codePaneListRunTargets).mockResolvedValue({ success: true, data: [] });
    vi.mocked(window.electronAPI.codePaneRunTarget).mockResolvedValue({ success: true, data: null });
    vi.mocked(window.electronAPI.codePaneStopRunTarget).mockResolvedValue({ success: true });
    vi.mocked(window.electronAPI.codePaneDebugStart).mockResolvedValue({ success: true, data: null });
    vi.mocked(window.electronAPI.codePaneDebugStop).mockResolvedValue({ success: true });
    vi.mocked(window.electronAPI.codePaneDebugPause).mockResolvedValue({ success: true });
    vi.mocked(window.electronAPI.codePaneDebugContinue).mockResolvedValue({ success: true });
    vi.mocked(window.electronAPI.codePaneDebugStepOver).mockResolvedValue({ success: true });
    vi.mocked(window.electronAPI.codePaneDebugStepInto).mockResolvedValue({ success: true });
    vi.mocked(window.electronAPI.codePaneDebugStepOut).mockResolvedValue({ success: true });
    vi.mocked(window.electronAPI.codePaneListDebugSessions).mockResolvedValue({ success: true, data: [] });
    vi.mocked(window.electronAPI.codePaneGetDebugSessionDetails).mockResolvedValue({
      success: true,
      data: {
        sessionId: 'debug-session-1',
        stackFrames: [],
        scopes: [],
      },
    });
    vi.mocked(window.electronAPI.codePaneDebugEvaluate).mockResolvedValue({
      success: true,
      data: {
        value: '1',
      },
    });
    vi.mocked(window.electronAPI.codePaneSetBreakpoint).mockResolvedValue({ success: true });
    vi.mocked(window.electronAPI.codePaneRemoveBreakpoint).mockResolvedValue({ success: true });
    vi.mocked(window.electronAPI.codePaneGetExceptionBreakpoints).mockResolvedValue({
      success: true,
      data: [{ id: 'all', label: 'All Exceptions', enabled: false }],
    });
    vi.mocked(window.electronAPI.codePaneSetExceptionBreakpoints).mockResolvedValue({ success: true });
    vi.mocked(window.electronAPI.codePaneListTests).mockResolvedValue({ success: true, data: [] });
    vi.mocked(window.electronAPI.codePaneRunTests).mockResolvedValue({ success: true, data: null });
    vi.mocked(window.electronAPI.codePaneRerunFailedTests).mockResolvedValue({ success: true, data: [] });
    vi.mocked(window.electronAPI.codePaneGetProjectContribution).mockResolvedValue({ success: true, data: [] });
    vi.mocked(window.electronAPI.codePaneRefreshProjectModel).mockResolvedValue({ success: true, data: [] });
    vi.mocked(window.electronAPI.codePaneRunProjectCommand).mockResolvedValue({ success: true, data: null });
    vi.mocked(window.electronAPI.openFolder).mockResolvedValue(undefined);
    vi.mocked(window.electronAPI.writeClipboardText).mockResolvedValue(undefined);
  });

  afterEach(() => {
    updatePaneImpl = null;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('opens a file from the tree and creates a tab', async () => {
    const view = renderCodePane(createPane());

    await openFileFromTree('index.ts');

    await waitFor(() => {
      expect(window.electronAPI.codePaneReadFile).toHaveBeenCalledWith({
        rootPath: '/workspace/project',
        filePath: '/workspace/project/src/index.ts',
      });
    });
    expect(screen.getAllByText('index.ts').length).toBeGreaterThan(1);
    expect(fakeMonacoState.lastEditorModel?.getValue()).toBe('export const value = 1;\n');
  });

  it('renders external libraries and opens external files in read-only mode', async () => {
    vi.mocked(window.electronAPI.codePaneGetExternalLibrarySections).mockResolvedValue({
      success: true,
      data: [
        {
          id: 'python-external-libraries',
          label: 'External Libraries',
          languageId: 'python',
          roots: [
            {
              id: 'python-site-packages',
              label: 'site-packages',
              path: '/usr/lib/python3.12/site-packages',
            },
          ],
        },
      ],
    });
    vi.mocked(window.electronAPI.codePaneListDirectory).mockImplementation(async ({ targetPath }) => {
      if (!targetPath || targetPath === '/workspace/project') {
        return {
          success: true,
          data: [
            {
              path: '/workspace/project/src/index.ts',
              name: 'index.ts',
              type: 'file',
            },
          ],
        };
      }

      if (targetPath === '/usr/lib/python3.12/site-packages') {
        return {
          success: true,
          data: [
            {
              path: '/usr/lib/python3.12/site-packages/requests',
              name: 'requests',
              type: 'directory',
            },
          ],
        };
      }

      if (targetPath === '/usr/lib/python3.12/site-packages/requests') {
        return {
          success: true,
          data: [
            {
              path: '/usr/lib/python3.12/site-packages/requests/api.py',
              name: 'api.py',
              type: 'file',
            },
          ],
        };
      }

      return { success: true, data: [] };
    });
    vi.mocked(window.electronAPI.codePaneReadFile).mockImplementation(async ({ filePath }) => ({
      success: true,
      data: filePath === '/usr/lib/python3.12/site-packages/requests/api.py'
        ? {
            content: 'def get(url: str):\n    return url\n',
            mtimeMs: 100,
            size: 34,
            language: 'python',
            isBinary: false,
            readOnly: true,
            displayPath: 'External Libraries/Python/site-packages/requests/api.py',
          }
        : {
            content: 'export const value = 1;\n',
            mtimeMs: 100,
            size: 24,
            language: 'typescript',
            isBinary: false,
          },
    }));

    const view = renderCodePane(createPane());

    expect(await screen.findByText('codePane.externalLibraries · Python')).toBeInTheDocument();

    await act(async () => {
      fireEvent.doubleClick(screen.getByRole('button', { name: 'site-packages' }));
    });
    await act(async () => {
      fireEvent.doubleClick(await screen.findByRole('button', { name: 'requests' }));
    });
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'api.py' }));
    });

    await waitFor(() => {
      expect(window.electronAPI.codePaneReadFile).toHaveBeenCalledWith({
        rootPath: '/workspace/project',
        filePath: '/usr/lib/python3.12/site-packages/requests/api.py',
      });
    });
    expect(window.electronAPI.codePaneDidOpenDocument).not.toHaveBeenCalled();
    expect(fakeMonacoState.lastEditorModel?.getValue()).toBe('def get(url: str):\n    return url\n');
  });

  it('expands Maven jar sources from external libraries and opens source files read-only', async () => {
    const jarRootUri = 'jar://%2Fhome%2Fuser%2F.m2%2Frepository%2Fcom%2Fexample%2Fdemo%2F1.0.0%2Fdemo-1.0.0-sources.jar!/';
    const comUri = `${jarRootUri}com`;
    const exampleUri = `${jarRootUri}com/example`;
    const sourceUri = `${jarRootUri}com/example/Demo.java`;

    vi.mocked(window.electronAPI.codePaneGetExternalLibrarySections).mockResolvedValue({
      success: true,
      data: [
        {
          id: 'java-external-libraries',
          label: 'External Libraries',
          languageId: 'java',
          roots: [
            {
              id: 'maven-repository',
              label: 'Maven Repository',
              path: '/home/user/.m2/repository',
            },
          ],
        },
      ],
    });
    vi.mocked(window.electronAPI.codePaneListDirectory).mockImplementation(async ({ targetPath }) => {
      if (!targetPath || targetPath === '/workspace/project') {
        return {
          success: true,
          data: [
            {
              path: '/workspace/project/src/index.ts',
              name: 'index.ts',
              type: 'file',
            },
          ],
        };
      }

      if (targetPath === '/home/user/.m2/repository') {
        return {
          success: true,
          data: [
            {
              path: jarRootUri,
              name: 'demo-1.0.0.jar',
              type: 'directory',
              hasChildren: true,
            },
          ],
        };
      }

      if (targetPath === jarRootUri) {
        return {
          success: true,
          data: [
            {
              path: comUri,
              name: 'com',
              type: 'directory',
              hasChildren: true,
            },
          ],
        };
      }

      if (targetPath === comUri) {
        return {
          success: true,
          data: [
            {
              path: exampleUri,
              name: 'example',
              type: 'directory',
              hasChildren: true,
            },
          ],
        };
      }

      if (targetPath === exampleUri) {
        return {
          success: true,
          data: [
            {
              path: sourceUri,
              name: 'Demo.java',
              type: 'file',
            },
          ],
        };
      }

      return { success: true, data: [] };
    });
    vi.mocked(window.electronAPI.codePaneReadFile).mockImplementation(async ({ filePath }) => ({
      success: true,
      data: filePath === sourceUri
        ? {
            content: 'package com.example;\npublic class Demo {}\n',
            mtimeMs: 100,
            size: 41,
            language: 'java',
            isBinary: false,
            readOnly: true,
            documentUri: sourceUri,
            displayPath: 'External Libraries/demo-1.0.0-sources.jar/com/example/Demo.java',
          }
        : {
            content: 'export const value = 1;\n',
            mtimeMs: 100,
            size: 24,
            language: 'typescript',
            isBinary: false,
          },
    }));

    const view = renderCodePane(createPane());

    expect(await screen.findByText('codePane.externalLibraries · Java')).toBeInTheDocument();

    await act(async () => {
      fireEvent.doubleClick(screen.getByRole('button', { name: 'Maven Repository' }));
    });
    await act(async () => {
      fireEvent.doubleClick(await screen.findByRole('button', { name: 'demo-1.0.0.jar' }));
    });
    await act(async () => {
      fireEvent.doubleClick(await screen.findByRole('button', { name: 'com' }));
    });
    await act(async () => {
      fireEvent.doubleClick(await screen.findByRole('button', { name: 'example' }));
    });
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Demo.java' }));
    });

    await waitFor(() => {
      expect(window.electronAPI.codePaneReadFile).toHaveBeenCalledWith({
        rootPath: '/workspace/project',
        filePath: sourceUri,
        documentUri: sourceUri,
      });
    });
    expect(window.electronAPI.codePaneDidOpenDocument).not.toHaveBeenCalled();
    expect(fakeMonacoState.lastEditorModel?.getValue()).toBe('package com.example;\npublic class Demo {}\n');
  });

  it('does not render an outer active border', () => {
    const view = renderCodePane(createPane());
    const root = view.container.firstElementChild;

    expect(root).not.toBeNull();
    expect(root).not.toHaveClass('border');
    expect((root as HTMLElement).className).not.toContain('border-[rgb(var(--primary))]/45');
    expect((root as HTMLElement).className).not.toContain('border-zinc-800');
  });

  it('loads the file tree before Monaco finishes bootstrapping', async () => {
    let resolveMonaco: ((value: typeof fakeMonaco) => void) | null = null;
    hoisted.ensureMonacoEnvironmentMock.mockImplementation(() => new Promise((resolve) => {
      resolveMonaco = resolve as (value: typeof fakeMonaco) => void;
    }));

    const view = renderCodePane(createPane());

    expect(await screen.findByRole('button', { name: 'index.ts' }, { timeout: 3000 })).toBeInTheDocument();

    await act(async () => {
      resolveMonaco?.(fakeMonaco);
      await Promise.resolve();
    });
  });

  it('does not block initial tree rendering on background workspace tasks', async () => {
    let resolveExternalLibraries: (() => void) | null = null;
    let resolveGitStatus: (() => void) | null = null;
    let resolveGitSummary: (() => void) | null = null;

    vi.mocked(window.electronAPI.codePaneGetExternalLibrarySections).mockImplementation(() => (
      new Promise((resolve) => {
        resolveExternalLibraries = () => resolve({ success: true, data: [] });
      })
    ));
    vi.mocked(window.electronAPI.codePaneGetGitStatus).mockImplementation(() => (
      new Promise((resolve) => {
        resolveGitStatus = () => resolve({ success: true, data: [] });
      })
    ));
    vi.mocked(window.electronAPI.codePaneGetGitRepositorySummary).mockImplementation(() => (
      new Promise((resolve) => {
        resolveGitSummary = () => resolve({ success: true, data: null });
      })
    ));

    const view = renderCodePane(createPane());

    expect(await screen.findByRole('button', { name: 'index.ts' })).toBeInTheDocument();
    await waitFor(() => {
      expect(window.electronAPI.codePaneAttachLanguageWorkspace).toHaveBeenCalledWith({
        paneId: 'pane-code-1',
        rootPath: '/workspace/project',
        filePath: '/workspace/project/src/index.ts',
      });
    });

    await act(async () => {
      resolveExternalLibraries?.();
      resolveGitStatus?.();
      resolveGitSummary?.();
      await Promise.resolve();
    });
  });

  it('reuses cached external libraries when opening a second pane for the same project', async () => {
    vi.mocked(window.electronAPI.codePaneGetExternalLibrarySections).mockResolvedValue({
      success: true,
      data: [
        {
          id: 'java-external-libraries',
          label: 'External Libraries',
          languageId: 'java',
          roots: [
            {
              id: 'maven-cache',
              label: 'Maven',
              path: '/home/user/.m2/repository',
            },
          ],
        },
      ],
    });

    const firstView = renderCodePane(createPane());
    expect(await screen.findByText('codePane.externalLibraries · Java')).toBeInTheDocument();
    await waitFor(() => {
      expect(window.electronAPI.codePaneGetExternalLibrarySections).toHaveBeenCalledTimes(1);
    });
    firstView.unmount();

    vi.mocked(window.electronAPI.codePaneGetExternalLibrarySections).mockClear();

    renderCodePane(createPane({
      activeFilePath: '/workspace/project/src/index.ts',
      openFiles: [{ path: '/workspace/project/src/index.ts' }],
      selectedPath: '/workspace/project/src/index.ts',
    }));

    expect(await screen.findByText('codePane.externalLibraries · Java')).toBeInTheDocument();
    expect(window.electronAPI.codePaneGetExternalLibrarySections).not.toHaveBeenCalled();
  });

  it('reuses cached git snapshot when opening a second pane for the same project', async () => {
    vi.mocked(window.electronAPI.codePaneGetGitStatus).mockResolvedValue({
      success: true,
      data: [
        {
          path: '/workspace/project/src/index.ts',
          status: 'modified',
          unstaged: true,
          section: 'unstaged',
        },
      ],
    });
    vi.mocked(window.electronAPI.codePaneGetGitRepositorySummary).mockResolvedValue({
      success: true,
      data: {
        repoRootPath: '/workspace/project',
        currentBranch: 'feature/cache',
        upstreamBranch: 'origin/feature/cache',
        detachedHead: false,
        headSha: '1234567890abcdef',
        aheadCount: 1,
        behindCount: 0,
        operation: 'idle',
        hasConflicts: false,
      },
    });

    const firstView = renderCodePane(createPane());
    await waitFor(() => {
      expect(window.electronAPI.codePaneGetGitStatus).toHaveBeenCalledTimes(1);
      expect(window.electronAPI.codePaneGetGitRepositorySummary).toHaveBeenCalledTimes(1);
    });
    firstView.unmount();

    vi.mocked(window.electronAPI.codePaneGetGitStatus).mockClear();
    vi.mocked(window.electronAPI.codePaneGetGitRepositorySummary).mockClear();

    renderCodePane(createPane());

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'codePane.scmTab' }));
    });

    expect((await screen.findAllByText('feature/cache')).length).toBeGreaterThan(0);
    expect(await screen.findByText('index.ts')).toBeInTheDocument();
    expect(window.electronAPI.codePaneGetGitStatus).not.toHaveBeenCalled();
    expect(window.electronAPI.codePaneGetGitRepositorySummary).not.toHaveBeenCalled();
  });

  it('hydrates the project tree from cache when opening a second pane for the same project', async () => {
    vi.mocked(window.electronAPI.codePaneListDirectory).mockResolvedValue({
      success: true,
      data: [
        {
          path: '/workspace/project/src/index.ts',
          name: 'index.ts',
          type: 'file',
        },
      ],
    });

    const firstView = renderCodePane(createPane());
    expect(await screen.findByRole('button', { name: 'index.ts' }, { timeout: 3000 })).toBeInTheDocument();
    await waitFor(() => {
      expect(window.electronAPI.codePaneListDirectory).toHaveBeenCalledTimes(1);
    });
    firstView.unmount();

    let resolveRootDirectory: (() => void) | null = null;
    vi.mocked(window.electronAPI.codePaneListDirectory).mockClear();
    vi.mocked(window.electronAPI.codePaneListDirectory).mockImplementation(async ({ targetPath }) => {
      if (targetPath === '/workspace/project') {
        await new Promise<void>((resolve) => {
          resolveRootDirectory = resolve;
        });
      }

      return {
        success: true,
        data: [
          {
            path: '/workspace/project/src/index.ts',
            name: 'index.ts',
            type: 'file',
          },
        ],
      };
    });

    renderCodePane(createPane());

    expect(await screen.findByRole('button', { name: 'index.ts' }, { timeout: 3000 })).toBeInTheDocument();
    expect(window.electronAPI.codePaneListDirectory).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveRootDirectory?.();
      await Promise.resolve();
    });
  });

  it('hydrates expanded directories from cache before background refresh resolves', async () => {
    vi.mocked(window.electronAPI.codePaneListDirectory).mockImplementation(async ({ targetPath }) => {
      if (targetPath === '/workspace/project/src') {
        return {
          success: true,
          data: [
            {
              path: '/workspace/project/src/nested.ts',
              name: 'nested.ts',
              type: 'file',
            },
          ],
        };
      }

      return {
        success: true,
        data: [
          {
            path: '/workspace/project/src',
            name: 'src',
            type: 'directory',
          },
        ],
      };
    });

    const firstView = renderCodePane(createPane());
    const directoryButton = await screen.findByRole('button', { name: 'src' });
    await act(async () => {
      fireEvent.doubleClick(directoryButton);
    });

    expect(await screen.findByRole('button', { name: 'nested.ts' }, { timeout: 3000 })).toBeInTheDocument();
    firstView.unmount();

    let resolveRootDirectory: (() => void) | null = null;
    let resolveNestedDirectory: (() => void) | null = null;
    vi.mocked(window.electronAPI.codePaneListDirectory).mockClear();
    vi.mocked(window.electronAPI.codePaneListDirectory).mockImplementation(async ({ targetPath }) => {
      if (targetPath === '/workspace/project') {
        await new Promise<void>((resolve) => {
          resolveRootDirectory = resolve;
        });
        return {
          success: true,
          data: [
            {
              path: '/workspace/project/src',
              name: 'src',
              type: 'directory',
            },
          ],
        };
      }

      if (targetPath === '/workspace/project/src') {
        await new Promise<void>((resolve) => {
          resolveNestedDirectory = resolve;
        });
        return {
          success: true,
          data: [
            {
              path: '/workspace/project/src/nested.ts',
              name: 'nested.ts',
              type: 'file',
            },
          ],
        };
      }

      return {
        success: true,
        data: [],
      };
    });

    renderCodePane(createPane({
      expandedPaths: ['/workspace/project', '/workspace/project/src'],
    }));

    expect(await screen.findByRole('button', { name: 'src' }, { timeout: 3000 })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'nested.ts' }, { timeout: 3000 })).toBeInTheDocument();
    expect(window.electronAPI.codePaneListDirectory).toHaveBeenCalledWith({
      rootPath: '/workspace/project',
      targetPath: '/workspace/project',
    });
    expect(window.electronAPI.codePaneListDirectory).toHaveBeenCalledWith({
      rootPath: '/workspace/project',
      targetPath: '/workspace/project/src',
    });

    await act(async () => {
      resolveRootDirectory?.();
      resolveNestedDirectory?.();
      await Promise.resolve();
    });
  });

  it('shows index progress in the bottom status bar while building', async () => {
    renderCodePane(createPane());

    await emitIndexProgress({
      paneId: 'pane-code-1',
      rootPath: '/workspace/project',
      state: 'building',
      processedDirectoryCount: 3,
      totalDirectoryCount: 12,
      indexedFileCount: 41,
      reusedPersistedIndex: false,
    });

    expect(await screen.findByText('codePane.indexingProgress')).toBeInTheDocument();
  });

  it('shows language workspace progress in the bottom status bar', async () => {
    renderCodePane(createPane());

    await emitLanguageWorkspaceChanged({
      state: {
        pluginId: 'official.java-jdtls',
        workspaceRoot: '/workspace/project',
        projectRoot: '/workspace/project',
        languageId: 'java',
        runtimeState: 'running',
        phase: 'importing-project',
        message: 'Importing Maven project',
        progressText: 'Resolving classpath',
        readyFeatures: ['definition', 'hover'],
        timestamp: '2026-04-13T00:00:00.000Z',
      },
    });

    expect(await screen.findByText('Java: Resolving classpath')).toBeInTheDocument();
  });

  it('hydrates language workspace status from attach response without waiting for a later event', async () => {
    vi.mocked(window.electronAPI.codePaneAttachLanguageWorkspace).mockResolvedValue({
      success: true,
      data: {
        pluginId: 'official.java-jdtls',
        workspaceRoot: '/workspace/project',
        projectRoot: '/workspace/project',
        languageId: 'java',
        runtimeState: 'running',
        phase: 'importing-project',
        message: 'Importing Maven project',
        progressText: 'Resolving classpath',
        readyFeatures: ['definition', 'hover'],
        timestamp: '2026-04-15T00:00:00.000Z',
      },
    });

    renderCodePane(createPane());

    expect(await screen.findByText('Java: Resolving classpath')).toBeInTheDocument();
    expect(window.electronAPI.codePaneGetLanguageWorkspaceState).not.toHaveBeenCalled();
  });

  it('uses translucent chrome and transparent Monaco editor surfaces for the appearance backdrop', async () => {
    renderCodePane(createPane());

    const root = await screen.findByTestId('code-pane-root');
    expect(root).toHaveStyle({
      backgroundColor: 'var(--appearance-pane-background-strong)',
    });

    expect(hoisted.ensureMonacoEnvironmentMock).toHaveBeenCalled();
  });

  it('toggles the workbench sidebar from the activity rail and persists the selected view', async () => {
    const view = renderCodePane(createPane());

    expect(await screen.findByRole('button', { name: 'codePane.locateActiveFileInExplorer' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'codePane.expandSelectedInExplorer' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'codePane.collapseAllInExplorer' })).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'codePane.filesTab' }));
    });

    expect(screen.queryByRole('button', { name: 'codePane.locateActiveFileInExplorer' })).not.toBeInTheDocument();
    expect(view.getPane().code?.layout?.sidebar).toMatchObject({
      visible: false,
      activeView: 'files',
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'codePane.searchTab' }));
    });

    expect(await screen.findByPlaceholderText('codePane.searchContentsPlaceholder')).toBeInTheDocument();
    expect(view.getPane().code?.layout?.sidebar).toMatchObject({
      visible: true,
      activeView: 'search',
    });
  });

  it('persists the code pane sidebar width after drag resizing', async () => {
    const view = renderCodePane(createPane());

    await screen.findByRole('button', { name: 'codePane.locateActiveFileInExplorer' });

    const resizeHandle = screen.getByTestId('code-pane-sidebar-resize-handle');

    await act(async () => {
      fireEvent.mouseDown(resizeHandle, { clientX: 300 });
      fireEvent.mouseMove(window, { clientX: 384 });
      fireEvent.mouseUp(window);
    });

    await waitFor(() => {
      expect(view.getPane().code?.layout?.sidebar).toMatchObject({
        visible: true,
        activeView: 'files',
        width: 384,
        lastExpandedWidth: 384,
      });
    });
  });

  it('reveals paths without reopening a hidden workbench sidebar', async () => {
    const pane = createPane({
      layout: {
        sidebar: {
          visible: false,
          activeView: 'files',
          width: 280,
          lastExpandedWidth: 280,
        },
      },
      selectedPath: '/workspace/project/src/index.ts',
    });

    renderCodePane(pane);

    await waitFor(() => {
      expect(window.electronAPI.codePaneListDirectory).toHaveBeenCalled();
    });

    expect(screen.queryByRole('button', { name: 'codePane.locateActiveFileInExplorer' })).not.toBeInTheDocument();
  });

  it('configures Monaco diff editor as inline and compact', async () => {
    renderCodePane(createPane({
      activeFilePath: '/workspace/project/src/index.ts',
      openFiles: [{ path: '/workspace/project/src/index.ts' }],
      viewMode: 'diff',
      diffTargetPath: '/workspace/project/src/index.ts',
    }));

    await waitFor(() => {
      expect(fakeMonaco.editor.createDiffEditor).toHaveBeenCalled();
    });

    expect(fakeMonaco.editor.create).toHaveBeenCalledWith(expect.any(HTMLElement), expect.objectContaining({
      glyphMargin: false,
      lineDecorationsWidth: 4,
      lineNumbersMinChars: 3,
    }));
    expect(fakeMonaco.editor.createDiffEditor).toHaveBeenCalledWith(expect.any(HTMLElement), expect.objectContaining({
      renderSideBySide: false,
      useInlineViewWhenSpaceIsLimited: true,
      glyphMargin: false,
      lineDecorationsWidth: 4,
      lineNumbersMinChars: 3,
      folding: false,
    }));
  });

  it('does not bootstrap the project tree again when only isActive changes', async () => {
    const pane = createPane();
    const onActivate = vi.fn();
    const onClose = vi.fn();

    const { rerender } = render(
      <CodePane
        windowId="win-code-1"
        pane={pane}
        isActive
        onActivate={onActivate}
        onClose={onClose}
      />,
    );

    await screen.findByRole('button', { name: 'index.ts' }, { timeout: 3000 });

    expect(window.electronAPI.codePaneListDirectory).toHaveBeenCalledTimes(1);
    expect(window.electronAPI.codePaneWatchRoot).toHaveBeenCalledTimes(1);

    vi.mocked(window.electronAPI.codePaneListDirectory).mockClear();
    vi.mocked(window.electronAPI.codePaneWatchRoot).mockClear();

    await act(async () => {
      rerender(
        <CodePane
          windowId="win-code-1"
          pane={pane}
          isActive={false}
          onActivate={onActivate}
          onClose={onClose}
        />,
      );
      await Promise.resolve();
    });

    await act(async () => {
      rerender(
        <CodePane
          windowId="win-code-1"
          pane={pane}
          isActive
          onActivate={onActivate}
          onClose={onClose}
        />,
      );
      await Promise.resolve();
    });

    expect(window.electronAPI.codePaneListDirectory).not.toHaveBeenCalled();
    expect(window.electronAPI.codePaneWatchRoot).not.toHaveBeenCalled();
  });

  it('persists expanded directories in pane state', async () => {
    vi.mocked(window.electronAPI.codePaneListDirectory).mockImplementation(async ({ targetPath }) => {
      if (targetPath === '/workspace/project/src') {
        return {
          success: true,
          data: [
            {
              path: '/workspace/project/src/index.ts',
              name: 'index.ts',
              type: 'file',
            },
          ],
        };
      }

      return {
        success: true,
        data: [
          {
            path: '/workspace/project/src',
            name: 'src',
            type: 'directory',
          },
        ],
      };
    });

    const view = renderCodePane(createPane());

    const directoryButton = await screen.findByRole('button', { name: 'src' });
    await act(async () => {
      fireEvent.doubleClick(directoryButton);
    });

    await waitFor(() => {
      expect(window.electronAPI.codePaneListDirectory).toHaveBeenCalledWith({
        rootPath: '/workspace/project',
        targetPath: '/workspace/project/src',
      });
    });
    expect(view.getPane().code?.expandedPaths).toEqual([
      '/workspace/project',
      '/workspace/project/src',
    ]);
  });

  it('compacts single-directory package chains in Java source roots', async () => {
    vi.mocked(window.electronAPI.codePaneListDirectory).mockImplementation(async ({ targetPath }) => {
      if (!targetPath || targetPath === '/workspace/project') {
        return {
          success: true,
          data: [
            {
              path: '/workspace/project/src',
              name: 'src',
              type: 'directory',
            },
          ],
        };
      }

      if (targetPath === '/workspace/project/src') {
        return {
          success: true,
          data: [
            {
              path: '/workspace/project/src/main',
              name: 'main',
              type: 'directory',
            },
          ],
        };
      }

      if (targetPath === '/workspace/project/src/main') {
        return {
          success: true,
          data: [
            {
              path: '/workspace/project/src/main/java',
              name: 'java',
              type: 'directory',
            },
          ],
        };
      }

      if (targetPath === '/workspace/project/src/main/java') {
        return {
          success: true,
          data: [
            {
              path: '/workspace/project/src/main/java/com',
              name: 'com',
              type: 'directory',
            },
          ],
        };
      }

      if (targetPath === '/workspace/project/src/main/java/com') {
        return {
          success: true,
          data: [
            {
              path: '/workspace/project/src/main/java/com/iflytek',
              name: 'iflytek',
              type: 'directory',
            },
          ],
        };
      }

      if (targetPath === '/workspace/project/src/main/java/com/iflytek') {
        return {
          success: true,
          data: [
            {
              path: '/workspace/project/src/main/java/com/iflytek/tjpt',
              name: 'tjpt',
              type: 'directory',
            },
          ],
        };
      }

      if (targetPath === '/workspace/project/src/main/java/com/iflytek/tjpt') {
        return {
          success: true,
          data: [
            {
              path: '/workspace/project/src/main/java/com/iflytek/tjpt/Application.java',
              name: 'Application.java',
              type: 'file',
            },
          ],
        };
      }

      return { success: true, data: [] };
    });

    const view = renderCodePane(createPane());
    const srcButton = await screen.findByRole('button', { name: 'src' }, { timeout: 3000 });

    await act(async () => {
      fireEvent.doubleClick(srcButton);
    });
    const mainButton = await screen.findByRole('button', { name: 'main' }, { timeout: 3000 });
    await act(async () => {
      fireEvent.doubleClick(mainButton);
    });
    const javaButton = await screen.findByRole('button', { name: 'java' }, { timeout: 3000 });
    await act(async () => {
      fireEvent.doubleClick(javaButton);
    });

    const compactedPackageButton = await screen.findByRole('button', { name: 'com.iflytek.tjpt' });
    expect(compactedPackageButton).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'com' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'iflytek' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'tjpt' })).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.doubleClick(compactedPackageButton);
    });

    expect(await screen.findByRole('button', { name: 'Application.java' })).toBeInTheDocument();
    expect(view.getPane().code?.expandedPaths).toEqual([
      '/workspace/project',
      '/workspace/project/src',
      '/workspace/project/src/main',
      '/workspace/project/src/main/java',
      '/workspace/project/src/main/java/com',
      '/workspace/project/src/main/java/com/iflytek',
      '/workspace/project/src/main/java/com/iflytek/tjpt',
    ]);
  });

  it('allows collapsing and expanding the root file tree entry', async () => {
    vi.mocked(window.electronAPI.codePaneListDirectory).mockResolvedValue({
      success: true,
      data: [
        {
          path: '/workspace/project/src',
          name: 'src',
          type: 'directory',
        },
      ],
    });

    const view = renderCodePane(createPane());

    const rootButton = await screen.findByRole('button', { name: 'project' });
    expect(await screen.findByRole('button', { name: 'src' })).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(rootButton);
    });

    expect(await screen.findByRole('button', { name: 'src' })).toBeInTheDocument();
    expect(view.getPane().code?.selectedPath).toBe('/workspace/project');
    expect(view.getPane().code?.expandedPaths).toEqual(['/workspace/project']);

    await act(async () => {
      fireEvent.doubleClick(rootButton);
    });

    expect(screen.queryByRole('button', { name: 'src' })).not.toBeInTheDocument();
    expect(view.getPane().code?.expandedPaths).toEqual([]);

    await act(async () => {
      fireEvent.doubleClick(rootButton);
    });

    expect(await screen.findByRole('button', { name: 'src' })).toBeInTheDocument();
    expect(view.getPane().code?.expandedPaths).toEqual(['/workspace/project']);
  });

  it('toggles the root file tree entry from the chevron button', async () => {
    vi.mocked(window.electronAPI.codePaneListDirectory).mockResolvedValue({
      success: true,
      data: [
        {
          path: '/workspace/project/src',
          name: 'src',
          type: 'directory',
        },
      ],
    });

    renderCodePane(createPane());

    expect(await screen.findByRole('button', { name: 'src' })).toBeInTheDocument();

    const collapseButtons = screen.getAllByRole('button', { name: 'codePane.collapse' });
    await act(async () => {
      fireEvent.click(collapseButtons[0]);
    });

    expect(screen.queryByRole('button', { name: 'src' })).not.toBeInTheDocument();

    const expandButtons = screen.getAllByRole('button', { name: 'codePane.expand' });
    await act(async () => {
      fireEvent.click(expandButtons[0]);
    });

    expect(await screen.findByRole('button', { name: 'src' })).toBeInTheDocument();
  });

  it('runs file context menu actions', async () => {
    const user = userEvent.setup();
    vi.mocked(window.electronAPI.codePaneGitHistory).mockResolvedValue({
      success: true,
      data: {
        scope: 'file',
        targetFilePath: '/workspace/project/src/index.ts',
        entries: [
          {
            commitSha: 'abcdef1234567890',
            shortSha: 'abcdef1',
            subject: 'Refine index flow',
            author: 'Test User',
            timestamp: 1_710_000_000,
            refs: ['HEAD -> main'],
            scope: 'file',
            filePath: '/workspace/project/src/index.ts',
          },
        ],
      },
    });
    vi.mocked(window.electronAPI.codePaneGetGitStatus).mockResolvedValue({
      success: true,
      data: [
        {
          path: '/workspace/project/src/index.ts',
          status: 'modified',
          unstaged: true,
        },
      ],
    });
    renderCodePane(createPane());
    const treeButton = await screen.findByRole('button', { name: 'index.ts' });

    fireEvent.contextMenu(treeButton);
    await user.click(await screen.findByRole('menuitem', { name: 'codePane.copyAbsolutePath' }));
    expect(window.electronAPI.writeClipboardText).toHaveBeenCalledWith('/workspace/project/src/index.ts');

    fireEvent.contextMenu(treeButton);
    await user.click(await screen.findByRole('menuitem', { name: 'codePane.copyFileName' }));
    expect(window.electronAPI.writeClipboardText).toHaveBeenCalledWith('index.ts');

    fireEvent.contextMenu(treeButton);
    await user.click(await screen.findByRole('menuitem', { name: 'codePane.copyRelativePath' }));
    expect(window.electronAPI.writeClipboardText).toHaveBeenCalledWith('src/index.ts');

    fireEvent.contextMenu(treeButton);
    await user.click(await screen.findByText('codePane.revealInFolder'));
    expect(window.electronAPI.openFolder).toHaveBeenCalledWith('/workspace/project/src');

    fireEvent.contextMenu(treeButton);
    await user.hover(await screen.findByRole('menuitem', { name: 'codePane.gitMenu' }));
    expect(await screen.findByRole('menuitem', { name: 'codePane.gitRevert' })).toBeInTheDocument();
    expect(await screen.findByRole('menuitem', { name: 'codePane.gitCompareWithRevision' })).toBeInTheDocument();
    expect(await screen.findByRole('menuitem', { name: 'codePane.gitCompareWithBranch' })).toBeInTheDocument();
    expect(await screen.findByRole('menuitem', { name: 'codePane.gitCompareWithLatest' })).toBeInTheDocument();
    expect(await screen.findByRole('menuitem', { name: 'codePane.gitCherryPick' })).toBeInTheDocument();
    await user.keyboard('{Escape}');

    fireEvent.contextMenu(treeButton);
    await user.hover(await screen.findByRole('menuitem', { name: 'codePane.gitMenu' }));
    expect(await screen.findByRole('menuitem', { name: 'codePane.gitCommit' })).toBeInTheDocument();
    await user.keyboard('{Escape}');

    fireEvent.contextMenu(treeButton);
    await user.click(await screen.findByRole('menuitem', { name: 'codePane.newFile' }));
    await user.type(screen.getByRole('textbox', { name: 'codePane.pathMutationInputLabel' }), 'new-file.ts');
    await user.click(screen.getByRole('button', { name: 'common.create' }));

    expect(window.electronAPI.codePaneCreateFile).toHaveBeenCalledWith({
      rootPath: '/workspace/project',
      filePath: '/workspace/project/src/new-file.ts',
    });
  });

  it('renames paths directly from file context menus', async () => {
    const user = userEvent.setup();
    renderCodePane(createPane());

    const treeButton = await screen.findByRole('button', { name: 'index.ts' });
    fireEvent.contextMenu(treeButton);
    await user.click(await screen.findByRole('menuitem', { name: 'codePane.renamePath' }));
    await user.clear(screen.getByRole('textbox', { name: 'codePane.pathMutationInputLabel' }));
    await user.type(screen.getByRole('textbox', { name: 'codePane.pathMutationInputLabel' }), 'renamed-index.ts');
    await user.click(screen.getByRole('button', { name: 'codePane.renamePath' }));

    expect(window.electronAPI.codePaneRenamePath).toHaveBeenCalledWith({
      rootPath: '/workspace/project',
      sourcePath: '/workspace/project/src/index.ts',
      targetPath: '/workspace/project/src/renamed-index.ts',
    });
  });

  it('shows refactor actions from file context menus', async () => {
    const user = userEvent.setup();

    renderCodePane(createPane());

    const treeButton = await screen.findByRole('button', { name: 'index.ts' });
    fireEvent.contextMenu(treeButton);
    await user.hover(await screen.findByRole('menuitem', { name: 'codePane.refactorMenu' }));

    expect(await screen.findByRole('menuitem', { name: 'codePane.movePath' })).toBeInTheDocument();
    expect(await screen.findByRole('menuitem', { name: 'codePane.deletePath' })).toBeInTheDocument();
  });

  it('creates directories from directory context menus', async () => {
    const user = userEvent.setup();
    vi.mocked(window.electronAPI.codePaneListDirectory).mockResolvedValue({
      success: true,
      data: [
        {
          path: '/workspace/project/src',
          name: 'src',
          type: 'directory',
        },
      ],
    });
    renderCodePane(createPane());

    const directoryButton = await screen.findByRole('button', { name: 'src' });
    fireEvent.contextMenu(directoryButton);
    await user.click(await screen.findByRole('menuitem', { name: 'codePane.newFolder' }));
    await user.type(screen.getByRole('textbox', { name: 'codePane.pathMutationInputLabel' }), 'new-folder');
    await user.click(screen.getByRole('button', { name: 'common.create' }));

    expect(window.electronAPI.codePaneCreateDirectory).toHaveBeenCalledWith({
      rootPath: '/workspace/project',
      directoryPath: '/workspace/project/src/new-folder',
    });
  });

  it('discards a git change without opening the external changes panel', async () => {
    vi.mocked(window.electronAPI.codePaneGetGitStatus).mockResolvedValue({
      success: true,
      data: [
        {
          path: '/workspace/project/src/index.ts',
          status: 'modified',
          unstaged: true,
        },
      ],
    });

    renderCodePane(createPane({
      openFiles: [{ path: '/workspace/project/src/index.ts' }],
      activeFilePath: '/workspace/project/src/index.ts',
      selectedPath: '/workspace/project/src/index.ts',
    }));

    await waitFor(() => {
      expect(window.electronAPI.codePaneReadFile).toHaveBeenCalledWith({
        rootPath: '/workspace/project',
        filePath: '/workspace/project/src/index.ts',
      });
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'codePane.scmTab' }));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'codePane.gitDiscard' }));
    });

    await waitFor(() => {
      expect(window.electronAPI.codePaneGitDiscard).toHaveBeenCalledWith({
        rootPath: '/workspace/project',
        paths: ['/workspace/project/src/index.ts'],
        restoreStaged: false,
      });
    });

    vi.mocked(window.electronAPI.codePaneReadFile).mockResolvedValue({
      success: true,
      data: {
        content: 'export const value = 0;\n',
        mtimeMs: 300,
        size: 24,
        language: 'typescript',
        isBinary: false,
      },
    });

    await emitFsChanged({
      rootPath: '/workspace/project',
      changes: [
        {
          type: 'change',
          path: '/workspace/project/src/index.ts',
        },
        {
          type: 'change',
          path: '/workspace/project/src/index.ts',
        },
      ],
    });

    expect(screen.queryByText('codePane.externalChangesSubtitle')).not.toBeInTheDocument();
  });

  it('discards a git change without refreshing external library sections', async () => {
    vi.mocked(window.electronAPI.codePaneGetExternalLibrarySections).mockResolvedValue({
      success: true,
      data: [
        {
          id: 'python-external-libraries',
          label: 'External Libraries',
          languageId: 'python',
          roots: [
            {
              id: 'python-site-packages',
              label: 'site-packages',
              path: '/usr/lib/python3.12/site-packages',
            },
          ],
        },
      ],
    });
    vi.mocked(window.electronAPI.codePaneGetGitStatus).mockResolvedValue({
      success: true,
      data: [
        {
          path: '/workspace/project/src/index.ts',
          status: 'modified',
          unstaged: true,
        },
      ],
    });

    renderCodePane(createPane({
      openFiles: [{ path: '/workspace/project/src/index.ts' }],
      activeFilePath: '/workspace/project/src/index.ts',
      selectedPath: '/workspace/project/src/index.ts',
    }));

    expect(await screen.findByText('codePane.externalLibraries · Python')).toBeInTheDocument();
    await waitFor(() => {
      expect(window.electronAPI.codePaneGetExternalLibrarySections).toHaveBeenCalledTimes(1);
    });

    vi.mocked(window.electronAPI.codePaneGetExternalLibrarySections).mockClear();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'codePane.scmTab' }));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'codePane.gitDiscard' }));
    });

    await waitFor(() => {
      expect(window.electronAPI.codePaneGitDiscard).toHaveBeenCalledWith({
        rootPath: '/workspace/project',
        paths: ['/workspace/project/src/index.ts'],
        restoreStaged: false,
      });
    });
    expect(window.electronAPI.codePaneGetExternalLibrarySections).not.toHaveBeenCalled();
  });

  it('discards a git change by refreshing only the affected loaded directory', async () => {
    vi.mocked(window.electronAPI.codePaneListDirectory).mockImplementation(async ({ targetPath }) => {
      if (targetPath === '/workspace/project') {
        return {
          success: true,
          data: [
            {
              path: '/workspace/project/src',
              name: 'src',
              type: 'directory',
              hasChildren: true,
            },
          ],
        };
      }

      if (targetPath === '/workspace/project/src') {
        return {
          success: true,
          data: [
            {
              path: '/workspace/project/src/index.ts',
              name: 'index.ts',
              type: 'file',
            },
          ],
        };
      }

      return { success: true, data: [] };
    });
    vi.mocked(window.electronAPI.codePaneGetGitStatus).mockResolvedValue({
      success: true,
      data: [
        {
          path: '/workspace/project/src/index.ts',
          status: 'modified',
          unstaged: true,
        },
      ],
    });

    renderCodePane(createPane({
      openFiles: [{ path: '/workspace/project/src/index.ts' }],
      activeFilePath: '/workspace/project/src/index.ts',
      selectedPath: '/workspace/project/src/index.ts',
    }));

    const directoryButton = await screen.findByRole('button', { name: 'src' });
    await act(async () => {
      fireEvent.doubleClick(directoryButton);
    });

    await waitFor(() => {
      expect(window.electronAPI.codePaneListDirectory).toHaveBeenCalledWith({
        rootPath: '/workspace/project',
        targetPath: '/workspace/project/src',
      });
    });

    vi.mocked(window.electronAPI.codePaneListDirectory).mockClear();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'codePane.scmTab' }));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'codePane.gitDiscard' }));
    });

    await waitFor(() => {
      expect(window.electronAPI.codePaneGitDiscard).toHaveBeenCalledWith({
        rootPath: '/workspace/project',
        paths: ['/workspace/project/src/index.ts'],
        restoreStaged: false,
      });
    });

    await waitFor(() => {
      expect(window.electronAPI.codePaneListDirectory).toHaveBeenCalledTimes(1);
      expect(window.electronAPI.codePaneListDirectory).toHaveBeenCalledWith({
        rootPath: '/workspace/project',
        targetPath: '/workspace/project/src',
      });
    });
  });

  it('opens git history from directory context menus', async () => {
    const user = userEvent.setup();
    vi.mocked(window.electronAPI.codePaneListDirectory).mockImplementation(async ({ targetPath }) => {
      if (!targetPath || targetPath === '/workspace/project') {
        return {
          success: true,
          data: [
            {
              path: '/workspace/project/src',
              name: 'src',
              type: 'directory',
              hasChildren: true,
            },
          ],
        };
      }

      if (targetPath === '/workspace/project/src') {
        return {
          success: true,
          data: [
            {
              path: '/workspace/project/src/main',
              name: 'main',
              type: 'directory',
              hasChildren: true,
            },
          ],
        };
      }

      return { success: true, data: [] };
    });
    vi.mocked(window.electronAPI.codePaneGitHistory).mockResolvedValue({
      success: true,
      data: {
        scope: 'file',
        targetFilePath: '/workspace/project/src/main',
        entries: [
          {
            commitSha: '1234567890abcdef',
            shortSha: '1234567',
            subject: 'Create main package',
            author: 'Test User',
            timestamp: 1_710_000_100,
            refs: ['HEAD -> main'],
            scope: 'file',
            filePath: '/workspace/project/src/main',
          },
        ],
      },
    });

    renderCodePane(createPane());

    const directoryButton = await screen.findByRole('button', { name: 'src' });
    await user.pointer({ keys: '[MouseRight]', target: directoryButton });
    await user.click(await screen.findByText('codePane.gitFileHistory'));

    expect(window.electronAPI.codePaneGitHistory).toHaveBeenCalledWith({
      rootPath: '/workspace/project',
      filePath: '/workspace/project/src',
      lineNumber: undefined,
      limit: 30,
    });
    expect((await screen.findAllByText('Create main package')).length).toBeGreaterThan(0);
  });

  it('coalesces overlapping git history refresh requests', async () => {
    const user = userEvent.setup();
    let resolveHistory: (() => void) | null = null;

    vi.mocked(window.electronAPI.codePaneListDirectory).mockImplementation(async ({ targetPath }) => {
      if (!targetPath || targetPath === '/workspace/project') {
        return {
          success: true,
          data: [
            {
              path: '/workspace/project/src',
              name: 'src',
              type: 'directory',
              hasChildren: true,
            },
          ],
        };
      }

      return { success: true, data: [] };
    });
    vi.mocked(window.electronAPI.codePaneGitHistory).mockImplementation(async () => {
      await new Promise<void>((resolve) => {
        resolveHistory = resolve;
      });
      return {
        success: true,
        data: {
          scope: 'file',
          targetFilePath: '/workspace/project/src',
          entries: [],
        },
      };
    });

    renderCodePane(createPane());

    const directoryButton = await screen.findByRole('button', { name: 'src' });
    await user.pointer({ keys: '[MouseRight]', target: directoryButton });
    await user.click(await screen.findByText('codePane.gitFileHistory'));

    await waitFor(() => {
      expect(window.electronAPI.codePaneGitHistory).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      fireEvent.click((await screen.findAllByRole('button', { name: 'codePane.refresh' }))[0]);
      await Promise.resolve();
    });

    expect(window.electronAPI.codePaneGitHistory).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveHistory?.();
      await Promise.resolve();
    });
  });

  it('copies qualified package names from compact package directories', async () => {
    const user = userEvent.setup();
    vi.mocked(window.electronAPI.codePaneListDirectory).mockImplementation(async ({ targetPath }) => {
      if (!targetPath || targetPath === '/workspace/project') {
        return {
          success: true,
          data: [
            {
              path: '/workspace/project/src',
              name: 'src',
              type: 'directory',
              hasChildren: true,
            },
          ],
        };
      }
      if (targetPath === '/workspace/project/src') {
        return {
          success: true,
          data: [
            {
              path: '/workspace/project/src/main',
              name: 'main',
              type: 'directory',
              hasChildren: true,
            },
          ],
        };
      }
      if (targetPath === '/workspace/project/src/main') {
        return {
          success: true,
          data: [
            {
              path: '/workspace/project/src/main/java',
              name: 'java',
              type: 'directory',
              hasChildren: true,
            },
          ],
        };
      }
      if (targetPath === '/workspace/project/src/main/java') {
        return {
          success: true,
          data: [
            {
              path: '/workspace/project/src/main/java/com',
              name: 'com',
              type: 'directory',
              hasChildren: true,
            },
          ],
        };
      }
      if (targetPath === '/workspace/project/src/main/java/com') {
        return {
          success: true,
          data: [
            {
              path: '/workspace/project/src/main/java/com/iflytek',
              name: 'iflytek',
              type: 'directory',
              hasChildren: true,
            },
          ],
        };
      }
      if (targetPath === '/workspace/project/src/main/java/com/iflytek') {
        return {
          success: true,
          data: [
            {
              path: '/workspace/project/src/main/java/com/iflytek/tjpt',
              name: 'tjpt',
              type: 'directory',
              hasChildren: true,
            },
          ],
        };
      }

      return { success: true, data: [] };
    });

    renderCodePane(createPane());

    const srcButton = await screen.findByRole('button', { name: 'src' });
    await act(async () => {
      fireEvent.doubleClick(srcButton);
    });
    const mainButton = await screen.findByRole('button', { name: 'main' });
    await act(async () => {
      fireEvent.doubleClick(mainButton);
    });
    const javaButton = await screen.findByRole('button', { name: 'java' });
    await act(async () => {
      fireEvent.doubleClick(javaButton);
    });
    const packageButton = await screen.findByRole('button', { name: 'com.iflytek.tjpt' });

    await user.pointer({ keys: '[MouseRight]', target: packageButton });
    await user.click(await screen.findByRole('menuitem', { name: 'codePane.copyQualifiedName' }));

    expect(window.electronAPI.writeClipboardText).toHaveBeenCalledWith('com.iflytek.tjpt');
  });

  it('compares files with branches and the latest repository version from context menus', async () => {
    const user = userEvent.setup();
    vi.mocked(window.electronAPI.codePaneListDirectory).mockResolvedValue({
      success: true,
      data: [
        {
          path: '/workspace/project/src/index.ts',
          name: 'index.ts',
          type: 'file',
        },
      ],
    });
    vi.mocked(window.electronAPI.codePaneGetGitBranches).mockResolvedValue({
      success: true,
      data: [
        {
          name: 'main',
          refName: 'refs/heads/main',
          shortName: 'main',
          kind: 'local',
          current: true,
          upstream: 'origin/main',
          aheadCount: 0,
          behindCount: 0,
          commitSha: 'abcdef1234567890',
          shortSha: 'abcdef1',
          subject: 'Current branch',
          timestamp: 1_710_000_000,
          mergedIntoCurrent: true,
        },
        {
          name: 'origin/main',
          refName: 'refs/remotes/origin/main',
          shortName: 'origin/main',
          kind: 'remote',
          current: false,
          aheadCount: 0,
          behindCount: 0,
          commitSha: '1234567890abcdef',
          shortSha: '1234567',
          subject: 'Remote branch',
          timestamp: 1_710_000_100,
          mergedIntoCurrent: true,
        },
      ],
    });
    vi.mocked(window.electronAPI.codePaneReadFile).mockResolvedValue({
      success: true,
      data: {
        content: 'export const value = 2;\n',
        mtimeMs: 100,
        size: 24,
        language: 'typescript',
        isBinary: false,
      },
    });
    vi.mocked(window.electronAPI.codePaneReadGitRevisionFile).mockImplementation(async ({ commitSha }) => ({
      success: true,
      data: {
        content: `// ${commitSha}\nexport const value = 1;\n`,
        exists: true,
      },
    }));

    const view = renderCodePane(createPane());

    const treeButton = await screen.findByRole('button', { name: 'index.ts' });
    fireEvent.contextMenu(treeButton);
    await user.hover(await screen.findByRole('menuitem', { name: 'codePane.gitMenu' }));
    const compareWithBranchItem = await screen.findByRole('menuitem', { name: 'codePane.gitCompareWithBranch' });
    await act(async () => {
      fireEvent.click(compareWithBranchItem);
      await Promise.resolve();
    });
    await user.clear(await screen.findByRole('textbox', { name: 'codePane.gitCompareWithBranch' }));
    await user.type(screen.getByRole('textbox', { name: 'codePane.gitCompareWithBranch' }), 'origin/main');
    await user.click(screen.getByRole('button', { name: 'codePane.openDiff' }));

    await waitFor(() => {
      expect(window.electronAPI.codePaneReadGitRevisionFile).toHaveBeenCalledWith({
        rootPath: '/workspace/project',
        filePath: '/workspace/project/src/index.ts',
        commitSha: 'origin/main',
      });
    });
    await waitFor(() => {
      expect(view.getPane().code?.viewMode).toBe('diff');
      expect(view.getPane().code?.diffTargetPath).toBe('/workspace/project/src/index.ts');
    });

    fireEvent.contextMenu(treeButton);
    await user.hover(await screen.findByRole('menuitem', { name: 'codePane.gitMenu' }));
    const compareWithLatestItem = await screen.findByRole('menuitem', { name: 'codePane.gitCompareWithLatest' });
    await act(async () => {
      fireEvent.click(compareWithLatestItem);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(window.electronAPI.codePaneReadGitRevisionFile).toHaveBeenCalledWith({
        rootPath: '/workspace/project',
        filePath: '/workspace/project/src/index.ts',
        commitSha: 'HEAD',
      });
    });
  });

  it('opens git history for the selected editor line when a selection exists', async () => {
    renderCodePane(createPane());

    await openFileFromTree('index.ts');
    const activeEditor = fakeMonaco.editor.create.mock.results.at(-1)?.value;

    await act(async () => {
      activeEditor.setPosition({ lineNumber: 1, column: 15 });
      activeEditor.setSelection({
        startLineNumber: 3,
        startColumn: 1,
        endLineNumber: 5,
        endColumn: 1,
        isEmpty: () => false,
      });
    });
    await triggerEditorAction('codePane.gitShowHistoryForSelection');

    await waitFor(() => {
      expect(window.electronAPI.codePaneGitHistory).toHaveBeenCalledWith({
        rootPath: '/workspace/project',
        filePath: '/workspace/project/src/index.ts',
        lineNumber: 3,
        limit: 30,
      });
    });
  });

  it('searches project contents and opens a selected match', async () => {
    vi.mocked(window.electronAPI.codePaneSearchContents).mockResolvedValue({
      success: true,
      data: [
        {
          filePath: '/workspace/project/src/index.ts',
          lineNumber: 1,
          column: 14,
          lineText: 'export const value = 1;',
        },
      ],
    });

    renderCodePane(createPane());

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'codePane.searchTab' }));
    });

    fireEvent.change(screen.getByPlaceholderText('codePane.searchContentsPlaceholder'), {
      target: { value: 'value' },
    });

    await waitFor(() => {
      expect(window.electronAPI.codePaneSearchContents).toHaveBeenCalledWith({
        rootPath: '/workspace/project',
        query: 'value',
        limit: 120,
        maxMatchesPerFile: 6,
      });
    });

    await act(async () => {
      fireEvent.click(await screen.findByText('export const value = 1;'));
    });

    await waitFor(() => {
      expect(window.electronAPI.codePaneReadFile).toHaveBeenCalledWith({
        rootPath: '/workspace/project',
        filePath: '/workspace/project/src/index.ts',
      });
    });
  });

  it('searches workspace symbols and opens the selected result', async () => {
    vi.mocked(window.electronAPI.codePaneGetWorkspaceSymbols).mockResolvedValue({
      success: true,
      data: [
        {
          name: 'AppService',
          kind: 5,
          filePath: '/workspace/project/src/app.ts',
          range: {
            startLineNumber: 2,
            startColumn: 3,
            endLineNumber: 2,
            endColumn: 13,
          },
          containerName: 'services',
        },
      ],
    });
    vi.mocked(window.electronAPI.codePaneReadFile).mockImplementation(async ({ filePath }) => ({
      success: true,
      data: {
        content: filePath.endsWith('app.ts') ? 'export class AppService {}\n' : 'export const value = 1;\n',
        mtimeMs: 100,
        size: 24,
        language: 'typescript',
        isBinary: false,
      },
    }));

    renderCodePane(createPane());

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'codePane.searchTab' }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'codePane.searchModeSymbols' }));
    });

    fireEvent.change(screen.getByPlaceholderText('codePane.workspaceSymbolsPlaceholder'), {
      target: { value: 'AppService' },
    });

    await waitFor(() => {
      expect(window.electronAPI.codePaneGetWorkspaceSymbols).toHaveBeenCalledWith({
        rootPath: '/workspace/project',
        query: 'AppService',
        limit: 120,
      });
    });

    await act(async () => {
      fireEvent.click(await screen.findByText('AppService'));
    });

    await waitFor(() => {
      expect(window.electronAPI.codePaneReadFile).toHaveBeenCalledWith({
        rootPath: '/workspace/project',
        filePath: '/workspace/project/src/app.ts',
      });
    });
  });

  it('opens Search Everywhere and navigates to matching symbols', async () => {
    vi.mocked(window.electronAPI.codePaneSearchFiles).mockResolvedValue({
      success: true,
      data: ['/workspace/project/src/app.ts'],
    });
    vi.mocked(window.electronAPI.codePaneGetWorkspaceSymbols).mockResolvedValue({
      success: true,
      data: [
        {
          name: 'AppService',
          kind: 5,
          filePath: '/workspace/project/src/app.ts',
          range: {
            startLineNumber: 2,
            startColumn: 3,
            endLineNumber: 2,
            endColumn: 13,
          },
          containerName: 'services',
        },
      ],
    });
    vi.mocked(window.electronAPI.codePaneReadFile).mockImplementation(async ({ filePath }) => ({
      success: true,
      data: {
        content: filePath.endsWith('app.ts') ? 'export class AppService {}\n' : 'export const value = 1;\n',
        mtimeMs: 100,
        size: 24,
        language: 'typescript',
        isBinary: false,
      },
    }));

    renderCodePane(createPane());

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'codePane.searchEverywhereOpen' }));
    });

    fireEvent.change(screen.getByPlaceholderText('codePane.searchEverywherePlaceholder'), {
      target: { value: 'AppService' },
    });

    await waitFor(() => {
      expect(window.electronAPI.codePaneSearchFiles).toHaveBeenCalledWith({
        rootPath: '/workspace/project',
        query: 'AppService',
        limit: 40,
      });
      expect(window.electronAPI.codePaneGetWorkspaceSymbols).toHaveBeenCalledWith({
        rootPath: '/workspace/project',
        query: 'AppService',
        limit: 40,
      });
    });

    await act(async () => {
      fireEvent.click(await screen.findByText('AppService'));
    });

    await waitFor(() => {
      expect(window.electronAPI.codePaneReadFile).toHaveBeenCalledWith({
        rootPath: '/workspace/project',
        filePath: '/workspace/project/src/app.ts',
      });
    });
  });

  it('opens the run tool window and streams run session output', async () => {
    vi.mocked(window.electronAPI.codePaneListRunTargets).mockResolvedValue({
      success: true,
      data: [
        {
          id: 'run-target-spring-boot',
          label: 'Spring Boot',
          detail: 'mvn spring-boot:run',
          kind: 'application',
          languageId: 'java',
          workingDirectory: '/workspace/project',
          canDebug: true,
          customization: {
            profiles: '',
            programArgs: '',
            vmArgs: '',
          },
        },
      ],
    });
    vi.mocked(window.electronAPI.codePaneRunTarget).mockResolvedValue({
      success: true,
      data: {
        id: 'run-session-1',
        targetId: 'run-target-spring-boot',
        label: 'Spring Boot',
        detail: 'mvn spring-boot:run',
        kind: 'application',
        languageId: 'java',
        state: 'starting',
        workingDirectory: '/workspace/project',
        startedAt: '2026-04-13T00:00:00.000Z',
      },
    });

    renderCodePane(createPane());

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'codePane.runTab' }));
    });

    await waitFor(() => {
      expect(window.electronAPI.codePaneListRunTargets).toHaveBeenCalledWith({
        rootPath: '/workspace/project',
        activeFilePath: null,
      });
    });

    expect(await screen.findByText('Spring Boot')).toBeInTheDocument();

    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText('codePane.runProfilesPlaceholder'), {
        target: { value: 'dev' },
      });
      fireEvent.change(screen.getByPlaceholderText('codePane.runProgramArgsPlaceholder'), {
        target: { value: '--server.port=8081' },
      });
      fireEvent.change(screen.getByPlaceholderText('codePane.runVmArgsPlaceholder'), {
        target: { value: '-Xmx1g' },
      });
    });

    await act(async () => {
      fireEvent.click(screen.getByLabelText('codePane.runAction'));
    });

    expect(window.electronAPI.codePaneRunTarget).toHaveBeenCalledWith({
      rootPath: '/workspace/project',
      targetId: 'run-target-spring-boot',
      customization: {
        profiles: 'dev',
        programArgs: '--server.port=8081',
        vmArgs: '-Xmx1g',
      },
    });

    await emitRunSessionChanged({
      rootPath: '/workspace/project',
      session: {
        id: 'run-session-1',
        targetId: 'run-target-spring-boot',
        label: 'Spring Boot',
        detail: 'mvn spring-boot:run',
        kind: 'application',
        languageId: 'java',
        state: 'running',
        workingDirectory: '/workspace/project',
        startedAt: '2026-04-13T00:00:00.000Z',
      },
    });
    await emitRunSessionOutput({
      rootPath: '/workspace/project',
      sessionId: 'run-session-1',
      chunk: '$ mvn spring-boot:run\nStarted successfully\n',
      stream: 'stdout',
    });

    expect(await screen.findByText(/Started successfully/)).toBeInTheDocument();
  });

  it('renders the bottom tool window beneath the full workspace and persists resized height', async () => {
    const user = userEvent.setup();
    const view = renderCodePane(createPane({
      layout: {
        sidebar: {
          visible: true,
          activeView: 'files',
          width: 300,
          lastExpandedWidth: 300,
        },
        bottomPanel: {
          height: 280,
        },
      },
    }));

    const workspaceLayout = screen.getByTestId('code-pane-workspace-layout');
    const activityRail = screen.getByTestId('code-pane-activity-rail');
    Object.defineProperty(workspaceLayout, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 1280,
        bottom: 900,
        width: 1280,
        height: 900,
        toJSON: () => ({}),
      }),
    });

    expect(await screen.findByRole('button', { name: 'codePane.runTab' })).toBeInTheDocument();
    expect(activityRail).toHaveClass('w-10');
    expect(screen.getByRole('button', { name: 'codePane.runTab' }).closest('[data-testid="code-pane-activity-rail"]')).toBe(activityRail);

    await user.click(await screen.findByRole('button', { name: 'codePane.runTab' }));

    const bottomPanel = await screen.findByTestId('code-pane-bottom-panel');
    expect(bottomPanel.closest('[data-testid="code-pane-activity-rail"]')).toBeNull();
    expect(bottomPanel.closest('[data-testid="code-pane-editor-region"]')).toBeNull();
    expect(screen.getByTestId('code-pane-bottom-panel-resize-handle')).toBeInTheDocument();
    expect(bottomPanel).toHaveStyle({ height: '280px' });

    await act(async () => {
      fireEvent.mouseDown(screen.getByTestId('code-pane-bottom-panel-resize-handle'), { clientY: 640 });
      fireEvent.mouseMove(window, { clientY: 560 });
      fireEvent.mouseUp(window);
    });

    await waitFor(() => {
      expect(view.getPane().code?.layout?.bottomPanel?.height).toBe(360);
      expect(screen.getByTestId('code-pane-bottom-panel')).toHaveStyle({ height: '360px' });
    });
  });

  it('reconciles bottom panel height to the actual available dock space in short panes', async () => {
    const user = userEvent.setup();
    const view = renderCodePane(createPane({
      layout: {
        sidebar: {
          visible: true,
          activeView: 'files',
          width: 300,
          lastExpandedWidth: 300,
        },
        bottomPanel: {
          height: 280,
        },
      },
    }));

    const workspaceLayout = screen.getByTestId('code-pane-workspace-layout');
    Object.defineProperty(workspaceLayout, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 1280,
        bottom: 390,
        width: 1280,
        height: 390,
        toJSON: () => ({}),
      }),
    });

    await user.click(await screen.findByRole('button', { name: 'codePane.runTab' }));

    await waitFor(() => {
      expect(view.getPane().code?.layout?.bottomPanel?.height).toBe(180);
      expect(screen.getByTestId('code-pane-bottom-panel')).toHaveStyle({ height: '180px' });
    });
  });

  it('opens project and git workbenches in the bottom panel instead of replacing the editor region', async () => {
    const user = userEvent.setup();
    renderCodePane(createPane({
      openFiles: [
        { path: '/workspace/project/src/index.ts' },
      ],
      activeFilePath: '/workspace/project/src/index.ts',
      layout: {
        sidebar: {
          visible: true,
          activeView: 'files',
          width: 300,
          lastExpandedWidth: 300,
        },
      },
    }));

    const workspaceLayout = screen.getByTestId('code-pane-workspace-layout');
    Object.defineProperty(workspaceLayout, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 1280,
        bottom: 900,
        width: 1280,
        height: 900,
        toJSON: () => ({}),
      }),
    });

    await user.click(await screen.findByRole('button', { name: 'codePane.projectTab' }));
    expect(await screen.findByText('codePane.projectTab')).toBeInTheDocument();
    expect(screen.getByTestId('code-pane-bottom-panel').closest('[data-testid="code-pane-workspace-top"]')).toBeNull();
    expect(screen.getByTestId('code-pane-bottom-panel').closest('[data-testid="code-pane-activity-rail"]')).toBeNull();

    await user.click(await screen.findByRole('button', { name: 'codePane.gitWorkbenchTab' }));
    expect(await screen.findByText('codePane.gitLogTab')).toBeInTheDocument();
    expect(screen.getByTestId('code-pane-bottom-panel').closest('[data-testid="code-pane-workspace-top"]')).toBeNull();
    expect(screen.getByTestId('code-pane-bottom-panel').closest('[data-testid="code-pane-activity-rail"]')).toBeNull();
  });

  it('opens the debug tool window, starts a debug session, and evaluates an expression', async () => {
    vi.mocked(window.electronAPI.codePaneListRunTargets).mockResolvedValue({
      success: true,
      data: [
        {
          id: 'debug-target-python',
          label: 'service.py',
          detail: 'python service.py',
          kind: 'application',
          languageId: 'python',
          workingDirectory: '/workspace/project',
          filePath: '/workspace/project/src/service.py',
          canDebug: true,
          customization: {
            profiles: '',
            programArgs: '',
            vmArgs: '',
          },
        },
      ],
    });
    vi.mocked(window.electronAPI.codePaneDebugStart).mockResolvedValue({
      success: true,
      data: {
        id: 'debug-session-1',
        targetId: 'debug-target-python',
        label: 'service.py',
        detail: 'python service.py',
        languageId: 'python',
        adapterType: 'pdb',
        state: 'starting',
        workingDirectory: '/workspace/project',
        startedAt: '2026-04-13T00:00:00.000Z',
        currentFrame: null,
      },
    });
    vi.mocked(window.electronAPI.codePaneGetDebugSessionDetails).mockResolvedValue({
      success: true,
      data: {
        sessionId: 'debug-session-1',
        stackFrames: [
          {
            id: 'frame-1',
            name: 'main',
            filePath: '/workspace/project/src/service.py',
            lineNumber: 12,
            column: 1,
          },
        ],
        scopes: [
          {
            id: 'locals',
            name: 'Locals',
            variables: [
              {
                id: 'var-1',
                name: 'value',
                value: '1',
              },
            ],
          },
        ],
      },
    });
    vi.mocked(window.electronAPI.codePaneDebugEvaluate).mockResolvedValue({
      success: true,
      data: {
        value: '1',
      },
    });

    renderCodePane(createPane());

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'codePane.debugTab' }));
    });

    expect((await screen.findAllByText('service.py')).length).toBeGreaterThan(0);

    await act(async () => {
      fireEvent.click(screen.getByText('service.py'));
    });

    expect(window.electronAPI.codePaneDebugStart).toHaveBeenCalledWith({
      rootPath: '/workspace/project',
      targetId: 'debug-target-python',
      customization: {
        profiles: '',
        programArgs: '',
        vmArgs: '',
      },
    });

    await emitDebugSessionChanged({
      rootPath: '/workspace/project',
      session: {
        id: 'debug-session-1',
        targetId: 'debug-target-python',
        label: 'service.py',
        detail: 'python service.py',
        languageId: 'python',
        adapterType: 'pdb',
        state: 'paused',
        workingDirectory: '/workspace/project',
        startedAt: '2026-04-13T00:00:00.000Z',
        stopReason: 'breakpoint',
        currentFrame: {
          id: 'frame-1',
          name: 'main',
          filePath: '/workspace/project/src/service.py',
          lineNumber: 12,
          column: 1,
        },
      },
    });
    await emitDebugSessionOutput({
      rootPath: '/workspace/project',
      sessionId: 'debug-session-1',
      chunk: 'Paused at breakpoint\n',
      stream: 'stdout',
    });

    expect((await screen.findAllByText('value')).length).toBeGreaterThan(0);
    expect(screen.getByText(/Paused at breakpoint/)).toBeInTheDocument();
    const valueOneCountBeforeEvaluate = screen.getAllByText('1').length;

    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText('codePane.debugEvaluatePlaceholder'), {
        target: { value: 'value' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'codePane.debugEvaluateRun' }));
    });

    expect(window.electronAPI.codePaneDebugEvaluate).toHaveBeenCalledWith({
      sessionId: 'debug-session-1',
      expression: 'value',
    });
    const evaluationEntries = await screen.findAllByText('value');
    expect(evaluationEntries.length).toBeGreaterThan(1);
    expect((await screen.findAllByText('1')).length).toBeGreaterThan(valueOneCountBeforeEvaluate);
  });

  it('restores debug sessions and persisted watch expressions', async () => {
    vi.mocked(window.electronAPI.codePaneListDebugSessions).mockResolvedValue({
      success: true,
      data: [
        {
          session: {
            id: 'debug-session-restored',
            targetId: 'debug-target-python',
            label: 'service.py',
            detail: 'python service.py',
            languageId: 'python',
            adapterType: 'pdb',
            request: 'launch',
            state: 'paused',
            workingDirectory: '/workspace/project',
            startedAt: '2026-04-13T00:00:00.000Z',
            stopReason: 'breakpoint',
            currentFrame: {
              id: 'frame-1',
              name: 'main',
              filePath: '/workspace/project/src/service.py',
              lineNumber: 12,
              column: 1,
            },
          },
          output: 'Restored output\n',
        },
      ],
    });
    vi.mocked(window.electronAPI.codePaneGetDebugSessionDetails).mockResolvedValue({
      success: true,
      data: {
        sessionId: 'debug-session-restored',
        stackFrames: [
          {
            id: 'frame-1',
            name: 'main',
            filePath: '/workspace/project/src/service.py',
            lineNumber: 12,
            column: 1,
          },
        ],
        scopes: [
          {
            id: 'locals',
            name: 'Locals',
            variables: [
              {
                id: 'var-1',
                name: 'value',
                value: '1',
              },
            ],
          },
        ],
      },
    });
    vi.mocked(window.electronAPI.codePaneDebugEvaluate).mockImplementation(async ({ expression }) => ({
      success: true,
      data: {
        value: expression === 'value' ? '1' : '',
      },
    }));

    renderCodePane(createPane({
      debug: {
        watchExpressions: ['value'],
      },
    }));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'codePane.debugTab' }));
    });

    expect((await screen.findAllByText('service.py')).length).toBeGreaterThan(0);
    expect(await screen.findByText(/Restored output/)).toBeInTheDocument();
    await waitFor(() => {
      expect(window.electronAPI.codePaneDebugEvaluate).toHaveBeenCalledWith({
        sessionId: 'debug-session-restored',
        expression: 'value',
      });
    });
  });

  it('coalesces overlapping debug tool window refresh requests', async () => {
    let resolveDebugSessions: (() => void) | null = null;
    let resolveExceptionBreakpoints: (() => void) | null = null;

    vi.mocked(window.electronAPI.codePaneListRunTargets).mockResolvedValue({
      success: true,
      data: [],
    });
    vi.mocked(window.electronAPI.codePaneListDebugSessions).mockImplementation(async () => {
      await new Promise<void>((resolve) => {
        resolveDebugSessions = resolve;
      });
      return {
        success: true,
        data: [],
      };
    });
    vi.mocked(window.electronAPI.codePaneGetExceptionBreakpoints).mockImplementation(async () => {
      await new Promise<void>((resolve) => {
        resolveExceptionBreakpoints = resolve;
      });
      return {
        success: true,
        data: [{ id: 'all', label: 'All Exceptions', enabled: false }],
      };
    });

    renderCodePane(createPane());

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'codePane.debugTab' }));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(window.electronAPI.codePaneListDebugSessions).toHaveBeenCalledTimes(1);
      expect(window.electronAPI.codePaneGetExceptionBreakpoints).toHaveBeenCalledTimes(1);
      expect(window.electronAPI.codePaneListRunTargets).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      fireEvent.click(within(screen.getByTestId('code-pane-bottom-panel')).getAllByRole('button', { name: 'codePane.refresh' })[0]);
      await Promise.resolve();
    });

    expect(window.electronAPI.codePaneListDebugSessions).toHaveBeenCalledTimes(1);
    expect(window.electronAPI.codePaneGetExceptionBreakpoints).toHaveBeenCalledTimes(1);
    expect(window.electronAPI.codePaneListRunTargets).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveDebugSessions?.();
      resolveExceptionBreakpoints?.();
      await Promise.resolve();
    });
  });

  it('toggles breakpoints from the editor gutter', async () => {
    renderCodePane(createPane());

    await openFileFromTree('index.ts');

    const activeEditor = fakeMonaco.editor.create.mock.results.at(-1)?.value;
    expect(activeEditor).toBeDefined();

    await act(async () => {
      activeEditor.fireMouseDown({
        target: {
          type: 'gutterGlyphMargin',
          position: { lineNumber: 1, column: 1 },
        },
        event: {
          browserEvent: {
            button: 0,
            buttons: 1,
            preventDefault: vi.fn(),
            stopPropagation: vi.fn(),
          },
          preventDefault: vi.fn(),
          stopPropagation: vi.fn(),
        },
      });
      await Promise.resolve();
    });

    expect(window.electronAPI.codePaneSetBreakpoint).toHaveBeenCalledWith({
      rootPath: '/workspace/project',
      breakpoint: {
        filePath: '/workspace/project/src/index.ts',
        lineNumber: 1,
      },
    });

    await act(async () => {
      activeEditor.fireMouseDown({
        target: {
          type: 'gutterGlyphMargin',
          position: { lineNumber: 1, column: 1 },
        },
        event: {
          browserEvent: {
            button: 0,
            buttons: 1,
            preventDefault: vi.fn(),
            stopPropagation: vi.fn(),
          },
          preventDefault: vi.fn(),
          stopPropagation: vi.fn(),
        },
      });
      await Promise.resolve();
    });

    expect(window.electronAPI.codePaneRemoveBreakpoint).toHaveBeenCalledWith({
      rootPath: '/workspace/project',
      breakpoint: {
        filePath: '/workspace/project/src/index.ts',
        lineNumber: 1,
      },
    });
  });

  it('opens the tests tool window, shows the test tree, and reruns failed tests', async () => {
    vi.mocked(window.electronAPI.codePaneListTests).mockResolvedValue({
      success: true,
      data: [
        {
          id: 'test-file-1',
          label: 'test_service.py',
          kind: 'file',
          filePath: '/workspace/project/tests/test_service.py',
          runnableTargetId: 'test-target-1',
          children: [
            {
              id: 'test-case-1',
              label: 'test_handles_request',
              kind: 'case',
              filePath: '/workspace/project/tests/test_service.py',
              runnableTargetId: 'test-target-case-1',
            },
          ],
        },
      ],
    });

    renderCodePane(createPane());

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'codePane.testsTab' }));
    });

    await waitFor(() => {
      expect(window.electronAPI.codePaneListTests).toHaveBeenCalledWith({
        rootPath: '/workspace/project',
        activeFilePath: null,
      });
    });

    const testFileButton = await screen.findByRole('button', { name: /test_service\.py/ });
    await act(async () => {
      fireEvent.click(testFileButton);
    });

    await waitFor(() => {
      expect(window.electronAPI.codePaneReadFile).toHaveBeenCalledWith({
        rootPath: '/workspace/project',
        filePath: '/workspace/project/tests/test_service.py',
      });
    });

    await emitRunSessionChanged({
      rootPath: '/workspace/project',
      session: {
        id: 'test-session-1',
        targetId: 'test-target-1',
        label: 'test_service.py',
        detail: 'python -m pytest test_service.py',
        kind: 'test',
        languageId: 'python',
        state: 'failed',
        workingDirectory: '/workspace/project',
        startedAt: '2026-04-13T00:00:00.000Z',
        endedAt: '2026-04-13T00:00:03.000Z',
        exitCode: 1,
      },
    });

    await act(async () => {
      fireEvent.click(screen.getByText('codePane.rerunFailedTests'));
    });

    expect(window.electronAPI.codePaneRerunFailedTests).toHaveBeenCalledWith({
      rootPath: '/workspace/project',
    });
  });

  it('opens the project tool window and runs project commands', async () => {
    vi.mocked(window.electronAPI.codePaneGetProjectContribution).mockResolvedValue({
      success: true,
      data: [
        {
          id: 'java-project',
          title: 'Java Project',
          languageId: 'java',
          statusItems: [
            {
              id: 'build-tool',
              label: 'Build: Maven',
              tone: 'info',
            },
          ],
          commandGroups: [
            {
              id: 'java-commands',
              title: 'Maven',
              commands: [
                {
                  id: 'java-maven-test',
                  title: 'Test',
                  detail: 'mvn test',
                  kind: 'run',
                },
              ],
            },
          ],
          detailCards: [
            {
              id: 'java-details',
              title: 'Project Files',
              lines: ['Root: /workspace/project'],
            },
          ],
          treeSections: [
            {
              id: 'spring-routes',
              title: 'Request Mappings',
              items: [
                {
                  id: 'spring-route-1',
                  label: 'GET /api/users',
                  kind: 'entry',
                  description: 'UserController.list',
                  filePath: '/workspace/project/src/main/java/com/example/UserController.java',
                  lineNumber: 12,
                },
              ],
            },
          ],
        },
      ],
    });
    vi.mocked(window.electronAPI.codePaneRunProjectCommand).mockResolvedValue({
      success: true,
      data: {
        id: 'project-session-1',
        targetId: 'project-command-target-1',
        label: 'Test',
        detail: 'mvn test',
        kind: 'task',
        languageId: 'java',
        state: 'starting',
        workingDirectory: '/workspace/project',
        startedAt: '2026-04-13T00:00:00.000Z',
      },
    });

    renderCodePane(createPane());

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'codePane.projectTab' }));
    });

    await waitFor(() => {
      expect(window.electronAPI.codePaneGetProjectContribution).toHaveBeenCalledWith({
        rootPath: '/workspace/project',
      });
    });

    expect(await screen.findByText('codePane.projectTitleJava')).toBeInTheDocument();
    expect(screen.getByText('codePane.projectLabelRequestMappings')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /codePane\.projectCommandTest.*mvn test/i }));
    });

    expect(window.electronAPI.codePaneRunProjectCommand).toHaveBeenCalledWith({
      rootPath: '/workspace/project',
      commandId: 'java-maven-test',
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /GET \/api\/users/i }));
    });

    await waitFor(() => {
      expect(window.electronAPI.codePaneReadFile).toHaveBeenCalledWith({
        rootPath: '/workspace/project',
        filePath: '/workspace/project/src/main/java/com/example/UserController.java',
      });
    });
  });

  it('refreshes the project model after non-run project commands complete', async () => {
    vi.mocked(window.electronAPI.codePaneGetProjectContribution).mockResolvedValue({
      success: true,
      data: [
        {
          id: 'python-project',
          title: 'Python Project',
          languageId: 'python',
          commandGroups: [
            {
              id: 'python-project-environment',
              title: 'Environment',
              commands: [
                {
                  id: 'python-project-refresh-model',
                  title: 'Refresh Project Model',
                  detail: 'Rescan interpreters and project files',
                  kind: 'refresh',
                },
              ],
            },
          ],
        },
      ],
    });
    vi.mocked(window.electronAPI.codePaneRunProjectCommand).mockResolvedValue({
      success: true,
      data: null,
    });
    vi.mocked(window.electronAPI.codePaneRefreshProjectModel).mockResolvedValue({
      success: true,
      data: [
        {
          id: 'python-project',
          title: 'Python Project',
          languageId: 'python',
          statusItems: [
            {
              id: 'python-environment',
              label: 'Environment: .venv',
              tone: 'info',
            },
          ],
          commandGroups: [
            {
              id: 'python-project-environment',
              title: 'Environment',
              commands: [
                {
                  id: 'python-project-refresh-model',
                  title: 'Refresh Project Model',
                  detail: 'Rescan interpreters and project files',
                  kind: 'refresh',
                },
              ],
            },
          ],
        },
      ],
    });

    renderCodePane(createPane());

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'codePane.projectTab' }));
    });

    expect(await screen.findByText('codePane.projectTitlePython')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /codePane\.projectCommandRefreshProjectModel.*Rescan interpreters and project files/i }));
    });

    await waitFor(() => {
      expect(window.electronAPI.codePaneRunProjectCommand).toHaveBeenCalledWith({
        rootPath: '/workspace/project',
        commandId: 'python-project-refresh-model',
      });
      expect(window.electronAPI.codePaneRefreshProjectModel).toHaveBeenCalledWith({
        rootPath: '/workspace/project',
      });
    });

    expect(await screen.findByText('Environment: .venv')).toBeInTheDocument();
  });

  it('shows workspace import state and project diagnostics in the project tool window', async () => {
    vi.mocked(window.electronAPI.codePaneGetProjectContribution).mockResolvedValue({
      success: true,
      data: [
        {
          id: 'java-project',
          title: 'Java Project',
          languageId: 'java',
          diagnostics: [
            {
              id: 'java-missing-wrapper',
              severity: 'warning',
              message: 'Maven wrapper not detected',
              detail: 'Falling back to the system Maven installation can slow imports.',
              commandId: 'java-maven-refresh-model',
              commandLabel: 'Reimport Maven Model',
            },
          ],
          commandGroups: [
            {
              id: 'java-project-sync',
              title: 'Project Sync',
              commands: [
                {
                  id: 'java-maven-refresh-model',
                  title: 'Reimport Maven Model',
                  detail: 'Reload Maven metadata',
                  kind: 'refresh',
                },
              ],
            },
          ],
        },
      ],
    });
    vi.mocked(window.electronAPI.codePaneRunProjectCommand).mockResolvedValue({
      success: true,
      data: null,
    });
    vi.mocked(window.electronAPI.codePaneRefreshProjectModel).mockResolvedValue({
      success: true,
      data: [],
    });

    renderCodePane(createPane());

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'codePane.projectTab' }));
    });

    await emitLanguageWorkspaceChanged({
      state: {
        pluginId: 'official.java-jdtls',
        workspaceRoot: '/workspace/project',
        projectRoot: '/workspace/project',
        languageId: 'java',
        runtimeState: 'running',
        phase: 'importing-project',
        message: 'Importing Maven project',
        progressText: 'Resolving classpath containers',
        readyFeatures: ['definition', 'hover', 'references'],
        timestamp: '2026-04-14T00:00:00.000Z',
      },
    });

    expect(await screen.findByText('codePane.projectWorkspaceState')).toBeInTheDocument();
    expect(screen.getByText('codePane.workspacePhaseImporting')).toBeInTheDocument();
    expect(screen.getByText('Resolving classpath containers')).toBeInTheDocument();
    expect(screen.getByText('codePane.projectDiagnostics')).toBeInTheDocument();
    expect(screen.getByText('codePane.projectDiagnosticWrapperMissing')).toBeInTheDocument();
    expect(screen.getByText('definition')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'codePane.projectCommandReimportMavenModel' }));
    });

    await waitFor(() => {
      expect(window.electronAPI.codePaneRunProjectCommand).toHaveBeenCalledWith({
        rootPath: '/workspace/project',
        commandId: 'java-maven-refresh-model',
      });
    });
  });

  it('shows repository summary and changed files in the SCM tab without loading the commit graph', async () => {
    vi.mocked(window.electronAPI.codePaneGetGitStatus).mockResolvedValue({
      success: true,
      data: [
        {
          path: '/workspace/project/src/index.ts',
          status: 'modified',
          unstaged: true,
          section: 'unstaged',
        },
      ],
    });
    vi.mocked(window.electronAPI.codePaneGetGitRepositorySummary).mockResolvedValue({
      success: true,
      data: {
        repoRootPath: '/workspace/project',
        currentBranch: 'feature/scm',
        upstreamBranch: 'origin/feature/scm',
        detachedHead: false,
        headSha: '1234567890abcdef',
        aheadCount: 2,
        behindCount: 1,
        operation: 'merge',
        hasConflicts: true,
      },
    });
    vi.mocked(window.electronAPI.codePaneGetGitGraph).mockResolvedValue({
      success: true,
      data: [
        {
          sha: '1234567890abcdef',
          shortSha: '1234567',
          parents: ['abcdef1234567890'],
          subject: 'Merge feature branch',
          author: 'Test User',
          timestamp: 1_710_000_000,
          refs: ['HEAD -> feature/scm', 'origin/feature/scm'],
          isHead: true,
          isMergeCommit: true,
          lane: 0,
          laneCount: 1,
        },
      ],
    });

    renderCodePane(createPane());

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'codePane.scmTab' }));
    });

    expect((await screen.findAllByText('feature/scm')).length).toBeGreaterThan(0);
    expect(screen.getByText('codePane.gitOpenWorkbench')).toBeInTheDocument();
    expect(screen.getByText('codePane.gitOpenChangesWorkbench')).toBeInTheDocument();
    expect(window.electronAPI.codePaneGetGitGraph).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'codePane.gitOpenChangesWorkbench' }));
    });

    expect(await screen.findByText('codePane.gitChangesWorkbenchTab')).toBeInTheDocument();
    expect(screen.getByText('codePane.gitSectionUnstaged')).toBeInTheDocument();
    expect(await screen.findByText('index.ts')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'codePane.openDiff' }));
    });

    await waitFor(() => {
      expect(window.electronAPI.codePaneReadGitBaseFile).toHaveBeenCalledWith({
        rootPath: '/workspace/project',
        filePath: '/workspace/project/src/index.ts',
      });
    });
  });

  it('opens the git changes workbench from the SCM sidebar', async () => {
    vi.mocked(window.electronAPI.codePaneGetGitStatus).mockResolvedValue({
      success: true,
      data: [
        {
          path: '/workspace/project/src/index.ts',
          status: 'modified',
          unstaged: true,
          section: 'unstaged',
        },
      ],
    });
    vi.mocked(window.electronAPI.codePaneGetGitRepositorySummary).mockResolvedValue({
      success: true,
      data: {
        repoRootPath: '/workspace/project',
        currentBranch: 'feature/scm',
        upstreamBranch: 'origin/feature/scm',
        detachedHead: false,
        headSha: '1234567890abcdef',
        aheadCount: 1,
        behindCount: 0,
        operation: 'idle',
        hasConflicts: false,
      },
    });

    renderCodePane(createPane());

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'codePane.scmTab' }));
    });

    expect(await screen.findByRole('button', { name: 'codePane.gitCommitDots' })).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'codePane.gitOpenChangesWorkbench' }));
    });

    expect(await screen.findByText('codePane.gitChangesWorkbenchTab')).toBeInTheDocument();
    expect(screen.getByText('codePane.gitSectionUnstaged')).toBeInTheDocument();
    expect(screen.getByText('index.ts')).toBeInTheDocument();
    expect(screen.queryByText('codePane.gitLogTab')).toBeInTheDocument();
    expect(window.electronAPI.codePaneGetGitGraph).not.toHaveBeenCalled();
    expect(window.electronAPI.codePaneGetGitBranches).not.toHaveBeenCalled();
    expect(window.electronAPI.codePaneGetGitRebasePlan).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'codePane.gitLogTab' }));
    });

    await waitFor(() => {
      expect(window.electronAPI.codePaneGetGitGraph).toHaveBeenCalledWith({
        rootPath: '/workspace/project',
        limit: 60,
      });
      expect(window.electronAPI.codePaneGetGitBranches).toHaveBeenCalledWith({
        rootPath: '/workspace/project',
      });
    });
  });

  it('opens a rename refactor preview and applies it', async () => {
    const user = userEvent.setup();
    vi.mocked(window.electronAPI.codePanePrepareRefactor).mockResolvedValue({
      success: true,
      data: {
        id: 'preview-rename-1',
        title: 'Rename symbol to nextValue',
        source: 'refactor',
        createdAt: '2026-04-13T00:00:00.000Z',
        files: [
          {
            id: 'preview-rename-1:/workspace/project/src/index.ts',
            kind: 'modify',
            filePath: '/workspace/project/src/index.ts',
            language: 'typescript',
            beforeContent: 'export const value = 1;\n',
            afterContent: 'export const nextValue = 1;\n',
            edits: [],
          },
        ],
      },
    });
    vi.mocked(window.electronAPI.codePaneApplyRefactor).mockResolvedValue({
      success: true,
      data: {
        id: 'preview-rename-1',
        title: 'Rename symbol to nextValue',
        source: 'refactor',
        createdAt: '2026-04-13T00:00:00.000Z',
        files: [
          {
            id: 'preview-rename-1:/workspace/project/src/index.ts',
            kind: 'modify',
            filePath: '/workspace/project/src/index.ts',
            language: 'typescript',
            beforeContent: 'export const value = 1;\n',
            afterContent: 'export const nextValue = 1;\n',
            edits: [],
          },
        ],
      },
    });

    renderCodePane(createPane({
      openFiles: [{ path: '/workspace/project/src/index.ts' }],
      activeFilePath: '/workspace/project/src/index.ts',
      selectedPath: '/workspace/project/src/index.ts',
    }));

    await waitFor(() => {
      expect(window.electronAPI.codePaneReadFile).toHaveBeenCalledWith({
        rootPath: '/workspace/project',
        filePath: '/workspace/project/src/index.ts',
      });
    });

    await triggerEditorAction('codePane.renameSymbol');
    await user.clear(await screen.findByRole('textbox', { name: 'codePane.renameSymbol' }));
    await user.type(screen.getByRole('textbox', { name: 'codePane.renameSymbol' }), 'nextValue');
    await user.click(screen.getByRole('button', { name: 'codePane.renameSymbol' }));

    expect(window.electronAPI.codePanePrepareRefactor).toHaveBeenCalledWith({
      kind: 'rename-symbol',
      rootPath: '/workspace/project',
      filePath: '/workspace/project/src/index.ts',
      language: 'typescript',
      position: {
        lineNumber: 1,
        column: 1,
      },
      newName: 'nextValue',
    });
    expect(await screen.findByText('Rename symbol to nextValue')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'codePane.refactorApply' }));
    });

    expect(window.electronAPI.codePaneApplyRefactor).toHaveBeenCalledWith({
      previewId: 'preview-rename-1',
    });

    vi.mocked(window.electronAPI.codePaneReadFile).mockResolvedValue({
      success: true,
      data: {
        content: 'export const nextValue = 1;\n',
        mtimeMs: 300,
        size: 28,
        language: 'typescript',
        isBinary: false,
      },
    });

    await emitFsChanged({
      rootPath: '/workspace/project',
      changes: [
        {
          type: 'change',
          path: '/workspace/project/src/index.ts',
        },
        {
          type: 'change',
          path: '/workspace/project/src/index.ts',
        },
      ],
    });

    expect(screen.queryByText('codePane.externalChangesSubtitle')).not.toBeInTheDocument();
  });

  it('runs git stage, commit, history, and blame workflows from the code pane', async () => {
    vi.mocked(window.electronAPI.codePaneGetGitStatus).mockResolvedValue({
      success: true,
      data: [
        {
          path: '/workspace/project/src/index.ts',
          status: 'modified',
          unstaged: true,
          section: 'unstaged',
        },
      ],
    });
    vi.mocked(window.electronAPI.codePaneGitHistory).mockResolvedValue({
      success: true,
      data: {
        scope: 'file',
        targetFilePath: '/workspace/project/src/index.ts',
        entries: [
          {
            commitSha: 'abcdef1234567890',
            shortSha: 'abcdef1',
            subject: 'Refine index flow',
            author: 'Test User',
            timestamp: 1_710_000_000,
            refs: ['HEAD -> feature/scm'],
            scope: 'file',
            filePath: '/workspace/project/src/index.ts',
          },
        ],
      },
    });
    vi.mocked(window.electronAPI.codePaneGitBlame).mockResolvedValue({
      success: true,
      data: [
        {
          lineNumber: 1,
          commitSha: 'abcdef1234567890',
          shortSha: 'abcdef1',
          author: 'Test User',
          summary: 'Refine index flow',
          timestamp: 1_710_000_000,
          text: 'export const value = 1;',
        },
      ],
    });

    renderCodePane(createPane({
      openFiles: [{ path: '/workspace/project/src/index.ts' }],
      activeFilePath: '/workspace/project/src/index.ts',
      selectedPath: '/workspace/project/src/index.ts',
    }));

    await waitFor(() => {
      expect(window.electronAPI.codePaneReadFile).toHaveBeenCalledWith({
        rootPath: '/workspace/project',
        filePath: '/workspace/project/src/index.ts',
      });
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'codePane.scmTab' }));
    });

    expect(screen.queryByPlaceholderText('codePane.gitCommitPlaceholder')).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'codePane.gitCommitDots' }));
    });

    expect(await screen.findByPlaceholderText('codePane.gitCommitPlaceholder')).toBeInTheDocument();

    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText('codePane.gitCommitPlaceholder'), {
        target: { value: 'Add git workflow' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'codePane.gitCommit' }));
    });

    expect(window.electronAPI.codePaneGitCommit).toHaveBeenCalledWith({
      rootPath: '/workspace/project',
      message: 'Add git workflow',
      amend: false,
      includeAll: true,
      paths: ['/workspace/project/src/index.ts'],
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'codePane.gitOpenChangesWorkbench' }));
    });

    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'codePane.gitFileHistory' }));
    });

    expect(window.electronAPI.codePaneGitHistory).toHaveBeenCalledWith({
      rootPath: '/workspace/project',
      filePath: '/workspace/project/src/index.ts',
      lineNumber: undefined,
      limit: 30,
    });
    expect((await screen.findAllByText('Refine index flow')).length).toBeGreaterThan(1);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'codePane.filesTab' }));
    });

    await triggerEditorAction('codePane.gitBlame');

    await waitFor(() => {
      expect(window.electronAPI.codePaneGitBlame).toHaveBeenCalledWith({
        rootPath: '/workspace/project',
        filePath: '/workspace/project/src/index.ts',
      });
    });
    expect(await screen.findByText(/Test User · Refine index flow/)).toBeInTheDocument();
  }, 10_000);

  it('reuses cached blame results for repeated blame toggles on the same file', async () => {
    vi.mocked(window.electronAPI.codePaneGitBlame).mockResolvedValue({
      success: true,
      data: [
        {
          lineNumber: 1,
          commitSha: 'abcdef1234567890',
          shortSha: 'abcdef1',
          author: 'Test User',
          summary: 'Refine index flow',
          timestamp: 1_710_000_000,
          text: 'export const value = 1;',
        },
      ],
    });

    renderCodePane(createPane({
      openFiles: [{ path: '/workspace/project/src/index.ts' }],
      activeFilePath: '/workspace/project/src/index.ts',
      selectedPath: '/workspace/project/src/index.ts',
    }));

    await waitFor(() => {
      expect(window.electronAPI.codePaneReadFile).toHaveBeenCalledWith({
        rootPath: '/workspace/project',
        filePath: '/workspace/project/src/index.ts',
      });
    });

    await triggerEditorAction('codePane.gitBlame');

    await waitFor(() => {
      expect(window.electronAPI.codePaneGitBlame).toHaveBeenCalledTimes(1);
    });

    await triggerEditorAction('codePane.gitBlame');
    await triggerEditorAction('codePane.gitBlame');

    expect(window.electronAPI.codePaneGitBlame).toHaveBeenCalledTimes(1);
  });

  it('filters the commit window to included files without changing the selected commit paths', async () => {
    vi.mocked(window.electronAPI.codePaneGetGitStatus).mockResolvedValue({
      success: true,
      data: [
        {
          path: '/workspace/project/src/index.ts',
          status: 'modified',
          unstaged: true,
          section: 'unstaged',
        },
        {
          path: '/workspace/project/src/other.ts',
          status: 'modified',
          unstaged: true,
          section: 'unstaged',
        },
      ],
    });

    renderCodePane(createPane({
      openFiles: [{ path: '/workspace/project/src/index.ts' }],
      activeFilePath: '/workspace/project/src/index.ts',
      selectedPath: '/workspace/project/src/index.ts',
    }));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'codePane.scmTab' }));
    });

    expect(await screen.findByRole('button', { name: 'codePane.gitCommitDots' })).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'codePane.gitCommitDots' }));
    });

    expect(await screen.findByPlaceholderText('codePane.gitCommitPlaceholder')).toBeInTheDocument();
    const commitMessageField = screen.getByPlaceholderText('codePane.gitCommitPlaceholder');
    const commitWindow = commitMessageField.closest('[role="dialog"]') ?? commitMessageField.parentElement?.parentElement?.parentElement?.parentElement;
    expect(commitWindow).not.toBeNull();
    const commitWindowQueries = within(commitWindow as HTMLElement);
    expect((await commitWindowQueries.findAllByText('other.ts')).length).toBeGreaterThan(0);

    await act(async () => {
      fireEvent.click(commitWindowQueries.getAllByRole('button', { name: 'codePane.gitUnselectPath' })[1]);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'codePane.gitShowIncludedOnly' }));
    });

    expect(commitWindowQueries.getAllByText('index.ts').length).toBeGreaterThan(0);
    expect(commitWindowQueries.queryAllByText('other.ts')).toHaveLength(0);

    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText('codePane.gitCommitPlaceholder'), {
        target: { value: 'Commit selected file only' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'codePane.gitCommit' }));
    });

    expect(window.electronAPI.codePaneGitCommit).toHaveBeenCalledWith({
      rootPath: '/workspace/project',
      message: 'Commit selected file only',
      amend: false,
      includeAll: true,
      paths: ['/workspace/project/src/index.ts'],
    });
  });

  it('groups commit window entries by directory and lets groups collapse', async () => {
    vi.mocked(window.electronAPI.codePaneGetGitStatus).mockResolvedValue({
      success: true,
      data: [
        {
          path: '/workspace/project/src/index.ts',
          status: 'modified',
          unstaged: true,
          section: 'unstaged',
        },
        {
          path: '/workspace/project/src/components/button.tsx',
          status: 'modified',
          unstaged: true,
          section: 'unstaged',
        },
        {
          path: '/workspace/project/tests/button.test.tsx',
          status: 'modified',
          unstaged: true,
          section: 'unstaged',
        },
      ],
    });

    renderCodePane(createPane({
      openFiles: [{ path: '/workspace/project/src/index.ts' }],
      activeFilePath: '/workspace/project/src/index.ts',
      selectedPath: '/workspace/project/src/index.ts',
    }));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'codePane.scmTab' }));
    });

    expect(await screen.findByRole('button', { name: 'codePane.gitCommitDots' })).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'codePane.gitCommitDots' }));
    });

    const commitMessageField = await screen.findByPlaceholderText('codePane.gitCommitPlaceholder');
    const commitWindow = commitMessageField.closest('[role="dialog"]') ?? commitMessageField.parentElement?.parentElement?.parentElement?.parentElement;
    expect(commitWindow).not.toBeNull();
    const commitWindowQueries = within(commitWindow as HTMLElement);

    expect(commitWindowQueries.getByText('src')).toBeInTheDocument();
    expect(commitWindowQueries.getByText('src/components')).toBeInTheDocument();
    expect(commitWindowQueries.getByText('tests')).toBeInTheDocument();
    expect(commitWindowQueries.getByText('button.tsx')).toBeInTheDocument();

    const componentsGroupToggle = commitWindowQueries.getByText('src/components').closest('button');
    expect(componentsGroupToggle).not.toBeNull();

    await act(async () => {
      fireEvent.click(componentsGroupToggle as HTMLButtonElement);
    });

    expect(commitWindowQueries.queryByText('button.tsx')).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(componentsGroupToggle as HTMLButtonElement);
    });

    expect(commitWindowQueries.getByText('button.tsx')).toBeInTheDocument();
  });

  it('toggles commit window selection for an entire directory group', async () => {
    vi.mocked(window.electronAPI.codePaneGetGitStatus).mockResolvedValue({
      success: true,
      data: [
        {
          path: '/workspace/project/src/index.ts',
          status: 'modified',
          unstaged: true,
          section: 'unstaged',
        },
        {
          path: '/workspace/project/src/components/button.tsx',
          status: 'modified',
          unstaged: true,
          section: 'unstaged',
        },
        {
          path: '/workspace/project/src/components/input.tsx',
          status: 'modified',
          unstaged: true,
          section: 'unstaged',
        },
      ],
    });

    renderCodePane(createPane({
      openFiles: [{ path: '/workspace/project/src/index.ts' }],
      activeFilePath: '/workspace/project/src/index.ts',
      selectedPath: '/workspace/project/src/index.ts',
    }));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'codePane.scmTab' }));
    });

    expect(await screen.findByRole('button', { name: 'codePane.gitCommitDots' })).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'codePane.gitCommitDots' }));
    });

    const commitMessageField = await screen.findByPlaceholderText('codePane.gitCommitPlaceholder');
    const commitWindow = commitMessageField.closest('[role="dialog"]') ?? commitMessageField.parentElement?.parentElement?.parentElement?.parentElement;
    expect(commitWindow).not.toBeNull();
    const commitWindowQueries = within(commitWindow as HTMLElement);

    const componentsGroupSection = commitWindowQueries.getByText('src/components').closest('section');
    expect(componentsGroupSection).not.toBeNull();
    const groupSelectionToggle = within(componentsGroupSection as HTMLElement).getByRole('button', { name: 'codePane.gitUnselectGroup' });

    await act(async () => {
      fireEvent.click(groupSelectionToggle);
    });

    await act(async () => {
      fireEvent.change(commitMessageField, {
        target: { value: 'Commit without component directory' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'codePane.gitCommit' }));
    });

    expect(window.electronAPI.codePaneGitCommit).toHaveBeenCalledWith({
      rootPath: '/workspace/project',
      message: 'Commit without component directory',
      amend: false,
      includeAll: true,
      paths: ['/workspace/project/src/index.ts'],
    });
  });

  it('opens the conflict resolver below the editor and applies merged content', async () => {
    vi.mocked(window.electronAPI.codePaneGetGitStatus).mockResolvedValue({
      success: true,
      data: [
        {
          path: '/workspace/project/src/index.ts',
          status: 'modified',
          conflicted: true,
          section: 'conflicted',
        },
      ],
    });
    vi.mocked(window.electronAPI.codePaneGetGitConflictDetails).mockResolvedValue({
      success: true,
      data: {
        filePath: '/workspace/project/src/index.ts',
        relativePath: 'src/index.ts',
        baseContent: 'export const value = 1;\n',
        oursContent: 'export const value = 2;\n',
        theirsContent: 'export const value = 3;\n',
        mergedContent: 'export const value = 2;\n',
        language: 'typescript',
      },
    });

    renderCodePane(createPane({
      openFiles: [{ path: '/workspace/project/src/index.ts' }],
      activeFilePath: '/workspace/project/src/index.ts',
      selectedPath: '/workspace/project/src/index.ts',
    }));

    await waitFor(() => {
      expect(window.electronAPI.codePaneReadFile).toHaveBeenCalledWith({
        rootPath: '/workspace/project',
        filePath: '/workspace/project/src/index.ts',
      });
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'codePane.scmTab' }));
    });

    expect(await screen.findByRole('button', { name: 'codePane.gitCommitDots' })).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'codePane.gitOpenChangesWorkbench' }));
    });

    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'codePane.gitResolveConflict' }));
    });

    expect(window.electronAPI.codePaneGetGitConflictDetails).toHaveBeenCalledWith({
      rootPath: '/workspace/project',
      filePath: '/workspace/project/src/index.ts',
    });
    expect(await screen.findByText('codePane.gitConflictResolverTab')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'codePane.gitApplyConflictResolution' }));
    });

    expect(window.electronAPI.codePaneGitApplyConflictResolution).toHaveBeenCalledWith({
      rootPath: '/workspace/project',
      filePath: '/workspace/project/src/index.ts',
      mergedContent: 'export const value = 2;\n',
    });
  });

  it('coalesces overlapping conflict detail refresh requests', async () => {
    let resolveConflict: (() => void) | null = null;

    vi.mocked(window.electronAPI.codePaneGetGitStatus).mockResolvedValue({
      success: true,
      data: [
        {
          path: '/workspace/project/src/index.ts',
          status: 'modified',
          conflicted: true,
          section: 'conflicted',
        },
      ],
    });
    vi.mocked(window.electronAPI.codePaneGetGitConflictDetails).mockImplementation(async () => {
      await new Promise<void>((resolve) => {
        resolveConflict = resolve;
      });
      return {
        success: true,
        data: {
          filePath: '/workspace/project/src/index.ts',
          relativePath: 'src/index.ts',
          baseContent: 'export const value = 1;\n',
          oursContent: 'export const value = 2;\n',
          theirsContent: 'export const value = 3;\n',
          mergedContent: 'export const value = 2;\n',
          language: 'typescript',
        },
      };
    });

    renderCodePane(createPane({
      openFiles: [{ path: '/workspace/project/src/index.ts' }],
      activeFilePath: '/workspace/project/src/index.ts',
      selectedPath: '/workspace/project/src/index.ts',
    }));

    await waitFor(() => {
      expect(window.electronAPI.codePaneReadFile).toHaveBeenCalledWith({
        rootPath: '/workspace/project',
        filePath: '/workspace/project/src/index.ts',
      });
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'codePane.scmTab' }));
    });

    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'codePane.gitOpenChangesWorkbench' }));
    });

    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'codePane.gitResolveConflict' }));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(window.electronAPI.codePaneGetGitConflictDetails).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      fireEvent.click(within(screen.getByTestId('code-pane-bottom-panel')).getAllByRole('button', { name: 'codePane.refresh' })[0]);
      await Promise.resolve();
    });

    expect(window.electronAPI.codePaneGetGitConflictDetails).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveConflict?.();
      await Promise.resolve();
    });
  });

  it('opens the git workbench below the editor and loads branches with a one-line log list', async () => {
    vi.mocked(window.electronAPI.codePaneGetGitRepositorySummary).mockResolvedValue({
      success: true,
      data: {
        repoRootPath: '/workspace/project',
        currentBranch: 'feature/workbench',
        upstreamBranch: 'origin/main',
        detachedHead: false,
        headSha: '1234567890abcdef',
        aheadCount: 2,
        behindCount: 0,
        operation: 'idle',
        hasConflicts: false,
      },
    });
    vi.mocked(window.electronAPI.codePaneGetGitBranches).mockResolvedValue({
      success: true,
      data: [
        {
          name: 'feature/workbench',
          refName: 'refs/heads/feature/workbench',
          shortName: 'feature/workbench',
          kind: 'local',
          current: true,
          upstream: 'origin/main',
          aheadCount: 2,
          behindCount: 0,
          commitSha: 'abcdef1234567890',
          shortSha: 'abcdef1',
          subject: 'Feature commit 2',
          timestamp: 1_710_000_100,
          mergedIntoCurrent: false,
        },
        {
          name: 'main',
          refName: 'refs/heads/main',
          shortName: 'main',
          kind: 'local',
          current: false,
          upstream: 'origin/main',
          aheadCount: 0,
          behindCount: 0,
          commitSha: '1234567890abcdef',
          shortSha: '1234567',
          subject: 'Base commit',
          timestamp: 1_710_000_000,
          mergedIntoCurrent: true,
        },
      ],
    });
    vi.mocked(window.electronAPI.codePaneGetGitGraph).mockResolvedValue({
      success: true,
      data: [
        {
          sha: 'abcdef1234567890',
          shortSha: 'abcdef1',
          parents: ['1234567890abcdef'],
          subject: 'Feature commit 2',
          author: 'Test User',
          timestamp: 1_710_000_100,
          refs: ['HEAD -> feature/workbench'],
          isHead: true,
          isMergeCommit: false,
          lane: 0,
          laneCount: 1,
        },
        {
          sha: '1234567890abcdef',
          shortSha: '1234567',
          parents: [],
          subject: 'Base commit',
          author: 'Test User',
          timestamp: 1_710_000_000,
          refs: ['main', 'origin/main'],
          isHead: false,
          isMergeCommit: false,
          lane: 0,
          laneCount: 1,
        },
      ],
    });
    vi.mocked(window.electronAPI.codePaneGetGitRebasePlan).mockResolvedValue({
      success: true,
      data: {
        baseRef: 'origin/main',
        currentBranch: 'feature/workbench',
        hasMergeCommits: false,
        commits: [
          {
            commitSha: '1111111111111111',
            shortSha: '1111111',
            subject: 'Feature commit 1',
            author: 'Test User',
            timestamp: 1_710_000_010,
            action: 'pick',
          },
          {
            commitSha: 'abcdef1234567890',
            shortSha: 'abcdef1',
            subject: 'Feature commit 2',
            author: 'Test User',
            timestamp: 1_710_000_100,
            action: 'pick',
          },
        ],
      },
    });

    renderCodePane(createPane());

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'codePane.gitWorkbenchTab' }));
    });

    await waitFor(() => {
      expect(window.electronAPI.codePaneGetGitBranches).toHaveBeenCalledWith({
        rootPath: '/workspace/project',
      });
    });
    expect(window.electronAPI.codePaneGetGitRebasePlan).not.toHaveBeenCalled();
    expect((await screen.findAllByText('codePane.gitBranchManager')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Feature commit 2').length).toBeGreaterThan(0);
    expect(screen.getAllByText('feature/workbench').length).toBeGreaterThan(0);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'codePane.gitRebasePlanner' }));
    });

    await waitFor(() => {
      expect(window.electronAPI.codePaneGetGitRebasePlan).toHaveBeenCalledWith({
        rootPath: '/workspace/project',
        baseRef: 'origin/main',
      });
    });
  });

  it('renders the current branch in the editor header', async () => {
    vi.mocked(window.electronAPI.codePaneGetGitRepositorySummary).mockResolvedValue({
      success: true,
      data: {
        repoRootPath: '/workspace/project',
        currentBranch: 'feature/workbench',
        upstreamBranch: 'origin/main',
        detachedHead: false,
        headSha: '1234567890abcdef',
        aheadCount: 1,
        behindCount: 0,
        operation: 'idle',
        hasConflicts: false,
      },
    });
    vi.mocked(window.electronAPI.codePaneGetGitBranches).mockResolvedValue({
      success: true,
      data: [
        {
          name: 'feature/workbench',
          refName: 'refs/heads/feature/workbench',
          shortName: 'feature/workbench',
          kind: 'local',
          current: true,
          upstream: 'origin/main',
          aheadCount: 1,
          behindCount: 0,
          commitSha: 'abcdef1234567890',
          shortSha: 'abcdef1',
          subject: 'Feature commit',
          timestamp: 1_710_000_100,
          mergedIntoCurrent: false,
        },
      ],
    });

    renderCodePane(createPane());

    const branchButtons = await screen.findAllByRole('button', { name: 'codePane.gitBranchManager' });
    expect(branchButtons.length).toBeGreaterThan(0);
    expect(branchButtons[0]).toHaveTextContent('codePane.gitDetachedHead');

  });

  it('opens the IDEA-like branch manager from the editor header and runs branch actions', async () => {
    const user = userEvent.setup();
    vi.mocked(window.electronAPI.codePaneGetGitRepositorySummary).mockResolvedValue({
      success: true,
      data: {
        repoRootPath: '/workspace/project',
        currentBranch: 'feature/current',
        upstreamBranch: 'origin/feature/current',
        detachedHead: false,
        headSha: '1234567890abcdef',
        aheadCount: 1,
        behindCount: 0,
        operation: 'idle',
        hasConflicts: false,
      },
    });
    vi.mocked(window.electronAPI.codePaneGetGitBranches).mockResolvedValue({
      success: true,
      data: [
        {
          name: 'feature/current',
          refName: 'refs/heads/feature/current',
          shortName: 'feature/current',
          kind: 'local',
          current: true,
          upstream: 'origin/feature/current',
          aheadCount: 1,
          behindCount: 0,
          commitSha: 'abcdef1234567890',
          shortSha: 'abcdef1',
          subject: 'Current feature',
          timestamp: 1_710_000_100,
          mergedIntoCurrent: false,
        },
        {
          name: 'main',
          refName: 'refs/heads/main',
          shortName: 'main',
          kind: 'local',
          current: false,
          upstream: 'origin/main',
          aheadCount: 0,
          behindCount: 0,
          commitSha: '1234567890abcdef',
          shortSha: '1234567',
          subject: 'Base commit',
          timestamp: 1_710_000_000,
          mergedIntoCurrent: true,
        },
        {
          name: 'origin/release/2026.04',
          refName: 'refs/remotes/origin/release/2026.04',
          shortName: 'origin/release/2026.04',
          kind: 'remote',
          current: false,
          upstream: undefined,
          aheadCount: 0,
          behindCount: 0,
          commitSha: '3333333333333333',
          shortSha: '3333333',
          subject: 'Release branch',
          timestamp: 1_710_000_050,
          mergedIntoCurrent: false,
        },
      ],
    });

    renderCodePane(createPane());

    const branchButton = await screen.findByRole('button', { name: 'codePane.gitBranchManager' });
    await user.click(branchButton);

    expect(await screen.findByPlaceholderText('codePane.gitBranchSearchPlaceholder')).toBeInTheDocument();
    expect(screen.queryAllByText('feature/current')).toHaveLength(1);
    expect(screen.getByText('codePane.gitUpdateProject')).toBeInTheDocument();
    expect(await screen.findByText('codePane.gitRecentBranches')).toBeInTheDocument();
    expect(screen.getByText('codePane.gitLocalBranches')).toBeInTheDocument();
    expect(screen.getByText('codePane.gitRemoteBranches')).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText('codePane.gitBranchSearchPlaceholder'), 'release');
    const releaseEntries = await screen.findAllByText('2026.04');
    expect(releaseEntries.length).toBeGreaterThan(0);
    expect(screen.queryByText('main')).not.toBeInTheDocument();

    await user.click(releaseEntries[0]);
    await waitFor(() => {
      expect(window.electronAPI.codePaneGitCheckout).toHaveBeenCalledWith({
        rootPath: '/workspace/project',
        branchName: 'release/2026.04',
        createBranch: true,
        startPoint: 'origin/release/2026.04',
        preferExisting: true,
        detached: undefined,
      });
    });

    await waitFor(() => {
      expect(screen.queryByPlaceholderText('codePane.gitBranchSearchPlaceholder')).not.toBeInTheDocument();
    });
    await user.click(branchButton);
    await user.click(await screen.findByText('codePane.gitUpdateProject'));
    await waitFor(() => {
      expect(window.electronAPI.codePaneGitUpdateProject).toHaveBeenCalledWith({
        rootPath: '/workspace/project',
      });
    });
  });

  it('opens a dedicated dialog for creating a branch from the branch manager quick actions', async () => {
    const user = userEvent.setup();
    vi.mocked(window.electronAPI.codePaneGetGitRepositorySummary).mockResolvedValue({
      success: true,
      data: {
        repoRootPath: '/workspace/project',
        currentBranch: 'feature/current',
        upstreamBranch: 'origin/feature/current',
        detachedHead: false,
        headSha: '1234567890abcdef',
        aheadCount: 1,
        behindCount: 0,
        operation: 'idle',
        hasConflicts: false,
      },
    });
    vi.mocked(window.electronAPI.codePaneGetGitBranches).mockResolvedValue({
      success: true,
      data: [
        {
          name: 'feature/current',
          refName: 'refs/heads/feature/current',
          shortName: 'feature/current',
          kind: 'local',
          current: true,
          upstream: 'origin/feature/current',
          aheadCount: 1,
          behindCount: 0,
          commitSha: 'abcdef1234567890',
          shortSha: 'abcdef1',
          subject: 'Current feature',
          timestamp: 1_710_000_100,
          mergedIntoCurrent: false,
        },
      ],
    });

    renderCodePane(createPane());

    const branchButton = await screen.findByRole('button', { name: 'codePane.gitBranchManager' });
    await user.click(branchButton);
    await user.click(await screen.findByText('codePane.gitNewBranchDots'));

    const input = await screen.findByRole('textbox', { name: 'codePane.gitCreateBranch' });
    await user.type(input, 'feature/dialog-branch');
    await user.click(screen.getByRole('button', { name: 'codePane.gitCreateBranch' }));

    await waitFor(() => {
      expect(window.electronAPI.codePaneGitCheckout).toHaveBeenCalledWith({
        rootPath: '/workspace/project',
        branchName: 'feature/dialog-branch',
        createBranch: true,
        startPoint: 'feature/current',
        detached: undefined,
        preferExisting: undefined,
      });
    });
  });

  it('reuses cached branch manager data when reopening the header popup', async () => {
    const user = userEvent.setup();
    vi.mocked(window.electronAPI.codePaneGetGitRepositorySummary).mockResolvedValue({
      success: true,
      data: {
        repoRootPath: '/workspace/project',
        currentBranch: 'feature/current',
        upstreamBranch: 'origin/feature/current',
        detachedHead: false,
        headSha: '1234567890abcdef',
        aheadCount: 1,
        behindCount: 0,
        operation: 'idle',
        hasConflicts: false,
      },
    });
    vi.mocked(window.electronAPI.codePaneGetGitBranches).mockResolvedValue({
      success: true,
      data: [
        {
          name: 'feature/current',
          refName: 'refs/heads/feature/current',
          shortName: 'feature/current',
          kind: 'local',
          current: true,
          upstream: 'origin/feature/current',
          aheadCount: 1,
          behindCount: 0,
          commitSha: 'abcdef1234567890',
          shortSha: 'abcdef1',
          subject: 'Current feature',
          timestamp: 1_710_000_100,
          mergedIntoCurrent: false,
        },
      ],
    });

    renderCodePane(createPane());

    const branchButton = await screen.findByRole('button', { name: 'codePane.gitBranchManager' });
    await user.click(branchButton);
    expect(await screen.findByPlaceholderText('codePane.gitBranchSearchPlaceholder')).toBeInTheDocument();

    await waitFor(() => {
      expect(window.electronAPI.codePaneGetGitBranches).toHaveBeenCalledTimes(1);
    });

    await user.click(branchButton);
    await waitFor(() => {
      expect(screen.queryByPlaceholderText('codePane.gitBranchSearchPlaceholder')).not.toBeInTheDocument();
    });

    await user.click(branchButton);
    expect(await screen.findByPlaceholderText('codePane.gitBranchSearchPlaceholder')).toBeInTheDocument();
    expect(window.electronAPI.codePaneGetGitBranches).toHaveBeenCalledTimes(1);
  });

  it('compares selected commits in click order and opens revision diff from the git workbench', async () => {
    vi.mocked(window.electronAPI.codePaneGetGitRepositorySummary).mockResolvedValue({
      success: true,
      data: {
        repoRootPath: '/workspace/project',
        currentBranch: 'feature/workbench',
        upstreamBranch: 'origin/main',
        detachedHead: false,
        headSha: '2222222222222222',
        aheadCount: 2,
        behindCount: 0,
        operation: 'idle',
        hasConflicts: false,
      },
    });
    vi.mocked(window.electronAPI.codePaneGetGitBranches).mockResolvedValue({
      success: true,
      data: [
        {
          name: 'feature/workbench',
          refName: 'refs/heads/feature/workbench',
          shortName: 'feature/workbench',
          kind: 'local',
          current: true,
          upstream: 'origin/main',
          aheadCount: 2,
          behindCount: 0,
          commitSha: '2222222222222222',
          shortSha: '2222222',
          subject: 'Feature head',
          timestamp: 1_710_000_200,
          mergedIntoCurrent: false,
        },
      ],
    });
    vi.mocked(window.electronAPI.codePaneGetGitGraph).mockResolvedValue({
      success: true,
      data: [
        {
          sha: '2222222222222222',
          shortSha: '2222222',
          parents: ['1111111111111111'],
          subject: 'Feature head',
          author: 'Test User',
          timestamp: 1_710_000_200,
          refs: ['HEAD -> feature/workbench'],
          isHead: true,
          isMergeCommit: false,
          lane: 0,
          laneCount: 1,
        },
        {
          sha: '1111111111111111',
          shortSha: '1111111',
          parents: [],
          subject: 'Base commit',
          author: 'Test User',
          timestamp: 1_710_000_000,
          refs: ['main'],
          isHead: false,
          isMergeCommit: false,
          lane: 0,
          laneCount: 1,
        },
      ],
    });
    vi.mocked(window.electronAPI.codePaneCompareGitCommits).mockResolvedValue({
      success: true,
      data: {
        baseCommitSha: '1111111111111111',
        targetCommitSha: '2222222222222222',
        files: [
          {
            path: '/workspace/project/src/index.ts',
            relativePath: 'src/index.ts',
            status: 'modified',
            additions: 3,
            deletions: 1,
          },
        ],
      },
    });
    vi.mocked(window.electronAPI.codePaneReadGitRevisionFile)
      .mockResolvedValueOnce({
        success: true,
        data: {
          content: 'export const value = 0;\n',
          exists: true,
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          content: 'export const value = 2;\n',
          exists: true,
        },
      });

    renderCodePane(createPane());

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'codePane.gitWorkbenchTab' }));
    });

    const baseCommitButton = await screen.findByRole('button', { name: /Base commit/i });
    const headCommitButton = await screen.findByRole('button', { name: /Feature head/i });

    await act(async () => {
      fireEvent.click(baseCommitButton);
    });

    await act(async () => {
      fireEvent.click(headCommitButton, { ctrlKey: true });
    });

    await waitFor(() => {
      expect(window.electronAPI.codePaneCompareGitCommits).toHaveBeenCalledWith({
        rootPath: '/workspace/project',
        baseCommitSha: '1111111111111111',
        targetCommitSha: '2222222222222222',
      });
    });

    const diffRow = await screen.findByText('src/index.ts');
    await act(async () => {
      fireEvent.doubleClick(diffRow);
    });

    await waitFor(() => {
      expect(window.electronAPI.codePaneReadGitRevisionFile).toHaveBeenCalledWith({
        rootPath: '/workspace/project',
        filePath: '/workspace/project/src/index.ts',
        commitSha: '1111111111111111',
      });
      expect(window.electronAPI.codePaneReadGitRevisionFile).toHaveBeenCalledWith({
        rootPath: '/workspace/project',
        filePath: '/workspace/project/src/index.ts',
        commitSha: '2222222222222222',
      });
    });
  });

  it('applies a git rebase plan from the bottom workbench', async () => {
    vi.mocked(window.electronAPI.codePaneGetGitRepositorySummary).mockResolvedValue({
      success: true,
      data: {
        repoRootPath: '/workspace/project',
        currentBranch: 'feature/workbench',
        upstreamBranch: 'origin/main',
        detachedHead: false,
        headSha: '1234567890abcdef',
        aheadCount: 2,
        behindCount: 0,
        operation: 'idle',
        hasConflicts: false,
      },
    });
    vi.mocked(window.electronAPI.codePaneGetGitBranches).mockResolvedValue({
      success: true,
      data: [
        {
          name: 'feature/workbench',
          refName: 'refs/heads/feature/workbench',
          shortName: 'feature/workbench',
          kind: 'local',
          current: true,
          upstream: 'origin/main',
          aheadCount: 2,
          behindCount: 0,
          commitSha: 'abcdef1234567890',
          shortSha: 'abcdef1',
          subject: 'Feature commit 2',
          timestamp: 1_710_000_100,
          mergedIntoCurrent: false,
        },
        {
          name: 'origin/main',
          refName: 'refs/remotes/origin/main',
          shortName: 'origin/main',
          kind: 'remote',
          current: false,
          upstream: undefined,
          aheadCount: 0,
          behindCount: 0,
          commitSha: '1234567890abcdef',
          shortSha: '1234567',
          subject: 'Base commit',
          timestamp: 1_710_000_000,
          mergedIntoCurrent: false,
        },
      ],
    });
    vi.mocked(window.electronAPI.codePaneGetGitGraph).mockResolvedValue({
      success: true,
      data: [],
    });
    vi.mocked(window.electronAPI.codePaneGetGitRebasePlan).mockResolvedValue({
      success: true,
      data: {
        baseRef: 'origin/main',
        currentBranch: 'feature/workbench',
        hasMergeCommits: false,
        commits: [
          {
            commitSha: '1111111111111111',
            shortSha: '1111111',
            subject: 'Feature commit 1',
            author: 'Test User',
            timestamp: 1_710_000_010,
            action: 'pick',
          },
          {
            commitSha: 'abcdef1234567890',
            shortSha: 'abcdef1',
            subject: 'Feature commit 2',
            author: 'Test User',
            timestamp: 1_710_000_100,
            action: 'pick',
          },
        ],
      },
    });

    renderCodePane(createPane());

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'codePane.gitWorkbenchTab' }));
    });

    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'codePane.gitRebasePlanner' }));
    });

    await waitFor(() => {
      expect(window.electronAPI.codePaneGitApplyRebasePlan).not.toHaveBeenCalled();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'codePane.gitApplyRebasePlan' }));
    });

    expect(window.electronAPI.codePaneGitApplyRebasePlan).toHaveBeenCalledWith({
      rootPath: '/workspace/project',
      baseRef: 'origin/main',
      entries: [
        expect.objectContaining({
          commitSha: '1111111111111111',
          action: 'pick',
        }),
        expect.objectContaining({
          commitSha: 'abcdef1234567890',
          action: 'pick',
        }),
      ],
    });
  });

  it('loads and applies git hunks for the selected SCM file', async () => {
    const unstagedHunk: CodePaneGitDiffHunk = {
      id: '/workspace/project/src/index.ts:unstaged:1',
      filePath: '/workspace/project/src/index.ts',
      staged: false,
      header: '@@ -1,1 +1,1 @@',
      patch: [
        'diff --git a/src/index.ts b/src/index.ts',
        'index 1111111..2222222 100644',
        '--- a/src/index.ts',
        '+++ b/src/index.ts',
        '@@ -1,1 +1,1 @@',
        '-export const value = 1;',
        '+export const value = 2;',
        '',
      ].join('\n'),
      lines: [
        {
          type: 'delete',
          text: 'export const value = 1;',
          oldLineNumber: 1,
        },
        {
          type: 'add',
          text: 'export const value = 2;',
          newLineNumber: 1,
        },
      ],
    };

    vi.mocked(window.electronAPI.codePaneGetGitStatus).mockResolvedValue({
      success: true,
      data: [
        {
          path: '/workspace/project/src/index.ts',
          status: 'modified',
          unstaged: true,
          section: 'unstaged',
        },
      ],
    });
    vi.mocked(window.electronAPI.codePaneGetGitDiffHunks).mockResolvedValue({
      success: true,
      data: {
        filePath: '/workspace/project/src/index.ts',
        stagedHunks: [],
        unstagedHunks: [unstagedHunk],
      },
    });
    vi.mocked(window.electronAPI.codePaneGetGitRepositorySummary).mockResolvedValue({
      success: true,
      data: {
        repoRootPath: '/workspace/project',
        currentBranch: 'feature/scm',
        upstreamBranch: 'origin/feature/scm',
        detachedHead: false,
        headSha: '1234567890abcdef',
        aheadCount: 1,
        behindCount: 0,
        operation: 'idle',
        hasConflicts: false,
      },
    });

    renderCodePane(createPane());

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'codePane.scmTab' }));
    });

    expect(await screen.findByRole('button', { name: 'codePane.gitCommitDots' })).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'codePane.gitOpenChangesWorkbench' }));
    });

    const scmFileButton = await screen.findByRole('button', { name: /index\.ts/ });
    await act(async () => {
      fireEvent.click(scmFileButton);
    });

    await waitFor(() => {
      expect(window.electronAPI.codePaneGetGitDiffHunks).toHaveBeenCalledWith({
        rootPath: '/workspace/project',
        filePath: '/workspace/project/src/index.ts',
      });
    });
    expect(await screen.findByText('codePane.gitSelectedFileHunks')).toBeInTheDocument();
    expect(screen.getByText('@@ -1,1 +1,1 @@')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'codePane.gitStageHunk' }));
    });

    expect(window.electronAPI.codePaneGitStageHunk).toHaveBeenCalledWith({
      rootPath: '/workspace/project',
      filePath: '/workspace/project/src/index.ts',
      patch: unstagedHunk.patch,
    });
  });

  it('coalesces overlapping git hunk loads for the same file', async () => {
    let resolveDiffHunks: (() => void) | null = null;

    vi.mocked(window.electronAPI.codePaneGetGitStatus).mockResolvedValue({
      success: true,
      data: [
        {
          path: '/workspace/project/src/index.ts',
          status: 'modified',
          unstaged: true,
          section: 'unstaged',
        },
      ],
    });
    vi.mocked(window.electronAPI.codePaneGetGitRepositorySummary).mockResolvedValue({
      success: true,
      data: {
        repoRootPath: '/workspace/project',
        currentBranch: 'feature/scm',
        upstreamBranch: 'origin/feature/scm',
        detachedHead: false,
        headSha: '1234567890abcdef',
        aheadCount: 1,
        behindCount: 0,
        operation: 'idle',
        hasConflicts: false,
      },
    });
    vi.mocked(window.electronAPI.codePaneGetGitDiffHunks).mockImplementation(async () => {
      await new Promise<void>((resolve) => {
        resolveDiffHunks = resolve;
      });
      return {
        success: true,
        data: {
          filePath: '/workspace/project/src/index.ts',
          stagedHunks: [],
          unstagedHunks: [],
        },
      };
    });

    renderCodePane(createPane());

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'codePane.scmTab' }));
    });

    expect(await screen.findByRole('button', { name: 'codePane.gitCommitDots' })).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'codePane.gitOpenChangesWorkbench' }));
    });

    expect(await screen.findByText('codePane.gitChangesWorkbenchTab')).toBeInTheDocument();

    const scmFileButton = await screen.findByRole('button', { name: /index\.ts/ });
    await act(async () => {
      fireEvent.click(scmFileButton);
      fireEvent.click(scmFileButton);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(window.electronAPI.codePaneGetGitDiffHunks).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      resolveDiffHunks?.();
      await Promise.resolve();
    });
  });

  it('shows Monaco diagnostics in the problems tab', async () => {
    renderCodePane(createPane());

    await openFileFromTree('index.ts');

    await act(async () => {
      fakeMonacoState.setMarkers('/workspace/project/src/index.ts', [
        {
          severity: fakeMonaco.MarkerSeverity.Error,
          message: 'Missing semicolon',
          startLineNumber: 1,
          startColumn: 10,
        },
      ]);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'codePane.problemsTab' }));
    });

    expect(await screen.findByText('Missing semicolon')).toBeInTheDocument();
  });

  it('syncs language documents on open, change, save, and unmount', async () => {
    const view = renderCodePane(createPane());

    await openFileFromTree('index.ts');

    await waitFor(() => {
      expect(window.electronAPI.codePaneDidOpenDocument).toHaveBeenCalledWith({
        paneId: 'pane-code-1',
        rootPath: '/workspace/project',
        filePath: '/workspace/project/src/index.ts',
        language: 'typescript',
        content: 'export const value = 1;\n',
      });
    });

    vi.useFakeTimers();

    await act(async () => {
      fakeMonacoState.models.get('/workspace/project/src/index.ts')?.setValue('export const value = 2;\n');
      vi.advanceTimersByTime(149);
      await Promise.resolve();
    });
    expect(window.electronAPI.codePaneDidChangeDocument).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(window.electronAPI.codePaneDidChangeDocument).toHaveBeenCalledWith({
      paneId: 'pane-code-1',
      rootPath: '/workspace/project',
      filePath: '/workspace/project/src/index.ts',
      language: 'typescript',
      content: 'export const value = 2;\n',
    });

    await act(async () => {
      vi.advanceTimersByTime(650);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(window.electronAPI.codePaneDidSaveDocument).toHaveBeenCalledWith({
      paneId: 'pane-code-1',
      rootPath: '/workspace/project',
      filePath: '/workspace/project/src/index.ts',
      language: 'typescript',
      content: 'export const value = 2;\n',
    });

    await act(async () => {
      view.unmount();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(window.electronAPI.codePaneDidCloseDocument).toHaveBeenCalledWith({
      paneId: 'pane-code-1',
      rootPath: '/workspace/project',
      filePath: '/workspace/project/src/index.ts',
    });

    vi.useRealTimers();
  });

  it('formats the active file with language edits', async () => {
    vi.mocked(window.electronAPI.codePaneFormatDocument).mockResolvedValue({
      success: true,
      data: [
        {
          filePath: '/workspace/project/src/index.ts',
          range: {
            startLineNumber: 1,
            startColumn: 14,
            endLineNumber: 1,
            endColumn: 19,
          },
          newText: 'formattedValue',
        },
      ],
    });

    renderCodePane(createPane());

    await openFileFromTree('index.ts');

    await triggerEditorAction('codePane.formatDocument');

    await waitFor(() => {
      expect(window.electronAPI.codePaneFormatDocument).toHaveBeenCalledWith({
        rootPath: '/workspace/project',
        filePath: '/workspace/project/src/index.ts',
        language: 'typescript',
        content: 'export const value = 1;\n',
        tabSize: 2,
        insertSpaces: true,
      });
    });

    await waitFor(() => {
      expect(window.electronAPI.codePaneWriteFile).toHaveBeenCalledWith({
        rootPath: '/workspace/project',
        filePath: '/workspace/project/src/index.ts',
        content: 'export const formattedValue = 1;\n',
        expectedMtimeMs: 100,
      });
    });
  });

  it('runs the save quality pipeline before writing the file', async () => {
    vi.mocked(window.electronAPI.codePaneFormatDocument).mockResolvedValue({
      success: true,
      data: [
        {
          filePath: '/workspace/project/src/index.ts',
          range: {
            startLineNumber: 1,
            startColumn: 14,
            endLineNumber: 1,
            endColumn: 19,
          },
          newText: 'formattedValue',
        },
      ],
    });
    vi.mocked(window.electronAPI.codePaneGetCodeActions).mockResolvedValue({
      success: true,
      data: [
        {
          id: 'organize-imports',
          title: 'Organize Imports',
          kind: 'source.organizeImports',
        },
      ],
    });
    vi.mocked(window.electronAPI.codePaneRunCodeAction).mockResolvedValue({
      success: true,
      data: [
        {
          filePath: '/workspace/project/src/index.ts',
          range: {
            startLineNumber: 1,
            startColumn: 1,
            endLineNumber: 1,
            endColumn: 1,
          },
          newText: "import './setup';\n",
        },
      ],
    });
    vi.mocked(window.electronAPI.codePaneLintDocument).mockResolvedValue({
      success: true,
      data: [
        {
          filePath: '/workspace/project/src/index.ts',
          owner: 'save-quality-linter',
          severity: 'warning',
          message: 'Unused import',
          startLineNumber: 1,
          startColumn: 1,
          endLineNumber: 1,
          endColumn: 7,
        },
      ],
    });

    renderCodePane(createPane({
      savePipeline: {
        formatOnSave: true,
        organizeImportsOnSave: true,
        lintOnSave: true,
      },
    }));

    await openFileFromTree('index.ts');
    vi.useFakeTimers();

    try {
      await act(async () => {
        fakeMonacoState.models.get('/workspace/project/src/index.ts')?.setValue('export const value = 2;\n');
        vi.advanceTimersByTime(800);
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(window.electronAPI.codePaneFormatDocument).toHaveBeenCalledWith(expect.objectContaining({
        content: 'export const value = 2;\n',
      }));
      expect(window.electronAPI.codePaneGetCodeActions).toHaveBeenCalled();
      expect(window.electronAPI.codePaneRunCodeAction).toHaveBeenCalledWith({
        rootPath: '/workspace/project',
        filePath: '/workspace/project/src/index.ts',
        language: 'typescript',
        actionId: 'organize-imports',
      });
      expect(window.electronAPI.codePaneLintDocument).toHaveBeenCalledWith({
        rootPath: '/workspace/project',
        filePath: '/workspace/project/src/index.ts',
        language: 'typescript',
        content: "import './setup';\nexport const formattedValue = 2;\n",
      });
      expect(window.electronAPI.codePaneWriteFile).toHaveBeenCalledWith({
        rootPath: '/workspace/project',
        filePath: '/workspace/project/src/index.ts',
        content: "import './setup';\nexport const formattedValue = 2;\n",
        expectedMtimeMs: 100,
      });
      expect(window.electronAPI.codePaneGetGitStatus).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('renames the symbol under the caret with workspace edits', async () => {
    vi.mocked(window.electronAPI.codePanePrepareRefactor).mockResolvedValue({
      success: true,
      data: {
        id: 'preview-rename-positioned',
        title: 'Rename symbol to renamedValue',
        source: 'refactor',
        createdAt: '2026-04-13T00:00:00.000Z',
        files: [
          {
            id: 'preview-rename-positioned:/workspace/project/src/index.ts',
            kind: 'modify',
            filePath: '/workspace/project/src/index.ts',
            language: 'typescript',
            beforeContent: 'export const value = 1;\n',
            afterContent: 'export const renamedValue = 1;\n',
            edits: [],
          },
        ],
      },
    });
    vi.mocked(window.electronAPI.codePaneApplyRefactor).mockResolvedValue({
      success: true,
      data: {
        id: 'preview-rename-positioned',
        title: 'Rename symbol to renamedValue',
        source: 'refactor',
        createdAt: '2026-04-13T00:00:00.000Z',
        files: [
          {
            id: 'preview-rename-positioned:/workspace/project/src/index.ts',
            kind: 'modify',
            filePath: '/workspace/project/src/index.ts',
            language: 'typescript',
            beforeContent: 'export const value = 1;\n',
            afterContent: 'export const renamedValue = 1;\n',
            edits: [],
          },
        ],
      },
    });
    const user = userEvent.setup();

    renderCodePane(createPane());

    await openFileFromTree('index.ts');

    const activeEditor = fakeMonaco.editor.create.mock.results.at(-1)?.value;
    await act(async () => {
      activeEditor.setPosition({ lineNumber: 1, column: 15 });
    });
    await triggerEditorAction('codePane.renameSymbol');
    await user.clear(await screen.findByRole('textbox', { name: 'codePane.renameSymbol' }));
    await user.type(screen.getByRole('textbox', { name: 'codePane.renameSymbol' }), 'renamedValue');
    await user.click(screen.getByRole('button', { name: 'codePane.renameSymbol' }));

    await waitFor(() => {
      expect(window.electronAPI.codePanePrepareRefactor).toHaveBeenCalledWith({
        kind: 'rename-symbol',
        rootPath: '/workspace/project',
        filePath: '/workspace/project/src/index.ts',
        language: 'typescript',
        position: {
          lineNumber: 1,
          column: 15,
        },
        newName: 'renamedValue',
      });
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'codePane.refactorApply' }));
    });

    await waitFor(() => {
      expect(window.electronAPI.codePaneApplyRefactor).toHaveBeenCalledWith({
        previewId: 'preview-rename-positioned',
      });
    });
  });

  it('finds usages for the symbol under the caret and shows them in the search panel', async () => {
    vi.mocked(window.electronAPI.codePaneGetReferences).mockResolvedValue({
      success: true,
      data: [
        {
          filePath: '/workspace/project/src/util.ts',
          range: {
            startLineNumber: 3,
            startColumn: 5,
            endLineNumber: 3,
            endColumn: 10,
          },
          previewText: 'return value + 1;',
        },
      ],
    });

    renderCodePane(createPane());

    await openFileFromTree('index.ts');

    const activeEditor = fakeMonaco.editor.create.mock.results.at(-1)?.value;
    await act(async () => {
      activeEditor.setPosition({ lineNumber: 1, column: 15 });
    });
    await triggerEditorAction('codePane.findUsages');

    await waitFor(() => {
      expect(window.electronAPI.codePaneGetReferences).toHaveBeenCalledWith({
        rootPath: '/workspace/project',
        filePath: '/workspace/project/src/index.ts',
        language: 'typescript',
        position: {
          lineNumber: 1,
          column: 15,
        },
      });
    });

    expect(await screen.findByText('util.ts')).toBeInTheDocument();
    expect(screen.getByText('return value + 1;')).toBeInTheDocument();
  });

  it('tracks navigation history and supports back/forward navigation', async () => {
    vi.mocked(window.electronAPI.codePaneGetDefinition).mockResolvedValue({
      success: true,
      data: [
        {
          filePath: '/workspace/project/src/util.ts',
          range: {
            startLineNumber: 3,
            startColumn: 5,
            endLineNumber: 3,
            endColumn: 9,
          },
        },
      ],
    });
    vi.mocked(window.electronAPI.codePaneReadFile).mockImplementation(async ({ filePath }) => ({
      success: true,
      data: {
        content: filePath.endsWith('util.ts') ? 'export const util = 1;\n' : 'export const value = 1;\n',
        mtimeMs: 100,
        size: 24,
        language: 'typescript',
        isBinary: false,
      },
    }));

    const view = renderCodePane(createPane());

    await openFileFromTree('index.ts');

    const activeEditor = fakeMonaco.editor.create.mock.results.at(-1)?.value;
    await act(async () => {
      activeEditor.fireMouseDown({
        target: {
          position: {
            lineNumber: 1,
            column: 8,
          },
        },
        event: {
          ctrlKey: true,
          metaKey: false,
          leftButton: true,
          preventDefault: vi.fn(),
          stopPropagation: vi.fn(),
        },
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(view.getPane().code?.activeFilePath).toBe('/workspace/project/src/util.ts');
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'codePane.navigateBack' }));
    });

    await waitFor(() => {
      expect(view.getPane().code?.activeFilePath).toBe('/workspace/project/src/index.ts');
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'codePane.navigateForward' }));
    });

    await waitFor(() => {
      expect(view.getPane().code?.activeFilePath).toBe('/workspace/project/src/util.ts');
    });
  });

  it('loads code actions for the active caret location and applies the selected action', async () => {
    vi.mocked(window.electronAPI.codePaneGetCodeActions).mockResolvedValue({
      success: true,
      data: [
        {
          id: 'fix-1',
          title: 'Add missing import',
          kind: 'quickfix',
          isPreferred: true,
        },
      ],
    });
    vi.mocked(window.electronAPI.codePaneRunCodeAction).mockResolvedValue({
      success: true,
      data: [
        {
          filePath: '/workspace/project/src/index.ts',
          range: {
            startLineNumber: 1,
            startColumn: 1,
            endLineNumber: 1,
            endColumn: 1,
          },
          newText: 'import { helper } from "./helper";\n',
        },
      ],
    });

    renderCodePane(createPane());

    await openFileFromTree('index.ts');

    const activeEditor = fakeMonaco.editor.create.mock.results.at(-1)?.value;
    await act(async () => {
      activeEditor.setPosition({ lineNumber: 1, column: 15 });
    });
    await triggerEditorAction('codePane.codeActions');

    await waitFor(() => {
      expect(window.electronAPI.codePaneGetCodeActions).toHaveBeenCalledWith({
        rootPath: '/workspace/project',
        filePath: '/workspace/project/src/index.ts',
        language: 'typescript',
        range: {
          startLineNumber: 1,
          startColumn: 14,
          endLineNumber: 1,
          endColumn: 19,
        },
      });
    });

    await act(async () => {
      fireEvent.click(await screen.findByText('Add missing import'));
    });

    await waitFor(() => {
      expect(window.electronAPI.codePaneRunCodeAction).toHaveBeenCalledWith({
        rootPath: '/workspace/project',
        filePath: '/workspace/project/src/index.ts',
        language: 'typescript',
        actionId: 'fix-1',
      });
    });

    await waitFor(() => {
      expect(window.electronAPI.codePaneWriteFile).toHaveBeenCalledWith({
        rootPath: '/workspace/project',
        filePath: '/workspace/project/src/index.ts',
        content: 'import { helper } from "./helper";\nexport const value = 1;\n',
        expectedMtimeMs: 100,
      });
    });
  });

  it('registers Monaco definition providers that proxy to the language IPC bridge', async () => {
    vi.mocked(window.electronAPI.codePaneGetDefinition).mockResolvedValue({
      success: true,
      data: [
        {
          filePath: '/workspace/project/src/index.ts',
          range: {
            startLineNumber: 1,
            startColumn: 8,
            endLineNumber: 1,
            endColumn: 13,
          },
        },
      ],
    });

    renderCodePane(createPane());

    await openFileFromTree('index.ts');

    await waitFor(() => {
      expect(fakeMonacoState.definitionProviders.get('typescript')).toBeDefined();
    });

    const provider = fakeMonacoState.definitionProviders.get('typescript');

    const result = await provider?.provideDefinition(
      fakeMonacoState.lastEditorModel,
      { lineNumber: 1, column: 8 },
    ) as Array<{ uri: { path: string }; range: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number } }>;

    expect(window.electronAPI.codePaneGetDefinition).toHaveBeenCalledWith({
      rootPath: '/workspace/project',
      filePath: '/workspace/project/src/index.ts',
      language: 'typescript',
      position: {
        lineNumber: 1,
        column: 8,
      },
    });
    expect(result).toEqual([
      expect.objectContaining({
        uri: expect.objectContaining({ path: '/workspace/project/src/index.ts' }),
        range: {
          startLineNumber: 1,
          startColumn: 8,
          endLineNumber: 1,
          endColumn: 13,
        },
      }),
    ]);
  });

  it('registers Monaco document highlight and implementation providers that proxy to the language IPC bridge', async () => {
    vi.mocked(window.electronAPI.codePaneGetDocumentHighlights).mockResolvedValue({
      success: true,
      data: [
        {
          range: {
            startLineNumber: 1,
            startColumn: 14,
            endLineNumber: 1,
            endColumn: 19,
          },
          kind: 'write',
        },
      ],
    });
    vi.mocked(window.electronAPI.codePaneGetImplementations).mockResolvedValue({
      success: true,
      data: [
        {
          filePath: '/workspace/project/src/util.ts',
          range: {
            startLineNumber: 3,
            startColumn: 5,
            endLineNumber: 3,
            endColumn: 9,
          },
        },
      ],
    });

    renderCodePane(createPane());

    await openFileFromTree('index.ts');

    await waitFor(() => {
      expect(fakeMonacoState.documentHighlightProviders.get('typescript')).toBeDefined();
      expect(fakeMonacoState.implementationProviders.get('typescript')).toBeDefined();
    });

    const documentHighlightProvider = fakeMonacoState.documentHighlightProviders.get('typescript');
    const highlightResult = await documentHighlightProvider?.provideDocumentHighlights(
      fakeMonacoState.lastEditorModel,
      { lineNumber: 1, column: 15 },
    ) as Array<{ range: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number }; kind: number }>;

    expect(window.electronAPI.codePaneGetDocumentHighlights).toHaveBeenCalledWith({
      rootPath: '/workspace/project',
      filePath: '/workspace/project/src/index.ts',
      language: 'typescript',
      position: {
        lineNumber: 1,
        column: 15,
      },
    });
    expect(highlightResult).toEqual([
      {
        range: {
          startLineNumber: 1,
          startColumn: 14,
          endLineNumber: 1,
          endColumn: 19,
        },
        kind: fakeMonaco.languages.DocumentHighlightKind.Write,
      },
    ]);

    const implementationProvider = fakeMonacoState.implementationProviders.get('typescript');
    const implementationResult = await implementationProvider?.provideImplementation(
      fakeMonacoState.lastEditorModel,
      { lineNumber: 1, column: 15 },
    ) as Array<{ uri: { path: string } }>;

    expect(window.electronAPI.codePaneGetImplementations).toHaveBeenCalledWith({
      rootPath: '/workspace/project',
      filePath: '/workspace/project/src/index.ts',
      language: 'typescript',
      position: {
        lineNumber: 1,
        column: 15,
      },
    });
    expect(implementationResult).toEqual([
      expect.objectContaining({
        uri: expect.objectContaining({ path: '/workspace/project/src/util.ts' }),
        range: {
          startLineNumber: 3,
          startColumn: 5,
          endLineNumber: 3,
          endColumn: 9,
        },
      }),
    ]);
  });

  it('registers Monaco completion and signature providers that proxy to the language IPC bridge', async () => {
    vi.mocked(window.electronAPI.codePaneGetCompletionItems).mockResolvedValue({
      success: true,
      data: [
        {
          label: 'formatValue',
          detail: 'mock detail',
          documentation: 'mock docs',
          kind: 3,
          insertText: 'formatValue()',
        },
      ],
    });
    vi.mocked(window.electronAPI.codePaneGetSignatureHelp).mockResolvedValue({
      success: true,
      data: {
        signatures: [
          {
            label: 'formatValue(value: string)',
            documentation: 'signature docs',
            parameters: [
              {
                label: 'value: string',
              },
            ],
          },
        ],
        activeSignature: 0,
        activeParameter: 0,
      },
    });

    renderCodePane(createPane());

    await openFileFromTree('index.ts');

    await waitFor(() => {
      expect(fakeMonacoState.completionProviders.get('typescript')).toBeDefined();
      expect(fakeMonacoState.signatureHelpProviders.get('typescript')).toBeDefined();
    });

    const completionProvider = fakeMonacoState.completionProviders.get('typescript');
    const completionResult = await completionProvider?.provideCompletionItems(
      fakeMonacoState.lastEditorModel,
      { lineNumber: 1, column: 15 },
      {},
    ) as { suggestions: Array<{ label: string; insertText: string }> };

    expect(window.electronAPI.codePaneGetCompletionItems).toHaveBeenCalledWith({
      rootPath: '/workspace/project',
      filePath: '/workspace/project/src/index.ts',
      language: 'typescript',
      position: {
        lineNumber: 1,
        column: 15,
      },
      triggerKind: 1,
    });
    expect(completionResult.suggestions[0]).toMatchObject({
      label: 'formatValue',
      insertText: 'formatValue()',
    });

    const signatureProvider = fakeMonacoState.signatureHelpProviders.get('typescript');
    const signatureResult = await signatureProvider?.provideSignatureHelp(
      fakeMonacoState.lastEditorModel,
      { lineNumber: 1, column: 18 },
    ) as { value: { signatures: Array<{ label: string }> } };

    expect(window.electronAPI.codePaneGetSignatureHelp).toHaveBeenCalledWith({
      rootPath: '/workspace/project',
      filePath: '/workspace/project/src/index.ts',
      language: 'typescript',
      position: {
        lineNumber: 1,
        column: 18,
      },
    });
    expect(signatureResult.value.signatures[0]).toMatchObject({
      label: 'formatValue(value: string)',
    });
  });

  it('opens the first definition target on Ctrl/Cmd-click', async () => {
    vi.mocked(window.electronAPI.codePaneGetDefinition).mockResolvedValue({
      success: true,
      data: [
        {
          filePath: '/workspace/project/src/util.ts',
          range: {
            startLineNumber: 3,
            startColumn: 5,
            endLineNumber: 3,
            endColumn: 9,
          },
        },
      ],
    });
    vi.mocked(window.electronAPI.codePaneReadFile).mockImplementation(async ({ filePath }) => ({
      success: true,
      data: {
        content: filePath.endsWith('util.ts') ? 'export const util = 1;\n' : 'export const value = 1;\n',
        mtimeMs: 100,
        size: 24,
        language: 'typescript',
        isBinary: false,
      },
    }));

    const view = renderCodePane(createPane());

    await openFileFromTree('index.ts');

    const activeEditor = fakeMonaco.editor.create.mock.results.at(-1)?.value;
    expect(activeEditor).toBeDefined();

    await act(async () => {
      activeEditor.fireMouseDown({
        target: {
          position: {
            lineNumber: 1,
            column: 8,
          },
        },
        event: {
          ctrlKey: true,
          metaKey: false,
          leftButton: true,
          preventDefault: vi.fn(),
          stopPropagation: vi.fn(),
        },
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(window.electronAPI.codePaneReadFile).toHaveBeenCalledWith({
        rootPath: '/workspace/project',
        filePath: '/workspace/project/src/util.ts',
      });
    });

    expect(view.getPane().code?.activeFilePath).toBe('/workspace/project/src/util.ts');
  });

  it('opens the first definition target when Monaco exposes browserEvent button metadata', async () => {
    vi.mocked(window.electronAPI.codePaneGetDefinition).mockResolvedValue({
      success: true,
      data: [
        {
          filePath: '/workspace/project/src/util.ts',
          range: {
            startLineNumber: 3,
            startColumn: 5,
            endLineNumber: 3,
            endColumn: 9,
          },
        },
      ],
    });
    vi.mocked(window.electronAPI.codePaneReadFile).mockImplementation(async ({ filePath }) => ({
      success: true,
      data: {
        content: filePath.endsWith('util.ts') ? 'export const util = 1;\n' : 'export const value = 1;\n',
        mtimeMs: 100,
        size: 24,
        language: 'typescript',
        isBinary: false,
      },
    }));

    const view = renderCodePane(createPane());

    await openFileFromTree('index.ts');

    const activeEditor = fakeMonaco.editor.create.mock.results.at(-1)?.value;
    expect(activeEditor).toBeDefined();

    await act(async () => {
      activeEditor.fireMouseDown({
        target: {
          position: {
            lineNumber: 1,
            column: 8,
          },
        },
        event: {
          browserEvent: {
            ctrlKey: true,
            metaKey: false,
            button: 0,
            buttons: 1,
            preventDefault: vi.fn(),
            stopPropagation: vi.fn(),
          },
        },
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(view.getPane().code?.activeFilePath).toBe('/workspace/project/src/util.ts');
    });
  });

  it('prefetches definitions on Ctrl/Cmd-hover and decorates the symbol as a link', async () => {
    vi.mocked(window.electronAPI.codePaneGetDefinition).mockResolvedValue({
      success: true,
      data: [
        {
          filePath: '/workspace/project/src/util.ts',
          range: {
            startLineNumber: 3,
            startColumn: 5,
            endLineNumber: 3,
            endColumn: 9,
          },
        },
      ],
    });

    renderCodePane(createPane());

    await openFileFromTree('index.ts');

    const activeEditor = fakeMonaco.editor.create.mock.results.at(-1)?.value;
    expect(activeEditor).toBeDefined();

    await act(async () => {
      activeEditor.fireMouseMove({
        target: {
          position: {
            lineNumber: 1,
            column: 14,
          },
        },
        event: {
          browserEvent: {
            ctrlKey: true,
            metaKey: false,
          },
        },
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(window.electronAPI.codePaneGetDefinition).toHaveBeenCalledWith({
        rootPath: '/workspace/project',
        filePath: '/workspace/project/src/index.ts',
        language: 'typescript',
        position: {
          lineNumber: 1,
          column: 14,
        },
      });
    });

    expect(activeEditor.deltaDecorations).toHaveBeenCalled();
  });

  it('keeps definition lookup cache for unchanged files after editing a different file', async () => {
    vi.mocked(window.electronAPI.codePaneGetDefinition).mockResolvedValue({
      success: true,
      data: [
        {
          filePath: '/workspace/project/src/util.ts',
          range: {
            startLineNumber: 3,
            startColumn: 5,
            endLineNumber: 3,
            endColumn: 9,
          },
        },
      ],
    });

    vi.mocked(window.electronAPI.codePaneListDirectory).mockResolvedValue({
      success: true,
      data: [
        {
          path: '/workspace/project/src/index.ts',
          name: 'index.ts',
          type: 'file',
        },
        {
          path: '/workspace/project/src/util.ts',
          name: 'util.ts',
          type: 'file',
        },
      ],
    });
    vi.mocked(window.electronAPI.codePaneReadFile).mockImplementation(async ({ filePath }) => ({
      success: true,
      data: {
        content: filePath.endsWith('util.ts') ? 'export const util = 1;\n' : 'export const value = 1;\n',
        mtimeMs: 100,
        size: 24,
        language: 'typescript',
        isBinary: false,
      },
    }));

    renderCodePane(createPane());
    await openFileFromTree('index.ts');

    await waitFor(() => {
      expect(fakeMonacoState.definitionProviders.get('typescript')).toBeDefined();
      expect(fakeMonacoState.models.get('/workspace/project/src/index.ts')).toBeDefined();
    });

    let activeEditor = fakeMonaco.editor.create.mock.results.at(-1)?.value;
    expect(activeEditor).toBeDefined();

    await act(async () => {
      activeEditor.fireMouseMove({
        target: {
          position: {
            lineNumber: 1,
            column: 14,
          },
        },
        event: {
          browserEvent: {
            ctrlKey: true,
            metaKey: false,
          },
        },
      });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(window.electronAPI.codePaneGetDefinition).toHaveBeenCalledTimes(1);

    await openFileFromTree('util.ts');
    const utilModel = fakeMonacoState.models.get('/workspace/project/src/util.ts');
    expect(utilModel).toBeDefined();
    activeEditor = fakeMonaco.editor.create.mock.results.at(-1)?.value;

    await act(async () => {
      utilModel?.setValue('export const changed = 2;\n');
      activeEditor.fireMouseMove({
        target: {
          position: {
            lineNumber: 1,
            column: 14,
          },
        },
        event: {
          browserEvent: {
            ctrlKey: true,
            metaKey: false,
          },
        },
      });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(window.electronAPI.codePaneGetDefinition).toHaveBeenCalledTimes(2);

    await openFileFromTree('index.ts');
    activeEditor = fakeMonaco.editor.create.mock.results.at(-1)?.value;
    await act(async () => {
      activeEditor.fireMouseMove({
        target: {
          position: {
            lineNumber: 1,
            column: 14,
          },
        },
        event: {
          browserEvent: {
            ctrlKey: true,
            metaKey: false,
          },
        },
      });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(window.electronAPI.codePaneGetDefinition).toHaveBeenCalledTimes(2);
  });

  it('opens read-only dependency definitions returned as virtual JDT documents', async () => {
    vi.mocked(window.electronAPI.codePaneGetDefinition).mockResolvedValue({
      success: true,
      data: [
        {
          filePath: 'jdt://contents/java.base/java/lang/String.class?=mock',
          uri: 'jdt://contents/java.base/java/lang/String.class?=mock',
          displayPath: 'External Libraries/java.base/java/lang/String.java',
          readOnly: true,
          language: 'java',
          content: 'package java.lang;\npublic final class String {}\n',
          range: {
            startLineNumber: 2,
            startColumn: 20,
            endLineNumber: 2,
            endColumn: 26,
          },
        },
      ],
    });

    const view = renderCodePane(createPane());

    await openFileFromTree('index.ts');

    const activeEditor = fakeMonaco.editor.create.mock.results.at(-1)?.value;
    expect(activeEditor).toBeDefined();

    vi.mocked(window.electronAPI.codePaneReadFile).mockClear();

    await act(async () => {
      activeEditor.fireMouseDown({
        target: {
          position: {
            lineNumber: 1,
            column: 8,
          },
        },
        event: {
          ctrlKey: true,
          metaKey: false,
          leftButton: true,
          preventDefault: vi.fn(),
          stopPropagation: vi.fn(),
        },
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(view.getPane().code?.activeFilePath).toBe('jdt://contents/java.base/java/lang/String.class?=mock');
    });

    await waitFor(() => {
      expect(view.getPane().code?.openFiles).toEqual(expect.arrayContaining([
        expect.objectContaining({
          path: 'jdt://contents/java.base/java/lang/String.class?=mock',
        }),
      ]));
    });
    expect(view.getPane().code?.activeFilePath).toBe('jdt://contents/java.base/java/lang/String.class?=mock');
    expect(window.electronAPI.codePaneReadFile).not.toHaveBeenCalled();
    expect(fakeMonacoState.lastEditorModel?.getValue()).toBe('package java.lang;\npublic final class String {}\n');
  });

  it('applies plugin diagnostics to Monaco markers and the problems panel', async () => {
    renderCodePane(createPane());

    await openFileFromTree('index.ts');
    await waitFor(() => {
      expect(window.electronAPI.onCodePaneDiagnosticsChanged).toHaveBeenCalled();
    });

    await emitDiagnosticsChanged({
      rootPath: '/workspace/project',
      filePath: '/workspace/project/src/index.ts',
      diagnostics: [
        {
          filePath: '/workspace/project/src/index.ts',
          owner: 'language-plugin',
          severity: 'warning',
          message: 'Plugin warning',
          startLineNumber: 1,
          startColumn: 1,
          endLineNumber: 1,
          endColumn: 7,
          source: 'mock-lsp',
          code: 'MOCK001',
        },
      ],
    });

    await waitFor(() => {
      expect(fakeMonaco.editor.setModelMarkers).toHaveBeenCalled();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'codePane.problemsTab' }));
    });

    expect(await screen.findByText('Plugin warning')).toBeInTheDocument();
    expect(fakeMonaco.editor.setModelMarkers).toHaveBeenCalled();
  });

  it('auto-saves dirty files after the debounce delay', async () => {
    renderCodePane(createPane());

    await openFileFromTree('index.ts');

    vi.useFakeTimers();

    await act(async () => {
      fakeMonacoState.models.get('/workspace/project/src/index.ts')?.setValue('export const value = 2;\n');
      vi.advanceTimersByTime(799);
      await Promise.resolve();
    });
    expect(window.electronAPI.codePaneWriteFile).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(window.electronAPI.codePaneWriteFile).toHaveBeenCalledWith({
      rootPath: '/workspace/project',
      filePath: '/workspace/project/src/index.ts',
      content: 'export const value = 2;\n',
      expectedMtimeMs: 100,
    });

    vi.useRealTimers();
  });

  it('writes dirty files without waiting for deferred language change sync', async () => {
    let resolveChangeSync: (() => void) | null = null;
    vi.mocked(window.electronAPI.codePaneDidChangeDocument).mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        resolveChangeSync = resolve;
      });
      return { success: true };
    });

    renderCodePane(createPane());

    await openFileFromTree('index.ts');

    vi.useFakeTimers();

    try {
      await act(async () => {
        fakeMonacoState.models.get('/workspace/project/src/index.ts')?.setValue('export const value = 2;\n');
        vi.advanceTimersByTime(800);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(window.electronAPI.codePaneDidChangeDocument).toHaveBeenCalledWith({
        paneId: 'pane-code-1',
        rootPath: '/workspace/project',
        filePath: '/workspace/project/src/index.ts',
        language: 'typescript',
        content: 'export const value = 2;\n',
      });
      expect(window.electronAPI.codePaneWriteFile).toHaveBeenCalledWith({
        rootPath: '/workspace/project',
        filePath: '/workspace/project/src/index.ts',
        content: 'export const value = 2;\n',
        expectedMtimeMs: 100,
      });

      await act(async () => {
        resolveChangeSync?.();
        await Promise.resolve();
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('saves immediately before the deferred language sync debounce fires', async () => {
    renderCodePane(createPane());

    await openFileFromTree('index.ts');

    vi.useFakeTimers();

    try {
      await act(async () => {
        fakeMonacoState.models.get('/workspace/project/src/index.ts')?.setValue('export const value = 2;\n');
        vi.advanceTimersByTime(149);
        await Promise.resolve();
      });

      expect(window.electronAPI.codePaneDidChangeDocument).not.toHaveBeenCalledWith(expect.objectContaining({
        filePath: '/workspace/project/src/index.ts',
        content: 'export const value = 2;\n',
      }));

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(window.electronAPI.codePaneWriteFile).toHaveBeenCalledWith({
        rootPath: '/workspace/project',
        filePath: '/workspace/project/src/index.ts',
        content: 'export const value = 2;\n',
        expectedMtimeMs: 100,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the file dirty when content changes while a save is in flight', async () => {
    let resolveWrite: ((value: { success: true; data: { mtimeMs: number } }) => void) | null = null;
    vi.mocked(window.electronAPI.codePaneWriteFile).mockImplementationOnce(async () => (
      await new Promise((resolve) => {
        resolveWrite = resolve;
      })
    ));

    renderCodePane(createPane());

    await openFileFromTree('index.ts');

    vi.useFakeTimers();

    try {
      await act(async () => {
        fakeMonacoState.models.get('/workspace/project/src/index.ts')?.setValue('export const value = 2;\n');
        vi.advanceTimersByTime(800);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(window.electronAPI.codePaneWriteFile).toHaveBeenCalledWith({
        rootPath: '/workspace/project',
        filePath: '/workspace/project/src/index.ts',
        content: 'export const value = 2;\n',
        expectedMtimeMs: 100,
      });

      await act(async () => {
        fakeMonacoState.models.get('/workspace/project/src/index.ts')?.setValue('export const value = 3;\n');
        await Promise.resolve();
      });

      await act(async () => {
        resolveWrite?.({
          success: true,
          data: {
            mtimeMs: 200,
          },
        });
        await Promise.resolve();
        await Promise.resolve();
      });

      vi.mocked(window.electronAPI.codePaneWriteFile).mockClear();

      await act(async () => {
        vi.advanceTimersByTime(800);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(window.electronAPI.codePaneWriteFile).toHaveBeenCalledWith({
        rootPath: '/workspace/project',
        filePath: '/workspace/project/src/index.ts',
        content: 'export const value = 3;\n',
        expectedMtimeMs: 200,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('restores diff mode from persisted pane state', async () => {
    const pane = createPane({
      openFiles: [{ path: '/workspace/project/src/index.ts' }],
      activeFilePath: '/workspace/project/src/index.ts',
      selectedPath: '/workspace/project/src/index.ts',
      viewMode: 'diff',
      diffTargetPath: '/workspace/project/src/index.ts',
    });

    const view = renderCodePane(pane);

    await waitFor(() => {
      expect(window.electronAPI.codePaneReadGitBaseFile).toHaveBeenCalledWith({
        rootPath: '/workspace/project',
        filePath: '/workspace/project/src/index.ts',
      });
    });
    expect(fakeMonacoState.lastDiffModel?.original.getValue()).toBe('export const value = 0;\n');
    expect(fakeMonacoState.lastDiffModel?.modified.getValue()).toBe('export const value = 1;\n');
    expect(view.getPane().code?.viewMode).toBe('diff');
    expect(screen.getByText('codePane.diffView')).toBeInTheDocument();
  });

  it('flushes dirty files when the pane unmounts', async () => {
    const view = renderCodePane(createPane());

    await openFileFromTree('index.ts');

    await act(async () => {
      fakeMonacoState.models.get('/workspace/project/src/index.ts')?.setValue('export const value = 3;\n');
    });

    view.unmount();

    await waitFor(() => {
      expect(window.electronAPI.codePaneWriteFile).toHaveBeenCalledWith({
        rootPath: '/workspace/project',
        filePath: '/workspace/project/src/index.ts',
        content: 'export const value = 3;\n',
        expectedMtimeMs: 100,
      });
    });
  });

  it('does not reload the tree for watcher file change events', async () => {
    renderCodePane(createPane({
      openFiles: [{ path: '/workspace/project/src/index.ts' }],
      activeFilePath: '/workspace/project/src/index.ts',
      selectedPath: '/workspace/project/src/index.ts',
    }));

    await waitFor(() => {
      expect(window.electronAPI.codePaneReadFile).toHaveBeenCalledWith({
        rootPath: '/workspace/project',
        filePath: '/workspace/project/src/index.ts',
      });
    });

    vi.mocked(window.electronAPI.codePaneListDirectory).mockClear();
    vi.mocked(window.electronAPI.codePaneReadFile).mockClear();
    vi.mocked(window.electronAPI.codePaneGetGitStatus).mockClear();

    await emitFsChanged({
      rootPath: '/workspace/project',
      changes: [
        {
          type: 'change',
          path: '/workspace/project/src/index.ts',
        },
      ],
    });

    await waitFor(() => {
      expect(window.electronAPI.codePaneReadFile).toHaveBeenCalledWith({
        rootPath: '/workspace/project',
        filePath: '/workspace/project/src/index.ts',
      });
    });

    expect(window.electronAPI.codePaneListDirectory).not.toHaveBeenCalled();
    expect(window.electronAPI.codePaneGetGitStatus).toHaveBeenCalledTimes(1);
  });

  it('refreshes watcher git state without reloading repository summary', async () => {
    renderCodePane(createPane({
      openFiles: [{ path: '/workspace/project/src/index.ts' }],
      activeFilePath: '/workspace/project/src/index.ts',
      selectedPath: '/workspace/project/src/index.ts',
    }));

    await waitFor(() => {
      expect(window.electronAPI.codePaneReadFile).toHaveBeenCalledWith({
        rootPath: '/workspace/project',
        filePath: '/workspace/project/src/index.ts',
      });
    });

    vi.mocked(window.electronAPI.codePaneGetGitStatus).mockClear();
    vi.mocked(window.electronAPI.codePaneGetGitRepositorySummary).mockClear();

    await emitFsChanged({
      rootPath: '/workspace/project',
      changes: [
        {
          type: 'change',
          path: '/workspace/project/src/index.ts',
        },
      ],
    });

    await waitFor(() => {
      expect(window.electronAPI.codePaneGetGitStatus).toHaveBeenCalledTimes(1);
    });
    expect(window.electronAPI.codePaneGetGitRepositorySummary).not.toHaveBeenCalled();
  });

  it('does not swallow a stronger git refresh while a status-only refresh is in flight', async () => {
    let resolveGitStatus: (() => void) | null = null;

    vi.mocked(window.electronAPI.codePaneGetGitStatus).mockResolvedValue({
      success: true,
      data: [
        {
          path: '/workspace/project/src/index.ts',
          status: 'modified',
          unstaged: true,
          section: 'unstaged',
        },
      ],
    });
    vi.mocked(window.electronAPI.codePaneGetGitRepositorySummary).mockResolvedValue({
      success: true,
      data: {
        repoRootPath: '/workspace/project',
        currentBranch: 'feature/queue',
        upstreamBranch: 'origin/feature/queue',
        detachedHead: false,
        headSha: '1234567890abcdef',
        aheadCount: 1,
        behindCount: 0,
        operation: 'idle',
        hasConflicts: false,
      },
    });
    vi.mocked(window.electronAPI.codePaneGetGitGraph).mockResolvedValue({
      success: true,
      data: [
        {
          sha: 'abcdef1234567890',
          shortSha: 'abcdef1',
          parents: [],
          subject: 'Feature queue commit',
          author: 'Test User',
          timestamp: 1_710_000_100,
          refs: ['HEAD -> feature/queue'],
          lane: 0,
          laneCount: 1,
        },
      ],
    });

    renderCodePane(createPane({
      openFiles: [{ path: '/workspace/project/src/index.ts' }],
      activeFilePath: '/workspace/project/src/index.ts',
      selectedPath: '/workspace/project/src/index.ts',
    }));

    await waitFor(() => {
      expect(window.electronAPI.codePaneGetGitStatus).toHaveBeenCalledTimes(1);
      expect(window.electronAPI.codePaneGetGitRepositorySummary).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(window.electronAPI.codePaneReadFile).toHaveBeenCalledWith({
        rootPath: '/workspace/project',
        filePath: '/workspace/project/src/index.ts',
      });
    });

    vi.mocked(window.electronAPI.codePaneGetGitStatus).mockClear();
    vi.mocked(window.electronAPI.codePaneGetGitRepositorySummary).mockClear();
    vi.mocked(window.electronAPI.codePaneGetGitGraph).mockClear();
    vi.mocked(window.electronAPI.codePaneGetGitStatus).mockImplementation(() => (
      new Promise((resolve) => {
        resolveGitStatus = () => resolve({
          success: true,
          data: [
            {
              path: '/workspace/project/src/index.ts',
              status: 'modified',
              unstaged: true,
              section: 'unstaged',
            },
          ],
        });
      })
    ));

    await emitFsChanged({
      rootPath: '/workspace/project',
      changes: [
        {
          type: 'change',
          path: '/workspace/project/src/index.ts',
        },
      ],
    });

    await waitFor(() => {
      expect(window.electronAPI.codePaneGetGitStatus).toHaveBeenCalledTimes(1);
    });
    expect(window.electronAPI.codePaneGetGitGraph).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'codePane.gitWorkbenchTab' }));
    });

    await act(async () => {
      resolveGitStatus?.();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(window.electronAPI.codePaneGetGitGraph).toHaveBeenCalledWith({
        rootPath: '/workspace/project',
        limit: 60,
      });
    });
  });

  it('tracks external file changes and shows inline review for the active file without switching view mode', async () => {
    renderCodePane(createPane({
      openFiles: [{ path: '/workspace/project/src/index.ts' }],
      activeFilePath: '/workspace/project/src/index.ts',
      selectedPath: '/workspace/project/src/index.ts',
    }));

    await waitFor(() => {
      expect(fakeMonacoState.lastEditorModel?.getValue()).toBe('export const value = 1;\n');
    });

    vi.mocked(window.electronAPI.codePaneReadFile).mockResolvedValue({
      success: true,
      data: {
        content: 'export const value = 2;\n',
        mtimeMs: 200,
        size: 24,
        language: 'typescript',
        isBinary: false,
      },
    });

    vi.useFakeTimers();
    try {
      await emitFsChangedAndFlush({
        rootPath: '/workspace/project',
        changes: [
          {
            type: 'change',
            path: '/workspace/project/src/index.ts',
          },
        ],
      });
    } finally {
      vi.useRealTimers();
    }

    await waitFor(() => {
      expect(fakeMonacoState.lastEditorModel?.getValue()).toBe('export const value = 2;\n');
    });

    const externalChangesTab = await screen.findByRole('button', { name: 'codePane.externalChangesTab' });
    expect(externalChangesTab).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'codePane.externalReviewAcceptAll' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'codePane.externalReviewRevertAll' })).toBeInTheDocument();

    await waitFor(() => {
      expect(within(screen.getByTestId('code-pane-editor-region')).getAllByText('export const value = 1;').length).toBeGreaterThan(0);
      expect(within(screen.getByTestId('code-pane-editor-region')).getAllByText('export const value = 2;').length).toBeGreaterThan(0);
    });
    expect(screen.getAllByTestId('external-change-review-block').length).toBeGreaterThan(0);
  });

  it('keeps full-file context visible around external review blocks for the active file', async () => {
    vi.mocked(window.electronAPI.codePaneReadFile)
      .mockResolvedValueOnce({
        success: true,
        data: {
          content: [
            'line 1',
            'line 2',
            'line 3',
            'line 4',
          ].join('\n') + '\n',
          mtimeMs: 100,
          size: 28,
          language: 'plaintext',
          isBinary: false,
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          content: [
            'line 1',
            'line 2 updated',
            'line 2.5 inserted',
            'line 3',
            'line 4',
          ].join('\n') + '\n',
          mtimeMs: 200,
          size: 48,
          language: 'plaintext',
          isBinary: false,
        },
      });

    renderCodePane(createPane({
      openFiles: [{ path: '/workspace/project/src/index.ts' }],
      activeFilePath: '/workspace/project/src/index.ts',
      selectedPath: '/workspace/project/src/index.ts',
    }));

    await waitFor(() => {
      expect(fakeMonacoState.lastEditorModel?.getValue()).toContain('line 2');
    });

    vi.useFakeTimers();
    try {
      await emitFsChangedAndFlush({
        rootPath: '/workspace/project',
        changes: [
          {
            type: 'change',
            path: '/workspace/project/src/index.ts',
          },
        ],
      });
    } finally {
      vi.useRealTimers();
    }

    const editorRegion = screen.getByTestId('code-pane-editor-region');
    await waitFor(() => {
      expect(within(editorRegion).getAllByText('line 1').length).toBeGreaterThan(0);
      expect(within(editorRegion).getAllByText('line 3').length).toBeGreaterThan(0);
      expect(within(editorRegion).getAllByText('line 4').length).toBeGreaterThan(0);
      expect(within(editorRegion).getAllByText('line 2 updated').length).toBeGreaterThan(0);
      expect(within(editorRegion).getAllByText('line 2.5 inserted').length).toBeGreaterThan(0);
    });
    expect(screen.getAllByTestId('external-change-review-context-line').length).toBeGreaterThanOrEqual(3);
    expect(screen.getAllByTestId('external-change-review-block').length).toBe(1);
  });

  it('renders pure insert external review blocks between surrounding context without duplicating lines', async () => {
    vi.mocked(window.electronAPI.codePaneReadFile)
      .mockResolvedValueOnce({
        success: true,
        data: {
          content: [
            'alpha',
            'omega',
          ].join('\n') + '\n',
          mtimeMs: 100,
          size: 12,
          language: 'plaintext',
          isBinary: false,
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          content: [
            'alpha',
            'inserted',
            'omega',
          ].join('\n') + '\n',
          mtimeMs: 200,
          size: 21,
          language: 'plaintext',
          isBinary: false,
        },
      });

    renderCodePane(createPane({
      openFiles: [{ path: '/workspace/project/src/index.ts' }],
      activeFilePath: '/workspace/project/src/index.ts',
      selectedPath: '/workspace/project/src/index.ts',
    }));

    await waitFor(() => {
      expect(fakeMonacoState.lastEditorModel?.getValue()).toContain('alpha');
    });

    vi.useFakeTimers();
    try {
      await emitFsChangedAndFlush({
        rootPath: '/workspace/project',
        changes: [
          {
            type: 'change',
            path: '/workspace/project/src/index.ts',
          },
        ],
      });
    } finally {
      vi.useRealTimers();
    }

    const editorRegion = screen.getByTestId('code-pane-editor-region');
    await waitFor(() => {
      expect(within(editorRegion).getAllByText('alpha')).toHaveLength(1);
      expect(within(editorRegion).getAllByText('omega')).toHaveLength(1);
      expect(within(editorRegion).getAllByText('inserted')).toHaveLength(1);
    });
    expect(screen.getAllByTestId('external-change-review-context-line')).toHaveLength(2);
    expect(screen.getAllByTestId('external-change-review-block')).toHaveLength(1);
  });

  it('treats atomic watcher replace events as a file content change for the active file', async () => {
    renderCodePane(createPane({
      openFiles: [{ path: '/workspace/project/src/index.ts' }],
      activeFilePath: '/workspace/project/src/index.ts',
      selectedPath: '/workspace/project/src/index.ts',
    }));

    await waitFor(() => {
      expect(fakeMonacoState.lastEditorModel?.getValue()).toBe('export const value = 1;\n');
    });

    vi.mocked(window.electronAPI.codePaneReadFile).mockResolvedValue({
      success: true,
      data: {
        content: 'export const value = 5;\n',
        mtimeMs: 250,
        size: 24,
        language: 'typescript',
        isBinary: false,
      },
    });

    vi.useFakeTimers();
    try {
      await emitFsChangedAndFlush({
        rootPath: '/workspace/project',
        changes: [
          {
            type: 'unlink',
            path: '/workspace/project/src/index.ts',
          },
          {
            type: 'add',
            path: '/workspace/project/src/index.ts',
          },
        ],
      });
    } finally {
      vi.useRealTimers();
    }

    await waitFor(() => {
      expect(fakeMonacoState.lastEditorModel?.getValue()).toBe('export const value = 5;\n');
    });
    expect(await screen.findByRole('button', { name: 'codePane.externalReviewAcceptAll' })).toBeInTheDocument();
    await waitFor(() => {
      expect(within(screen.getByTestId('code-pane-editor-region')).getAllByText('export const value = 1;').length).toBeGreaterThan(0);
      expect(within(screen.getByTestId('code-pane-editor-region')).getAllByText('export const value = 5;').length).toBeGreaterThan(0);
    });
  });

  it('does not re-open language documents for watcher refreshes on already opened files', async () => {
    renderCodePane(createPane({
      openFiles: [{ path: '/workspace/project/src/index.ts' }],
      activeFilePath: '/workspace/project/src/index.ts',
      selectedPath: '/workspace/project/src/index.ts',
    }));

    await waitFor(() => {
      expect(window.electronAPI.codePaneDidOpenDocument).toHaveBeenCalledTimes(1);
    });

    vi.mocked(window.electronAPI.codePaneDidOpenDocument).mockClear();
    vi.mocked(window.electronAPI.codePaneDidChangeDocument).mockClear();
    vi.mocked(window.electronAPI.codePaneReadFile).mockResolvedValue({
      success: true,
      data: {
        content: 'export const value = 3;\n',
        mtimeMs: 210,
        size: 24,
        language: 'typescript',
        isBinary: false,
      },
    });

    vi.useFakeTimers();
    try {
      await emitFsChangedAndFlush({
        rootPath: '/workspace/project',
        changes: [
          {
            type: 'change',
            path: '/workspace/project/src/index.ts',
          },
        ],
      });
    } finally {
      vi.useRealTimers();
    }

    await waitFor(() => {
      expect(fakeMonacoState.lastEditorModel?.getValue()).toBe('export const value = 3;\n');
    });
    expect(window.electronAPI.codePaneDidOpenDocument).not.toHaveBeenCalled();
    expect(window.electronAPI.codePaneDidChangeDocument).toHaveBeenCalledWith({
      paneId: 'pane-code-1',
      rootPath: '/workspace/project',
      filePath: '/workspace/project/src/index.ts',
      language: 'typescript',
      content: 'export const value = 3;\n',
    });
  });

  it('does not rebind the editor model for watcher updates on opened files', async () => {
    renderCodePane(createPane({
      openFiles: [{ path: '/workspace/project/src/index.ts' }],
      activeFilePath: '/workspace/project/src/index.ts',
      selectedPath: '/workspace/project/src/index.ts',
    }));

    const activeEditor = fakeMonaco.editor.create.mock.results.at(-1)?.value;
    if (!activeEditor) {
      throw new Error('expected active editor instance');
    }

    vi.mocked(activeEditor.setModel).mockClear();
    vi.mocked(window.electronAPI.codePaneReadFile).mockResolvedValue({
      success: true,
      data: {
        content: 'export const value = 4;\n',
        mtimeMs: 220,
        size: 24,
        language: 'typescript',
        isBinary: false,
      },
    });

    vi.useFakeTimers();
    try {
      await emitFsChangedAndFlush({
        rootPath: '/workspace/project',
        changes: [
          {
            type: 'change',
            path: '/workspace/project/src/index.ts',
          },
          {
            type: 'change',
            path: '/workspace/project/src/index.ts',
          },
        ],
      });
    } finally {
      vi.useRealTimers();
    }

    await waitFor(() => {
      expect(fakeMonacoState.lastEditorModel?.getValue()).toBe('export const value = 4;\n');
    });
    expect(activeEditor.setModel).not.toHaveBeenCalled();
  });

  it('records external changes without auto-writing the file when local edits were made in the editor model', async () => {
    renderCodePane(createPane());

    await openFileFromTree('index.ts');
    await waitFor(() => {
      expect(fakeMonacoState.lastEditorModel?.getValue()).toBe('export const value = 1;\n');
    });

    vi.useFakeTimers();
    await act(async () => {
      fakeMonacoState.lastEditorModel?.setValue('export const local = 3;\n');
      await Promise.resolve();
    });
    vi.mocked(window.electronAPI.codePaneWriteFile).mockClear();

    vi.mocked(window.electronAPI.codePaneReadFile).mockResolvedValue({
      success: true,
      data: {
        content: 'export const remote = 4;\n',
        mtimeMs: 200,
        size: 24,
        language: 'typescript',
        isBinary: false,
      },
    });

    await emitFsChangedAndFlush({
      rootPath: '/workspace/project',
      changes: [
        {
          type: 'change',
          path: '/workspace/project/src/index.ts',
        },
      ],
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByRole('button', { name: 'codePane.externalChangesTab' })).toBeInTheDocument();
    expect(window.electronAPI.codePaneWriteFile).not.toHaveBeenCalled();
  });

  it('tracks unopened watcher changes without auto-switching files and opens review when the user selects the file', async () => {
    vi.mocked(window.electronAPI.codePaneListDirectory).mockResolvedValue({
      success: true,
      data: [
        {
          path: '/workspace/project/src/index.ts',
          name: 'index.ts',
          type: 'file',
        },
        {
          path: '/workspace/project/src/other.ts',
          name: 'other.ts',
          type: 'file',
        },
      ],
    });

    const view = renderCodePane(createPane({
      openFiles: [{ path: '/workspace/project/src/index.ts' }],
      activeFilePath: '/workspace/project/src/index.ts',
      selectedPath: '/workspace/project/src/index.ts',
    }));

    await waitFor(() => {
      expect(fakeMonacoState.lastEditorModel?.getValue()).toBe('export const value = 1;\n');
    });

    await screen.findByRole('button', { name: 'other.ts' }, { timeout: 3000 });

    vi.mocked(window.electronAPI.codePaneReadGitBaseFile).mockResolvedValue({
      success: true,
      data: {
        content: 'export const remote = 1;\n',
        existsInHead: true,
      },
    });
    vi.mocked(window.electronAPI.codePaneReadFile).mockResolvedValue({
      success: true,
      data: {
        content: 'export const remote = 4;\n',
        mtimeMs: 200,
        size: 25,
        language: 'typescript',
        isBinary: false,
      },
    });

    vi.useFakeTimers();
    try {
      await emitFsChangedAndFlush({
        rootPath: '/workspace/project',
        changes: [
          {
            type: 'change',
            path: '/workspace/project/src/other.ts',
          },
        ],
      });
    } finally {
      vi.useRealTimers();
    }

    expect(await screen.findByRole('button', { name: 'codePane.externalChangesTab' })).toBeInTheDocument();
    expect(view.getPane().code?.activeFilePath).toBe('/workspace/project/src/index.ts');
    expect(within(screen.getByTestId('code-pane-editor-region')).queryByText('export const remote = 1;')).toBeNull();
    expect(within(screen.getByTestId('code-pane-editor-region')).queryByText('export const remote = 4;')).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'codePane.externalChangesTab' }));
    });

    const viewDiffButton = await screen.findByRole('button', { name: 'codePane.externalChangeViewDiff' });
    expect(viewDiffButton).toBeEnabled();
    await act(async () => {
      fireEvent.click(viewDiffButton);
    });

    await waitFor(() => {
      expect(view.getPane().code?.activeFilePath).toBe('/workspace/project/src/other.ts');
    });
    await waitFor(() => {
      expect(within(screen.getByTestId('code-pane-editor-region')).getAllByText('export const remote = 1;').length).toBeGreaterThan(0);
      expect(within(screen.getByTestId('code-pane-editor-region')).getAllByText('export const remote = 4;').length).toBeGreaterThan(0);
    });
    expect(window.electronAPI.codePaneReadGitBaseFile).toHaveBeenCalledWith({
      rootPath: '/workspace/project',
      filePath: '/workspace/project/src/other.ts',
    });
  });

  it('supports accepting and reverting all changes from the active external review', async () => {
    renderCodePane(createPane({
      openFiles: [{ path: '/workspace/project/src/index.ts' }],
      activeFilePath: '/workspace/project/src/index.ts',
      selectedPath: '/workspace/project/src/index.ts',
    }));

    await waitFor(() => {
      expect(fakeMonacoState.lastEditorModel?.getValue()).toBe('export const value = 1;\n');
    });

    vi.mocked(window.electronAPI.codePaneReadFile).mockResolvedValue({
      success: true,
      data: {
        content: 'export const value = 2;\n',
        mtimeMs: 200,
        size: 24,
        language: 'typescript',
        isBinary: false,
      },
    });

    vi.useFakeTimers();
    try {
      await emitFsChangedAndFlush({
        rootPath: '/workspace/project',
        changes: [
          {
            type: 'change',
            path: '/workspace/project/src/index.ts',
          },
        ],
      });
    } finally {
      vi.useRealTimers();
    }

    expect(screen.getByRole('button', { name: 'codePane.externalReviewAcceptAll' })).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'codePane.externalReviewAcceptAll' }));
    });

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'codePane.externalReviewAcceptAll' })).toBeNull();
    });

    vi.mocked(window.electronAPI.codePaneReadFile).mockResolvedValue({
      success: true,
      data: {
        content: 'export const value = 3;\n',
        mtimeMs: 300,
        size: 24,
        language: 'typescript',
        isBinary: false,
      },
    });

    vi.useFakeTimers();
    try {
      await emitFsChangedAndFlush({
        rootPath: '/workspace/project',
        changes: [
          {
            type: 'change',
            path: '/workspace/project/src/index.ts',
          },
        ],
      });
    } finally {
      vi.useRealTimers();
    }

    vi.mocked(window.electronAPI.codePaneWriteFile).mockClear();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'codePane.externalReviewRevertAll' }));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(window.electronAPI.codePaneWriteFile).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'codePane.externalReviewRevertAll' })).toBeNull();
    });
  });

  it('removes an accepted block from the inline review and restores the editor surface', async () => {
    vi.mocked(window.electronAPI.codePaneReadFile)
      .mockResolvedValueOnce({
        success: true,
        data: {
          content: [
            'line 1',
            'line 2',
            'line 3',
          ].join('\n') + '\n',
          mtimeMs: 100,
          size: 21,
          language: 'plaintext',
          isBinary: false,
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          content: [
            'line 1',
            'line 2 changed',
            'line 3',
          ].join('\n') + '\n',
          mtimeMs: 200,
          size: 29,
          language: 'plaintext',
          isBinary: false,
        },
      });

    renderCodePane(createPane({
      openFiles: [{ path: '/workspace/project/src/index.ts' }],
      activeFilePath: '/workspace/project/src/index.ts',
      selectedPath: '/workspace/project/src/index.ts',
    }));

    await waitFor(() => {
      expect(fakeMonacoState.lastEditorModel?.getValue()).toContain('line 2');
    });

    vi.useFakeTimers();
    try {
      await emitFsChangedAndFlush({
        rootPath: '/workspace/project',
        changes: [
          {
            type: 'change',
            path: '/workspace/project/src/index.ts',
          },
        ],
      });
    } finally {
      vi.useRealTimers();
    }

    const acceptButton = screen.getByLabelText('codePane.externalReviewAccept');
    await act(async () => {
      fireEvent.click(acceptButton);
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.queryByTestId('external-change-review-block')).toBeNull();
    });
    await waitFor(() => {
      expect(screen.getByTestId('code-pane-editor-region')).toBeInTheDocument();
      expect(fakeMonacoState.lastEditorModel?.getValue()).toBe([
        'line 1',
        'line 2 changed',
        'line 3',
      ].join('\n') + '\n');
    });
  });

  it('keeps remaining blocks reviewable after accepting one external review block', async () => {
    vi.mocked(window.electronAPI.codePaneReadFile)
      .mockResolvedValueOnce({
        success: true,
        data: {
          content: [
            'line 1',
            'line 2',
            'line 3',
            'line 4',
            'line 5',
          ].join('\n') + '\n',
          mtimeMs: 100,
          size: 35,
          language: 'plaintext',
          isBinary: false,
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          content: [
            'line 1',
            'line 2 changed',
            'line 3',
            'line 4 changed',
            'line 5',
          ].join('\n') + '\n',
          mtimeMs: 200,
          size: 51,
          language: 'plaintext',
          isBinary: false,
        },
      });

    renderCodePane(createPane({
      openFiles: [{ path: '/workspace/project/src/index.ts' }],
      activeFilePath: '/workspace/project/src/index.ts',
      selectedPath: '/workspace/project/src/index.ts',
    }));

    await waitFor(() => {
      expect(fakeMonacoState.lastEditorModel?.getValue()).toContain('line 2');
    });

    vi.useFakeTimers();
    try {
      await emitFsChangedAndFlush({
        rootPath: '/workspace/project',
        changes: [
          {
            type: 'change',
            path: '/workspace/project/src/index.ts',
          },
        ],
      });
    } finally {
      vi.useRealTimers();
    }

    expect(screen.getAllByTestId('external-change-review-block')).toHaveLength(2);

    await act(async () => {
      fireEvent.click(screen.getAllByLabelText('codePane.externalReviewAccept')[0]!);
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getAllByTestId('external-change-review-block')).toHaveLength(1);
    });
    const editorRegion = screen.getByTestId('code-pane-editor-region');
    await waitFor(() => {
      expect(within(editorRegion).queryByText('line 2')).toBeNull();
      expect(within(editorRegion).getAllByText('line 2 changed')).toHaveLength(1);
      expect(within(editorRegion).getAllByText('line 4')).toHaveLength(1);
      expect(within(editorRegion).getAllByText('line 4 changed')).toHaveLength(1);
    });
  });

  it('preserves earlier external review blocks when later external file changes arrive', async () => {
    vi.mocked(window.electronAPI.codePaneReadFile)
      .mockResolvedValueOnce({
        success: true,
        data: {
          content: [
            'line 1',
            'line 2',
            'line 3',
          ].join('\n') + '\n',
          mtimeMs: 100,
          size: 21,
          language: 'plaintext',
          isBinary: false,
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          content: [
            'line 1 changed',
            'line 2',
            'line 3',
          ].join('\n') + '\n',
          mtimeMs: 200,
          size: 29,
          language: 'plaintext',
          isBinary: false,
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          content: [
            'line 1 changed',
            'line 2 changed',
            'line 3',
          ].join('\n') + '\n',
          mtimeMs: 300,
          size: 37,
          language: 'plaintext',
          isBinary: false,
        },
      });

    renderCodePane(createPane({
      openFiles: [{ path: '/workspace/project/src/index.ts' }],
      activeFilePath: '/workspace/project/src/index.ts',
      selectedPath: '/workspace/project/src/index.ts',
    }));

    await waitFor(() => {
      expect(fakeMonacoState.lastEditorModel?.getValue()).toContain('line 1');
    });

    vi.useFakeTimers();
    try {
      await emitFsChangedAndFlush({
        rootPath: '/workspace/project',
        changes: [
          {
            type: 'change',
            path: '/workspace/project/src/index.ts',
          },
        ],
      });
      await emitFsChangedAndFlush({
        rootPath: '/workspace/project',
        changes: [
          {
            type: 'change',
            path: '/workspace/project/src/index.ts',
          },
        ],
      });
    } finally {
      vi.useRealTimers();
    }

    const editorRegion = screen.getByTestId('code-pane-editor-region');
    await waitFor(() => {
      expect(within(editorRegion).getAllByText('line 1')).toHaveLength(1);
      expect(within(editorRegion).getAllByText('line 1 changed')).toHaveLength(1);
      expect(within(editorRegion).getAllByText('line 2')).toHaveLength(1);
      expect(within(editorRegion).getAllByText('line 2 changed')).toHaveLength(1);
    });
    expect(screen.getAllByTestId('external-change-review-line-deleted')).toHaveLength(2);
    expect(screen.getAllByTestId('external-change-review-line-added')).toHaveLength(2);
  });

  it('removes a reverted block and keeps the reverted content visible', async () => {
    vi.mocked(window.electronAPI.codePaneReadFile)
      .mockResolvedValueOnce({
        success: true,
        data: {
          content: [
            'line 1',
            'line 2',
            'line 3',
          ].join('\n') + '\n',
          mtimeMs: 100,
          size: 21,
          language: 'plaintext',
          isBinary: false,
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          content: [
            'line 1',
            'line 2 changed',
            'line 3',
          ].join('\n') + '\n',
          mtimeMs: 200,
          size: 29,
          language: 'plaintext',
          isBinary: false,
        },
      });
    vi.mocked(window.electronAPI.codePaneWriteFile).mockResolvedValue({
      success: true,
      data: {
        mtimeMs: 201,
      },
    });

    renderCodePane(createPane({
      openFiles: [{ path: '/workspace/project/src/index.ts' }],
      activeFilePath: '/workspace/project/src/index.ts',
      selectedPath: '/workspace/project/src/index.ts',
    }));

    await waitFor(() => {
      expect(fakeMonacoState.lastEditorModel?.getValue()).toContain('line 2');
    });

    vi.useFakeTimers();
    try {
      await emitFsChangedAndFlush({
        rootPath: '/workspace/project',
        changes: [
          {
            type: 'change',
            path: '/workspace/project/src/index.ts',
          },
        ],
      });
    } finally {
      vi.useRealTimers();
    }

    const revertButton = screen.getByLabelText('codePane.externalReviewRevert');
    await act(async () => {
      fireEvent.click(revertButton);
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(window.electronAPI.codePaneWriteFile).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(screen.queryByTestId('external-change-review-block')).toBeNull();
    });
    await waitFor(() => {
      expect(fakeMonacoState.lastEditorModel?.getValue()).toBe([
        'line 1',
        'line 2',
        'line 3',
      ].join('\n') + '\n');
    });
  });

  it('renders added and deleted external review lines with inline background colors', async () => {
    vi.mocked(window.electronAPI.codePaneReadFile)
      .mockResolvedValueOnce({
        success: true,
        data: {
          content: [
            'line 1',
            'line 2',
            'line 3',
          ].join('\n') + '\n',
          mtimeMs: 100,
          size: 21,
          language: 'plaintext',
          isBinary: false,
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          content: [
            'line 1',
            'line 2 changed',
            'line 3',
          ].join('\n') + '\n',
          mtimeMs: 200,
          size: 29,
          language: 'plaintext',
          isBinary: false,
        },
      });

    renderCodePane(createPane({
      openFiles: [{ path: '/workspace/project/src/index.ts' }],
      activeFilePath: '/workspace/project/src/index.ts',
      selectedPath: '/workspace/project/src/index.ts',
    }));

    await waitFor(() => {
      expect(fakeMonacoState.lastEditorModel?.getValue()).toContain('line 2');
    });

    vi.useFakeTimers();
    try {
      await emitFsChangedAndFlush({
        rootPath: '/workspace/project',
        changes: [
          {
            type: 'change',
            path: '/workspace/project/src/index.ts',
          },
        ],
      });
    } finally {
      vi.useRealTimers();
    }

    const deletedRow = screen.getAllByTestId('external-change-review-line-deleted')[0];
    const addedRow = screen.getAllByTestId('external-change-review-line-added')[0];
    expect(deletedRow.getAttribute('style')).toContain('background-color: rgb(var(--error) / 0.22);');
    expect(addedRow.getAttribute('style')).toContain('background-color: rgb(var(--success) / 0.22);');
  });

  it('downgrades very large active external reviews to summary mode to avoid renderer stalls', async () => {
    renderCodePane(createPane({
      openFiles: [{ path: '/workspace/project/src/index.ts' }],
      activeFilePath: '/workspace/project/src/index.ts',
      selectedPath: '/workspace/project/src/index.ts',
    }));

    await waitFor(() => {
      expect(fakeMonacoState.lastEditorModel?.getValue()).toBe('export const value = 1;\n');
    });

    const largeBefore = Array.from({ length: 1400 }, (_, index) => `before line ${index + 1}`).join('\n') + '\n';
    const largeAfter = Array.from({ length: 1400 }, (_, index) => `after line ${index + 1}`).join('\n') + '\n';

    await act(async () => {
      fakeMonacoState.lastEditorModel?.setValue(largeBefore);
      await Promise.resolve();
    });

    vi.mocked(window.electronAPI.codePaneReadFile).mockResolvedValue({
      success: true,
      data: {
        content: largeAfter,
        mtimeMs: 200,
        size: largeAfter.length,
        language: 'typescript',
        isBinary: false,
      },
    });

    vi.useFakeTimers();
    try {
      await emitFsChangedAndFlush({
        rootPath: '/workspace/project',
        changes: [
          {
            type: 'change',
            path: '/workspace/project/src/index.ts',
          },
        ],
      });
    } finally {
      vi.useRealTimers();
    }

    expect(await screen.findByTestId('external-change-review-summary-only')).toBeInTheDocument();
    expect(screen.queryAllByTestId('external-change-review-block')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'codePane.externalReviewAcceptAll' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'codePane.externalReviewRevertAll' })).toBeInTheDocument();
  });

  it('tracks external changes that arrive immediately after saving the active file', async () => {
    renderCodePane(createPane({
      openFiles: [{ path: '/workspace/project/src/index.ts' }],
      activeFilePath: '/workspace/project/src/index.ts',
      selectedPath: '/workspace/project/src/index.ts',
    }));

    await waitFor(() => {
      expect(fakeMonacoState.lastEditorModel?.getValue()).toBe('export const value = 1;\n');
    });

    await act(async () => {
      fakeMonacoState.lastEditorModel?.setValue('export const value = 2;\n');
      await Promise.resolve();
    });

    vi.mocked(window.electronAPI.codePaneWriteFile).mockResolvedValue({
      success: true,
      data: {
        mtimeMs: 220,
      },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(window.electronAPI.codePaneWriteFile).toHaveBeenCalledWith({
        rootPath: '/workspace/project',
        filePath: '/workspace/project/src/index.ts',
        content: 'export const value = 2;\n',
        expectedMtimeMs: 100,
      });
    });

    vi.mocked(window.electronAPI.codePaneReadFile).mockResolvedValue({
      success: true,
      data: {
        content: 'export const value = 3;\n',
        mtimeMs: 230,
        size: 24,
        language: 'typescript',
        isBinary: false,
      },
    });

    vi.useFakeTimers();
    try {
      await emitFsChangedAndFlush({
        rootPath: '/workspace/project',
        changes: [
          {
            type: 'change',
            path: '/workspace/project/src/index.ts',
          },
        ],
      });
    } finally {
      vi.useRealTimers();
    }

    expect(await screen.findByRole('button', { name: 'codePane.externalReviewAcceptAll' })).toBeInTheDocument();
    await waitFor(() => {
      expect(within(screen.getByTestId('code-pane-editor-region')).getAllByText('export const value = 2;').length).toBeGreaterThan(0);
      expect(within(screen.getByTestId('code-pane-editor-region')).getAllByText('export const value = 3;').length).toBeGreaterThan(0);
    });
  });

  it('retries external file reads when the first watcher read still returns stale content', async () => {
    renderCodePane(createPane({
      openFiles: [{ path: '/workspace/project/src/index.ts' }],
      activeFilePath: '/workspace/project/src/index.ts',
      selectedPath: '/workspace/project/src/index.ts',
    }));

    await waitFor(() => {
      expect(fakeMonacoState.lastEditorModel?.getValue()).toBe('export const value = 1;\n');
    });

    vi.mocked(window.electronAPI.codePaneReadFile).mockClear();
    vi.mocked(window.electronAPI.codePaneReadFile).mockResolvedValue({
      success: true,
      data: {
        content: 'export const value = 2;\n',
        mtimeMs: 200,
        size: 24,
        language: 'typescript',
        isBinary: false,
      },
    });
    vi.mocked(window.electronAPI.codePaneReadFile).mockResolvedValueOnce({
      success: true,
      data: {
        content: 'export const value = 1;\n',
        mtimeMs: 100,
        size: 24,
        language: 'typescript',
        isBinary: false,
      },
    });

    vi.useFakeTimers();
    try {
      await emitFsChangedAndFlush({
        rootPath: '/workspace/project',
        changes: [
          {
            type: 'change',
            path: '/workspace/project/src/index.ts',
          },
        ],
      });

      await act(async () => {
        vi.advanceTimersByTime(120);
        await Promise.resolve();
        await Promise.resolve();
      });
    } finally {
      vi.useRealTimers();
    }

    await waitFor(() => {
      expect(fakeMonacoState.lastEditorModel?.getValue()).toBe('export const value = 2;\n');
    });
    expect(await screen.findByRole('button', { name: 'codePane.externalReviewAcceptAll' })).toBeInTheDocument();
    await waitFor(() => {
      expect(within(screen.getByTestId('code-pane-editor-region')).getAllByText('export const value = 1;').length).toBeGreaterThan(0);
      expect(within(screen.getByTestId('code-pane-editor-region')).getAllByText('export const value = 2;').length).toBeGreaterThan(0);
    });
  });

  it('matches watcher updates to the opened file when Windows path casing differs', async () => {
    vi.mocked(window.electronAPI.codePaneListDirectory).mockResolvedValue({
      success: true,
      data: [
        {
          path: 'C:/Workspace/Project/src/app.py',
          name: 'app.py',
          type: 'file',
        },
      ],
    });
    vi.mocked(window.electronAPI.codePaneReadGitBaseFile).mockResolvedValue({
      success: true,
      data: {
        content: 'value = 1\n',
        existsInHead: true,
      },
    });
    vi.mocked(window.electronAPI.codePaneReadFile).mockReset();
    vi.mocked(window.electronAPI.codePaneReadFile)
      .mockResolvedValueOnce({
        success: true,
        data: {
          content: 'value = 1\n',
          mtimeMs: 100,
          size: 10,
          language: 'python',
          isBinary: false,
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          content: 'value = 2\n',
          mtimeMs: 200,
          size: 10,
          language: 'python',
          isBinary: false,
        },
      });

    renderCodePane(createPane({
      rootPath: 'C:/Workspace/Project',
      openFiles: [{ path: 'C:/Workspace/Project/src/app.py' }],
      activeFilePath: 'C:/Workspace/Project/src/app.py',
      selectedPath: 'C:/Workspace/Project/src/app.py',
    }));

    await waitFor(() => {
      expect(fakeMonacoState.lastEditorModel?.getValue()).toBe('value = 1\n');
    });

    vi.useFakeTimers();
    try {
      await emitFsChangedAndFlush({
        rootPath: 'c:/workspace/project',
        changes: [
          {
            type: 'change',
            path: 'c:/workspace/project/src/app.py',
          },
        ],
      });
    } finally {
      vi.useRealTimers();
    }

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'codePane.externalReviewAcceptAll' })).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(within(screen.getByTestId('code-pane-editor-region')).getAllByText('value = 1').length).toBeGreaterThan(0);
      expect(within(screen.getByTestId('code-pane-editor-region')).getAllByText('value = 2').length).toBeGreaterThan(0);
    });
  });

  it('skips bottom-panel inline diff rendering for very large external changes', async () => {
    vi.mocked(window.electronAPI.codePaneListDirectory).mockResolvedValue({
      success: true,
      data: [
        {
          path: '/workspace/project/src/index.ts',
          name: 'index.ts',
          type: 'file',
        },
        {
          path: '/workspace/project/src/other.ts',
          name: 'other.ts',
          type: 'file',
        },
      ],
    });

    renderCodePane(createPane({
      openFiles: [{ path: '/workspace/project/src/index.ts' }],
      activeFilePath: '/workspace/project/src/index.ts',
      selectedPath: '/workspace/project/src/index.ts',
    }));

    await screen.findByRole('button', { name: 'other.ts' }, { timeout: 3000 });

    const largeBefore = Array.from({ length: 1400 }, (_, index) => `before line ${index + 1}`).join('\n') + '\n';
    const largeAfter = Array.from({ length: 1400 }, (_, index) => `after line ${index + 1}`).join('\n') + '\n';

    vi.mocked(window.electronAPI.codePaneReadGitBaseFile).mockResolvedValue({
      success: true,
      data: {
        content: largeBefore,
        existsInHead: true,
      },
    });
    vi.mocked(window.electronAPI.codePaneReadFile).mockResolvedValue({
      success: true,
      data: {
        content: largeAfter,
        mtimeMs: 200,
        size: largeAfter.length,
        language: 'typescript',
        isBinary: false,
      },
    });

    vi.useFakeTimers();
    try {
      await emitFsChangedAndFlush({
        rootPath: '/workspace/project',
        changes: [
          {
            type: 'change',
            path: '/workspace/project/src/other.ts',
          },
        ],
      });
    } finally {
      vi.useRealTimers();
    }

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'codePane.externalChangesTab' }));
    });

    expect(await screen.findByText('codePane.externalChangeInlineDiffSkipped')).toBeInTheDocument();
    expect(screen.queryByText('before line 1')).toBeNull();
    expect(screen.queryByText('after line 1')).toBeNull();
  });

  it('ignores watcher updates that only confirm the just-saved file content', async () => {
    renderCodePane(createPane({
      openFiles: [{ path: '/workspace/project/src/index.ts' }],
      activeFilePath: '/workspace/project/src/index.ts',
      selectedPath: '/workspace/project/src/index.ts',
    }));

    await waitFor(() => {
      expect(fakeMonacoState.lastEditorModel?.getValue()).toBe('export const value = 1;\n');
    });

    await act(async () => {
      fakeMonacoState.lastEditorModel?.setValue('export const value = 2;\n');
      await Promise.resolve();
    });

    vi.mocked(window.electronAPI.codePaneWriteFile).mockResolvedValue({
      success: true,
      data: {
        mtimeMs: 220,
      },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
      await Promise.resolve();
      await Promise.resolve();
    });

    vi.mocked(window.electronAPI.codePaneReadFile).mockClear();
    vi.mocked(window.electronAPI.codePaneReadFile).mockResolvedValue({
      success: true,
      data: {
        content: 'export const value = 2;\n',
        mtimeMs: 220,
        size: 24,
        language: 'typescript',
        isBinary: false,
      },
    });

    vi.useFakeTimers();
    try {
      await emitFsChangedAndFlush({
        rootPath: '/workspace/project',
        changes: [
          {
            type: 'change',
            path: '/workspace/project/src/index.ts',
          },
        ],
      });
    } finally {
      vi.useRealTimers();
    }

    await waitFor(() => {
      expect(window.electronAPI.codePaneReadFile).toHaveBeenCalledWith({
        rootPath: '/workspace/project',
        filePath: '/workspace/project/src/index.ts',
      });
    });

    expect(screen.queryByRole('button', { name: 'codePane.externalChangesTab' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'codePane.externalReviewAcceptAll' })).toBeNull();
  });

  it('coalesces duplicate watcher changes for the same file into one read and one diff refresh', async () => {
    renderCodePane(createPane({
      openFiles: [{ path: '/workspace/project/src/index.ts' }],
      activeFilePath: '/workspace/project/src/index.ts',
      selectedPath: '/workspace/project/src/index.ts',
    }));

    await waitFor(() => {
      expect(fakeMonacoState.lastEditorModel?.getValue()).toBe('export const value = 1;\n');
    });

    vi.mocked(window.electronAPI.codePaneReadFile).mockClear();
    vi.mocked(window.electronAPI.codePaneReadFile).mockResolvedValue({
      success: true,
      data: {
        content: 'export const value = 5;\n',
        mtimeMs: 300,
        size: 24,
        language: 'typescript',
        isBinary: false,
      },
    });

    vi.useFakeTimers();
    try {
      await emitFsChanged({
        rootPath: '/workspace/project',
        changes: [
          {
            type: 'change',
            path: '/workspace/project/src/index.ts',
          },
        ],
      });
      await emitFsChangedAndFlush({
        rootPath: '/workspace/project',
        changes: [
          {
            type: 'change',
            path: '/workspace/project/src/index.ts',
          },
          {
            type: 'change',
            path: '/workspace/project/src/index.ts',
          },
        ],
      });
    } finally {
      vi.useRealTimers();
    }

    await waitFor(() => {
      expect(fakeMonacoState.lastEditorModel?.getValue()).toBe('export const value = 5;\n');
    });
    expect(window.electronAPI.codePaneReadFile).toHaveBeenCalledTimes(1);
  });

  it('removes deleted files from the tree without reloading the whole directory', async () => {
    renderCodePane(createPane());

    await screen.findByRole('button', { name: 'index.ts' }, { timeout: 3000 });

    vi.mocked(window.electronAPI.codePaneListDirectory).mockClear();
    vi.mocked(window.electronAPI.codePaneReadFile).mockClear();
    vi.mocked(window.electronAPI.codePaneGetGitStatus).mockClear();

    vi.mocked(window.electronAPI.codePaneReadFile).mockResolvedValue({
      success: false,
      error: 'not loaded yet',
    });

    await emitFsChanged({
      rootPath: '/workspace/project',
      changes: [
        {
          type: 'unlink',
          path: '/workspace/project/src/index.ts',
        },
      ],
    });

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'index.ts' })).not.toBeInTheDocument();
    });

    expect(window.electronAPI.codePaneListDirectory).not.toHaveBeenCalled();
    expect(window.electronAPI.codePaneGetGitStatus).toHaveBeenCalledTimes(1);
  });

  it('reloads only the affected directory for watcher structural changes', async () => {
    vi.mocked(window.electronAPI.codePaneListDirectory).mockImplementation(async ({ targetPath }) => {
      if (targetPath === '/workspace/project/src') {
        return {
          success: true,
          data: [
            {
              path: '/workspace/project/src/index.ts',
              name: 'index.ts',
              type: 'file',
            },
          ],
        };
      }

      return {
        success: true,
        data: [
          {
            path: '/workspace/project/src',
            name: 'src',
            type: 'directory',
          },
        ],
      };
    });

    renderCodePane(createPane());

    const directoryButton = await screen.findByRole('button', { name: 'src' });
    await act(async () => {
      fireEvent.doubleClick(directoryButton);
    });

    await waitFor(() => {
      expect(window.electronAPI.codePaneListDirectory).toHaveBeenCalledWith({
        rootPath: '/workspace/project',
        targetPath: '/workspace/project/src',
      });
    });

    vi.mocked(window.electronAPI.codePaneListDirectory).mockClear();
    vi.mocked(window.electronAPI.codePaneGetGitStatus).mockClear();

    await emitFsChanged({
      rootPath: '/workspace/project',
      changes: [
        {
          type: 'add',
          path: '/workspace/project/src/new.ts',
        },
      ],
    });

    await waitFor(() => {
      expect(window.electronAPI.codePaneListDirectory).toHaveBeenCalledTimes(1);
    });

    expect(window.electronAPI.codePaneListDirectory).toHaveBeenCalledWith({
      rootPath: '/workspace/project',
      targetPath: '/workspace/project/src',
    });
    expect(window.electronAPI.codePaneGetGitStatus).toHaveBeenCalledTimes(1);
  });

  it('manual refresh invalidates cached directories before reloading', async () => {
    vi.mocked(window.electronAPI.codePaneListDirectory).mockImplementation(async ({ targetPath }) => {
      if (targetPath === '/workspace/project') {
        return {
          success: true,
          data: [
            {
              path: '/workspace/project/src-1',
              name: 'src-1',
              type: 'directory',
            },
          ],
        };
      }

      return {
        success: true,
        data: [],
      };
    });

    const firstView = renderCodePane(createPane());
    expect(await screen.findByRole('button', { name: 'src-1' }, { timeout: 3000 })).toBeInTheDocument();
    firstView.unmount();

    let rootRequestCount = 0;
    let resolveSecondPaneReload: (() => void) | null = null;
    vi.mocked(window.electronAPI.codePaneListDirectory).mockClear();
    vi.mocked(window.electronAPI.codePaneListDirectory).mockImplementation(async ({ targetPath }) => {
      if (targetPath === '/workspace/project') {
        rootRequestCount += 1;
        if (rootRequestCount === 1) {
          await new Promise<void>((resolve) => {
            resolveSecondPaneReload = resolve;
          });
          return {
            success: true,
            data: [
              {
                path: '/workspace/project/src-2',
                name: 'src-2',
                type: 'directory',
              },
            ],
          };
        }

        return {
          success: true,
          data: [
            {
              path: '/workspace/project/src-3',
              name: 'src-3',
              type: 'directory',
            },
          ],
        };
      }

      return {
        success: true,
        data: [],
      };
    });

    renderCodePane(createPane());

    expect(await screen.findByRole('button', { name: 'src-1' }, { timeout: 3000 })).toBeInTheDocument();

    await act(async () => {
      resolveSecondPaneReload?.();
      await Promise.resolve();
    });

    expect(await screen.findByRole('button', { name: 'src-2' }, { timeout: 3000 })).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'codePane.refresh' }));
    });

    expect(await screen.findByRole('button', { name: 'src-3' }, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'src-2' })).not.toBeInTheDocument();
    expect(window.electronAPI.codePaneListDirectory).toHaveBeenCalledWith({
      rootPath: '/workspace/project',
      targetPath: '/workspace/project',
    });
  });

  it('coalesces overlapping manual refreshes into one directory reload', async () => {
    let rootRequestCount = 0;
    let resolveRootReload: (() => void) | null = null;
    vi.mocked(window.electronAPI.codePaneListDirectory).mockImplementation(async ({ targetPath }) => {
      if (targetPath === '/workspace/project') {
        rootRequestCount += 1;
        if (rootRequestCount === 1) {
          return {
            success: true,
            data: [
              {
                path: '/workspace/project/src-initial',
                name: 'src-initial',
                type: 'directory',
              },
            ],
          };
        }
        if (rootRequestCount > 2) {
          throw new Error('root reload should be coalesced');
        }
        await new Promise<void>((resolve) => {
          resolveRootReload = resolve;
        });
        return {
          success: true,
          data: [
            {
              path: '/workspace/project/src-refreshed',
              name: 'src-refreshed',
              type: 'directory',
            },
          ],
        };
      }

      return {
        success: true,
        data: [],
      };
    });

    renderCodePane(createPane());

    expect(await screen.findByRole('button', { name: 'src-initial' }, { timeout: 3000 })).toBeInTheDocument();
    vi.mocked(window.electronAPI.codePaneListDirectory).mockClear();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'codePane.refresh' }));
      fireEvent.click(screen.getByRole('button', { name: 'codePane.refresh' }));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(window.electronAPI.codePaneListDirectory).toHaveBeenCalledTimes(1);
      expect(window.electronAPI.codePaneListDirectory).toHaveBeenCalledWith({
        rootPath: '/workspace/project',
        targetPath: '/workspace/project',
      });
    });

    await act(async () => {
      resolveRootReload?.();
      await Promise.resolve();
    });

    expect(await screen.findByRole('button', { name: 'src-refreshed' }, { timeout: 3000 })).toBeInTheDocument();
  });

  it('does not request removed breadcrumb symbols for the active file', async () => {
    vi.mocked(window.electronAPI.codePaneReadFile).mockResolvedValue({
      success: true,
      data: {
        content: 'export function hello() {\n  return 1;\n}\n',
        mtimeMs: 100,
        size: 40,
        language: 'typescript',
        isBinary: false,
      },
    });
    vi.mocked(window.electronAPI.codePaneGetDocumentSymbols).mockResolvedValue({
      success: true,
      data: [
        {
          name: 'hello',
          kind: 12,
          range: {
            startLineNumber: 1,
            startColumn: 1,
            endLineNumber: 3,
            endColumn: 2,
          },
          selectionRange: {
            startLineNumber: 1,
            startColumn: 17,
            endLineNumber: 1,
            endColumn: 22,
          },
        },
      ],
    });

    renderCodePane(createPane());

    await openFileFromTree('index.ts', { doubleClick: true });
    await waitFor(() => {
      expect(window.electronAPI.codePaneReadFile).toHaveBeenCalledWith({
        rootPath: '/workspace/project',
        filePath: '/workspace/project/src/index.ts',
      });
    });
    expect(window.electronAPI.codePaneGetDocumentSymbols).not.toHaveBeenCalled();
    expect(screen.queryByText('hello')).not.toBeInTheDocument();
  });

  it('opens the file structure tool window and navigates to symbols', async () => {
    vi.mocked(window.electronAPI.codePaneReadFile).mockResolvedValue({
      success: true,
      data: {
        content: 'export class UserService {\n  private repo = 1;\n  listUsers() {\n    return [];\n  }\n}\n',
        mtimeMs: 100,
        size: 90,
        language: 'typescript',
        isBinary: false,
      },
    });
    vi.mocked(window.electronAPI.codePaneGetDocumentSymbols).mockResolvedValue({
      success: true,
      data: [
        {
          name: 'UserService',
          kind: 5,
          range: {
            startLineNumber: 1,
            startColumn: 1,
            endLineNumber: 6,
            endColumn: 2,
          },
          selectionRange: {
            startLineNumber: 1,
            startColumn: 14,
            endLineNumber: 1,
            endColumn: 25,
          },
          children: [
            {
              name: 'repo',
              kind: 8,
              range: {
                startLineNumber: 2,
                startColumn: 3,
                endLineNumber: 2,
                endColumn: 19,
              },
              selectionRange: {
                startLineNumber: 2,
                startColumn: 11,
                endLineNumber: 2,
                endColumn: 15,
              },
            },
            {
              name: 'listUsers',
              kind: 6,
              range: {
                startLineNumber: 3,
                startColumn: 3,
                endLineNumber: 5,
                endColumn: 4,
              },
              selectionRange: {
                startLineNumber: 3,
                startColumn: 3,
                endLineNumber: 3,
                endColumn: 12,
              },
            },
          ],
        },
      ],
    });

    renderCodePane(createPane());

    await openFileFromTree('index.ts', { doubleClick: true });
    await triggerEditorAction('codePane.fileStructureAction');

    await waitFor(() => {
      expect(window.electronAPI.codePaneGetDocumentSymbols).toHaveBeenCalledWith({
        rootPath: '/workspace/project',
        filePath: '/workspace/project/src/index.ts',
        language: 'typescript',
      });
    });
    expect(await screen.findAllByText('UserService')).not.toHaveLength(0);
    expect(await screen.findByText('repo')).toBeInTheDocument();
    expect(await screen.findByText('listUsers')).toBeInTheDocument();

    const activeEditor = fakeMonaco.editor.create.mock.results.at(-1)?.value;
    await act(async () => {
      fireEvent.click(screen.getByText('listUsers'));
      await Promise.resolve();
    });

    expect(activeEditor.setPosition).toHaveBeenCalledWith({
      lineNumber: 3,
      column: 3,
    });
    expect(activeEditor.revealLineInCenter).toHaveBeenCalledWith(3);
  });

  it('opens the file structure inspector from the file context menu and closes it after double click navigation', async () => {
    const user = userEvent.setup();
    vi.mocked(window.electronAPI.codePaneReadFile).mockResolvedValue({
      success: true,
      data: {
        content: 'export class UserService {\n  listUsers() {\n    return [];\n  }\n}\n',
        mtimeMs: 100,
        size: 70,
        language: 'typescript',
        isBinary: false,
      },
    });
    vi.mocked(window.electronAPI.codePaneGetDocumentSymbols).mockResolvedValue({
      success: true,
      data: [
        {
          name: 'UserService',
          kind: 5,
          range: {
            startLineNumber: 1,
            startColumn: 1,
            endLineNumber: 5,
            endColumn: 2,
          },
          selectionRange: {
            startLineNumber: 1,
            startColumn: 14,
            endLineNumber: 1,
            endColumn: 25,
          },
          children: [
            {
              name: 'listUsers',
              kind: 6,
              range: {
                startLineNumber: 2,
                startColumn: 3,
                endLineNumber: 4,
                endColumn: 4,
              },
              selectionRange: {
                startLineNumber: 2,
                startColumn: 3,
                endLineNumber: 2,
                endColumn: 12,
              },
            },
          ],
        },
      ],
    });

    renderCodePane(createPane());

    const treeButton = await screen.findByRole('button', { name: 'index.ts' });
    fireEvent.contextMenu(treeButton);
    await user.click(await screen.findByRole('menuitem', { name: 'codePane.fileStructureTab' }));

    expect(await screen.findByText('UserService')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'codePane.fileStructureFilterInherited' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'codePane.fileStructureFilterAnonymous' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'codePane.fileStructureFilterLambdas' })).toBeInTheDocument();

    await act(async () => {
      fireEvent.doubleClick(screen.getByText('listUsers'));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.queryAllByText('UserService')).toHaveLength(0);
    });
  });

  it('shows the outline header as a centered file name and treats filters as opt-in', async () => {
    const user = userEvent.setup();
    vi.mocked(window.electronAPI.codePaneReadFile).mockResolvedValue({
      success: true,
      data: {
        content: 'class RouteParam {\n  id = 1\n  anonymousValue = new Runnable() {}\n  lambdaHandler = () => {}\n  override toString() {}\n}\n',
        mtimeMs: 100,
        size: 120,
        language: 'java',
        isBinary: false,
      },
    });
    vi.mocked(window.electronAPI.codePaneGetDocumentSymbols).mockResolvedValue({
      success: true,
      data: [
        {
          name: 'RouteParam',
          kind: 5,
          range: {
            startLineNumber: 1,
            startColumn: 1,
            endLineNumber: 6,
            endColumn: 2,
          },
          selectionRange: {
            startLineNumber: 1,
            startColumn: 7,
            endLineNumber: 1,
            endColumn: 17,
          },
          children: [
            {
              name: 'id',
              kind: 8,
              range: {
                startLineNumber: 2,
                startColumn: 3,
                endLineNumber: 2,
                endColumn: 9,
              },
              selectionRange: {
                startLineNumber: 2,
                startColumn: 3,
                endLineNumber: 2,
                endColumn: 5,
              },
            },
            {
              name: 'AnonymousRunnable',
              kind: 5,
              detail: 'anonymous',
              range: {
                startLineNumber: 3,
                startColumn: 3,
                endLineNumber: 3,
                endColumn: 28,
              },
              selectionRange: {
                startLineNumber: 3,
                startColumn: 3,
                endLineNumber: 3,
                endColumn: 20,
              },
            },
            {
              name: 'lambdaHandler',
              kind: 12,
              detail: 'lambda',
              range: {
                startLineNumber: 4,
                startColumn: 3,
                endLineNumber: 4,
                endColumn: 25,
              },
              selectionRange: {
                startLineNumber: 4,
                startColumn: 3,
                endLineNumber: 4,
                endColumn: 16,
              },
            },
            {
              name: 'toString',
              kind: 6,
              detail: 'override',
              range: {
                startLineNumber: 5,
                startColumn: 3,
                endLineNumber: 5,
                endColumn: 25,
              },
              selectionRange: {
                startLineNumber: 5,
                startColumn: 3,
                endLineNumber: 5,
                endColumn: 11,
              },
            },
          ],
        },
      ],
    });

    renderCodePane(createPane());

    await openFileFromTree('index.ts', { doubleClick: true });
    await triggerEditorAction('codePane.fileStructureAction');

    await waitFor(() => {
      expect(screen.getAllByText('index.ts').length).toBeGreaterThan(0);
    });
    const outlineTitle = screen.getByText('index.ts', {
      selector: 'div.min-w-0.truncate.text-center.text-sm.font-semibold.leading-5',
    });
    expect(outlineTitle).toBeInTheDocument();
    expect(outlineTitle).toHaveClass('text-[rgb(var(--foreground))]');
    expect(screen.queryByText('codePane.fileStructureTab')).not.toBeInTheDocument();
    expect(screen.queryByText('codePane.fileStructureCount')).not.toBeInTheDocument();
    expect(screen.getByText('id')).toBeInTheDocument();
    expect(screen.getByText('AnonymousRunnable')).toBeInTheDocument();
    expect(screen.getByText('lambdaHandler')).toBeInTheDocument();
    expect(screen.getByText('toString')).toBeInTheDocument();

    const inheritedToggle = screen.getByRole('button', { name: 'codePane.fileStructureFilterInherited' });
    const anonymousToggle = screen.getByRole('button', { name: 'codePane.fileStructureFilterAnonymous' });
    const lambdasToggle = screen.getByRole('button', { name: 'codePane.fileStructureFilterLambdas' });

    expect(inheritedToggle).toHaveAttribute('aria-pressed', 'false');
    expect(anonymousToggle).toHaveAttribute('aria-pressed', 'false');
    expect(lambdasToggle).toHaveAttribute('aria-pressed', 'false');

    await user.click(anonymousToggle);
    expect(anonymousToggle).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText('id')).not.toBeInTheDocument();
    expect(screen.getByText('AnonymousRunnable')).toBeInTheDocument();
    expect(screen.queryByText('lambdaHandler')).not.toBeInTheDocument();
    expect(screen.queryByText('toString')).not.toBeInTheDocument();
  });

  it('registers IDEA-style Monaco navigation actions for file structure and hierarchy', async () => {
    renderCodePane(createPane());

    await openFileFromTree('index.ts', { doubleClick: true });

    const activeEditor = fakeMonaco.editor.create.mock.results.at(-1)?.value;
    expect(activeEditor.addAction).toHaveBeenCalledWith(expect.objectContaining({
      id: 'code-pane-file-structure',
      label: 'codePane.fileStructureAction',
    }));
    expect(activeEditor.addAction).toHaveBeenCalledWith(expect.objectContaining({
      id: 'code-pane-type-hierarchy',
      label: 'codePane.typeHierarchyAction',
    }));
    expect(activeEditor.addAction).toHaveBeenCalledWith(expect.objectContaining({
      id: 'code-pane-call-hierarchy',
      label: 'codePane.callHierarchyAction',
    }));
  });

  it('opens type hierarchy from the editor actions menu', async () => {
    vi.mocked(window.electronAPI.codePaneGetTypeHierarchy).mockResolvedValue({
      success: true,
      data: {
        root: {
          name: 'UserService',
          filePath: '/workspace/project/src/index.ts',
          range: {
            startLineNumber: 1,
            startColumn: 1,
            endLineNumber: 6,
            endColumn: 2,
          },
          selectionRange: {
            startLineNumber: 1,
            startColumn: 14,
            endLineNumber: 1,
            endColumn: 25,
          },
        },
        items: [
          {
            name: 'BaseService',
            detail: 'src/base.ts',
            filePath: '/workspace/project/src/base.ts',
            range: {
              startLineNumber: 1,
              startColumn: 1,
              endLineNumber: 3,
              endColumn: 2,
            },
            selectionRange: {
              startLineNumber: 1,
              startColumn: 14,
              endLineNumber: 1,
              endColumn: 25,
            },
          },
        ],
      },
    });

    renderCodePane(createPane());

    await openFileFromTree('index.ts', { doubleClick: true });
    await triggerEditorAction('codePane.typeHierarchyAction');

    await waitFor(() => {
      expect(window.electronAPI.codePaneGetTypeHierarchy).toHaveBeenCalledWith({
        rootPath: '/workspace/project',
        filePath: '/workspace/project/src/index.ts',
        language: 'typescript',
        position: {
          lineNumber: 1,
          column: 1,
        },
        direction: 'parents',
      });
    });
    expect((await screen.findAllByText('UserService')).length).toBeGreaterThan(0);
    expect(await screen.findByText('BaseService')).toBeInTheDocument();
  });

  it('opens hierarchy inspector from the file context menu', async () => {
    const user = userEvent.setup();
    vi.mocked(window.electronAPI.codePaneGetDocumentSymbols).mockResolvedValue({
      success: true,
      data: [
        {
          name: 'UserService',
          kind: 5,
          range: {
            startLineNumber: 1,
            startColumn: 1,
            endLineNumber: 6,
            endColumn: 2,
          },
          selectionRange: {
            startLineNumber: 1,
            startColumn: 14,
            endLineNumber: 1,
            endColumn: 25,
          },
        },
      ],
    });
    vi.mocked(window.electronAPI.codePaneGetTypeHierarchy).mockResolvedValue({
      success: true,
      data: {
        root: {
          name: 'UserService',
          filePath: '/workspace/project/src/index.ts',
          range: {
            startLineNumber: 1,
            startColumn: 1,
            endLineNumber: 6,
            endColumn: 2,
          },
          selectionRange: {
            startLineNumber: 1,
            startColumn: 14,
            endLineNumber: 1,
            endColumn: 25,
          },
        },
        items: [
          {
            name: 'BaseService',
            detail: 'src/base.ts',
            filePath: '/workspace/project/src/base.ts',
            range: {
              startLineNumber: 1,
              startColumn: 1,
              endLineNumber: 4,
              endColumn: 2,
            },
            selectionRange: {
              startLineNumber: 1,
              startColumn: 14,
              endLineNumber: 1,
              endColumn: 25,
            },
          },
        ],
      },
    });

    renderCodePane(createPane());

    const treeButton = await screen.findByRole('button', { name: 'index.ts' });
    fireEvent.contextMenu(treeButton);
    await user.click(await screen.findByRole('menuitem', { name: 'codePane.typeHierarchyAction' }));

    await waitFor(() => {
      expect(window.electronAPI.codePaneGetTypeHierarchy).toHaveBeenCalledWith({
        rootPath: '/workspace/project',
        filePath: '/workspace/project/src/index.ts',
        language: 'typescript',
        position: {
          lineNumber: 1,
          column: 14,
        },
        direction: 'parents',
      });
    });
    expect(await screen.findByText('BaseService')).toBeInTheDocument();
  });

  it('opens quick documentation and renders hover content', async () => {
    vi.mocked(window.electronAPI.codePaneGetHover).mockResolvedValue({
      success: true,
      data: {
        contents: [
          {
            kind: 'markdown',
            value: 'Returns the active value.',
          },
        ],
      },
    });

    renderCodePane(createPane());

    await openFileFromTree('index.ts', { doubleClick: true });
    await triggerEditorAction('codePane.quickDocumentation');

    await waitFor(() => {
      expect(window.electronAPI.codePaneGetHover).toHaveBeenCalledWith({
        rootPath: '/workspace/project',
        filePath: '/workspace/project/src/index.ts',
        language: 'typescript',
        position: {
          lineNumber: 1,
          column: 1,
        },
      });
    });

    expect(await screen.findByText('Returns the active value.')).toBeInTheDocument();
  });

  it('bridges Monaco inlay hints requests through the language service API', async () => {
    vi.mocked(window.electronAPI.codePaneGetInlayHints).mockResolvedValue({
      success: true,
      data: [
        {
          position: {
            lineNumber: 1,
            column: 14,
          },
          label: ': number',
          kind: 'type',
          paddingLeft: true,
        },
      ],
    });

    renderCodePane(createPane());

    await openFileFromTree('index.ts', { doubleClick: true });

    const provider = fakeMonacoState.inlayHintsProviders.get('typescript');
    const model = fakeMonacoState.lastEditorModel;
    if (!provider || !model) {
      throw new Error('expected the TypeScript inlay hints provider to be registered');
    }

    const result = await provider.provideInlayHints(model, {
      startLineNumber: 1,
      startColumn: 1,
      endLineNumber: 1,
      endColumn: 20,
    });

    expect(window.electronAPI.codePaneGetInlayHints).toHaveBeenCalledWith({
      rootPath: '/workspace/project',
      filePath: '/workspace/project/src/index.ts',
      language: 'typescript',
      range: {
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: 1,
        endColumn: 20,
      },
    });
    expect(result).toEqual({
      hints: [
        expect.objectContaining({
          label: ': number',
          paddingLeft: true,
          kind: 1,
        }),
      ],
      dispose: expect.any(Function),
    });
  });

  it('pins tabs from the context menu and keeps them first', async () => {
    const user = userEvent.setup();
    vi.mocked(window.electronAPI.codePaneListDirectory).mockResolvedValue({
      success: true,
      data: [
        {
          path: '/workspace/project/src/index.ts',
          name: 'index.ts',
          type: 'file',
        },
        {
          path: '/workspace/project/src/app.ts',
          name: 'app.ts',
          type: 'file',
        },
      ],
    });
    vi.mocked(window.electronAPI.codePaneReadFile).mockImplementation(async ({ filePath }) => ({
      success: true,
      data: {
        content: `// ${filePath}\n`,
        mtimeMs: filePath.endsWith('app.ts') ? 101 : 100,
        size: 24,
        language: 'typescript',
        isBinary: false,
      },
    }));

    const view = renderCodePane(createPane());

    await openFileFromTree('index.ts', { doubleClick: true });
    await openFileFromTree('app.ts', { doubleClick: true });

    const appTabLabels = screen.getAllByText('app.ts');
    const appTabLabel = appTabLabels[appTabLabels.length - 1];
    if (!appTabLabel) {
      throw new Error('expected app.ts tab label');
    }

    await user.pointer({ keys: '[MouseRight]', target: appTabLabel });
    await user.click(await screen.findByText('codePane.pinTab'));

    expect(view.getPane().code?.openFiles).toEqual([
      expect.objectContaining({
        path: '/workspace/project/src/app.ts',
        pinned: true,
      }),
      expect.objectContaining({
        path: '/workspace/project/src/index.ts',
      }),
    ]);
  });

  it('uses preview tabs for single-click tree navigation and promotes them on double click', async () => {
    const view = renderCodePane(createPane());
    const treeButton = await screen.findByRole('button', { name: 'index.ts' }, { timeout: 3000 });

    await act(async () => {
      fireEvent.click(treeButton);
    });

    await waitFor(() => {
      expect(view.getPane().code?.openFiles).toEqual([
        expect.objectContaining({
          path: '/workspace/project/src/index.ts',
          preview: true,
        }),
      ]);
    });
    expect(screen.queryByText('codePane.previewTabBadge')).not.toBeInTheDocument();

    expect(view.getPane().code?.activeFilePath).toBe('/workspace/project/src/index.ts');
  });

  it('opens files in a secondary split editor from the context menu', async () => {
    const user = userEvent.setup();
    const view = renderCodePane(createPane());

    await openFileFromTree('index.ts', { doubleClick: true });
    const primaryEditor = fakeMonaco.editor.create.mock.results.at(-1)?.value;
    if (!primaryEditor) {
      throw new Error('expected primary editor instance');
    }
    vi.mocked(primaryEditor.setModel).mockClear();

    const tabLabel = (await screen.findAllByText('index.ts')).at(-1);
    if (!tabLabel) {
      throw new Error('expected index.ts tab label');
    }

    await user.pointer({ keys: '[MouseRight]', target: tabLabel });
    await user.click(await screen.findByText('codePane.openInSplit'));

    await waitFor(() => {
      expect(screen.getByTestId('code-pane-editor-split-resize-handle')).toBeInTheDocument();
    });
    expect(view.getPane().code?.layout?.editorSplit).toEqual({
      visible: true,
      size: 0.5,
      secondaryFilePath: '/workspace/project/src/index.ts',
    });
    expect(primaryEditor.setModel).toHaveBeenCalledTimes(1);
  });

  it('shows bookmarks, todo items, and local history in the workspace tool window', async () => {
    const user = userEvent.setup();
    vi.mocked(window.electronAPI.codePaneSearchContents).mockImplementation(async ({ query }) => ({
      success: true,
      data: query === 'TODO'
        ? [
          {
            filePath: '/workspace/project/src/index.ts',
            lineNumber: 1,
            column: 1,
            lineText: '// TODO: wire service',
          },
        ]
        : [],
    }));

    const view = renderCodePane(createPane());

    await openFileFromTree('index.ts', { doubleClick: true });
    await triggerEditorAction('codePane.bookmarkToggle');
    await user.click(await screen.findByRole('button', { name: 'codePane.workspaceTab' }));

    expect(await screen.findByText('codePane.bookmarksTitle')).toBeInTheDocument();
    expect(await screen.findByText('codePane.todoTitle')).toBeInTheDocument();
    expect(await screen.findByText('codePane.localHistoryTitle')).toBeInTheDocument();
    expect(await screen.findByText('codePane.localHistoryOpened')).toBeInTheDocument();
    expect(await screen.findByText('// TODO: wire service')).toBeInTheDocument();
    expect(view.getPane().code?.bookmarks).toEqual([
      expect.objectContaining({
        id: '/workspace/project/src/index.ts:1',
        filePath: '/workspace/project/src/index.ts',
      }),
    ]);
  });

  it('coalesces overlapping workspace todo refresh requests', async () => {
    const user = userEvent.setup();
    const deferredByQuery = new Map<string, () => void>();

    vi.mocked(window.electronAPI.codePaneSearchContents).mockImplementation(async ({ query }) => {
      await new Promise<void>((resolve) => {
        deferredByQuery.set(query, resolve);
      });
      return {
        success: true,
        data: query === 'TODO'
          ? [
            {
              filePath: '/workspace/project/src/index.ts',
              lineNumber: 1,
              column: 1,
              lineText: '// TODO: wire service',
            },
          ]
          : [],
      };
    });

    renderCodePane(createPane());

    await user.click(await screen.findByRole('button', { name: 'codePane.workspaceTab' }));

    await waitFor(() => {
      expect(window.electronAPI.codePaneSearchContents).toHaveBeenCalledTimes(3);
    });

    await act(async () => {
      fireEvent.click(within(screen.getByTestId('code-pane-bottom-panel')).getAllByRole('button', { name: 'codePane.refresh' })[0]);
      await Promise.resolve();
    });

    expect(window.electronAPI.codePaneSearchContents).toHaveBeenCalledTimes(3);

    await act(async () => {
      for (const resolve of deferredByQuery.values()) {
        resolve();
      }
      await Promise.resolve();
    });
  });

  it('does not duplicate local history opened entries after external file refreshes', async () => {
    const user = userEvent.setup();

    renderCodePane(createPane({
      openFiles: [{ path: '/workspace/project/src/index.ts' }],
      activeFilePath: '/workspace/project/src/index.ts',
      selectedPath: '/workspace/project/src/index.ts',
    }));

    vi.mocked(window.electronAPI.codePaneReadFile).mockResolvedValue({
      success: true,
      data: {
        content: 'export const value = 9;\n',
        mtimeMs: 250,
        size: 24,
        language: 'typescript',
        isBinary: false,
      },
    });

    vi.useFakeTimers();
    try {
      await emitFsChangedAndFlush({
        rootPath: '/workspace/project',
        changes: [
          {
            type: 'change',
            path: '/workspace/project/src/index.ts',
          },
        ],
      });
    } finally {
      vi.useRealTimers();
    }

    await user.click(await screen.findByRole('button', { name: 'codePane.workspaceTab' }));
    expect(await screen.findByText('codePane.localHistoryTitle')).toBeInTheDocument();
    expect(screen.getAllByText('codePane.localHistoryOpened')).toHaveLength(1);
  });

  it('locates the active file in the explorer from the files toolbar', async () => {
    const user = userEvent.setup();
    const scrollIntoViewSpy = vi.spyOn(Element.prototype, 'scrollIntoView');
    vi.mocked(window.electronAPI.codePaneListDirectory).mockImplementation(async ({ targetPath }) => {
      if (targetPath === '/workspace/project') {
        return {
          success: true,
          data: [
            {
              path: '/workspace/project/src',
              name: 'src',
              type: 'directory',
            },
          ],
        };
      }

      if (targetPath === '/workspace/project/src') {
        return {
          success: true,
          data: [
            {
              path: '/workspace/project/src/index.ts',
              name: 'index.ts',
              type: 'file',
            },
          ],
        };
      }

      return { success: true, data: [] };
    });
    const view = renderCodePane(createPane({
      activeFilePath: '/workspace/project/src/index.ts',
      openFiles: [{ path: '/workspace/project/src/index.ts' }],
      selectedPath: '/workspace/project',
      expandedPaths: [],
    }));

    try {
      await user.click(await screen.findByRole('button', { name: 'codePane.locateActiveFileInExplorer' }));

      await waitFor(() => {
        expect(view.getPane().code?.selectedPath).toBe('/workspace/project/src/index.ts');
        expect(view.getPane().code?.expandedPaths).toContain('/workspace/project');
        expect(view.getPane().code?.expandedPaths).toContain('/workspace/project/src');
      });
      await waitFor(() => {
        expect(scrollIntoViewSpy).toHaveBeenCalled();
      });
    } finally {
      scrollIntoViewSpy.mockRestore();
    }
  });

  it('re-locates the active file even when it is already selected in the explorer', async () => {
    const user = userEvent.setup();
    const scrollIntoViewSpy = vi.spyOn(Element.prototype, 'scrollIntoView');
    vi.mocked(window.electronAPI.codePaneListDirectory).mockImplementation(async ({ targetPath }) => {
      if (targetPath === '/workspace/project') {
        return {
          success: true,
          data: [
            {
              path: '/workspace/project/src',
              name: 'src',
              type: 'directory',
            },
          ],
        };
      }

      if (targetPath === '/workspace/project/src') {
        return {
          success: true,
          data: [
            {
              path: '/workspace/project/src/index.ts',
              name: 'index.ts',
              type: 'file',
            },
          ],
        };
      }

      return { success: true, data: [] };
    });

    renderCodePane(createPane({
      activeFilePath: '/workspace/project/src/index.ts',
      openFiles: [{ path: '/workspace/project/src/index.ts' }],
      selectedPath: '/workspace/project/src/index.ts',
      expandedPaths: ['/workspace/project', '/workspace/project/src'],
    }));

    try {
      await user.click(await screen.findByRole('button', { name: 'codePane.locateActiveFileInExplorer' }));

      await waitFor(() => {
        expect(scrollIntoViewSpy).toHaveBeenCalled();
      });
    } finally {
      scrollIntoViewSpy.mockRestore();
    }
  });

  it('locates the focused secondary split editor file in the explorer', async () => {
    const user = userEvent.setup();
    const scrollIntoViewSpy = vi.spyOn(Element.prototype, 'scrollIntoView');
    vi.mocked(window.electronAPI.codePaneListDirectory).mockImplementation(async ({ targetPath }) => {
      if (targetPath === '/workspace/project') {
        return {
          success: true,
          data: [
            {
              path: '/workspace/project/src',
              name: 'src',
              type: 'directory',
            },
          ],
        };
      }

      if (targetPath === '/workspace/project/src') {
        return {
          success: true,
          data: [
            {
              path: '/workspace/project/src/index.ts',
              name: 'index.ts',
              type: 'file',
            },
            {
              path: '/workspace/project/src/secondary.ts',
              name: 'secondary.ts',
              type: 'file',
            },
          ],
        };
      }

      return { success: true, data: [] };
    });

    const view = renderCodePane(createPane({
      activeFilePath: '/workspace/project/src/index.ts',
      openFiles: [
        { path: '/workspace/project/src/index.ts' },
        { path: '/workspace/project/src/secondary.ts' },
      ],
      selectedPath: '/workspace/project',
      expandedPaths: [],
      layout: {
        editorSplit: {
          visible: true,
          size: 0.5,
          secondaryFilePath: '/workspace/project/src/secondary.ts',
        },
      },
    }));

    await waitFor(() => {
      expect(screen.getByTestId('code-pane-editor-split-resize-handle')).toBeInTheDocument();
      expect(fakeMonaco.editor.create.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    const primaryEditor = fakeMonaco.editor.create.mock.results.at(-2)?.value;
    const secondaryEditor = fakeMonaco.editor.create.mock.results.at(-1)?.value;
    if (!primaryEditor || !secondaryEditor) {
      throw new Error('expected split editor instances');
    }

    await act(async () => {
      secondaryEditor.fireMouseDown({
        target: {
          position: { lineNumber: 1, column: 1 },
        },
        event: {
          browserEvent: {
            button: 0,
            buttons: 1,
            preventDefault: vi.fn(),
            stopPropagation: vi.fn(),
          },
          leftButton: true,
          preventDefault: vi.fn(),
          stopPropagation: vi.fn(),
        },
      });
      await Promise.resolve();
    });

    expect(primaryEditor.getModel()?.uri.path).toBe('/workspace/project/src/index.ts');
    expect(secondaryEditor.getModel()?.uri.path).toBe('/workspace/project/src/secondary.ts');

    try {
      await user.click(await screen.findByRole('button', { name: 'codePane.locateActiveFileInExplorer' }));

      await waitFor(() => {
        const explorerTarget = document.querySelector<HTMLButtonElement>(
          '[data-explorer-path="/workspace/project/src/secondary.ts"]',
        );
        expect(explorerTarget).not.toBeNull();
        expect(scrollIntoViewSpy).toHaveBeenCalled();
        expect(explorerTarget?.className).toContain('bg-[rgb(var(--primary))]/15');
      });

      await waitFor(() => {
        expect(view.getPane().code?.expandedPaths).toContain('/workspace/project');
        expect(view.getPane().code?.expandedPaths).toContain('/workspace/project/src');
      });
    } finally {
      scrollIntoViewSpy.mockRestore();
    }
  });

  it('expands the selected directory recursively from the files toolbar', async () => {
    const user = userEvent.setup();
    vi.mocked(window.electronAPI.codePaneListDirectory).mockImplementation(async ({ targetPath }) => {
      if (targetPath === '/workspace/project') {
        return {
          success: true,
          data: [
            {
              path: '/workspace/project/src',
              name: 'src',
              type: 'directory',
            },
          ],
        };
      }

      if (targetPath === '/workspace/project/src') {
        return {
          success: true,
          data: [
            {
              path: '/workspace/project/src/main',
              name: 'main',
              type: 'directory',
            },
            {
              path: '/workspace/project/src/index.ts',
              name: 'index.ts',
              type: 'file',
            },
          ],
        };
      }

      if (targetPath === '/workspace/project/src/main') {
        return {
          success: true,
          data: [
            {
              path: '/workspace/project/src/main/java',
              name: 'java',
              type: 'directory',
            },
          ],
        };
      }

      if (targetPath === '/workspace/project/src/main/java') {
        return {
          success: true,
          data: [
            {
              path: '/workspace/project/src/main/java/com',
              name: 'com',
              type: 'directory',
            },
          ],
        };
      }

      if (targetPath === '/workspace/project/src/main/java/com') {
        return {
          success: true,
          data: [
            {
              path: '/workspace/project/src/main/java/com/example',
              name: 'example',
              type: 'directory',
            },
          ],
        };
      }

      if (targetPath === '/workspace/project/src/main/java/com/example') {
        return {
          success: true,
          data: [
            {
              path: '/workspace/project/src/main/java/com/example/App.java',
              name: 'App.java',
              type: 'file',
            },
          ],
        };
      }

      return { success: true, data: [] };
    });

    const view = renderCodePane(createPane({
      selectedPath: '/workspace/project/src',
      expandedPaths: ['/workspace/project'],
    }));

    await user.click(await screen.findByRole('button', { name: 'codePane.expandSelectedInExplorer' }));

    await waitFor(() => {
      expect(view.getPane().code?.expandedPaths).toEqual([
        '/workspace/project',
        '/workspace/project/src',
        '/workspace/project/src/main',
        '/workspace/project/src/main/java',
        '/workspace/project/src/main/java/com',
        '/workspace/project/src/main/java/com/example',
      ]);
    });
    expect(await screen.findByRole('button', { name: 'App.java' })).toBeInTheDocument();
  });

  it('collapses all explorer directories including the root from the files toolbar', async () => {
    const user = userEvent.setup();
    vi.mocked(window.electronAPI.codePaneListDirectory).mockImplementation(async ({ targetPath }) => {
      if (targetPath === '/workspace/project') {
        return {
          success: true,
          data: [
            {
              path: '/workspace/project/src',
              name: 'src',
              type: 'directory',
            },
          ],
        };
      }

      if (targetPath === '/workspace/project/src') {
        return {
          success: true,
          data: [
            {
              path: '/workspace/project/src/index.ts',
              name: 'index.ts',
              type: 'file',
            },
          ],
        };
      }

      return { success: true, data: [] };
    });

    const view = renderCodePane(createPane({
      selectedPath: '/workspace/project/src/index.ts',
      expandedPaths: ['/workspace/project', '/workspace/project/src'],
    }));

    expect(await screen.findByRole('button', { name: 'src' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'codePane.collapseAllInExplorer' }));

    await waitFor(() => {
      expect(view.getPane().code?.expandedPaths).toEqual([]);
    });
    expect(screen.queryByRole('button', { name: 'src' })).not.toBeInTheDocument();
  });

  it('opens the hierarchy tool window and loads call hierarchy data', async () => {
    const user = userEvent.setup();
    vi.mocked(window.electronAPI.codePaneGetCallHierarchy).mockResolvedValue({
      success: true,
      data: {
        root: {
          name: 'runApp',
          filePath: '/workspace/project/src/index.ts',
          range: {
            startLineNumber: 1,
            startColumn: 1,
            endLineNumber: 1,
            endColumn: 7,
          },
          selectionRange: {
            startLineNumber: 1,
            startColumn: 1,
            endLineNumber: 1,
            endColumn: 7,
          },
        },
        items: [
          {
            name: 'bootstrap',
            detail: 'src/bootstrap.ts',
            filePath: '/workspace/project/src/bootstrap.ts',
            range: {
              startLineNumber: 3,
              startColumn: 1,
              endLineNumber: 3,
              endColumn: 10,
            },
            selectionRange: {
              startLineNumber: 3,
              startColumn: 1,
              endLineNumber: 3,
              endColumn: 10,
            },
            relationRanges: [
              {
                startLineNumber: 8,
                startColumn: 4,
                endLineNumber: 8,
                endColumn: 10,
              },
            ],
          },
        ],
      },
    });

    renderCodePane(createPane());
    await openFileFromTree('index.ts', { doubleClick: true });
    await user.click(await screen.findByRole('button', { name: 'codePane.hierarchyTab' }));

    await waitFor(() => {
      expect(window.electronAPI.codePaneGetCallHierarchy).toHaveBeenCalledWith({
        rootPath: '/workspace/project',
        filePath: '/workspace/project/src/index.ts',
        language: 'typescript',
        position: {
          lineNumber: 1,
          column: 1,
        },
        direction: 'outgoing',
      });
    });
    expect((await screen.findAllByText('runApp')).length).toBeGreaterThan(0);
    expect(await screen.findByText('bootstrap')).toBeInTheDocument();
  });

  it('shows semantic token summaries for the active file', async () => {
    const user = userEvent.setup();
    vi.mocked(window.electronAPI.codePaneGetSemanticTokenLegend).mockResolvedValue({
      success: true,
      data: {
        tokenTypes: ['class', 'method'],
        tokenModifiers: ['declaration'],
      },
    });
    vi.mocked(window.electronAPI.codePaneGetSemanticTokens).mockResolvedValue({
      success: true,
      data: {
        legend: {
          tokenTypes: ['class', 'method'],
          tokenModifiers: ['declaration'],
        },
        data: [
          0, 0, 5, 0, 0,
          0, 6, 3, 1, 0,
          1, 0, 4, 0, 0,
        ],
      },
    });

    renderCodePane(createPane());
    await openFileFromTree('index.ts', { doubleClick: true });
    await user.click(await screen.findByRole('button', { name: 'codePane.semanticTab' }));

    await waitFor(() => {
      expect(window.electronAPI.codePaneGetSemanticTokens).toHaveBeenCalledWith({
        rootPath: '/workspace/project',
        filePath: '/workspace/project/src/index.ts',
        language: 'typescript',
      });
    });
    expect((await screen.findAllByText('class')).length).toBeGreaterThan(0);
    expect((await screen.findAllByText('method')).length).toBeGreaterThan(0);
    expect(await screen.findByText('codePane.semanticTokensTotal: 3')).toBeInTheDocument();
  });
});
