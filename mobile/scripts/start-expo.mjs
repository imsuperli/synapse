#!/usr/bin/env node

import path from 'node:path'
import process from 'node:process'
import { runMobileExpoCli } from './mobile-expo-cli.mjs'

const scriptDir = import.meta.dirname
const mobileDir = path.resolve(scriptDir, '..')

async function main() {
  await runMobileExpoCli(mobileDir, ['start', ...process.argv.slice(2)])
}

main().catch((error) => {
  console.error(`[mobile] ${error.message}`)
  process.exit(1)
})
