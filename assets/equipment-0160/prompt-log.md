# P4 equipment art prompt log

All images were generated with the built-in `image_gen` tool. The files below are copied unchanged from the generated source paths into this project. No CLI/API image generation or post-generation image editing was used.

## Inventory concept

- Generated source: `[local-source-redacted]`
- References: `assets/atlas.png` (player identity), `../PixelStreet-0130-review-2026-10-24/art/inventory-main-concept.png` (style/layout), `assets/inventory-next/items.png` (item illustration style)
- Output: `assets/equipment-0160/inventory-concept.png`
- SHA-256: `598ddce69adc2b6b4fbc9a4c7ca77773d09f645ae7a2610bfd96e75ff0b91bbe`

Prompt:

> Create a polished, compact inventory/equipment screen concept for the cozy fantasy desktop game PixelStreet. Use the supplied references with these roles: (1) assets/atlas.png is the exact player identity reference: a tiny brown-haired adventurer wearing a teal/blue hood and coat with a red belt; the small glowing cyan companion sprites in that atlas are not the player and must not be enlarged, featured, or mistaken for a green lantern pet. Keep the character recognizable as this same brown-haired, teal-blue-clad adventurer. (2) the prior inventory concept is a style and layout reference only: warm parchment, deep moss-green inset panels, restrained bronze/gold trim, hand-painted storybook RPG rendering with pixel-friendly silhouettes. (3) items.png supplies the existing game item illustration language: clean, colorful, hand-painted icons with distinct shapes.
>
> Composition: a single clean 16:10 game UI panel on a plain warm cream outer margin. Header reads only “背包”. The main upper area centers a full-body portrait of the exact brown-haired teal-blue-hood-and-coat player identity, front facing, visible red belt. Arrange exactly six large equipment slots around them: left column, top-to-bottom, labeled “头部”, “身体”, “手部”; right column, top-to-bottom, labeled “主手”, “饰品”, “足部”. Each slot contains one simple starter gear icon. Below the character area, a tidy 5-column by 2-row bag grid with a few small starter supplies and several empty moss-backed slots; include no distracting sidebars. Show a small, legible hover/compare tooltip beside one hovered equipment slot, with Chinese heading “青蓝风帽”, a clear candidate-versus-current comparison using simple up/down arrows and tiny concise stats; keep this inset modest and uncluttered. The visual hierarchy should be immediately understandable: character, six slots, then bag grid.
>
> Keep interface typography minimal and readable, labels exactly as specified, no extra prose, no logos or watermark. Avoid excessive foliage, dense ornament, oversized frame borders, green lanterns, pets, weapons unrelated to the starter gear, and any change to the player's signature brown hair / teal-blue hood-and-coat / red belt. This is a UI CONCEPT image, not a production sprite sheet.

## Hero portrait

- Generated source: `[local-source-redacted]`
- References: `assets/atlas.png` (player identity), `assets/equipment-0160/inventory-concept.png` (approved style/palette)
- Output: `assets/equipment-0160/hero-portrait.png`
- SHA-256: `e2525a4dc03a1ccb6f0b89364522794b7109715c29fde83b6dc063925986b6ef`

Prompt:

> Production character portrait for PixelStreet equipment paperdoll. Use the supplied atlas as the exact identity reference: the small brown-haired adventurer with teal/blue hood and coat and a clearly visible red belt; do not confuse this player with the tiny cyan companion sprites. Use the inventory concept only for the approved hand-painted storybook RPG rendering and palette. Create one clean, full-body, front-facing but gently three-quarter standing pose, centered with comfortable transparent padding on every side. Show the complete boots, hood, face, coat hem, both hands, and red belt. Keep the coat teal-blue, hood teal-blue, hair warm brown, belt visibly red. The adventurer stands neutrally with both hands empty at their sides; no weapon in either hand. Simple starter travel clothes: understated brown gloves and sturdy brown boots are fine. Strong readable silhouette, polished hand-painted game-character art with crisp small-scale edges, restrained detail, no pedestal, no ground shadow, no frame, no background, no scenery, no props, no pet, no lantern, no text, no logos, no watermark. Output a genuinely transparent PNG.

## Seven-item gear atlas

- Generated source: `[local-source-redacted]`
- References: `assets/atlas.png` (identity/palette), `assets/inventory-next/items.png` (item illustration language), `assets/equipment-0160/hero-portrait.png` (matching character style)
- Output: `assets/equipment-0160/gear-atlas-4x2.png`
- SHA-256: `e573dee34e2122c7250ac7ba2cfbf85ac110de2ad8f9a66c0e34a0c718432cdd`
- Crop bounds: `assets/equipment-0160/frames.json`

Prompt:

> Create a transparent production sprite atlas for PixelStreet: exactly seven distinct, standalone starter-equipment item icons arranged in a 4-column by 2-row sheet. Use the exact reading order: top row from left to right = (1) blue-teal adventurer hood, (2) teal travel coat with the signature red belt clearly visible, (3) brown leather gloves as a pair, (4) sturdy brown travel boots as a pair; bottom row from left to right = (5) short simple trail sword, (6) blue stone pendant on a small cord, (7) amber leaf brooch (a real alternative accessory to the blue pendant, gatherer / nature motif), (8) EMPTY TRANSPARENT CELL with no object. The final bottom-right cell must remain truly empty and fully transparent.
>
> Design direction: crisp hand-painted storybook RPG icons consistent with the supplied PixelStreet items and player portrait, readable at 64×64 pixels. Strong distinct silhouettes, compact forms, centered icon placement, controlled highlights and shadow, restrained nature details. Keep every icon separate with large transparent gaps so each can be cropped independently. No boxes, no slot frames, no backplates, no shadows cast onto a background, no text, no labels, no numbers, no logo, no scenery, no extra objects, no duplicates. Do not add a green lantern or pet. Output a genuinely transparent PNG.
