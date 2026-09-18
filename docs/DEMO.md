# Guided demo

Teacher workspace → **Guided 3-minute demo**. `POST /api/demo/start` creates a fresh heart lesson (or resumes the current one); `GET /api/demo/state` returns the checklist; `POST /api/demo/reset` forgets the pointer. Published versions are immutable, so old demo lessons stay in the list.

Every step is computed from stored data, not from button clicks:

1. Diagram added · 2. Labels read (**Demo simulation**) · 3. Proposal (**Demo simulation**) · 4. Validator finding count at creation · 5. Evidence attached to Pulmonary artery → Lungs · 6. Every item decided · 7. Immutable version published · 8. “Pulmonary artery” in the published vocabulary · 9. Cached Polly audio, or **Fallback** to browser speech when Polly is not configured · 10. Explorer available · 11. The term appears in a caption line (including a near-spelling hit) · 12. A student question anchored to the term · 13. The teacher marks it seen.

Walkthrough: attach endpoint labels → approve all → publish → Explore → “Next in flow” → Captions → *Play sample lecture* → click “pulmonary artary” → *Ask about this* → Communicate → send → Teacher → Questions & activity → *Mark seen*.
