# Design: Hybrid On-Device + Cloud Guide

## Architecture Overview

```
User Question
     ↓
[Client-Side Router]
     ↓
  Is POI data available? ──No──→ [Cloud LLM Fallback]
     ↓ Yes                              ↓
[Gemma 4 E2B (WebGPU)]              [Netlify Function]
     ↓                                  ↓
  Confidence > 0.7? ──No──→      [Gemini/Anthropic API]
     ↓ Yes                              ↓
[Return Answer]  ←──────────────  [Return Answer]
```

## Component Design

### 1. On-Device Gemma 4 E2B

**Platform**: FlightLevel mobile app (iOS/Android)

**Technology Stack**:
- **Model**: Gemma 4 E2B (2B parameters)
- **iOS Runtime**: Core ML or MLX
- **Android Runtime**: MediaPipe LLM Inference API or TensorFlow Lite
- **Format**: 
  - iOS: Core ML format (.mlpackage) or GGUF
  - Android: TFLite or GGUF quantized (Q4_K_M)

**Model Loading** (iOS - Swift):
```swift
// Option 1: Core ML
import CoreML

let modelURL = Bundle.main.url(forResource: "gemma-4-e2b", withExtension: "mlpackage")!
let model = try MLModel(contentsOf: modelURL)

// Option 2: MLX (Apple Silicon optimized)
import MLX

let model = try LLM.load(path: "gemma-4-e2b-q4.gguf")
```

**Model Loading** (Android - Kotlin):
```kotlin
// Option 1: MediaPipe
import com.google.mediapipe.tasks.genai.llminference.LlmInference

val llm = LlmInference.createFromOptions(
    context,
    LlmInference.LlmInferenceOptions.builder()
        .setModelPath("gemma-4-e2b-q4.bin")
        .build()
)

// Option 2: TensorFlow Lite
import org.tensorflow.lite.Interpreter

val model = Interpreter(loadModelFile("gemma-4-e2b.tflite"))
```

**Model Size**:
- Full precision: ~8GB (too large for mobile)
- 4-bit quantized (Q4_K_M): ~1.5GB (acceptable)
- 2-bit quantized (Q2_K): ~800MB (faster, lower quality)

**Recommendation**: Q4_K_M for quality, Q2_K if storage/memory constrained

### 2. POI Data Prepopulation

**Route Bundle Format**: TOON (Token-Oriented Object Notation)

**Why TOON?**
- 42% smaller than JSON (72KB vs 125KB for SEA-DEN)
- 42% fewer tokens (2,650 vs 4,587)
- Flatter structure (better for mobile parsing)
- LLM-optimized (Gemma parses it easily)

**Route Bundle Structure** (TOON format):
```toon
meta:
  corridor: SEA-DEN
  version: 2
  built_at: 2026-05-18T12:00:00Z
  poi_count: 47
  gemma_optimized: true

corridor:
  width_nm: 50

route[142]{lat,lon}:
  47.4502	-122.3088
  47.3891	-122.2145
  ...

pois[47]{id,title,lat,lon,dist_nm,priority,side,heading,elev_ft,type,year,facts_json}:
  mount-rainier	Mount Rainier	46.8523	-121.7603	12	1	A	eastbound	14411	volcano	1899	{"prominence_ft":13210,"first_summit":"1870","last_eruption":"1894","glaciers":25,"indigenous_name":"Tahoma","annual_climbers":10000}
  mount-st-helens	Mount St. Helens	46.1914	-122.1956	35	1	A	eastbound	8363	volcano	1980	{"prominence_ft":4605,"last_eruption":"2008","crater_depth_ft":2084,"blast_zone_sq_mi":230}
  ...

summaries[47]{id,text}:
  mount-rainier	Mount Rainier is an active stratovolcano and the most glaciated peak in the contiguous United States...
  ...

llm_context[47]{id,guidance}:
  mount-rainier	When discussing Mount Rainier, emphasize its volcanic activity, glacial coverage, and cultural significance...
  ...
```

**Width calculation for DIRECT routing**:
- Corridor width: ±50nm from centerline
- POIs within width are "on route"
- POIs outside width are "nearby but off route"

**See [POI_FORMAT.md](./POI_FORMAT.md) for complete TOON specification and examples.**

### 3. Client-Side Router Logic

**File**: `overfly/src/services/guideService.js` (new file)

```javascript
class HybridGuideService {
  constructor() {
    this.gemma = null
    this.routeBundle = null
    this.fallbackEndpoint = '/.netlify/functions/guide'
  }

  async initialize(routeBundle) {
    this.routeBundle = routeBundle
    
    // Load Gemma 4 E2B
    try {
      this.gemma = await LlmInference.createFromOptions({
        baseOptions: {
          modelAssetPath: '/models/gemma-4-e2b-q4.bin'
        }
      })
      console.log('[guide] Gemma 4 E2B loaded successfully')
    } catch (err) {
      console.warn('[guide] Gemma load failed, will use cloud fallback:', err)
    }
  }

  async ask(question, context) {
    // Step 1: Check if we have POI data
    const activePOI = context.poi
    if (!activePOI || !this.routeBundle) {
      return this.fallbackToCloud(question, context)
    }

    // Step 2: Try on-device Gemma
    if (this.gemma) {
      const result = await this.tryGemma(question, activePOI, context)
      
      // Step 3: Check confidence
      if (result.confidence > 0.7) {
        return {
          source: 'on-device',
          content: result.answer,
          latency_ms: result.latency
        }
      }
    }

    // Step 4: Fallback to cloud
    return this.fallbackToCloud(question, context)
  }

  async tryGemma(question, poi, context) {
    const startTime = performance.now()
    
    // Build prompt with POI facts
    const prompt = this.buildPrompt(question, poi, context)
    
    // Run inference
    const response = await this.gemma.generateResponse(prompt)
    
    // Parse response and confidence
    const { answer, confidence } = this.parseGemmaResponse(response)
    
    return {
      answer,
      confidence,
      latency: performance.now() - startTime
    }
  }

  buildPrompt(question, poi, context) {
    return `You are an adventurous and curious guide for FlightLevel passengers. Your personality is exploratory, enthusiastic, and wonder-filled - you help passengers discover the hidden stories of the landscape below.

POI: ${poi.title}
Location: ${poi.lat}, ${poi.lon}
Facts: ${JSON.stringify(poi.facts, null, 2)}
Summary: ${poi.summary}
Context: ${poi.context_for_llm}

Aircraft position: ${context.position.lat}, ${context.position.lon}
Altitude: ${context.position.altitudeFt} ft

Question: ${question}

Answer with curiosity and wonder (under 120 words). Use phrases like "Did you know...", "Imagine...", "What's fascinating is...". If you don't know or the question requires deeper analysis, respond with "ESCALATE" to indicate cloud fallback is needed.`
  }

  parseGemmaResponse(response) {
    // Check for escalation signal
    if (response.includes('ESCALATE') || response.includes("I don't know")) {
      return { answer: response, confidence: 0.3 }
    }
    
    // Simple confidence heuristic
    const hasNumbers = /\d/.test(response)
    const hasSpecifics = response.length > 50
    const confidence = (hasNumbers && hasSpecifics) ? 0.9 : 0.6
    
    return { answer: response, confidence }
  }

  async fallbackToCloud(question, context) {
    const startTime = performance.now()
    
    const res = await fetch(this.fallbackEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: question }],
        context
      })
    })
    
    const data = await res.json()
    
    return {
      source: 'cloud',
      content: data.content,
      latency_ms: performance.now() - startTime
    }
  }
}

export default new HybridGuideService()
```

### 4. Cloud Fallback Function

**File**: `overfly/netlify/functions/guide.js` (keep existing, minor updates)

**Changes**:
- Keep current Claude/Gemini implementation
- Add logging to track fallback usage
- No other changes needed

### 5. Model Hosting

**Options**:

**Option A: CDN (Recommended)**
- Host GGUF model on Netlify/Cloudflare
- Path: `/public/models/gemma-4-e2b-q4.bin`
- Pros: Simple, fast, cacheable
- Cons: 1.5GB file size (one-time download)

**Option B: Hugging Face**
- Load directly from HF Hub
- Pros: No hosting needed
- Cons: Slower initial load, CORS issues

**Option C: IndexedDB caching**
- Download once, cache in browser
- Pros: Subsequent loads instant
- Cons: Complex implementation

**Recommendation**: Start with Option A (CDN), add Option C (caching) later

### 6. Performance Optimization

**Model Loading**:
- Lazy load: Only load when user opens guide
- Show loading indicator: "Loading AI guide..."
- Cache in IndexedDB after first load
- Estimated load time: 10-30s on first load, <1s cached

**Inference**:
- WebGPU acceleration: ~100-500ms per response
- WASM fallback: ~1-3s per response
- Max tokens: 150 (keep responses short)

**Memory**:
- Model: ~1.5GB (quantized)
- Runtime: ~500MB
- Total: ~2GB (acceptable for modern devices)

## Data Flow

### Scenario 1: Simple POI Question (On-Device)

```
User: "How tall is Mount Rainier?"
  ↓
Router: POI data available? Yes
  ↓
Gemma: Query POI facts → elevation_ft: 14411
  ↓
Gemma: Generate response → "Mount Rainier stands at 14,411 feet..."
  ↓
Router: Confidence 0.9 → Return answer
  ↓
User sees answer (latency: 300ms)
```

### Scenario 2: Complex Question (Cloud Fallback)

```
User: "Compare Mount Rainier to Mount Hood in terms of climbing difficulty"
  ↓
Router: POI data available? Yes
  ↓
Gemma: Complex comparison → "ESCALATE"
  ↓
Router: Confidence 0.3 → Fallback to cloud
  ↓
Cloud LLM: Full reasoning → Detailed comparison
  ↓
User sees answer (latency: 2500ms)
```

### Scenario 3: No POI Data (Cloud Fallback)

```
User: "Tell me about the geology of the Cascades"
  ↓
Router: POI data available? No (general question)
  ↓
Router: Skip Gemma → Fallback to cloud
  ↓
Cloud LLM: General knowledge → Geology explanation
  ↓
User sees answer (latency: 2000ms)
```

## Technology Choices

### Gemma Runtime: iOS vs Android

| Feature | iOS (Core ML/MLX) | Android (MediaPipe/TFLite) |
|---------|-------------------|----------------------------|
| **Acceleration** | Neural Engine / GPU | GPU / NPU |
| **Model format** | .mlpackage / GGUF | .tflite / GGUF |
| **Bundle size** | ~1.5GB | ~1.5GB |
| **Inference speed** | 100-300ms | 150-500ms |
| **Memory** | ~2GB | ~2GB |
| **Maturity** | Stable | Stable |

**Recommendation**: 
- **iOS**: MLX (Apple Silicon optimized, GGUF support)
- **Android**: MediaPipe (official Google support for Gemma)

### Model Quantization

| Format | Size | Quality | Speed |
|--------|------|---------|-------|
| **FP16** | 4GB | 100% | Slow |
| **Q8** | 2GB | 98% | Medium |
| **Q4_K_M** | 1.5GB | 95% | Fast |
| **Q2_K** | 800MB | 85% | Fastest |

**Recommendation**: **Q4_K_M** (best size/quality tradeoff)

## Migration Strategy

### Phase 1: Proof of Concept (Week 1)
- [ ] Load Gemma 4 E2B in browser (MediaPipe)
- [ ] Test inference with sample POI data
- [ ] Measure latency and memory usage
- [ ] Validate WebGPU acceleration works

### Phase 2: Integration (Week 2)
- [ ] Create `guideService.js` with router logic
- [ ] Enhance route bundles with POI facts
- [ ] Implement confidence scoring
- [ ] Wire up to existing UI

### Phase 3: Fallback (Week 3)
- [ ] Keep existing cloud function as fallback
- [ ] Add telemetry (on-device vs cloud usage)
- [ ] Test escalation scenarios
- [ ] Optimize prompt engineering

### Phase 4: Optimization (Week 4)
- [ ] Add IndexedDB caching
- [ ] Implement progressive loading
- [ ] Tune confidence thresholds
- [ ] Monitor cost savings

## Open Questions

1. **Model hosting**: CDN vs HF Hub vs hybrid?
2. **Quantization level**: Q4_K_M vs Q2_K?
3. **Confidence threshold**: 0.7 vs 0.8?
4. **Fallback LLM**: Keep Claude or switch to Gemini?
5. **POI data size**: How many facts per POI?
6. **Corridor width**: 50nm vs 100nm for DIRECT routing?

## Success Metrics

- **Cost reduction**: 70%+ (target: $0.10/month vs $0.90/month)
- **Latency improvement**: 50%+ for simple queries
- **On-device hit rate**: 80%+ of queries
- **Quality**: No degradation in answer quality
- **Load time**: <30s first load, <1s cached
- **Memory**: <2GB total
