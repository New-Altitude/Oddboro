# apps/site

The public site for Oddboro, at https://oddboro.com. SvelteKit with Svelte 5 runes,
Tailwind 4, TypeScript, and `@sveltejs/adapter-static`: every page prerenders
to plain files in `build/`, so any static host serves it. Port 4501 for `dev`
and `preview`, fixed.

## The name and the words

- The product is **Oddboro**. Its AI workers are **Odds** (one Odd, many
  Odds), always capitalized, mid-sentence too: "an Odd", "your Odds", "the
  Bills Odd". Visitor-facing copy never says staff, staffer, agent or toon.
  The Office Manager keeps its role name, and it is an Odd too.
- "Odds" is a count noun: "an Odd", "3 Odds", "your Odds work". Rephrase any
  sentence where it could read as chances, like "your Odds are" or "the Odds".
  Code names stay `staff` (the vignette files, `scene.staff`, `STAFF`).
- The tagline is **Hire Odds.** It is `SITE.tagline`, the title, the og
  title, the hero headline, the first section's title and the closing band.
  The supporting lines are "Too much on your plate? Hire Odds." and "Hire
  Odds for everything you want off your plate."
- Say what an Odd does for the visitor, not how the app works. Leave out
  what they find by using it: updates, which tab or button does what, what
  the first launch asks. Requirements, privacy and safety limits stay.
- Release notes say what changed for someone using Oddboro, answer first, in
  short active sentences. Leave out how we built it and what never shipped.
- The legal pages and the FAQ quote the product's own paths (`~/.oddboro/`,
  the `oddboro` secret store service, `local.oddboro.com`). Keep them in step
  with the app.

## Info pages

`/info/<name>/` explains a safety limit the office links to, rendered from
`src/content/info/<name>.md` through `LegalDoc.svelte` with "Safety" over the
title (`info` in `src/lib/server/legal.ts`). `/info/folder-sharing/` is the
office's folder warning's More info (`FolderWarning.svelte`): which folders
the office refuses, which warn, and why. Its words follow `checkFolder` in
the ledger, and change with it.

## Connector guides

`/connectors/<name>/` walks the owner through giving an Odd one outside
service whose setup is not obvious, such as Open Brain's key in the
`x-brain-key` header. It is the one place the site names tabs and buttons,
so its steps quote the office's labels exactly (`AccessTab.svelte`,
`DeskDrawer.svelte`, `connectSteps` in the ledger) and change with them.
Building the service itself stays in its own docs, which the page links to.

Every guide renders through `Guide.svelte`: wide, with each step's box
beside its words on a laptop. A step has at most one box: text to copy
(`CopyBox`, its Copy button on the right), a page to open (`LinkBox`, the
address as a link and a Go to button, both opening a new tab), or an example
to read. AWS has four guides, `aws-sign-in` (shared) and one per AWS tool
(`aws-secrets`, `aws-read`, `aws-build`), from `src/lib/guides/aws.ts`; the
office links each tool's connect step to its guide (`AWS_GUIDES` in the
office's `lib/site.ts`).

## Least access, never a yes for everything

The site never promises that nothing leaves without the owner's yes, because an
Odd with a write grant at act acts without asking. It says each Odd gets the least
access its job needs, and every claim rests on the office's real rules:

| Claim on the site                                                     | Where it is true                                                          |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| One level per Odd (read, draft, act), only the owner raises it        | `setPermission` in `packages/ledger/src/office.ts`; the 2026-10-29 ruling |
| A new Odd starts at read with no outside tools                        | `staff.permission` defaults to read in `schema.ts`; grants start empty    |
| An Odd asks, the owner approves and connects it                       | `grantAccess` and the 2026-10-30 access ruling                            |
| A tool connects read only, or with write from draft                   | `grantAccess` and `grantWorks`; `access()` in `staff.ts`                  |
| At draft, each change through a write grant waits for the owner's yes | `writesWait`; the gateway's `raiseCall`, and `makeCall` on the yes        |
| A lowered level makes a grant above it wait                           | `access()` skips it; `setPermission`'s comment                            |
| At act, a write grant uses that one tool without asking; revocable    | `revoke` in `office.ts`; the Access tab in `apps/office`                  |
| An Odd pokes the owner in chat at a time it sets                      | `poke_owner` in `packages/ledger/src/mcp.ts`                              |
| Every Odd reads the people list, which stays on the owner's computer  | `readable` in `staff.ts`; hard rule 9                                     |

An Odd has web search only when the owner turns on Browse the web for it,
through its tool's own search and fetch; otherwise it has file tools only.
Copy that searches the web says the owner turns on Browse the web for that Odd. When any of these rules changes in the office, change the
site in the same change.

## The promise

The site makes no third-party request. The fonts ship with it
(`@fontsource/geist-pixel`, `@fontsource-variable/inter`), and there are no
analytics, cookies, trackers, embeds or forms. It holds no secrets and collects
nothing. The privacy policy says so, so a change that adds a request to another
host is a change to the policy first.

## Theme

Two themes, night and day, the same brand. Night is the office's night palette;
day is warm paper with the palette's ink and a deeper sea. The visitor's system
setting decides unless they pick in the header (Auto, sun, moon, the same
control as the office's floor light). The pick lives in this browser's
`localStorage` under `oddboro.theme` and goes nowhere else; every read and
write sits in a try/catch. An inline script in `src/app.html` reads the key
and sets `data-theme` on `<html>` before first paint, and
`src/lib/theme.svelte.ts` keeps it current after that, following the system
while on Auto. With no script at all the site is night.

Every colour is a token in `src/app.css`, and day is one block of overrides
on `html[data-theme='day']`. Nothing forks a colour per component: `bg-night`
is the page surface in both themes, `text-night` is the text on a sea button
in both. Day's pairs, all AA (4.5:1 body, 3:1 large text and UI):

| Pair                             | Ratio |
| -------------------------------- | ----- |
| ink `#1c1727` on paper `#f7f3ea` | 15.8  |
| muted `#4e4860` on paper         | 7.8   |
| faint `#655f78` on paper         | 5.5   |
| sea `#136e66` on paper           | 5.5   |
| ember `#8a5500` on paper         | 5.6   |
| coral `#b23a2b` on paper         | 5.4   |
| moss `#3a7228` on paper          | 5.2   |
| faint, sea on panel `#efe9dc`    | 5.0   |
| paper on sea (buttons, the ring) | 5.5   |
| paper on ember (the ask bubble)  | 5.6   |

The art follows the theme too. Every image the hour changes has a night and a
day render, and `app.css` names each one as an `--art-<file>` variable, keyed
off `data-theme`, so a page fetches only the set it shows and a flip mid-page
swaps the art with no reload. The hero reads its art off those variables, so a
flip mid-animation keeps its place. Portraits, walks and `og.png` stay as they
are: daylight, and night.

## Commands

```sh
npm run dev -w @oddboro/site        # http://localhost:4501
npm run build -w @oddboro/site      # prerender to apps/site/build/
npm run deploy -w @oddboro/site     # build, then put it live at oddboro.com (Cloudflare)
npm run preview -w @oddboro/site    # serve the build on 4501
npm run art -w @oddboro/site        # regenerate static/art/, src/lib/hero/scene.json and src/lib/vignettes.json
npm run office-gif -w @oddboro/site # the README's office, docs/office.gif; add -- --night for docs/office-night.gif
npm run check-types -w @oddboro/site
npm run lint -w @oddboro/site       # prettier; the root guards run too
```

## The art

`scripts/art.ts` builds the hero's office from `scripts/hero-office.json`
with `generateOffice` (the same code that builds a new owner's office), renders
it twice with the world's lighting, at night (hour 21, lamps on) into
`static/art/` and at midday (hour 13, lamps off) into `static/art/day/`, and
writes every position to `src/lib/hero/scene.json`. It also renders the section
art: the four managers' portraits and walks, the other Odds' portraits, and the
floor-state vignettes from a second office (`scripts/vignette-office.json`, which
has a mail room). The output is committed, so the site build never runs the
renderer or touches the sprite packages. Rerun `npm run art` after the art or a
spec changes, and commit the result.

| File                              | What it is                                                                             |
| --------------------------------- | -------------------------------------------------------------------------------------- |
| `day/*.png`                       | The same files rendered at midday, for the day theme                                   |
| `lot.png`                         | The site before the building: grass, the street, its lamps lit                         |
| `floors.png`                      | The building's floors, unlit, transparent elsewhere                                    |
| `walls.png`                       | The walls, unlit                                                                       |
| `props.png`                       | The furniture, unlit                                                                   |
| `lit.png`                         | The finished scene at night: tint, lamp glow, screens on                               |
| `door-open.png`                   | The front door open, cut from a lit render                                             |
| `bus.png`                         | The bus, three frames: wheels in two positions, then the door open                     |
| `bus-body.png`                    | The bus without its wheels, for What happens next                                      |
| `bus-wheels.png`                  | The wheels alone, two frames, turning under `bus-body.png`                             |
| `<name>.png`                      | An Odd's sheet, one row per pose (`scene.staff.rows`), four wide                       |
| `og.png`                          | The Open Graph card, 1200 by 630, the front of the building at twice                   |
| `portrait-<id>.png`               | A 48 by 48 portrait: the four managers and three more Odds                             |
| `portrait-<id>-blink.png`         | The same portrait with its eyes shut                                                   |
| `walk-<id>.png`                   | A manager's walk toward the viewer, four frames in a strip, daylight                   |
| `vignette-<state>.png`            | A floor state, 128 by 96, lit (`desk`, `mail`, `library`, `reception`, `door`, `chat`) |
| `vignette-<state>-front.png`      | The same size: what stands in front of the Odd                                         |
| `vignette-<state>-staff-anim.png` | The Odd's pose there as a strip, every frame side by side                              |
| `vignette-<state>-prop-anim.png`  | The one animated prop in the crop as a strip (the library fire)                        |
| `vignette-<state>-dust.png`       | Dust in the window light, by day (the chat vignette)                                   |

The three managers who are drawn looks (Ziva, Jamal, Cindy) take their
`LookSpec` from `scripts/manager-looks.json`, a copy of the presets in
`packages/ledger/src/managers.ts`. The copy is deliberate: that module imports
the database, so the site cannot load it without taking on the whole ledger.
Keep the copy in step by hand when a preset changes, and rerun `npm run art`.

## The hero

`src/lib/hero/Hero.svelte` stacks the layers and plays `scene.json` through
the timeline in `choreo.ts`: chalk lines, floors front to back, walls rising
from their base, furniture dropping in room by room, the lamps coming on, the
bus arriving with the Office Manager, Odds at their desks, one Odd
walking to wait at the owner's door, and a bubble over each head. Every track
is a pure function of time, so `render(t)` draws any moment: the start, the
finished office under reduced motion, or wherever the viewer paused. The
markup's defaults are the finished state, so the page is whole before any
script runs. The sequence plays once, pauses off screen and in a hidden tab,
and "Play it again" restarts it. After it the office keeps living, one of the
ambient loops below: now and then an Odd finishes its job (the `JOBS` lines in
`Hero.svelte`), walks to a spot to read or rest, and comes back to a new one.
Juno never leaves the owner's door. `HeadlineOdd.svelte` swaps the pixel
portrait after "Hire Odds." every few seconds.

The caption under the stage follows the beats, one line each, and bubbles near
the stage's edge are kept inside it with their tails still over the head. By
day the lamps beat is the same crossfade with nothing to light, and its caption
reads "Doors open." instead of "Lights on."; every other beat is the same.

The Unmute button in the stage's top corner plays "Good Morning, Neighbor",
the song the office opens a new owner's first visit with. The page is silent
until the visitor presses it, and pressing it after the build ended plays the
build again with the song. `static/audio/good-morning-neighbor.m4a` is a copy
of the office's file (`apps/office/static/audio/`); LICENSE-ASSETS covers both
folders.

## Motion rules

Only `transform` and `opacity` animate, so no `transition-colors` anywhere: a
hover colour changes at once. Nothing runs while the screen is still: the hero
stops at its end, the reveal helpers play once, and the goals line moves only
with the scroll. Everything is off under `prefers-reduced-motion`.

Six ambient loops are allowed, as exceptions to root rule 13, and no others;
the list and the reason are in `docs/decisions/` (the 2026-11-02 site ruling
on ambient loops). Each one stops off screen, in a hidden tab and under
reduced motion, and runs frames only while something moves. A new loop needs
its own ruling.

The helpers
live in `src/lib/motion/index.ts`:

- `use:reveal` and `use:reveal={{ delay }}` fade an element up once when it enters the viewport.
- `use:stagger={{ step }}` reveals an element's children one after another.
- `use:visible={(on) => ...}` says when an element is on screen, for pausing work.

Section beats follow the same rules, and their classes sit in `app.css` under
"Section beats": a vignette's Odd steps in after its card reveals, a
manager walks and blinks while their card is hovered or keyboard focused and
stands on leaving (a tap pick takes two steps), the goals
line draws down with the scroll, and an answer or a reply pops in once.

## The sections

`src/routes/+page.svelte` maps each id in `SECTIONS` to a component in
`src/lib/sections/`, then ends with the call-to-action band. Each section has
its own composition; none is a row of identical cards.

| Section        | Component    | The idea                                                                         |
| -------------- | ------------ | -------------------------------------------------------------------------------- |
| `hire`         | `Hire`       | "Hire an Odd for ..." as a list you pick from, and the pick as a job card        |
| `how-it-works` | `HowItWorks` | Six floor states as vignettes cut from a real office, Odd in                     |
| `managers`     | `Managers`   | Character cards with portraits, a walk on hover, pick one; describe your own     |
| `access`       | `Access`     | Least access: an Odd's Access tab as a working mock, level and tool grants       |
| `goals`        | `Goals`      | A sample goal beside its three-step plan, the line drawing in on scroll          |
| `on-your-mac`  | `OnYourMac`  | A map of where the data lives: the computer in the middle, edges on dashed lines |
| `open-source`  | `OpenSource` | The license as a terminal block, the GitHub link, the music note                 |
| `get-started`  | `GetStarted` | The download for this computer, its requirements and steps, source folded under  |
| `faq`          | `Faq`        | Native `<details>` disclosures, answers fading in once                           |
| (band)         | `Cta`        | The lit office at twice the size behind the headline and the buttons             |

The job card in `Hire` names, for each job, what the Odd does with the tools
the office really gives it, the least level that takes, and the owner's part.
The `Access` mock plays the office's rules: the level buttons, a grant per tool
that works only from its level (write from draft, asking first there), a grant that waits when the level drops,
Revoke, and what the Odd can do now. The job picker, the Access mock and the
copy buttons keep their state on the page. Nothing is sent anywhere, and the
clipboard write is the only browser API they touch.

## Downloads and releases

Oddboro ships for the Mac (`Oddboro.dmg`) and for Linux on x86_64 and arm64
(`Oddboro-x86_64.AppImage`, `Oddboro-aarch64.AppImage`). Every release carries
those names, so `releases/latest/download/<name>` is the newest one.
`src/lib/downloads.svelte.ts` holds the builds with their requirements and
install steps. The page renders the Mac build, so it is whole with no script;
in the browser `detectBuild` switches every `DownloadButton` and Get started to
the Linux build on Linux, reading the user agent and, in Chromium, its
architecture hint (Chromium says x86_64 on every Linux machine). The answer
stays on the page. "All downloads" goes to `/releases/`.

`/releases/` lists every build of the newest release, with the visitor's
own (the same pick as the download buttons) outlined and Marshall pointing at
it: "You probably want this one." His pose is his side frame from the staff
sprite with one arm raised, made in `scripts/art.ts` as `point-marshall.png`,
so the shared sprites (and the app build) stay untouched. Then every release,
newest first, from `src/lib/releases.ts`. Add a release there after its draft
on GitHub is published, with the same version as its tag and the day it was
published in Pacific time (GitHub shows UTC, which runs a day ahead in the
evening): until then its links answer 404. The order is: merge the app's
changes, publish the draft, then merge the site's entry and its art (which
builds no app) and deploy the site by hand. A release's art is a
looping GIF from `scripts/release-art.ts`, with a still of the last frame.
`npm run art` renders every one twice, like the rest of the art: night in
`static/art/releases/`, day in `static/art/day/releases/`. `releases.ts`
names the art, and the page shows the pair for the visitor's theme, the
still under reduced motion (the 2026-11-03 site ruling). A new animation goes
in `release-art.ts`, so it gets both themes with no extra work.

The newest release's art is also `/releases/`'s link preview:
`<name>-share.png`, one frame at 1200 by 630 on ink, in `static/art/releases/`.
Each animation names its frame as `share` and its light, night or day, as
`shareLight` in `release-art.ts`, and `npm run art` fails without a frame. The
owner picks both: when making a release's art, show the owner the frames in
both lights and ask which one. `releases.ts` describes that
frame as `shareAlt`.
`scripts/gif.ts` writes the GIFs, with no dependency: median cut to 256
colours, then LZW. A long one, like the README's office, stores only what
changed since the frame before (`encodeGifChanges`).

## Layout

```
scripts/art.ts               The art generator. hero-office.json, vignette-office.json and manager-looks.json are its specs.
scripts/paint.ts             Paints and lights the office's sprites for an hour of the day, for art.ts and office-gif.ts.
scripts/office-gif.ts        The README's office: Main Street by day with eight Odds at work, as docs/office.gif.
scripts/release-art.ts       The releases page's GIFs, on the desk vignette. gif.ts encodes them.
src/app.css                  The tokens (night, and the day overrides), the --art-* variables, the fonts, the motion classes.
src/lib/theme.svelte.ts      The theme: the pick, localStorage, data-theme on <html>, following the system on Auto.
src/lib/site.ts              The site's facts: address, titles, GitHub, the tagline, the section list.
src/lib/downloads.svelte.ts  The builds, their links, and which one this visitor's computer wants.
src/lib/releases.ts          Every published release, for /releases/.
src/lib/managers.ts          The four managers as the cards show them.
src/lib/vignettes.json       Where each vignette's Odd stands, written by art.ts.
src/lib/job-icons.ts         The 12 by 12 pixel icon for each job in Hire, compiled to one path each.
src/lib/components/          Header (with the theme control), Footer, Meta (head tags), SectionHeader, LegalDoc, GitHubMark, DownloadButton, and the guides: Guide, CopyBox, LinkBox, UvSteps.
src/lib/guides/              The connector guides' parts and fixes as data (types.ts, aws.ts).
src/lib/sections/            One component per homepage section, and the Cta band.
src/lib/motion/              The motion helpers above.
src/lib/hero/                Hero.svelte, HeadlineOdd.svelte, choreo.ts, scene.json.
src/lib/server/legal.ts      Renders src/content/legal/*.md with markdown-it at prerender.
src/content/legal/           privacy.md and terms.md. The legal writer owns these.
src/routes/                  /, /releases/, /connectors/open-brain/, /connectors/aws-*/, /privacy/, /terms/, /sitemap.xml. +layout.ts prerenders everything.
static/                      logo.png (the mark, drawn by `npm run mark -w @oddboro/sprites`: favicon, header, footer), robots.txt, art/ (night) and art/day/.
```

## Hosting

Cloudflare serves the site at oddboro.com: a Worker with static assets, named
`oddboro-site`, set up in `wrangler.jsonc`. `npm run deploy -w @oddboro/site`
builds and uploads it; it needs `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID` in the environment. The other domains (oddboro.ai,
oddborough.com, oddborro.com, oddsboro.com, and every `www`) redirect to
https://oddboro.com with a 301 that keeps the path, from a redirect rule on each
zone. Every zone sends HTTP to HTTPS and needs TLS 1.2 or later.
