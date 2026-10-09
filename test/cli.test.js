'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { main } = require('../src/cli');
const { run } = require('../src/utils/process-runner');
const { redact } = require('../src/utils/logger');
const { version } = require('../package.json');
const { captureLogger, fakeRun } = require('./helpers');

async function cli(argv) {
  const { logger, output } = captureLogger();
  const fake = fakeRun();
  const exitCode = await main(argv, { logger, run: fake, env: {} });
  return { exitCode, output: output(), fake };
}

test('--help prints usage', async () => {
  const { exitCode, output } = await cli(['--help']);
  assert.equal(exitCode, 0);
  assert.match(output, /Usage: btp-deploy/);
});

test('--version prints the package version', async () => {
  const { exitCode, output } = await cli(['--version']);
  assert.equal(exitCode, 0);
  assert.equal(output.trim(), version);
});

test('missing MTAR argument exits with code 2', async () => {
  const { exitCode, output } = await cli([]);
  assert.equal(exitCode, 2);
  assert.match(output, /Missing MTAR file/);
});

test('unknown options exit with code 2 without running anything', async () => {
  const { exitCode, output, fake } = await cli(['--force', 'app.mtar']);
  assert.equal(exitCode, 2);
  assert.match(output, /Unknown option/);
  assert.equal(fake.calls.length, 0);
});

test('bin script runs --version as a real process', () => {
  const out = execFileSync(process.execPath, [path.join(__dirname, '..', 'bin', 'btp-deploy.js'), '--version']);
  assert.equal(out.toString().trim(), version);
});

test('process runner passes arguments with spaces and metacharacters literally', async () => {
  const tricky = 'my app & "quoted" $(whoami).mtar';
  const result = await run(process.execPath, ['-e', 'process.stdout.write(process.argv[1])', tricky]);
  assert.equal(result.code, 0);
  assert.equal(result.stdout, tricky);
});

test('process runner preserves non-zero exit codes', async () => {
  const result = await run(process.execPath, ['-e', 'process.exit(42)']);
  assert.equal(result.code, 42);
});

test('process runner reports missing commands', async () => {
  const result = await run('definitely-not-a-real-command-btp', []);
  assert.equal(result.notFound, true);
});

test('redact removes bearer tokens, JWTs, secrets and URL credentials', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl';
  const text = redact(
    `Authorization: Bearer abc123\nBearer xyz789\naccess_token=tok1&x=1\n"password": "hunter2"\n${jwt}\nhttps://u:p@host/x`,
  );
  for (const secret of ['abc123', 'xyz789', 'tok1', 'hunter2', jwt, 'u:p@']) {
    assert.ok(!text.includes(secret), `leaked ${secret}: ${text}`);
  }
  assert.match(text, /https:\/\/\[REDACTED\]@host\/x/);
});
