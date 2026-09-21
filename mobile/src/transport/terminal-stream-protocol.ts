export {
  TerminalStreamOpcode,
  decodeTerminalStreamFrame,
  decodeTerminalStreamJson,
  decodeTerminalStreamText,
  encodeTerminalStreamFrame,
  encodeTerminalStreamJson,
  encodeTerminalStreamText,
  iterateTerminalStreamTextPayloads,
  terminalStreamByteLength,
  terminalStreamByteLengthExceeds,
  type TerminalStreamFrame
} from '../../../src/shared/remote/terminal-stream-protocol'
