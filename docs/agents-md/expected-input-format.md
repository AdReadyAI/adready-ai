# AdReady Agent Context Specification

The evaluator agents will not receive a full evidence payload directly in the Edge
Function request. Orchestration will invoke an agent with lookup identifiers, and
the agent will load its working context from Supabase tables.

Until the DB tables are finalized, this document defines the shared shape that the
DB-loaded agent context should expose to the agent layer.

## Edge Function Invocation

The agent invocation should stay small:

* **`request_id`**: String UUID - request identifier from
  `public.requests.request_id`.
* **`video_id`**: String UUID - creative/video identifier from
  `public.request_videos.video_id`.
* **`agent`**: String - optional agent identifier when the orchestrator uses a
  shared invocation helper.

The request is not the source of transcript, OCR, visual, product, or brief data.
Those records are loaded from the DB by `request_id` and `video_id`.

---

## DB-Loaded Agent Context

### Request Context

* **`request_id`**: String UUID.
* **`video_id`**: String UUID.
* **`campaign_goal`**: String - main marketing objective, such as
  `"awareness"`, `"consideration"`, or `"conversion"`.
* **`destination_platform`**: String - publishing target, such as `"tiktok"`,
  `"instagram_reels"`, or `"meta_feed"`.

### Parsed Creative Brief

The raw creative brief should be parsed before agent execution and stored in
queryable fields. Agents can still keep the raw brief text for evidence, but they
should primarily use structured fields.

* **`raw_text`**: String - original brief text.
* **`brand_voice`**: String, optional - tone and voice expectations.
* **`target_audience`**: String, optional - intended audience.
* **`required_messages`**: String array - mandatory product or campaign messages.
* **`required_ctas`**: String array - required CTA language or destination.
* **`approved_claims`**: String array - claims allowed by the brief or product
  source.
* **`forbidden_claims`**: String array - claims or policy language that must not
  appear.
* **`brand_guidelines`**: String array - logo, color, typography, and visual rules.
* **`policy_requirements`**: String array - disclaimers, regulatory constraints,
  platform rules, or category restrictions.

### Video Metadata

* **`duration_ms`**: Integer - total video length.
* **`aspect_ratio`**: String - screen shape, such as `"9:16"`.
* **`resolution`**: String - pixel dimensions, such as `"1080x1920"`.
* **`dropped_frame_markers`**: Integer array - timestamps where dropped frames or
  stutter were detected.
* **`corruption_detected`**: Boolean, optional - file-level media integrity flag.

### Transcript Segments

Agents derive spoken claims and spoken CTAs from these records.

* **`segment_id`**: String.
* **`start_ms`**: Integer.
* **`end_ms`**: Integer.
* **`text`**: String.
* **`speaker`**: String, optional.

### OCR Segments

Agents derive written claims, written CTAs, disclaimers, and text legibility from
these records.

* **`ocr_id`**: String.
* **`frame_ids`**: String array - frames where the text appears.
* **`start_ms`**: Integer.
* **`end_ms`**: Integer.
* **`text`**: String.
* **`on_screen_duration_ms`**: Integer.
* **`region_size`**: Number, optional - percentage of screen area covered by the
  text box.
* **`font_size_px`**: Integer, optional.

### Visual Frames

Visual context should be frame-based so agents can reference the exact frame
evidence they used.

* **`frame_id`**: String.
* **`timestamp_ms`**: Integer.
* **`image_url`**: String, optional - stored frame asset URL if available.
* **`visual_description`**: String - concise description of visible action,
  environment, product, logo, text, and notable quality issues.
* **`people`**: Object, optional - count, apparent age descriptors,
  presentation descriptors, activity, and clothing style.
* **`color_palette`**: Object, optional - dominant colors and lighting quality.
* **`background`**: Object, optional - location type and mood.
* **`camera_movement`**: `"static" | "pan" | "zoom" | "handheld"`, optional.
* **`technical_flags`**: String array - visual artifacts, bad transitions,
  framing problems, or other notable quality issues.

### Product Frames

Product visibility is frame-based, not moment-based.

* **`frame_id`**: String.
* **`timestamp_ms`**: Integer.
* **`location`**: Object, optional - bounding box or processor-specific location.
* **`confidence_score`**: Number.
* **`prominence`**:
  `"foreground_in_use" | "foreground_static" | "background" | "not_visible"`,
  optional.
* **`focus_quality`**: `"sharp" | "soft_focus" | "blurry"`, optional.
* **`framing`**: `"fully_visible" | "partially_cropped" | "heavily_obscured"`,
  optional.
* **`usage_context`**: String, optional.

### Logo Frames

Logo visibility is frame-based and may overlap with product frames.

* **`frame_id`**: String.
* **`timestamp_ms`**: Integer.
* **`location`**: Object, optional - bounding box or processor-specific location.
* **`confidence_score`**: Number.
* **`prominence`**:
  `"large_central" | "small_corner" | "background_signage" | "absent"`,
  optional.
* **`reference_match`**:
  `"matches_reference" | "differs_from_reference" | "cannot_determine"`,
  optional.

### Product Context

* **`raw_text`**: String, optional - product page, source material, or campaign
  notes.
* **`claims`**: String array - verified source claims.
* **`contraindications`**: String array - warnings, limitations, or prohibited
  interpretations.
* **`reference_asset_urls`**: String array - approved logo, packaging, or style
  guide assets.

---

## Agent-Specific Use

* **Claims Accuracy** derives claim candidates from transcript and OCR, then
  compares them against parsed brief and product context.
* **CTA Effectiveness** derives CTA candidates from transcript and OCR, then
  checks timing, clarity, visibility, destination, and platform fit.
* **Storyline Clarity** uses video metadata, transcript, OCR, and visual frames.
* **Product Representation** uses product frames, logo frames, transcript, OCR,
  and product context.
* **Visual Quality** uses video metadata, OCR, and visual frame technical flags.
* **Brand Alignment** uses parsed brief, transcript, OCR, visual frames, logo
  frames, and product context.
* **Brief Alignment** uses parsed brief, transcript, OCR, visual frames, product
  frames, and campaign context.
