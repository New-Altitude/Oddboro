# packages/world

How spaces are built. A room template (`rooms/*.json`) is a reusable stamp: a
character map of walls, windows, doors and floors, plus the props placed in
it. A floor plan (`plans/*.json`) places stamps to make one office, and its
`halls` carve corridors that join rooms through their entrance gaps.
`composeWorld` turns a plan into cells, a draw list in paint order, spots,
lights and a walkable grid. Each placed prop has an id, `room/sprite#i`, on its
draws, lights and spots (`obj`), so a switch can name it and find all three.

Where a new kind of thing starts, the shared function for each job, and the
check that catches a missed place: `docs/architecture.md`.

A plan's `grounds` puts land around the building. `margin` pads the plan on
each side, then a grounds template in world coordinates (`rooms/grounds-main-street.json`)
fills every cell nothing else claimed: grass, the river, the footpath and the
street's ends. Grounds are scenery, never walkable, and a grounds prop must
stand wholly on grounds or compose throws. A floor material with an
`fx-edge-<material>` sprite draws its own shore against anything else, so the
river's banks fit themselves.

Light stays in the area it shines in: the room or hall a prop stands in, or
for a wall prop the first open floor below its light. It lights back walls
facing into that area and never wall tops, south walls, or the floor row a
south wall hides. Grounds lights are open air and unclipped, so keep grounds
lamps a few tiles off the building. Lights in an outdoor room (the street)
stop only at its top edge, the building front, and spill past its sides and
bottom onto the grounds.

`generate.ts` furnishes a room from what each prop says about itself (its
`clear-<n>` and `any-side` tags, a `side` frame, its spots; see the sprites
`FORMAT.md`): nothing solid stands where a shelf, a screen or a spot needs the
floor open, a prop on a side wall turns to face the room or goes elsewhere,
and a couch faces the TV it is for. A tall thing's art rises over the tiles
behind it, so no two standing things go where one would mostly hide the other
(more than half the smaller covered): a lamp may stand in front of a
fireplace, never in front of the cat. Only a back row room has windows, since
its back wall is the building's; a front row room's back wall is inside. The
hall rows under a row of rooms take only things two tiles tall, since a south
wall's face covers them. Rooms furnish without chance; the street and grounds
take a seed of their own, so changing a room never moves a tree.

Every prop a room is furnished with has an id, `sprite#n`, and things placed
together (a desk, its chair and lamp; the TV and its couch) share a `group`,
the first one's id. A room spec's `edits` change what the office furnished, in
order: remove an item, move one to a tile, add an extra at a tile. Moving or
removing the first of a group takes the group. An add or a move lands on the
tile it names, or the nearest one within three that fits (`nearby`); one that
fits nowhere near is left out, and the build notes say so. An edit marked
`hand` was the owner's own, from the office's arranging by hand, which it no
longer offers; a layout saved then still carries its own. It goes exactly where the owner
put it: only what keeps the office working is checked (on the room's
floor, off the doorway unless it lies flat like a rug or a mat, off other things, every seat reachable), and the note
says which one it broke. What moves with a dragged thing is what stands on it,
at its seats, or as a chair facing it (on the tile above it); the rest of its
group stays, a chair beside it included. A rug moves alone. The halls, the street and the grounds take
edits too, in the spec's `areas`, each in its own tiles from its top-left (the
halls in the building's). Their things get ids the same way, and an edit there
lands on the exact tile or not at all: a standing thing goes on the area's own
floor (the hall floor, the sidewalk, open ground), off the way in unless it lies flat and off other
things, and a hall's wall things go along the front wall. Where a piece goes is scored: a tile of room from other furniture, and for
a recipe's `center` piece (the kitchen table, the lobby couch, the library's
armchairs) the middle of the room; candidate order decides the rest.

A theme swaps the library's pieces for its own everywhere, rooms, halls and
street: `swaps` maps a library sprite to a stand-in drawn over it, which must
match it in layer, footprint, walkability and spots (`swapProblems`), so Odds
use a scribe's desk exactly as a desk. A swap to `""` leaves a piece out, for
one with no place in the theme, except anything Odds use (a spot) or a door,
which needs a stand-in. A piece left out is taken out of its room before
the room's edits run, so it never holds a tile nobody can see. `libraryPieces()` lists what the office places in each
room kind, the halls, the street and the grounds, so a theme can name what to
swap. The outside takes a theme too: `facade` is the wall style the building
shows the street (brick unless a spec says), and a swap of a floor material
(the sidewalk, curb, asphalt, grass) changes the ground in rooms, halls,
street and grounds alike. A themed office keeps its own floor in every
room, not a kind's own (the kitchen's tile). `windows: false` leaves out every
window, for a place underground.

Lamps in a room template with `"outdoor": true` (the street) and on the grounds
glow at `OUTDOOR_GLOW` (70%), and every other lamp is indoors and glows at
`INDOOR_GLOW` (half), both in `src/light.ts`, glow and bloom alike, in the
office and the renderer. Outdoors only a building front cuts the light off;
on an empty lot it spills onto the grass.

A room template with `"sign": false` (the street, the front door) is a place
but not a room, so the office shows no name over it. The owner renames the other
rooms from the floor, and the office keeps those names in its database: a
template's `name` and a plan's `label` are only the starting names.

`lotOf(plan, templates)` gives the site before the building goes up: the
plan's street and grounds, with plain grass on exactly the tiles the building
takes, and none of what comes with the office: the shop fronts, door lamps,
coffee cart and bike rack. A new
owner's first visit opens on it.

Placing by hand (room edits) may stand a thing on a rug or a mat, and put a rug
under standing things; only a rug on a rug is refused. The furnisher still keeps
them apart, so a refurnish lays out the same as before.

An owner's own office comes from `src/generate.ts`. Claude writes an
`OfficeSpec` (rooms by kind, size, desks and what stands on each desk,
walls, floors, accent, extras, grounds, and an optional porch outside the
front door) and `generateOffice` builds the plan, the room templates, the street
and the grounds, then checks the world. The layout is always one shape: a back
row of rooms over the main hall, a front row between two side halls, the front
hall with the front door under the lobby, then the street. Rooms are
furnished from recipes per kind, and a piece is placed only if every seat in
the room can still be reached the way the office walks, never through the seat
itself. The limits (`LIMITS`) are code, not prompt: 12 rooms, one office, one
lobby, 1 to 4 workspaces, 2 of any other kind, 32 desks, 110 tiles wide. A
building too wide steps its rooms down a size before it counts as a problem.
Art the office drew for itself is part of the catalog, tagged `drawn`:
`drawnIn(catalog)` finds its walls, floors, extras and desk pieces, so they
count as choices like the built-in lists, and a drawn prop's `place-<where>`
tag says where the furnisher puts it. `scripts/render.ts spec:<file> --art
<file>` renders a spec with drawn art.
`checkWorld` refuses missing art, no bus stop, no owner's desk, no bench, an
unreachable seat, or fewer work seats than Odds. Everything is seeded from the
spec, so a preview and the office it becomes match tile for tile.

To add a kind of room, start at `ROOM_KINDS` in `src/generate.ts`. The type
checker then names `KIND_ABOUT` and `ROOM_ID`. Nothing names its furnishing:
add its case to `recipe()`'s switch, or the kind gets no furniture of its own.
The room an Odd names in a hire proposal (`room` in `hireFields`,
`packages/ledger/src/mcp.ts`) lists Main Street's rooms by hand.

| File                | What it does                                               |
| ------------------- | ---------------------------------------------------------- |
| `src/types.ts`      | Every shape: templates, plans, cells, draw commands, spots |
| `src/compose.ts`    | Plan to world, with walls fitted to their neighbours       |
| `src/generate.ts`   | A spec to a plan and rooms, with the limits, and checks    |
| `src/path.ts`       | A* over the walkable grid                                  |
| `src/render.ts`     | Paints a world from its sprites, Node only (`./render`)    |
| `src/light.ts`      | Ambient light and sky colour by hour                       |
| `src/load.ts`       | Reads rooms and plans from disk (server only)              |
| `scripts/render.ts` | Renders a plan, room or `spec:<file>` to `out/`            |

Everything except `load.ts` and the renderer is browser-safe.
