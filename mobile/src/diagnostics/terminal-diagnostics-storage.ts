import AsyncStorage from '@react-native-async-storage/async-storage'
import {
  restoreTerminalDiagnosticBuffer,
  serializeTerminalDiagnosticBuffer,
  type TerminalDiagnosticBuffer
} from './terminal-diagnostics'

const TERMINAL_DIAGNOSTICS_STORAGE_KEY = 'synapse:terminalDiagnostics:v1'

export async function loadTerminalDiagnostics(): Promise<TerminalDiagnosticBuffer> {
  const serialized = await AsyncStorage.getItem(TERMINAL_DIAGNOSTICS_STORAGE_KEY)
  return restoreTerminalDiagnosticBuffer(serialized)
}

export async function saveTerminalDiagnostics(buffer: TerminalDiagnosticBuffer): Promise<void> {
  await AsyncStorage.setItem(
    TERMINAL_DIAGNOSTICS_STORAGE_KEY,
    serializeTerminalDiagnosticBuffer(buffer)
  )
}
