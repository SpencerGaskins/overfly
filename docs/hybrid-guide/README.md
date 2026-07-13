# Hybrid Guide: On-Device Gemma 4 E2B + Cloud Fallback

**Embed Gemma 4 E2B natively in FlightLevel mobile app with intelligent cloud fallback**

## Status: Draft

This spec documents the implementation of a hybrid AI guide architecture for the FlightLevel mobile app, combining on-device inference with cloud fallback for optimal cost, latency, and quality.

---

## Quick Navigation

- **[spec.md](./spec.md)** - Overview, goals, and context
- **[design.md](./design.md)** - Technical architecture and component design
- **[SETUP_GUIDE.md](./SETUP_GUIDE.md)** - Detailed setup for iOS and Android
- **[tasks.md](./tasks.md)** - Step-by-step implementation checklist

---

## What We're Building

### Current Architecture (Cloud-Only)
```
User Question → Netlify Function → Claude Haiku API → Response
Cost: $0.25-$1.25 per 1M tokens
Latency: 2-3 seconds
```

### New Architecture (Hybrid)
```
User Question → Router
                  ↓
         ┌────────┴────────┐
         ↓                 ↓
   Gemma 4 E2B      Cloud LLM
   (on-device)      (fallback)
   Free, <1s        Paid, 2-3s
         ↓                 ↓
         └────────┬────────┘
                  ↓
              Response
```

**Result**: 70%+ cost reduction, 50%+ latency improvement

---

## Key Features

### 1. On-Device AI (Gemma 4 E2B)
- **Model**: 2 billion parameters, quantized to 1.5GB
- **Platform**: iOS (MLX) and Android (MediaPipe)
- **Performance**: <1s inference on modern devices
- **Cost**: Free (no API calls)
- **Personality**: Adventurous and curious guide

### 2. Prepopulated POI Data
- **Facts**: Elevation, dates, numbers for each POI
- **Context**: LLM guidance for consistent responses
- **Corridor**: Width-based filtering for DIRECT routing
- **Offline**: Works without internet

### 3. Intelligent Fallback
- **Triggers**: Low confidence, complex queries, missing data
- **Cloud LLM**: Gemini or Anthropic for deep reasoning
- **Seamless**: User doesn't notice the switch
- **Telemetry**: Track on-device vs cloud usage

---

## Architecture Decisions

### Why Gemma 4 E2B?

| Feature | Gemma 4 E2B | Cloud LLM |
|---------|-------------|-----------|
| **Size** | 2B params | 70B+ params |
| **Latency** | <1s | 2-3s |
| **Cost** | Free | $0.25-$1.25/1M tokens |
| **Quality** | Good for facts | Excellent for reasoning |
| **Offline** | ✅ Yes | ❌ No |

**Decision**: Use Gemma for 80% of queries (simple facts), cloud for 20% (complex reasoning)

### Why Hybrid (Not Pure On-Device)?

| Approach | Pros | Cons |
|----------|------|------|
| **Cloud-only** | Best quality | High cost, slow |
| **On-device only** | Free, fast | Limited knowledge |
| **Hybrid** | Best of both | More complex |

**Decision**: Hybrid gives us cost savings + quality + speed

### Platform-Specific Choices

**iOS**:
- **Runtime**: MLX (Apple Silicon optimized)
- **Format**: GGUF quantized
- **Acceleration**: Neural Engine + GPU

**Android**:
- **Runtime**: MediaPipe (official Google support)
- **Format**: .bin (MediaPipe format)
- **Acceleration**: GPU / NPU

---

## Implementation Phases

### Phase 1: Model Preparation (1 week)
- Download/convert Gemma 4 E2B
- Choose quantization level (Q4_K_M recommended)
- Decide distribution strategy (download on launch)

### Phase 2: iOS Implementation (2 weeks)
- Add MLX Swift package
- Implement GemmaService
- Build hybrid router
- Integrate with UI

### Phase 3: Android Implementation (2 weeks)
- Add MediaPipe dependency
- Implement GemmaService
- Build hybrid router
- Integrate with UI

### Phase 4: POI Data Enhancement (1 week)
- Enhance route bundle schema
- Populate facts for SEA-DEN route
- Add corridor width logic

### Phase 5: Cloud Fallback (1 week)
- Keep existing cloud function
- Implement escalation logic
- Add telemetry

### Phase 6: Testing & Optimization (2 weeks)
- Performance testing
- Quality testing
- Cost analysis

### Phase 7: Deployment (1 week)
- App Store submission
- Play Store submission
- Monitor production

**Total**: 10 weeks (can parallelize iOS/Android to 8 weeks)

---

## Success Metrics

### Performance
- [ ] Model load time: <30s first launch, <1s cached
- [ ] Inference latency: <1s on-device
- [ ] Memory usage: <2GB total
- [ ] Battery impact: Minimal

### Quality
- [ ] On-device accuracy: 90%+ for factual questions
- [ ] Escalation accuracy: 95%+ (correct fallback decisions)
- [ ] No quality degradation vs cloud-only

### Cost
- [ ] On-device hit rate: 80%+
- [ ] Cost reduction: 70%+
- [ ] Monthly cost: <$0.30 (vs $0.90 cloud-only)

### User Experience
- [ ] Response time: 50%+ faster for simple queries
- [ ] Offline capability: Works without internet
- [ ] Personality: Adventurous and curious (user feedback)

---

## Technical Stack

### iOS
- **Language**: Swift
- **ML Framework**: MLX
- **Model Format**: GGUF (Q4_K_M)
- **Acceleration**: Neural Engine + GPU
- **Min iOS**: 17.0+

### Android
- **Language**: Kotlin
- **ML Framework**: MediaPipe
- **Model Format**: .bin (MediaPipe)
- **Acceleration**: GPU / NPU
- **Min Android**: 7.0+ (API 24+)

### Cloud Fallback
- **Platform**: Netlify Functions
- **LLM**: Gemini or Anthropic
- **Language**: JavaScript/Node.js

---

## File Structure

```
FlightLevel-iOS/
├── Services/
│   ├── GemmaService.swift          # On-device inference
│   ├── GuideRouter.swift           # Hybrid routing logic
│   └── CloudGuideService.swift     # Cloud fallback
├── Models/
│   └── gemma-4-e2b-q4.gguf        # Gemma model (1.5GB)
└── Data/
    └── route-bundles/
        └── SEA-DEN-v1.json         # POI facts

FlightLevel-Android/
├── app/src/main/
│   ├── kotlin/com/flightlevel/guide/
│   │   ├── GemmaService.kt         # On-device inference
│   │   ├── GuideRouter.kt          # Hybrid routing logic
│   │   └── CloudGuideService.kt    # Cloud fallback
│   └── assets/models/
│       └── gemma-4-e2b-q4.bin      # Gemma model (1.5GB)

overfly/
└── netlify/functions/
    └── guide.js                     # Cloud fallback function
```

---

## Getting Started

### For iOS Developers

1. **Read the setup guide**: [SETUP_GUIDE.md](./SETUP_GUIDE.md#ios-setup-swift)
2. **Download model**: Get Gemma 4 E2B GGUF
3. **Add MLX**: Install MLX Swift package
4. **Implement service**: Create GemmaService.swift
5. **Test**: Run on device

### For Android Developers

1. **Read the setup guide**: [SETUP_GUIDE.md](./SETUP_GUIDE.md#android-setup-kotlin)
2. **Download model**: Get Gemma 4 E2B .bin
3. **Add MediaPipe**: Update Gradle dependencies
4. **Implement service**: Create GemmaService.kt
5. **Test**: Run on device

### For Backend Developers

1. **Review cloud function**: `overfly/netlify/functions/guide.js`
2. **Add telemetry**: Track fallback usage
3. **No other changes needed**: Existing function works as fallback

---

## Open Questions

### Model Distribution
- [ ] Bundle with app (1.5GB) or download on launch?
- [ ] Use Q4_K_M (1.5GB, better quality) or Q2_K (800MB, faster)?
- [ ] CDN hosting or Hugging Face direct download?

### Confidence Scoring
- [ ] Threshold: 0.7 or 0.8?
- [ ] Heuristics: Length, specificity, "ESCALATE" keyword?
- [ ] Machine learning approach for confidence?

### POI Data
- [ ] How many facts per POI? (5-10 recommended)
- [ ] Corridor width: 50nm or 100nm?
- [ ] Update frequency: Manual or automated?

### Fallback LLM
- [ ] Keep Claude Haiku or switch to Gemini?
- [ ] Cost comparison: Which is cheaper for fallback?
- [ ] Quality comparison: Which gives better responses?

---

## Resources

### Documentation
- [Gemma 4 Release](https://ai.google.dev/gemma/docs/releases)
- [MLX Swift](https://github.com/ml-explore/mlx-swift)
- [MediaPipe LLM](https://developers.google.com/mediapipe/solutions/genai/llm_inference)
- [Hugging Face Models](https://huggingface.co/google/gemma-4-E2B-it)

### Tools
- [Hugging Face CLI](https://huggingface.co/docs/huggingface_hub/guides/cli)
- [GGUF Quantization](https://github.com/ggerganov/llama.cpp)
- [Core ML Tools](https://coremltools.readme.io/)

### Community
- [Gemma Discord](https://discord.gg/gemma)
- [MLX Community](https://github.com/ml-explore/mlx/discussions)
- [MediaPipe Forum](https://groups.google.com/g/mediapipe)

---

## Next Steps

1. **Review the spec** - Read spec.md and design.md
2. **Choose platform** - iOS, Android, or both?
3. **Read setup guide** - SETUP_GUIDE.md for your platform
4. **Start with Phase 1** - Download and test model
5. **Follow tasks.md** - Step-by-step implementation

**Questions?** Open an issue or discuss in team chat.

---

## Notes

- This is a **design-first spec** - we're planning before building
- Goal: **Single tested deployment** - no wasted effort
- Focus: **Native mobile implementation** - not web
- Personality: **Adventurous and curious** - different from web version
- Timeline: **8-10 weeks** - can parallelize iOS/Android

**Ready to start?** → Open [SETUP_GUIDE.md](./SETUP_GUIDE.md) and begin with Phase 1.
