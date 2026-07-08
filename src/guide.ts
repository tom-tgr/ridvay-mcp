/**
 * Authoring guide returned by the get_design_guide tool. This is what teaches
 * a client LLM to compose Ridvay design IR itself (create_poster) instead of
 * delegating creative work to Ridvay's generation pipeline (generate_poster).
 * Field names mirror the API's DesignIr contract exactly.
 */
export const DESIGN_GUIDE = `# Ridvay design IR — authoring guide

Compose a JSON document in this format and pass it as the \`design\` argument of
\`create_poster\`. Ridvay saves it, renders it pixel-perfectly in the Studio editor,
and returns share/edit links. You are the designer: pick the layout, colors, and type.

## Document shape

{
  "version": "1.0",
  "type": "design",
  "title": "Human-readable design title",
  "pages": [ { <page> } ]          // one page per poster; multiple pages allowed
}

## Page

{
  "width": 1080, "height": 1350,   // px canvas. 1080x1080 square, 1080x1350 portrait post,
                                   // 1080x1920 story, 1920x1080 landscape
  "background": <background>,
  "elements": [ <element>, ... ]
}

## Background (pick one form)

Solid:    { "type": "solid", "color": "#101418" }
Gradient: { "type": "gradient", "stops": [ { "color": "#0f2027", "offset": 0 },
            { "color": "#2c5364", "offset": 1 } ], "angle": 135 }
AI/stock image: { "type": "image", "prompt": "vivid description of the photo",
            "keywords": "2-4 plain search words", "overlay": "#00000059" }
  — image backgrounds are rendered server-side AFTER creation (takes ~1 min; the tool
    reports this). "overlay" paints a scrim over the photo so text stays legible.
    Solid/gradient backgrounds are instant and free — prefer them unless a photo is essential.

## Elements — absolute layout on the page canvas

Common fields: { "id": "unique-string", "type": "...", "x": 0, "y": 0,
                 "width": 100, "height": 100, "rotation": 0, "opacity": 1, "z": 0 }
Higher "z" draws on top. Keep ~80px margins from page edges.

### type "text"
{ ..., "type": "text",
  "lines": [ { "text": "GRAND OPENING", "fontFamily": "Archivo Black",
               "fontSize": 110, "fontWeight": 700, "color": "#ffffff",
               "letterSpacing": 2, "lineHeight": 1.05 } ] }
- Each line renders as its own display line; "noWrap": true forces single-line fit.
- Any Google Fonts family works ("Inter", "Playfair Display", "Space Grotesk",
  "Archivo Black", "DM Serif Display", "Bebas Neue", …). Use at most 2 families.
- The element's width/height is the text box; size fonts so text fits comfortably.

### type "shape"
{ ..., "type": "shape", "shape": "rect" | "ellipse" | "line",
  "fill": "#f4b41a", "stroke": "#00000000" }
Use thin rects as divider lines and ellipses/rects (with low opacity or as color blocks)
for composition accents.

### type "image"
One of three sources:
- Hosted picture:  { ..., "type": "image", "src": "https://…" }
- AI/stock render: { ..., "type": "image", "prompt": "what to depict",
                     "style": "photo" | "illustration", "aspect": "square" }
                   (rendered server-side after creation, like image backgrounds)
- Free vector:     { ..., "type": "image", "canonicalKey": "icon:coffee" }
    Catalog keys: "icon:<lucide-name>" (icon:map-pin, icon:sparkles),
    "logo:<brand-slug>" (logo:github, logo:instagram — simple-icons slugs),
    "geo:<country>" or "geo:us-<state>" outline maps (geo:philippines, geo:us-texas).

### type "icon"
{ ..., "type": "icon", "icon": "icon:star" } — small decorative catalog icon.

## Motion (optional) — for animated posters / video

Motion fields are optional; omit them for a static poster. To animate, add them to pages/elements,
then the caller can render an MP4 with export_video (or call animate_poster to auto-add motion).

- Page-level: "sceneDuration" (seconds the page holds, 0.5–60, default 5) and
  "transition": { "preset": "fade" | "slide" | "dissolve" | "morph", "durationMs": 700 }.
- Element-level: "motion": { "in": {...}, "out": {...}, "loop": {...} } where each step is
  { "preset": ..., "durationMs": 600, "delayMs": 0 }.
  - Entrance/exit presets: "fade" | "slide-up" | "slide-down" | "slide-left" | "slide-right" |
    "pop" | "rise" | "zoom" | "wipe". Text-only: "typewriter" | "letters" | "bang".
  - Loop presets (scene-long emphasis): "pulse" | "rainbow".
- Multi-page morph is the signature look: give the SAME element "id" on consecutive pages and it
  tweens position/size/color between them. Set "noMorph": true to opt an element out.
- Stagger entrances with increasing delayMs (e.g. 0, 120, 240) so elements arrive in sequence.

Example element with motion:
{ "id": "headline", "type": "text", "x": 90, "y": 240, "width": 900, "height": 300, "z": 2,
  "motion": { "in": { "preset": "typewriter", "durationMs": 900 } },
  "lines": [ { "text": "Espresso", "fontSize": 130, "color": "#f7efe6" } ] }

## Design craft checklist

- One dominant headline (90–140px on a 1080 canvas), clear hierarchy below it.
- Strong contrast between text and what's behind it (use background "overlay" or a
  shape panel under text on busy imagery).
- Align to a simple grid; don't scatter elements. Leave breathing room.
- 2–4 colors total. Dark-background posters with one accent color look premium.
- Don't overlap text elements; check x/y/width/height boxes don't collide.

## Minimal complete example

{
  "version": "1.0", "type": "design", "title": "Espresso Tasting Night",
  "pages": [ {
    "width": 1080, "height": 1350,
    "background": { "type": "gradient", "angle": 160,
      "stops": [ { "color": "#1b130f", "offset": 0 }, { "color": "#3e2a1e", "offset": 1 } ] },
    "elements": [
      { "id": "kicker", "type": "text", "x": 90, "y": 140, "width": 900, "height": 60, "z": 2,
        "lines": [ { "text": "KAPE TALA PRESENTS", "fontFamily": "Inter", "fontSize": 34,
                     "fontWeight": 600, "color": "#d8a24a", "letterSpacing": 6 } ] },
      { "id": "headline", "type": "text", "x": 90, "y": 240, "width": 900, "height": 300, "z": 2,
        "lines": [ { "text": "Espresso", "fontFamily": "DM Serif Display", "fontSize": 130,
                     "fontWeight": 400, "color": "#f7efe6" },
                   { "text": "Tasting Night", "fontFamily": "DM Serif Display", "fontSize": 130,
                     "fontWeight": 400, "color": "#f7efe6" } ] },
      { "id": "rule", "type": "shape", "shape": "rect", "x": 90, "y": 600, "width": 220,
        "height": 6, "z": 2, "fill": "#d8a24a" },
      { "id": "details", "type": "text", "x": 90, "y": 660, "width": 900, "height": 120, "z": 2,
        "lines": [ { "text": "Friday, August 8 · 7 PM · 123 Stellar Way", "fontFamily": "Inter",
                     "fontSize": 40, "fontWeight": 500, "color": "#e8dccc" } ] },
      { "id": "mark", "type": "image", "canonicalKey": "icon:coffee", "x": 90, "y": 1130,
        "width": 90, "height": 90, "z": 2, "opacity": 0.9 }
    ]
  } ]
}
`;
