namespace btp.tracker;

/** One manual MTA deployment, written by the start and finish events of the btp-deploy CLI. */
entity Deployments {
  key deploymentId        : UUID;
      status              : String(10); // STARTED | SUCCESS | FAILED
      artifactName        : String(255) not null;
      artifactSizeBytes   : Integer64 not null;
      artifactSha256      : String(64) not null;
      // client-reported and unverified
      osUsername          : String(255);
      gitUsername         : String(255);
      gitEmail            : String(255);
      gitRepository       : String(255);
      gitBranch           : String(255);
      gitCommitSha        : String(64);
      gitDirty            : Boolean;
      gitLastCommitAuthor : String(512);
      cfApiEndpoint       : String(512);
      cfOrganization      : String(255);
      cfSpace             : String(255);
      cfUser              : String(255);
      clientPlatform      : String(20);
      cliVersion          : String(20);
      startedAt          : Timestamp not null;
      receivedAt          : Timestamp not null; // backend clock
      completedAt         : Timestamp;
      durationMs          : Integer64;
      exitCode            : Integer;
      signal              : String(20);
      errorSummary        : String(2000);
}
