# Oddboro art guide

How to draw for the office so a new piece sits beside the old ones without a
seam. Read `FORMAT.md` first for the file format. This file is about the look.

## The look in one paragraph

A warm workshop, not a corporate floor. Cream plaster walls, honey oak
underfoot, walnut trim, and one cool signature: deep sea teal, which is where
the Oddboro name lives. Teal is the colour of screens, chairs, lamp shades
and the accent wall. Rust and amber are the warm counterweights. Light comes
from the upper left all day; at night the renderer darkens the room and each
lamp and screen adds back its own pool. Every colour has to survive both.

## The name in the art

Three sprites carry the name with a placeholder, and each says so in its
comment:

- `lobby-sign` spells ODDBORO in backlit `G` letters over a `t` rule.
- `street-front-door` spells ODDBORO on the awning valance, in every frame.
- `street-bus-shelter` has a placeholder poster: a glowing O roundel over two
  lines of type, since seven letters do not fit its eight pixels.

Oddboro's mark is the glowing pixel O on black: a 10 by 14 grid in
`scripts/mark.ts`, the letter in screen aqua (`G`) with a glow aqua (`g`)
edge and one ring of teal deep (`6`) glow. `npm run mark` draws it into the
app's icons, `logo.png` in `apps/office/static/` and `apps/site/static/` (the
favicons, the site's header and footer) and the Google sign-in logo. Change
the grid there, never the PNGs. The three sprites above still carry the
placeholder. Redraw them to match the mark, then rerun
`npm run art -w @oddboro/site`. Never draw a product name or mark from before
Oddboro.

## Palette roles

`src/palette.json` is the only source of colour. Keys and what they are for:

| Role                  | Keys                    | Notes                                                         |
| --------------------- | ----------------------- | ------------------------------------------------------------- |
| Outline               | `k`                     | Every object silhouette. The one dark that touches the floor. |
| Soft dark             | `K`                     | Inner lines, charcoal cloth, lapels. Never the outer edge.    |
| Paper, whites of eyes | `=`                     |                                                               |
| Plaster wall          | `P` `p` `q` `Q`         | Light to deep. `Q` only under a cap or in a crease.           |
| Oak                   | `o` `O` `1` `2`         | Floors, the default desk. `2` is the plank seam.              |
| Walnut                | `w` `W` `3`             | Trim, frames, shelves, baseboards, shoes.                     |
| Ash                   | `a` `A` `4`             | A pale wood for variants.                                     |
| Metal                 | `m` `M` `5`             | Bezels, stands, cabinets. Also silver hair.                   |
| Teal (the accent)     | `t` `T` `6` `7`         | Light to abyss. `7` is the deepest colour we have.            |
| Screen glow           | `g` `G`                 | Only on things that emit light.                               |
| Rust                  | `r` `R` `8`             | Lamps, rugs, pots, a blouse. Also auburn hair.                |
| Amber                 | `y` `Y` `9`             | Book spines, a jumper. Also blond hair.                       |
| Lamp light            | `l` `L`                 | The lit underside of a shade. Pair with a `light` directive.  |
| Sage                  | `s` `S` `0`             | Fabric only. Not for plants.                                  |
| Leaf                  | `v` `V` `!`             | Plants only. Not for fabric.                                  |
| Carpet                | `c` `C` `%`             | The slate carpet floor.                                       |
| Kitchen tile          | `e` `E`                 | The mint tile in the kitchen floor.                           |
| Skin                  | `f`/`F` `d`/`D` `b`/`B` | Three tones, each with its shade.                             |
| Hair                  | `n`/`N` `i`/`I`         | Brown and black. Borrow `m`/`M`, `Y`/`y`, `R`/`8` for more.   |
| Shirt                 | `z` `Z`                 | The base body's shirt. Variants swap it.                      |
| Trousers              | `^` `&`                 | The base body's trousers. Variants swap it.                   |
| Shadow                | `-` `_`                 | Translucent. Under feet, under a wall.                        |
| Glass                 | `/` `(`                 | Translucent pane and its shine.                               |

Rules that follow from the table:

- Do not add a colour for one sprite. If a prop needs a tone we lack, add it
  to the palette with a role, and expect it to be used again.
- Leaf greens and sage greens are different families on purpose. A sage chair
  next to a fern reads as two things because they never share a key.
- Translucent keys (`-`, `_`, `/`, `(`) only work over something outside the
  sprite. Inside a sprite, shade with the material's own darker key.

## Outline

Every object has a full `k` outline, one pixel, on the outside edge. Inside
the shape, separate parts with the material's dark key (`2` between planks,
`W` between shelves) or with `K`, never with `k`. The eye reads `k` as
silhouette, so an inner `k` line splits the object in two.

Floors and wall faces have no outline. The cap of a wall has `k` on every
open side, which is what makes a room's edge read.

Characters are the exception that proves it: their inner arm lines are `k`
because at 16 pixels wide there is no room for a softer line to show.

## Light and shade

Light comes from the upper left. Always.

- The top of a thing is its lightest face. Its front is the middle tone. Its
  right side and underside are the dark tone.
- One highlight pixel at the top left of a rounded thing (a mug, a head of
  hair, a shade). One, not a streak.
- Shade with the next key down in the same family, not with black and not
  with a translucent overlay.
- Indoor props cast no painted shadow on the floor. The renderer's lights and
  the wall shadow do that work. An Odd's body has a short translucent shadow
  under its feet so it sits on the floor.
- Outdoor props that stand on grass (trees, saplings, stumps, logs, large
  bushes) carry a soft `-` and `_` ellipse under the trunk, inside the sprite
  box, so they sit on the ground.
- Trees come in sizes: `park-tree-large`, `park-tree`, `park-tree-small`,
  `park-sapling`, and two pines. Grounds layouts mix them, big trees in a
  grove's middle and young ones at its edge, with open grass between groves.

Anything that emits light carries a `light` directive. Lamps use `#ffd27a`,
screens use `#63dccf`. Radius about twice the lamp's height, intensity near
1.0 for a lamp and 0.7 for a screen. Check the 9 PM render: a lamp should
pool on the desk and the floor beneath it, not wash the room.

## Materials

- **Wood.** Flat body colour, a one pixel lighter line along the top edge of
  each plank or board, short grain streaks in the dark key, never a full
  line. A plank end is a vertical dark seam. Oak for floors and desks,
  walnut for anything that frames or holds something.
- **Plaster.** Flat `P` above a picture rail, flat `p` below it, two or three
  blemish pixels on the rarer frames. A `Q` line directly under the cap.
- **Metal.** `m` top, `M` body, `5` underside, no highlight pixel.
- **Fabric.** The body colour with a lighter left edge and a darker bottom
  edge. No texture inside.
- **Glass.** `/` with two or three `(` pixels in the top left pane. The
  renderer paints the sky behind a window, so leave the pane translucent.
- **Leaves.** Blob of `V`, `v` on the upper left, `!` on the lower right, `k`
  edge broken by a `V` pixel here and there so it reads as foliage.
- **Screens.** `G` field with `g` blocks for content and a `5` bezel. Give
  the sprite a `light`.

## The staff body

Two kinds of Odd art live side by side.

**Hand-drawn Odds** (Marshall today) are `variant` lines on
`src/characters/staff.px` or `staff-b.px`, coloured by the roles below, with a
hand-drawn `portrait-<name>`. They stay as they are.

**Every new hire is generated** from parts in `looks/`, in colours of its own,
with a portrait Claude draws at hire time. `FORMAT.md` has the format. To add
to the library by hand:

1. Draw the part as it sits on the idle frame for each facing
   (`looks/bodies/trousers.px`, frames `idle-down-0`, `idle-up-0`,
   `idle-side-0`). The office moves it with the head or the torso in every
   other frame.
2. Use only the part's role keys: hair `n N i`, clothing `z Z +` (the shirt),
   `o O 0` (a second colour), `a A` (an accent), `^ & %` (the bottom). Outline
   in `k`, light from the upper left.
3. Run `npm run build -w @oddboro/sprites` and open `out/looks.png` (or
   `node scripts/looks-sheet.ts hair` for one kind). Check the part in the
   walk, sit and lift poses, not only standing.

Swatches in `looks/colours.json` are light, body and shade per colour, in the
house palette's style. A new swatch keeps the same three-step spread.

The roles on the hand-drawn bodies:

| Part     | Keys    |
| -------- | ------- |
| Hair     | `n` `N` |
| Skin     | `f` `F` |
| Shirt    | `z` `Z` |
| Trousers | `^` `&` |
| Shoes    | `3`     |

Marshall is `variant marshall n=M N=m z=5 Z=K ^=K &=k`: silver hair, a
charcoal jacket, dark trousers.

The seated pose at a desk (`sit-up`) puts the head two rows higher than
standing, so the head and shoulders show above the desk, and the elbows take
turns moving. The chair's `zbias 1` paints the backrest over the lower body.

- `staff-b.px` is the second body (ponytail, A-line skirt) with the same frame
  names and role keys.
- `X` is a glasses key and `x` a beard key, drawn in skin so they stay hidden
  until coloured. `[` is the hair tie, coloured by the accent in a generated
  look.
- Portraits (48 x 48) share one bust: the same background, eye rows, neck and
  shoulders. `looks/portraits/` holds two in the looks palette as examples
  for the portrait Claude draws.

## Adding a prop

1. Decide its footprint in tiles and draw it at 16 pixels per tile. Height
   is free. A thing that stands on the floor gets `origin 0 <height - 16>`
   for a one tile deep footprint.
2. Outline in `k`, light from the upper left, materials from the list above.
3. If it sits on another prop (a lamp on a desk, a plant on a shelf), make it
   `walkable` with `zbias 1` and push its `origin` down so the base lands on
   the surface. Place it on the same tile, after the thing it sits on.
4. If it hangs on a wall, make it `layer wall` and place it on either face
   cell. Wall props paint after every wall piece.
5. If Odds use it, add a `spot` with the activity from `FORMAT.md`. Say
   how it is used in its tags: `clear-<n>` if it needs floor open in front,
   `any-side` if it looks right against any wall, and draw a `frame side`
   if it may stand against a side wall.
6. If it emits light, add a `light`.
7. Where a recolour gives a free second item, add a `variant` instead of a
   second file. Wood tones and fabric colours are the usual ones.
8. Compile, open the preview, then place it in a room and render at 13 and 21. A prop is done when it reads at both hours and at 3x.

Rugs and mats are `layer floor` and `walkable`, with no spots. They paint over
the floor tiles, never block movement, and may lie in a doorway. Drawn art is
held to this too (`checkArt`): a drawn prop may be `layer floor`, and one that
is must be walkable.

## Walls and floors

Two wall styles exist, `wall-plaster` and `wall-teal`. Both carry `-face`,
`-window`, `-door` and `-cap` with all 16 masks. A new style needs all four.
Keep the baseboard at rows 28 to 31 of the face and the window sill at rows
21 to 23, so props and windows line up across styles.

Floors are 16 x 16 and seamless in every direction. Frame `0` is the quiet
one and lands on 70% of tiles; put the knots, ends and odd mint tiles on the
other frames. Check seams by rendering a room, never by looking at one tile.
