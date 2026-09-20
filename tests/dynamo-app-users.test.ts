import { expect, it, vi } from "vitest";
import { DynamoAppUsers } from "../server/repositories/app-users";
import type { DocumentClient } from "../server/repositories/dynamodb-client";

function fixture() {
  const records = new Map<string, Record<string, unknown>>();
  const key = (item: Record<string, unknown>) => `${item.pk}/${item.sk}`;
  const client: DocumentClient = {
    get: vi.fn(async input => {
      expect(input.ConsistentRead).toBe(true);
      const value = records.get(key(input.Key));
      return { Item: value && structuredClone(value) };
    }),
    put: vi.fn(), delete: vi.fn(), query: vi.fn(async () => ({ Items: [] })),
    transactWrite: vi.fn(async input => {
      const operations = input.TransactItems as any[];
      for (const op of operations) {
        if (op.Put && records.has(key(op.Put.Item))) throw Object.assign(new Error("duplicate"), { name: "TransactionCanceledException" });
        if (op.Update && !records.has(key(op.Update.Key))) throw Object.assign(new Error("missing"), { name: "TransactionCanceledException" });
      }
      for (const op of operations) {
        if (op.Put) records.set(key(op.Put.Item), structuredClone(op.Put.Item));
        if (op.Update) {
          const value = records.get(key(op.Update.Key))!;
          value.role = op.Update.ExpressionAttributeValues[":role"];
          value.updatedAt = op.Update.ExpressionAttributeValues[":now"];
        }
      }
    }),
  };
  return { client, records, users: new DynamoAppUsers(client, "test-table") };
}
const input = { supabaseUserId: "verified-google-user", email: "learner@example.test", name: "Learner", role: "USER" as const };

it("concurrent Google logins resolve to one durable account", async () => {
  const { users, records } = fixture();
  const [one, two] = await Promise.all([users.createUser(input), users.createUser(input)]);
  expect(one.id).toBe(two.id);
  expect(records.size).toBe(2);
  expect(await users.findUserBySupabaseId(input.supabaseUserId)).toEqual(one);
});

it("migration preserves IDs and never restores a stale role on redeploy", async () => {
  const { users, client } = fixture();
  const old = { ...input, id: "existing-user", role: "ADMIN" as const, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  await users.importUser(old);
  await users.setUserRole(old.id, "USER");
  await users.importUser(old);
  const restarted = new DynamoAppUsers(client, "test-table");
  expect(await restarted.findUserById(old.id)).toMatchObject({ id: old.id, role: "USER" });
  await expect(users.setUserRole("missing", "ADMIN")).rejects.toThrow();
});

it("does not hide AWS failures or silently fall back to local roles", async () => {
  const { users, client } = fixture();
  vi.mocked(client.transactWrite).mockRejectedValueOnce(Object.assign(new Error("permission denied"), { name: "AccessDeniedException" }));
  await expect(users.createUser(input)).rejects.toThrow("permission denied");
});

it("lists every page of accounts", async () => {
  const { users, client } = fixture();
  const user = await users.createUser(input);
  const cursor = { pk: "APPUSERS", sk: "USER#cursor" };
  vi.mocked(client.query).mockResolvedValueOnce({ Items: [user], LastEvaluatedKey: cursor }).mockResolvedValueOnce({ Items: [] });
  expect(await users.listUsers()).toEqual([user]);
  expect(vi.mocked(client.query).mock.calls[1][0].ExclusiveStartKey).toEqual(cursor);
});
