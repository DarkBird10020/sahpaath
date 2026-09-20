# Making the working pages as alive as the landing page

The landing page is finished and it wins looks. Every page behind the login is
where the product actually is, and it is where we currently lose: nothing on
them moves, nothing responds, and several of them are a wall of repeated boxes.
This is the list of what is wrong, page by page, taken from the real app in a
browser with real lesson data, and what to do about each one.

## Where the references come from

Looked at Awwwards Sites of the Day and its "dashboard" results (mostly
template sellers, little use), then at the two interfaces that are actually
cited for craft in a *working* UI rather than a marketing page:

- **Linear** (linear.app) — an activity feed as a timeline with a connecting
  rail, actor, action and a relative time; state carried by a small coloured
  glyph instead of a text pill on every row; dense rows separated by hairlines
  and spacing rather than a card around each one; the whole panel floating on a
  layered surface with real depth.
- **Vercel Web Analytics** — a metric is a big number, a delta chip beside it
  and a sparkline underneath. Numbers are the hero; the label is small and
  quiet above them.

The competition will bring 3D on a landing page. Nobody brings a *reviewed
lesson pipeline* that feels alive. That is the gap.

## The five faults that repeat everywhere

1. **Nothing arrives.** Every page paints at once. No section, list or card
   ever enters. A page that never moves reads as a document, not a product.
2. **Nothing responds.** Cards have no hover, rows have no press, approving
   something changes a pill and nothing else. There is no reward for acting.
3. **Empty means blank.** "No questions yet.", "Not measured yet.", "No caption
   session yet for this version." are bare sentences on paper. An empty state
   should show the shape of what will fill it.
4. **State is spelled out in words.** Text pills everywhere — "Validated ·
   review next", "Grounded", "Concept" — where a glyph and colour would carry
   it, and the words could be spent on something the reader does not know.
5. **Repetition is not compressed.** The same line appears on eight cards; the
   same empty input is open eight times.

## Page by page

### Teacher workspace — review (the worst offender, and the most important)

Observed with the water-cycle draft, 8 items awaiting a decision.

| # | What is wrong | What to do |
|---|---|---|
| 1 | **Every card carries an always-open, always-empty "Review note (optional)" box.** Eight open textareas stacked down the page is the ugliest thing in the app. | Collapse it to a quiet "Add a note" link that opens the field in place. Keep it open only where a note is required. |
| 2 | "OCR confidence: Not measured yet. Model confidence: Not provided." repeats identically on all eight cards. | Say it once, above the list. On a card, show a confidence figure only when there is one. |
| 3 | "Concept" kicker plus a "Validated · review next" pill on every card — two labels saying what the reader can already see. | One state glyph in the card's corner; the words go. |
| 4 | Nothing distinguishes the flagged item from the seven clean ones. The banner says "start with the flagged content" and then gives no clue which it is. | The flagged card gets the amber rail and rises; the clean ones sit back. |
| 5 | Approving does nothing visible beyond a pill change. Eight decisions in a row feels like data entry. | On approve: the card settles, ticks, and the counter above it steps down. A progress rail across the top fills as decisions are made. |
| 6 | The stepper (Upload / Validate / Review / Publish) is four unconnected circles. | A real rail: a line between the steps, filled to the current one. |
| 7 | The source diagram column ends halfway down while the review column runs on, leaving a tall empty gutter. | Let the diagram stick as the reviewer scrolls, so the picture stays with the item being judged. |
| 8 | The action banner's three buttons are all the same weight, so nothing says which to press. | "Approve 7 valid items" is primary; the rest step back. |

### Teacher workspace — processing details

Rows reading "1 Upload & storage … completed", "2 OCR labels [Demo simulation]
… completed". Flat, no rhythm, no timing.

- Make it a **timeline with a connecting rail** (the Linear pattern): a dot per
  stage on a vertical line, the line coloured behind completed stages.
- Show **how long each stage took**. A pipeline page that does not say what it
  cost is missing its own point.
- The "Demo simulation" chip is doing honest work — keep it, but give it the
  same amber treatment everywhere so a reader learns the colour means
  "simulated, not real".

### Teacher workspace — questions & activity

"Student questions / No questions yet." then "Review history / 1. lesson
created" as a numbered list.

- Review history is an **activity feed** and should look like one: rail, glyph
  per kind of event, actor, and a relative time ("2 min ago") rather than a
  number.
- The empty state needs a card and a line saying where questions come from.

### Teacher workspace — the sidebar

- It is one long undifferentiated column: search, upload, title, image,
  source, licence, attribution, type, then the lesson list, then the demo. No
  grouping, no hierarchy.
- The lesson list is the thing a returning teacher wants and it is **below the
  fold, under a form they have already used**. Consider putting it first.
- Field captions and help text are the same size and colour as each other.

### Evaluation — "Measured, not imagined."

Ten cards, each reading **"Not measured yet."** It is honest and it is dead.

- Give each metric the **Vercel shape**: quiet label, then the number as the
  hero. When there is no number, the card should show what it *will* look
  like — a dimmed unit, a flat sparkline baseline — rather than a sentence.
- Say once, above the grid, that nothing has been recorded, instead of ten
  times inside it.
- When numbers do land, count them up on entry.

### Explore — the student's lesson

- The concept list, the panel and the mini-map all paint at once. Stepping to
  the next concept swaps the text with no transition — the one place in the
  product where motion would actually *teach* (this part, then that part).
- "Connected concepts" rows put the relation on the left and the target in the
  centre: unbalanced and hard to scan.
- The mini-map is a static picture. Selecting a concept should light it there
  too, and the flow arrows should read as a path, not decoration.

### Captions

- Card-in-card: "Live captions" is a panel inside the transcript panel. Two
  borders, two backgrounds, muddy.
- "Sample lecture = Demo simulation" sits in the button row at button height
  and reads as a fourth button. It is a badge — make it look like one.
- The empty transcript state is a good icon and a good sentence with nothing
  around it.

### Watch & listen / Explain a diagram

- Both are a search card, an upload card, then **a tall empty beige void** to
  the footer. Half the screen is nothing until you load something.
- Fill it with the thing the page is for: what it will produce. Explain a
  diagram already knows how to draw a diagram explorer; show a quiet,
  non-interactive sample of one instead of a void.

### Communicate (teacher inbox)

- The filter pills and the empty state are fine now, but the page is three
  elements on an acre of paper.
- The counts ("0 waiting", "0 AI-tutored to check") are the most alive thing
  here and they are pushed into the top corner at chip size.

### Account

- Two short columns and then nothing for 500px.
- "Role: teacher", "Anonymous class code: A260BF" — the class code is the one
  thing a teacher reads aloud to a room, and it is set in body text. It should
  be big, spaced and copyable in one press.

### Login

- The left column runs out halfway and the card floats without an anchor.
- The card's top edge and the heading's top edge do not agree.

## What to build, in order

1. **A reveal primitive.** One IntersectionObserver hook and one class, so any
   section or list can arrive — a short rise and fade, staggered down a list,
   switched off entirely under `prefers-reduced-motion` and under our own calm
   setting. This alone changes every page.
2. **Fix the review card.** Collapse the note, drop the repeated confidence
   line, glyph instead of pills, lift the flagged item, and animate the
   decision. This is the screen the judges will be shown.
3. **The pipeline timeline and the activity feed.** Both are the Linear rail,
   built once and used twice.
4. **Metric cards with a real shape**, and one honest line above the grid.
5. **Pointer-aware depth on cards** — a soft sheen that follows the cursor,
   very restrained, on the cards that matter. This is what reads as "alive" in
   a still screenshot and in a demo video.
6. **Fill the two empty tool pages** with a preview of what they produce.
7. **The class code**, the sticky diagram, the stepper rail, the small things.

Everything here must survive the calm-motion setting and
`prefers-reduced-motion`, and must not cost an accessibility violation: the
axe suite runs on all of these pages and is currently at zero.
