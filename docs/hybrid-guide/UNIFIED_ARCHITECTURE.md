# Unified Architecture: FlightLevel Content & Guide System

## The One Job

**The app exists to make the flight feel shorter.**

Everything else — content delivery, POI engagement, anxiety management, tourism board revenue, itinerary conversion — is downstream of this single truth.

## Architecture Overview

```
Passenger enters geofence
    ↓
[POI Engine] — Curated + Wikipedia POIs
    ↓
POI triggered (cone of interest)
    ↓
[Gemma 4 E2B] — Seed selection & surface delivery
    Fast. Cheap. On-device. High volume.
    Target: < 1 second
    ↓
Passenger asks follow-up question
    ↓
[Gemma 4 E2B] — Evaluates complexity
    IF answerable from corpus with high confidence → Gemma responds
    IF requires synthesis, nuance, or depth → escalate
    ↓
Handoff message (buys latency, stays in character):
    "Let me check with Base on that. Standby."
    "Good question — checking with ground."
    ↓
[Cloud Sonnet] — Deep follow-up
    Synthesis. Nuance. Connecting threads across seeds.
    Target: 3-5 seconds
    ↓
Passenger asks another level deeper
    ↓
"I'm going to get a deeper picture for you."
    ↓
[Cloud Opus] — Maximum depth
    Complete picture. Primary sources. Full context.
    Target: 5-8 seconds
```

## Three-Tier Model Architecture

### Tier 1: Gemma 4 E2B (Replaces Haiku)

**Role**: Seed selection, surface delivery, simple follow-ups

**Platform**: On-device (iOS/Android)

**Technology**:
- Model: Gemma 4 E2B (2B parameters, Q4_K_M quantized)
- iOS: MLX runtime (Apple Silicon optimized)
- Android: MediaPipe LLM Inference API
- Size: ~1.5GB
- Memory: ~2GB total
- Latency: 100-500ms

**Responsibilities**:
1. **Seed Selection** — Choose which POI to surface based on:
   - Flight direction (bearing-derived cardinal direction)
   - Altitude band (suppress visual anchors below minimum)
   - Anxiety profile register constraints
   - Session-scoped delivery exclusion (no repeat within flight)
   - Emotional register variation weighting
   - Superseed priority within window allocation

2. **Surface Delivery** — Present the opening hook:
   - Use `content_surface` field from seed
   - Apply Imagineering standard (discovery, not delivery)
   - Tone: adventurous, curious, wonder-filled

3. **Simple Follow-ups** — Answer factual questions from POI data:
   - "How tall is Mount Rainier?" → Query facts, respond
   - "When did it last erupt?" → Query facts, respond
   - Confidence > 0.7 → Return answer
   - Confidence ≤ 0.7 → Escalate to Sonnet

**Data Sources**:
- Route bundle (TOON format, pre-populated)
- Content seeds (from Supabase, bundled with route)
- POI facts (JSON within TOON bundle)

**Cost**: $0 (on-device)

### Tier 2: Cloud Sonnet

**Role**: Deep follow-up, synthesis, nuance

**Platform**: Netlify Function → Anthropic API

**Responsibilities**:
1. **Synthesis** — Connect threads across multiple POIs
2. **Nuance** — Handle complex comparisons and context
3. **Depth** — Use `content_depth_1` field from seed
4. **Escalation decision** — Determine if Opus needed

**Trigger Conditions**:
- Gemma confidence ≤ 0.7
- Question requires synthesis ("Compare X to Y")
- Question requires context beyond single POI
- Gemma responds with "ESCALATE"

**Cost**: ~$0.003 per query (moderate)

### Tier 3: Cloud Opus

**Role**: Maximum depth, primary sources, itinerary generation

**Platform**: Netlify Function → Anthropic API

**Responsibilities**:
1. **Complete picture** — Full historical/geological context
2. **Primary sources** — Reference original documents
3. **Itinerary generation** — Convert engagement to bookable trips
4. **Use `content_depth_2`** — Maximum depth content from seed

**Trigger Conditions**:
- Passenger asks another level deeper after Sonnet
- Itinerary request ("How do I visit this?")
- Complex multi-POI planning

**Cost**: ~$0.015 per query (highest)

**Ceiling**: Profile 2 (high anxiety) cannot escalate to Opus. Sonnet is the ceiling for anxiety management.

---

## POI Data Format: TOON

**Why TOON?**
- 42% fewer tokens than JSON (7,200 vs 12,500 for 85 POIs)
- 42% smaller bundles (165KB vs 285KB)
- Flatter structure (better for mobile parsing)
- LLM-optimized (Gemma parses it easily)

**Route Bundle Structure**:

```toon
meta:
  corridor: SEA-DEN
  version: 2
  built_at: 2026-05-18T12:00:00Z
  poi_count: 142
  gemma_optimized: true
  categories[6]: outdoor,leisure,history,water,winter,wildlife
  states[4]: WA,ID,WY,CO

corridor:
  width_nm: 75

route[156]{lat,lon}:
  47.4502	-122.3088
  47.2891	-121.9145
  ...

pois[142]{id,title,lat,lon,dist_nm,priority,side,heading,state,category,type,season,facts_json}:
  south-pass	South Pass	42.4667	-108.8000	8	1	both	eastbound	WY	history	landmark	year-round	{"elevation_ft":7412,"oregon_trail":true,"emigrants_crossed":400000}
  yellowstone-np	Yellowstone National Park	44.4280	-110.5885	25	1	both	eastbound	WY	wildlife	national-park	year-round	{"area_sq_mi":3472,"established":"1872","geysers":500}
  ...

seeds[142]{poi_id,content_surface,content_depth_1,content_depth_2,emotional_register,direction,anxiety_excluded}:
  south-pass	Out your window, the South Pass gave an erroneous sense of ease to westward travelers. This gentle saddle—so unlike a mountain pass—was the point of no return. 800 miles behind, 1,200 ahead.	[Sonnet depth content]	[Opus depth content]	drama	eastbound	[]
  yellowstone-np	Below you, the world's first national park is erupting on schedule. Old Faithful fires every 90 minutes, and 500 other geysers are doing the same. This is the planet's largest active volcanic system.	[Sonnet depth content]	[Opus depth content]	wonder	both	[]
  ...
```

**See [POI_FORMAT.md](./POI_FORMAT.md) for complete TOON specification.**

---

## Content Taxonomy (From Content Architecture Spec)

### Category 1 — History and Legend
The evergreen layer. No expiry. Always valid.

**Bar**: Would a well-traveled, curious person lean toward the window and think "I didn't know that"?

**Example**: South Pass was not just a milestone. It was the point of no return. Emigrants who crested it had walked 800 miles and had 1,200 still ahead.

### Category 2 — Seasonal
Time-bound. Rotate in one to two seasons prior. Taper off as season closes.

**Bar**: Can a passenger look out the window right now and see evidence of what this content describes?

**Example**: The elk migration below you is happening right now. 10,000 elk are moving from summer range to winter valleys.

### Category 3 — Landmark and The Unknown Known
The visible anchor with the invisible story.

**Bar**: Does the passenger already recognize the landmark? Does the content tell them something about it they genuinely did not know?

**Example**: Every passenger knows the Grand Canyon. Nobody knows the Havasupai tribe's continuous habitation, or the specific geological stratum that took three million years to expose.

### Category 4 — Human Achievement
Things built, invented, discovered, or accomplished because of this specific geography.

**Bar**: Would someone who has never heard of this place find this remarkable?

**Example**: Los Alamos exists because the geography made it defensible and remote enough to hide a secret. The Manhattan Project chose this mesa specifically.

---

## Emotional Register

Every seed carries an emotional register attribute. Used by Gemma to maintain arc coherence across a flight.

| Register | Description | Best Category Match |
|----------|-------------|---------------------|
| Wonder | Scale, beauty, the sublime | Landmark, Geology |
| Drama | Human stakes, consequence, tension | History, Legend |
| Pride | Achievement, identity, belonging | Human Achievement |
| Curiosity | The unknown, the counterintuitive | Unknown Known |
| Melancholy | Loss, what was left behind | History, Legend |
| Discovery | The thing hiding in plain sight | Unknown Known, Landmark |
| Urgency | What's happening right now | Seasonal |

**Rules**:
- Gemma SHALL NOT deliver the same register consecutively
- Profile 2 (high anxiety) SHALL NOT receive melancholy or drama register seeds
- Emotional register variation maintains engagement

---

## Directional Architecture

Direction is a first-class attribute on every seed. The same geography tells a different story depending on which way you are moving through it.

**Cardinal Direction Classification** (derived from flight bearing):
- Bearing 315–45° → northbound seed set
- Bearing 45–135° → eastbound seed set
- Bearing 135–225° → southbound seed set
- Bearing 225–315° → westbound seed set

**Directional Emotional Arcs**:
- **Westbound**: Possibility. The unknown ahead. Scale that humbles.
- **Eastbound**: Legacy. Return. What was built and left behind.
- **Northbound**: Emergence. Ascent. The landscape opening.
- **Southbound**: Descent. Warmth. Arrival. The relaxing of constraint.

**Round Trip Freshness**: A passenger flying JFK→LAX and LAX→JFK is two passengers, not one. The directional seed sets ensure the return flight feels like a different journey over the same ground.

---

## Seed Selection Logic (Gemma Layer)

**Input available to Gemma** (no passenger history, no PII):
- Flight direction (bearing-derived cardinal direction)
- Anxiety profile (0 | 1 | 2) — current session only
- Current session engagement history (seeds delivered this flight only)
- Altitude band (current altitude vs seed minimum visibility)
- Season and time of day
- Emotional register of previous seed delivered this session

**Selection rules**:
1. Filter by direction (cardinal match or both)
2. Filter by altitude band (suppress visual anchors below minimum)
3. Filter by anxiety profile register constraints
4. Exclude seeds already delivered this session
5. Weight by emotional register variation (avoid consecutive same register)
6. Weight premium superseeds at priority within window allocation
7. Select from weighted remaining pool

**No cross-flight history. No passenger tracking.** Freshness through corpus depth and directional variation.

---

## Model Escalation & Cost Pyramid

### The Inverse Cost Pyramid

The Opus conversation is not a cost problem. It is the highest-value commercial event in the platform.

| Model Path | Inference Cost | Engagement Signal | Itinerary Conversion |
|------------|----------------|-------------------|----------------------|
| Gemma only | $0 | Baseline | Lowest |
| Gemma → Sonnet | Low | Higher | Moderate |
| Gemma → Sonnet → Opus | Highest | Highest | Highest |

A passenger who escalates to Opus has self-selected into the highest intent tier. They are the most likely to request an itinerary, engage with partner offers, and convert to a booking. The inference cost is an investment, not an expense.

### Escalation Signal Integration

Model escalation path IS the engagement signal. No separate scoring mechanism required.

```
Gemma only, dismissed:        score += 0.0
Gemma only, expanded:          score += 0.3
Gemma → Sonnet:                score += 0.5
Gemma → Sonnet → Opus:         score += 0.8
Opus + itinerary request:      score = 1.0
```

---

## Implementation: Gemma 4 E2B Integration

### iOS (Swift + MLX)

```swift
import MLX

class GemmaGuideService {
    private var model: LLM?
    private var routeBundle: RouteBundle?
    private let fallbackEndpoint = "/.netlify/functions/guide"
    
    func initialize(routeBundle: RouteBundle) async throws {
        self.routeBundle = routeBundle
        
        // Load Gemma 4 E2B (Q4_K_M quantized)
        self.model = try await LLM.load(path: "gemma-4-e2b-q4.gguf")
        print("[guide] Gemma 4 E2B loaded successfully")
    }
    
    func selectSeed(context: FlightContext) -> ContentSeed? {
        guard let bundle = routeBundle else { return nil }
        
        // Apply selection rules
        let candidates = bundle.seeds
            .filter { matchesDirection($0, context.bearing) }
            .filter { matchesAltitude($0, context.altitudeFt) }
            .filter { matchesAnxietyProfile($0, context.anxietyProfile) }
            .filter { !context.deliveredSeeds.contains($0.id) }
        
        // Weight by emotional register variation
        let weighted = weightByRegister(candidates, lastRegister: context.lastRegister)
        
        // Select from weighted pool
        return weighted.randomElement()
    }
    
    func ask(question: String, context: FlightContext) async -> GuideResponse {
        // Step 1: Try Gemma
        if let model = model, let poi = context.activePOI {
            let result = await tryGemma(question: question, poi: poi, context: context)
            
            if result.confidence > 0.7 {
                return GuideResponse(
                    source: .onDevice,
                    content: result.answer,
                    latency: result.latency,
                    escalationPath: ["gemma"]
                )
            }
        }
        
        // Step 2: Escalate to Sonnet
        return await escalateToCloud(
            question: question,
            context: context,
            tier: .sonnet
        )
    }
    
    private func tryGemma(question: String, poi: POI, context: FlightContext) async -> (answer: String, confidence: Double, latency: TimeInterval) {
        let startTime = Date()
        
        let prompt = buildPrompt(question: question, poi: poi, context: context)
        let response = try? await model?.generate(prompt: prompt, maxTokens: 150)
        
        let answer = response ?? "ESCALATE"
        let confidence = calculateConfidence(answer)
        
        return (answer, confidence, Date().timeIntervalSince(startTime))
    }
    
    private func buildPrompt(question: String, poi: POI, context: FlightContext) -> String {
        """
        You are an adventurous and curious guide for FlightLevel passengers.
        
        POI: \(poi.title)
        Location: \(poi.lat), \(poi.lon)
        Category: \(poi.category)
        Facts: \(poi.factsJSON)
        
        Seed: \(poi.seed.contentSurface)
        
        Aircraft position: \(context.position.lat), \(context.position.lon)
        Altitude: \(context.position.altitudeFt) ft
        
        Question: \(question)
        
        Answer with curiosity and wonder (under 120 words). If you don't know or need deeper analysis, respond with "ESCALATE".
        """
    }
    
    private func calculateConfidence(_ answer: String) -> Double {
        if answer.contains("ESCALATE") || answer.contains("I don't know") {
            return 0.3
        }
        
        let hasNumbers = answer.range(of: #"\d+"#, options: .regularExpression) != nil
        let hasSpecifics = answer.count > 50
        
        return (hasNumbers && hasSpecifics) ? 0.9 : 0.6
    }
    
    private func escalateToCloud(question: String, context: FlightContext, tier: ModelTier) async -> GuideResponse {
        let startTime = Date()
        
        let response = try? await URLSession.shared.data(from: URL(string: fallbackEndpoint)!)
        // ... handle response
        
        return GuideResponse(
            source: .cloud,
            content: content,
            latency: Date().timeIntervalSince(startTime),
            escalationPath: ["gemma", tier.rawValue]
        )
    }
}

enum ModelTier: String {
    case sonnet = "claude-sonnet-4"
    case opus = "claude-opus-4"
}
```

### Android (Kotlin + MediaPipe)

```kotlin
import com.google.mediapipe.tasks.genai.llminference.LlmInference

class GemmaGuideService(private val context: Context) {
    private var llm: LlmInference? = null
    private var routeBundle: RouteBundle? = null
    private val fallbackEndpoint = "/.netlify/functions/guide"
    
    suspend fun initialize(routeBundle: RouteBundle) {
        this.routeBundle = routeBundle
        
        // Load Gemma 4 E2B
        llm = LlmInference.createFromOptions(
            context,
            LlmInference.LlmInferenceOptions.builder()
                .setModelPath("gemma-4-e2b-q4.bin")
                .setMaxTokens(150)
                .build()
        )
        Log.d("guide", "Gemma 4 E2B loaded successfully")
    }
    
    fun selectSeed(context: FlightContext): ContentSeed? {
        val bundle = routeBundle ?: return null
        
        // Apply selection rules
        val candidates = bundle.seeds
            .filter { matchesDirection(it, context.bearing) }
            .filter { matchesAltitude(it, context.altitudeFt) }
            .filter { matchesAnxietyProfile(it, context.anxietyProfile) }
            .filter { it.id !in context.deliveredSeeds }
        
        // Weight by emotional register variation
        val weighted = weightByRegister(candidates, context.lastRegister)
        
        return weighted.randomOrNull()
    }
    
    suspend fun ask(question: String, context: FlightContext): GuideResponse {
        // Step 1: Try Gemma
        llm?.let { model ->
            context.activePOI?.let { poi ->
                val result = tryGemma(question, poi, context)
                
                if (result.confidence > 0.7) {
                    return GuideResponse(
                        source = Source.ON_DEVICE,
                        content = result.answer,
                        latency = result.latency,
                        escalationPath = listOf("gemma")
                    )
                }
            }
        }
        
        // Step 2: Escalate to Sonnet
        return escalateToCloud(question, context, ModelTier.SONNET)
    }
    
    private suspend fun tryGemma(
        question: String,
        poi: POI,
        context: FlightContext
    ): GemmaResult {
        val startTime = System.currentTimeMillis()
        
        val prompt = buildPrompt(question, poi, context)
        val response = llm?.generateResponse(prompt) ?: "ESCALATE"
        
        val confidence = calculateConfidence(response)
        val latency = System.currentTimeMillis() - startTime
        
        return GemmaResult(response, confidence, latency)
    }
    
    private fun buildPrompt(question: String, poi: POI, context: FlightContext): String {
        return """
            You are an adventurous and curious guide for FlightLevel passengers.
            
            POI: ${poi.title}
            Location: ${poi.lat}, ${poi.lon}
            Category: ${poi.category}
            Facts: ${poi.factsJSON}
            
            Seed: ${poi.seed.contentSurface}
            
            Aircraft position: ${context.position.lat}, ${context.position.lon}
            Altitude: ${context.position.altitudeFt} ft
            
            Question: $question
            
            Answer with curiosity and wonder (under 120 words). If you don't know or need deeper analysis, respond with "ESCALATE".
        """.trimIndent()
    }
    
    private fun calculateConfidence(answer: String): Double {
        return when {
            "ESCALATE" in answer || "I don't know" in answer -> 0.3
            answer.contains(Regex("\\d+")) && answer.length > 50 -> 0.9
            else -> 0.6
        }
    }
}

data class GemmaResult(
    val answer: String,
    val confidence: Double,
    val latency: Long
)
```

---

## Supabase Schema (Content Seeds)

```sql
-- Geography clusters (POI groupings)
CREATE TABLE geography_clusters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    region_name TEXT NOT NULL,
    center_lat DECIMAL(9,6) NOT NULL,
    center_lng DECIMAL(9,6) NOT NULL,
    radius_miles INTEGER DEFAULT 120,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Content seeds (three-tier content)
CREATE TABLE content_seeds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cluster_id UUID REFERENCES geography_clusters(id) NOT NULL,
    poi_id TEXT NOT NULL,  -- matches TOON bundle poi.id
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    -- history | legend | seasonal | landmark | unknown_known | human_achievement
    direction TEXT NOT NULL,
    -- northbound | southbound | eastbound | westbound | both
    emotional_register TEXT NOT NULL,
    -- wonder | drama | pride | curiosity | melancholy | discovery | urgency
    
    -- Three-tier content
    content_surface TEXT NOT NULL,      -- Gemma layer (opening hook)
    content_depth_1 TEXT,               -- Sonnet layer (first follow-up depth)
    content_depth_2 TEXT,               -- Opus layer (maximum depth)
    
    source TEXT NOT NULL,               -- platform_curated | tourism_board | generic
    partner_id UUID,
    is_superseed BOOLEAN DEFAULT FALSE,
    min_visibility_altitude_ft INTEGER,
    seasonal_start_month INTEGER,
    seasonal_peak_month INTEGER,
    seasonal_end_month INTEGER,
    anxiety_profile_excluded INTEGER[], -- profiles this seed SHALL NOT serve
    
    governance_status TEXT NOT NULL DEFAULT 'pending_review',
    governance_notes TEXT,
    sensitivity_flags TEXT[],
    approved_at TIMESTAMPTZ,
    approved_by TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    submission_raw TEXT
);

CREATE INDEX idx_seeds_cluster ON content_seeds (cluster_id, is_active, governance_status);
CREATE INDEX idx_seeds_direction ON content_seeds (direction, category, is_active);
CREATE INDEX idx_seeds_poi ON content_seeds (poi_id);

-- Seed delivery log (telemetry)
CREATE TABLE seed_delivery_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL,
    seed_id UUID REFERENCES content_seeds(id) NOT NULL,
    cluster_id UUID REFERENCES geography_clusters(id) NOT NULL,
    delivered_at TIMESTAMPTZ NOT NULL,
    model_used TEXT NOT NULL,           -- gemma | sonnet | opus
    escalation_path TEXT[],             -- ['gemma','sonnet','opus']
    engagement_action TEXT,             -- dismissed | expanded | asked_ai | null
    engagement_score DECIMAL,
    flight_direction TEXT NOT NULL,
    altitude_ft INTEGER,
    anxiety_profile INTEGER NOT NULL,
    is_demo BOOLEAN DEFAULT FALSE
);

CREATE INDEX idx_delivery_session ON seed_delivery_log (session_id, delivered_at);
CREATE INDEX idx_delivery_seed ON seed_delivery_log (seed_id, delivered_at);
CREATE INDEX idx_delivery_engagement ON seed_delivery_log (engagement_score, model_used);
```

---

## Migration Path

### Phase 1: Route Bundle Generator (Week 1)
- [ ] Build TOON bundle generator (Lambda or local script)
- [ ] Input: Route waypoints + POI sources (Wikipedia, tourism boards)
- [ ] Output: TOON bundle with pois + seeds
- [ ] Store bundles in S3 or Supabase Storage
- [ ] Test with SEA-DEN route (142 POIs)

### Phase 2: Gemma Integration (Week 2)
- [ ] Add Gemma 4 E2B to iOS app (MLX runtime)
- [ ] Add Gemma 4 E2B to Android app (MediaPipe)
- [ ] Implement seed selection logic
- [ ] Implement confidence scoring
- [ ] Test on-device inference latency

### Phase 3: Cloud Escalation (Week 3)
- [ ] Update Netlify function to support Sonnet/Opus tiers
- [ ] Implement handoff messages
- [ ] Add escalation path logging
- [ ] Test end-to-end flow (Gemma → Sonnet → Opus)

### Phase 4: Content Seeds Database (Week 4)
- [ ] Create Supabase tables (geography_clusters, content_seeds)
- [ ] Populate with initial seed corpus (SEA-DEN route)
- [ ] Build content quality gate workflow
- [ ] Implement seed delivery logging

### Phase 5: Optimization & Monitoring (Week 5)
- [ ] Add IndexedDB caching for Gemma model
- [ ] Tune confidence thresholds
- [ ] Monitor on-device vs cloud usage
- [ ] Calculate cost savings

---

## Success Metrics

**V1 Success** (from Content Architecture spec):
- Passengers who open the app mid-flight engage with at least one POI trigger and do not immediately dismiss it
- Post-flight survey: "Did this flight feel shorter than you expected?"

**Technical Metrics**:
- **Cost reduction**: 70%+ (target: $0.10/month vs $0.90/month)
- **Latency improvement**: 50%+ for simple queries (Gemma vs cloud)
- **On-device hit rate**: 80%+ of queries handled by Gemma
- **Quality**: No degradation in answer quality
- **Load time**: <30s first load, <1s cached
- **Memory**: <2GB total

**Engagement Metrics**:
- **Escalation rate**: 20% Gemma → Sonnet, 5% Sonnet → Opus
- **Itinerary conversion**: 10%+ of Opus conversations
- **Seed engagement**: 60%+ expanded (not dismissed)

---

## Open Questions

1. **Model hosting**: CDN (Netlify) vs Hugging Face Hub?
2. **Quantization level**: Q4_K_M (1.5GB) vs Q2_K (800MB)?
3. **Confidence threshold**: 0.7 vs 0.8 for escalation?
4. **Corridor width**: 75nm optimal for DIRECT routing?
5. **Seed corpus size**: How many seeds per geography cluster? (Target: 8 minimum)
6. **Tourism board workflow**: How do they submit content? (Structured form)

---

## Next Steps

**Immediate**:
1. Build route bundle generator (TOON output)
2. Populate content_seeds table with SEA-DEN corpus
3. Integrate Gemma 4 E2B into mobile apps
4. Test end-to-end flow

**This unified architecture merges:**
- ✅ Content Architecture spec (Imagineering standard, taxonomy, directional arcs)
- ✅ Hybrid guide design (Gemma 4 E2B on-device)
- ✅ TOON format (42% token savings)
- ✅ Three-tier escalation (Gemma → Sonnet → Opus)

**The system is now fully specified and ready for implementation.**
