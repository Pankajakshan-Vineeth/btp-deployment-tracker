'use strict';

const { spawn } = require('node:child_process');

const MAX_CAPTURE_CHARS = 64 * 1024;

/**
 * Runs `command` with an argument array, never through a shell, so paths with spaces
 * or shell metacharacters are passed through literally.
 *
 * Resolves (never rejects) with { code, signal, stdout, stderr, notFound, error }.
 * Captured output keeps only the last 64 KiB. With `echo: true` the output is also
 * streamed live to this process's stdout/stderr.
 */
function run(command, args = [], { cwd, env, echo = false, timeoutMs } = {}) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    const done = (result) => resolve({ stdout, stderr, notFound: false, error: null, ...result });

    let child;
    try {
      child = spawn(command, args, { cwd, env, shell: false, windowsHide: true, timeout: timeoutMs });
    } catch (error) {
      done({ code: null, signal: null, notFound: error.code === 'ENOENT', error });
      return;
    }

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      if (echo) process.stdout.write(chunk);
      stdout = (stdout + chunk).slice(-MAX_CAPTURE_CHARS);
    });
    child.stderr.on('data', (chunk) => {
      if (echo) process.stderr.write(chunk);
      stderr = (stderr + chunk).slice(-MAX_CAPTURE_CHARS);
    });
    child.on('error', (error) => done({ code: null, signal: null, notFound: error.code === 'ENOENT', error }));
    child.on('close', (code, signal) => done({ code, signal }));
  });
}

module.exports = { run };
