import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OpenSSHProfileImporter } from '../ssh/OpenSSHProfileImporter';

describe('OpenSSHProfileImporter', () => {
  let tempDir: string;
  let sshDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'synapse-openssh-'));
    sshDir = path.join(tempDir, '.ssh');
    await fs.ensureDir(path.join(sshDir, 'conf.d'));
  });

  afterEach(async () => {
    await fs.remove(tempDir);
  });

  it('imports OpenSSH host entries with includes and forwarded ports', async () => {
    await fs.writeFile(path.join(sshDir, 'config'), [
      'Include conf.d/*.conf',
      'Host app',
      '  HostName 10.0.0.21',
      '  User deploy',
      '  Port 2222',
      '  IdentityFile ~/.ssh/id_ed25519',
      '  ServerAliveInterval 15',
      '  ServerAliveCountMax 4',
      '  ConnectTimeout 10',
      '  ForwardAgent yes',
      '  LocalForward 127.0.0.1:15432 10.0.0.31:5432',
      '  DynamicForward 1080',
      '',
    ].join('\n'));
    await fs.writeFile(path.join(sshDir, 'conf.d', 'jump.conf'), [
      'Host bastion',
      '  HostName bastion.example.com',
      '  User ops',
      '',
    ].join('\n'));

    const importer = new OpenSSHProfileImporter({ homeDir: tempDir });
    const profiles = await importer.importProfiles();

    expect(profiles).toHaveLength(2);

    const appProfile = profiles.find((profile) => profile.input.name === 'app (.ssh/config)');
    expect(appProfile).toBeDefined();
    expect(appProfile).toMatchObject({
      id: expect.stringMatching(/^openssh-config:/),
      input: {
        host: '10.0.0.21',
        port: 2222,
        user: 'deploy',
        auth: 'publicKey',
        privateKeys: [path.join(sshDir, 'id_ed25519')],
        keepaliveInterval: 15,
        keepaliveCountMax: 4,
        readyTimeout: 10000,
        agentForward: true,
      },
    });
    expect(appProfile?.input.forwardedPorts).toEqual([
      expect.objectContaining({
        type: 'local',
        host: '127.0.0.1',
        port: 15432,
        targetAddress: '10.0.0.31',
        targetPort: 5432,
      }),
      expect.objectContaining({
        type: 'dynamic',
        host: '127.0.0.1',
        port: 1080,
        targetAddress: 'socks',
        targetPort: 0,
      }),
    ]);
  });

  it('sets the active routing mode for OpenSSH ProxyJump and ProxyCommand entries', async () => {
    await fs.writeFile(path.join(sshDir, 'config'), [
      'Host app',
      '  HostName 10.0.0.21',
      '  ProxyJump bastion',
      '',
      'Host proxy-app',
      '  HostName 10.0.0.31',
      '  ProxyCommand ssh -W %h:%p bastion',
      '',
    ].join('\n'));

    const importer = new OpenSSHProfileImporter({ homeDir: tempDir });
    const profiles = await importer.importProfiles();
    const appProfile = profiles.find((profile) => profile.input.name === 'app (.ssh/config)');
    const proxyProfile = profiles.find((profile) => profile.input.name === 'proxy-app (.ssh/config)');

    expect(appProfile?.input.routingMode).toBe('jumpHost');
    expect(appProfile?.input.jumpHostProfileId).toEqual(expect.stringMatching(/^openssh-config:/));
    expect(proxyProfile?.input.routingMode).toBe('proxyCommand');
    expect(proxyProfile?.input.proxyCommand).toBe('ssh -W %h:%p bastion');
  });

  it('treats OpenSSH ProxyJump none as a direct connection', async () => {
    await fs.writeFile(path.join(sshDir, 'config'), [
      'Host direct-app',
      '  HostName 10.0.0.41',
      '  ProxyJump none',
      '',
    ].join('\n'));

    const importer = new OpenSSHProfileImporter({ homeDir: tempDir });
    const profiles = await importer.importProfiles();
    const directProfile = profiles.find((profile) => profile.input.name === 'direct-app (.ssh/config)');

    expect(directProfile?.input.routingMode).toBeUndefined();
    expect(directProfile?.input.jumpHostProfileId).toBeUndefined();
  });

  it('detects local private keys from ~/.ssh like Tabby', async () => {
    await fs.writeFile(path.join(sshDir, 'id_ed25519'), 'PRIVATE KEY');
    await fs.writeFile(path.join(sshDir, 'id_rsa'), 'PRIVATE KEY');
    await fs.writeFile(path.join(sshDir, 'id_ed25519.pub'), 'PUBLIC KEY');
    await fs.writeFile(path.join(sshDir, 'config'), '');

    const importer = new OpenSSHProfileImporter({ homeDir: tempDir });
    const keys = await importer.detectPrivateKeys();

    expect(keys).toEqual([
      path.join(sshDir, 'id_ed25519'),
      path.join(sshDir, 'id_rsa'),
    ]);
  });
});
