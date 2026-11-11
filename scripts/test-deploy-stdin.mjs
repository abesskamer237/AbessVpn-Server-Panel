import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const workflow = readFileSync(new URL('../.github/workflows/deploy-vps.yml', import.meta.url), 'utf8');
const dump = workflow.split('\n').find(line => line.includes('dc exec ') && line.includes('pg_dump'));
assert(dump, 'The production PostgreSQL backup command must be tested.');
const flags = dump.match(/dc (exec.*?) database pg_dump/)[1].split(/\s+/);
const directory = mkdtempSync(join(tmpdir(), 'abess-deploy-stdin-'));
const composeFile = join(directory, 'compose.yaml');
writeFileSync(composeFile, 'services:\n  api:\n    image: node:22-alpine\n    command: ["sleep", "60"]\n    network_mode: none\n    read_only: true\n    cap_drop: [ALL]\n');
const base = ['compose', '-p', `abess-deploy-stdin-${process.pid}`, '-f', composeFile];
const docker = args => {
  const result = spawnSync('docker', [...base, ...args], { encoding: 'utf8', timeout: 60000 });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
};
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
try {
  docker(['up', '-d']);
  // The flags come from the actual deployment command. Without disabling
  // interactive stdin, Docker consumes SCRIPT_CONTINUED as container input.
  const command = ['docker', ...base, ...flags, 'api', 'node', '-e', 'setTimeout(() => console.log("BACKUP_COMPLETE"), 500)'];
  const result = spawnSync('bash', ['-s'], {
    input: command.map(quote).join(' ') + "\nprintf 'SCRIPT_CONTINUED\\n'\n",
    encoding: 'utf8', timeout: 15000,
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  assert.match(result.stdout, /BACKUP_COMPLETE/);
  assert.match(result.stdout, /SCRIPT_CONTINUED/, 'Docker backup consumed the remaining deployment script.');
  for (const line of workflow.split('\n').filter(line => /(?:dc|docker compose.*?) exec -T/.test(line))) {
    assert(line.includes('--interactive=false'), 'Remote exec must not consume the deployment script: ' + line.trim());
  }
  console.log('Deployment stdin PASS: real Docker backup exec leaves the remaining remote script intact.');
} finally {
  try { docker(['down', '--timeout', '1']); } finally { rmSync(directory, { recursive: true, force: true }); }
}
