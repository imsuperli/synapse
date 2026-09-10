import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const buildConfigPath = path.resolve(process.cwd(), 'electron-builder.yml');

describe('macOS build configuration', () => {
  it('declares why Synapse accesses local-network devices', () => {
    const config = fs.readFileSync(buildConfigPath, 'utf8');

    expect(config).toMatch(
      /extendInfo:\n\s+NSLocalNetworkUsageDescription: Synapse needs access to devices on your local network, including SSH servers\./,
    );
  });
});
