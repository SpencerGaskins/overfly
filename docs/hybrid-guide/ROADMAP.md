# FlightLevel Roadmap

Last updated: 2026-07-12

## Session Log — 2026-07-12

**Infrastructure:**
- ✅ Git repo created (`overfly` had no version history before this session) — pushed to
  `github.com/SpencerGaskins/overfly`, `.gitignore` confirmed excludes secrets/build artifacts
- ✅ Hardened `dev.ps1` — clears both port 8888 and 5173 with retry, then actually polls
  the guide function for a real HTTP response before declaring dev ready (previously just
  trusted the CLI's own "ready" banner, which didn't catch stale port/process issues)
- ✅ GitHub Actions scheduled workflow added (`.github/workflows/scheduled-deploy.yml`) —
  daily 2am PT production build/deploy, plus manual `workflow_dispatch` trigger. Requires
  `NETLIFY_AUTH_TOKEN` + `NETLIFY_SITE_ID` repo secrets (added) and Netlify dashboard env
  vars to stay in sync since the deploy now runs on GitHub's servers, not a local machine
- ✅ **Hard production deployment gate added to steering** (`flightlevel-dev-workflow.md`)
  — dev verification and prod deploy confirmation must now happen in separate turns, never
  chained. Direct response to a near-miss this session where "yes, deploy to prod" got
  read ambiguously.

**Fixes shipped to production (all dev-verified first):**
- ✅ Guide response length tiering — opening ask (2-3 sentences, 40-60 words) vs
  follow-up (up to 120 words), replacing one-size-fits-all 120-word/300-token response
- ✅ POI tier-precedence bug — premium POI arriving mid-conversation was silently
  discarded on conversation close instead of queued; fixed to always queue (front-of-line
  if higher tier) rather than mutating `active` while `conversing === true`
- ✅ **Critical Supabase RLS gaps** — `routes`, `wikipedia_pois`, `premium_pois`,
  `flyreps`, `bot_accounts`, `impressions`, `flyrep_aggregates` had RLS never enabled;
  anyone with the project URL could read/write/delete all of it via the public anon key.
  `bot_accounts` (contact_email, stripe_customer_id) was the flagged "sensitive data"
  exposure. Locked down to least-privilege per actual client usage (migration 002).
- ✅ **FLYREP + anxiety_profiles RLS regression** (self-inflicted by the above fix) —
  `.select()` chained after `.insert()` triggers a RETURNING clause checked against
  SELECT-level RLS, not INSERT — failed even though the insert itself was allowed.
  Root-caused via GitHub issue research, not guesswork. Fixed in `flyrepService.js`
  (migration 002 + 003).
- ✅ **anxiety_profiles RLS fully disabled + security_definer view** — found via Supabase's
  own security linter after a dashboard-created policy (`allow_all_inserts`, untracked in
  any migration) apparently toggled RLS off again. Consolidated all policies under
  version-controlled names, fixed `anxiety_engagement_summary` view with
  `security_invoker = true` (migration 003).
- ✅ **Turbulence briefing coverage gap** — briefing only checked 4 hand-picked named
  points, leaving real gaps in route coverage (confirmed: old logic would report "smooth
  air" while an in-flight check moments later found moderate turbulence in an unchecked
  gap). Fixed to check every point on the actual filed route, parallelized so briefing
  load time doesn't regress.
- ✅ **Turbulence zone naming regression** (from the fix above) — full-route coverage
  broke the "which region" label, falling through to generic "En route" for most points.
  Fixed with a per-point name lookup instead of small-radius hotspot matching.

**Process note:** Two fixes this session (RLS + turbulence naming) broke something that
had to be caught and re-fixed in the same session. Both were genuinely dev-verified before
shipping, but verification checked the *logic* (does the data come back correct) without
checking the *rendered output* (does the UI show what it should) or the *interaction with
existing policy* (does this insert pattern survive the RLS change). Root cause is the same
in both cases: no automated test suite, so verification is manual and only as thorough as
what's specifically tested. Deferred to next session, see below.

## Next Session — Bugs Found During Manual Testing (2026-07-13)

Found via hands-on passenger-seat testing after the 2026-07-12 fixes shipped. Two
infrastructure false alarms also happened this session (Netlify CLI crash holding
port 8888, stale dev process) — those are resolved by restarting `dev.ps1`, not real
app bugs, and are not on this list.

- [ ] **Foskett drugstore visual-language fix** — guide said "what caught your eye
  about it?" for a history/legend POI (Dr. Wilson Foskett Home and Drugstore, Wallace
  ID) that is NOT visible from cruise altitude. Root cause: `guide.js` never received
  `category`/`requiresVisualConfirmation` in `context.poi`, so the model had no way to
  know visual language was inappropriate. **Already coded** — added explicit
  visual-vs-story-only instruction to the context injection based on
  `requiresVisualConfirmation`. NOT YET VERIFIED in dev.

- [ ] **Dead-zone POI gap detection** — POIs cluster near populated areas (more
  Wikipedia coverage) with long empty stretches in between. Per the user: "a cluster
  of POIs, with a bunch of nothing in between LENGTHENS the flight, not shortens it" —
  directly violates The One Job. Plan: segment the route into fixed-distance windows,
  flag any window with near-zero POI coverage, use that list to prioritize writing new
  curated content for the actual gaps instead of guessing where they are.

- [ ] **Geofence fall-out + premium radius widening** — confirmed via code read: no
  POI, once queued during a conversation, is ever re-checked against the aircraft's
  current position. `_drainQueue()` blindly pops the oldest queued POI when a
  conversation ends, even if the aircraft has since flown well outside that POI's
  radius. Design agreed with user through discussion:
  - Fall-out rule applies uniformly to ALL tiers (premium, curated, Wikipedia) — no
    tier exemption. Per user: spec treats radius as "guaranteed availability, not
    delivery" — an occasional miss due to bad timing is acceptable.
  - On every `update()` tick, prune any POI sitting in `this.queue` whose current
    distance now exceeds its own radius.
  - Premium POIs should get a genuinely larger `radiusMiles` value (content/curation
    decision, not new engine logic) so they naturally become live earlier AND linger
    longer — reusing the existing single fall-out mechanism rather than adding a
    separate grace-period system. Decided against a time/distance "grace period" after
    exit (Option B) in favor of just widening the radius (Option A) once the user
    confirmed premium content should have MORE presence generally, not just longer
    tail — "the whole point of a premium POI is to showcase a state's wonder... which
    would get earlier noted and ask-able."
  - Geofence check should be distance-only for "is this POI live" — NOT capped by
    altitude-visibility for this determination (that capping still applies separately
    to the `requiresVisualConfirmation` visual-language question above, which is a
    different check).

- [ ] **Closing statement standard** — current guidance ("end on something that
  invites a follow-up") is too vague and produced a bad pattern: quizzing the passenger
  on facts only the guide knows and the passenger has no way to answer (e.g. "Did the
  wreck site stay accessible after they found it, or did the forest close back in?").
  User's framing, worth preserving verbatim: *"curiosity by the guide will lead to
  engagement curiosity by the user"* — this is the Disney Imagineering "cast member as
  enthusiast" principle. Fix: closing lines should model the GUIDE's own genuine
  lingering curiosity/wonder about the story (something like "I still wonder what it
  looked like from above right before they found it") — never a trivia-style question
  requiring a factual answer the passenger has no reference point for. Confirmed
  explicitly NOT the same fix as the Foskett issue above — one is about factual
  grounding (can this be seen), the other is about question TYPE (curiosity vs. quiz).
  A closer can pass one check and fail the other independently.
  **Refinement found 2026-07-13 (Beckman Farmstead example):** a second bad closer
  pattern exists that ISN'T trivia-quizzing either — a forced binary/survey-style
  question with academic meta-phrasing analyzing the guide's own narrative structure
  out loud: "What interests you more—the actual homesteading logistics, or the way the
  place became legend?" This is self-aware meta-commentary, not genuine wonder. The
  standard needs to explicitly rule out BOTH failure modes: (1) trivia only the guide
  can answer, (2) forced-choice/meta-analytical survey questions. Neither models real
  curiosity.

- [ ] **Cross-response factual contradiction (Beckman Farmstead)** — separate bug,
  not a closing-statement issue. Same conversation, two answers: opening said "The
  homestead still stands." Follow-up said "The structures deteriorated" and "What
  persisted was the narrative" instead of the physical place — directly contradicting
  the opening within the same conversation. This is a factual consistency failure, not
  a tone/style issue — the guide asserted opposite claims about whether the buildings
  exist today. Need to figure out why: possibly the model isn't being given the
  opening response as grounding context for the follow-up, or the underlying seed
  content itself is inconsistent (worth checking `waypoints SEA DEN.json` for this
  waypoint's hook data once we're ready to build this fix).

- [ ] **Position-aware tense for premium POI clicks** — confirmed design decision:
  premium POIs should ALWAYS be clickable/askable regardless of geofence state — per
  user, "this allows people to be curious on past POIs." This is intentional and
  should NOT be restricted (distinct from the geofence fall-out item above, which is
  about the conversation QUEUE, not map marker clickability). The actual bug: when a
  premium POI is clicked after the aircraft has already passed it, the guide responds
  in present tense as if still overhead — "You're crossing over one of the youngest
  lava fields..." for Craters of the Moon, clicked well after passing it. Fix: guide
  needs to know the aircraft's position relative to the POI (ahead/at/behind) and
  phrase accordingly — present tense only when actually near, past tense ("you passed
  over...") when behind, forward-looking ("coming up...") when still ahead. Likely
  needs a `positionRelativeToPoi` (or similar) field added to the context injection in
  `guide.js`, computed client-side from current aircraft position vs. POI position.

## Confirmed working (2026-07-13 manual testing)

- ✅ Live ADS-B tracking (OpenSky) — user independently verified DAL2543's live
  position against an external source, confirmed accurate.

## Next Session — Test Infrastructure (do this before more fixes)

Explicitly requested after two same-session break/re-fix cycles cost real deploy time.

- [ ] Set up Vitest (already on Vite, zero-config fit)
- [ ] Real unit tests for `poiEngine.js` — tier precedence, conversation-state handling
  (the exact bug class that bit us with the premium POI queue issue)
- [ ] Real unit tests for `FlightBriefing.jsx`'s turbulence summary — assert every
  `ROUTE_SEA_DEN` point resolves to a named zone, never falls through to a fallback
  (the exact bug class that bit us with the "En route" regression)
- [ ] Wire test run into `.github/workflows/scheduled-deploy.yml` so a failing test blocks
  the scheduled deploy automatically, not dependent on manual verification catching it
- [ ] Consider: does `submitAnxietyProfile`'s write-only RLS pattern need a regression
  test too, given it's already broken once from the same root cause as `flyreps`?

## Phase 1 — Demo-Ready (Current)

Working in production today:
- ✅ Guide with real AI responses (claude-haiku-4-5-20251001)
- ✅ Live flight tracking (AeroDataBox confirmed O/D + OpenSky live position)
- ✅ Anxiety-aware turbulence briefing and in-flight alerts
- ✅ Dynamic POI loading along route
- ✅ PIREP altitude filtering (no false altitude alerts)
- ✅ Turb alert dismissal (no re-fire after ack)
- ✅ Wikipedia extract stripped from guide context (own knowledge, no bias)
- ✅ Business/political POI exclusion filter
- ✅ Guide response length tiering (opening hook vs follow-up depth) — 2026-07-12
- ✅ Git version control + scheduled daily deploy pipeline — 2026-07-12
- ✅ Supabase RLS security hardening (critical exposure fixed) — 2026-07-12

## Demo-Ready Checklist (Do This First — Half Day)

Distinct from full Phase 1 completion. This is the minimum to make a pitch/demo land.

- [ ] **Write 4-6 real curated seeds** for the actual demo flight path (not full seed DB —
  just hardcode great `content_surface` text for the specific POIs you'll hit: South Pass,
  Frenchman Hills, etc.). Guarantees the "wow" moments instead of relying on Haiku
  improvisation variance.
- [ ] **Wire anxiety/curiosity profile into the guide's system prompt** — right now only
  turbulence alerts reflect anxiety profile; the actual guide conversation doesn't. This is
  your most differentiated feature and it's currently invisible when someone asks the guide
  a direct question. Small prompt change, high demo impact.
- [ ] **Dry-run the demo flight twice** — confirm no offline-fallback message fires, no
  console errors visible on screen-share, turbulence/POI timing feels right for the
  specific route being shown.

Explicitly OUT of scope for demo: model escalation, content seeds database/Supabase
tables, tourism board workflow, Gemma 4 E2B, connectivity layer, SWIM integration. These
are roadmap credibility (tell verbally), not demo features (show working).

## The Mission, In One Line

*"I am treating all of America as my Disneyworld."*

Sharper than the spec's "Disney principle correctly applied" framing — this is the
actual thesis, not just a design analogy. Every geography clusters, every premium POI,
every tourism board partnership is building toward the same thing Disney built: a
managed, curated experience of presence and story layered onto a physical place,
at the scale of an entire country instead of one park. Worth keeping this exact
phrasing somewhere visible — it cuts through faster than the longer spec language.

## Next Session — Tourism Board Comparison

Compare our current premium POI coverage (Wyoming/Idaho corridor: South Pass, Fort
Bridger, Rock Springs, Tom Horn/Rawlins, Hells Canyon, Massacre Rocks, Bear Lake, Green
River/Flaming Gorge) against what state tourism boards actually promote:

- Wyoming Office of Tourism, Idaho Tourism, Utah Office of Tourism
- Check for content gaps — places they promote that we don't have seeds for yet
- Check for framing differences — do they emphasize different angles on shared POIs
  (e.g. South Pass, Bear Lake) that we should consider
- Identify potential sponsorship/partnership targets per the spec's revenue stream
  model (tourism board content sponsorship) — this comparison doubles as sales research
- Flag anything where our "unknown known" angle overlaps with what they already market
  heavily (may indicate the story is less undiscovered than we assumed)

## Ongoing Maintenance — Wikipedia Sunset

**End state: zero raw Wikipedia POIs in production.** Every POI should be either
`tier: "premium"` or `tier: "curated"` — never unreviewed Wikipedia content. Wikipedia
is a bootstrap/coverage-gap filler per the Content Architecture spec, not a permanent tier.

**Shipped 2026-07-05:** Premium POIs now hold strict precedence over Wikipedia and
regular curated waypoints (`_tierRank` in `poiEngine.js`). Stops the symptom, doesn't
remove the underlying layer.

**Path to zero Wikipedia:**
- [ ] As content seeds database (Phase 2) fills per geography cluster, retire Wikipedia
  queries for that cluster entirely — don't just outrank it, stop calling the API
- [ ] Track "Wikipedia coverage gap" as a metric to prioritize content writing
- [ ] Once a corridor hits 8+ curated/premium seeds per geography per direction (spec
  minimum), disable `prefetchRoutePOIs` Wikipedia calls for that corridor
- [ ] Wikipedia becomes a background dev research tool, not a live passenger-facing source

## Phase 1 — Remaining (Short Pole)

These are small, self-contained fixes:

- [ ] **FLYREP simulated data** — Time-degrading weighted FLYREPs in Supabase for demo/testing
- [ ] **Anxiety profile → guide persona** — Pass curiosity_style to guide system prompt
- [ ] **POI ahead-only for sim mode** — Sim steps don't pre-suppress western POIs (only live does)
- [ ] **Duplicate pageid dedup** — Already fixed in code, verify in production
- [ ] **Dynamic import warning** — Clean up `import()` in FlightView (cosmetic, not blocking)

## Phase 2 — Content Layer (Medium Pole, 4-8 weeks)

Requires editorial work + database build:

- [ ] **Content seeds database** — geography_clusters + content_seeds Supabase tables
- [ ] **Seed corpus for SEA-DEN** — Minimum 8 approved seeds per geography cluster
  - Sources: NPS, Library of Congress, state historical societies, USGS
  - All four categories (History, Seasonal, Landmark, Human Achievement)
  - All four directions (eastbound/westbound/northbound/southbound)
  - Quality gate: Imagineering standard pass/fail
- [ ] **Tourism board submission workflow** — Structured form, platform transforms to seed format
- [ ] **Seed selection logic** — Direction filter, altitude band, anxiety profile, register variation
- [ ] **Seed delivery logging** — Every delivery logged with model, escalation path, engagement

## Phase 2 — Route Geometry (New — depends on R14 Flow Data)

- [ ] **Dynamic route model** — Replace static `ROUTE_SEA_DEN` array with a route that can
  update mid-flight based on R14 Flow Data reroute signals
- [ ] **Curated waypoint re-matching** — When reroute detected, re-filter curated waypoints
  against the new path geometry instead of the filed route
- [ ] **Reroute narrative content** — New content category: "why we're routing differently"
  (weather avoidance, traffic flow, etc.) — ties into Content Architecture emotional
  register system (this fits "Discovery" or "Urgency" register)
- [ ] **POI engine refactor** — `poiEngine.js` currently assumes route points are static;
  needs to support route replacement without losing triggered/dismissed state

## Phase 2 — Technical (Medium Pole, 2-4 weeks)

- [ ] **Gemma 4 E2B integration** — On-device inference (iOS: MLX, Android: MediaPipe)
  - Replaces Haiku layer for seed selection and surface delivery
  - Requires: route bundle pre-population, TOON format parser, confidence scoring
  - Long pole: model download (1.5GB), runtime setup, offline testing
- [ ] **Connectivity layer** — IFC-aware mode switching
  - Probe latency at startup and every 5 minutes
  - CLOUD_FIRST (Starlink <150ms) / HYBRID (Viasat) / GEMMA_ONLY (offline)
  - Model selection config-driven, never hardcoded
- [ ] **Model escalation** — Haiku → Sonnet → Opus (or Gemma → Sonnet → Opus)
  - Handoff messages ("Let me check with Base on that")
  - Escalation path logged to seed_delivery_log
  - Opus suppressed for anxiety profile 2

## Phase 2/3 — SWIM Integration (Revised — Faster Than Expected)

**Correction:** SWIM access via SCDS (SWIM Cloud Distribution Service) is **self-service, not a
long approval process** for standard published data feeds:

1. Create account at https://portal.swim.faa.gov (SWIFT Portal)
2. Create SCDS subscription via wizard, select data filters
3. Sign Service Access Agreement at subscription creation
4. **Auto-provisioned — no waiting period** for standard SCDS feeds
5. Connect consumer application to subscription, consume data

Services NOT covered by self-service SCDS (require emailing Data-To-Industry@faa.gov):
- Custom/non-standard data feeds
- Feeds not yet available via SCDS wizard
- Special access arrangements

SWIM unlocks:
- **En route**: Real-time FAA flight position (more reliable than ADS-B)
- **Approach**: Gate assignment, ETA updates, runway in use
- **Arrival**: Baggage claim carousel, connection gate
- **Full arrival experience**: App that starts at boarding and ends at ground transport

Relevant SWIM data feeds to explore in SCDS wizard:
- TFMS (Traffic Flow Management System) — flight plan + position
- STDDS (SWIM Terminal Data Distribution System) — gate/baggage
- ASDE-X — surface movement (taxi, gate pushback)

Revised integration path:
1. **Create SWIFT Portal account now** — https://portal.swim.faa.gov (do this early, low effort)
2. Explore SCDS subscription wizard to see what's actually available self-service
3. If standard feeds cover our needs → subscribe, auto-provisioned, build integration
4. If we need something custom → email Data-To-Industry@faa.gov (this path may still take longer)
5. Also check NSRR (NAS Service Registry and Repository) for full service catalog

**Revised timeline: Days to weeks, not months** — assuming our needs map to standard SCDS feeds.
Move this into Phase 2 planning once we confirm feed availability.

### Compliance requirement — LADD list

FAA SWIM Terms of Service require blocking any aircraft on the LADD (Limiting Aircraft
Data Displayed) list from live/historical display. See `LADD_COMPLIANCE.md` for full design.

- Our carrier filter already excludes GA/charter traffic — this is defensive compliance
- Requires: monthly sync job, Supabase exclusion table, filter check on every live query
- Build this alongside TFMS integration, not before
- Need separate ADX portal account to download the list — contact LADD@faa.gov

### 🔍 Open question — Gate assignment data source

Tower Departure Event Service (STDDS) includes "Gate Request Message" / "Gate Request
Response Message" message types — unclear if this covers gate *assignment* (which physical
gate) or just gate *pushback clearance* (permission to leave the gate). Skipped for the
initial STDDS subscription pending clarification. Revisit when Phase 3 arrival experience
work begins — may need a different SWIM service, or these message types may actually be
sufficient. Check NSRR (NAS Service Registry and Repository) for a dedicated gate
assignment feed if these turn out not to cover it.

### ✅ Both subscriptions live: "FlightLevelApp" (2026-07-05)

**TFMS:**
- R14 Flight Data — All Data
- R14 Flow Data — Message Types: Airspace Flow Program, Reroute Program,
  Traffic Management Initiative Update, General Advisory

**STDDS:**
- Surface Movement Event — KSEA + KDEN — Message Types: Surface Movement Events, Position Reports
- Tower Departure Event Service — KSEA + KDEN — Message Type: Tower Departure Events

Both auto-provisioned per SCDS self-service model. Next steps: retrieve JMS connection
details from SWIFT Portal, scope Node.js JMS client, build integration for both feeds.

### Technical research — broker is Solace, not generic JMS

SWIFT Portal delivers SWIM data via **Solace PubSub+ JMS messaging**, not a generic broker.
This changes the integration approach — use Solace's own client libraries instead of a
generic Java JMS bridge.

Useful references found:
- https://github.com/faa-swim/jms-client — FAA's basic JMS client (generic, not NOTAM-specific)
- https://github.com/faa-swim/swim-utilities — general SWIM data utilities
- https://github.com/solacese/swim-feed-handler — **Solace's own team** built a feed handler
  specifically for consuming FAA SWIM and relaying to a broker/file/log — closest reference
  to what we need to build
- https://support.swim.faa.gov/hc/en-us/articles/360061873232-FAA-SWIM-GitHub — portal support
  article explaining the GitHub org

**Confirmed: Node.js is a first-class Solace client, no Java bridge needed.**
Solace officially supports Node.js pub/sub: https://tutorials.solace.dev/nodejs/publish-subscribe/
FAA's official reference client (`faa-swim/jms-client`) is Java/Maven, but that's just their
chosen reference language — Solace's underlying protocol has native Node.js support.

Decision: build the SWIM consumer using Solace's Node.js API, not the FAA Java client.

### Architecture implication — persistent connection needed

Netlify Functions are stateless/short-lived (invoked per-request, cold start each time).
A Solace JMS-style subscription needs a **persistent, long-running connection** to receive
a continuous message stream. This does NOT fit the Netlify Functions model.

Options to resolve:
1. **Separate always-on consumer service** (e.g., small Node.js process on Fly.io, Railway,
   or a Supabase Edge Function with persistent connections if supported) that subscribes to
   Solace continuously and writes incoming messages to Supabase tables. Netlify functions
   then just read from Supabase (their normal job) — no change needed there.
2. **Netlify Background Functions / Scheduled Functions** — poll-based, not true pub/sub,
   would miss the real-time nature of SWIM but simpler to fit into current infra.

**Recommended: Option 1.** Build a small standalone Solace consumer (Node.js, not tied to
Netlify) that runs continuously, writes TFMS/STDDS events to Supabase. The existing
Netlify functions and frontend stay exactly as they are — they just get better data in
Supabase to read from.

Also check: "Jumpstart Kit" in SWIFT Portal (linked from support page) — likely has
connection endpoint details, credentials format, and starter code.

### Message format & reliability patterns (from faa-swim/swim-utilities reference)

Two important findings from the FAA's utility library (Java, but patterns apply):

**1. Messages are XML, not JSON.** The library includes an XML Sax parser utility for
splitting large XML documents by depth. TFMS R14 data is FIXM-formatted (XML-based
standard). Our Node.js consumer needs an XML parser (e.g. `fast-xml-parser` or `xml2js`
npm package), not JSON.parse.

**2. Messages carry sequential correlation IDs — must track for gaps/staleness.**
The "Missed Message Tracker" pattern: each message has a sequential ID (e.g. CorrelationId).
Consumers are expected to:
- Detect missed messages (gap in sequence — something was dropped)
- Detect stale feeds (no messages received in N minutes — connection may be dead even if
  still "connected")

Our standalone consumer service needs to reimplement this logic in Node.js:
- Track last-seen sequence ID per feed/topic
- On gap detected → log/alert, consider triggering a resync
- On staleness (no message in configurable window) → health check failure signal,
  trigger reconnect or alert

This should be built into the consumer service from day one, not bolted on later — silent
data gaps would be worse than an obvious outage, since the app would keep running with
stale/incomplete flight data without anyone noticing.

### Schema note — each SWIM product has its own XML schema

`faa-swim/aixm-5.1` provides Java bindings for **AIXM 5.1** — but that's specific to
FNS/NOTAMs, which we did NOT subscribe to. Confirms the pattern: each SWIM product has
its own schema (FNS→AIXM, TFMS→FIXM per the product description "FIXM formatted Air
Traffic Flow Data"). Not directly useful to us, but confirms we need to find the **FIXM
XSD schema** (not JAXB/Java bindings) to properly parse R14 Flight Data/Flow Data in
Node.js. Look for `fixm.aero` or similar official schema source when building the parser —
don't assume TFMS messages use AIXM.

### Reference architecture confirmed (faa-swim/fns-client, NOTAM-specific but transferable pattern)

Full end-to-end pattern from FAA's own NOTAM reference client — directly applicable to
our TFMS/STDDS consumer design:

1. **Initial Load** (bulk current-state snapshot, via SFTP for FNS — may differ for
   TFMS/STDDS, need to check if an equivalent "initial load" exists)
2. **JMS/Solace stream** — incremental updates after initial load
3. **Local database** — FAA's own reference recommends **PostgreSQL** (validates our
   Supabase/Postgres choice)
4. **REST API on top** — exactly what our Netlify functions already do (query DB, serve JSON)

This confirms the standalone consumer service architecture:
`Solace stream → parse XML (FIXM) → write to Supabase → existing Netlify functions read as normal`

**⚠️ Important caveat on filtering + missed-message detection:**
FAA's own docs state: *"it is necessary to set up a subscription that receives all
messages — any filters limiting which messages are received will cause the client to
falsely identify missed messages."*

We DID apply filters (KSEA/KDEN airports, specific message types) to both our TFMS and
STDDS subscriptions. This means: **our own sequence-gap detection logic may report false
positives**, since gaps could just be messages outside our filter (e.g. a different
airport's Tower Departure Event), not genuinely dropped messages.

Action item: verify with FAA/SWIM support whether sequence IDs are global (across all
traffic) or per-filter/per-subscription before building gap-detection logic. If global,
we need a different approach than naive "did the ID skip" — e.g. tracking staleness only
(no messages in N minutes) rather than strict sequence continuity, OR subscribing
unfiltered for reliability and filtering client-side in our own consumer instead of at
the SCDS subscription level.

### Selected subscription: TFMS → R14 Flight Data + R14 Flow Data

**R14 Flight Data** — FIXM-formatted correlated flight data with scheduling, routing, and
positional info. This replaces the fragile AeroDataBox + OpenSky heading/position matching
we built in Phase 1 — confirmed origin/destination without guesswork.

**R14 Flow Data** — reroute data (TMIs, Ground Stops, GDP, Airspace Flow Programs) has a
direct product use beyond ATC awareness: it tells us when the actual flight path diverges
from the filed/static route. This directly fixes the POI/curated-waypoint accuracy problem —
if a flight reroutes around weather, the POI engine needs to load content for the ACTUAL
path, not the assumed one. Also enables passenger-facing content: "we're routing north of
the storm system" is exactly the kind of thing that makes a flight feel shorter per the
Content Architecture spec. Subscribe to both R14 services together, not just Flight Data.

**Technical note:** SCDS requires JMS (Java Messaging Service) as the only authorized
connection method — not a simple REST API like OpenSky. Scope this properly before
committing; may need a JMS client library for Node.js.

**Legal note:** Full Terms of Service reviewed 2026-07-05. Standard liability disclaimer,
FAA-favorable dispute resolution, LADD compliance requirement. Not for "NAS-impacting"
use, but explicitly permits use that "solely affects the user's business and customers" —
which covers our passenger-facing display use case. Recommend counsel review before
accepting terms on the actual subscription (registering the portal account itself is fine).

## Phase 3 — Airline Partnerships (Long Pole, 6-12 months)

- Delta, Alaska, United distribution agreements
- SWIM provisioned through airline directly
- In-flight WiFi integration (Starlink/Viasat passenger session detection)
- IFE (In-Flight Entertainment) integration
- Boarding pass / PNR lookup for automatic flight detection

## Backlog (No timeline)

- DEN→SEA route content (westbound seed set)
- Additional corridors (SEA-LAX, SEA-ORD, SEA-JFK)
- iOS native app (Swift + MLX for Gemma)
- Android native app (Kotlin + MediaPipe)
- Seat side auto-detection (accelerometer + GPS)
- Offline mode with pre-downloaded route bundles
- Post-flight survey ("Did this feel shorter?")
- Itinerary generation (Opus layer → bookable trips)
- Partner superseed workflow (tourism boards)

## Apply for SWIM Today

Main program page: https://www.faa.gov/air_traffic/technology/SWIM
Get connected / request access: https://faa.gov/air_traffic/technology/swim/products/get_connected
Request email: Data-To-Industry@faa.gov
General questions: SWIM@faa.gov
Access portal (post-approval): https://portal.swim.faa.gov/ (SWIFT Portal)

Application requires:
- Organization name and type
- Use case description (passenger experience app)
- Data feeds requested (TFMS, STDDS)
- Technical architecture description
- Security and data handling plan

Start by emailing Data-To-Industry@faa.gov with the use case. The approval clock starts when you submit.
