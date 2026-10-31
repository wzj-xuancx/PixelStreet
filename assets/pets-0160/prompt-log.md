# P5 pet art prompt log

Generated with the built-in `image_gen` tool. Final project assets are copied unchanged from the generated source files. No CLI/API image generation or raster post-processing was used.

## Pet concept

- Final source: `[local-source-redacted]`
- Initial source/reference for the localized edit: `[local-source-redacted]`
- References: `assets/atlas.png` (street slime identity/color), `assets/bonds-070/companions-v2.png` (companion rendering style), `assets/equipment-0160/inventory-concept.png` (parchment/moss/bronze visual system)
- Output: `assets/pets-0160/pet-concept.png`
- SHA-256: `4f930a27225e39d93f3217de9c7b07086c3afc6f8e81325360ba6039781bc53f`

Initial prompt:

```text
Create a compact pet profile UI concept for PixelStreet in the same cozy hand-painted storybook style as the supplied inventory concept: warm parchment panel, deep moss-green inset areas, restrained bronze/gold trim, crisp compact forms. References have distinct roles: assets/atlas.png contains the actual tiny mint-teal slime in the street; assets/bonds-070/companions-v2.png provides the established slime/companion rendering style; the equipment concept supplies only the paper-and-moss visual system. The pet is one same established starter slime named “苔团子”: mint/teal body, friendly simple face, just a few tiny green leaves on top. Do not change it to bright yellow-green or a different species. Do not show the brown-haired player.

Show one single slime in the center of a clean compact pet dossier card. Keep the layout focused on pet identity and equipment, not a full inventory screen. Include exactly three small equipment slots with concise Chinese labels: “项圈”, “护具”, “护符”; each slot has its matching art: a simple brown leather explorer collar with a small brass bell; a leaf bodyguard made of layered green leaves; an amber sun charm, clearly golden-orange rather than a blue pendant. Include exactly two clear role buttons labeled “休闲” and “挂机”. Both buttons refer to the same single pet changing duties; do not duplicate the slime or depict alternate pet copies. Use the heading “苔团子”. No item numbers, stats, prices, currencies, unlock progress, extra item grid, extra pets, species selection, or claim of free currency/materials. No dense text, no full backpack, no extra panels, no logos or watermark.
```

Localized concept edit prompt:

```text
Make one localized visual edit to the supplied PixelStreet pet profile concept. Preserve the parchment and bronze UI, all Chinese text and labels, the three gear slots and their item icons, the two duty buttons, their colors, positions, borders and spacing exactly. Change only the central mint-teal slime's leafy crown: reduce it from large broad leaves to a small, subtle sprout of two tiny green leaves no wider than about one fifth of the slime body, so the character matches the tiny leaf details of the street slime. Keep the same single slime body, face, mint-teal color, proportions, and collar bell. Do not add or remove any UI elements, characters, items, numbers, or text.
```

## Portrait and three gear icons

- Final source: `[local-source-redacted]`
- Initial atlas source: `[local-source-redacted]`
- Collar edit source: `[local-source-redacted]`
- References: `assets/atlas.png`, `assets/bonds-070/companions-v2.png`, `assets/pets-0160/pet-concept.png`
- Output: `assets/pets-0160/pet-atlas-2x2.png`
- SHA-256: `c9549a6f6ede55e31ef89689299da2b9a97e0712717bf757336a651f32dd818c`
- Measured crop bounds: `assets/pets-0160/frames.json`

Initial atlas prompt:

```text
Create a genuinely transparent production sprite atlas for PixelStreet pet equipment, arranged as a 2-column by 2-row sheet with four standalone icons in this exact row-major order: (1) the same mint-teal slime pet 苔团子 as a clean unadorned portrait (round soft blob body, friendly simple face, two or three small leaf sprouts; no collar, no armor, no charm), (2) a brown leather explorer collar shown as a small curved collar ring with one clearly visible brass bell, (3) a wearable leaf bodyguard for a small slime: a compact curved guard/mantle made from layered green leaves with one simple leather fastening, (4) a distinct amber sunlight charm: a golden-orange sun motif with a warm amber center and short readable rays, small loop for attaching to gear. The charm must be amber/orange, not blue, and must not resemble the character's blue-stone pendant.

Identity/style references: assets/atlas.png is the exact mint/teal street slime color reference; assets/bonds-070/companions-v2.png and the supplied pet concept are the established hand-painted storybook companion style reference, but do not copy the bright lime variant or any other species. Make the portrait the same single pet from the concept, not another pet and not a second duty-state copy. The four icons must have distinct, simple silhouettes and strong color grouping, readable when downscaled to 64×64 pixels. Use enough transparent padding and separation to crop each icon independently, but no visible cell boxes, frames, backplates, text, labels, numbers, background, scene, ground, shadows on a background, watermark or logo. No humans, no extra species, no extra items. Output a transparent PNG.
```

Collar edit prompt:

```text
Edit the supplied transparent PixelStreet pet atlas with a very narrow correction. Preserve the whole 2×2 layout, canvas, positions, style, colors, transparency, and every pixel region as closely as possible. Change only the top-right brown leather explorer collar: replace its current lock/keyhole-looking gold ornament with one unmistakable small brass bell, a domed bell body with a flared lower rim and tiny clapper. No keyhole, no hole, no padlock. Keep the brown leather ring and its small green leaf accent. Leave the top-left mint-teal slime portrait, bottom-left leaf bodyguard, and bottom-right amber sun charm visually unchanged. Keep all backgrounds transparent and all four icons separated.
```

Portrait leaf refinement prompt:

```text
Edit the supplied transparent PixelStreet 2×2 pet atlas with a localized correction to the top-left portrait only. Keep the mint-teal slime body, face, dimensions, location, and expression exactly. Reduce its leafy crown to a small sprout of two tiny mint-green leaves, each much smaller than either eye and no wider than about one fifth of the body, to match the subtle leaf detail of the street pet. Do not add extra leaves or flowers to the portrait. Preserve the top-right explorer collar with brass bell, bottom-left leaf bodyguard, and bottom-right amber sun charm exactly as they appear. Preserve the transparent background, canvas, all four icon positions and spacing. Do not change any other icon or add text, frames, or a background.
```
