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
 * Deterministic in-memory adapter: same semantics as the DynamoDB design
 * (conditions, immutable versions) with plain Maps. Used by unit tests and
 * available for ephemeral runs via SAHPAATH_STORE=memory.
 */
export function createMemoryRepos(): Repos {
  const lessons = new Map<string, Lesson>();
  const diagrams = new Map<string, Diagram>();
  const versions = new Map<string, DiagramVersion>(); // key: diagramId#version
  const labels = new Map<string, DiagramLabel[]>();
  const parts = new Map<string, DiagramPart[]>();
  const relations = new Map<string, Relationship[]>();
  const flows = new Map<string, ProcessFlow[]>();
  const approvals = new Map<string, Approval[]>();
  const vocabulary = new Map<string, VocabularyTerm[]>();
  const questions = new Map<string, StudentQuestion>();
  const phrases = new Map<string, CommunicationPhrase[]>();
  const captionSessions = new Map<string, CaptionSession>();
  const captionSegments = new Map<string, CaptionSegment[]>();
  const jobs = new Map<string, ProcessingJob>();
  const auditEvents = new Map<string, AuditEvent[]>();
  const users = new Map<string, User>();
  const sessions = new Map<string, { sessionId: string; userId: string; tokenHash: string; classCode: string; expires: number }>();
  const vkey = (diagramId: string, version: number) => `${diagramId}#${version}`;

  const expectRevision = (current: number | undefined, expected: number | null, op: string) => {
    if (expected === null) {
      if (current !== undefined) throw new RepoConditionFailedError(op);
    } else if (current !== expected) throw new RepoConditionFailedError(op);
  };

  return {
    lessons: {
      async put(l, expectedRevision) {
        expectRevision(lessons.get(l.lessonId)?.revision, expectedRevision, "lesson.put");
        lessons.set(l.lessonId, { ...l });
      },
      async get(id) { return lessons.get(id) ?? null; },
      async listByTeacher(teacherId) {
        return [...lessons.values()].filter((l) => l.teacherId === teacherId)
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      },
    },
    diagrams: {
      async put(d, expectedRevision) {
        expectRevision(diagrams.get(d.diagramId)?.revision, expectedRevision, "diagram.put");
        diagrams.set(d.diagramId, { ...d });
      },
      async get(id) { return diagrams.get(id) ?? null; },
      async listByLesson(lessonId) {
        return [...diagrams.values()].filter((d) => d.lessonId === lessonId);
      },
    },
    versions: {
      async create(v) {
        if (versions.has(vkey(v.diagramId, v.version)))
          throw new RepoConditionFailedError("version.create");
        versions.set(vkey(v.diagramId, v.version), { ...v });
      },
      async get(diagramId, version) { return versions.get(vkey(diagramId, version)) ?? null; },
      async list(diagramId) {
        return [...versions.values()].filter((v) => v.diagramId === diagramId)
          .sort((a, b) => a.version - b.version);
      },
      async replaceDraft(v) {
        const existing = versions.get(vkey(v.diagramId, v.version));
        if (!existing) throw new RepoConditionFailedError("version.replaceDraft");
        if (existing.status === "published" || v.status === "published")
          throw new RepoConditionFailedError("version.replaceDraft.published");
        versions.set(vkey(v.diagramId, v.version), { ...v });
      },
    },
    structure: {
      async putAll(_versionId, diagramId, version, items) {
        const k = vkey(diagramId, version);
        labels.set(k, items.labels.map((x) => ({ ...x })));
        parts.set(k, items.parts.map((x) => ({ ...x })));
        relations.set(k, items.relations.map((x) => ({ ...x })));
        flows.set(k, items.flows.map((x) => ({ ...x })));
      },
      async getAll(diagramId, version) {
        const k = vkey(diagramId, version);
        return {
          labels: [...(labels.get(k) ?? [])],
          parts: [...(parts.get(k) ?? [])],
          relations: [...(relations.get(k) ?? [])],
          flows: [...(flows.get(k) ?? [])],
        };
      },
    },
    approvals: {
      async put(a) {
        const list = approvals.get(a.versionId) ?? [];
        if (list.some((x) => x.itemId === a.itemId))
          throw new RepoConditionFailedError("approval.put");
        list.push({ ...a });
        approvals.set(a.versionId, list);
      },
      async listByVersion(versionId) { return [...(approvals.get(versionId) ?? [])]; },
    },
    vocabulary: {
      async replaceForVersion(lessonId, versionId, terms) {
        vocabulary.set(`${lessonId}#${versionId}`, terms.map((t) => ({ ...t })));
      },
      async listForVersion(lessonId, versionId) {
        return [...(vocabulary.get(`${lessonId}#${versionId}`) ?? [])];
      },
    },
    questions: {
      async put(q) {
        if (questions.has(q.questionId)) throw new RepoConditionFailedError("question.put");
        questions.set(q.questionId, { ...q });
      },
      async get(id) { return questions.get(id) ?? null; },
      async listForLesson(lessonId) {
        return [...questions.values()].filter((q) => q.lessonId === lessonId)
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      },
    },
    phrases: {
      async replaceForLesson(lessonId, list) { phrases.set(lessonId, list.map((p) => ({ ...p }))); },
      async listForLesson(lessonId) { return [...(phrases.get(lessonId) ?? [])]; },
    },
    captions: {
      async putSession(s) { captionSessions.set(s.sessionId, { ...s }); },
      async getSession(id) { return captionSessions.get(id) ?? null; },
      async listSessionsForLesson(lessonId) {
        return [...captionSessions.values()].filter((s) => s.lessonId === lessonId);
      },
      async putSegment(seg) {
        const list = captionSegments.get(seg.sessionId) ?? [];
        if (list.some((x) => x.segmentId === seg.segmentId))
          throw new RepoConditionFailedError("segment.put");
        list.push({ ...seg });
        captionSegments.set(seg.sessionId, list);
      },
      async listSegments(sessionId) {
        return [...(captionSegments.get(sessionId) ?? [])].sort((a, b) => a.index - b.index);
      },
      async updateSegment(seg, expectedRevision) {
        const list = captionSegments.get(seg.sessionId) ?? [];
        const idx = list.findIndex((x) => x.segmentId === seg.segmentId);
        if (idx === -1 || list[idx].corrections.length !== expectedRevision)
          throw new RepoConditionFailedError("segment.update");
        list[idx] = { ...seg };
      },
    },
    jobs: {
      async put(j) { jobs.set(j.jobId, { ...j }); },
      async get(id) { return jobs.get(id) ?? null; },
      async update(j, expectedRevision) {
        const current = jobs.get(j.jobId);
        if (!current || current.stages.length !== expectedRevision)
          throw new RepoConditionFailedError("job.update");
        jobs.set(j.jobId, { ...j });
      },
    },
    audit: {
      async put(e) {
        const list = auditEvents.get(e.lessonId ?? "_global") ?? [];
        list.push({ ...e });
        auditEvents.set(e.lessonId ?? "_global", list);
      },
      async listForLesson(lessonId) {
        return [...(auditEvents.get(lessonId) ?? [])]
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      },
    },
    users: {
      async put(u) { users.set(u.userId, { ...u }); },
      async get(id) { return users.get(id) ?? null; },
    },
    sessions: {
      async put(s) { sessions.set(s.tokenHash, { ...s }); },
      async getByTokenHash(tokenHash) {
        const s = sessions.get(tokenHash);
        return s ? { sessionId: s.sessionId, userId: s.userId, classCode: s.classCode, expires: s.expires } : null;
      },
      async delete(tokenHash) { sessions.delete(tokenHash); },
    },
    publish: {
      async publish(input) {
        // Emulates TransactWriteItems with conditions (docs/DYNAMODB.md).
        // The draft row occupies (diagramId, version) already; publishing is a
        // CONDITIONAL TRANSITION draft -> published, guarded by status = draft.
        // A second racing publish sees status published and fails; published
        // rows are then never rewritable (replaceDraft refuses, service gates).
        const row = versions.get(vkey(input.diagramId, input.version.version));
        if (!row) throw new RepoConditionFailedError("publish.version_missing");
        if (row.status !== "draft") throw new RepoConditionFailedError("publish.version_taken");
        const diagram = diagrams.get(input.diagramId);
        if (!diagram) throw new RepoConditionFailedError("publish.diagram_missing");
        if ((diagram.activeVersionId ?? null) !== input.expectedActiveVersionId)
          throw new RepoConditionFailedError("publish.active_version_conflict");
        const lesson = lessons.get(input.lessonId);
        if (!lesson || lesson.revision !== input.expectedLessonRevision)
          throw new RepoConditionFailedError("publish.lesson_revision_conflict");
        // All conditions passed: commit.
        versions.set(vkey(input.diagramId, input.version.version), { ...input.version });
        approvals.set(input.version.versionId, input.approvals.map((a) => ({ ...a })));
        diagrams.set(input.diagramId, {
          ...diagram,
          activeVersionId: input.version.versionId,
          revision: diagram.revision + 1,
        });
        lessons.set(input.lessonId, {
          ...lesson,
          status: input.publishedLessonStatus,
          publishedVersionId: input.publishedVersionId,
          updatedAt: input.lessonUpdatedAt,
          revision: lesson.revision + 1,
        });
      },
    },
  };
}
