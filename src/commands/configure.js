'use strict';

const readline = require('node:readline/promises');
const { loadConfig, saveConfig, validateApiUrl } = require('../config/configuration');
const { AUTH_METHODS } = require('../services/auth');
const { CliError } = require('../utils/errors');

/** Interactive `btp-deploy --config`. Asks for no secrets and stores none. */
async function configure({ env = process.env, logger, input = process.stdin, output = process.stdout }) {
  const current = loadConfig(env);
  const rl = readline.createInterface({ input, output });
  const ask = async (question, fallback) =>
    (await rl.question(fallback ? `${question} [${fallback}]: ` : `${question}: `)).trim() || fallback || '';

  try {
    logger.info('Configure the BTP Deployment Tracker backend. No secrets are asked for or stored.\n');
    const apiUrl = validateApiUrl(await ask('Tracking backend URL (https://...)', current.apiUrl));

    logger.info('\nAuthentication methods:');
    logger.info('  env-token  Bearer token read from the BTP_TRACKER_API_TOKEN environment variable');
    logger.info('  command    Bearer token printed by a command you trust (e.g. Azure CLI for Entra ID)');
    logger.info('  none       No authentication (the backend is open)');
    const authMethod = await ask('Authentication method', current.authMethod);
    if (!AUTH_METHODS.includes(authMethod)) throw new CliError(`Unknown authentication method "${authMethod}".`, 2);

    let tokenCommand = null;
    if (authMethod === 'command') {
      logger.info('\nEnter the token command as a JSON array (run without a shell), for example:');
      logger.info('  ["az","account","get-access-token","--resource","api://<app-id>","--query","accessToken","-o","tsv"]');
      const raw = await ask('Token command', current.tokenCommand && JSON.stringify(current.tokenCommand));
      try {
        tokenCommand = JSON.parse(raw);
      } catch {
        tokenCommand = null;
      }
      if (!Array.isArray(tokenCommand) || !tokenCommand.length || !tokenCommand.every((p) => typeof p === 'string')) {
        throw new CliError('The token command must be a non-empty JSON array of strings.', 2);
      }
    }

    const file = saveConfig({ apiUrl, authMethod, tokenCommand }, env);
    logger.info(`\nSaved configuration to ${file}`);
    if (authMethod === 'env-token') {
      logger.info('Set BTP_TRACKER_API_TOKEN in your environment before deploying; it is never written to disk.');
    }
    return 0;
  } finally {
    rl.close();
  }
}

module.exports = { configure };
