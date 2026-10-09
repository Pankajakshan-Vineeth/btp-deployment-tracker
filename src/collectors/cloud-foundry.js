'use strict';

const CF_MISSING_MESSAGE = [
  'The Cloud Foundry CLI ("cf") was not found on PATH.',
  'Install cf CLI v8+: https://docs.cloudfoundry.org/cf-cli/install-go-cli.html',
  'Then install the MultiApps plugin that provides "cf deploy": cf install-plugin multiapps',
  'and log in with "cf login".',
].join('\n');

/** Parses the human-readable output of `cf target`. Missing fields are null. */
function parseCfTarget(output) {
  const field = (label) => {
    const match = output.match(new RegExp(`^\\s*${label}:\\s*(.+?)\\s*$`, 'im'));
    // e.g. "space: No space targeted, use 'cf target -s SPACE'"
    return match && !/^no .* targeted/i.test(match[1]) ? match[1] : null;
  };
  return { apiEndpoint: field('API endpoint'), user: field('user'), org: field('org'), space: field('space') };
}

/** Read-only: runs `cf target`, which never prints tokens. */
async function collectCfInfo({ run }) {
  const result = await run('cf', ['target']);
  if (result.notFound) {
    return { installed: false, loggedIn: false, apiEndpoint: null, user: null, org: null, space: null };
  }
  const target = parseCfTarget(result.stdout);
  return { installed: true, loggedIn: result.code === 0 && Boolean(target.user), ...target };
}

module.exports = { collectCfInfo, parseCfTarget, CF_MISSING_MESSAGE };
