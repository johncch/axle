# Model Update Summary - February 18, 2026

## Overview
Updated all provider model files to include only modern, recommended models from the last 24 months.

## Filtering Criteria Applied

### ✅ Kept:
- Flagship chat/completion models
- Reasoning models (o-series)
- Latest versioned models (GPT-5.x, Claude 4.x, Gemini 2.x-3.x)
- Modern GPT-4o and GPT-4 Turbo models
- Computer use preview models
- ChatGPT vision models
- Gemma open models
- Specialized models (deep research, robotics)

### ❌ Filtered Out:
- Deprecated models
- Fine-tuned models (ft:*, *-ft-*)
- Embedding models (text-embedding-*, embed-*, gemini-embedding-*)
- Audio/speech models (whisper-*, tts-*, gpt-audio*, gpt-realtime*)
- Image generation models (dall-e-*, imagen-*, veo-*, sora-*, gpt-image-*)
- Transcription models (gpt-4o-transcribe, gpt-4o-mini-transcribe)
- TTS models (gpt-4o-mini-tts, gemini-*-tts)
- Moderation models (omni-moderation-*)
- Legacy base models (davinci-002, babbage-002)

## Changes by Provider

### Anthropic (./src/providers/anthropic/models.ts)
- **Kept all models** - All Claude models are modern (2024-2025)
- **Models included**: Claude 3.x, 4.x series (Haiku, Sonnet, Opus variants)
- **Default model**: `CLAUDE_HAIKU_4_5_LATEST` (cheapest modern option)
- **Added aliases**: Added `CLAUDE_3_HAIKU_LATEST` for consistency

### OpenAI (./src/providers/openai/models.ts)
- **Removed**: 
  - Embedding models (text-embedding-*)
  - TTS models (tts-*, gpt-*-tts)
  - Audio models (whisper-*, gpt-audio*, gpt-realtime*)
  - Image generation (dall-e-*, sora-*, gpt-image-*)
  - Transcription models (gpt-4o-transcribe*)
  - Audio preview variants (gpt-4o-audio-preview*, gpt-4o-mini-audio-preview*)
  - Realtime preview variants (gpt-4o-realtime-preview*, gpt-4o-mini-realtime-preview*)
  - Moderation models (omni-moderation-*)
  - Legacy models (davinci-002, babbage-002)
- **Kept**: 
  - GPT-5.x family (newest)
  - GPT-4.1 family
  - GPT-4o family (stable chat models)
  - GPT-4 Turbo family
  - GPT-3.5 Turbo family
  - o-series reasoning models (o1, o3, o4)
  - Computer use preview
  - ChatGPT vision (chatgpt-image-latest)
  - Search preview models
- **Default model**: `GPT_5_MINI_LATEST` (cheapest modern option)

### Gemini (./src/providers/gemini/models.ts)
- **Removed**:
  - Embedding models (gemini-embedding-001)
  - Image generation (imagen-4.0-*)
  - Video generation (veo-*)
  - TTS preview variants (gemini-2.5-*-preview-tts)
  - AQA model moved to "Other" section
- **Kept**:
  - Gemini 3 family (newest previews)
  - Gemini 2.5 family
  - Gemini 2.0 family
  - Gemma 3 open models
  - Specialized models (deep research, robotics, nano-banana-pro)
  - Native audio models (for voice interaction)
  - Computer use preview
  - Latest aliases (auto-updated by Google)
- **Default model**: `GEMINI_2_5_FLASH_LITE_LATEST` (cheapest modern option)

## Default Models (Cheapest Options)

Each provider's default is set to the most cost-effective modern model:

1. **Anthropic**: `CLAUDE_HAIKU_4_5_LATEST` - Claude Haiku 4.5 series
2. **OpenAI**: `GPT_5_MINI_LATEST` - GPT-5 Mini series  
3. **Gemini**: `GEMINI_2_5_FLASH_LITE_LATEST` - Gemini 2.5 Flash Lite series

## Model Naming Conventions

All dated models have been given family aliases for easier use:
- `CLAUDE_HAIKU_4_5_LATEST` → `claude-haiku-4-5-20251001`
- `GPT_5_MINI_LATEST` → `gpt-5-mini`
- `GEMINI_2_5_FLASH_LITE_LATEST` → `gemini-2.5-flash-lite`

## Validation

All files maintain the existing structure:
- `Models` constant object with model definitions
- `MULTIMODAL_MODELS` array (Anthropic, Gemini)
- `DEFAULT_MODEL` constant

## Notes

- All models are from 2024-2025, meeting the "last 24 months" criterion
- Preview models are kept as they represent cutting-edge capabilities
- Specialized models (computer use, deep research, robotics) are retained
- The structure remains compatible with existing codebase usage
