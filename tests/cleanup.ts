import { rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

export default function cleanup() {
  const directory = process.env.PANEL_TEST_DATA_DIR;
  if (directory && path.dirname(directory) === tmpdir() && path.basename(directory).startsWith('abess-panel-test-')) {
    rmSync(directory, { recursive: true, force: true });
  }
}
