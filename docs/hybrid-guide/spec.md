# Hybrid Guide: On-Device Gemma 4 + Cloud Fallback

**Status**: Draft  
**Created**: 2026-05-18  
**Owner**: Spencer

## Overview

Replace the current cloud-only guide (Claude Haiku) with a **hybrid architecture**:
- **Primary**: Gemma 4 E2B running on-device (in FlightLevel mobile app)
- **Fallback**: Cloud LLM (Gemini or Anthropic) for complex queries
- **Personality**: Adventurous and curious guide (different from web version)

## Context

**Current architecture** (cloud-only):
- All guide queries go to Netlify function → Claude Haiku API
- Cost: ~$0.25-$1.25 per 1M tokens
- Latency: Network round-trip + API processing
- Requires internet connection

**New architecture** (hybrid):
- Simple POI questions → Gemma 4 E2B (on-device, instant, free)
- Complex/unknown queries → Cloud LLM (fallback, slower, costs money)
- POI data prepopulated in route bundle (offline-capable)

## Goals

1. **Run Gemma 4 E2B in FlightLevel mobile app** using native ML frameworks
2. **Prepopulate POI data** in route bundles (with corridor "width" for DIRECT routing)
3. **Implement smart fallback** - detect when Gemma can't answer, escalate to cloud
4. **Reduce costs** - 80%+ of queries handled on-device (free)
5. **Improve latency** - on-device responses in <1s vs 2-3s cloud
6. **Adventurous personality** - curious, exploratory tone (different from web's matter-of-fact style)
7. **Maintain quality** - complex queries still get full LLM treatment

## Non-Goals

- Replacing turbulence/weather functions (those stay cloud-based)
- Running Gemma on server-side (it's client-side only)
- Removing cloud LLM entirely (it's the fallback)
- Training/fine-tuning Gemma (using pre-trained model)

## Key Decisions

### Platform: Mobile App (Not Web)

**FlightLevel has two versions**:
1. **Web app** (overfly/) - Current implementation, uses cloud-only guide
2. **Mobile app** (FlightLevel App2) - New implementation, will use hybrid guide

**This spec is for the mobile app only.**

### Why Gemma 4 E2B?

- **Size**: 2B parameters (small enough for browser)
- **Performance**: Runs on WebGPU (fast inference)
- **License**: Apache 2.0 (open source, no restrictions)
- **Quality**: Sufficient for POI facts with prepopulated context

### Why Hybrid (not pure on-device)?

- **Coverage**: Gemma can't answer everything (limited knowledge cutoff)
- **Complexity**: Some queries need deeper reasoning (cloud LLM better)
- **Fallback**: Graceful degradation when on-device fails
- **Cost/Quality balance**: Free for simple, paid for complex

### Fallback Trigger Logic

**Use on-device Gemma when**:
- Query is about active POI
- Query is factual ("How tall?", "When was it built?")
- POI data is in route bundle
- Confidence score > threshold

**Escalate to cloud when**:
- Gemma returns low confidence
- Query is complex ("Compare this to...", "Why is...")
- Query is about something not in POI data
- Gemma explicitly says "I don't know"

## Success Criteria

- [ ] Gemma 4 E2B loads in browser (<5s initial load)
- [ ] POI data bundled with routes (no extra network calls)
- [ ] 80%+ of queries answered on-device
- [ ] Fallback to cloud works seamlessly
- [ ] Total cost reduced by 70%+
- [ ] Response time <1s for on-device, <3s for cloud
- [ ] No degradation in answer quality
