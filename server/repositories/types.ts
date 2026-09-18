import type {
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
  Approval,
} from "../../shared/model";

/**
 * Repository contract (see docs/DYNAMODB.md for the key strategy).
 * Every adapter — memory, sqlite, dynamodb — implements exactly this.
 *
 * Two hard invariants any implementation MUST keep:
 *  1. Published DiagramVersion rows are immutable: create succeeds once,
 *     further creates conflict; updates/deletes are never exposed.
 *  2. Publish is race-safe: createVersion + markDiagramPublished must be
 *     atomic with conditions so two racing publishers cannot both succeed.
 */

export class RepoConditionFailedError extends Error {
  constructor(readonly operation: string) {
    super(`Conditional write failed: ${operation}`);
    this.name = "RepoConditionFailedError";
  }
}

export interface LessonRepo {
  put(lesson: Lesson, expectedRevision: number | null): Promise<void>;
  get(lessonId: string): Promise<Lesson | null>;
  listByTeacher(teacherId: string): Promise<Lesson[]>;
}

export interface DiagramRepo {
  put(diagram: Diagram, expectedRevision: number | null): Promise<void>;
  get(diagramId: string): Promise<Diagram | null>;
  listByLesson(lessonId: string): Promise<Diagram[]>;
}

export interface VersionRepo {
  /** Creates the version row; fails when (diagramId, version) already exists. */
  create(version: DiagramVersion): Promise<void>;
  get(diagramId: string, version: number): Promise<DiagramVersion | null>;
  list(diagramId: string): Promise<DiagramVersion[]>;
  /** Rewrites a DRAFT version in place; must refuse when status is published. */
  replaceDraft(version: DiagramVersion): Promise<void>;
}

/** Structure items (parts/relations/flows/labels) of one version. */
export interface StructureRepo {
  putAll(
    versionId: string,
    diagramId: string,
    version: number,
    items: {
      labels: DiagramLabel[];
      parts: DiagramPart[];
      relations: Relationship[];
      flows: ProcessFlow[];
    },
  ): Promise<void>;
  getAll(diagramId: string, version: number): Promise<{
    labels: DiagramLabel[];
    parts: DiagramPart[];
    relations: Relationship[];
    flows: ProcessFlow[];
  }>;
}

export interface ApprovalRepo {
  put(approval: Approval): Promise<void>;
  listByVersion(versionId: string): Promise<Approval[]>;
}

export interface VocabularyRepo {
  replaceForVersion(lessonId: string, versionId: string, terms: VocabularyTerm[]): Promise<void>;
  listForVersion(lessonId: string, versionId: string): Promise<VocabularyTerm[]>;
}

export interface QuestionRepo {
  /** Fails when questionId already exists (idempotency guard). */
  put(question: StudentQuestion): Promise<void>;
  get(questionId: string): Promise<StudentQuestion | null>;
  listForLesson(lessonId: string): Promise<StudentQuestion[]>;
}

export interface PhraseRepo {
  replaceForLesson(lessonId: string, phrases: CommunicationPhrase[]): Promise<void>;
  listForLesson(lessonId: string): Promise<CommunicationPhrase[]>;
}

export interface CaptionRepo {
  putSession(session: CaptionSession): Promise<void>;
  getSession(sessionId: string): Promise<CaptionSession | null>;
  listSessionsForLesson(lessonId: string): Promise<CaptionSession[]>;
  putSegment(segment: CaptionSegment): Promise<void>;
  listSegments(sessionId: string): Promise<CaptionSegment[]>;
  updateSegment(segment: CaptionSegment, expectedRevision: number): Promise<void>;
}

export interface JobRepo {
  put(job: ProcessingJob): Promise<void>;
  get(jobId: string): Promise<ProcessingJob | null>;
  update(job: ProcessingJob, expectedRevision: number): Promise<void>;
}

export interface AuditRepo {
  put(event: AuditEvent): Promise<void>;
  listForLesson(lessonId: string): Promise<AuditEvent[]>;
}

export interface UserRepo {
  put(user: User): Promise<void>;
  get(userId: string): Promise<User | null>;
}

export interface SessionRepo {
  put(session: { sessionId: string; userId: string; tokenHash: string; classCode: string; expires: number }): Promise<void>;
  getByTokenHash(tokenHash: string): Promise<{ sessionId: string; userId: string; classCode: string; expires: number } | null>;
  delete(tokenHash: string): Promise<void>;
}

/** Publish transaction: all-or-nothing version creation + pointer flip. */
export interface PublishTransaction {
  /**
   * Atomically:
   *  - put version row (condition: not exists)
   *  - put approvals (condition: not exists)
   *  - update diagram.activeVersionId (condition: current value matches expected)
   *  - update lesson status/publishedVersionId (condition: revision matches)
   * Throws RepoConditionFailedError when any condition fails; nothing is written.
   */
  publish(input: {
    version: DiagramVersion;
    approvals: Approval[];
    diagramId: string;
    expectedActiveVersionId: string | null;
    lessonId: string;
    expectedLessonRevision: number;
    publishedLessonStatus: "published";
    publishedVersionId: string;
    lessonUpdatedAt: string;
  }): Promise<void>;
}

export interface Repos {
  lessons: LessonRepo;
  diagrams: DiagramRepo;
  versions: VersionRepo;
  structure: StructureRepo;
  approvals: ApprovalRepo;
  vocabulary: VocabularyRepo;
  questions: QuestionRepo;
  phrases: PhraseRepo;
  captions: CaptionRepo;
  jobs: JobRepo;
  audit: AuditRepo;
  users: UserRepo;
  sessions: SessionRepo;
  publish: PublishTransaction;
}
