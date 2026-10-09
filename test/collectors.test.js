'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { inspectArtifact, sha256File } = require('../src/collectors/artifact');
const { collectGitInfo } = require('../src/collectors/git');
const { collectCfInfo, parseCfTarget } = require('../src/collectors/cloud-foundry');
const { tempDir, makeMtar, fakeRun, notFound, CF_TARGET_OUTPUT } = require('./helpers');

test('inspectArtifact accepts an existing .mtar, including paths with spaces', () => {
  const dir = tempDir();
  const file = makeMtar(dir, 'my app v1.mtar', 'abc');
  const artifact = inspectArtifact('my app v1.mtar', dir);
  assert.equal(artifact.path, file);
  assert.equal(artifact.name, 'my app v1.mtar');
  assert.equal(artifact.sizeBytes, 3);
});

test('inspectArtifact rejects missing files, directories and other extensions', () => {
  const dir = tempDir();
  fs.mkdirSync(path.join(dir, 'folder.mtar'));
  makeMtar(dir, 'app.zip');
  assert.throws(() => inspectArtifact('missing.mtar', dir), { exitCode: 2, message: /not found/ });
  assert.throws(() => inspectArtifact('folder.mtar', dir), { exitCode: 2, message: /Not a file/ });
  assert.throws(() => inspectArtifact('app.zip', dir), { exitCode: 2, message: /Expected an \.mtar/ });
});

test('sha256File hashes the file contents', async () => {
  const file = makeMtar(tempDir(), 'app.mtar', 'hello');
  assert.equal(await sha256File(file), createHash('sha256').update('hello').digest('hex'));
});

test('collectGitInfo returns nulls when git is not installed', async () => {
  const info = await collectGitInfo({ run: async () => notFound, cwd: '.' });
  assert.deepEqual(Object.values(info), Object.values(info).map(() => null));
});

test('collectGitInfo keeps the git identity outside a repository', async () => {
  const run = fakeRun({ 'git rev-parse': { code: 128, stdout: '', stderr: 'not a git repository' } });
  const info = await collectGitInfo({ run, cwd: '.' });
  assert.equal(info.userName, 'Jane Developer');
  assert.equal(info.commitSha, null);
  assert.equal(info.dirty, null);
});

test('collectGitInfo detects a dirty working tree', async () => {
  const run = fakeRun({ 'git status': { code: 0, stdout: ' M src/app.js\n' } });
  const info = await collectGitInfo({ run, cwd: '.' });
  assert.equal(info.dirty, true);
  assert.equal(info.repositoryName, 'my-app');
  assert.equal(info.branch, 'feature/example');
});

test('collectGitInfo reports a clean tree', async () => {
  const info = await collectGitInfo({ run: fakeRun(), cwd: '.' });
  assert.equal(info.dirty, false);
});

test('parseCfTarget reads endpoint, user, org and space', () => {
  assert.deepEqual(parseCfTarget(CF_TARGET_OUTPUT), {
    apiEndpoint: 'https://api.cf.eu10.hana.ondemand.com',
    user: 'deployer@example.com',
    org: 'dev-org',
    space: 'dev-space',
  });
});

test('parseCfTarget treats "No space targeted" as missing', () => {
  const out = "API endpoint: https://api.example\nuser: a@b.c\norg: o\nspace: No space targeted, use 'cf target -s SPACE'\n";
  assert.equal(parseCfTarget(out).space, null);
});

test('collectCfInfo reports a missing cf CLI', async () => {
  const info = await collectCfInfo({ run: async () => notFound });
  assert.equal(info.installed, false);
});

test('collectCfInfo reports a logged-out cf CLI', async () => {
  const run = fakeRun({ 'cf target': { code: 1, stdout: "API endpoint: https://api.example\nNot logged in. Use 'cf login'.", stderr: '' } });
  const info = await collectCfInfo({ run });
  assert.equal(info.installed, true);
  assert.equal(info.loggedIn, false);
});
