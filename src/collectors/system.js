'use strict';

const os = require('node:os');
const { version } = require('../../package.json');

/** Local, unverified context about the machine running the CLI. */
function collectSystemInfo() {
  let osUsername = null;
  try {
    osUsername = os.userInfo().username;
  } catch {
    // Some containers have no passwd entry for the current uid.
  }
  return { osUsername, platform: process.platform, cliVersion: version };
}

module.exports = { collectSystemInfo };
