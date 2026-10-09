'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { main } = require('../src/cli');
const { listPending } = require('../src/services/pending-queue');
const {
  SECRET_TOKEN,
  tempDir,
  makeMtar,
  captureLogger,
  fakeRun,
  notFound,
  fakeFetch,
  acceptAll,
  testEnv,
} = require('./helpers');

/** Runs the CLI with mocked cf, git and backend. */
async function runCli(argv, { run = fakeRun(), fetchImpl = fakeFetch(acceptAll), env, cwd } = {}) {
  const dir = cwd || tempDir();
  if (!cwd) makeMtar(dir);
  const { logger, output } = captureLogger();
  const exitCode = await main(argv, { run, fetchImpl, logger, env: env || testEnv(tempDir('btp config ')), cwd: dir });
  return { exitCode, output: output(), run, fetchImpl };
}

test('successful deployment records start and finish', async () => {
  const { exitCode, output, run, fetchImpl } = await runCli(['app.mtar']);
  assert.equal(exitCode, 0);
  assert.equal(run.deployCalls().length, 1);

  const [start, finish] = fetchImpl.calls;
  assert.match(start.url, /\/api\/deployments\/start$/);
  assert.equal(start.body.artifactName, 'app.mtar');
  assert.match(start.body.artifactSha256, /^[0-9a-f]{64}$/);
  assert.equal(start.body.cfOrganization, 'dev-org');
  assert.equal(start.body.cfSpace, 'dev-space');
  assert.equal(start.body.cfUser, 'deployer@example.com');
  assert.equal(start.body.gitBranch, 'feature/example');
  assert.equal(start.body.gitDirty, false);
  assert.ok(Date.parse(start.body.startedAt));

  assert.equal(finish.url, `https://tracker.example.test/api/deployments/${start.body.deploymentId}/finish`);
  assert.equal(finish.body.status, 'SUCCESS');
  assert.equal(finish.body.exitCode, 0);
  assert.equal(typeof finish.body.durationMs, 'number');
  assert.equal(finish.body.errorSummary, undefined);

  assert.match(output, /Deployment successful/);
  assert.match(output, /Status: SUCCESS/);
  assert.match(output, new RegExp(`Deployment ID: ${start.body.deploymentId}`));
});

test('failed deployment preserves the cf exit code and records a redacted error summary', async () => {
  const run = fakeRun({
    'cf deploy': { code: 7, signal: null, stdout: '', stderr: `Error: upload failed\nAuthorization: Bearer ${SECRET_TOKEN}\n` },
  });
  const { exitCode, output, fetchImpl } = await runCli(['app.mtar'], { run });
  assert.equal(exitCode, 7);
  const finish = fetchImpl.calls[1].body;
  assert.equal(finish.status, 'FAILED');
  assert.equal(finish.exitCode, 7);
  assert.match(finish.errorSummary, /upload failed/);
  assert.doesNotMatch(finish.errorSummary, new RegExp(SECRET_TOKEN));
  assert.match(output, /Deployment failed/);
  assert.match(output, /Exit code: 7/);
});

test('a deployment killed by a signal is recorded as FAILED with a non-zero exit code', async () => {
  const run = fakeRun({ 'cf deploy': { code: null, signal: 'SIGTERM', stdout: '', stderr: '' } });
  const { exitCode, fetchImpl } = await runCli(['app.mtar'], { run });
  assert.equal(exitCode, 1);
  assert.equal(fetchImpl.calls[1].body.status, 'FAILED');
  assert.equal(fetchImpl.calls[1].body.signal, 'SIGTERM');
});

test('start-event failure stops before deploying', async () => {
  const fetchImpl = fakeFetch(() => ({ status: 503, body: 'unavailable' }));
  const { exitCode, output, run } = await runCli(['app.mtar'], { fetchImpl });
  assert.equal(exitCode, 3);
  assert.equal(run.deployCalls().length, 0);
  assert.match(output, /HTTP 503/);
  assert.match(output, /cf deploy was NOT started/);
});

test('missing backend configuration stops before deploying', async () => {
  const env = testEnv(tempDir());
  delete env.BTP_TRACKER_API_URL;
  const { exitCode, output, run } = await runCli(['app.mtar'], { env });
  assert.equal(exitCode, 3);
  assert.equal(run.deployCalls().length, 0);
  assert.match(output, /no backend URL configured/);
});

test('--allow-untracked deploys when the start event fails', async () => {
  const fetchImpl = fakeFetch(() => ({ status: 503, body: 'unavailable' }));
  const { exitCode, output, run } = await runCli(['--allow-untracked', 'app.mtar'], { fetchImpl });
  assert.equal(exitCode, 0);
  assert.equal(run.deployCalls().length, 1);
  assert.equal(fetchImpl.calls.length, 1); // no finish event for an untracked deployment
  assert.match(output, /NOT recorded/);
});

test('finish-event failure queues the result and the next run retries it', async () => {
  const configDir = tempDir('btp config ');
  const env = testEnv(configDir);
  const failFinish = fakeFetch((url, init, body) =>
    url.endsWith('/finish') ? { status: 500, body: 'boom' } : acceptAll(url, init, body),
  );

  const first = await runCli(['app.mtar'], { env, fetchImpl: failFinish });
  assert.equal(first.exitCode, 0); // the deployment itself succeeded
  assert.match(first.output, /will be retried/);
  const pending = listPending(env);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].event.result.status, 'SUCCESS');
  assert.doesNotMatch(fs.readFileSync(pending[0].file, 'utf8'), new RegExp(SECRET_TOKEN));
  if (process.platform !== 'win32') assert.equal(fs.statSync(pending[0].file).mode & 0o777, 0o600);

  const second = await runCli(['app.mtar'], { env });
  const urls = second.fetchImpl.calls.map((c) => c.url);
  assert.ok(urls[0].endsWith(`/api/deployments/${pending[0].event.deploymentId}/finish`));
  assert.equal(listPending(env).length, 0);
  assert.match(second.output, /Recorded the pending result/);
});

test('pending results are never sent to a different backend', async () => {
  const configDir = tempDir('btp config ');
  const env = testEnv(configDir);
  const failFinish = fakeFetch((url, init, body) => (url.endsWith('/finish') ? { status: 500 } : acceptAll(url, init, body)));
  await runCli(['app.mtar'], { env, fetchImpl: failFinish });

  const other = { ...env, BTP_TRACKER_API_URL: 'https://other.example.test' };
  const { fetchImpl } = await runCli(['app.mtar'], { env: other });
  assert.ok(fetchImpl.calls.every((c) => c.url.startsWith('https://other.example.test')));
  assert.ok(fetchImpl.calls.every((c) => !c.url.includes(listPending(env)[0].event.deploymentId)));
});

test('dry run collects metadata without deploying or contacting the backend', async () => {
  const { exitCode, output, run, fetchImpl } = await runCli(['--dry-run', 'app.mtar']);
  assert.equal(exitCode, 0);
  assert.equal(run.deployCalls().length, 0);
  assert.equal(fetchImpl.calls.length, 0);
  assert.match(output, /Dry run: would execute: cf deploy/);
  assert.match(output, /Organization: dev-org/);
  assert.doesNotMatch(output, /Deployment successful/);
});

test('paths with spaces are passed to cf as a single argument', async () => {
  const dir = tempDir('dir with spaces ');
  const file = makeMtar(dir, 'my app.mtar');
  const { exitCode, run } = await runCli(['my app.mtar', '--', '-e', 'dev ext.mtaext'], { cwd: dir });
  assert.equal(exitCode, 0);
  assert.deepEqual(run.deployCalls()[0].args, ['deploy', file, '-e', 'dev ext.mtaext']);
});

test('dirty working tree is reported', async () => {
  const run = fakeRun({ 'git status': { code: 0, stdout: ' M app.js\n' } });
  const { output, fetchImpl } = await runCli(['app.mtar'], { run });
  assert.equal(fetchImpl.calls[0].body.gitDirty, true);
  assert.match(output, /uncommitted changes present/);
});

test('deployment proceeds with null Git fields when Git is unavailable', async () => {
  const run = fakeRun({ 'git config': notFound, 'git rev-parse': notFound });
  const { exitCode, fetchImpl } = await runCli(['app.mtar'], { run });
  assert.equal(exitCode, 0);
  assert.equal(fetchImpl.calls[0].body.gitCommitSha, null);
  assert.equal(fetchImpl.calls[0].body.gitUsername, null);
});

test('missing cf CLI exits with installation guidance', async () => {
  const run = fakeRun({ 'cf target': notFound });
  const { exitCode, output, fetchImpl } = await runCli(['app.mtar'], { run });
  assert.equal(exitCode, 2);
  assert.match(output, /cf CLI v8\+/);
  assert.equal(fetchImpl.calls.length, 0);
});

test('logged-out cf CLI stops before contacting the backend', async () => {
  const run = fakeRun({ 'cf target': { code: 1, stdout: 'Not logged in.', stderr: '' } });
  const { exitCode, output, fetchImpl } = await runCli(['app.mtar'], { run });
  assert.equal(exitCode, 2);
  assert.match(output, /cf login/);
  assert.equal(fetchImpl.calls.length, 0);
});

test('invalid MTAR path exits with code 2 and no side effects', async () => {
  const { exitCode, output, run, fetchImpl } = await runCli(['missing.mtar']);
  assert.equal(exitCode, 2);
  assert.match(output, /MTAR file not found/);
  assert.equal(run.calls.length, 0);
  assert.equal(fetchImpl.calls.length, 0);
});

test('the token never appears in CLI output, even on backend errors', async () => {
  const fetchImpl = fakeFetch(() => ({ status: 401, body: { error: { message: `invalid token=${SECRET_TOKEN}` } } }));
  const { output } = await runCli(['app.mtar'], { fetchImpl });
  assert.match(output, /HTTP 401/);
  assert.doesNotMatch(output, new RegExp(SECRET_TOKEN));
});

test('the start record contains no credentials', async () => {
  const { fetchImpl } = await runCli(['app.mtar']);
  assert.doesNotMatch(JSON.stringify(fetchImpl.calls.map((c) => c.body)), new RegExp(SECRET_TOKEN));
});

test('config file is used when no environment override is set', async () => {
  const configDir = tempDir('btp config ');
  fs.writeFileSync(
    path.join(configDir, 'config.json'),
    JSON.stringify({ apiUrl: 'https://from-file.example.test', authMethod: 'env-token' }),
  );
  const env = { BTP_TRACKER_CONFIG_DIR: configDir, BTP_TRACKER_API_TOKEN: SECRET_TOKEN };
  const { exitCode, fetchImpl } = await runCli(['app.mtar'], { env });
  assert.equal(exitCode, 0);
  assert.ok(fetchImpl.calls[0].url.startsWith('https://from-file.example.test/'));
});
