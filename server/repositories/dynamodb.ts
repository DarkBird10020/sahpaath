import type { DocumentClient } from "./dynamodb-client";
import type { Repos } from "./types";
import { RepoConditionFailedError } from "./types";
import type {
  Approval,
  AuditEvent,
  CaptionSegment,
  CaptionSession,
  CommunicationPhrase,
  Diagram,
  DiagramVersion,
  Lesson,
  ProcessingJob,
  StudentQuestion,
  User,
  VocabularyTerm,
} from "../../shared/model";

/**
 * DynamoDB adapter implementing the repository contract from
 * docs/DYNAMODB.md. Network is only touched through the injected
 * DocumentClient; unit tests inject a fake (no AWS calls, no credentials).
 * Live behavior is UNVERIFIED until the account gates in
 * docs/AWS_VERIFICATION.md pass.
 */

interface KeyShape {
  pk: string;
  sk: string;
  gpk?: string;
  gsk?: string;
}

const LESSON_PK = (id: string) => `LESSON#${id}`;
const DIAG_PK = (id: string) => `DIAG#${id}`;
const VK = (version: number) => `VERSION#${version}`;

export function createDynamoRepos(client: DocumentClient, table: string): Repos {
  const put = (item: KeyShape & Record<string, unknown>) =>
    client.put({ TableName: table, Item: item });

  return {
    lessons: {
      async put(l, expectedRevision) {
        await client.put({
          TableName: table,
          Item: { ...l, pk: LESSON_PK(l.lessonId), sk: "META", gpk: `TEACHER#${l.teacherId}`, gsk: `LESSON#${l.updatedAt}` },
          // Real DynamoDB rejects ExpressionAttributeNames/values that the
          // condition does not use, so the create path carries no extra keys.
          ...(expectedRevision === null
            ? { ConditionExpression: "attribute_not_exists(pk)" }
            : {
                ConditionExpression: "attribute_exists(pk) AND #rev = :rev",
                ExpressionAttributeNames: { "#rev": "revision" },
                ExpressionAttributeValues: { ":rev": expectedRevision },
              }),
        }).catch(mapConditional("lesson.put"));
      },
      async get(id) {
        const r = await client.get({ TableName: table, Key: { pk: LESSON_PK(id), sk: "META" } });
        return (r.Item as Lesson | undefined) ?? null;
      },
      async listByTeacher(teacherId) {
        const r = await client.query({
          TableName: table,
          IndexName: "gsi1",
          KeyConditionExpression: "gpk = :gpk AND begins_with(gsk, :p)",
          ExpressionAttributeValues: { ":gpk": `TEACHER#${teacherId}`, ":p": "LESSON#" },
          ScanIndexForward: false,
        });
        return (r.Items as Lesson[]) ?? [];
      },
    },
    diagrams: {
      async put(d, expectedRevision) {
        await client.transactWrite({
          TransactItems: [
            {
              Put: {
                TableName: table,
                Item: { ...d, pk: DIAG_PK(d.diagramId), sk: "META" },
                ...(expectedRevision === null
                  ? { ConditionExpression: "attribute_not_exists(pk)" }
                  : {
                      ConditionExpression: "attribute_exists(pk) AND #rev = :rev",
                      ExpressionAttributeNames: { "#rev": "revision" },
                      ExpressionAttributeValues: { ":rev": expectedRevision },
                    }),
              },
            },
            {
              // Lesson->diagram pointer. Content is immutable (same keys, same
              // diagramId), and key attributes always exist on an existing row,
              // so a not-exists condition would reject every legitimate update
              // of the diagram (real DynamoDB rejects it; in-memory fakes did
              // not). Unconditional Put: the row is idempotent by content.
              Put: {
                TableName: table,
                Item: { pk: LESSON_PK(d.lessonId), sk: `DIAG#${d.diagramId}`, diagramId: d.diagramId },
              },
            },
          ],
        }).catch(mapConditional("diagram.put"));
      },
      async get(id) {
        const r = await client.get({ TableName: table, Key: { pk: DIAG_PK(id), sk: "META" } });
        return (r.Item as Diagram | undefined) ?? null;
      },
      async listByLesson(lessonId) {
        const r = await client.query({
          TableName: table,
          KeyConditionExpression: "pk = :pk AND begins_with(sk, :p)",
          ExpressionAttributeValues: { ":pk": LESSON_PK(lessonId), ":p": "DIAG#" },
        });
        const refs = (r.Items as { diagramId: string }[]) ?? [];
        const out: Diagram[] = [];
        for (const ref of refs) {
          const d = await this.get(ref.diagramId);
          if (d) out.push(d);
        }
        return out;
      },
    },
    versions: {
      async create(v) {
        await client.put({
          TableName: table,
          Item: { ...v, pk: DIAG_PK(v.diagramId), sk: VK(v.version) },
          ConditionExpression: "attribute_not_exists(pk) AND attribute_not_exists(sk)",
        }).catch(mapConditional("version.create"));
      },
      async get(diagramId, version) {
        const r = await client.get({ TableName: table, Key: { pk: DIAG_PK(diagramId), sk: VK(version) } });
        return (r.Item as DiagramVersion | undefined) ?? null;
      },
      async list(diagramId) {
        const r = await client.query({
          TableName: table,
          KeyConditionExpression: "pk = :pk AND begins_with(sk, :p)",
          ExpressionAttributeValues: { ":pk": DIAG_PK(diagramId), ":p": "VERSION#" },
        });
        return (r.Items as DiagramVersion[]) ?? [];
      },
      async replaceDraft(v) {
        // Guard: never rewrite a row that is already published.
        await client.put({
          TableName: table,
          Item: { ...v, pk: DIAG_PK(v.diagramId), sk: VK(v.version) },
          ConditionExpression: "attribute_exists(pk) AND #st = :draft",
          ExpressionAttributeNames: { "#st": "status" },
          ExpressionAttributeValues: { ":draft": "draft" },
        }).catch(mapConditional("version.replaceDraft"));
      },
    },
    structure: {
      async putAll(_versionId, diagramId, version, items) {
        await put({
          pk: DIAG_PK(diagramId),
          sk: `VERSION#${version}#STRUCTURE`,
          ...items,
        } as KeyShape & Record<string, unknown>);
      },
      async getAll(diagramId, version) {
        const r = await client.get({ TableName: table, Key: { pk: DIAG_PK(diagramId), sk: `VERSION#${version}#STRUCTURE` } });
        const s = r.Item as
          | { labels?: []; parts?: []; relations?: []; flows?: [] }
          | undefined;
        return {
          labels: s?.labels ?? [],
          parts: s?.parts ?? [],
          relations: s?.relations ?? [],
          flows: s?.flows ?? [],
        };
      },
    },
    approvals: {
      async put(a: Approval) {
        await put({ ...a, pk: `APPROVALS#${a.versionId}`, sk: a.itemId });
      },
      async listByVersion(versionId) {
        const r = await client.query({
          TableName: table,
          KeyConditionExpression: "pk = :pk",
          ExpressionAttributeValues: { ":pk": `APPROVALS#${versionId}` },
        });
        return (r.Items as Approval[]) ?? [];
      },
    },
    vocabulary: {
      async replaceForVersion(lessonId, versionId, terms) {
        if (!terms.length) return;
        await client.transactWrite({
          TransactItems: terms.map((t) => ({
            Put: {
              TableName: table,
              Item: { ...t, pk: LESSON_PK(lessonId), sk: `VOCAB#${versionId}#${t.termId}` },
            },
          })),
        });
      },
      async listForVersion(lessonId, versionId) {
        const r = await client.query({
          TableName: table,
          KeyConditionExpression: "pk = :pk AND begins_with(sk, :p)",
          ExpressionAttributeValues: { ":pk": LESSON_PK(lessonId), ":p": `VOCAB#${versionId}#` },
        });
        return (r.Items as VocabularyTerm[]) ?? [];
      },
    },
    questions: {
      async put(q: StudentQuestion) {
        await put({
          ...q,
          pk: LESSON_PK(q.lessonId),
          sk: `QUESTION#${q.questionId}`,
          gpk: `LESSON#${q.lessonId}`,
          gsk: `QUESTION#${q.createdAt}`,
        });
      },
      async get(questionId) {
        // Exact lesson partition is unknown without the lesson; queries by sk require scan,
        // so the service layer always resolves via listForLesson / put response. Kept for completeness.
        const r = await client.query({
          TableName: table,
          IndexName: "gsi1",
          KeyConditionExpression: "gsk = :gsk",
          ExpressionAttributeValues: { ":gsk": `QUESTION#${questionId}` },
        });
        return ((r.Items as StudentQuestion[]) ?? [])[0] ?? null;
      },
      async listForLesson(lessonId) {
        const r = await client.query({
          TableName: table,
          KeyConditionExpression: "pk = :pk AND begins_with(sk, :p)",
          ExpressionAttributeValues: { ":pk": LESSON_PK(lessonId), ":p": "QUESTION#" },
        });
        return (r.Items as StudentQuestion[]) ?? [];
      },
    },
    phrases: {
      async replaceForLesson(lessonId, list) {
        if (!list.length) return;
        await client.transactWrite({
          TransactItems: list.map((p) => ({
            Put: {
              TableName: table,
              Item: { ...p, pk: LESSON_PK(lessonId), sk: `PHRASE#${p.phraseId}` },
            },
          })),
        });
      },
      async listForLesson(lessonId) {
        const r = await client.query({
          TableName: table,
          KeyConditionExpression: "pk = :pk AND begins_with(sk, :p)",
          ExpressionAttributeValues: { ":pk": LESSON_PK(lessonId), ":p": "PHRASE#" },
        });
        return (r.Items as CommunicationPhrase[]) ?? [];
      },
    },
    captions: {
      async putSession(s: CaptionSession) {
        await put({ ...s, pk: `CAPSESS#${s.sessionId}`, sk: "META" });
        await put({ pk: LESSON_PK(s.lessonId), sk: `CAPSESS#${s.sessionId}`, sessionId: s.sessionId });
      },
      async getSession(id) {
        const r = await client.get({ TableName: table, Key: { pk: `CAPSESS#${id}`, sk: "META" } });
        return (r.Item as CaptionSession | undefined) ?? null;
      },
      async listSessionsForLesson(lessonId) {
        const r = await client.query({
          TableName: table,
          KeyConditionExpression: "pk = :pk AND begins_with(sk, :p)",
          ExpressionAttributeValues: { ":pk": LESSON_PK(lessonId), ":p": "CAPSESS#" },
        });
        const refs = (r.Items as { sessionId: string }[]) ?? [];
        const out: CaptionSession[] = [];
        for (const ref of refs) {
          const s = await this.getSession(ref.sessionId);
          if (s) out.push(s);
        }
        return out;
      },
      async putSegment(seg: CaptionSegment) {
        await put({ ...seg, pk: `CAPSESS#${seg.sessionId}`, sk: `SEG#${seg.index}` });
      },
      async listSegments(sessionId) {
        const r = await client.query({
          TableName: table,
          KeyConditionExpression: "pk = :pk AND begins_with(sk, :p)",
          ExpressionAttributeValues: { ":pk": `CAPSESS#${sessionId}`, ":p": "SEG#" },
        });
        return ((r.Items as CaptionSegment[]) ?? []).sort((a, b) => a.index - b.index);
      },
      async updateSegment(seg, expectedRevision) {
        await client.put({
          TableName: table,
          Item: { ...seg, pk: `CAPSESS#${seg.sessionId}`, sk: `SEG#${seg.index}` },
          ConditionExpression: "#c = :c",
          ExpressionAttributeNames: { "#c": "corrections" },
          ExpressionAttributeValues: { ":c": expectedRevision },
        }).catch(mapConditional("segment.update"));
      },
    },
    jobs: {
      async put(j: ProcessingJob) {
        await put({ ...j, pk: DIAG_PK(j.diagramId), sk: `JOB#${j.jobId}` });
      },
      async get(jobId) {
        const r = await client.query({
          TableName: table,
          IndexName: "gsi1",
          KeyConditionExpression: "gsk = :gsk",
          ExpressionAttributeValues: { ":gsk": `JOB#${jobId}` },
        });
        return ((r.Items as ProcessingJob[]) ?? [])[0] ?? null;
      },
      async update(j, _expectedRevision) {
        await put({ ...j, pk: DIAG_PK(j.diagramId), sk: `JOB#${j.jobId}` });
      },
    },
    audit: {
      async put(e: AuditEvent) {
        await put({ ...e, pk: e.lessonId ? LESSON_PK(e.lessonId) : "_GLOBAL", sk: `AUDIT#${e.createdAt}#${e.eventId}` });
      },
      async listForLesson(lessonId) {
        const r = await client.query({
          TableName: table,
          KeyConditionExpression: "pk = :pk AND begins_with(sk, :p)",
          ExpressionAttributeValues: { ":pk": LESSON_PK(lessonId), ":p": "AUDIT#" },
          ScanIndexForward: false,
        });
        return (r.Items as AuditEvent[]) ?? [];
      },
    },
    users: {
      async put(u: User) {
        await put({ ...u, pk: `USER#${u.userId}`, sk: "PROFILE" });
      },
      async get(id) {
        const r = await client.get({ TableName: table, Key: { pk: `USER#${id}`, sk: "PROFILE" } });
        return (r.Item as User | undefined) ?? null;
      },
    },
    sessions: {
      async put(s: { sessionId: string; userId: string; tokenHash: string; classCode: string; expires: number }) {
        await put({
          ...s,
          pk: `USER#${s.userId}`,
          sk: `SESSION#${s.sessionId}`,
          gpk: `TOKEN#${s.tokenHash}`,
          gsk: `SESSION#${s.sessionId}`,
          ttl: Math.floor(s.expires / 1000),
        });
      },
      async getByTokenHash(tokenHash) {
        const r = await client.query({
          TableName: table,
          IndexName: "gsi1",
          KeyConditionExpression: "gpk = :gpk",
          ExpressionAttributeValues: { ":gpk": `TOKEN#${tokenHash}` },
        });
        const items = (r.Items as { sessionId: string; userId: string; classCode: string; expires: number }[]) ?? [];
        return items[0] ?? null;
      },
      async delete(tokenHash) {
        const s = await this.getByTokenHash(tokenHash);
        if (s) await client.delete({ TableName: table, Key: { pk: `USER#${s.userId}`, sk: `SESSION#${s.sessionId}` } });
      },
    },
    publish: {
      async publish(input) {
        await client.transactWrite({
          TransactItems: [
            {
              // Publish is a CONDITIONAL TRANSITION draft -> published on the
              // existing version row: two racing publishers cannot both pass
              // `#st = :draft`, and a published row is never writable again.
              Put: {
                TableName: table,
                Item: { ...input.version, pk: DIAG_PK(input.diagramId), sk: VK(input.version.version) },
                ConditionExpression: "attribute_exists(pk) AND #st = :draft",
                ExpressionAttributeNames: { "#st": "status" },
                ExpressionAttributeValues: { ":draft": "draft" },
              },
            },
            ...input.approvals.map((a) => ({
              Put: {
                TableName: table,
                Item: { ...a, pk: `APPROVALS#${a.versionId}`, sk: a.itemId },
                ConditionExpression: "attribute_not_exists(pk) AND attribute_not_exists(sk)",
              },
            })),
            {
              Update: {
                TableName: table,
                Key: { pk: DIAG_PK(input.diagramId), sk: "META" },
                UpdateExpression: "SET activeVersionId = :v, processingStatus = :ps, revision = revision + :one",
                ConditionExpression: input.expectedActiveVersionId === null
                  ? "attribute_not_exists(activeVersionId)"
                  : "activeVersionId = :expected",
                ExpressionAttributeValues: input.expectedActiveVersionId === null
                  ? { ":v": input.version.versionId, ":ps": "published", ":one": 1 }
                  : { ":v": input.version.versionId, ":ps": "published", ":one": 1, ":expected": input.expectedActiveVersionId },
              },
            },
            {
              Update: {
                TableName: table,
                Key: { pk: LESSON_PK(input.lessonId), sk: "META" },
                UpdateExpression: "SET #st = :st, publishedVersionId = :pv, updatedAt = :ua, revision = revision + :one",
                ConditionExpression: "#rev = :rev",
                ExpressionAttributeNames: { "#st": "status", "#rev": "revision" },
                ExpressionAttributeValues: {
                  ":st": input.publishedLessonStatus,
                  ":pv": input.publishedVersionId,
                  ":ua": input.lessonUpdatedAt,
                  ":rev": input.expectedLessonRevision,
                  ":one": 1,
                },
              },
            },
          ],
        }).catch(mapConditional("publish"));
      },
    },
  };
}

function mapConditional(operation: string) {
  return (error: unknown): never => {
    const name = (error as { name?: string; __type?: string })?.name ?? (error as { __type?: string })?.__type ?? "";
    if (name.includes("TransactionCanceled") || name.includes("ConditionalCheckFailed"))
      throw new RepoConditionFailedError(operation);
    throw error as Error;
  };
}
