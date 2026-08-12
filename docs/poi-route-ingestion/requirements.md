# Requirements Document

## Introduction

This feature establishes a systems engineering scope for observing the routes aircraft
actually fly, and using those observed routes to drive POI content ingestion and coverage
analysis along a defined interest corridor.

Today the app builds route bundles against a hardcoded `ROUTE_SEA_DEN` array. Live TFMS
data proved that assumption wrong: on a single evening, DEN to SEA traffic split across at
least two materially different routings, a southern path via Idaho Falls, Pendleton, and
Yakima, and a northern path via Mullan Pass and Spokane, diverging by roughly 200 miles
after the FAARM fix. A passenger on the northern routing would never encounter any content
curated for the southern one.

The purpose of this feature is to replace assumed geometry with observed geometry, and to
use that observed geometry to answer a specific question: where along the routes people
actually fly do we lack content worth telling a story about?

### Mission Traceability

Per `CONTENT_ARCHITECTURE.md`, all requirements here trace to The One Job: the app exists
to make the flight feel shorter. This feature serves that in one specific way.

Presence collapses perceived time. Presence requires a continuous narrative, not a
scattering of content with dead space between it. The roadmap already records the failure
mode in the user's words: "a cluster of POIs, with a bunch of nothing in between LENGTHENS
the flight, not shortens it." A passenger crossing 200 miles of narrative silence is
returned to awareness that they are sitting in a seat waiting to land.

This feature therefore exists to make narrative continuity measurable and then fixable. It
is a content planning instrument, not a content delivery mechanism.

Two standards from `CONTENT_ARCHITECTURE.md` constrain it directly:

- The Silence Standard. Silence is preferable to content that fails the Imagineering
  standard. Ingesting more candidate locations SHALL NOT result in more unreviewed content
  reaching passengers.
- Wikipedia Policy and Wikipedia Sunset. Wikipedia is a location discovery source only,
  and the stated end state is zero raw Wikipedia POIs in production. Ingestion volume must
  therefore feed the curation pipeline, never the delivery pipeline.

### Key Concept: Interest Radius Is Not Visual Radius

The interest corridor is defined as 125 miles either side of the flown route, a 250 mile
wide corridor. This figure is deliberately not derived from visual acuity.

The geometric horizon at 39,000 feet is approximately 242 statute miles, and practical
recognition of ground features is roughly 100 to 150 miles on a clear day. But the
governing rationale is narrative, not optical: a passenger crossing central Idaho can be
genuinely interested in something 100 miles off the wing as part of an unfolding story,
whether or not they can resolve it out the window.

This creates a hard requirement to keep two concepts separate:

- Interest eligibility. Governs whether a location is ingested and may be surfaced as part
  of the story. Radius 125 miles cross-track.
- Visual confirmation eligibility. Governs only whether the guide may use language implying
  the passenger can see the thing. Substantially tighter, and altitude dependent.

`CONTENT_ARCHITECTURE.md` already encodes this split via `requiresVisualConfirmation` and
the Radius/Visibility Model. Widening the interest radius increases the population of
POIs that are in-corridor but not visually resolvable, which raises the risk of the
visual/spatial-presence language bug that survived its first fix attempt. Separating the
two concepts in the data model is the structural mitigation.

## Requirements

### Requirement 1: Observed Route Recording

**User Story:** As the system operator, I want the routes aircraft actually fly on target
corridors recorded continuously, so that content planning is driven by real geometry
instead of an assumed static route.

#### Acceptance Criteria

1. WHEN a TFMS message containing a `FlightSectors` record is received THEN the system
   SHALL evaluate that record against the configured set of target corridors.
2. IF a `FlightSectors` record matches a target corridor by departure and arrival airport
   THEN the system SHALL persist the record's ordered fix list, its ordered waypoint list
   with decimal latitude and longitude, and the per-point `elapsedTime` offsets.
3. WHEN persisting an observed route THEN the system SHALL record the flight identifier,
   departure airport, arrival airport, observation timestamp, and derived direction of
   travel.
4. WHERE a corridor is configured THEN the system SHALL treat each direction of travel as a
   distinct corridor, because direction is a first-class content attribute per the
   Directional Architecture section of `CONTENT_ARCHITECTURE.md`.
5. WHEN a `flightPlanAmendmentInformation` record is received for a flight with a previously
   observed route THEN the system SHALL persist the amendment as a distinct event rather
   than overwriting the original observation, so that in-flight rerouting is preserved as
   history.
6. IF a message is received that does not match a target corridor THEN the system SHALL
   acknowledge and discard it without persistence.
7. WHILE route recording is active THE SYSTEM SHALL continue to satisfy the subscription
   connectivity obligation described in Requirement 8.

### Requirement 2: Canonical Routing Identification

**User Story:** As a content planner, I want distinct recurring routings identified from
raw observations, so that I can plan coverage against the handful of paths actually in use
rather than against thousands of individual flight records.

#### Acceptance Criteria

1. WHEN a configurable observation period has elapsed THEN the system SHALL group observed
   routes for each corridor into distinct canonical routings.
2. WHEN grouping observed routes THEN the system SHALL treat two routes as the same
   canonical routing IF their paths remain within a configurable lateral tolerance of each
   other along their full length.
3. WHEN a canonical routing is identified THEN the system SHALL record its observation
   frequency, expressed as a share of total observed flights for that corridor and
   direction.
4. IF a canonical routing's observation frequency falls below a configurable threshold THEN
   the system SHALL flag it as rare rather than including it in primary coverage planning.
5. WHEN a previously unobserved routing appears and exceeds the frequency threshold THEN the
   system SHALL surface it as a new routing requiring coverage review.

### Requirement 3: Interest Corridor Definition

**User Story:** As a content planner, I want a precisely defined geographic corridor for
each canonical routing, so that ingestion and gap analysis operate on an explicit,
reviewable boundary.

#### Acceptance Criteria

1. WHEN defining an interest corridor for a canonical routing THEN the system SHALL use a
   cross-track distance of 125 miles either side of the route centerline, producing a 250
   mile wide corridor.
2. WHEN a corridor spans multiple canonical routings for the same corridor and direction
   THEN the system SHALL define the effective interest area as the union of the individual
   routing corridors.
3. WHERE canonical routings diverge THEN the system SHALL preserve the association between
   each geographic area and the specific routing or routings it belongs to, so that content
   can later be matched to the routing actually being flown.
4. WHEN computing cross-track distance THEN the system SHALL use along-track and cross-track
   decomposition consistent with the existing `trackDecompose` approach in `poiEngine.js`,
   not a single undifferentiated radial distance.
5. IF the interest radius value changes THEN the system SHALL treat previously computed
   corridors and gap analyses as stale and requiring recomputation.

### Requirement 4: POI Candidate Ingestion and Deduplication

**User Story:** As a content planner, I want candidate locations discovered within the
interest corridor and stored without duplication, so that I have a pool of real places to
evaluate for content coverage and each place appears exactly once.

#### Acceptance Criteria

1. WHEN ingesting candidates for an interest corridor THEN the system SHALL retrieve
   candidate locations from configured discovery sources within the corridor boundary.
2. WHEN retrieving from Wikipedia THEN the system SHALL retain only title and coordinates,
   consistent with the Wikipedia Policy in `CONTENT_ARCHITECTURE.md`, and SHALL NOT retain
   or propagate article text or extracts.
3. WHEN a candidate is ingested THEN the system SHALL record its position relative to each
   applicable canonical routing, expressed as along-track position and cross-track offset.
4. WHEN a candidate is ingested THEN the system SHALL record the estimated time offset from
   departure at which an aircraft on that routing would be nearest to it, derived from the
   observed `elapsedTime` data.
5. IF a candidate falls within the interest corridors of multiple canonical routings THEN
   the system SHALL record its relationship to each routing independently.
6. WHEN a candidate is ingested THEN the system SHALL assign it a lifecycle state of
   candidate, and SHALL NOT assign it any state that makes it eligible for passenger
   delivery.
7. WHEN a location is discovered THEN the system SHALL determine whether a POI already
   exists at that location BEFORE creating a new record, and SHALL NOT create a duplicate.
8. WHERE a discovery source supplies a stable identifier THEN the system SHALL treat that
   identifier as authoritative for identity within that source, consistent with the existing
   unique `pageid` constraint on `wikipedia_pois`.
9. WHERE no shared identifier exists between two locations THEN the system SHALL treat them
   as the same POI IF their coordinates fall within a configurable tight proximity tolerance.
10. IF two locations fall outside the tight tolerance but within a configurable wider review
    band THEN the system SHALL flag them as suspected duplicates for human review rather
    than merging them automatically, because genuinely distinct POIs can sit close together
    within a single town.
11. IF an existing premium or curated POI already covers a discovered location THEN the
    system SHALL NOT create a candidate record for it, so that gap analysis is not distorted
    by unreviewed duplicates of already-curated content.
12. WHEN an existing POI is found to also fall within an additional canonical routing's
    interest corridor THEN the system SHALL add the routing association to the existing
    record rather than creating a second POI record.
13. WHEN ingestion is run repeatedly against the same corridor THEN the operation SHALL be
    idempotent, producing no duplicate records and no spurious changes to existing records.
14. WHEN checking whether a location already exists THEN the system SHALL evaluate records
    across all tiers, premium, curated, and previously ingested candidates, not only records
    originating from the discovering source.
15. WHERE proximity alone is ambiguous THEN name similarity MAY be used to supplement the
    geographic test, since coordinates for the same place differ between sources while
    distinct places within one town can sit close together.
16. WHEN an existing POI is matched by a new discovery THEN the system SHALL record the
    additional discovery source and its source identifier against the existing record, so
    that corroboration across independent sources is retained rather than silently
    discarded.
17. WHEN proximity matching is performed THEN the system SHALL use an indexed spatial lookup,
    consistent with the existing GIST index on `wikipedia_pois`.
18. IF two existing records are later determined to represent the same place THEN the system
    SHALL support merging them without losing curated content or source associations.

### Requirement 5: Interest and Visual Eligibility Separation

**User Story:** As a passenger, I want the guide to never imply I can see something I
cannot, so that its credibility holds even when it tells me about places far off the wing.

#### Acceptance Criteria

1. WHEN a candidate is ingested THEN the system SHALL evaluate and record interest
   eligibility and visual confirmation eligibility as two independent attributes.
2. WHEN evaluating visual confirmation eligibility THEN the system SHALL apply a threshold
   substantially tighter than the 125 mile interest radius, and SHALL account for altitude.
3. IF a candidate is interest eligible but not visually confirmable THEN the system SHALL
   record it in a form that allows downstream guide context to state this as a fact about
   the location.
4. THE SYSTEM SHALL NOT rely on phrase blocklists to prevent visual language, because the
   roadmap records that approach as confirmed insufficient: the model paraphrases around
   banned phrases while committing the identical underlying error.
5. WHEN visual confirmation eligibility is recorded THEN the representation SHALL be
   compatible with the existing `requiresVisualConfirmation` semantics and the
   Radius/Visibility Model in `CONTENT_ARCHITECTURE.md`.

### Requirement 6: Narrative Continuity and Coverage Gap Detection

**User Story:** As a content planner, I want the stretches of route with no story to tell
identified explicitly, so that I write content where it is actually missing instead of
guessing.

#### Acceptance Criteria

1. WHEN analyzing a canonical routing THEN the system SHALL segment it into contiguous
   windows of configurable along-track length.
2. WHEN a window is analyzed THEN the system SHALL report the count of available content by
   tier, distinguishing premium, curated, and unreviewed candidate.
3. IF a window contains no premium or curated content THEN the system SHALL flag it as a
   narrative dead zone.
4. WHEN reporting dead zones THEN the system SHALL express each one in passenger-meaningful
   terms, including its geographic location and the approximate elapsed flight time at which
   a passenger would cross it.
5. WHEN reporting coverage THEN the system SHALL evaluate each direction of travel
   separately, because content is direction-tagged and eastbound coverage does not satisfy
   westbound need.
6. WHEN reporting coverage THEN the system SHALL NOT count unreviewed candidate locations
   toward satisfying a coverage gap, because per the Silence Standard an unreviewed location
   is not deliverable content.
7. WHEN counting content within a window THEN the system SHALL count distinct places as
   resolved under Requirement 4, so that the same place discovered from multiple sources or
   reached by multiple routings is never counted more than once.
8. WHERE a dead zone is reported THEN the system SHALL list interest-eligible candidate
   locations within that window as raw material for curation.

### Requirement 7: Curation Prioritization Output

**User Story:** As a content planner, I want a ranked, actionable list of what content to
write next, so that curation effort goes where it most improves narrative continuity.

#### Acceptance Criteria

1. WHEN coverage analysis completes THEN the system SHALL produce a prioritized list of
   coverage gaps for review.
2. WHEN prioritizing gaps THEN the system SHALL weight each gap by the observation frequency
   of the routings it affects, so that gaps on commonly flown paths rank above gaps on rare
   ones.
3. WHEN prioritizing gaps THEN the system SHALL weight contiguous gap length, so that longer
   uninterrupted narrative silence ranks above shorter ones.
4. WHEN a gap is reported THEN the output SHALL identify which canonical routings and
   directions it affects.
5. WHEN the prioritized list is produced THEN it SHALL be durable and reviewable outside the
   running process, not emitted only as transient log output.

### Requirement 8: Subscription Connectivity Preservation

**User Story:** As the system operator, I want route recording to coexist with the existing
keep-alive obligation, so that adding this feature does not put SWIM access at risk.

#### Acceptance Criteria

1. WHILE route recording is active THE SYSTEM SHALL maintain continuous connectivity to each
   subscribed feed, satisfying the FAA inactivity requirement that triggered the prior
   disablement notice.
2. WHEN route recording is active THEN the system SHALL acknowledge every received message,
   including messages it discards without persisting.
3. IF a connection drops THEN the system SHALL reconnect automatically with bounded backoff.
4. IF no message is received on a feed within a configurable staleness window THEN the system
   SHALL surface a health signal, because a silently stale feed is worse than an obvious
   outage.
5. WHERE multiple consumers bind to the same queue THEN the system SHALL account for
   messages being distributed rather than duplicated across consumers, and SHALL NOT assume
   any single consumer observes the complete stream.
6. WHEN sequence-gap detection is considered THEN the system SHALL account for the FAA
   caveat that filtered subscriptions cause false missed-message positives, and SHALL treat
   staleness detection as the primary reliability signal unless sequence semantics are
   confirmed.

### Requirement 9: Route Bundle Integration

**User Story:** As a passenger, I want the content I receive to match the path my aircraft
is actually flying, so that the story stays continuous even when the flight is rerouted.

#### Acceptance Criteria

1. WHEN a route bundle is built THEN the bundler SHALL be able to source route geometry from
   observed canonical routings rather than only from a hardcoded route array.
2. WHERE multiple canonical routings exist for a corridor and direction THEN the bundle
   representation SHALL be able to carry content associated with each routing.
3. WHEN bundle content is assembled THEN it SHALL preserve the interest eligibility and
   visual confirmation eligibility attributes defined in Requirement 5.
4. IF observed routing data is unavailable for a corridor THEN the bundler SHALL fall back to
   existing behavior rather than failing.
5. WHEN bundles are versioned THEN the system SHALL record which observed routing corpus
   version a bundle was built from, so that stale bundles are identifiable.

### Requirement 10: Compliance and Data Handling

**User Story:** As the system operator, I want SWIM-derived data handled within the terms we
agreed to, so that the subscription and the product are not put at legal risk.

#### Acceptance Criteria

1. WHERE SWIM-derived data is persisted THEN the system SHALL confine use to the internal
   content planning purpose described in this document, consistent with the reviewed Terms
   of Service permitting use that solely affects the user's business and customers.
2. WHEN aircraft-identifying data is persisted THEN the system SHALL retain only what the
   content planning purpose requires, and SHALL define an explicit retention period.
3. WHERE aircraft data would be displayed to passengers THEN the system SHALL apply LADD
   list filtering per `LADD_COMPLIANCE.md`.
4. WHEN credentials are required THEN the system SHALL read them from local environment
   configuration excluded from version control, and SHALL NOT embed them in source or
   committed artifacts.

## Out of Scope

The following are explicitly excluded from this feature and remain separate roadmap items.

- Runtime re-plotting of a flight's displayed path when it reroutes after departure. Worth
  being precise about why this sits outside the scope rather than being a limitation of it:
  because ingestion covers the union of all canonical routings for a corridor, content is
  already in place for whichever path a flight actually flies, including one it switches to
  mid-air. Ingestion is therefore indifferent to rerouting by design. What remains out of
  scope is only the app-side behavior of detecting the switch and re-plotting the displayed
  route, which is the Dynamic Route Model item in Phase 2 Route Geometry. This feature is a
  prerequisite that makes that work cheap, not a phase of it.
- Writing the curated content itself. This feature identifies where content is needed and
  supplies candidate locations. Authoring seeds to the Imagineering standard remains
  editorial work.
- Fixing the guide's fabrication behavior, closing statement standard, or visual language
  prompt handling. This feature must not make those worse, and Requirement 5 is structured
  to help, but the prompt-side fixes are tracked separately.
- Gate, baggage, and arrival experience data from STDDS. Unrelated data path.
- Retiring Wikipedia as a live source. This feature supports the Wikipedia Sunset plan by
  quantifying coverage gaps, but the retirement decision per cluster is separate.

## Open Questions

1. What observation period is sufficient to trust canonical routing frequency? Seasonal
   variation, prevailing winds, and weather-driven rerouting may mean a week is not
   representative.
2. What is the correct visual confirmation threshold and altitude model for Requirement 5.2?
   The existing `VISIBLE_RADIUS_MILES` of 150 miles now appears generous relative to the 100
   to 150 mile practical recognition range, and is implicated in the unresolved premature
   firing behavior.
3. Should rare routings receive coverage at all, or be allowed to fall back to
   region-level content? A routing flown twice a month may not justify dedicated seeds.
4. Does the existing S3 and Lambda bundler extend cleanly to multi-routing bundles, or does
   the bundle format need a version bump?
5. Are TFMS sequence identifiers global or per-subscription? This determines whether
   sequence-gap detection is usable at all, per Requirement 8.6, and was already flagged as
   an open question in the roadmap.
6. What are the correct values for the tight deduplication tolerance and the wider review
   band in Requirements 4.9 and 4.10? Too tight produces duplicate records for the same
   place recorded at slightly different coordinates by different sources. Too loose collapses
   genuinely distinct POIs, for example several historic buildings within one town, into a
   single record and silently loses content opportunities.
7. How is "an existing premium or curated POI already covers this location" in Requirement
   4.11 determined? Coordinate proximity alone may be insufficient, since a curated POI
   describing a mountain range and a candidate describing a specific mine within it are not
   the same subject even when their coordinates are close.

## Glossary

**Along-track distance.** Distance measured forward or backward along the route
centerline, in the direction of flight. Governs whether something is ahead of, at, or
behind the aircraft.

**Candidate.** A discovered location that has been ingested but not curated. Not eligible
for passenger delivery. Holds no authored content beyond title and coordinates.

**Canonical routing.** A distinct recurring path between the same origin and destination,
derived by grouping many individual observed routes that stay within a lateral tolerance of
each other. DEN to SEA currently shows at least two: a southern path via Idaho Falls and a
northern path via Spokane.

**Corridor.** An origin and destination pair combined with a direction of travel, for
example DEN to SEA westbound. Direction is part of the corridor identity because content is
direction-tagged.

**Cross-track offset.** Perpendicular distance from the route centerline. Governs whether
something is off the left or right wing and how far.

**Direction of travel.** One of westbound, eastbound, northbound, or southbound. A
first-class content attribute per the Directional Architecture section of
`CONTENT_ARCHITECTURE.md`, each carrying a different emotional arc.

**elapsedTime.** An attribute on TFMS fix and waypoint elements giving seconds from
departure at which the aircraft is predicted to reach that point. Combined with
coordinates, this yields a four dimensional trajectory rather than a bare path.

**Fix.** A named navigational point, for example ROYYL, DDRTH, or RADDY. Appears in TFMS
`FlightSectors` records as an ordered sequence.

**FlightSectors.** A TFMS message type, triggered by `AIRSPACE_ASSIGNMENT`, carrying
`flightTraversalData` with the full ordered fix list and decimal coordinate waypoints for a
flight. Broadcast periodically for flights in the system, which makes it the practical
source of observed route geometry.

**Interest corridor.** The geographic area within 125 miles cross-track either side of a
canonical routing, a 250 mile wide band. Defines what gets ingested and analyzed.

**Interest eligibility.** Whether a location is close enough to the flown route to be worth
telling a passenger about as part of the unfolding story. Governed by the 125 mile interest
radius. Independent of whether the location can be seen.

**LADD.** Limiting Aircraft Data Displayed. An FAA list of aircraft whose data must be
blocked from live or historical display. See `LADD_COMPLIANCE.md`.

**Narrative dead zone.** A contiguous along-track window of a routing containing no premium
or curated content. The failure mode this feature exists to make visible, because
uninterrupted narrative silence lengthens perceived flight time.

**Observed route.** A single recorded instance of the path one flight was assigned, as
distinct from a canonical routing which aggregates many observations.

**SCDS.** SWIM Cloud Distribution Service. The FAA's cloud delivery mechanism for SWIM
data, accessed via the SWIFT Portal and delivered over Solace messaging.

**STDDS.** SWIM Terminal Data Distribution System. Airport surface and terminal data.
Currently subscribed for KSEA and KDEN. Not the source of route geometry.

**SWIM.** System Wide Information Management. The FAA's information sharing platform.

**TFMS.** Traffic Flow Management System. Source of R14 Flight Data and R14 Flow Data,
national in scope rather than airport scoped, and the source of route geometry, position
tracking, and flight plan amendments.

**Tier.** A POI's content classification: premium, curated, or unreviewed candidate. Only
premium and curated are deliverable to passengers. The stated end state is zero unreviewed
content in production.

**Visual confirmation eligibility.** Whether a passenger could actually resolve a location
out the window, accounting for distance and altitude. Governs only whether the guide may
use language implying the passenger can see it. Substantially tighter than interest
eligibility, and deliberately separate from it.

**Waypoint.** In TFMS `FlightSectors` records, a decimal latitude and longitude point along
the predicted path, typically at finer granularity than named fixes.

**Place identity.** The determination that two discovered records refer to the same physical
location, resolved by geographic proximity within tolerance and optionally name similarity,
rather than by exact coordinate equality. The basis for deduplication and for honest
coverage counting: one place is one story regardless of how many sources describe it or how
many routings pass near it.
