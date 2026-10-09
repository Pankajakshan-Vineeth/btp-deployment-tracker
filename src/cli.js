'use strict';

const { parseArgs } = require('node:util');
const { version } = require('../package.json');
const { deploy } = require('./commands/deploy');
const { configure } = require('./commands/configure');
const { run } = require('./utils/process-runner');
const { createLogger } = require('./utils/logger');
const { CliError } = require('./utils/errors');

const HELP = `Usage: btp-deploy [options] <file.mtar> [-- <extra cf deploy arguments>]

Runs "cf deploy <file.mtar>" and records who deployed what, where and with which
result in the BTP Deployment Tracker backend.

Options:
  --dry-run          Collect and show deployment details; do not deploy or record anything
  --allow-untracked  Deploy even if the start event cannot be recorded (deployment is untracked)
  --config           Configure the tracking backend URL and authentication method
  -h, --help         Show this help
  -v, --version      Show the version

Environment:
  BTP_TRACKER_API_URL      Tracking backend base URL (overrides the config file)
  BTP_TRACKER_API_TOKEN    Bearer token for authentication method "env-token"
  BTP_TRACKER_AUTH_METHOD  env-token | command | none (overrides the config file)
  BTP_TRACKER_TIMEOUT_MS   Backend request timeout in milliseconds (default 15000)

Examples:
  btp-deploy mta_archives/app.mtar
  btp-deploy --dry-run app.mtar
  btp-deploy app.mtar -- -e dev.mtaext

Exit codes: 0 success, 2 invalid input or precondition, 3 tracking unavailable,
otherwise the exit code of cf deploy.`;

async function main(argv, deps = {}) {
  const logger = deps.logger || createLogger();
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
        'dry-run': { type: 'boolean' },
        'allow-untracked': { type: 'boolean' },
        config: { type: 'boolean' },
      },
    });
  } catch (error) {
    logger.error(`${error.message}\nRun "btp-deploy --help" for usage.`);
    return 2;
  }
  const { values, positionals } = parsed;

  if (values.help) {
    logger.info(HELP);
    return 0;
  }
  if (values.version) {
    logger.info(version);
    return 0;
  }

  try {
    if (values.config) return await configure({ env: deps.env, logger });
    const [mtarPath, ...cfArgs] = positionals;
    if (!mtarPath) throw new CliError('Missing MTAR file.\nUsage: btp-deploy [options] <file.mtar>', 2);
    return await deploy(
      { mtarPath, cfArgs, dryRun: Boolean(values['dry-run']), allowUntracked: Boolean(values['allow-untracked']) },
      { run, logger, ...deps },
    );
  } catch (error) {
    if (error instanceof CliError) {
      logger.error(error.message);
      return error.exitCode;
    }
    logger.error(`Unexpected error: ${error.message}`);
    return 1;
  }
}

module.exports = { main, HELP };
