import {
  type CaptionSegment,
  type CaptionSession,
  type CommunicationPhrase,
  type DiagramVersion,
  type StudentQuestion,
} from "../../shared/model";
import type { Repos } from "../repositories/types";
import { RepoConditionFailedError } from "../repositories/types";
import { conflictError, forbiddenError, notFoundError, validationError } from "../core/errors";
import type { Logger } from "../core/logger";
import { newClassCode, newId, newSessionToken, sha256Hex } from "../core/ids";
import { nowIso } from "./clock";
import { correctVocabulary } from "../../shared/vocabulary";
import type { Actor } from "./lesson-service";

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const FIXED_PHRASES = [
  "I have a question",
  "Please repeat",
  "I don't understand this step",
  "I need more time",
  "Can I answer?",
] as const;

/**
 * Classroom service: anonymous student sessions, contextual questions,
 * loaded-transcript captions with approved-vocabulary correction, and the
 * fixed fast phrases. Student identity = anonymous session id ONLY.
 */
export class ClassroomService {
  constructor(
    private readonly repos: Repos,
    private readonly log: Logger,
  ) {}

  /* ------------------------------ Sessions ------------------------------- */

  async createTeacherSession(password: string, passwordHash: string): Promise<{ token: string; classCode: string; userId: string }> {
    if (sha256Hex(password) !== passwordHash)
      throw forbiddenError("Incorrect teacher password.");
    return this.createSession("teacher", "teacher-local");
  }

  async createStudentSession(): Promise<{ token: string; classCode: string; userId: string }> {
    return this.createSession("student", `student-${newId()}`);
  }

  private async createSession(role: "teacher" | "student", userId: string) {
    const token = newSessionToken();
    const classCode = newClassCode();
    await this.repos.sessions.put({
      sessionId: newId(),
      userId,
      tokenHash: sha256Hex(token),
      classCode,
      expires: Date.now() + SESSION_TTL_MS,
    });
    this.log.info("session.created", { role });
    return { token, classCode, userId };
  }

  async resolveSession(token: string | undefined): Promise<{ userId: string; role: "teacher" | "student"; classCode: string } | null> {
    if (!token) return null;
    const record = await this.repos.sessions.getByTokenHash(sha256Hex(token));
    if (!record || record.expires < Date.now()) return null;
    const role = record.userId.startsWith("student-") ? ("student" as const) : ("teacher" as const);
    return { userId: record.userId, role, classCode: record.classCode };
  }

  /**
   * Local bridge: accept a session issued by the legacy local store so the
   * existing frontend can call v1 routes with the same cookie. Tokens are
   * accepted ONLY as hashed values; no raw token is ever stored or logged.
   */
  async acceptLegacySession(token: string | undefined): Promise<{ userId: string; role: "teacher" | "student"; classCode: string } | null> {
    return this.resolveSession(token);
  }

  async destroySession(token: string): Promise<void> {
    await this.repos.sessions.delete(sha256Hex(token));
  }

  /* ------------------------------ Questions ------------------------------- */

  async askQuestion(
    actor: Actor,
    input: { lessonId: string; versionId: string; conceptPartId: string | null; text: string },
  ): Promise<StudentQuestion> {
    // The version must exist, be published, and belong to the lesson.
    const lesson = await this.repos.lessons.get(input.lessonId);
    if (!lesson) throw notFoundError("Lesson not found.");
    if (lesson.status !== "published" || !lesson.publishedVersionId)
      throw conflictError("Questions attach to a published lesson version.");
    const question: StudentQuestion = {
      questionId: newId(),
      lessonId: input.lessonId,
      versionId: lesson.publishedVersionId,
      studentSessionId: actor.userId,
      conceptPartId: input.conceptPartId,
      text: input.text,
      acknowledged: false,
      acknowledgedAt: null,
      createdAt: nowIso(),
    };
    try {
      await this.repos.questions.put(question);
    } catch (error) {
      if (error instanceof RepoConditionFailedError)
        throw conflictError("This question was already submitted.");
      throw error;
    }
    this.log.info("question.created", { lessonId: input.lessonId, conceptPartId: input.conceptPartId });
    return question;
  }

  async listQuestions(teacher: Actor, lessonId: string): Promise<StudentQuestion[]> {
    const lesson = await this.repos.lessons.get(lessonId);
    if (!lesson) throw notFoundError("Lesson not found.");
    if (teacher.role !== "teacher" || teacher.userId !== lesson.teacherId)
      throw forbiddenError("Only the lesson's teacher can read the inbox.");
    return this.repos.questions.listForLesson(lessonId);
  }

  async acknowledgeQuestion(teacher: Actor, questionId: string): Promise<void> {
    const question = await this.repos.questions.get(questionId);
    if (!question) throw notFoundError("Question not found.");
    const lesson = await this.repos.lessons.get(question.lessonId);
    if (!lesson || teacher.role !== "teacher" || teacher.userId !== lesson.teacherId)
      throw forbiddenError("Only the lesson's teacher can acknowledge questions.");
    if (question.acknowledged) return;
    await this.repos.questions.put({
      ...question,
      acknowledged: true,
      acknowledgedAt: nowIso(),
    });
  }

  /* ------------------------------- Captions -------------------------------- */

  async startCaptionSession(
    teacher: Actor,
    input: { lessonId: string; mode: CaptionSession["mode"] },
  ): Promise<CaptionSession> {
    const lesson = await this.repos.lessons.get(input.lessonId);
    if (!lesson) throw notFoundError("Lesson not found.");
    if (teacher.role !== "teacher" || teacher.userId !== lesson.teacherId)
      throw forbiddenError("Only the lesson's teacher can start caption sessions.");
    if (!lesson.publishedVersionId)
      throw conflictError("Captions attach to a published lesson version.");
    const session: CaptionSession = {
      sessionId: newId(),
      lessonId: input.lessonId,
      versionId: lesson.publishedVersionId,
      mode: input.mode,
      startedAt: nowIso(),
      revision: 0,
    };
    await this.repos.captions.putSession(session);
    return session;
  }

  async addSegment(
    teacher: Actor,
    input: { sessionId: string; text: string },
  ): Promise<CaptionSegment> {
    const session = await this.repos.captions.getSession(input.sessionId);
    if (!session) throw notFoundError("Caption session not found.");
    const lesson = await this.repos.lessons.get(session.lessonId);
    if (!lesson || teacher.role !== "teacher" || teacher.userId !== lesson.teacherId)
      throw forbiddenError("Only the lesson's teacher can add captions.");
    const existing = await this.repos.captions.listSegments(session.sessionId);
    const segment: CaptionSegment = {
      segmentId: newId(),
      sessionId: session.sessionId,
      lessonId: session.lessonId,
      index: existing.length,
      text: input.text,
      corrections: [],
      createdAt: nowIso(),
    };
    await this.repos.captions.putSegment(segment);
    return segment;
  }

  async listSegments(requestor: Actor, sessionId: string): Promise<CaptionSegment[]> {
    const session = await this.repos.captions.getSession(sessionId);
    if (!session) throw notFoundError("Caption session not found.");
    return this.repos.captions.listSegments(sessionId);
  }

  /** Teacher corrects a caption using an approved vocabulary term; original retained. */
  async correctSegment(
    teacher: Actor,
    input: { sessionId: string; segmentId: string; heard: string; termPartId: string },
  ): Promise<CaptionSegment> {
    const session = await this.repos.captions.getSession(input.sessionId);
    if (!session) throw notFoundError("Caption session not found.");
    const lesson = await this.repos.lessons.get(session.lessonId);
    if (!lesson || teacher.role !== "teacher" || teacher.userId !== lesson.teacherId)
      throw forbiddenError("Only the lesson's teacher can correct captions.");
    const segments = await this.repos.captions.listSegments(session.sessionId);
    const segment = segments.find((s) => s.segmentId === input.segmentId);
    if (!segment) throw notFoundError("Caption segment not found.");
    const terms = await this.repos.vocabulary.listForVersion(session.lessonId, session.versionId);
    const term = terms.find((t) => t.partId === input.termPartId);
    if (!term)
      throw validationError("Choose a teacher-approved term from this caption's lesson version.");
    let text: string;
    try {
      text = correctVocabulary(segment.text, input.heard, term.name);
    } catch {
      throw validationError("That phrase was not found as a complete term in this passage.");
    }
    const next: CaptionSegment = {
      ...segment,
      originalText: segment.originalText ?? segment.text,
      text,
      corrections: [...segment.corrections, { from: input.heard, to: term.name, termId: term.termId }],
    };
    await this.repos.captions.updateSegment(next, segment.corrections.length);
    await this.repos.audit.put({
      eventId: newId(),
      lessonId: session.lessonId,
      actorId: teacher.userId,
      actorRole: "teacher",
      action: "caption_corrected",
      detail: `${input.heard} corrected to approved term ${term.name}. Original retained.`,
      createdAt: nowIso(),
    });
    return next;
  }

  /* ------------------------------- Phrases -------------------------------- */

  async ensurePhrases(lessonId: string): Promise<CommunicationPhrase[]> {
    const existing = await this.repos.phrases.listForLesson(lessonId);
    if (existing.length) return existing;
    const phrases: CommunicationPhrase[] = FIXED_PHRASES.map((text, i) => ({
      phraseId: newId(),
      lessonId,
      text,
      conceptPartId: null,
      sortOrder: i,
    }));
    await this.repos.phrases.replaceForLesson(lessonId, phrases);
    return phrases;
  }
}
