# AdReady Orchestrator Input Specification

## Root-Level Fields

* **`variant_id`**: String (UUID) — System ID for the creative variant.
* **`review_id`**: String (UUID) — System ID for the review process.
* **`creative_brief`**: String — Ground truth guidelines and campaign instructions (e.g., objectives, required CTAs).
* **`campaign_goal`**: String — The main marketing objective (e.g., `"awareness"`).
* **`destination_platform`**: String — The publishing target (e.g., `"tiktok"`).

---

## Video Metadata (`video_metadata`)

* **`duration_ms`**: Integer — Total video length in milliseconds.
* **`aspect_ratio`**: String — Screen shape (e.g., `"9:16"`).
* **`resolution`**: String — Pixel dimensions (e.g., `"1080x1920"`).
* **`dropped_frame_markers`**: Array — List of timestamps where frames were dropped during processing.

---

## Transcript Segments (`transcript_segments`)

*An array of spoken elements parsed from the audio track. Each segment contains:*

* **`segment_id`**: String — Unique segment identifier (e.g., `"tr_001"`).
* **`start_ms`**: Integer — Start time of the spoken segment.
* **`end_ms`**: Integer — End time of the spoken segment.
* **`text`**: String — The actual spoken words.
* **`speaker`**: String — Who is talking (e.g., `"narrator"`, `"character"`) -> check if possible?


> **NOTE:** music detection - to check if noise drowns narration? no need to detect actual music.

---

## OCR Segments (`ocr_segments`)

*An array of text blocks detected visually on-screen. Each segment contains:*

* frame_id: a list of frames (tracks all frmaes containing ocr)
* **`ocr_id`**: String — Unique OCR block identifier (e.g., `"ocr_001"`).
* **`start_ms`**: Integer — Start time of when the text appears on screen.
* **`end_ms`**: Integer — End time of when the text disappears.
* **`text`**: String — The parsed on-screen text (e.g., `"8g plant protein"`).
* **`on_screen_duration_ms`**: Integer — Total duration the text is visible.
* **`region_size`**: Float — Percentage of screen area covered by the text box. (optional)
* **`font_size_px`**: Integer — Approximated size of the text. (optional)

---

## Frames Breakdown (`scene_segments`)

*A chronological list of frame cuts. Each scene contains:*

* **`frame_id`**: String — Unique scene identifier (e.g., `"scene_01"`).
* **`timestamp`**: Integer — Scene start time.
* **`visual_description`**: String — A 1–3 sentence plain text summary of the physical action happening in this scene. (needs to include - logo + product details like logo absent/incorrect and product notshown/obscured, color palette ; optional/not required: lighting, weird transitions, ai artifacts)

### People

* people (number, gender, age) - checks demographic mismatch

  * `count`: int
  * `apparent_ages`: string[] // e.g. `["adult, late 20s"]`
  * `apparent_presentation`: string[] // loosely described details about them if something stands out
  * `activity`: string // what they're doing
  * `clothing_style`: string

### Color Palette

* color palette (need to check)

  * `dominant_colors`: string[]
  * `lighting_quality`: string // `"well-lit, natural daylight"` / `"overexposed"` / `"dim, underexposed"`

### Scenary/Background

* scenary/background

  * `location_type`: string // e.g. `"modern kitchen"`, `"outdoor park"`, `"plain studio backdrop"`
  * `mood`: string // e.g. `"bright, energetic"` / `"calm, minimal"`

### EXTRA

* `camera_movement`: `"static"` | `"pan"` | `"zoom"` | `"handheld"` (check if this can this be added?)

* `technical_flags`: string[]

  * // Free-text notes on anything visually anomalous: `"possible distortion on hand at 0:07"`, `"background inconsistent during pan"`. Only Visual Quality's artifact check can work at all if this is explicitly solicited — a normal `"what's happening"` narration will not surface this on its own.

---

## Product Moments (`product_moments`)

*Specific intervals where physical branding or packaging is shown. Each moment contains:*

* **`frame_id`**: Per frames — Unique moment identifier (e.g., `"pm_01"`).
* **`location`**: location (bounding box coordinates)
* **`confidence score`

### Other details (optional)

* `prominence`: `"foreground_in_use"` | `"foreground_static"` | `"background"` | `"not_visible"`
* `focus_quality`: `"sharp"` | `"soft_focus"` | `"blurry"`
* `framing`: `"fully_visible"` | `"partially_cropped"` | `"heavily_obscured"`
* `usage_context`: string // e.g. `"being applied to skin"`, `"held up to camera"`, `"sitting on counter"`

---

## Logo Moments (`product_moments`)

*Specific intervals where physical branding or packaging is shown. Each moment contains:*

* **`frame_id`**: Per frames — Unique moment identifier (e.g., `"pm_01"`).
* **`location`**: location (bounding box coordinates)
* `confidence score`

### Other details (optional)

* `prominence`: `"large_central"` | `"small_corner"` | `"background_signage"` | `"absent"`
* `reference_match`: `"matches_reference"` | `"differs_from_reference"` | `"cannot_determine"`
