import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const expoBinNames =
  process.platform === 'win32' ? ['expo.CMD', 'expo.cmd', 'expo.ps1', 'expo'] : ['expo']

function expoBinPaths(mobileDir) {
  return expoBinNames.map((binName) => path.join(mobileDir, 'node_modules', '.bin', binName))
}

export function getMobileExpoExecutablePath(mobileDir) {
  return expoBinPaths(mobileDir).find((binPath) => existsSync(binPath)) ?? null
}

export function getMobileExpoCliScriptPath(mobileDir) {
  const cliPath = path.join(mobileDir, 'node_modules', 'expo', 'bin', 'cli')
  return existsSync(cliPath) ? cliPath : null
}

function runNpmInstall(mobileDir) {
  const lockfilePath = path.join(mobileDir, 'package-lock.json')
  const args = existsSync(lockfilePath) ? ['ci'] : ['install']
  return new Promise((resolve, reject) => {
    const install = spawn('npm', args, {
      cwd: mobileDir,
      env: process.env,
      shell: process.platform === 'win32',
      stdio: 'inherit'
    })
    install.on('error', reject)
    install.on('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`npm ${args.join(' ')} was terminated by ${signal}`))
      } else if (code === 0) {
        resolve()
      } else {
        reject(new Error(`npm ${args.join(' ')} exited with code ${code}`))
      }
    })
  })
}

export async function ensureMobileExpoCli(mobileDir, logger = {}) {
  if (getMobileExpoCliScriptPath(mobileDir) || getMobileExpoExecutablePath(mobileDir)) {
    return
  }

  const installCommand = existsSync(path.join(mobileDir, 'package-lock.json'))
    ? 'npm ci'
    : 'npm install'
  const message = `Mobile dependencies are missing; running ${installCommand}...`
  if (logger.logStep) {
    logger.logStep('deps', message)
  } else {
    console.log(`[mobile] ${message}`)
  }

  await runNpmInstall(mobileDir)

  if (!getMobileExpoCliScriptPath(mobileDir) && !getMobileExpoExecutablePath(mobileDir)) {
    throw new Error('npm install completed, but the local Expo CLI is still missing.')
  }

  logger.logSuccess?.('Mobile dependencies installed')
}

export async function runMobileExpoCli(mobileDir, args, logger = {}) {
  await ensureMobileExpoCli(mobileDir, logger)

  const cliScript = getMobileExpoCliScriptPath(mobileDir)
  if (!cliScript) {
    const executable = getMobileExpoExecutablePath(mobileDir)
    if (!executable) {
      throw new Error('Local Expo CLI was not found after dependency installation.')
    }
    return runCommand(executable, args, mobileDir)
  }

  return runCommand(process.execPath, [cliScript, ...args], mobileDir)
}

function runCommand(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      shell: false,
      stdio: 'inherit'
    })
    child.on('error', reject)
    child.on('exit', (code, signal) => {
      const commandText = [path.basename(command), ...args].join(' ')
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
