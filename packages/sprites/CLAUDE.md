# packages/sprites

Every piece of art in the office, as text. One character per pixel, every
colour from `src/palette.json`. `scripts/compile.ts` turns the `.px` files into
`dist/atlas.png`, `dist/atlas.json` (a PixiJS spritesheet) and `dist/meta.json`
(footprints, origins, spots and lights).

- `FORMAT.md` is the contract: the grid, the camera, the file format, the
  sprites the room builder asks for by name, and the `staff` animation names.
- `ART.md` is the style guide: palette roles, outlines, shading, and how to add
  an Odd or a prop that matches.
- `src/tiles/` holds walls and floors, `src/props/` furniture and objects,
  `src/characters/` the Odds' bodies and portraits, `src/fx/` the icons that
  play once over an Odd (`fx-pop`, one animation per icon).
- `out/` holds enlarged previews after a compile. Open them to check work.
  Gitignored.

- `looks/` holds generated looks: bald bodies keyed by region, per-frame
  anchors, hairstyles, tops, bottoms, face shapes, colour swatches and example portraits,
  with its own palette. `src/look.ts` builds a person's 57 frames from them
  on the server. `out/looks.png` shows every part after a build.
  `looks/managers/` holds the portraits of the ready-made Office Managers
  whose looks are generated (their specs live in the ledger's `managers.ts`).

- `scripts/mark.ts` draws Oddboro's mark, the glowing pixel O, into every
  icon and logo file (`npm run mark`, on a Mac). ART.md says where each goes.

- `src/props/street/street-bus.px` is the bus that brings a new owner's Office
  Manager on their first visit.

- `src/art.ts` (`@oddboro/sprites/art`) checks art the office draws at
  design time: props, wall hangings, desk pieces, floors and wall styles, in
  the house palette. It mends rows a few pixels off, derives a wall style's
  cap, door and window from the plaster ones in the style's four tones, and
  packs drawn sprites into one sheet the floor loads beside the atlas.

- Both sheets, the compiled atlas and the drawn one, leave a 2px gutter
  between frames and fill it with each frame's edge pixels (`extrude` in
  `src/png.ts`). An empty gutter shows as see-through lines between tiles
  while the camera moves.

A new prop is one `.px` file. A new hire needs no file here: the office draws
them from parts. A new part is one `.px` file in `looks/`.
