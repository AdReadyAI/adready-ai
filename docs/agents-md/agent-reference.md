# AdReady Eval Scorecard — Agent Reference Playbook

This playbook acts as the master technical specification for the 7 evaluation agents in the `supabase/functions/` directory. It defines their mapped metrics, input data requirements, exact JSON output structures, severity scoring rules, and conceptual pipeline stages.

---

## Shared Data Contracts (schemas.ts)

Every agent consumes a subset of the `EvidenceBundle` provided by the Media Processing team and returns an array of `MetricResult` structures.

### Input envelope: `EvidenceBundle`
```typescript
export interface EvidenceBundle {
  variant_id: string;
  review_id: string;

  // Media Processing Inputs
  transcript_segments: TranscriptSegment[];
  ocr_segments: OCRSegment[];
  scene_segments: SceneSegment[];
  // detected_claims: DetectedClaim[];
  // detected_ctas: DetectedCTA[];
  product_moments: ProductMoment[];
  reference_assets: ReferenceAsset[];
  video_metadata: VideoMetadata;

  // Product Platform Context
  creative_brief: string;
  campaign_goal: "awareness" | "consideration" | "conversion" | "repurchase";
  destination_platform: string;
}

export interface SceneSegment {
  scene_id: string;
  start_ms: number;
  end_ms: number;
  visual_description: string;
  visual_elements?: {
    detected_people?: string[];      // e.g. ["adult female (25-30)"]
    clothing_style?: string;        // e.g. "casual athletic wear"
    dominant_colors?: string[];      // e.g. ["#FF5733", "#C70039"]
    tone_mood?: string;              // e.g. "energetic, bright"
  };
}
```

### Output format: `MetricResult`
```typescript
export interface SubCheckResult {
  check_id: string;
  name: string;
  result: "passed" | "failed" | "cannot_assess";
  severity: "none" | "low" | "medium" | "high" | "critical" | "cannot_assess";
  explanation?: string;
}

export interface MetricResult {
  metric_id: MetricId;
  agent:
    | "claims_accuracy"
    | "storyline_clarity"
    | "brand_alignment"
    | "brief_alignment"
    | "product_representation"
    | "visual_quality"
    | "cta_effectiveness";
  metric_name: string;
  question: string;
  result: "true" | "false" | "cannot_assess";
  severity: "none" | "low" | "medium" | "high" | "critical" | "cannot_assess";
  confidence?: "low" | "medium" | "high";
  evidence?: {
    type: "transcript" | "ocr" | "visual" | "brief" | "product_page" | "metadata";
    text: string;
    timestamp: string; // MM:SS format or empty string
  }[];
  explanation?: string;
  suggested_correction?: string;
  correction_type?: "rewrite" | "edit_recommendation" | "reshoot_recommendation" | "policy_review" | "cannot_suggest";
  sub_checks?: SubCheckResult[]; // Granular sub-checks evaluated by the agent
}
```

---

## 1. Claims Accuracy Agent (`claims-agent`)

*   **Owner**: Saifeddine Rejeb
*   **Directory**: `supabase/functions/claims-agent/`

### Mapped Metrics & Internal Sub-Checks
1.  **`product_truth`**: "Are all explicit product claims supported by product page or source materials?"
    *   `claim_unsupported`: Claim is exaggerated or lacks nuance.
    *   `claim_contradicted`: Claim directly conflicts with the product page/brief.
    *   `forbidden_claim_used`: Claim matches a strictly forbidden claim list.
2.  **`policy_compliance`**: "Does the video avoid obvious policy, compliance, or disclosure issues?"
    *   `missing_disclaimer`: Required disclaimer/warning is completely missing.
    *   `disclaimer_contrast_low`: Disclaimer overlay contrast too low or font size too small.
    *   `disclaimer_duration_insufficient`: Disclaimer duration too short on screen.
    *   `policy_violation_depicted`: Depicts illegal substances, safety hazards, copyright infringement.

### Expected Inputs
*   `transcript_segments[]`: Spoken dialogue.
*   `ocr_segments[]`: On-screen text.
*   `detected_claims[]`: Primitive list of claims (need to generate)
*   `creative_brief`: Approved and forbidden claims guidelines.

### Severity Rules

#### Product Truth / Claim Support (`product_truth`)
*   **None (0)**: Every explicit and implicit claim is 100% verified and fully supported.
*   **Low (1)**: Wording differs slightly but claim is factually accurate.
*   **Medium (2)**: Claim is exaggerated, overpromised, or lacks necessary nuances.
*   **High (3)**: Completely unsupported, highly misleading claim, or false price/offer.
*   **Critical (4)**: States a strictly forbidden claim (*forbidden claim*) or regulatory violation.

#### Policy / Compliance Readiness (`policy_compliance`)
*   **None (0)**: Fully compliant with platform rules, industry regulations, and legal disclaimers.
*   **Low (1)**: Disclaimer is present but uses a font size that is slightly hard to read.
*   **Medium (2)**: Disclaimer present but lacks specific mandatory phrases or is too short.
*   **High (3)**: Critical required disclaimer or legal warning is entirely missing.
*   **Critical (4)**: Depicts explicit policy violations (illegal substances, dangerous stunts).

### Output Structure
```json
[
  {
    "metric_id": "product_truth",
    "agent": "claims_accuracy",
    "metric_name": "Product Truth / Claim Support",
    "result": "false",
    "severity": "critical",
    "confidence": "high",
    "evidence": [
      {
        "type": "transcript",
        "text": "clinically proven to reduce wrinkles in 7 days",
        "timestamp": "00:08"
      },
      {
        "type": "product_page",
        "text": "No clinical trial was conducted.",
        "timestamp": ""
      }
    ],
    "explanation": "Ad voiceover claims clinical proof, but the product page states only an informal survey was conducted.",
    "suggested_correction": "Replace with: 'In a 1-week survey, participants reported smoother skin.'",
    "correction_type": "rewrite",
    "sub_checks": [
      {
        "check_id": "claim_unsupported",
        "name": "Claim Support Check",
        "result": "passed",
        "severity": "none"
      },
      {
        "check_id": "claim_contradicted",
        "name": "Claim Contradiction Check",
        "result": "failed",
        "severity": "critical",
        "explanation": "Spoken claims assert clinical proof which is contradicted by product metadata."
      },
      {
        "check_id": "forbidden_claim_used",
        "name": "Forbidden Claim Check",
        "result": "passed",
        "severity": "none"
      }
    ]
  },
  {
    "metric_id": "policy_compliance",
    "agent": "claims_accuracy",
    "metric_name": "Policy / Compliance Readiness",
    "question": "Does the video avoid obvious policy, compliance, or disclosure issues?",
    "result": "false",
    "severity": "low",
    "confidence": "medium",
    "evidence": [
      {
        "type": "ocr",
        "text": "Disclaimer: Results may vary.",
        "timestamp": "00:02"
      }
    ],
    "explanation": "Legal disclaimer text size is smaller than safe platform guidelines.",
    "suggested_correction": "Increase font size of the disclaimer text overlay to at least 16px.",
    "correction_type": "edit_recommendation",
    "sub_checks": [
      {
        "check_id": "missing_disclaimer",
        "name": "Disclaimer Presence",
        "result": "passed",
        "severity": "none"
      },
      {
        "check_id": "disclaimer_contrast_low",
        "name": "Disclaimer Visibility",
        "result": "failed",
        "severity": "low",
        "explanation": "The font size of the disclaimer text is 10px, below the required 12px safe limit."
      },
      {
        "check_id": "disclaimer_duration_insufficient",
        "name": "Disclaimer Duration",
        "result": "passed",
        "severity": "none"
      },
      {
        "check_id": "policy_violation_depicted",
        "name": "Policy Depiction Check",
        "result": "passed",
        "severity": "none"
      }
    ]
  }
]
```

### Pipeline Stages
1.  **Stage 1: Normalize Timelines**: Merge transcript and OCR timestamps.
2.  **Stage 2: Claim Triage (Triage LLM)**: Classify claims and filter out puffery.
3.  **Stage 3: Claim Substantiation (Standard LLM)**: Audit claims vs the creative brief.
4.  **Stage 4: Compliance Check (Advanced LLM)**: Evaluate legal warnings.
5.  **Stage 5: Synthesis**: Deduplicate findings and map to `product_truth` and `policy_compliance` outputs.

---

## 2. Storyline Clarity Agent (`storyline-clarity-agent`)

*   **Owner**: Kira Cho
*   **Directory**: `supabase/functions/storyline-clarity-agent/`

### Mapped Metrics & Internal Sub-Checks
1.  **`channel_readiness`**: "Does the video fit the intended platform, placement, length, and viewing context?"
    *   `format_noncompliant`: Aspect ratio, resolution, or duration doesn't match platform specs.
    *   `safe_zone_violation`: Overlay text overlaps with platform UI overlays.
2.  **`creative_effectiveness`**: "Does the ad have a clear hook, coherent message flow, and enough stopping power?"
    *   `hook_missing`: No hook present in opening 2-3 seconds.
    *   `narrative_gap`: Confusing jumps or cuts breaking narrative logic.
    *   `value_prop_unclear`: Core product value proposition is weak/unclear.
    *   `story_incomplete`: Storyline cuts off before the arc finishes.
    *   `pacing_misallocation`: Too much runtime spent on detours vs driving story.

### Expected Inputs
*   `video_metadata`: Aspect ratio, resolution, duration.
*   `scene_segments[]`: Scene timestamps, visual descriptions, and visual_elements.
*   `transcript_segments[]`: Spoken dialogue.
*   `destination_platform`: Platform target.

### Severity Rules

#### Channel / Placement Readiness (`channel_readiness`)
*   **None (0)**: Video aspect ratio, pacing, framing, text safe zones, and length perfectly match platform constraints.
*   **Low (1)**: Minor formatting issue (e.g. text slightly too close to overlays, duration 1-2s over limit).
*   **Medium (2)**: Video pacing/structure unoptimized (e.g. slow cinematic intro requiring 2s hook).
*   **High (3)**: Aspect ratio/dimensions completely wrong for placement (e.g. landscape video for Reels).
*   **Critical (4)**: Video is unwatchable, corrupted, or fails platform ingestion.

#### Creative Effectiveness Basics (`creative_effectiveness`)
*   **None (0)**: Captures attention in opening 2 seconds with relevant hook.
*   **Low (1)**: Hook is present but takes too long to resolve (3-4 seconds).
*   **Medium (2)**: Generic or slow-paced intro; fails to create curiosity.
*   **High (3)**: First 2 seconds are unengaging, blank, or irrelevant.
*   **Critical (4)**: Intro is actively off-putting, leading to immediate bounce.

### Output Structure
```json
[
  {
    "metric_id": "channel_readiness",
    "agent": "storyline_clarity",
    "metric_name": "Channel / Placement Readiness",
    "question": "Does the video fit the intended platform, placement, length, and viewing context?",
    "result": "false",
    "severity": "high",
    "confidence": "high",
    "evidence": [
      {
        "type": "metadata",
        "text": "aspect_ratio: 16:9, platform: TikTok",
        "timestamp": ""
      }
    ],
    "explanation": "The video aspect ratio is horizontal (16:9) but the destination platform TikTok requires a vertical (9:16) format.",
    "suggested_correction": "Crop and reformat the video template to vertical 9:16.",
    "correction_type": "edit_recommendation",
    "sub_checks": [
      {
        "check_id": "format_noncompliant",
        "name": "Format Compliance",
        "result": "failed",
        "severity": "high",
        "explanation": "Landscape resolution 1920x1080 was submitted for TikTok placement."
      },
      {
        "check_id": "safe_zone_violation",
        "name": "Safe Zone Check",
        "result": "passed",
        "severity": "none"
      }
    ]
  },
  {
    "metric_id": "creative_effectiveness",
    "agent": "storyline_clarity",
    "metric_name": "Creative Effectiveness Basics",
    "question": "Does the ad have a clear hook, coherent message flow, and enough stopping power?",
    "result": "false",
    "severity": "low",
    "confidence": "medium",
    "evidence": [
      {
        "type": "visual",
        "text": "First 4 seconds show static title card with no action or spoken audio.",
        "timestamp": "00:00"
      }
    ],
    "explanation": "The video fails to establish an active visual or spoken hook within the first 2 seconds, showing a slow intro.",
    "suggested_correction": "Move the product-in-use action shot from 00:08 to the opening seconds of the video.",
    "correction_type": "edit_recommendation",
    "sub_checks": [
      {
        "check_id": "hook_missing",
        "name": "Hook Presence Check",
        "result": "failed",
        "severity": "low",
        "explanation": "Intro is a slow cinematic card that takes 4 seconds to resolve."
      },
      {
        "check_id": "narrative_gap",
        "name": "Narrative Gap Check",
        "result": "passed",
        "severity": "none"
      },
      {
        "check_id": "value_prop_unclear",
        "name": "Value Prop Check",
        "result": "passed",
        "severity": "none"
      },
      {
        "check_id": "story_incomplete",
        "name": "Story Completion",
        "result": "passed",
        "severity": "none"
      },
      {
        "check_id": "pacing_misallocation",
        "name": "Pacing Allocation",
        "result": "passed",
        "severity": "none"
      }
    ]
  }
]
```

### Pipeline Stages
1.  **Stage 1: Metadata Check**: Inspect aspect ratio, duration, and safe zones.
2.  **Stage 2: Hook Assessment (Standard LLM)**: Audit hook impact in opening scenes.
3.  **Stage 3: Story Coherence**: Evaluate narrative continuity and pacing detours.
4.  **Stage 4: Synthesis**: Map findings to final outputs.

---

## 3. CTA Effectiveness Agent (`cta-effectiveness-agent`)

*   **Owner**: Kira Cho
*   **Directory**: `supabase/functions/cta-effectiveness-agent/`

### Mapped Metrics & Internal Sub-Checks
1.  **`cta_clarity`**: "Is there a clear and appropriate next step for the viewer?"
    *   `cta_absent`: No spoken, visual, or written CTA present in the video.
    *   `cta_buried`: CTA shown only in first 5s and never repeated at the close.
    *   `cta_mistimed`: CTA shown before product value payoff resolves.
    *   `cta_language_weak`: CTA phrasing is too passive, vague, or non-specific.
    *   `cta_goal_mismatch`: CTA style doesn't match campaign objective.
    *   `cta_low_visibility`: CTA contrast too low or font size too small.
    *   `cta_platform_mismatch`: Phrasing violates platform swipe/action conventions.

### Expected Inputs
*   `detected_ctas[]`: CTA strings, timestamps, and detection sources.
*   `transcript_segments[]` & `ocr_segments[]`: Text around closing beats.
*   `creative_brief`: Required call-to-action text rules.
*   `campaign_goal`: Campaign target (e.g. conversion requires stronger CTA).

### Severity Rules

#### CTA Clarity (`cta_clarity`)
*   **None (0)**: Required CTA is present, unambiguous, highly visible/audible, and appropriately timed.
*   **Low (1)**: Correct CTA present, but screen time too short or visual contrast low.
*   **Medium (2)**: Phrase deviates from brief requirements, creating slight friction.
*   **High (3)**: CTA is contradictory or confusing (e.g. audio says "Shop Now" while text says "Sign Up").
*   **Critical (4)**: Required CTA is entirely missing on a conversion-focused campaign.

### Output Structure
```json
[
  {
    "metric_id": "cta_clarity",
    "agent": "cta_effectiveness",
    "metric_name": "CTA Clarity",
    "question": "Is there a clear and appropriate next step for the viewer?",
    "result": "false",
    "severity": "critical",
    "confidence": "high",
    "evidence": [
      {
        "type": "brief",
        "text": "Required CTA: Try Mango Moon",
        "timestamp": ""
      },
      {
        "type": "visual",
        "text": "No CTA visible on screen or spoken in audio.",
        "timestamp": ""
      }
    ],
    "explanation": "The required CTA 'Try Mango Moon' is entirely missing on this conversion-focused campaign.",
    "suggested_correction": "Add a prominent closing end card with the button text 'Try Mango Moon'.",
    "correction_type": "edit_recommendation",
    "sub_checks": [
      {
        "check_id": "cta_absent",
        "name": "CTA Presence",
        "result": "failed",
        "severity": "critical",
        "explanation": "No verbal or visual CTA was found."
      },
      {
        "check_id": "cta_buried",
        "name": "CTA Position Check",
        "result": "passed",
        "severity": "none"
      },
      {
        "check_id": "cta_mistimed",
        "name": "CTA Timing Check",
        "result": "passed",
        "severity": "none"
      },
      {
        "check_id": "cta_language_weak",
        "name": "CTA Phrasing Check",
        "result": "passed",
        "severity": "none"
      },
      {
        "check_id": "cta_goal_mismatch",
        "name": "CTA Goal Alignment",
        "result": "passed",
        "severity": "none"
      },
      {
        "check_id": "cta_low_visibility",
        "name": "CTA Visibility Check",
        "result": "passed",
        "severity": "none"
      },
      {
        "check_id": "cta_platform_mismatch",
        "name": "CTA Platform Alignment",
        "result": "passed",
        "severity": "none"
      }
    ]
  }
]
```

### Pipeline Stages
1.  **Stage 1: Alignment check**: Compare detected CTAs against specifications.
2.  **Stage 2: Placement & Timing**: Verify closing display times.
3.  **Stage 3: Visibility Check (Standard LLM)**: Audit sizing and contrast.
4.  **Stage 4: Synthesis**: Output results.

---

## 4. Product Representation Agent (`product-representation-agent`)

*   **Owner**: Saifeddine Rejeb
*   **Directory**: `supabase/functions/product-representation-agent/`

### Mapped Metrics & Internal Sub-Checks
1.  **`product_clarity`**: "Can a viewer clearly identify what product is being advertised?"
    *   `product_not_shown`: Product packaging or unit never visible.
    *   `product_obscured`: Product visible but hidden, heavily cropped, or too tiny.
    *   `product_appearance_wrong`: Packaging color, shape, or label design differs from references.
    *   `product_name_unspoken`: Brand or product name never voiced or shown in overlay text.

### Expected Inputs
*   `product_moments[]`: Target timestamps where the product appears.
*   `scene_segments[]`: Scene visual descriptions and visual_elements for product visibility checks.
*   `reference_assets[]`: Official product photos.

### Severity Rules

#### Product Clarity (`product_clarity`)
*   **None (0)**: Product name, branding, and packaging are immediately, clearly, and continuously identifiable.
*   **Low (1)**: Product is identifiable, but its total screen time is slightly too short or its appearance is delayed.
*   **Medium (2)**: Product is visible but packaging/labels are blurry, or the product name is never explicitly stated.
*   **High (3)**: Product presentation is confusing; viewers might easily mistake it for a competitor.
*   **Critical (4)**: Product is completely unidentifiable, never appears in frame, or the wrong product is shown.

### Output Structure
```json
[
  {
    "metric_id": "product_clarity",
    "agent": "product_representation",
    "metric_name": "Product Clarity",
    "question": "Can a viewer clearly identify what product is being advertised?",
    "result": "false",
    "severity": "medium",
    "confidence": "high",
    "evidence": [
      {
        "type": "visual",
        "text": "Product packaging label is out of focus in all moments.",
        "timestamp": "00:12"
      }
    ],
    "explanation": "Product label is blurry and name is not clearly visible when packaging is shown.",
    "suggested_correction": "Ensure the high-resolution reference packaging assets are properly rendered and focused during the pack shot.",
    "correction_type": "edit_recommendation",
    "sub_checks": [
      {
        "check_id": "product_not_shown",
        "name": "Product Presence Check",
        "result": "passed",
        "severity": "none"
      },
      {
        "check_id": "product_obscured",
        "name": "Product Visibility Check",
        "result": "failed",
        "severity": "medium",
        "explanation": "Packaging labels are heavily blurred due to depth-of-field focus issues."
      },
      {
        "check_id": "product_appearance_wrong",
        "name": "Product Appearance",
        "result": "passed",
        "severity": "none"
      },
      {
        "check_id": "product_name_unspoken",
        "name": "Brand Name Mention Check",
        "result": "passed",
        "severity": "none"
      }
    ]
  }
]
```

### Pipeline Stages
1.  **Stage 1: Frame Isolation**: Select frames from `product_moments`.
2.  **Stage 2: Vision Analysis (Standard LLM)**: Audit packaging visual fidelity against references.
3.  **Stage 3: Synthesis**: Construct final `product_clarity` scorecard row.

---

## 5. Visual Quality Agent (`visual-quality-agent`)

*   **Owner**: Saifeddine Rejeb
*   **Directory**: `supabase/functions/visual-quality-agent/`

### Mapped Metrics & Internal Sub-Checks
1.  **`production_readiness`**: "Is the video technically complete enough to be reviewed or launched?"
    *   `video_corruption`: Video file unplayable or corrupt.
    *   `dropped_frames`: Severe frame stuttering or lag.
    *   `ai_artifacts`: Morphing shapes, distorted faces, ghosting, extra limbs.
    *   `poor_framing_lighting`: Mismatched scene lighting, overexposure, off-center subject framing.
    *   `jarring_transitions`: Abrupt cuts, flash frames, inconsistent color grading between scenes.
    *   `illegible_text`: Captions rendering illegibly.

### Expected Inputs
*   `video_metadata`: Aspect ratio, resolution, corruption flags, dropped frame lists.
*   `ocr_segments[]`: OCR rendering confidence scores.
*   `scene_segments[]`: Boundary cuts and visual_elements for distortion and framing checks.

### Severity Rules

#### Production / Asset Readiness (`production_readiness`)
*   **None (0)**: Lighting is balanced, video resolution is sharp, and editing cuts are professional.
*   **Low (1)**: Minor production flaw (e.g. minor lighting overexposure).
*   **Medium (2)**: Pacing transition errors, minor visual clipping.
*   **High (3)**: Major technical flaws (missing transitions, extreme pixelation, severe AI artifact distortions).
*   **Critical (4)**: Video file severely corrupted or terminates abruptly.

### Output Structure
```json
[
  {
    "metric_id": "production_readiness",
    "agent": "visual_quality",
    "metric_name": "Production / Asset Readiness",
    "question": "Is the video technically complete enough to be reviewed or launched?",
    "result": "false",
    "severity": "high",
    "confidence": "high",
    "evidence": [
      {
        "type": "visual",
        "text": "Flicker artifacting and morphing frames detected around transition.",
        "timestamp": "00:07"
      }
    ],
    "explanation": "Severe AI visual morphing/flickering artifacts on transition between scene 1 and scene 2.",
    "suggested_correction": "Re-generate transition frames or replace with clean cut.",
    "correction_type": "edit_recommendation",
    "sub_checks": [
      {
        "check_id": "video_corruption",
        "name": "File Integrity",
        "result": "passed",
        "severity": "none"
      },
      {
        "check_id": "dropped_frames",
        "name": "Frame Sync Check",
        "result": "passed",
        "severity": "none"
      },
      {
        "check_id": "ai_artifacts",
        "name": "AI Artifacts Audit",
        "result": "failed",
        "severity": "high",
        "explanation": "Distorted patterns and flickering backgrounds are clearly visible at 7000ms."
      },
      {
        "check_id": "poor_framing_lighting",
        "name": "Framing and Lighting Check",
        "result": "passed",
        "severity": "none"
      },
      {
        "check_id": "jarring_transitions",
        "name": "Transition Continuity Check",
        "result": "passed",
        "severity": "none"
      },
      {
        "check_id": "illegible_text",
        "name": "Text Quality Check",
        "result": "passed",
        "severity": "none"
      }
    ]
  }
]
```

### Pipeline Stages
1.  **Stage 1: Metadata Gate**: Check file integrity flags.
2.  **Stage 2: Filter**: Identify candidate frames at scene cuts or with low OCR confidence.
3.  **Stage 3: Vision Checks**: Audit frames for visual quality, artifacts, and lighting.
4.  **Stage 4: Synthesis**: Report overall production quality.

---

## 6. Brand Alignment Agent (`brand-alignment-agent`)

*   **Owner**: Saifeddine Rejeb
*   **Directory**: `supabase/functions/brand-alignment-agent/`

### Mapped Metrics & Internal Sub-Checks
1.  **`brand_fit`**: "Does the video align with brand voice, positioning, and visual expectations?"
    *   `logo_absent`: Logo completely missing from key scenes.
    *   `logo_incorrect`: Wrong logo version, incorrect design layout, or distorted layout.
    *   `color_palette_off`: Dominant colors drift from style guide palette.
    *   `brand_voice_drift`: Subtitle copy or voiceover style drifts from guidelines.

### Expected Inputs
*   `reference_assets[]`: Brand logos and style rules.
*   `scene_segments[]`: Scene visual descriptions and visual_elements for logo, color, and tone checks.
*   `transcript_segments[]`: Spoken voice dialogue.

### Severity Rules

#### Brand Fit (`brand_fit`)
*   **None (0)**: Flawlessly respects brand identity, logo usage, color palette, typography, and brand voice guide.
*   **Low (1)**: Minor visual or editorial deviation (e.g. incorrect font weight, logo padding issue).
*   **Medium (2)**: Tone/copy style drifts noticeably (e.g. aggressive tone instead of gentle positioning).
*   **High (3)**: Blatant and repeated disregard for visual style or core values.
*   **Critical (4)**: Content severely damages brand equity or uses strictly prohibited imagery.

### Output Structure
```json
[
  {
    "metric_id": "brand_fit",
    "agent": "brand_alignment",
    "metric_name": "Brand Fit",
    "question": "Does the video align with brand voice, positioning, and visual expectations?",
    "result": "false",
    "severity": "low",
    "confidence": "high",
    "evidence": [
      {
        "type": "visual",
        "text": "Logo font variant lacks official styling.",
        "timestamp": "00:14"
      }
    ],
    "explanation": "Subtitles use a font face that deviates from the approved typography guidelines in the brand style guide.",
    "suggested_correction": "Update font family of all subtitle text overlays to use the brand font.",
    "correction_type": "edit_recommendation",
    "sub_checks": [
      {
        "check_id": "logo_absent",
        "name": "Logo Presence Check",
        "result": "passed",
        "severity": "none"
      },
      {
        "check_id": "logo_incorrect",
        "name": "Logo Accuracy Check",
        "result": "passed",
        "severity": "none"
      },
      {
        "check_id": "color_palette_off",
        "name": "Color Scheme Alignment",
        "result": "passed",
        "severity": "none"
      },
      {
        "check_id": "brand_voice_drift",
        "name": "Brand Voice & Font Alignment",
        "result": "failed",
        "severity": "low",
        "explanation": "Subtitles use a generic Serif font face instead of the brand's approved sans-serif typography."
      }
    ]
  }
]
```

### Pipeline Stages
1.  **Stage 1: Asset Load**: Retrieve color templates and logo configurations.
2.  **Stage 2: Placement & Palette Checks (Standard LLM)**: Audit typography, layout, and palette matching.
3.  **Stage 3: Synthesis**: Construct brand fit metric result.

---

## 7. Brief Alignment Agent (`brief-alignment-agent`)

*   **Owner**: Kira Cho
*   **Directory**: `supabase/functions/brief-alignment-agent/`

### Mapped Metrics & Internal Sub-Checks
1.  **`audience_fit`**: "Does the video speak to the intended audience's needs, motivations, or context?"
    *   `demographic_mismatch`: Slang, style, music, or vocabulary choices clash with target demographics.
    *   `demographic_restricted`: Target demographic contains legally restricted age groups.
2.  **`brief_adherence`**: "Does the video satisfy the core campaign objective and required message from the creative brief?"
    *   `objective_missed`: Video objectives deviate from primary brief target goals.
    *   `required_message_missing`: Mandatory message points or product highlights from creative brief are omitted.

### Expected Inputs
*   `creative_brief`: Target demographic, objective specifications, required key messages.
*   `transcript_segments[]` & `ocr_segments[]`: Spoken and displayed words.
*   `scene_segments[]`: Visual scene action details and visual_elements.

### Severity Rules

#### Audience Fit (`audience_fit`)
*   **None (0)**: Tone, style, vocabulary, actors, and use cases perfectly resonate with the target audience.
*   **Low (1)**: Good overall fit, but minor elements (slang, music style) feel slightly disconnected.
*   **Medium (2)**: Tone or use case is overly generic or neutral; fails to actively engage.
*   **High (3)**: Creative choices, visual style, or messaging clash with target codes (e.g. corporate tone for Gen Z).
*   **Critical (4)**: Targets wrong, inappropriate, or legally restricted demographic (e.g. minors for restricted items).

#### Brief Adherence (`brief_adherence`)
*   **None (0)**: Perfectly adheres to brief objectives, main message, and guidelines.
*   **Low (1)**: Main objectives met, but misses minor secondary details.
*   **Medium (2)**: Core message is present but weak/diluted; lacks campaign intent.
*   **High (3)**: Fails to deliver core message or uses tone/angle deviating from brief.
*   **Critical (4)**: Does not align with the brief at all (e.g. wrong product focus).

### Output Structure
```json
[
  {
    "metric_id": "audience_fit",
    "agent": "brief_alignment",
    "metric_name": "Audience Fit",
    "question": "Does the video speak to the intended audience's needs, motivations, or context?",
    "result": "false",
    "severity": "medium",
    "confidence": "high",
    "evidence": [
      {
        "type": "transcript",
        "text": "Formal corporate narration style used.",
        "timestamp": "00:03"
      }
    ],
    "explanation": "Creative brief specifies targeting Gen Z snackers, but voiceover tone is overly formal and corporate.",
    "suggested_correction": "Re-record voiceover using a casual, high-energy tone matching target demographic habits.",
    "correction_type": "rewrite",
    "sub_checks": [
      {
        "check_id": "demographic_mismatch",
        "name": "Demographic Profile Match",
        "result": "failed",
        "severity": "medium",
        "explanation": "Narrative flow is heavily corporate, which clashes with the Gen Z demographic target."
      },
      {
        "check_id": "demographic_restricted",
        "name": "Age Restriction Check",
        "result": "passed",
        "severity": "none"
      }
    ]
  },
  {
    "metric_id": "brief_adherence",
    "agent": "brief_alignment",
    "metric_name": "Brief Adherence",
    "question": "Does the video satisfy the core campaign objective and required message from the creative brief?",
    "result": "false",
    "severity": "medium",
    "confidence": "high",
    "evidence": [
      {
        "type": "brief",
        "text": "Required message: communicate fun tropical snack energy",
        "timestamp": ""
      },
      {
        "type": "transcript",
        "text": "Dialogue focuses heavily on diet restrictions and calories.",
        "timestamp": "00:05"
      }
    ],
    "explanation": "Core message about 'fun tropical energy' is weak and diluted, replaced by unapproved product features.",
    "suggested_correction": "Adjust copy in scene 2 to emphasize tropical fruits and taste excitement.",
    "correction_type": "rewrite",
    "sub_checks": [
      {
        "check_id": "objective_missed",
        "name": "Campaign Objective Alignment",
        "result": "passed",
        "severity": "none"
      },
      {
        "check_id": "required_message_missing",
        "name": "Creative Brief Message Adherence",
        "result": "failed",
        "severity": "medium",
        "explanation": "Mandatory message point 'fun tropical snack energy' is completely missing."
      }
    ]
  }
]
```

### Pipeline Stages
1.  **Stage 1: Extract Personas**: Parse campaign target definitions.
2.  **Stage 2: Message Adherence Check (Standard LLM)**: Audit text against creative brief messages.
3.  **Stage 3: Demographic Fit Check (Standard LLM)**: Audit style elements against audience habits.
4.  **Stage 4: Synthesis**: Combine results.
