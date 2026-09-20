import type { Repos } from "./types";
import { createMemoryRepos } from "./memory";
import { createSqliteRepos } from "./sqlite";
import { createDynamoRepos } from "./dynamodb";
import type { DocumentClient } from "./dynamodb-client";
import type { AppConfig } from "../core/config";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type { Repos } from "./types";
export { RepoConditionFailedError } from "./types";

export async function createRepos(config: AppConfig, client?: DocumentClient): Promise<Repos> {
  switch (config.store) {
    case "memory":
      return createMemoryRepos();
    case "sqlite":
      return createSqliteRepos(`${config.dataDir}/sahpaath-core.sqlite`);
    case "dynamodb": {
      if (client) return createDynamoRepos(client, config.ddbTable as string);
      const { createAwsDocumentClient } = await import("./dynamodb-client");
      // In containers (no shared-credentials file), always use the task role.
      const awsClient = await createAwsDocumentClient(config.awsRegion as string, config.awsProfile, {
        noProfile: !existsSync(join(homedir(), ".aws", "credentials")),
      });
      return createDynamoRepos(awsClient, config.ddbTable as string);
    }
  }
}
