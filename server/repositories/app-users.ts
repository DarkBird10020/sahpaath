import { randomUUID } from "node:crypto";
import { appUserSchema, type AppUser, type AppRole } from "../../shared/schema";
import type { Store } from "../store";
import type { AppConfig } from "../core/config";
import type { DocumentClient } from "./dynamodb-client";
import { createAwsDocumentClient } from "./dynamodb-client";

export interface AppUsers {
  findUserBySupabaseId(id: string): Promise<AppUser | undefined>;
  findUserById(id: string): Promise<AppUser | undefined>;
  listUsers(): Promise<AppUser[]>;
  createUser(input: Omit<AppUser, "id" | "createdAt" | "updatedAt">): Promise<AppUser>;
  setUserRole(id: string, role: AppRole): Promise<AppUser>;
}

/** Verified identity mappings and authoritative roles; never passwords or tokens. */
export class DynamoAppUsers implements AppUsers {
  constructor(private client: DocumentClient, private table: string) {}
  private key(id: string) { return { pk: "APPUSERS", sk: `USER#${id}` }; }
  async findUserById(id: string) {
    const result = await this.client.get({ TableName: this.table, Key: this.key(id), ConsistentRead: true });
    return result.Item ? appUserSchema.parse(result.Item) : undefined;
  }
  async findUserBySupabaseId(id: string) {
    const result = await this.client.get({ TableName: this.table, Key: { pk: `AUTH#${id}`, sk: "PROFILE" }, ConsistentRead: true });
    return result.Item ? this.findUserById(String(result.Item.userId)) : undefined;
  }
  async listUsers() {
    const users: AppUser[] = [];
    let cursor: Record<string, unknown> | undefined;
    do {
      const result = await this.client.query({ TableName: this.table, KeyConditionExpression: "pk = :pk", ExpressionAttributeValues: { ":pk": "APPUSERS" }, ConsistentRead: true, ExclusiveStartKey: cursor });
      users.push(...(result.Items ?? []).map(item => appUserSchema.parse(item)));
      cursor = result.LastEvaluatedKey;
    } while (cursor);
    return users;
  }
  async importUser(user: AppUser): Promise<AppUser> {
    try {
      await this.client.transactWrite({ TransactItems: [
        { Put: { TableName: this.table, Item: { ...this.key(user.id), ...user }, ConditionExpression: "attribute_not_exists(pk)" } },
        { Put: { TableName: this.table, Item: { pk: `AUTH#${user.supabaseUserId}`, sk: "PROFILE", userId: user.id }, ConditionExpression: "attribute_not_exists(pk)" } },
      ] });
      return user;
    } catch (error) {
      // Concurrent first login/migration must resolve to one identity. Never
      // overwrite a role already changed in DynamoDB with an old SQLite role.
      if ((error as { name?: string }).name !== "TransactionCanceledException") throw error;
      const existing = await this.findUserBySupabaseId(user.supabaseUserId);
      if (!existing) throw error;
      return existing;
    }
  }
  async createUser(input: Omit<AppUser, "id" | "createdAt" | "updatedAt">) {
    const now = new Date().toISOString();
    return this.importUser(appUserSchema.parse({ ...input, id: randomUUID(), createdAt: now, updatedAt: now }));
  }
  async setUserRole(id: string, role: AppRole) {
    await this.client.transactWrite({ TransactItems: [{ Update: {
      TableName: this.table, Key: this.key(id), ConditionExpression: "attribute_exists(pk)",
      UpdateExpression: "SET #role = :role, updatedAt = :now",
      ExpressionAttributeNames: { "#role": "role" },
      ExpressionAttributeValues: { ":role": role, ":now": new Date().toISOString() },
    } }] });
    const user = await this.findUserById(id);
    if (!user) throw new Error("User not found.");
    return user;
  }
}

export async function createAppUsers(config: AppConfig, local: Store): Promise<AppUsers> {
  if (config.store !== "dynamodb") return {
    findUserById: async id => local.findUserById(id),
    findUserBySupabaseId: async id => local.findUserBySupabaseId(id),
    listUsers: async () => local.listUsers(),
    createUser: async input => local.createUser(input),
    setUserRole: async (id, role) => local.setUserRole(id, role),
  };
  const users = new DynamoAppUsers(await createAwsDocumentClient(config.awsRegion!, config.awsProfile), config.ddbTable!);
  // Idempotent migration keeps existing account IDs and admin grants intact.
  for (const user of local.listUsers()) await users.importUser(user);
  return users;
}
