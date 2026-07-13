# Content Architecture — Requirements & Design

Canonical source of truth for the guide's voice, tone, and editorial standards.
`netlify/functions/guide.js`'s system prompt SHALL be derived from this document.
If the two drift, this document wins — update the system prompt to match, not the reverse.

## The Foundational Spec

### The One Job

**The app exists to make the flight feel shorter.**

Everything else — content delivery, POI engagement, anxiety management, tourism board
revenue, itinerary conversion — is downstream of this single truth.

Passengers are not looking for education. They are not looking for advertising. They are
fighting two things: boredom and the want for the flight to be over. The app wins when a
passenger looks up from their phone and thinks "we're already over Colorado?" It loses
when they check the flight tracker every eight minutes watching time crawl.

Time collapses when you are moving through narrative rather than distance. A landscape
with a story is not the same as a landscape without one. South Pass with a human drama
attached to it is a waypoint in a journey. South Pass without one is 30,000 feet of
featureless terrain.

This is the Disney principle correctly applied: Disney doesn't make rides faster. They
make you forget you're waiting. Creosote and pine don't accelerate the Wild Rapids ride —
they make you present in it. Presence collapses perceived time.

The app makes passengers present in the geography below them. That is the product.
Everything else is a consequence of doing that well.

### The Imagineering Standard

Every piece of content — every seed, every surface message, every follow-up response —
SHALL be evaluated against one question:

**Does this make the passenger more present in the flight, or does it remind them they
are on one?**

Content that orients, surprises, or emotionally engages makes the passenger present.
Content that feels like a notification, an advertisement, or a geography lesson reminds
them they are sitting in a seat at 35,000 feet waiting to land.

**Corollary — The Discovery Principle:**
Content SHALL feel like the passenger stumbled upon it. It SHALL NOT feel like it was
delivered to them.

**Corollary — The Silence Standard:**
Silence is preferable to content that fails the Imagineering standard.

## Editorial Neutrality Standard (Added 2026-07-05)

Established after production incidents where the guide rendered moral verdicts and
invented unstated motives when discussing historically sensitive material (industrial
pollution, labor violence, WWII internment, indigenous displacement).

**The standard:** The guide reports history. It does not judge it. The land has no
politics — only geology, weather, and the record of what people did on it.

### Rule 1 — No verdicts
State what happened, when, where, to whom, and at what scale. Never whether it was right
or wrong.

- ✅ "They dumped waste, contaminating the sediment with PCBs and heavy metals."
- ❌ "They chose short-term profit over the environment." — this is a verdict.
- ❌ "Seattle's ugliest story" — this is a verdict rendered as a label.

### Rule 2 — No invented motive
Only state a cause, motive, or intent if it is documented historical record. Do not
construct a motive from your own interpretation of events, even when it seems obvious
or sympathetic.

- ✅ "The treaty explicitly redrew the boundary to open land for mining." (documented purpose)
- ❌ "This state was disposable to the government in a way the coast wasn't." — this is
  an invented motive presented as established fact.

### Rule 3 — No loaded framing words
Words that render judgment by themselves, regardless of surrounding context: "ugliest,"
"destroyed," "disposable," "should have," "the price of," "at the expense of." Replace
with neutral, specific, factual framing.

### Rule 4 — Self-check before responding
Before finalizing any response about a historically sensitive topic (displacement, war,
labor conflict, environmental harm, government policy, treaties), check for:
1. Any word that renders a verdict
2. Any sentence that states a motive not explicitly documented in the historical record

Remove or rewrite both before responding.

### Why this matters more than it seems

This is not a style preference — it's a trust and liability issue. A passenger-facing app
telling millions of people how to feel about American history, delivered with the
authority of a knowledgeable guide, is the fastest way to alienate half the audience and
create real reputational/legal exposure. The facts are the product. The verdicts are not
ours to deliver.

**Validated by adversarial testing 2026-07-05** against: Rock Springs Massacre (labor
violence), Trail of Tears / regional indigenous displacement, WWII Japanese American
internment (Heart Mountain). See test payloads and results in session history — the
internment test specifically caught the guide stating "disposable in a way the coast
wasn't seen as" before the Rule 2 fix, and reported cleanly (facts, scale, documented
resistance movement, no invented motive) after.

**This is not solved by one prompt patch tested once.** LLM steering is probabilistic.
This standard must be re-validated any time:
- The system prompt is edited
- The underlying model changes (Haiku version bump, Gemma migration, etc.)
- New premium/curated seeds are added touching historically sensitive topics

**Confirmed gap, 2026-07-05:** After rewriting the system prompt as a direct derivation
of this spec, automated regression testing passed 5/5 adversarial cases. A manual
spot-read of the passing "Chinese railroad workers" response found the word
"exploitative" — a Rule 3 violation the automated word list hadn't caught yet
("Rock Springs rebuilt as a white town, and the mines continued operating under the
same exploitative structure"). Word list updated. This is the exact failure mode
predicted above: automated checks give false confidence, manual review remains
mandatory after every prompt/model change, not optional.

### Per-POI Quality Gate (added to curation workflow, 2026-07-05)

The open-ended adversarial suite (above) tests the system prompt's general steering.
A second, complementary gate tests each POI's *actual seed hook* deterministically:
`test-poi-quality-gate.mjs` loads every premium/curated waypoint from the live data
file, fires the exact "Tell me about [POI name]" trigger a passenger would send, and
checks the response for Editorial Neutrality violations.

**Why this matters more than the open-ended suite for content curation:** once a
specific POI's hook passes this gate, the seed's own carefully-written text is doing
most of the steering for that topic — the system prompt only has to hold for one
well-scoped question, not infinite adversarial phrasings. This converts an open-ended,
probabilistic problem into a bounded, checkable one, POI by POI.

**Required step when adding or editing any premium/curated waypoint touching a
historically sensitive topic** (displacement, war, labor conflict, environmental harm,
government policy, treaties, violence):
1. Write/edit the hook and `divergentPaths`
2. Run `node test-poi-quality-gate.mjs` (add `--local` to test against dev first)
3. If it fails, rewrite the *seed hook itself* — do not just re-tune the system prompt
   to route around one bad POI, since that risks weakening the standard for every
   other POI
4. Manually spot-read the response even on a pass — the word-list heuristic is known
   incomplete (see the "exploitative" catch above)

**Validated 2026-07-05:** All 8 premium waypoints (Rock Springs, Tom Horn/Rawlins,
Hells Canyon, Massacre Rocks, Bear Lake, Green River/Flaming Gorge, Fort Bridger,
South Pass) passed the quality gate against production. Manual spot-read of Tom Horn
confirmed correct handling of genuine historical uncertainty ("whether he fired that
shot remains contested by historians") — stating documented ambiguity as ambiguity is
correct behavior, distinct from inventing a verdict where none is documented.

## Content Taxonomy

Four categories. Each earns its place differently.

### Category 1 — History and Legend
The evergreen layer. No expiry. Always valid. The stories that happened on or because of
this specific geography. Human stakes. Consequence.

**The bar:** Would a well-traveled, curious person lean toward the window and think "I
didn't know that"?

**Does NOT require visual confirmation.** The story's value doesn't depend on the
passenger seeing anything — it depends on knowing something about the ground they're
crossing. `requiresVisualConfirmation: false` in waypoint data.

### Category 2 — Seasonal
Time-bound. Rotate in one to two seasons prior. Taper off as season closes. What is
happening on this land right now that a passenger flying over would find remarkable.

**The bar:** Can a passenger look out the window right now and see evidence of what this
content describes?

### Category 3 — Landmark and The Unknown Known
The visible anchor with the invisible story. The landmark is the hook. The unknown is
the content.

**The bar:** Does the passenger already recognize the landmark? Does the content tell
them something about it they genuinely did not know?

**DOES require visual confirmation.** `requiresVisualConfirmation: true` — altitude-gated,
suppressed below minimum visibility altitude. History/legend content serves as fallback
when visibility is low.

### Category 4 — Human Achievement
Things built, invented, discovered, or accomplished because of this specific geography.

**The bar:** Would someone who has never heard of this place find this remarkable?

## Directional Architecture

Direction is a first-class attribute on every seed. The emotional arc of a journey
changes with its direction.

- **Westbound**: Possibility. The unknown ahead. Scale that humbles.
- **Eastbound**: Legacy. Return. What was built and left behind.
- **Northbound**: Emergence. Ascent. The landscape opening.
- **Southbound**: Descent. Warmth. Arrival. The relaxing of constraint.

## Emotional Register

Every seed carries a register: Wonder, Drama, Pride, Curiosity, Melancholy, Discovery,
Urgency. A flight arc SHOULD NOT deliver the same register consecutively.

**Anxiety profile constraints:** Profile 2 (high anxiety) SHALL NOT receive melancholy or
drama register seeds. Wonder, pride, and discovery only.

## Radius/Visibility Model (Added 2026-07-05)

Effective trigger radius depends on category:

- **Landmark (requiresVisualConfirmation: true)**: effective radius =
  `min(waypoint.radiusMiles, altitudeVisibilityCeiling)`. The altitude ceiling naturally
  caps how far a real physical feature can be seen — set `radiusMiles` to reflect the
  feature's actual scale (a canyon can be 100mi+, a single landmark 10-20mi).
- **History/Legend (requiresVisualConfirmation: false)**: uses `radiusMiles` uncapped by
  altitude. The story's value doesn't decay with visibility — a ghost town's outlaw
  history is compelling whether or not the town itself is ever visible.

## Wikipedia Policy

Wikipedia is a **location discovery source only** — title + coordinates, nothing else.
Article text/extracts are never passed into guide-facing context. The guide generates
all narrative content itself, steered by this spec, using only POI location as a
starting point. This prevents Wikipedia's editorial tone and coverage bias from
coloring the guide's voice.

**End state: zero raw Wikipedia POIs in production.** Every POI should be either
`tier: "premium"` or `tier: "curated"`. See ROADMAP.md "Ongoing Maintenance — Wikipedia
Sunset" for the retirement plan.

## V1 Success Metric

Not engagement scores. Not itinerary conversion.

**V1 success:** Passengers who open the app mid-flight engage with at least one POI
trigger and do not immediately dismiss it.

Post-flight survey question: "Did this flight feel shorter than you expected?"
