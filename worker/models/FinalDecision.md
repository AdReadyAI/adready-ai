# OWLv2 on Roboflow — Pricing Summary

Model: OWLv2 image-guided object detection (search by a product image, no training).
Everything below is billed in **credits**. Sources at the bottom.

## Credit → dollar rates
| Credit source | Price | When it applies |
|---|---|---|
| Included (Core plan, base tier) | $79/mo annual or $99/mo monthly for **15 credits/mo** | first 15 credits each month |
| Blended in-plan rate | **$5.27/credit** ($79 ÷ 15) annual · **$6.60/credit** monthly | effective cost of those included credits |
| Prepaid top-up | **$4.00/credit** | after included credits run out |
| Flex (auto overage) | **$6.00/credit** | after included credits, if no prepaid balance |

> Note: at the 15-credit tier, included credits ($5.27) cost **more** than prepaid ($4). Larger bundles lower the blended rate.

## How inference is metered (pick endpoint by speed)
| Endpoint | Rate | Best when |
|---|---|---|
| Serverless Hosted API (**v1**) | 1 credit = **1,000 images** (flat) | image takes **> 0.5 s** |
| Serverless Hosted API (**v2**) | 1 credit = **500 seconds** of inference | image takes **< 0.5 s** |
| Self-hosted / edge | 1 credit = **3,000 images** | you run the server yourself* |
| Dedicated Deployment | 1 credit = **1 GPU-hour** (CPU: 4 hrs) | steady high volume |

**Crossover = 0.5 s/image.** Faster → v2 wins; slower → v1 wins.
\*Self-hosting **still uses credits if you pass an API key**. Running OWLv2 as a public foundation model **without an API key = no credits** (you pay only for your own GPU).

## Measured example (one real warm call)
- Processing time: **0.40 s/image** → under 0.5 s, so **v2 is cheaper**.
- Per image: **0.000799 credits** ≈ **$0.0032 prepaid / $0.0048 flex / $0.0042 in-plan**.
- 15 credits/mo on v2 ≈ **18,769 images/month** included (7,500 s ÷ 0.40 s).
- Beyond that: ≈ **$3–5 per 1,000 images** depending on credit source.
- On v1 the flat allowance would be **15,000 images/month**.

## Cost-minimizing takeaways
1. **Measure `x-processing-time`** on your real images — it decides v1 vs v2 and everything downstream.
2. If images run **< 0.5 s**, use **v2**; if **> 0.5 s**, use **v1**.
3. Batching/concurrency buys **speed, not a discount** — each image is still one billed inference.
4. **High volume + own GPU** → self-host OWLv2 **without an API key** to remove credit metering entirely (verify OWLv2's Google license for commercial use).

## Sources
- Plan prices, included credits, prepaid $4 / flex $6: https://roboflow.com/pricing
- Credit consumption rates (v1 vs v2, self-hosted, dedicated; credits used even when self-hosting): https://roboflow.com/credits
- v2 per-time formula `credits = max(x-processing-time, 100ms) / 500,000`: https://docs.roboflow.com/deploy/serverless-hosted-api-v2/pricing
- OWLv2 image-guided usage: https://inference.roboflow.com/foundation/owlv2/
- Open-source server, Apache 2.0, no-key foundation models, credit metering with key: https://github.com/roboflow/inference

*Confirm your exact included-credit allotment in-app — Roboflow's pricing page rendered the base tier ambiguously (15 vs 50 credits/mo). All figures above assume 15 credits/mo.*

# Transcription Model Selection — Final Decision

After cost analysis, we have evaluated multiple transcription models available via OpenRouter. This analysis focuses on optimizing our pipeline for speed and cost, prioritizing efficiency for our clear-audio video datasets.

## Comprehensive Model Pricing Analysis

| Model | Cost ($/min) | Primary Strengths |
| :--- | :--- | :--- |
| **openai/whisper-large-v3-turbo** | **$0.00066** | Most cost-effective; high-throughput optimization. |
| **nvidia/parakeet-tdt-0.6b-v3** | **$0.0015** | Lightweight architecture; optimized for high speed. |
| **openai/whisper-large-v3** | **$0.0015** | Robust industry standard; high accuracy. |
| **qwen/qwen3-asr-flash-2026-02-10**| **$0.0021** | Excellent performance for multi-language and mixed-audio (music/noise). |
| **mistralai/voxtral-mini-transcribe**| **$0.0030** | Versatile model suited for meetings and podcasts. |
| **microsoft/mai-transcribe-1.5** | **$0.0060** | Fast transcription with wide locale support. |
| **openai/whisper-1** | **$0.0060** | Legacy API support; stable performance. |
| **google/chirp-3** | **$0.0160** | High-precision; built-in denoiser for complex audio. |

## Strategic Takeaways

1. **Cost Optimization:** By transitioning to high-throughput models like `whisper-large-v3-turbo`, we can achieve significant operational savings (up to 89% reduction compared to legacy models like `whisper-1`) without sacrificing transcription quality for our standard use cases.
2. **Pipeline Efficiency:** Since transcription is a prerequisite for subsequent tasks (OCR and product lookup), selecting models with lower latency is critical to reducing the overall processing time per video. 
3. **Selection Strategy:** 
   - **Primary:** `openai/whisper-large-v3-turbo` for its market-leading price-to-performance ratio.
   - **Secondary/Failover:** `nvidia/parakeet-tdt-0.6b-v3` or `openai/whisper-large-v3` for scenarios requiring alternative language handling or stability.
   - **Acoustic Versatility:** `qwen/qwen3-asr-flash-2026-02-10` is selected for its superior performance in handling difficult acoustic conditions, specifically for transcribing speech over background music and environmental noise.
   - **Specialized:** `google/chirp-3` remains a backup option only for extreme high-noise environments since it got a built-in denoiser for cleaner audio processing
## Sources
- [OpenRouter Model Registry](https://openrouter.ai/models)