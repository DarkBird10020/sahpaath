# Implementation learnings

- Approval cannot be a UI boolean. Revalidation, explicit decisions, dependency checks, and immutable transactional publication all belong on the server.
- Reapproving a rejected item must validate it as active; otherwise rejection can hide its own validation errors.
- A single canonical part identifier simplifies captions, glossary links and contextual questions. Caption corrections should preserve their original text.
- Runtime image uploads can trigger Vite's full-page reload. The watcher must ignore private data and test reports so editing remains stable.
- Local fixture data is useful only when its simulated extraction is explicit. An uploaded image must enter a real manual authoring path when OCR is unavailable.
- Automated accessibility tools find useful issues, including muted-text contrast, but do not demonstrate real screen-reader usability or certify a whole standard.
- Generated camera chains require explicit cost estimates and inspection of actual rendered boundary frames. A supplied guide's historic price or CLI capability is not current API evidence.
- Serverless AWS migration remains work, not a badge. Account access, exact model capabilities, quotas, costs, and the grounding experiment must be verified when AWS setup begins.
