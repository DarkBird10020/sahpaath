import { z } from "zod";

/**
 * Structured proposal contract for the DiagramSense pipeline.
 *
 * This is the ONLY shape the multimodal model is allowed to emit. It is
 * parsed and validated before anything becomes domain entities — the model
 * never writes parts/relations/flows directly ("AI proposes, code decides").
 *
 * Grounding rule: every proposed part MUST reference an OCR label id that
 * exists in the Textract result for this image. The validator rejects any
 * reference to an unknown label, so the model cannot invent content.
 */

/** Arbitrary token the model may use for its own part ids; remapped locally. */
const proposedId = z.string().min(1).max(80);

export const proposedPartSchema = z
  .object({
    id: proposedId,
    name: z.string().trim().min(1).max(120),
    /** MUST match an OCR label id supplied in the prompt. */
    ocrLabelId: z.string().min(1).max(80),
    description: z.string().trim().min(1).max(2000),
    descriptionShort: z.string().trim().min(1).max(400).optional(),
    descriptionDetailed: z.string().trim().min(1).max(4000).optional(),
  })
  .strict();

export const proposedRelationshipSchema = z
  .object({
    sourcePartId: proposedId,
    targetPartId: proposedId,
    relationType: z.enum(["flows_to", "connects_to", "supports"]),
    /** OCR label ids that ground this relationship (usually the endpoints'). */
    evidence: z.array(z.string().min(1).max(80)).max(30),
  })
  .strict();

export const proposedFlowSchema = z
  .object({
    /** 1-based reading order across the proposed process. */
    order: z.number().int().positive(),
    partId: proposedId,
  })
  .strict();

export const diagramProposalSchema = z
  .object({
    parts: z.array(proposedPartSchema).min(1).max(60),
    relationships: z.array(proposedRelationshipSchema).max(120),
    processFlow: z.array(proposedFlowSchema).max(60),
  })
  .strict();

export type ProposedPart = z.infer<typeof proposedPartSchema>;
export type ProposedRelationship = z.infer<typeof proposedRelationshipSchema>;
export type ProposedFlowStep = z.infer<typeof proposedFlowSchema>;
export type DiagramProposal = z.infer<typeof diagramProposalSchema>;

/**
 * OCR label list handed to the model AND used for grounding checks.
 * Coordinates stay normalized 0..1 (origin = top-left) regardless of the
 * OCR provider's native units (Textract returns bounding boxes in 0..1
 * fractions already; normalization keeps that guarantee explicit).
 */
export const ocrLabelSchema = z
  .object({
    labelId: z.string().min(1).max(80),
    text: z.string().trim().min(1).max(120),
    /** 0..100. */
    confidence: z.number().min(0).max(100),
    /** Normalized center of the text bounding box, 0..1, top-left origin. */
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
  })
  .strict();

export type OcrLabel = z.infer<typeof ocrLabelSchema>;
