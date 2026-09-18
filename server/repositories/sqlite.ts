import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Repos } from "./types";
import { RepoConditionFailedError } from "./types";
import type {
  Approval,
  AuditEvent,
  CaptionSegment,
  CaptionSession,
  CommunicationPhrase,
  Diagram,
  DiagramLabel,
  DiagramPart,
  DiagramVersion,
  Lesson,
  ProcessFlow,
  ProcessingJob,
  Relationship,
  StudentQuestion,
  User,
  VocabularyTerm,
} from "../../shared/model";

/**
 * SQLite adapter (node:sqlite) implementing the same repository contract.
 * Keyed exactly like the DynamoDB design (pk, sk) with JSON bodies, so the
 * table layout and conditional-write semantics transfer to the cloud adapter.
 * Runs conditions inside BEGIN IMMEDIATE transactions to emulate
 * TransactWriteItems; publish is race-safe within one process (local server).
 */
export function createSqliteRepos(path: string): Repos {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;`);
  db.exec(`CREATE TABLE IF NOT EXISTS kv (
      pk TEXT NOT NULL,
      sk TEXT NOT NULL,
      gpk TEXT,
      gsk TEXT,
      body TEXT NOT NULL,
      PRIMARY KEY (pk, sk)
    );
    CREATE INDEX IF NOT EXISTS kv_gsi1 ON kv (gpk, gsk);
    CREATE TABLE IF NOT EXISTS sessions_idx (
      tokenHash TEXT PRIMARY KEY,
      pk TEXT NOT NULL,
      sk TEXT NOT NULL
    );`);

  const put = (pk: string, sk: string, body: unknown, gpk?: string, gsk?: string) =>
    db.prepare("INSERT OR REPLACE INTO kv (pk, sk, gpk, gsk, body) VALUES (?, ?, ?, ?, ?)")
      .run(pk, sk, gpk ?? null, gsk ?? null, JSON.stringify(body));
  const get = <T>(pk: string, sk: string): T | null => {
    const row = db.prepare("SELECT body FROM kv WHERE pk=? AND sk=?").get(pk, sk) as
      | { body: string }
      | undefined;
    return row ? (JSON.parse(row.body) as T) : null;
  };
  const queryPrefix = <T>(pk: string, skPrefix: string): T[] =>
    (db.prepare("SELECT body FROM kv WHERE pk=? AND sk LIKE ? ORDER BY sk").all(
      pk,
      skPrefix.replace(/[%_]/g, (c) => `\\${c}`) + "%",
    ) as { body: string }[]).map((r) => JSON.parse(r.body) as T);
  const vkey = (diagramId: string, version: number) => `VERSION#${version}`;

  /** Emulate TransactWriteItems: all conditions checked, then all writes committed. */
  const tx = (fn: () => void): void => {
    db.exec("BEGIN IMMEDIATE");
    try {
      fn();
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  };

  return {
    lessons: {
      async put(l, expectedRevision) {
        tx(() => {
          const existing = get<Lesson>(`LESSON#${l.lessonId}`, "META");
          if (expectedRevision === null ? existing !== null : existing?.revision !== expectedRevision)
            throw new RepoConditionFailedError("lesson.put");
          put(`LESSON#${l.lessonId}`, "META", l, `TEACHER#${l.teacherId}`, `LESSON#${l.updatedAt}`);
        });
      },
      async get(id) { return get<Lesson>(`LESSON#${id}`, "META"); },
      async listByTeacher(teacherId) {
        return (db.prepare("SELECT body FROM kv WHERE gpk=? AND gsk LIKE 'LESSON#%' ORDER BY gsk DESC")
          .all(`TEACHER#${teacherId}`) as { body: string }[]).map((r) => JSON.parse(r.body) as Lesson);
      },
    },
    diagrams: {
      async put(d, expectedRevision) {
        const existing = get<Diagram>(`DIAG#${d.diagramId}`, "META");
        if (expectedRevision === null ? existing !== null : existing?.revision !== expectedRevision)
          throw new RepoConditionFailedError("diagram.put");
        put(`DIAG#${d.diagramId}`, "META", d);
        put(`LESSON#${d.lessonId}`, `DIAG#${d.diagramId}`, { diagramId: d.diagramId }, undefined, undefined);
      },
      async get(id) { return get<Diagram>(`DIAG#${id}`, "META"); },
      async listByLesson(lessonId) {
        const refs = queryPrefix<{ diagramId: string }>(`LESSON#${lessonId}`, "DIAG#");
        return refs.map((r) => get<Diagram>(`DIAG#${r.diagramId}`, "META")).filter((d): d is Diagram => d !== null);
      },
    },
    versions: {
      async create(v) {
        if (get<DiagramVersion>(`DIAG#${v.diagramId}`, vkey(v.diagramId, v.version)) !== null)
          throw new RepoConditionFailedError("version.create");
        put(`DIAG#${v.diagramId}`, vkey(v.diagramId, v.version), v);
      },
      async get(diagramId, version) { return get<DiagramVersion>(`DIAG#${diagramId}`, vkey(diagramId, version)); },
      async list(diagramId) {
        // STRUCTURE rows also start with VERSION#; version rows carry `status`.
        return (queryPrefix<DiagramVersion>(`DIAG#${diagramId}`, "VERSION#") as Array<DiagramVersion & { status?: string }>)
          .filter((v) => typeof v.status === "string");
      },
      async replaceDraft(v) {
        const existing = get<DiagramVersion>(`DIAG#${v.diagramId}`, vkey(v.diagramId, v.version));
        if (!existing) throw new RepoConditionFailedError("version.replaceDraft");
        if (existing.status === "published" || v.status === "published")
          throw new RepoConditionFailedError("version.replaceDraft.published");
        put(`DIAG#${v.diagramId}`, vkey(v.diagramId, v.version), v);
      },
    },
    structure: {
      async putAll(_versionId, diagramId, version, items) {
        put(`DIAG#${diagramId}`, `VERSION#${version}#STRUCTURE`, items);
      },
      async getAll(diagramId, version) {
        const s = get<{ labels: DiagramLabel[]; parts: DiagramPart[]; relations: Relationship[]; flows: ProcessFlow[] }>(
          `DIAG#${diagramId}`, `VERSION#${version}#STRUCTURE`,
        );
        return s ?? { labels: [], parts: [], relations: [], flows: [] };
      },
    },
    approvals: {
      async put(a) { put(`APPROVALS#${a.versionId}`, a.itemId, a); },
      async listByVersion(versionId) { return queryPrefix<Approval>(`APPROVALS#${versionId}`, ""); },
    },
    vocabulary: {
      async replaceForVersion(lessonId, versionId, terms) {
        tx(() => {
          db.prepare("DELETE FROM kv WHERE pk=? AND sk LIKE 'VOCAB#%'").run(`LESSON#${lessonId}`);
          for (const t of terms) put(`LESSON#${lessonId}`, `VOCAB#${versionId}#${t.termId}`, t);
        });
      },
      async listForVersion(lessonId, versionId) {
        return queryPrefix<VocabularyTerm>(`LESSON#${lessonId}`, `VOCAB#${versionId}#`);
      },
    },
    questions: {
      async put(q) {
        if (get<StudentQuestion>(`LESSON#${q.lessonId}`, `QUESTION#${q.questionId}`) !== null)
          throw new RepoConditionFailedError("question.put");
        put(`LESSON#${q.lessonId}`, `QUESTION#${q.questionId}`, q, `TEACHER#${q.lessonId}`, `QUESTION#${q.createdAt}`);
      },
      async get(questionId) {
        const row = db.prepare("SELECT body FROM kv WHERE sk=?").get(`QUESTION#${questionId}`) as { body: string } | undefined;
        return row ? (JSON.parse(row.body) as StudentQuestion) : null;
      },
      async listForLesson(lessonId) { return queryPrefix<StudentQuestion>(`LESSON#${lessonId}`, "QUESTION#"); },
    },
    phrases: {
      async replaceForLesson(lessonId, list) {
        tx(() => {
          db.prepare("DELETE FROM kv WHERE pk=? AND sk LIKE 'PHRASE#%'").run(`LESSON#${lessonId}`);
          for (const p of list) put(`LESSON#${lessonId}`, `PHRASE#${p.phraseId}`, p);
        });
      },
      async listForLesson(lessonId) { return queryPrefix<CommunicationPhrase>(`LESSON#${lessonId}`, "PHRASE#"); },
    },
    captions: {
      async putSession(s) { put(`CAPSESS#${s.sessionId}`, "META", s); },
      async getSession(id) { return get<CaptionSession>(`CAPSESS#${id}`, "META"); },
      async listSessionsForLesson(lessonId) {
        const refs = queryPrefix<{ sessionId: string }>(`LESSON#${lessonId}`, "CAPSESS#");
        return refs.map((r) => get<CaptionSession>(`CAPSESS#${r.sessionId}`, "META")).filter((s): s is CaptionSession => s !== null);
      },
      async putSegment(seg) {
        if (get<CaptionSegment>(`CAPSESS#${seg.sessionId}`, `SEG#${seg.index}`) !== null)
          throw new RepoConditionFailedError("segment.put");
        put(`CAPSESS#${seg.sessionId}`, `SEG#${seg.index}`, seg);
        put(`LESSON#${seg.lessonId}`, `CAPSESS#${seg.sessionId}`, { sessionId: seg.sessionId });
      },
      async listSegments(sessionId) { return queryPrefix<CaptionSegment>(`CAPSESS#${sessionId}`, "SEG#"); },
      async updateSegment(seg, expectedRevision) {
        const existing = get<CaptionSegment>(`CAPSESS#${seg.sessionId}`, `SEG#${seg.index}`);
        if (!existing || existing.corrections.length !== expectedRevision)
          throw new RepoConditionFailedError("segment.update");
        put(`CAPSESS#${seg.sessionId}`, `SEG#${seg.index}`, seg);
      },
    },
    jobs: {
      async put(j) { put(`DIAG#${j.diagramId}`, `JOB#${j.jobId}`, j); },
      async get(jobId) {
        const row = db.prepare("SELECT body FROM kv WHERE sk=?").get(`JOB#${jobId}`) as { body: string } | undefined;
        return row ? (JSON.parse(row.body) as ProcessingJob) : null;
      },
      async update(j, expectedRevision) {
        const existing = get<ProcessingJob>(`DIAG#${j.diagramId}`, `JOB#${j.jobId}`);
        if (!existing || existing.stages.length !== expectedRevision)
          throw new RepoConditionFailedError("job.update");
        put(`DIAG#${j.diagramId}`, `JOB#${j.jobId}`, j);
      },
    },
    audit: {
      async put(e) {
        const pk = e.lessonId ? `LESSON#${e.lessonId}` : "_GLOBAL";
        put(pk, `AUDIT#${e.createdAt}#${e.eventId}`, e);
      },
      async listForLesson(lessonId) { return queryPrefix<AuditEvent>(`LESSON#${lessonId}`, "AUDIT#"); },
    },
    users: {
      async put(u) { put(`USER#${u.userId}`, "PROFILE", u); },
      async get(id) { return get<User>(`USER#${id}`, "PROFILE"); },
    },
    sessions: {
      async put(s) {
        put(`USER#${s.userId}`, `SESSION#${s.sessionId}`, s);
        db.prepare("INSERT OR REPLACE INTO sessions_idx (tokenHash, pk, sk) VALUES (?, ?, ?)")
          .run(s.tokenHash, `USER#${s.userId}`, `SESSION#${s.sessionId}`);
      },
      async getByTokenHash(tokenHash) {
        const idx = db.prepare("SELECT pk, sk FROM sessions_idx WHERE tokenHash=?").get(tokenHash) as
          | { pk: string; sk: string }
          | undefined;
        return idx ? get<{ sessionId: string; userId: string; tokenHash: string; classCode: string; expires: number }>(idx.pk, idx.sk) : null;
      },
      async delete(tokenHash) {
        const idx = db.prepare("SELECT pk, sk FROM sessions_idx WHERE tokenHash=?").get(tokenHash) as
          | { pk: string; sk: string }
          | undefined;
        if (idx) {
          db.prepare("DELETE FROM kv WHERE pk=? AND sk=?").run(idx.pk, idx.sk);
          db.prepare("DELETE FROM sessions_idx WHERE tokenHash=?").run(tokenHash);
        }
      },
    },
    publish: {
      async publish(input) {
        tx(() => {
          // Publish is a CONDITIONAL TRANSITION draft -> published on the
          // existing version row (guarded by status), not a create.
          const row = get<DiagramVersion>(`DIAG#${input.diagramId}`, vkey(input.diagramId, input.version.version));
          if (!row) throw new RepoConditionFailedError("publish.version_missing");
          if (row.status !== "draft") throw new RepoConditionFailedError("publish.version_taken");
          const diagram = get<Diagram>(`DIAG#${input.diagramId}`, "META");
          if (!diagram || (diagram.activeVersionId ?? null) !== input.expectedActiveVersionId)
            throw new RepoConditionFailedError("publish.active_version_conflict");
          const lesson = get<Lesson>(`LESSON#${input.lessonId}`, "META");
          if (!lesson || lesson.revision !== input.expectedLessonRevision)
            throw new RepoConditionFailedError("publish.lesson_revision_conflict");
          put(`DIAG#${input.diagramId}`, vkey(input.diagramId, input.version.version), input.version);
          for (const a of input.approvals) put(`APPROVALS#${a.versionId}`, a.itemId, a);
          put(`DIAG#${input.diagramId}`, "META", {
            ...diagram,
            activeVersionId: input.version.versionId,
            revision: diagram.revision + 1,
            processingStatus: "published",
          });
          put(`LESSON#${input.lessonId}`, "META", {
            ...lesson,
            status: input.publishedLessonStatus,
            publishedVersionId: input.publishedVersionId,
            updatedAt: input.lessonUpdatedAt,
            revision: lesson.revision + 1,
          });
        });
      },
    },
  };
}
