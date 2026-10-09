'use strict';

const cds = require('@sap/cds');

// API_CONTRACT.md puts the ID in the path (POST /api/deployments/{id}/finish), which CAP
// REST actions don't support. Map it onto the finish action; the handler checks that the
// path ID matches the body.
cds.on('bootstrap', (app) => {
  app.post('/api/deployments/:id/finish', (req, _res, next) => {
    req.headers['x-path-deployment-id'] = req.params.id;
    req.url = '/api/deployments/finish';
    next();
  });
});

module.exports = cds.server;
