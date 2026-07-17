## AdReady Orchestrator Input Specification

### Root-Level Fields

* **`variant_id`**: String (UUID) — System ID for the creative variant.
* **`review_id`**: String (UUID) — System ID for the review process.
* **`creative_brief`**: String — Ground truth guidelines and campaign instructions (e.g., objectives, required CTAs).
* **`campaign_goal`**: String — The main marketing objective (e.g., `"awareness"`).
* **`destination_platform`**: String — The publishing target (e.g., `"tiktok"`).

---

### Video Metadata (`video_metadata`)

* **`duration_ms`**: Integer — Total video length in milliseconds.
* **`aspect_ratio`**: String — Screen shape (e.g., `"9:16"`).
* **`resolution`**: String — Pixel dimensions (e.g., `"1080x1920"`).
* **`corruption_flag`**: Boolean — Instant-fail flag. If `true`, the orchestrator immediately halts analysis.
* **`dropped_frame_markers`**: Array — List of timestamps where frames were dropped during processing.

---

### Transcript Segments (`transcript_segments`)

* *An array of spoken elements parsed from the audio track. Each segment contains:*
* **`segment_id`**: String — Unique segment identifier (e.g., `"tr_001"`).
* **`start_ms`**: Integer — Start time of the spoken segment.
* **`end_ms`**: Integer — End time of the spoken segment.
* **`text`**: String — The actual spoken words.
* **`speaker`**: String — Who is talking (e.g., `"narrator"`, `"character"`) -> check if possible?



---

### OCR Segments (`ocr_segments`)

* *An array of text blocks detected visually on-screen. Each segment contains:*
* **`segment_id`**: String — Unique OCR block identifier (e.g., `"ocr_001"`).
* **`start_ms`**: Integer — Start time of when the text appears on screen.
* **`end_ms`**: Integer — End time of when the text disappears.
* **`text`**: String — The parsed on-screen text (e.g., `"8g plant protein"`).
* **`confidence`**: Float — OCR engine confidence score (ranging from `0.0` to `1.0`).
* **`on_screen_duration_ms`**: Integer — Total duration the text is visible.
* **`contrast_ratio`**: Float — Color contrast calculation (used to detect readability compliance).
* **`region_size`**: Float — Percentage of screen area covered by the text box.
* **`font_size_px`**: Integer — Approximated size of the text.



---

### Scene Breakdown (`scene_segments`)

* *A chronological list of logical visual scene cuts. Each scene contains:*
* **`scene_id`**: String — Unique scene identifier (e.g., `"scene_01"`).
* **`start_ms`**: Integer — Scene start time.
* **`end_ms`**: Integer — Scene end time.
* **`visual_description`**: String — A 1–3 sentence plain text summary of the physical action happening in this scene.



---

### Detected Claims (`detected_claims`)

* *Claims identified within the video content. Each claim contains:*
* **`claim_id`**: String — Unique claim identifier (e.g., `"claim_01"`).
* **`text`**: String — The statement being asserted.
* **`source`**: String — How the claim was detected (e.g., `"ocr"`, `"transcript"`).
* **`start_ms`**: Integer — Start timestamp of the claim.
* **`end_ms`**: Integer — End timestamp of the claim.



---

### Detected CTAs (`detected_ctas`)

* *Calls-to-action detected in the ad. Each CTA contains:*
* **`cta_id`**: String — Unique CTA identifier (e.g., `"cta_01"`).
* **`text`**: String — The CTA phrasing (e.g., `"Try Mango Moon"`).
* **`source`**: String — How the CTA was detected (e.g., `"visual"`, `"ocr"`, `"transcript"`).
* **`start_ms`**: Integer — Start timestamp of the CTA presentation.
* **`end_ms`**: Integer — End timestamp of the CTA presentation.



---

### Product Moments (`product_moments`)

* *Specific intervals where physical branding or packaging is shown. Each moment contains:*
* **`moment_id`**: String — Unique moment identifier (e.g., `"pm_01"`).
* **`start_ms`**: Integer — When branding becomes visible.
* **`end_ms`**: Integer — When branding is no longer visible.
* **`frame_ids`**: Array of Strings — List of frame IDs associated with this product moment.



---

### Reference Assets (`reference_assets`)

* *Ground-truth brand files used to audit the video's accuracy. Each asset contains:*
* **`asset_id`**: String — Unique reference identifier (e.g., `"ref_01"`).
* **`type`**: String — Category of asset (e.g., `"product_image"`, `"logo"`, `"color_profile"`).
* **`image_url`**: String — CDN link to the reference master asset.