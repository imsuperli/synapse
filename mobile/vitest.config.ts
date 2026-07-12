import { defineConfig } from 'vitest/config'

const tsconfigRaw = JSON.stringify({
  compilerOptions: {
    jsx: 'react-jsx',
    module: 'esnext',
    moduleResolution: 'bundler',
    strict: true,
    target: 'es2022'
  }
})

export default defineConfig({
  root: import.meta.dirname,
  resolve: {
    alias: {
      'react-native': new URL('./test/react-native-stub.ts', import.meta.url).pathname
    }
  },
  esbuild: {
    tsconfigRaw
  },
  optimizeDeps: {
    esbuildOptions: {
      tsconfigRaw
    }
  },
  test: {
    environment: 'node',
    include: [
      'src/synapse/**/*.test.ts',
      'src/transport/host-store.test.ts',
      'src/transport/host-names.test.ts',
      'src/transport/pair-confirm-state.test.ts',
      'src/transport/pairing-connection-attempt.test.ts',
      'src/transport/pairing.test.ts',
      'src/transport/rpc-client.test.ts',
      'src/transport/rpc-client-terminal-*.test.ts',
      'src/transport/rpc-response-shape.test.ts',
      'src/transport/websocket-payload-bytes.test.ts',
      'src/i18n/**/*.test.ts',
      'src/terminal/terminal-text-input-normalization.test.ts',
      'src/terminal/terminal-keyboard-avoidance.test.ts',
      'src/terminal/terminal-webview-engine-error.test.ts',
      'src/terminal/terminal-webview-engine.test.ts',
      'src/terminal/terminal-webview-reflow.test.ts',
      'src/terminal/terminal-webview-scroll-routing.test.ts',
      'src/terminal/terminal-webview-tap-routing.test.ts',
      'src/terminal/terminal-webview-text-zoom.test.ts',
      'src/terminal/terminal-webview-url-tap.test.ts'
    ]
  }
})
