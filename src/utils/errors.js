'use strict';

/** An expected, user-facing failure. `exitCode` becomes the process exit code. */
class CliError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.exitCode = exitCode;
  }
}

module.exports = { CliError };
