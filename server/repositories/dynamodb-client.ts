/**
 * Minimal DocumentClient surface used by the repository adapter, plus the
 * real AWS implementation. Keeping the interface here lets unit tests inject
 * a fake client with zero network/credential usage; the real client is
 * created lazily and only when SAHPAATH_STORE=dynamodb.
 */

export interface PutCommandInput {
  TableName: string;
  Item: Record<string, unknown>;
  ConditionExpression?: string;
  ExpressionAttributeNames?: Record<string, string>;
  ExpressionAttributeValues?: Record<string, unknown>;
}

export interface GetCommandInput {
  TableName: string;
  Key: Record<string, unknown>;
}

export interface QueryCommandInput {
  TableName: string;
  IndexName?: string;
  KeyConditionExpression: string;
  FilterExpression?: string;
  ExpressionAttributeNames?: Record<string, string>;
  ExpressionAttributeValues: Record<string, unknown>;
  ScanIndexForward?: boolean;
}

export interface TransactWriteCommandInput {
  TransactItems: Record<string, unknown>[];
}

export interface QueryResult {
  Items?: Record<string, unknown>[];
}

export interface GetResult {
  Item?: Record<string, unknown>;
}

export interface DocumentClient {
  put(input: PutCommandInput): Promise<unknown>;
  get(input: GetCommandInput): Promise<GetResult>;
  query(input: QueryCommandInput): Promise<QueryResult>;
  delete(input: GetCommandInput): Promise<unknown>;
  transactWrite(input: TransactWriteCommandInput): Promise<unknown>;
}

/** Lazily builds the real AWS SDK v3 document client (no import until called). */
export async function createAwsDocumentClient(
  region: string,
  profile: string | null,
): Promise<DocumentClient> {
  const { DynamoDBClient } = await import("@aws-sdk/client-dynamodb");
  const { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand, DeleteCommand, TransactWriteCommand } =
    await import("@aws-sdk/lib-dynamodb");
  const base = new DynamoDBClient({
    region,
    ...(profile ? {} : {}),
  });
  const doc = DynamoDBDocumentClient.from(base);
  return {
    async put(input) { return doc.send(new PutCommand(input)); },
    async get(input) { return doc.send(new GetCommand(input)); },
    async query(input) { return doc.send(new QueryCommand(input)); },
    async delete(input) { return doc.send(new DeleteCommand(input)); },
    async transactWrite(input) { return doc.send(new TransactWriteCommand(input)); },
  };
}
