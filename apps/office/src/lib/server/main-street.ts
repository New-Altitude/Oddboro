// Start the designer from the installed floor, including the owner's room names.
import { loadSpaces, SAMPLE } from '@oddboro/world/load';
import {
  checkSpec,
  checkWorld,
  editStamp,
  composeWorld,
  generateOffice,
  LIMITS,
  ROOM_KINDS,
  type OfficeSpec,
  type RoomKind,
  type RoomSpec,
  type SpriteCatalog
} from '@oddboro/world';

function kindOf(id: string): RoomKind | undefined {
  if (id === 'owner-office') return 'office';
  return ROOM_KINDS.find((kind) => id === kind || id.startsWith(kind + '-'));
}

export function mainStreetSpec(names: Record<string, string> = {}): OfficeSpec {
  const { plans, rooms } = loadSpaces();
  const plan = plans[SAMPLE];
  return {
    name: 'My Main Street',
    mainStreet: true,
    wall: 'plaster',
    floor: 'oak',
    grounds: 'park',
    rooms: plan.rooms.flatMap(({ room, label }, index) => {
      const kind = kindOf(room);
      if (!kind) return [];
      const stamp = rooms[room];
      return [
        {
          starterRoom: room,
          kind,
          name: names[room] ?? names[room + '#' + index] ?? label ?? stamp.name,
          floor: stamp.floor,
          wall: stamp.wall.replace(/^wall-/, ''),
          ...(kind === 'workspace'
            ? { seats: stamp.props.filter((p) => p.sprite === 'desk').length }
            : {})
        }
      ];
    })
  };
}

/** Keep the original stamps and hall for a recolor, rename, or added room.
 * Resizing or refurnishing the building uses the regular designer and its preview. */
export function buildMainStreet(
  spec: OfficeSpec,
  catalog: SpriteCatalog,
  staff: number
): ReturnType<typeof generateOffice> {
  const problems = checkSpec(spec, catalog);
  if (problems.length) return generateOffice(spec, catalog, staff);
  const baseline = mainStreetSpec();
  const original = new Map(spec.rooms?.map((room) => [room.starterRoom, room]));
  const sameShape = (base: RoomSpec, room?: RoomSpec) =>
    room &&
    base.kind === room.kind &&
    base.seats === room.seats &&
    !room.size &&
    !room.desk &&
    !room.side &&
    !room.row &&
    !room.accent &&
    !room.extras?.length;
  const redraw = () => {
    const built = generateOffice(spec, catalog, staff);
    built.notes.unshift(
      'This change redraws the floor plan. Check the room positions in the preview.'
    );
    return built;
  };
  if (
    spec.rooms.filter((r) => r.starterRoom).length !== baseline.rooms.length ||
    spec.grounds !== baseline.grounds ||
    spec.plants ||
    spec.porch ||
    spec.facade ||
    spec.swaps ||
    spec.areas ||
    spec.windows === false ||
    !baseline.rooms.every((room) => sameShape(room, original.get(room.starterRoom)))
  )
    return redraw();

  const { plans, rooms: templates } = loadSpaces();
  const plan = plans[SAMPLE];
  plan.name = spec.name;
  const notes: string[] = [];
  const kinds: Record<string, RoomKind> = {};
  for (const placed of plan.rooms) {
    const room = original.get(placed.room);
    if (!room) continue;
    const stamp = templates[placed.room];
    placed.label = stamp.name = room.name;
    stamp.floor = room.floor ?? spec.floor;
    stamp.wall = 'wall-' + (room.wall ?? spec.wall);
    editStamp(stamp, room.edits ?? [], catalog, notes);
    kinds[placed.room] = room.kind;
  }
  const hall = plan.halls![0];
  for (const h of plan.halls!) {
    if (spec.floor !== baseline.floor) h.floor = spec.floor;
    if (spec.wall !== baseline.wall) h.wall = 'wall-' + spec.wall;
  }
  const additions = spec.rooms.filter((room) => !room.starterRoom);
  if (additions.length) {
    // The normal room builder places and checks the furniture for each addition.
    const built = generateOffice(spec, catalog, staff);
    if (built.problems.length) return built;
    for (const [i, room] of additions.entries()) {
      const matches = Object.values(built.templates).filter(
        (t) => t.name === room.name && built.kinds[t.id] === room.kind
      );
      if (matches.length !== 1 || room.row || room.side) return redraw();
      const [stamp] = matches;
      const id = 'addition-' + (i + 1);
      const x = hall.at[0] + hall.size[0] - 1;
      const y = hall.at[1] + 1 - stamp.map.length;
      if (y < 0 || x + stamp.map[0].length > LIMITS.width) return redraw();
      templates[id] = { ...stamp, id };
      kinds[id] = room.kind;
      plan.rooms.push({ room: id, at: [x, y] });
      const w = stamp.map[0].length;
      const grounds = plan.grounds!;
      const land = templates[grounds.room];
      const [west, north] = grounds.margin;
      // Clear only the landscaping taken by the new room and its hall.
      land.props = land.props.filter((p) => {
        const [pw, ph] = catalog[p.sprite]?.footprint ?? [1, 1];
        return (
          p.at[0] + pw <= west + x ||
          p.at[0] >= west + x + w ||
          p.at[1] + ph <= north + y ||
          p.at[1] >= north + hall.at[1] + hall.size[1]
        );
      });
      hall.size[0] += w - 1;
      land.map = land.map.map((row) => row.padEnd(row.length + w - 1, '.'));
    }
  }
  const world = composeWorld(plan, templates, catalog, { actors: false });
  return { plan, templates, kinds, world, notes, problems: checkWorld(world, staff) };
}
