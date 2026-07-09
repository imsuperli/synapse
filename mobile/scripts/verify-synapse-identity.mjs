#!/usr/bin/env node

import fs from 'node:fs'
import crypto from 'node:crypto'
import path from 'node:path'
import process from 'node:process'

const mobileRoot = path.resolve(import.meta.dirname, '..')

const forbiddenPatterns = [
  /\bOrca\b/,
  /\borca\b/,
  /com\.stably/,
  /@orca\//,
  /orca:\/\//
]

const scannedPaths = [
  'app',
  'app.json',
  'fastlane',
  'metro.config.js',
  'package-lock.json',
  'package.json',
  'scripts/prepare-android-release.mjs',
  'src/synapse',
  'src/theme',
  'src/transport',
  'tsconfig.json'
]

const ignoredFiles = new Set([
  'src/transport/pairing.test.ts'
])

const requiredAppConfig = {
  name: 'Synapse Mobile',
  scheme: 'synapse',
  androidPackage: 'com.lchpersonal.synapse.mobile',
  iosBundleIdentifier: 'com.lchpersonal.synapse.mobile'
}

const requiredAssetHashes = {
  'assets/icon.png': '7f1dd035c4bbb3ec5fc2a26e7e69382c26758d2f52cea88de7f02a282da0d081',
  'assets/adaptive-icon.png': '7f1dd035c4bbb3ec5fc2a26e7e69382c26758d2f52cea88de7f02a282da0d081',
  'assets/splash-icon.png': '74e61b217fc2e3a76e350ef57085c89891421f2325dd905331e37525d4bcdc0c',
  'assets/favicon.png': 'befef86c836ec1e4960024ce853f09096c42bcf0698c7250229c83e823aba1ab'
}

function walk(relativePath) {
  const absolutePath = path.join(mobileRoot, relativePath)
  if (!fs.existsSync(absolutePath)) {
    return []
  }
  const stat = fs.statSync(absolutePath)
  if (stat.isDirectory()) {
    return fs.readdirSync(absolutePath).flatMap((entry) => walk(path.join(relativePath, entry)))
  }
  return [relativePath]
}

function isTextFile(relativePath) {
  return /\.(cjs|js|json|mjs|ts|tsx|txt|md|yml|yaml)$/.test(relativePath)
}

const failures = []

for (const relativePath of scannedPaths.flatMap(walk)) {
  if (ignoredFiles.has(relativePath) || !isTextFile(relativePath)) {
    continue
  }
  const content = fs.readFileSync(path.join(mobileRoot, relativePath), 'utf8')
  for (const pattern of forbiddenPatterns) {
    if (pattern.test(content)) {
      failures.push(`${relativePath}: matched ${pattern}`)
    }
  }
}

const appJson = JSON.parse(fs.readFileSync(path.join(mobileRoot, 'app.json'), 'utf8'))
const expo = appJson.expo ?? {}
if (expo.name !== requiredAppConfig.name) {
  failures.push(`app.json: expo.name must be ${requiredAppConfig.name}`)
}
if (expo.scheme !== requiredAppConfig.scheme) {
  failures.push(`app.json: expo.scheme must be ${requiredAppConfig.scheme}`)
}
if (expo.android?.package !== requiredAppConfig.androidPackage) {
  failures.push(`app.json: expo.android.package must be ${requiredAppConfig.androidPackage}`)
}
if (expo.ios?.bundleIdentifier !== requiredAppConfig.iosBundleIdentifier) {
  failures.push(
    `app.json: expo.ios.bundleIdentifier must be ${requiredAppConfig.iosBundleIdentifier}`
  )
}

for (const [relativePath, expectedHash] of Object.entries(requiredAssetHashes)) {
  const absolutePath = path.join(mobileRoot, relativePath)
  if (!fs.existsSync(absolutePath)) {
    failures.push(`${relativePath}: missing Synapse asset`)
    continue
  }
  const actualHash = crypto.createHash('sha256').update(fs.readFileSync(absolutePath)).digest('hex')
  if (actualHash !== expectedHash) {
    failures.push(`${relativePath}: asset hash does not match the approved Synapse asset`)
  }
}

if (failures.length > 0) {
  console.error('Synapse Mobile identity verification failed:')
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log('Synapse Mobile identity verification passed')
