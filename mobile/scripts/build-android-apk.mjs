#!/usr/bin/env node

import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { runMobileExpoCli } from './mobile-expo-cli.mjs'

const mobileDir = path.resolve(import.meta.dirname, '..')
const androidDir = path.join(mobileDir, 'android')
const artifactsDir = path.join(mobileDir, 'dist', 'android')

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? mobileDir,
      env: process.env,
      shell: options.shell ?? (process.platform === 'win32'),
      stdio: 'inherit'
    })
    child.on('error', reject)
    child.on('exit', (code, signal) => {
      const commandText = [command, ...args].join(' ')
      if (signal) {
        reject(new Error(`${commandText} was terminated by ${signal}`))
      } else if (code === 0) {
        resolve()
      } else {
        reject(new Error(`${commandText} exited with code ${code}`))
      }
    })
  })
}

async function copyApk() {
  const source = path.join(androidDir, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk')
  const target = path.join(artifactsDir, 'synapse-mobile-android.apk')
  await fs.mkdir(artifactsDir, { recursive: true })
  await fs.copyFile(source, target)
  return target
}

async function main() {
  await runMobileExpoCli(mobileDir, ['prebuild', '--platform', 'android', '--no-install', '--clean'])

  const gradleCommand =
    process.platform === 'win32' ? path.join(androidDir, 'gradlew.bat') : './gradlew'
  await runCommand(gradleCommand, ['--no-daemon', 'assembleRelease'], { cwd: androidDir })

  const apkPath = await copyApk()
  console.log(`[mobile] Android APK written to ${path.relative(mobileDir, apkPath)}`)
}

main().catch((error) => {
  console.error(`[mobile] ${error.message}`)
  process.exit(1)
})
