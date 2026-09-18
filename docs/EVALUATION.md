# Evaluation

No AWS OCR, model, or live-caption accuracy run has been performed. The evaluation screen displays **Not measured yet.** for every unmeasured quantity. Test fixture assertions are software tests, not empirical educational accuracy results.

`npm run evaluate` runs `scripts/evaluate.ts`. With no run file it emits nulls. An optional JSON file must satisfy `runSchema` in `shared/evaluation.ts`, including `source: actual_run`, run ID and timestamp. The marker is a provenance declaration, not proof that supplied data is genuine. Retain original inputs, raw outputs and timing logs when collecting a real run.

Metrics:

- Label recall: intersection of expected and observed label sets / expected count.
- Relationship precision and recall: exact encoded relationship-set overlap / observed and expected counts respectively.
- Flow accuracy: matching positions / expected flow length.
- Grounding rate and correction rate: supplied grounded/corrected counts / proposed count.
- Processing latency: measured processing milliseconds supplied by the run.
- Caption WER: word-level Levenshtein distance / reference word count after documented normalization in the scorer.
- Technical-term accuracy: expected terms found in the transcript / expected term count.
- Time to phrase: supplied send timestamp minus interaction start timestamp.

Missing inputs and zero denominators return null. Scores are not silently populated from demo fixtures. Unit tests exercise arithmetic on explicit test data only.

Five self-authored demonstration maps are provided: heart pathway, water cycle, plant water movement, electrical circuit, and water pump. The prompt's phrase “roughly 510” is interpreted as the intended small 5–10 sample range; 510 independently reviewed diagrams have not been supplied. The expected graph structures are deterministic fixtures. They have **not** been independently hand-verified by a subject teacher or accessibility expert. Before any public accuracy claim, obtain that review, fix the reference set, define matching tolerances, and run the actual provider pipeline.
