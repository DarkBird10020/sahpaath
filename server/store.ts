import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  lessonSchema,
  publishedSchema,
  captionSchema,
  questionSchema,
  type Lesson,
  type Published,
  type Audit,
  type Question,
  type Caption,
} from "../shared/schema";
import { correctVocabulary, matchCaptionTerms } from "../shared/vocabulary";
import {
  captionSessionSchema,
  segmentSchema,
  type CaptionSession,
  type CaptionSource,
  type Segment,
} from "../shared/schema";
import { evaluate, runSchema } from "../shared/evaluation";
import {
  publishSnapshot,
  revalidate,
  studentSerialize,
} from "../shared/domain";

export class Store {
  readonly db: DatabaseSync;
  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS lessons (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS versions (lesson_id TEXT NOT NULL, version INTEGER NOT NULL, body TEXT NOT NULL, PRIMARY KEY(lesson_id, version));
      CREATE TRIGGER IF NOT EXISTS immutable_versions_update BEFORE UPDATE ON versions BEGIN SELECT RAISE(ABORT, 'Published versions are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_versions_delete BEFORE DELETE ON versions BEGIN SELECT RAISE(ABORT, 'Published versions are immutable'); END;
      CREATE TABLE IF NOT EXISTS audit (id TEXT PRIMARY KEY, lesson_id TEXT, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS questions (id TEXT PRIMARY KEY, lesson_id TEXT NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS captions (id TEXT PRIMARY KEY, lesson_id TEXT NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS evaluation_runs (id TEXT PRIMARY KEY, fixture_id TEXT NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS caption_sessions (id TEXT PRIMARY KEY, lesson_id TEXT NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS caption_segments (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, lesson_id TEXT NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS demo (key TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, role TEXT NOT NULL, code TEXT NOT NULL, expires INTEGER NOT NULL);`);
  }
  list(): Lesson[] {
    return (
      this.db.prepare("SELECT body FROM lessons ORDER BY rowid DESC").all() as {
        body: string;
      }[]
    ).map((r) => lessonSchema.parse(JSON.parse(r.body)));
  }
  get(id: string): Lesson {
    const row = this.db
      .prepare("SELECT body FROM lessons WHERE id=?")
      .get(id) as { body: string } | undefined;
    if (!row) throw new Error("Lesson not found.");
    return lessonSchema.parse(JSON.parse(row.body));
  }
  add(lesson: Lesson) {
    const parsed = lessonSchema.parse(lesson);
    this.db
      .prepare("INSERT INTO lessons VALUES (?, ?, ?)")
      .run(parsed.id, parsed.revision, JSON.stringify(parsed));
    this.audit(parsed.id, "lesson_created", "Created a local draft.");
    return parsed;
  }
  save(lesson: Lesson, expected: number): Lesson {
    const parsed = lessonSchema.parse({
      ...lesson,
      revision: expected + 1,
      updatedAt: new Date().toISOString(),
    });
    const result = this.db
      .prepare(
        "UPDATE lessons SET revision=?, body=? WHERE id=? AND revision=?",
      )
      .run(parsed.revision, JSON.stringify(parsed), parsed.id, expected);
    if (!result.changes)
      throw new Error(
        "This lesson changed in another window. Reload before saving.",
      );
    return parsed;
  }
  publish(id: string, revision: number): Published {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const lesson = this.get(id);
      if (lesson.revision !== revision)
        throw new Error(
          "This lesson changed in another window. Reload before publishing.",
        );
      const snapshot = publishSnapshot(lesson, new Date().toISOString());
      this.db
        .prepare("INSERT INTO versions VALUES (?, ?, ?)")
        .run(id, lesson.version, JSON.stringify(snapshot));
      lesson.status = "published";
      lesson.publishedVersion = lesson.version;
      lesson.stages = lesson.stages.map((s) =>
        s.name === "Publish" || s.name === "Teacher review"
          ? {
              ...s,
              status: "completed",
              detail:
                s.name === "Publish"
                  ? `Immutable version ${lesson.version} saved locally.`
                  : "All content explicitly decided.",
              durationMs: null,
            }
          : s,
      );
      this.save(lesson, revision);
      this.audit(
        id,
        "published",
        `Published immutable version ${lesson.version}.`,
      );
      this.db.exec("COMMIT");
      return snapshot;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  published(id: string, version?: number): Published {
    const row = version
      ? this.db
          .prepare("SELECT body FROM versions WHERE lesson_id=? AND version=?")
          .get(id, version)
      : this.db
          .prepare(
            "SELECT body FROM versions WHERE lesson_id=? ORDER BY version DESC LIMIT 1",
          )
          .get(id);
    if (!row)
      throw new Error(
        "No published version is available yet. Ask your teacher to finish review.",
      );
    return studentSerialize(
      publishedSchema.parse(JSON.parse((row as { body: string }).body)),
    );
  }
  publishedList(): Published[] {
    return this.list()
      .filter((l) => l.publishedVersion !== null)
      .map((l) => this.published(l.id));
  }
  newVersion(id: string, revision: number) {
    const lesson = this.get(id);
    if (lesson.revision !== revision)
      throw new Error("This lesson changed. Reload first.");
    if (lesson.status !== "published")
      throw new Error(
        "Finish the current draft before creating another version.",
      );
    lesson.version++;
    lesson.status = "draft";
    lesson.map = revalidate(lesson.map, true);
    lesson.stages = lesson.stages.map((s) =>
      s.name === "Publish"
        ? {
            ...s,
            status: "locked",
            detail: "Waiting for a new set of decisions.",
          }
        : s.name === "Teacher review"
          ? {
              ...s,
              status: "waiting",
              detail: "New version requires fresh review.",
            }
          : s,
    );
    const saved = this.save(lesson, revision);
    this.audit(
      id,
      "version_created",
      `Created draft version ${lesson.version}; previous publication retained.`,
    );
    return saved;
  }
  audit(
    lessonId: string,
    action: string,
    detail: string,
    actor = "local-teacher",
    approval?: {
      itemId: string;
      decision: "approve" | "reject";
      previousState: string;
      newState: string;
    },
  ) {
    const event: Audit = {
      id: randomUUID(),
      lessonId,
      action,
      detail,
      ...(approval ?? {}),
      actor,
      createdAt: new Date().toISOString(),
    };
    this.db
      .prepare("INSERT INTO audit VALUES (?, ?, ?)")
      .run(event.id, lessonId, JSON.stringify(event));
  }
  events(id: string): Audit[] {
    return this.records("audit", id);
  }
  records<T>(table: "audit" | "questions" | "captions", lessonId: string): T[] {
    return (
      this.db
        .prepare(`SELECT body FROM ${table} WHERE lesson_id=? ORDER BY rowid`)
        .all(lessonId) as { body: string }[]
    ).map((r) => JSON.parse(r.body) as T);
  }
  addRecord(table: "questions" | "captions", record: Question | Caption) {
    this.db
      .prepare(`INSERT INTO ${table} VALUES (?, ?, ?)`)
      .run(record.id, record.lessonId, JSON.stringify(record));
  }
  correctCaption(captionId: string, heard: string, termId: string): Caption {
    const row = this.db
      .prepare("SELECT body FROM captions WHERE id=?")
      .get(captionId) as { body: string } | undefined;
    if (!row) throw new Error("Caption not found.");
    const caption = captionSchema.parse(JSON.parse(row.body));
    const term = this.published(
      caption.lessonId,
      caption.version,
    ).vocabulary.find((t) => t.id === termId);
    if (!term)
      throw new Error(
        "Choose a teacher-approved term from this caption’s lesson version.",
      );
    const next = captionSchema.parse({
      ...caption,
      originalText: caption.originalText ?? caption.text,
      text: correctVocabulary(caption.text, heard, term.name),
      corrections: [
        ...caption.corrections,
        { from: heard, to: term.name, termId },
      ],
    });
    this.db
      .prepare("UPDATE captions SET body=? WHERE id=?")
      .run(JSON.stringify(next), captionId);
    this.audit(
      caption.lessonId,
      "caption_corrected",
      `${heard} corrected to approved term ${term.name}. Original retained.`,
    );
    return next;
  }
  setQuestionStatus(questionId: string, status: "seen" | "answered" | "dismissed") {
    const row = this.db
      .prepare("SELECT body FROM questions WHERE id=?")
      .get(questionId) as { body: string } | undefined;
    if (!row) throw new Error("Question not found.");
    const question = questionSchema.parse({
      ...JSON.parse(row.body),
      status,
    });
    this.db
      .prepare("UPDATE questions SET body=? WHERE id=?")
      .run(JSON.stringify(question), questionId);
    this.audit(
      question.lessonId,
      `question_${status}`,
      `Question from session ${question.sessionCode} marked ${status}.`,
    );
    return question;
  }
  /** One live session per lesson: starting again returns the live one. */
  startCaptionSession(lessonId: string, source: CaptionSource): CaptionSession {
    const live = this.captionSessions(lessonId).find((s) => s.status === "live");
    if (live) return live;
    const published = this.published(lessonId);
    const session = captionSessionSchema.parse({
      id: randomUUID(),
      lessonId,
      version: published.version,
      source,
      status: "live",
      startedAt: new Date().toISOString(),
      endedAt: null,
    });
    this.db
      .prepare("INSERT INTO caption_sessions VALUES (?, ?, ?)")
      .run(session.id, lessonId, JSON.stringify(session));
    this.audit(lessonId, "caption_session_started", `Caption session ${session.id} started (${source}) on version ${published.version}.`);
    return session;
  }
  captionSession(id: string): CaptionSession {
    const row = this.db
      .prepare("SELECT body FROM caption_sessions WHERE id=?")
      .get(id) as { body: string } | undefined;
    if (!row) throw new Error("Caption session not found.");
    return captionSessionSchema.parse(JSON.parse(row.body));
  }
  captionSessions(lessonId: string): CaptionSession[] {
    return (
      this.db
        .prepare("SELECT body FROM caption_sessions WHERE lesson_id=? ORDER BY rowid")
        .all(lessonId) as { body: string }[]
    ).map((r) => captionSessionSchema.parse(JSON.parse(r.body)));
  }
  endCaptionSession(id: string): CaptionSession {
    const session = this.captionSession(id);
    if (session.status === "ended") return session;
    const ended = { ...session, status: "ended" as const, endedAt: new Date().toISOString() };
    this.db
      .prepare("UPDATE caption_sessions SET body=? WHERE id=?")
      .run(JSON.stringify(ended), id);
    this.audit(session.lessonId, "caption_session_ended", `Caption session ${id} ended with ${this.segments(id).length} final segment(s).`);
    return ended;
  }
  /** Stores a final line exactly as heard, with approved-term hits beside it. */
  addSegment(sessionId: string, text: string, startMs?: number, endMs?: number): Segment {
    const session = this.captionSession(sessionId);
    if (session.status !== "live") throw new Error("This caption session has ended. Start a new one.");
    const published = this.published(session.lessonId, session.version);
    const elapsed = Math.max(0, Date.now() - Date.parse(session.startedAt));
    const start = startMs ?? elapsed;
    const segment = segmentSchema.parse({
      id: randomUUID(),
      sessionId,
      lessonId: session.lessonId,
      version: session.version,
      text,
      startMs: start,
      endMs: Math.max(start, endMs ?? elapsed),
      isFinal: true,
      matchedTerms: matchCaptionTerms(text, published.vocabulary),
      createdAt: new Date().toISOString(),
    });
    this.db
      .prepare("INSERT INTO caption_segments VALUES (?, ?, ?, ?)")
      .run(segment.id, sessionId, session.lessonId, JSON.stringify(segment));
    return segment;
  }
  segments(sessionId: string): Segment[] {
    return (
      this.db
        .prepare("SELECT body FROM caption_segments WHERE session_id=? ORDER BY rowid")
        .all(sessionId) as { body: string }[]
    ).map((r) => segmentSchema.parse(JSON.parse(r.body)));
  }
  lessonSegments(lessonId: string, version: number): Segment[] {
    return (
      this.db
        .prepare("SELECT body FROM caption_segments WHERE lesson_id=? ORDER BY rowid")
        .all(lessonId) as { body: string }[]
    )
      .map((r) => segmentSchema.parse(JSON.parse(r.body)))
      .filter((s) => s.version === version);
  }
  demo(): { lessonId: string; initialFindings: number } | null {
    const row = this.db.prepare("SELECT body FROM demo WHERE key='current'").get() as { body: string } | undefined;
    return row ? JSON.parse(row.body) : null;
  }
  setDemo(value: { lessonId: string; initialFindings: number } | null) {
    this.db.prepare("DELETE FROM demo WHERE key='current'").run();
    if (value) this.db.prepare("INSERT INTO demo VALUES ('current', ?)").run(JSON.stringify(value));
  }
  addEvaluationRun(run: unknown) {
    const record = runSchema.parse(run);
    this.db
      .prepare("INSERT INTO evaluation_runs VALUES (?, ?, ?)")
      .run(record.runId, "run", JSON.stringify(record));
  }
  evaluationRuns(): unknown[] {
    return (
      this.db
        .prepare("SELECT body FROM evaluation_runs ORDER BY rowid")
        .all() as { body: string }[]
    ).map((r) => JSON.parse(r.body));
  }
  /** Aggregate summary from recorded actual runs only; null when never measured. */
  evaluationSummary() {
    const metrics = this.evaluationRuns().map((r) => evaluate(r));
    const average = (pick: (m: ReturnType<typeof evaluate>) => number | null) => {
      const values = metrics
        .map(pick)
        .filter((v): v is number => v !== null);
      return values.length
        ? values.reduce((sum, v) => sum + v, 0) / values.length
        : null;
    };
    return {
      runs: metrics.length,
      source: "actual_run" as const,
      labelRecall: average((m) => m.labelRecall),
      relationPrecision: average((m) => m.relationshipPrecision),
      relationRecall: average((m) => m.relationshipRecall),
      flowAccuracy: average((m) => m.flowAccuracy),
      groundingRate: average((m) => m.groundingRate),
      teacherCorrectionRate: average((m) => m.teacherCorrectionRate),
      processingMs: average((m) => m.processingMs),
      captionWordErrorRate: average((m) => m.captionWordErrorRate),
      technicalTermAccuracy: average((m) => m.technicalTermAccuracy),
      timeToPhraseMs: average((m) => m.timeToPhraseMs),
    };
  }
}
