# Dev Test Plan

Living checklist for verifying fixes before they're considered dev-complete and ready
to batch into the next production deploy (see the once-daily deploy cadence rule in
`.kiro/steering/flightlevel-dev-workflow.md`).

**Note (2026-07-13):** as this grows, plan to split into separate files by test
category (APIs/remote, UX/UI, Logic, etc.) rather than one growing master file. Not
needed yet — single master file is sufficient at current scale.

## How to use this file

Every fix gets an entry with two checklists:
- **Agent-verifiable** — things checkable via code read, `get_diagnostics`, a build,
  or a single targeted script against real data (per the efficiency gate — one script,
  get the answer, delete it). No browser interaction required.
- **User-verifiable** — things that require an actual human clicking through the real
  UI: visual judgment, "does this feel right," timing/pacing, anything where the
  correct answer depends on taste or context the agent can't observe headlessly.

A fix isn't considered dev-complete until BOTH lists are checked off, not just the
agent's half. Mark items `[x]` as they're confirmed. Add a one-line note on how it
was confirmed (not just checked blindly).

---

## Fix: Foskett drugstore visual-language

**Change:** Added `requiresVisualConfirmation` to `guide.js` context injection, with
explicit instruction to avoid visual language ("what caught your eye") for
history/legend POIs.

**Agent-verifiable:**
- [ ] Build passes clean (`npm run build`)
- [ ] Read the actual system prompt output for a `requiresVisualConfirmation: false`
  POI and confirm the instruction text is present and unambiguous

**User-verifiable:**
- [ ] Click a history/legend premium POI (e.g. Foskett Drugstore, Tom Horn, Rock
  Springs) and confirm the response does NOT use visual language ("look down," "can
  you see," "what caught your eye")
- [ ] Click a landmark premium POI (e.g. Hells Canyon, Bear Lake) and confirm visual
  language IS still used appropriately (this fix shouldn't over-correct and suppress
  visual language where it's actually warranted)

---

## Fix: Dead-zone POI gap detection

**Change:** Not yet designed/built.

**Agent-verifiable:**
- [ ] Once built: script the route-segmentation logic against `ROUTE_SEA_DEN` +
  current waypoint data, confirm it correctly flags the known Palouse-area gap from
  earlier testing

**User-verifiable:**
- [ ] Fly the corridor in dev and confirm no segment feels like "dead air" for an
  extended stretch (subjective, but the whole point of the fix)

---

## Fix: Geofence fall-out + premium radius widening

**Change:** Not yet built.

**Agent-verifiable:**
- [ ] Unit-test-style check (once Vitest is set up — see Test Infrastructure section
  below): queue a POI while `conversing = true`, move position outside its radius,
  end conversation, assert it was pruned and never surfaced
- [ ] Confirm premium POIs in `waypoints SEA DEN.json` actually have wider
  `radiusMiles` values than curated/regular tier after the widening change

**User-verifiable:**
- [ ] Deliberately have a long conversation about one POI while a second POI's
  geofence window passes entirely; confirm the second POI does NOT appear stale/out of
  place when the conversation ends
- [ ] Confirm premium POIs feel like they fire earlier and stay "askable" longer than
  before, without feeling like they never turn off

---

## Fix: Closing statement standard (curiosity-modeling, not quiz/meta-survey)

**Change:** Not yet built — needs new VOICE-section language in `guide.js`.

**Agent-verifiable:**
- [ ] Read the new prompt language and confirm it explicitly rules out BOTH bad
  patterns: (1) trivia the passenger can't answer, (2) forced-choice/meta-analytical
  survey questions

**User-verifiable:**
- [ ] Run several real conversations across different POIs (history/legend AND
  landmark) and manually read every closing line — per the existing "don't trust one
  passing test" rule, this needs multiple real samples, not one clean response
  declared as proof
- [ ] Confirm closers read as the guide's own genuine curiosity, not a survey or a quiz

---

## Fix: Beckman Farmstead cross-response contradiction

**Change:** Not yet investigated — root cause unknown (prompt context issue vs. seed
data issue).

**Agent-verifiable:**
- [ ] Check `waypoints SEA DEN.json` for this waypoint's hook/seed content — confirm
  whether the "still stands" vs. "deteriorated" contradiction originates in the seed
  data itself or is a model-generated inconsistency
- [ ] If model-generated: check whether the opening response is actually included as
  conversation history context when the follow-up is generated (read `guide.js`'s
  message-passing logic)

**User-verifiable:**
- [ ] Re-run the same "tell me about X" → "tell me more" sequence for this POI and
  confirm no contradiction after the fix
- [ ] Spot-check 2-3 other premium POIs with multi-turn conversations for the same
  contradiction pattern (this may not be isolated to one POI)

---

## Fix: Position-aware tense for premium POI clicks

**Change:** Not yet built — needs a position-relative-to-POI field added to context
injection.

**Agent-verifiable:**
- [ ] Read the new context field logic and confirm it correctly computes
  ahead/at/behind from aircraft position vs. POI position (can verify with a targeted
  script using known lat/lon pairs — one script, not several)

**User-verifiable:**
- [ ] Click a premium POI well before reaching it — confirm forward-looking language
  ("coming up...")
- [ ] Click a premium POI while actually near it — confirm present-tense language
  ("you're crossing over...")
- [ ] Click a premium POI well after passing it — confirm past-tense language ("you
  passed over..."), the original bug report (Craters of the Moon)

---

## Confirmed working — no further action needed

- [x] Live ADS-B tracking (OpenSky) — user independently verified DAL2543's live
  position against an external source (2026-07-13)

---

## Test Infrastructure (separate, larger effort — see ROADMAP.md)

Once Vitest is set up, several of the "Agent-verifiable" checks above should become
real automated tests instead of one-off manual reads/scripts, specifically:
- POI tier precedence + queue fall-out logic (`poiEngine.js`)
- Turbulence briefing coverage (every `ROUTE_SEA_DEN` point resolves to a real name,
  never falls through to a fallback)
- Any future geofence radius/fall-out logic

This file remains the source of truth for what's USER-verifiable regardless of test
infrastructure maturity — automated tests can never replace the "does this feel
right" checks, only reduce how much of the "does this work correctly" burden falls on
manual verification.
