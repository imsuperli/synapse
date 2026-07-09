const path = require('node:path')
const { getDefaultConfig } = require('expo/metro-config')

const projectRoot = __dirname
const sharedRoot = path.resolve(projectRoot, '..', 'src', 'shared')
const remoteProtocolRoot = path.resolve(sharedRoot, 'remote')

const config = getDefaultConfig(projectRoot)

// Why: Synapse Mobile consumes the same protocol definitions as desktop.
// Metro only watches mobile/ by default, so make repo-root shared modules visible.
config.watchFolders = Array.from(new Set([...(config.watchFolders ?? []), sharedRoot]))
config.resolver = {
  ...config.resolver,
  extraNodeModules: {
    ...(config.resolver?.extraNodeModules ?? {}),
    '@synapse/remote-protocol': remoteProtocolRoot
  }
}

module.exports = config
