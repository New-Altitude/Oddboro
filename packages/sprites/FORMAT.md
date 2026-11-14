# The .px sprite format

Every piece of art in the office is a `.px` text file under `src/`. One
character is one pixel, and every colour comes from `src/palette.json`. The
compiler turns them into the atlas the office loads.

## Commands

```sh
npm run build -w @oddboro/sprites                     # compile all; previews in out/
node scripts/compile.ts --only desk                     # previews for names containing "desk"
npm run render -- main-street --crop 2 3 6 4 --scale 6  # a close-up, in tiles
npm run render -- main-street                           # render the Main Street floor plan, daytime
npm run render -- main-street --hour 21                 # the same at 9 PM, lamps on
npm run render -- room:break-room                       # one room template on its own
```

Previews land in `packages/sprites/out/` (4x, on a checkerboard) and
`packages/world/out/` (3x). Open the PNG to look at your work. Errors name the
file and line.

## The grid and the camera

- One tile is **16 x 16** pixels. Everything aligns to it.
- The camera looks down at roughly 3/4: you see the tops of things and their
  south-facing fronts. Back walls (the north side of a room) show a two-tile
  face. Side and south walls show only their top cap.
- Light comes from the upper left. Shade the right and bottom edges.

## The palette

`src/palette.json` maps single characters to colours:

```json
{ "name": "oddboro", "colors": { "k": { "hex": "#14121f", "name": "ink" } } }
```

- Keys are single characters from `A-Z a-z 0-9` and the symbols
  `! $ % & * + , - / : ; < = > ? @ ^ _ ~ | ( ) [ ] { }`. Never `.`, `#` or
  space.
- `.` in a pixel row is always transparent.
- A colour may carry alpha (`#00000060`) for shadows and glass.
- A colour marked `"emissive": true` gives off its own light. The night pass
  never darkens it. Use it only for screens, bulbs and glowing water. It
  names the key it shows when its prop is switched off: `"off": "K"`. The
  compiler draws every glowing sprite's frames again in those colours
  (`<frame>~off`). A sprite that needs more than that, like a fire going
  out, draws a frame named `off`, and gets no compiled ones.
- Extra colours can live in `src/palettes/<name>.json`, same shape, merged
  into the palette. A key defined twice is an error. Today: `breakroom.json`,
  `library-gym.json`, `lobby.json` and `staff.json`. A new key takes any
  character no file uses yet.
- Every sprite draws from the one palette. Do not add a colour for one sprite.
  Reuse what is there or add it to the palette for everyone.

## A file

```
# Comments start with #.
sprite desk-oak           # unique, lowercase-hyphenated
size 32 32                # width height, in pixels
layer object              # floor | wall | object | overlay | character (default object)
footprint 2 1             # tiles it covers on the floor grid (default: its width, 1 deep)
origin 0 16               # the pixel that sits on the footprint's top-left tile corner
walkable                  # Odds can walk over the footprint (rugs, chairs)
zbias 0                   # nudge paint order inside a row; + paints later (over)
fps 4                     # frames per second when its frames animate
tag desk work             # free-form labels the office can query
spot seat 0 1 up work sit # a place Odds go: name dx dy facing activity pose
light 24 6 48 #ffd9a0 0.9 # a glow: x y radius colour intensity, pixels from top-left
variant walnut o=w O=W    # palette swap: a whole recoloured copy, swapping o for w and O for W

frame default             # one or more frames; each is exactly <height> rows of <width> chars
................................
...
```

When the office furnishes a room it reads what a prop says about how it is
used:

- `tag clear-<n>` keeps n rows open in front of it: a shelf, a fridge, a TV.
  A spot that stands off the footprint, like the tile in front of an arcade,
  stays open too.
- `tag any-side` looks right against any wall: a plant, a lamp, a bin.
  Anything else stands with its front to the room. Against a side wall it
  shows a frame named `side` (facing right, mirrored on the east wall), and
  without one it never goes there.
- A spot's facing is the way its user looks. A seat facing `up` plays a pose
  seen from behind (`sit-up`), facing `down` one seen from the front, so a
  couch that watches a screen on the back wall is drawn from behind
  (`break-couch-back`).

### Footprint and origin

The footprint is where the thing stands. The origin says how the picture sits
over it. A 32 x 32 desk whose bottom 16 pixels are the part on the floor has
`footprint 2 1` and `origin 0 16`: the top 16 pixels rise above the tile it
stands on. The default origin puts the footprint at the bottom of the sprite.

Things paint back to front by the bottom edge of their footprint, so a
character standing south of a desk draws over it, and one standing north of it
draws behind it.

### Spots

A spot is a tile Odds walk to and an activity they do there. `dx dy` count
tiles from the footprint's top-left. Facing is the direction the person looks.
Pose is `sit`, `stand` or `lie`.

Activities the office understands:

| Activity   | Means                            | Where                              |
| ---------- | -------------------------------- | ---------------------------------- |
| `work`     | Working on a task                | desks                              |
| `intake`   | Pulling in new items             | the mail room                      |
| `read`     | Research, catching up on sources | the library                        |
| `wait`     | Waiting on the owner             | the bench outside the owner's door |
| `play`     | Idle                             | break room games                   |
| `rest`     | Idle                             | couches, beanbags                  |
| `eat`      | Scheduled downtime               | lunch tables                       |
| `exercise` | Maintenance and self-checks      | the gym                            |
| `talk`     | In a chat with the owner         | the owner's office                 |
| `meet`     | Working with colleagues          | meeting room tables                |

### Conventions the rooms rely on

- **Seats facing the viewer** (couch, bench, beanbag, a dining chair on the
  far side of a table) use `zbias -1`, so the person sitting on them paints
  over the seat. Seats facing away (an office chair) use `zbias 1`, so the
  chair back paints over the person.
- A seat spot (`sit`) never plays a standing pose: a `play` spot on a
  beanbag sits (`sit-up`), while the arcade's `stand` spot plays `play-up`.
  One rule picks the pose for the floor and the Send tab:
  `posesFor` in `apps/office/src/lib/staff/places.ts`.
- Odds enter and leave a spot from one tile only: the open side it faces
  (a couch faces into the room), or failing that the side behind it (a desk
  chair faces the desk). Seat tiles on solid furniture are never walked
  through. Face a spot the way its person looks and this works out.
- A spot's `dy` may be negative: a reader sits north of a table with
  `spot read 1 -1 down read sit`.
- Put a `light` on the pixels that emit it: the bulb, the shade's lit
  underside, the flame, the screen. One light per emitter, and every light
  needs emissive pixels under it. Draw decoration (book spines, sea prints,
  photos) in plain keys, never emissive ones, or it glows at night. A small
  emitter (an LED, a console) needs no light; its emissive pixels are enough.
- Light stops at the walls of the room or hall it shines in: the area under
  its centre, or under the prop's foot when the centre is over a wall. It
  lights the wall faces that look into that area, never the wall tops.
- A floor material draws its own shore when a sprite `fx-edge-<material>`
  exists, with frames `n`, `e`, `s`, `w` (that side meets something else)
  and `ne`, `nw`, `se`, `sw` (inner corners). Transparent except the edge.
  `n` and `s` paint first, then `e` and `w`.
- Frames named with bare numbers (`0`, `1`, `2`) are variety, not animation,
  on props as on floor tiles: compose picks one by position unless the
  placement names a frame.
- A wall prop (`layer wall`) may hang on either face cell. It paints after
  every wall piece.
- A wall prop placed over `D` cells stands in for the doorway. Tag it `door`
  and give it frames `open` and `closed`, and the office swings it open when an
  Odd walks through. Tag it `window` to paint the sky behind its glass.
  That works on back (north) walls only: a south wall face paints above the
  sky layer, so a street-front window paints its glass instead.
- A spot named `run`, `lift`, `stretch` or `cycle` with activity `exercise` plays the
  matching `exercise-<name>` animation.
- A spot with activity `home` is where Odds arrive in the morning and leave
  at night. Main Street's is on the lobby doormat.

### Frames and animation

- Frames that end in `-<number>` form an animation: `walk-down-0`, `walk-down-1`, and so on.
- The office plays them at the sprite's `fps`.
- Floor tiles and wall faces with several frames get one picked per tile. Frame `0` appears about 70% of the time. Use the other frames for scattered detail.

## Sprites the room builder asks for by name

A room names a wall style and a floor material. The builder then looks for these:

| Sprite             | Size                                | Frames                                                                                                       |
| ------------------ | ----------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `floor-<material>` | 16 x 16, `layer floor`              | `0`, `1`, ... seamless in every direction                                                                    |
| `<wall>-face`      | 16 x 32, `layer wall`               | `0`, `1`, ... the two-tile back wall face, baseboard at the bottom                                           |
| `<wall>-window`    | 16 x 32, `layer wall`, `tag window` | glass may be translucent: the sky paints behind it, by hour                                                  |
| `<wall>-door`      | 16 x 48, `layer wall`               | a doorway through the whole back wall, cap included. 16 x 32 for a style only used on a two-tile street face |
| `<wall>-cap`       | 16 x 16, `layer wall`               | `m0` to `m15`, the top of a wall seen from above                                                             |
| `fx-wall-shadow`   | 16 x 16, `layer floor`              | optional soft shadow on the floor row under a back wall                                                      |

**Cap masks.** The frame number is the sum of the directions where the next
cell is also a cap: north 1, east 2, south 4, west 8. Draw a lip or edge on
every side whose bit is off. `m10` (east and west) is a horizontal run, `m5`
(north and south) a vertical run, `m6` a top-left corner.

## Staff sprites

Odds share one base body, and each person is a palette swap of it.

- **Size:** 16 x 32, `layer character`, `footprint 1 1`, origin `0 16`.
- **Sitting:** the feet stay on the spot tile. Drop the body inside the frame.
- **Expressions:** a portrait for the baseball card is a separate sprite, `portrait-<name>`, 48 x 48.

| Animation                           | Frames | Notes                                                                       |
| ----------------------------------- | ------ | --------------------------------------------------------------------------- |
| `idle-down`, `idle-up`, `idle-side` | 2 to 4 | Breathing, a blink. `side` faces right, and the office mirrors it for left. |
| `walk-down`, `walk-up`, `walk-side` | 4      |                                                                             |
| `sit-up`                            | 2 to 4 | At a desk, seen from behind, typing                                         |
| `sit-down`                          | 3      | On a couch or chair, facing the viewer                                      |
| `read-down`                         | 3      | Seated, holding a book                                                      |
| `play-up`                           | 2 to 4 | Standing at an arcade or holding a controller                               |
| `eat-down`                          | 2 to 4 | Seated at a table                                                           |
| `exercise-<kind>`                   | 4      | `run`, `lift`, `stretch`, `cycle`                                           |

## Generated looks

Every new hire is built from parts, not drawn frame by frame. `looks/` holds
them, outside `src/`, with a palette of its own (`looks/palette.json`) whose
keys are roles: a look gives each role a colour. `src/look.ts` builds the 57
frames on the server.

| Path             | What it is                                                            |
| ---------------- | --------------------------------------------------------------------- |
| `bodies/*.px`    | The bald body, in trousers or a skirt, keyed by region                |
| `anchors.json`   | Per frame: the facing, and how far the head and torso moved           |
| `hair/*.px`      | Hairstyles, `tag hair`                                                |
| `tops/*.px`      | Tops, `tag top <rules>`                                               |
| `bottoms/*.px`   | Bottoms, `tag bottom <rules>`                                         |
| `faces/*.px`     | Face shapes, `tag face`; a look may leave the face out                |
| `colours.json`   | Swatches by name: light, body and shade (and deep, for skin)          |
| `portraits/*.px` | Two portraits in the looks palette, the examples for drawing new ones |

`scripts/derive-looks.ts` makes the bodies, the anchors and two hairstyles
(`short-crop`, `long-tied`) from `staff.px` and `staff-b.px`. Run it only
when those change: `npm run looks:derive -w @oddboro/sprites`.

### Regions on the bodies

| Keys    | Region                                                    |
| ------- | --------------------------------------------------------- |
| `h H q` | Skull, its light, and its outline: hair paints over these |
| `z Z`   | Torso                                                     |
| `u U`   | Upper sleeve                                              |
| `l L`   | Lower sleeve, the half nearest the hand                   |
| `^ &`   | Upper leg, or the skirt                                   |
| `j J`   | Lower leg                                                 |
| `3 W`   | Shoes                                                     |

### A part

A part is `size 16 32`, `layer character`, and frames `down`, `up` and
`side`, each drawn where it sits on that facing's idle frame. `.` keeps what
is under it. The first tag is the kind; the rest are rules.

- Hair draws in `n N i k K [`. It paints over the skull and empty space, the
  back of the head, the head's outer edge, and clothes below the shoulders.
  Never the face or a hand.
- Clothing draws in `z Z +` (shirt), `o O 0` (second colour), `a A` (accent),
  `^ & %` (bottom), `k K`, `f F E`, `-`. It paints over clothing, the neck
  and empty space beside the body.
- A face draws in `k f F E G x b c p P = ! i`, from the head down to the
  chin, under the hair: it reshapes the jaw and adds lips, blush or brows.
  It keeps `x` wherever a beard grows. Without a face the body's own shows.
  Without a beard, `x` and `b` are plain skin.
- Top rules: `sleeves-short`, `sleeves-none`, `torso-second` and
  `sleeves-second` (a jacket: those regions take the second colour, and `z`
  in the part draws the shirt under it), `bottom-top` (a dress), and
  `bottom-second` (overalls).
- Bottom rules: `body-skirt`, `legs-shorts`.

Hairstyles and clothing Claude draws at hire time go in the database
(`parts`), not here. The library is both.

## Drawn art

When an owner's office wants something the library lacks, the office draws
it while it designs the office: Claude writes the `.px` in the house palette,
and `src/art.ts` checks it. Drawn art lives in the database (`art`), not here,
and joins the catalog tagged `drawn`.

| Kind        | Sprites                                           | Rules                                                                                                                                                        |
| ----------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `prop`      | `<name>`                                          | layer object, up to 64 x 64 and 4 x 3 tiles. Spots: rest, play, eat or read, sitting or standing                                                             |
| `wall-prop` | `<name>`                                          | layer wall, 1 to 3 tiles wide, 1 deep, no spots                                                                                                              |
| `desk-prop` | `<name>`                                          | stands on a desk like `desk-lamp`: 16 wide, up to 24 tall, footprint 1 1, walkable                                                                           |
| `floor`     | `floor-<name>`                                    | 16 x 16, frames `0`, `1`, ...                                                                                                                                |
| `wall`      | `wall-<name>-face`, optional `wall-<name>-window` | 16 x 32 each. A `# ramp: <light> <body> <shade> <deep>` line names four keys; the cap, the door and any window not drawn are the plaster ones in those tones |

A row up to three pixels too wide or narrow is mended, not refused: its
longest run of one colour grows or shrinks.
