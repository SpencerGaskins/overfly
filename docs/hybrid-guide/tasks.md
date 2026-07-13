# Tasks: Hybrid Guide Implementation

## Phase 1: Model Preparation

### TASK-1: Choose Model Quantization
**Status**: pending  
**Description**: Select quantization level based on size/quality tradeoff  
**Options**:
- Q4_K_M: 1.5GB, 95% quality (recommended)
- Q2_K: 800MB, 85% quality (if size constrained)

**Steps**:
1. Review device storage constraints
2. Test both quantizations if possible
3. Document choice in spec

**Acceptance**:
- [ ] Quantization level chosen
- [ ] Rationale documented

---

### TASK-2: Download/Convert Gemma 4 E2B Model
**Status**: pending  
**Platform**: Both iOS and Android  
**Description**: Obtain model files in correct format for each platform

**iOS (MLX - GGUF format)**:
```bash
# Install Hugging Face CLI
pip install huggingface-hub

# Download quantized GGUF
huggingface-cli download \
  bartowski/gemma-4-E2B-it-GGUF \
  gemma-4-E2B-it-Q4_K_M.gguf \
  --local-dir ./ios-models
```

**Android (MediaPipe - .bin format)**:
```bash
# Download MediaPipe-compatible model
huggingface-cli download \
  google/gemma-4-E2B-it \
  gemma-4-e2b-it-cpu.bin \
  --local-dir ./android-models
```

**Acceptance**:
- [ ] iOS model downloaded (GGUF format)
- [ ] Android model downloaded (.bin format)
- [ ] Model sizes verified (~1.5GB for Q4, ~800MB for Q2)

---

### TASK-3: Decide Model Distribution Strategy
**Status**: pending  
**Description**: Choose how to deliver model to users

**Options**:
1. **Bundle with app** - Simple, works offline, large download
2. **Download on first launch** - Smaller app, requires internet
3. **Hybrid** - Bundle Q2, offer Q4 download

**Recommendation**: Download on first launch (keeps app size manageable)

**Acceptance**:
- [ ] Strategy chosen
- [ ] Implementation approach documented

---

## Phase 2: iOS Implementation

### TASK-4: Setup iOS Project Dependencies
**Status**: pending  
**Platform**: iOS  
**Description**: Add MLX Swift package to Xcode project

**Steps**:
1. Open FlightLevel iOS project in Xcode
2. File → Add Package Dependencies
3. Enter: `https://github.com/ml-explore/mlx-swift`
4. Select version 0.10.0+
5. Add to app target

**Acceptance**:
- [ ] MLX Swift package added
- [ ] Project builds without errors

---

### TASK-5: Add Model to iOS Project
**Status**: pending  
**Platform**: iOS  
**Description**: Bundle or setup model download

**If bundling**:
1. Drag `gemma-4-E2B-it-Q4_K_M.gguf` into Xcode
2. Check "Copy items if needed"
3. Add to target membership
4. Verify in "Copy Bundle Resources" build phase

**If downloading**:
1. Create `ModelDownloader.swift`
2. Implement download logic (see SETUP_GUIDE.md)
3. Add progress UI

**Acceptance**:
- [ ] Model accessible in app
- [ ] File path verified

---

### TASK-6: Implement iOS GemmaService
**Status**: pending  
**Platform**: iOS  
**File**: `Services/GemmaService.swift`

**Implementation**:
```swift
import Foundation
import MLX
import MLXLLM

class GemmaService {
    static let shared = GemmaService()
    private var model: LLMModel?
    
    func loadModel() async throws {
        // Implementation from SETUP_GUIDE.md
    }
    
    func generate(prompt: String) async throws -> String {
        // Implementation from SETUP_GUIDE.md
    }
    
    var isLoaded: Bool {
        return model != nil
    }
}
```

**Acceptance**:
- [ ] GemmaService.swift created
- [ ] Model loading works
- [ ] Inference works
- [ ] Unit tests pass

---

### TASK-7: Implement iOS Hybrid Router
**Status**: pending  
**Platform**: iOS  
**File**: `Services/GuideRouter.swift`

**Implementation**:
```swift
class GuideRouter {
    private let gemmaService = GemmaService.shared
    private let cloudService = CloudGuideService()
    
    func ask(question: String, poi: POI, context: FlightContext) async -> GuideResponse {
        // Try Gemma first
        if gemmaService.isLoaded, let poiData = poi.facts {
            let prompt = buildPrompt(question: question, poi: poi, context: context)
            
            if let response = try? await gemmaService.generate(prompt: prompt) {
                let confidence = calculateConfidence(response)
                
                if confidence > 0.7 {
                    return GuideResponse(
                        content: response,
                        source: .onDevice,
                        latency: /* measure */
                    )
                }
            }
        }
        
        // Fallback to cloud
        return await cloudService.ask(question: question, poi: poi, context: context)
    }
    
    private func buildPrompt(question: String, poi: POI, context: FlightContext) -> String {
        // Adventurous & curious personality
    }
    
    private func calculateConfidence(_ response: String) -> Double {
        // Heuristic: check for "ESCALATE", length, specificity
    }
}
```

**Acceptance**:
- [ ] GuideRouter.swift created
- [ ] On-device path works
- [ ] Cloud fallback works
- [ ] Confidence scoring implemented

---

### TASK-8: iOS UI Integration
**Status**: pending  
**Platform**: iOS  
**Description**: Wire up guide to UI

**Steps**:
1. Add loading indicator for model load
2. Update guide chat UI to use GuideRouter
3. Show source badge (on-device vs cloud)
4. Handle errors gracefully

**Acceptance**:
- [ ] Guide UI uses new router
- [ ] Loading states handled
- [ ] Error states handled
- [ ] Source indicator visible

---

## Phase 3: Android Implementation

### TASK-9: Setup Android Project Dependencies
**Status**: pending  
**Platform**: Android  
**Description**: Add MediaPipe to Gradle

**File**: `app/build.gradle.kts`

```kotlin
dependencies {
    implementation("com.google.mediapipe:tasks-genai:0.10.14")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3")
}
```

**Acceptance**:
- [ ] Dependencies added
- [ ] Gradle sync successful
- [ ] Project builds

---

### TASK-10: Add Model to Android Project
**Status**: pending  
**Platform**: Android  
**Description**: Add model to assets or implement download

**If bundling**:
1. Create `app/src/main/assets/models/` directory
2. Copy `gemma-4-e2b-it-cpu.bin` into it
3. Verify in APK

**If downloading**:
1. Create `ModelDownloader.kt`
2. Implement download logic
3. Add progress UI

**Acceptance**:
- [ ] Model accessible in app
- [ ] File path verified

---

### TASK-11: Implement Android GemmaService
**Status**: pending  
**Platform**: Android  
**File**: `com/flightlevel/guide/GemmaService.kt`

**Implementation**:
```kotlin
class GemmaService(private val context: Context) {
    private var llmInference: LlmInference? = null
    
    suspend fun loadModel() {
        // Implementation from SETUP_GUIDE.md
    }
    
    suspend fun generate(prompt: String): String {
        // Implementation from SETUP_GUIDE.md
    }
    
    fun isLoaded(): Boolean = llmInference != null
}
```

**Acceptance**:
- [ ] GemmaService.kt created
- [ ] Model loading works
- [ ] Inference works
- [ ] Unit tests pass

---

### TASK-12: Implement Android Hybrid Router
**Status**: pending  
**Platform**: Android  
**File**: `com/flightlevel/guide/GuideRouter.kt`

**Implementation**:
```kotlin
class GuideRouter(
    private val gemmaService: GemmaService,
    private val cloudService: CloudGuideService
) {
    suspend fun ask(question: String, poi: POI, context: FlightContext): GuideResponse {
        // Try Gemma first
        if (gemmaService.isLoaded() && poi.facts != null) {
            val prompt = buildPrompt(question, poi, context)
            
            try {
                val response = gemmaService.generate(prompt)
                val confidence = calculateConfidence(response)
                
                if (confidence > 0.7) {
                    return GuideResponse(
                        content = response,
                        source = Source.ON_DEVICE,
                        latency = /* measure */
                    )
                }
            } catch (e: Exception) {
                // Fall through to cloud
            }
        }
        
        // Fallback to cloud
        return cloudService.ask(question, poi, context)
    }
    
    private fun buildPrompt(question: String, poi: POI, context: FlightContext): String {
        // Adventurous & curious personality
    }
    
    private fun calculateConfidence(response: String): Double {
        // Heuristic: check for "ESCALATE", length, specificity
    }
}
```

**Acceptance**:
- [ ] GuideRouter.kt created
- [ ] On-device path works
- [ ] Cloud fallback works
- [ ] Confidence scoring implemented

---

### TASK-13: Android UI Integration
**Status**: pending  
**Platform**: Android  
**Description**: Wire up guide to UI

**Steps**:
1. Add loading indicator for model load
2. Update guide chat UI to use GuideRouter
3. Show source badge (on-device vs cloud)
4. Handle errors gracefully

**Acceptance**:
- [ ] Guide UI uses new router
- [ ] Loading states handled
- [ ] Error states handled
- [ ] Source indicator visible

---

## Phase 4: POI Data Enhancement

### TASK-14: Enhance Route Bundle Schema
**Status**: pending  
**Platform**: Both  
**Description**: Add POI facts to route bundles

**Current schema**:
```json
{
  "pois": [
    {
      "id": "mount-rainier",
      "title": "Mount Rainier",
      "lat": 46.8523,
      "lon": -121.7603
    }
  ]
}
```

**New schema**:
```json
{
  "pois": [
    {
      "id": "mount-rainier",
      "title": "Mount Rainier",
      "lat": 46.8523,
      "lon": -121.7603,
      "distance_from_route_nm": 12,
      "facts": {
        "elevation_ft": 14411,
        "prominence_ft": 13210,
        "first_summit": "1870",
        "volcano_type": "stratovolcano",
        "last_eruption": "1894",
        "glaciers": 25,
        "national_park_established": "1899",
        "indigenous_name": "Tahoma",
        "annual_climbers": 10000
      },
      "summary": "Mount Rainier is an active stratovolcano...",
      "context_for_llm": "When discussing Mount Rainier, emphasize..."
    }
  ]
}
```

**Acceptance**:
- [ ] Schema updated
- [ ] Sample route bundle created
- [ ] Validation added

---

### TASK-15: Populate POI Facts for SEA-DEN Route
**Status**: pending  
**Platform**: Both  
**Description**: Research and add facts for all POIs on SEA-DEN route

**POIs to populate**:
- Mount Rainier
- Mount St. Helens
- Columbia River Gorge
- Mount Hood
- Crater Lake
- Cascade Range
- Rocky Mountains
- Denver

**For each POI, add**:
- 5-10 key facts (elevation, dates, numbers)
- 2-3 sentence summary
- Context guidance for LLM

**Acceptance**:
- [ ] All SEA-DEN POIs have facts
- [ ] Facts verified for accuracy
- [ ] Route bundle updated

---

### TASK-16: Add Corridor Width for DIRECT Routing
**Status**: pending  
**Platform**: Both  
**Description**: Define corridor width for POI inclusion

**Implementation**:
```json
{
  "route": "SEA-DEN",
  "corridor": {
    "centerline": [...],
    "width_nm": 50
  }
}
```

**Logic**:
- POIs within 50nm of centerline: "on your route"
- POIs 50-100nm: "nearby, slightly off route"
- POIs >100nm: not shown

**Acceptance**:
- [ ] Corridor width defined
- [ ] POI filtering logic implemented
- [ ] Tested with DIRECT routing

---

## Phase 5: Cloud Fallback

### TASK-17: Keep Existing Cloud Function
**Status**: pending  
**Platform**: Both  
**Description**: Ensure cloud fallback still works

**File**: `overfly/netlify/functions/guide.js`

**Changes needed**:
- Add telemetry to track fallback usage
- Add source indicator in response
- No other changes

**Acceptance**:
- [ ] Cloud function still works
- [ ] Telemetry added
- [ ] Response format unchanged

---

### TASK-18: Implement Fallback Logic
**Status**: pending  
**Platform**: Both  
**Description**: Define when to escalate to cloud

**Escalation triggers**:
1. Gemma not loaded
2. No POI data available
3. Gemma returns "ESCALATE"
4. Confidence score < 0.7
5. Inference error

**Acceptance**:
- [ ] All triggers implemented
- [ ] Fallback tested
- [ ] Latency acceptable

---

## Phase 6: Testing & Optimization

### TASK-19: Performance Testing
**Status**: pending  
**Platform**: Both  
**Description**: Measure and optimize performance

**Metrics to measure**:
- Model load time (target: <30s first, <1s cached)
- Inference latency (target: <1s)
- Memory usage (target: <2GB)
- Battery impact

**Test devices**:
- iOS: iPhone 12+, iPad Pro
- Android: Pixel 6+, Samsung Galaxy S21+

**Acceptance**:
- [ ] All metrics within targets
- [ ] Performance documented

---

### TASK-20: Quality Testing
**Status**: pending  
**Platform**: Both  
**Description**: Verify answer quality

**Test cases**:
- Simple factual questions (should use on-device)
- Complex reasoning questions (should escalate)
- Unknown POIs (should escalate)
- Multi-turn conversations

**Acceptance**:
- [ ] On-device answers are accurate
- [ ] Escalation works correctly
- [ ] No quality degradation vs cloud-only

---

### TASK-21: Cost Analysis
**Status**: pending  
**Platform**: Both  
**Description**: Measure cost savings

**Metrics**:
- % queries handled on-device
- Cloud API costs before/after
- Estimated monthly savings

**Target**: 70%+ cost reduction

**Acceptance**:
- [ ] Telemetry implemented
- [ ] Cost savings measured
- [ ] Target achieved

---

## Phase 7: Deployment

### TASK-22: iOS App Store Submission
**Status**: pending  
**Platform**: iOS  
**Description**: Submit updated app to App Store

**Steps**:
1. Update version number
2. Test on TestFlight
3. Submit for review
4. Monitor for crashes

**Acceptance**:
- [ ] App approved
- [ ] No crashes reported
- [ ] User feedback positive

---

### TASK-23: Android Play Store Submission
**Status**: pending  
**Platform**: Android  
**Description**: Submit updated app to Play Store

**Steps**:
1. Update version number
2. Test on internal track
3. Roll out to beta
4. Roll out to production

**Acceptance**:
- [ ] App approved
- [ ] No crashes reported
- [ ] User feedback positive

---

### TASK-24: Monitor & Iterate
**Status**: pending  
**Platform**: Both  
**Description**: Monitor production usage

**Metrics to track**:
- On-device hit rate
- Cloud fallback rate
- Average latency
- Error rate
- User satisfaction

**Acceptance**:
- [ ] Monitoring dashboard created
- [ ] Alerts configured
- [ ] Weekly review scheduled

---

## Task Dependencies

```
Phase 1 (Model Prep)
  ↓
Phase 2 (iOS) + Phase 3 (Android) [parallel]
  ↓
Phase 4 (POI Data)
  ↓
Phase 5 (Cloud Fallback)
  ↓
Phase 6 (Testing)
  ↓
Phase 7 (Deployment)
```

## Estimated Timeline

- **Phase 1**: 1 week (model prep)
- **Phase 2**: 2 weeks (iOS implementation)
- **Phase 3**: 2 weeks (Android implementation)
- **Phase 4**: 1 week (POI data)
- **Phase 5**: 1 week (cloud fallback)
- **Phase 6**: 2 weeks (testing)
- **Phase 7**: 1 week (deployment)

**Total**: 10 weeks (2.5 months)

**Can be parallelized**: iOS and Android work can happen simultaneously (reduces to 8 weeks)
