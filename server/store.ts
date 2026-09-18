import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  lessonSchema,
  publishedSchema,
  captionSchema,
  type Lesson,
  type Published,
  type Audit,
  type Question,
  type Caption,
} from "../shared/schema";
import { correctVocabulary } from "../shared/vocabulary";
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
  ) {
    const event: Audit = {
      id: randomUUID(),
      lessonId,
      action,
      detail,
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
  acknowledge(id: string) {
    const row = this.db
      .prepare("SELECT body FROM questions WHERE id=?")
      .get(id) as { body: string } | undefined;
    if (!row) throw new Error("Question not found.");
    const question = JSON.parse(row.body) as Question;
    question.acknowledged = true;
    this.db
      .prepare("UPDATE questions SET body=? WHERE id=?")
      .run(JSON.stringify(question), id);
  }
}
