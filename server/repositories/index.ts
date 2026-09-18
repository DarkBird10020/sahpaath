import type { Repos } from "./types";
import { createMemoryRepos } from "./memory";
import { createSqliteRepos } from "./sqlite";
import { createDynamoRepos } from "./dynamodb";
import type { DocumentClient } from "./dynamodb-client";
import type { AppConfig } from "../core/config";

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
      const awsClient = await createAwsDocumentClient(
        config.awsRegion as string,
        config.awsProfile,
      );
      return createDynamoRepos(awsClient, config.ddbTable as string);
    }
  }
}
