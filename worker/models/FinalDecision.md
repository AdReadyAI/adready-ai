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

---

# AssemblyAI — Pricing & Architecture Decision Summary

Model: AssemblyAI Speech-to-Text (Universal-3.5 Pro / Universal-2) with add-on features and LeMUR capabilities.
Everything below is billed based on **audio duration (per hour)**. Sources at the bottom.

## Pricing structure & Model tiers
| Model / Tier | Price | Description & Features |
|---|---|---|
| **Universal-3.5 Pro** | **$0.21 / hour** | (Default) Most accurate async model across 18 languages, native code-switching, most accurate speaker diarization yet. |
| **Universal-2** | **$0.15 / hour** | Highly accurate model trained on 12.5M+ hours of audio, supports 99 languages. |
| **Custom Tier** | *Contact Sales* | Custom rate limits, enhanced concurrency, and enterprise-grade flexibility. |

## Add-on Features & Pricing (per hour of audio)
| Add-on Feature | Universal-3.5 Pro | Universal-2 | Description |
|---|---|---|---|
| **Keyterms Prompting** | **$0.05 / hr** | **Included** | Provide up to 1,000 words or phrases (max 6 words per phrase) to improve accuracy. |
| **Prompting** | **$0.05 / hr** | *Not supported* | Describe your audio in plain language (domain, scenario, or full conversation details). |
| **Speaker Diarization** | **$0.02 / hr** | **$0.02 / hr** | Detect multiple speakers and segment the transcript into utterances (upper limit: 10 speakers). |
| **Medical Mode** (New) | **$0.15 / hr** | **$0.15 / hr** | Optimize transcription for medical terminology and healthcare conversations. |

## Model Selection Classes (SDK Parameters)
You can select the class of models to balance cost and performance tradeoffs:
- **`aai.SpeechModel.best`** (Default): Uses the most accurate and capable models with the best results (Universal-3.5 Pro).
- **`aai.SpeechModel.nano`**: Uses less accurate, but much lower cost models to produce results quickly and economically.

## Optional / Advanced Possibility: LeMUR Framework
- **Apply LLMs to spoken data**: AssemblyAI's **LeMUR** framework lets you apply Large Language Models directly to audio transcripts using natural language processing (e.g., call summaries, structured data extraction).

## Measured example (one real video audio track)
- Audio duration: **60 seconds (1 minute)** using Universal-3.5 Pro + Speaker Diarization:
- Base rate ($0.21) + Diarization add-on ($0.02) = **$0.23 / hour** ($0.0000639 per second).
- Cost per minute: **$0.0038**.

## Cost-minimizing takeaways
1. **Choose the right model tier**: Use `aai.SpeechModel.nano` or Universal-2 for cost-sensitive workloads, and `aai.SpeechModel.best` (Universal-3.5 Pro) when top-tier accuracy is critical.
2. **Enable add-ons selectively**: Only activate features like Prompting or Medical Mode when required, as they add incremental per-hour costs.
3. **Pre-trim silence or irrelevant segments** before sending to the API to avoid paying for empty audio length.

## Sources
- Pricing : https://www.assemblyai.com/pricing
- Model options: https://assembly-preview.mintlify.app/docs/speech-to-text/speech-recognition
- Speaker Diarization documentation and limits (max 10 speakers): https://assembly-preview.mintlify.app/docs/speech-to-text/speaker-diarization