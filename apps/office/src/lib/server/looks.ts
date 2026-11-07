// Drawing a person. Claude reads the owner's description, picks a body from the
// parts library and colours from the swatches, draws a 48 x 48 portrait in
// the same colours, and draws a new hairstyle or piece of clothing when no
// part fits. The office checks every piece and renders the preview. It runs
// as the office, so nobody needs to be on staff yet. A headshot, when the
// owner gives one, goes to that run only: neither it nor Claude's read of the
// face is ever written anywhere.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  checkPart,
  checkSpec,
  loadLibrary,
  lookFrame,
  LOOKS_ROOT,
  parsePortrait,
  partsPortrait,
  PART_KEYS,
  PART_KINDS,
  portraitImage,
  RULES,
  renderLook,
  renderPortrait,
  type DrawnPart,
  type Library,
  type LookSpec,
  type PartKind
} from '@oddboro/sprites/look';
import { createImage, drawImage, encodePng, scaleImage } from '@oddboro/sprites/png';
import { drawnParts, lookCatalogue, lookTaken, home } from '@oddboro/ledger';
import { runAsOffice } from './office-run.ts';
import { lookVersion } from '../staff/roster.ts';
import { cannotDrawLook, officeDrawsLooks, usesMagpie } from './claude.ts';

export type Drawn = { look: LookSpec; portraitPx: string; newParts: DrawnPart[] };
export type Preview = Drawn & {
  /** The 57-frame strip, as a data URL, and where each frame starts in it. */
  sheet: string;
  frames: Record<string, number>;
  portrait: string;
};

/** The parts library: the repo's parts, every part drawn before, and any extra. */
export async function library(extra: DrawnPart[] = []): Promise<Library> {
  return loadLibrary([...(await drawnParts()), ...extra]);
}

const read = (path: string) => readFileSync(join(LOOKS_ROOT, path), 'utf8');
const frameOf = (px: string, name: string) => {
  const lines = px.split('\n');
  const at = lines.indexOf(`frame ${name}`);
  return lines.slice(at, at + 33).join('\n');
};
const about = (px: string) => /^# (.+)$/m.exec(px)?.[1] ?? '';

function brief(lib: Library): string {
  const catalog = PART_KINDS.map((kind) => {
    const list = [...lib.parts.values()]
      .filter((p) => p.kind === kind)
      .map((p) => `- ${p.name}: ${about(p.px)}${p.rules.length ? ` (${p.rules.join(', ')})` : ''}`);
    return `### ${kind}\n${list.join('\n')}`;
  }).join('\n\n');
  // Each swatch with its hex values, light to shade, so a colour can be
  // matched to a photo by how light or dark it is, not by its name.
  const colours = (Object.keys(lib.colours) as (keyof Library['colours'])[])
    .map(
      (g) =>
        `- ${g}: ${lib.colours[g].map((s) => `${s.name} (${s.light} ${s.body} ${s.shade})`).join(', ')}`
    )
    .join('\n');
  const keys = Object.entries(lib.palette.colors)
    .map(([k, c]) => `- \`${k}\` ${c.name}`)
    .join('\n');
  const body = read('bodies/trousers.px');
  const rules = PART_KINDS.map(
    (kind) =>
      `- ${kind}: draws with \`${PART_KEYS[kind].replace(' ', '')}\` and \`.\`. Rules: ${
        Object.entries(RULES[kind])
          .map(([r, what]) => `\`${r}\` (${what})`)
          .join(', ') || 'none'
      }`
  ).join('\n');
  return `## The parts library

${catalog}

## Colours (by name, with each one's light, body and shade hex)

${colours}

## Palette keys (one character per pixel; \`.\` is clear)

${keys}

## The body every part sits on

The 16 x 32 body, bald, facing down, up and side (side faces right). Keys
name regions: h H skull, q skull outline, z Z torso, u U upper sleeve, l L
lower sleeve, ^ & upper leg, j J lower leg, 3 W shoes, f F skin.

\`\`\`
${frameOf(body, 'idle-down-0')}

${frameOf(body, 'idle-up-0')}

${frameOf(body, 'idle-side-0')}
\`\`\`

## Drawing a new part

Only when nothing in the library fits the description. A part is a .px file:

\`\`\`
# One line saying what it is.
sprite <kind>-<name>
size 16 32
layer character
tag <kind> <rules...>

frame down
<32 rows of 16>

frame up
<32 rows of 16>

frame side
<32 rows of 16>
\`\`\`

- Draw each frame exactly where it sits on the idle frame above for that
  facing. The office moves it with the head or torso in all 57 frames.
- \`.\` keeps what is under it. Hair paints over the skull and empty space,
  and over clothes below the shoulders; it never covers the face or hands.
  Clothing paints over clothing, the neck and empty space beside the body.
- Outline with \`k\`. Light comes from the upper left: the light key there,
  the shade key on the right and bottom.
- Keys and rules per kind:
${rules}
- Name it with lowercase words and hyphens, not a name already in the library.

Two parts from the library, as examples:

\`\`\`
${read('hair/bun.px').trim()}
\`\`\`

\`\`\`
${read('tops/blazer.px').trim()}
\`\`\`

## The portrait

A 48 x 48 bust for the Odd's card, in the same palette keys, so it takes
the look's colours. Keep the background, the eye rows, the neck and the
shoulders where the examples have them. Draw the hair in \`N n i\`, skin in
\`E f F G\`, the top in \`+ z Z\` (and \`0 o O\`, \`a A\` if the top has a second
colour or an accent), eyes in \`k = !\`, lips in \`p\` with \`P\` for the line
between them and the corners. If the look has glasses, draw the
frames in \`X\`; if it has a beard, draw it in \`x\` with \`b\` for its lighter
strands. Make the face match the description: the hairstyle, the expression,
any detail {owner} named.

- The beard takes its real shape: stubble, a moustache, a goatee, a chin
  beard or a full beard. Leave skin wherever it does not grow. When its
  colour differs from the hair, give it its own \`beard\` colour; a
  moustache in the hair's colour can be drawn in \`n i\` above it.
- Glasses keep their weight: thin or wire frames are one pixel wide, thick
  frames two. Wire frames take the \`metal\` or \`gold\` glasses colour.
- Lips are \`p\` and \`P\`, never \`k\`: ink makes a mouth look like a hole.
  A wide smile shows a row of \`=\` teeth between a thin \`p\` top lip and a
  fuller \`p\` bottom lip, with the corners turned up and the cheeks lifted.
  A closed smile is a short \`P\` curve, corners up, with \`p\` under it.
  Smiling eyes narrow from below; they are not flat lines.
- Blush is \`c\`: two or three pixels on each cheek, below the outer corner
  of the eye, when the cheeks are rosy or the smile is wide.
- Brows are one pixel thick unless they are heavy in life.
- Keep the face its own shape: round, oval, long or square. The jaw makes the
  shape. A round or soft face keeps nearly its full width down to the mouth
  row and turns in over the last two or three rows to a wide, rounded chin. An
  oval narrows steadily from the cheeks. A pointed chin ends 4 to 6 pixels wide.
- The hairline keeps its shape in the portrait as well as the sprite: low,
  straight, a widow's peak, high, receding, thinning or bald. A high,
  receding or bald head shows more forehead, and the forehead rule below
  does not apply to it.
- On this grid the brows sit on row 17 or 18. Bare forehead from hairline to
  brows is 4 to 6 rows; more only for a high, receding or bald hairline. A fringe or
  side-swept hair covers the forehead and comes down to a row or two above the
  brows on the side it sweeps toward.

\`\`\`
${read('portraits/example-ada.px').trim()}
\`\`\`

\`\`\`
${read('portraits/example-theo.px').trim()}
\`\`\`
`;
}

const ANSWER = `## Your reply

Fenced blocks, nothing else:

1. One \`\`\`json block: the look.
   {"face": "<name, or leave out for the plain face>", "hair": "<name>", "top": "<name>", "bottom": "<name>", "colours": {"hair": "<hair>", "skin": "<skin>", "top": "<cloth>", "second": "<cloth, optional>", "accent": "<cloth, optional>", "bottom": "<cloth>", "shoes": "<shoes>", "beard": "<hair colour, only when the beard differs from the hair>"}, "glasses": "<glasses colour, or leave out>", "beard": false}
2. One \`\`\`px block: the portrait, \`sprite portrait-<first name, lowercase>\`, \`size 48 48\`, \`layer overlay\`, one \`frame default\`.
3. A \`\`\`px block for each new part, only if you drew one. The look names it.`;

/**
 * Square up hand-typed pixel rows: a row a pixel or two off is cut or padded
 * from its own last pixel, and a frame a row short repeats its last row.
 * Anything further off is left for the checks to name.
 */
export function squareUp(px: string): string {
  const size = /^size (\d+) (\d+)$/m.exec(px);
  if (!size) return px;
  const [w, h] = [Number(size[1]), Number(size[2])];
  const lines = px.split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    out.push(lines[i]);
    if (!/^frame \S+$/.test(lines[i].trim())) continue;
    const rows: string[] = [];
    while (
      i + 1 < lines.length &&
      /^\S+$/.test(lines[i + 1]) &&
      !/^(frame|sprite|size|tag|layer)\b/.test(lines[i + 1])
    )
      rows.push(lines[++i]);
    if (
      !rows.length ||
      rows.some((r) => Math.abs(r.length - w) > 2) ||
      Math.abs(rows.length - h) > 2
    ) {
      out.push(...rows);
      continue;
    }
    const fixed = rows
      .slice(0, h)
      .map((r) => (r.length >= w ? r.slice(0, w) : r + r.at(-1)!.repeat(w - r.length)));
    while (fixed.length < h) fixed.push(fixed.at(-1)!);
    out.push(...fixed);
  }
  return out.join('\n');
}

/** Pull the look, the portrait and any new parts out of a reply. */
export function parseReply(text: string): { drawn?: Drawn; problems: string[] } {
  const blocks = [...text.matchAll(/```(json|px)\s*\n([\s\S]*?)```/g)];
  const json = blocks.find((b) => b[1] === 'json');
  const pxs = blocks.filter((b) => b[1] === 'px').map((b) => squareUp(b[2]));
  const problems: string[] = [];
  let look: LookSpec | undefined;
  try {
    look = json ? (JSON.parse(json[2]) as LookSpec) : undefined;
  } catch (e) {
    problems.push(`the json block does not parse: ${e instanceof Error ? e.message : e}`);
  }
  if (!json) problems.push('there is no json block with the look');
  const portraitPx = pxs.find((p) => /^sprite portrait-/m.test(p));
  if (!portraitPx) problems.push('there is no px block with sprite portrait-<name>');
  const newParts: DrawnPart[] = [];
  for (const px of pxs) {
    const m = /^sprite (hair|top|bottom)-([a-z0-9-]+)$/m.exec(px);
    if (m) newParts.push({ kind: m[1] as PartKind, name: m[2], px });
  }
  if (!look || !portraitPx) return { problems };
  return { drawn: { look, portraitPx, newParts }, problems };
}

/**
 * Everything wrong with a drawn look, in words: unknown parts or colours, a
 * part that does not compose, a portrait that does not parse, or a look
 * another staffer already has. Empty when it is good.
 */
export async function problemsWith(d: Drawn, staffId?: string): Promise<string[]> {
  const problems: string[] = [];
  const base = await library();
  const fresh: DrawnPart[] = [];
  for (const p of d.newParts) {
    if (base.parts.has(`${p.kind}:${p.name}`)) {
      problems.push(
        `a ${p.kind} named "${p.name}" is already in the library: use it or pick a new name`
      );
      continue;
    }
    try {
      checkPart(base, p);
      fresh.push(p);
    } catch (e) {
      problems.push(`the new ${p.kind} "${p.name}": ${e instanceof Error ? e.message : e}`);
    }
  }
  const lib = await library(fresh);
  problems.push(...checkSpec(lib, d.look));
  try {
    parsePortrait(lib, d.portraitPx);
  } catch (e) {
    problems.push(`the portrait: ${e instanceof Error ? e.message : e}`);
  }
  if (!problems.length) {
    const twin = await lookTaken(d.look, staffId);
    if (twin)
      problems.push(`${twin.name} already looks exactly like that: change at least two things`);
  }
  return problems;
}

/** Render a checked look for the hire window or the card. */
export async function preview(d: Drawn): Promise<Preview> {
  const lib = await library(d.newParts);
  const sheet = renderLook(lib, d.look);
  const portrait = renderPortrait(lib, d.look, d.portraitPx);
  const url = (png: Uint8Array) => `data:image/png;base64,${Buffer.from(png).toString('base64')}`;
  return { ...d, sheet: url(sheet.png), frames: sheet.frames, portrait: url(portrait) };
}

/**
 * A look built from library parts as the owner picks them, with a portrait
 * made from the same parts (`partsPortrait`): rendered at once on any tool,
 * since nothing is drawn. `problems` says when another staffer already looks
 * like this. Throws on a part or colour the library does not have.
 */
export async function buildLook(
  look: LookSpec,
  staffId?: string
): Promise<Preview & { problems: string[] }> {
  const lib = await library();
  const bad = checkSpec(lib, look);
  if (bad.length) throw new Error(bad.join('; '));
  const d: Drawn = { look, portraitPx: partsPortrait(lib, look), newParts: [] };
  return { ...(await preview(d)), problems: await problemsWith(d, staffId) };
}

const PHOTO = `
The image above is a headshot of who {owner} wants this Odd to be. Draw that person, as a likeness. Where {owner}'s words and the photo differ, follow the words.

Read the photo before you draw. Start your reply with a \`\`\`read block, one line for each:

- Hair colour: compare its darkness with the hair hex values. Dark hair in a photo is darker than it looks: near-black is \`black\`, not a brown. Near-white or bleached hair is \`white\`; \`platinum\` is a pale yellow blond.
- Hair: length, texture (straight, wavy, curly, coily, locs, braids, spiky, layered), volume, which side it parts on, any covering (a headscarf, a cap), and the hairline (low, straight, a widow's peak, high, receding, thinning, bald).
- Facial hair: none, stubble, moustache, goatee, chin beard or full, and its colour, with any part a different colour from the hair.
- Glasses: none, or the frame weight (thin, wire or thick), colour and shape.
- Skin: the closest skin swatch by its hex values, and whether the cheeks are rosy.
- Eyes and brows: eye shape and size, brow thickness.
- Face: width at the cheekbones over height from hairline to chin, as a ratio (about 0.75 is round or wide, about 0.6 is long). The jaw (soft and rounded, square, or pointed) and its width at the mouth against the cheeks, how full the cheeks are, the chin and how wide it is.
- Forehead and the sides: how much forehead shows between the hairline (or the fringe's lowest edge) and the brows, against the eye-to-chin length, and how much hair covers the sides of the face.
- Age cues: smile lines, how youthful the face reads. Do not age anyone up.
- Plan: the face in portrait pixels, from the lines above. Eyes stay on the examples' rows. Give the face's first and last column at the cheeks, at the mouth row and at the chin, the chin row, the mouth row, and the row where hair or fringe meets the forehead on each side, so width over height matches the ratio and the forehead shows no more than the photo does.
- Expression: neutral, a closed smile, or a smile showing teeth.
- Top: the garment, its colours, the collar or neckline, any pattern.

Then build the look from that read, and draw the portrait's face outline from the plan. The example portraits show two faces, not the shape to copy: a long-haired person can have a round face. A library hair that is close but wrong on length, part or hairline is wrong: draw a new hair part instead, like a close crop, a high top, a receding short cut, or long layers parted to one side. The same goes for a top whose collar or neckline does not match.`;

const SYSTEM = `You draw the Odds of Oddboro, a pixel-art office where
AI workers, called Odds, work for {owner}. Each Odd is a 16 x 32 sprite built
from parts, plus a 48 x 48 portrait you draw by hand in .px text: one
character per pixel, every row exactly as wide as the size says. Match the
house style of the examples: chunky, readable, outlined, lit from the upper
left. No two Odds may look the same.`;

const FIX = `## Look and fix

The first image is the headshot. The second shows what your reply below drew, 8 times larger: the portrait on the left, then the walking sprite facing down and facing the side.

Compare them with the photo one feature at a time: hair colour and darkness; hair shape, length, part and hairline; facial hair shape and colour; skin; face shape, jaw and forehead; eyes and brows; expression and lips; glasses; the top and its collar. Start with a \`\`\`check block, one line per feature: what differs, or "matches". Then reply again in full, in the same blocks, with every difference fixed. Change only what differs, and include every new part's px block again, changed or not. If everything matches, repeat your blocks unchanged.`;

/** The portrait and the sprite facing down and side, side by side at 8x, as base64 PNG. */
async function drawingImage(d: Drawn): Promise<string> {
  const lib = await library(d.newParts);
  const img = createImage(98, 48);
  for (let i = 0; i < img.data.length; i += 4) img.data.set([58, 63, 85, 255], i);
  drawImage(img, portraitImage(lib, d.look, d.portraitPx), 0, 0);
  drawImage(img, lookFrame(lib, d.look, 'idle-down-0'), 56, 8);
  drawImage(img, lookFrame(lib, d.look, 'idle-side-0'), 78, 8);
  return Buffer.from(encodePng(scaleImage(img, 8))).toString('base64');
}

/**
 * Show Claude its drawing beside the photo and let it fix what differs. A fix
 * that does not pass the checks is dropped, and the first drawing stands.
 */
async function lookAndFix(
  ask: string,
  reply: string,
  drawn: Drawn,
  req: {
    name: string;
    staffId?: string;
    photo: { mediaType: string; data: string };
    model?: string;
    signal?: AbortSignal;
  }
): Promise<Drawn> {
  const r = await runAsOffice(`${ask}\n\n${FIX}\n\n## Your reply\n\n${reply}`, {
    system: SYSTEM,
    kind: 'look',
    timeoutMs: 10 * 60_000,
    signal: req.signal,
    effort: 'medium',
    ...(req.model ? { model: req.model } : {}),
    images: [req.photo, { mediaType: 'image/png', data: await drawingImage(drawn) }]
  });
  if (!r.ok) {
    console.error(`[looks] fix for ${req.name}: ${r.text}`);
    return drawn;
  }
  const parsed = parseReply(r.text);
  const problems = parsed.drawn
    ? [...parsed.problems, ...(await problemsWith(parsed.drawn, req.staffId))]
    : parsed.problems;
  if (parsed.drawn && !problems.length) return parsed.drawn;
  console.error(`[looks] fix for ${req.name} dropped: ${problems.join('; ')}`);
  return drawn;
}

export async function drawLook(req: {
  description: string;
  name: string;
  role: string;
  staffId?: string;
  note?: string;
  previous?: Drawn;
  /** A headshot to draw them from. */
  photo?: { mediaType: string; data: string };
  /** A model to draw with other than the default, to compare them. */
  model?: string;
  /** Stops the drawing: the owner left it for parts, or closed the page. */
  signal?: AbortSignal;
}): Promise<Preview> {
  if (usesMagpie() || (!req.model && !officeDrawsLooks())) throw new Error(cannotDrawLook());
  const lib = await library();
  const others = await lookCatalogue(req.staffId);
  const ask = [
    `# Draw ${req.name || 'a new Odd'}, ${req.role || 'a new hire'}`,
    '',
    `What {owner} says they look like: ${req.description || (req.photo ? 'nothing more than the photo' : 'nothing yet: pick something distinct')}`,
    req.photo && PHOTO,
    req.previous &&
      `\nYou drew them before, and {owner} wants a change.\n\nThe look you drew:\n\`\`\`json\n${JSON.stringify(req.previous.look)}\n\`\`\`\n\nWhat {owner} wants changed: ${req.note || 'redraw them, differently'}`,
    others.length &&
      `\nStaff already on the floor. Differ from each in at least two of hairstyle, hair colour, skin and top:\n${others.map((o) => `- ${o.name}: ${JSON.stringify(o.look)}`).join('\n')}`,
    '',
    brief(lib),
    ANSWER
  ]
    .filter(Boolean)
    .join('\n');

  let message = ask;
  for (let attempt = 1; ; attempt++) {
    const r = await runAsOffice(message, {
      system: SYSTEM,
      kind: 'look',
      // From words alone, low effort draws in one to two minutes and passes the
      // checks as often as high, which took five to ten (tested 2026-10-31). A
      // likeness needs more thought: medium, then a look-and-fix run, five to
      // seven minutes in all.
      timeoutMs: (req.photo ? 10 : 5) * 60_000,
      effort: req.photo ? 'medium' : 'low',
      signal: req.signal,
      ...(req.model ? { model: req.model } : {}),
      ...(req.photo ? { images: [req.photo] } : {})
    });
    if (!r.ok) throw new Error(r.text);
    const parsed = parseReply(r.text);
    const problems = parsed.drawn
      ? [...parsed.problems, ...(await problemsWith(parsed.drawn, req.staffId))]
      : parsed.problems;
    if (!problems.length && parsed.drawn)
      return preview(
        req.photo
          ? await lookAndFix(ask, r.text, parsed.drawn, { ...req, photo: req.photo })
          : parsed.drawn
      );
    // The last reply, for when a drawing keeps failing. Never from a photo: its
    // reply opens with a read of the face, and the face stays off the disk.
    if (!req.photo) writeFileSync(home('office', 'last-look.md'), r.text);
    console.error(`[looks] attempt ${attempt} for ${req.name}: ${problems.join('; ')}`);
    if (attempt >= 2) throw new Error(`The drawing did not come out right: ${problems.join('; ')}`);
    if (req.signal?.aborted) throw new Error('Stopped.');
    message = `${ask}\n\n## Your last reply\n\n${r.text}\n\n## What was wrong with it\n\n${problems.map((p) => `- ${p}`).join('\n')}\n\nReply again in full, with every problem fixed.`;
  }
}

const rendered = new Map<
  string,
  { sheet: Uint8Array; frames: Record<string, number>; portrait: Uint8Array }
>();

/** A hired staffer's frames and portrait, rendered once per look. */
export async function staffArt(row: {
  id: string;
  look: LookSpec | null;
  portraitPx: string | null;
}) {
  if (!row.look || !row.portraitPx) return undefined;
  const k = `${row.id}|${lookVersion(row.look, row.portraitPx)}`;
  let art = rendered.get(k);
  if (!art) {
    const lib = await library();
    const sheet = renderLook(lib, row.look);
    art = {
      sheet: sheet.png,
      frames: sheet.frames,
      portrait: renderPortrait(lib, row.look, row.portraitPx)
    };
    rendered.set(k, art);
  }
  return art;
}

/** A drawn look from a request body, or nothing if it is not one. */
export function drawnFrom(b: Record<string, unknown>): Drawn | undefined {
  const look = b.look as LookSpec | undefined;
  if (!look || typeof look !== 'object' || typeof b.portraitPx !== 'string') return undefined;
  const newParts = Array.isArray(b.newParts)
    ? (b.newParts as DrawnPart[]).filter(
        (p) =>
          p && PART_KINDS.includes(p.kind) && typeof p.name === 'string' && typeof p.px === 'string'
      )
    : [];
  return { look, portraitPx: b.portraitPx, newParts };
}
