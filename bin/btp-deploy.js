#!/usr/bin/env node
'use strict';

const { main } = require('../src/cli');

main(process.argv.slice(2)).then((exitCode) => {
  process.exitCode = exitCode;
});
