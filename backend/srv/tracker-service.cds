using { btp.tracker as db } from '../db/schema';

// No authentication by decision: anyone who can reach the URL can read and write records.

/** Write API used by the CLI. See ../../API_CONTRACT.md. */
@path: '/api/deployments'
@protocol: 'rest'
service TrackerService {
  type Ack {
    deploymentId : UUID;
    status       : String;
  }

  // @open: accept (and ignore) fields from newer CLI versions, as API_CONTRACT.md requires.
  @open
  action start(
    deploymentId        : UUID,
    artifactName        : String,
    artifactSizeBytes   : Integer64,
    artifactSha256      : String,
    osUsername          : String,
    gitUsername         : String,
    gitEmail            : String,
    gitRepository       : String,
    gitBranch           : String,
    gitCommitSha        : String,
    gitDirty            : Boolean,
    gitLastCommitAuthor : String,
    cfApiEndpoint       : String,
    cfOrganization      : String,
    cfSpace             : String,
    cfUser              : String,
    clientPlatform      : String,
    cliVersion          : String,
    startedAt           : String
  ) returns Ack;

  // Called as POST /api/deployments/{deploymentId}/finish; server.js maps that path here.
  @open
  action finish(
    deploymentId : UUID,
    status       : String,
    exitCode     : Integer,
    completedAt  : String,
    durationMs   : Integer64,
    signal       : String,
    errorSummary : String
  ) returns Ack;
}

/** Read-only access to the records, used by app/index.html. */
@path: '/odata/v4/deployments'
service ReportService {
  @readonly entity Deployments as projection on db.Deployments;
}
