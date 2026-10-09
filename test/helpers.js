'use strict';

// Shared test doubles. Nothing here runs a real cf command or contacts a real backend.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SECRET_TOKEN = 'super-secret-token-value-123';
const API_URL = 'https://tracker.example.test';

const CF_TARGET_OUTPUT = `API endpoint:   https://api.cf.eu10.hana.ondemand.com
API version:    3.180.0
user:           deployer@example.com
org:            dev-org
space:          dev-space
`;

function tempDir(prefix = 'btp tracker ') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function makeMtar(dir, name = 'app.mtar', content = 'fake mtar content') {
  const file = path.join(dir, name);
  fs.writeFileSync(file, content);
  return file;
}

function captureLogger() {
  const lines = [];
  const sink = { write: (text) => lines.push(text) };
  const { createLogger } = require('../src/utils/logger');
  return { logger: createLogger({ out: sink, err: sink }), output: () => lines.join('') };
}

/** Fake process runner. `overrides[key]` replaces the result for "cmd arg0". */
function fakeRun(overrides = {}) {
  const calls = [];
  const ok = (stdout = '') => ({ code: 0, signal: null, stdout, stderr: '', notFound: false });
  const defaults = {
    'cf target': ok(CF_TARGET_OUTPUT),
    'cf deploy': ok('Process finished.'),
    'git config': ok('Jane Developer'),
    'git rev-parse': ok('/repo/my-app'),
    'git branch': ok('feature/example'),
    'git status': ok(''),
    'git log': ok('Jane Developer <jane@example.com>'),
  };
  const fn = async (command, args, options) => {
    calls.push({ command, args, options });
    const key = `${command} ${args[0]}`;
    const result = overrides[key] ?? defaults[key];
    if (typeof result === 'function') return result(args);
    return result ?? { code: 1, signal: null, stdout: '', stderr: 'unexpected', notFound: false };
  };
  fn.calls = calls;
  fn.deployCalls = () => calls.filter((c) => c.command === 'cf' && c.args[0] === 'deploy');
  return fn;
}

const notFound = { code: null, signal: null, stdout: '', stderr: '', notFound: true };

/** Fake fetch. `handler(url, init)` returns { status, body } or throws. */
function fakeFetch(handler) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    const { status = 200, body } = await handler(url, init, JSON.parse(init.body));
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  };
  fn.calls = calls;
  return fn;
}

/** A backend that accepts everything and echoes the deployment ID. */
const acceptAll = (url, init, body) => ({ status: 200, body: { deploymentId: body.deploymentId } });

function testEnv(configDir) {
  return {
    BTP_TRACKER_CONFIG_DIR: configDir,
    BTP_TRACKER_API_URL: API_URL,
    BTP_TRACKER_API_TOKEN: SECRET_TOKEN,
    BTP_TRACKER_TIMEOUT_MS: '200',
  };
}

module.exports = {
  SECRET_TOKEN,
  API_URL,
  CF_TARGET_OUTPUT,
  tempDir,
  makeMtar,
  captureLogger,
  fakeRun,
  notFound,
  fakeFetch,
  acceptAll,
  testEnv,
};
