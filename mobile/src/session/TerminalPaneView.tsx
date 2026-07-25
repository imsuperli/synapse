import { useCallback } from 'react'
import { StyleSheet, View } from 'react-native'
import {
  TerminalWebView,
  type MobileTerminalTheme,
  type TerminalHistoryMetrics,
  type TerminalKeyboardAvoidanceMetrics,
  type TerminalModes,
  type TerminalWebViewDiagnostic,
  type TerminalWebViewHandle
} from '../terminal/TerminalWebView'
import type { TerminalTextScaleMode } from '../terminal/terminal-webview-messages'

type TerminalPaneViewProps = {
  handle: string
  active: boolean
  keyboardLift: number
  terminalTheme?: MobileTerminalTheme
  textScale: number
  textScaleMode?: TerminalTextScaleMode
  liveInputText?: string
  onRef: (handle: string, ref: TerminalWebViewHandle | null) => void
  onWebReady: (handle: string) => void
  onSelectionMode: (handle: string, active: boolean) => void
  onSelectionCopy: (handle: string, text: string) => void
  onSelectionEvicted: (handle: string) => void
  onModesChanged: (handle: string, modes: TerminalModes) => void
  onKeyboardAvoidanceMetrics: (handle: string, metrics: TerminalKeyboardAvoidanceMetrics) => void
  onHistoryMetrics?: (handle: string, metrics: TerminalHistoryMetrics) => void
  onHaptic: (kind: 'selection' | 'success' | 'error' | 'edge-bump') => void
  onTerminalInput: (handle: string, bytes: string) => void
  onTerminalTap: (handle: string) => void
  onFileTap: (handle: string, pathText: string, line: number | null, column: number | null) => void
  onOpenUrl: (handle: string, url: string) => void
  onTextScaleChange: (scale: number) => void
  onEngineError?: (handle: string, message: string) => void
  onHistoryTopReached?: (handle: string) => void
  onMobileReflowRefreshRequest?: (handle: string) => void
  onDiagnostic?: (handle: string, diagnostic: TerminalWebViewDiagnostic) => void
}

export function TerminalPaneView({
  handle,
  active,
  keyboardLift,
  terminalTheme,
  textScale,
  textScaleMode,
  liveInputText,
  onRef,
  onWebReady,
  onSelectionMode,
  onSelectionCopy,
  onSelectionEvicted,
  onModesChanged,
  onKeyboardAvoidanceMetrics,
  onHistoryMetrics,
  onHaptic,
  onTerminalInput,
  onTerminalTap,
  onFileTap,
  onOpenUrl,
  onTextScaleChange,
  onEngineError,
  onHistoryTopReached,
  onMobileReflowRefreshRequest,
  onDiagnostic
}: TerminalPaneViewProps) {
  const setRef = useCallback(
    (ref: TerminalWebViewHandle | null) => {
      onRef(handle, ref)
    },
    [handle, onRef]
  )

  return (
    <View
      // Why: inactive terminal WebViews stay mounted to preserve xterm state,
      // while touch and visibility are disabled until the tab is active again.
      pointerEvents={active ? 'auto' : 'none'}
      style={[
        styles.terminalPane,
        keyboardLift > 0 && { transform: [{ translateY: -keyboardLift }] },
        !active && styles.terminalPaneHidden
      ]}
    >
      <TerminalWebView
        ref={setRef}
        style={styles.terminalWebView}
        terminalTheme={terminalTheme}
        textScale={textScale}
        textScaleMode={textScaleMode}
        liveInputText={liveInputText}
        onWebReady={() => onWebReady(handle)}
        onSelectionMode={(a) => onSelectionMode(handle, a)}
        onSelectionCopy={(t) => onSelectionCopy(handle, t)}
        onSelectionEvicted={() => onSelectionEvicted(handle)}
        onModesChanged={(m) => onModesChanged(handle, m)}
        onKeyboardAvoidanceMetrics={(m) => onKeyboardAvoidanceMetrics(handle, m)}
        onHistoryMetrics={(m) => onHistoryMetrics?.(handle, m)}
        onHaptic={onHaptic}
        onTerminalInput={(bytes) => onTerminalInput(handle, bytes)}
        onTerminalTap={() => onTerminalTap(handle)}
        onFileTap={(pathText, line, column) => onFileTap(handle, pathText, line, column)}
        onOpenUrl={(url) => onOpenUrl(handle, url)}
        onTextScaleChange={onTextScaleChange}
        onEngineError={(message) => onEngineError?.(handle, message)}
        onHistoryTopReached={() => onHistoryTopReached?.(handle)}
        onMobileReflowRefreshRequest={() => onMobileReflowRefreshRequest?.(handle)}
        onDiagnostic={(diagnostic) => onDiagnostic?.(handle, diagnostic)}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  terminalPane: {
    ...StyleSheet.absoluteFillObject
  },
  terminalPaneHidden: {
    opacity: 0
  },
  terminalWebView: {
    flex: 1
  }
})
