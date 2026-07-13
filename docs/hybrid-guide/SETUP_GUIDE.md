# Gemma 4 E2B Native Setup Guide

## Overview

This guide walks through embedding Gemma 4 E2B (2 billion parameter model) natively in the FlightLevel mobile app for both iOS and Android platforms.

---

## iOS Setup (Swift)

### Prerequisites

- Xcode 15.0+
- iOS 17.0+ target
- macOS with Apple Silicon (for testing)
- ~2GB free storage for model

### Option 1: MLX (Recommended for Apple Silicon)

**MLX** is Apple's machine learning framework optimized for Apple Silicon.

#### 1. Install MLX Swift

Add to your `Package.swift`:

```swift
dependencies: [
    .package(url: "https://github.com/ml-explore/mlx-swift", from: "0.10.0")
]
```

Or via Xcode:
1. File → Add Package Dependencies
2. Enter: `https://github.com/ml-explore/mlx-swift`
3. Add to your app target

#### 2. Download Gemma 4 E2B Model

**Option A: Pre-quantized GGUF** (Recommended)

```bash
# Download from Hugging Face
huggingface-cli download \
  google/gemma-4-E2B-it \
  --include "*.gguf" \
  --local-dir ./models

# Or use a quantized version (smaller, faster)
huggingface-cli download \
  bartowski/gemma-4-E2B-it-GGUF \
  gemma-4-E2B-it-Q4_K_M.gguf \
  --local-dir ./models
```

**Option B: Convert from Hugging Face**

```bash
# Install conversion tools
pip install mlx-lm

# Convert to MLX format
python -m mlx_lm.convert \
  --hf-path google/gemma-4-E2B-it \
  --mlx-path ./models/gemma-4-e2b-mlx \
  --quantize
```

#### 3. Add Model to Xcode Project

1. Drag `gemma-4-E2B-it-Q4_K_M.gguf` into Xcode
2. Target Membership: Check your app target
3. Add to Copy Bundle Resources

#### 4. Implement Gemma Service (Swift)

Create `GemmaService.swift`:

```swift
import Foundation
import MLX
import MLXLLM

class GemmaService {
    private var model: LLMModel?
    private let modelName = "gemma-4-E2B-it-Q4_K_M"
    
    // Singleton
    static let shared = GemmaService()
    private init() {}
    
    // Load model (call on app launch or lazy load)
    func loadModel() async throws {
        guard let modelPath = Bundle.main.path(forResource: modelName, ofType: "gguf") else {
            throw GemmaError.modelNotFound
        }
        
        let config = ModelConfiguration(
            maxTokens: 150,
            temperature: 0.7,
            topP: 0.9
        )
        
        self.model = try await LLMModel.load(path: modelPath, configuration: config)
        print("[Gemma] Model loaded successfully")
    }
    
    // Generate response
    func generate(prompt: String) async throws -> String {
        guard let model = self.model else {
            throw GemmaError.modelNotLoaded
        }
        
        let response = try await model.generate(prompt: prompt)
        return response.text
    }
    
    // Check if model is ready
    var isLoaded: Bool {
        return model != nil
    }
}

enum GemmaError: Error {
    case modelNotFound
    case modelNotLoaded
    case inferenceError
}
```

#### 5. Usage Example

```swift
// In your app initialization (AppDelegate or @main)
Task {
    do {
        try await GemmaService.shared.loadModel()
    } catch {
        print("Failed to load Gemma: \(error)")
    }
}

// In your guide view
func askGemma(question: String, poi: POI) async -> String {
    let prompt = buildPrompt(question: question, poi: poi)
    
    do {
        let answer = try await GemmaService.shared.generate(prompt: prompt)
        return answer
    } catch {
        // Fallback to cloud
        return await fallbackToCloud(question: question, poi: poi)
    }
}

func buildPrompt(question: String, poi: POI) -> String {
    return """
    You are an adventurous and curious guide for FlightLevel passengers.
    
    POI: \(poi.title)
    Facts: \(poi.facts)
    
    Question: \(question)
    
    Answer with curiosity and wonder (under 120 words).
    """
}
```

### Option 2: Core ML

**Core ML** is Apple's native ML framework with broader device support.

#### 1. Convert Model to Core ML

```bash
# Install coremltools
pip install coremltools transformers torch

# Convert script (convert_to_coreml.py)
import coremltools as ct
from transformers import AutoModelForCausalLM, AutoTokenizer

model_id = "google/gemma-4-E2B-it"
model = AutoModelForCausalLM.from_pretrained(model_id)
tokenizer = AutoTokenizer.from_pretrained(model_id)

# Convert to Core ML
mlmodel = ct.convert(
    model,
    convert_to="mlprogram",
    compute_units=ct.ComputeUnit.ALL,
    minimum_deployment_target=ct.target.iOS17
)

# Save
mlmodel.save("Gemma4E2B.mlpackage")
```

#### 2. Add to Xcode

1. Drag `Gemma4E2B.mlpackage` into Xcode
2. Xcode auto-generates Swift interface
3. Use generated class:

```swift
import CoreML

class GemmaService {
    private var model: Gemma4E2B?
    
    func loadModel() {
        self.model = try? Gemma4E2B(configuration: MLModelConfiguration())
    }
    
    func generate(prompt: String) -> String {
        guard let model = self.model else { return "" }
        
        let input = Gemma4E2BInput(prompt: prompt)
        let output = try? model.prediction(input: input)
        
        return output?.generatedText ?? ""
    }
}
```

---

## Android Setup (Kotlin)

### Prerequisites

- Android Studio Hedgehog (2023.1.1)+
- Android SDK 24+ (Android 7.0+)
- ~2GB free storage for model
- Device with GPU/NPU recommended

### Option 1: MediaPipe (Recommended)

**MediaPipe** is Google's official framework with native Gemma support.

#### 1. Add Dependencies

In `app/build.gradle.kts`:

```kotlin
dependencies {
    // MediaPipe LLM Inference
    implementation("com.google.mediapipe:tasks-genai:0.10.14")
    
    // Coroutines for async
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3")
}
```

#### 2. Download Gemma 4 E2B Model

```bash
# Download quantized model
wget https://huggingface.co/google/gemma-4-E2B-it/resolve/main/gemma-4-e2b-it-q4.bin

# Or use Hugging Face CLI
huggingface-cli download \
  google/gemma-4-E2B-it \
  gemma-4-e2b-it-q4.bin \
  --local-dir ./app/src/main/assets/models
```

#### 3. Add Model to Assets

1. Create `app/src/main/assets/models/` directory
2. Copy `gemma-4-e2b-it-q4.bin` into it
3. Model will be bundled with APK

**Note**: For large models (>100MB), consider downloading on first launch instead of bundling.

#### 4. Implement Gemma Service (Kotlin)

Create `GemmaService.kt`:

```kotlin
package com.flightlevel.guide

import android.content.Context
import com.google.mediapipe.tasks.genai.llminference.LlmInference
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class GemmaService(private val context: Context) {
    private var llmInference: LlmInference? = null
    
    companion object {
        private const val MODEL_PATH = "models/gemma-4-e2b-it-q4.bin"
        private const val MAX_TOKENS = 150
        private const val TEMPERATURE = 0.7f
        private const val TOP_K = 40
    }
    
    // Load model (call on app launch or lazy load)
    suspend fun loadModel() = withContext(Dispatchers.IO) {
        try {
            val options = LlmInference.LlmInferenceOptions.builder()
                .setModelPath(MODEL_PATH)
                .setMaxTokens(MAX_TOKENS)
                .setTemperature(TEMPERATURE)
                .setTopK(TOP_K)
                .build()
            
            llmInference = LlmInference.createFromOptions(context, options)
            println("[Gemma] Model loaded successfully")
        } catch (e: Exception) {
            println("[Gemma] Failed to load model: ${e.message}")
            throw e
        }
    }
    
    // Generate response
    suspend fun generate(prompt: String): String = withContext(Dispatchers.Default) {
        val inference = llmInference ?: throw IllegalStateException("Model not loaded")
        
        try {
            val response = inference.generateResponse(prompt)
            response ?: ""
        } catch (e: Exception) {
            println("[Gemma] Inference error: ${e.message}")
            throw e
        }
    }
    
    // Check if model is ready
    fun isLoaded(): Boolean = llmInference != null
    
    // Clean up
    fun close() {
        llmInference?.close()
        llmInference = null
    }
}
```

#### 5. Usage Example

```kotlin
// In your Application class
class FlightLevelApp : Application() {
    lateinit var gemmaService: GemmaService
    
    override fun onCreate() {
        super.onCreate()
        
        gemmaService = GemmaService(this)
        
        // Load model asynchronously
        lifecycleScope.launch {
            try {
                gemmaService.loadModel()
            } catch (e: Exception) {
                Log.e("App", "Failed to load Gemma", e)
            }
        }
    }
}

// In your guide activity/fragment
class GuideFragment : Fragment() {
    private val gemmaService by lazy { 
        (requireActivity().application as FlightLevelApp).gemmaService 
    }
    
    private fun askGemma(question: String, poi: POI) {
        lifecycleScope.launch {
            val prompt = buildPrompt(question, poi)
            
            try {
                val answer = gemmaService.generate(prompt)
                displayAnswer(answer)
            } catch (e: Exception) {
                // Fallback to cloud
                val answer = fallbackToCloud(question, poi)
                displayAnswer(answer)
            }
        }
    }
    
    private fun buildPrompt(question: String, poi: POI): String {
        return """
            You are an adventurous and curious guide for FlightLevel passengers.
            
            POI: ${poi.title}
            Facts: ${poi.facts}
            
            Question: $question
            
            Answer with curiosity and wonder (under 120 words).
        """.trimIndent()
    }
}
```

### Option 2: TensorFlow Lite

**TensorFlow Lite** offers broader device compatibility.

#### 1. Add Dependencies

```kotlin
dependencies {
    implementation("org.tensorflow:tensorflow-lite:2.14.0")
    implementation("org.tensorflow:tensorflow-lite-gpu:2.14.0")
    implementation("org.tensorflow:tensorflow-lite-support:0.4.4")
}
```

#### 2. Convert Model to TFLite

```bash
# Install TensorFlow
pip install tensorflow transformers

# Convert script (convert_to_tflite.py)
import tensorflow as tf
from transformers import TFAutoModelForCausalLM

model = TFAutoModelForCausalLM.from_pretrained("google/gemma-4-E2B-it")

# Convert
converter = tf.lite.TFLiteConverter.from_keras_model(model)
converter.optimizations = [tf.lite.Optimize.DEFAULT]
converter.target_spec.supported_types = [tf.float16]

tflite_model = converter.convert()

# Save
with open("gemma-4-e2b.tflite", "wb") as f:
    f.write(tflite_model)
```

#### 3. Use in Android

```kotlin
import org.tensorflow.lite.Interpreter

class GemmaService(context: Context) {
    private var interpreter: Interpreter? = null
    
    fun loadModel() {
        val modelFile = loadModelFile(context, "gemma-4-e2b.tflite")
        interpreter = Interpreter(modelFile)
    }
    
    fun generate(prompt: String): String {
        // TFLite inference implementation
        // (More complex - requires tokenization)
    }
}
```

---

## Model Download Strategies

### Strategy 1: Bundle with App (Simple)

**Pros**:
- Works offline immediately
- No download UI needed

**Cons**:
- Large APK/IPA size (~1.5GB)
- App store limits (iOS: 4GB, Android: 150MB without expansion)

**Implementation**:
- Add model to assets (Android) or bundle resources (iOS)
- Use for Q2_K quantization (~800MB)

### Strategy 2: Download on First Launch (Recommended)

**Pros**:
- Smaller app download
- Can update model without app update

**Cons**:
- Requires internet on first launch
- Need download UI and error handling

**Implementation**:

```kotlin
// Android example
class ModelDownloader(private val context: Context) {
    private val modelUrl = "https://your-cdn.com/gemma-4-e2b-q4.bin"
    private val modelPath = "${context.filesDir}/models/gemma-4-e2b-q4.bin"
    
    suspend fun downloadIfNeeded(onProgress: (Int) -> Unit): Boolean {
        if (File(modelPath).exists()) {
            return true // Already downloaded
        }
        
        return withContext(Dispatchers.IO) {
            try {
                val request = DownloadManager.Request(Uri.parse(modelUrl))
                    .setDestinationUri(Uri.fromFile(File(modelPath)))
                    .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE)
                
                val downloadManager = context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
                val downloadId = downloadManager.enqueue(request)
                
                // Monitor progress
                monitorDownload(downloadManager, downloadId, onProgress)
                
                true
            } catch (e: Exception) {
                false
            }
        }
    }
}
```

### Strategy 3: Hybrid (Bundle Small, Download Large)

**Pros**:
- Best of both worlds
- Fallback if download fails

**Cons**:
- More complex implementation

**Implementation**:
- Bundle Q2_K (~800MB) with app
- Offer optional Q4_K (~1.5GB) download for better quality

---

## Performance Optimization

### iOS Optimization

```swift
// Use Metal for GPU acceleration
let config = ModelConfiguration(
    computeUnits: .cpuAndGPU,  // or .all
    maxTokens: 150,
    temperature: 0.7
)

// Preload model on app launch
Task(priority: .high) {
    try await GemmaService.shared.loadModel()
}

// Cache responses
class ResponseCache {
    private var cache: [String: String] = [:]
    
    func get(prompt: String) -> String? {
        return cache[prompt]
    }
    
    func set(prompt: String, response: String) {
        cache[prompt] = response
    }
}
```

### Android Optimization

```kotlin
// Use GPU delegate
val options = LlmInference.LlmInferenceOptions.builder()
    .setModelPath(MODEL_PATH)
    .setDelegate(LlmInference.Delegate.GPU)  // or .NNAPI
    .build()

// Preload model on app launch
class FlightLevelApp : Application() {
    override fun onCreate() {
        super.onCreate()
        
        // Load in background
        lifecycleScope.launch(Dispatchers.IO) {
            gemmaService.loadModel()
        }
    }
}

// Implement response caching
object ResponseCache {
    private val cache = LruCache<String, String>(50)
    
    fun get(prompt: String): String? = cache.get(prompt)
    fun put(prompt: String, response: String) = cache.put(prompt, response)
}
```

---

## Testing

### Unit Tests

```swift
// iOS
func testGemmaInference() async throws {
    try await GemmaService.shared.loadModel()
    
    let prompt = "What is Mount Rainier?"
    let response = try await GemmaService.shared.generate(prompt: prompt)
    
    XCTAssertFalse(response.isEmpty)
    XCTAssertTrue(response.contains("Rainier"))
}
```

```kotlin
// Android
@Test
fun testGemmaInference() = runBlocking {
    val gemma = GemmaService(context)
    gemma.loadModel()
    
    val prompt = "What is Mount Rainier?"
    val response = gemma.generate(prompt)
    
    assertTrue(response.isNotEmpty())
    assertTrue(response.contains("Rainier", ignoreCase = true))
}
```

### Performance Benchmarks

```kotlin
// Measure inference time
val startTime = System.currentTimeMillis()
val response = gemmaService.generate(prompt)
val latency = System.currentTimeMillis() - startTime

println("Inference latency: ${latency}ms")

// Target: <1000ms on modern devices
```

---

## Troubleshooting

### iOS Issues

**Issue**: Model file not found
```
Solution: Check Target Membership in Xcode, ensure model is in Copy Bundle Resources
```

**Issue**: Out of memory
```
Solution: Use Q2_K quantization or implement model unloading when not in use
```

**Issue**: Slow inference
```
Solution: Enable GPU acceleration, reduce max_tokens, use Apple Silicon device
```

### Android Issues

**Issue**: Model loading fails
```
Solution: Check file path, ensure model is in assets or downloaded correctly
```

**Issue**: GPU delegate not available
```
Solution: Fallback to CPU, check device compatibility
```

**Issue**: APK too large
```
Solution: Use download-on-launch strategy, enable App Bundle
```

---

## Next Steps

1. Choose platform (iOS/Android or both)
2. Select model quantization level (Q4_K_M recommended)
3. Decide on bundling vs download strategy
4. Implement GemmaService
5. Test on real devices
6. Implement cloud fallback
7. Monitor performance and costs

**Ready to implement?** → See `tasks.md` for step-by-step checklist
