# Hard rules: the reasons

One section per rule in the root `CLAUDE.md`, in the same order. A rule change
updates both files in the same change.

## 1. Write for a person.

The owner reads everything the office produces. Dense or padded text costs a
reader the most time, and structure lets them move fast. So every piece of
writing opens with its answer, groups its support, and uses plain words. When
the owner has to act, the steps are numbered and each holds one action with
the exact command or click. Odds follow the same rule in everything they say
to the owner, and agents copy the house style, so the docs set it. (Decided
2026-10-29.)

## 2. No em-dashes anywhere.

They are the fastest tell that a machine wrote the sentence. The guard also
carries a list of stock phrases with the same effect. Add to it when one slips
through.

## 3. The web is Svelte and SvelteKit only.

One framework keeps every surface consistent and every agent fluent in one
idiom. PixiJS is allowed because it draws pixels and owns no UI state.
(Decided 2026-10-29.)

## 4. Nothing leaves the office without the owner's yes.

Sending, posting and scheduling cannot be taken back, and they happen in the owner's
name. Odds draft freely. Approval covers one action, never the next one. The
one standing yes is a write grant: the owner connects a tool at write level for one
Odd and raises that Odd to Act, and from then it uses that tool's
tools without asking each time (decided 2026-10-30). At Draft a write grant
is no standing yes: the gateway holds each call that changes something as
that exact call on the owner's desk, and the office makes it only on their
yes (decided 2026-11-07). The narrower standing yes is a tool the owner lets
one Odd use without asking, such as one that only stages a change: at Draft
a call to that tool goes through, and every other change still waits
(decided 2026-11-10). Its mirror at Act is a tool the owner sets to ask
first: each call to it waits on the desk as at Draft, so a high-risk tool
keeps needing a yes however far the owner trusts the Odd (decided
2026-11-11). Revoking the grant or lowering the level ends it at
the next run. A yes counts only from the
owner's own page: the office refuses an action any other site sends it
(decided 2026-11-04).

## 5. No commits or pushes without the owner saying so.

The build loop stays local and fast. Pushing is a decision the owner makes.

## 6. Logical properties only.

Left and right flip in right-to-left layouts; start and end do not. Doing this
from the first line costs nothing.

## 7. Every colour on the floor comes from the palette.

One palette is what makes a hundred sprites by different hands look like one
place. A colour added for one sprite breaks that. Add it to the palette for
everyone or reuse what is there.

## 8. Rooms and offices are data.

The office will grow for years. If a new room needed engine code, every room
would carry risk. A stamp and a plan in JSON can be added, moved and removed
without touching the engine. A new kind of room is different: the office
designer furnishes each kind in code, so a new kind starts at `ROOM_KINDS` and
its furnishing in the same file.

## 9. Personal names and accounts stay out of tracked files.

The repo is public, so anything in a tracked file is public too. A person's
name or an account name in a commit stays in its history after the line is
gone. `scripts/check-private.ts` fails when a word from
`data/private-words.txt` appears in a tracked file or file name, and git
ignores `data/`, so the list itself stays private. The office is for any
owner, so the rule guards the repo, not what an owner keeps in their own
office. (Decided 2026-11-12.)

## 10. Every `CLAUDE.md` is named in its nearest ancestor.

A context file no index names is a file no session is told about. Naming each
one in the file just above it keeps the root short and every file findable.

## 11. Decisions are one file each, and never provisional.

One file per decision means two changes that each record a decision never
collide. An entry is binding the moment it lands, so an undecided entry is
unactionable: a reader cannot tell whether to follow it. Open questions stay
out of the repo.

## 12. Zero is the only number.

Warnings compound. A pre-existing warning is not a reason to ship another one
next to it.

## 13. The simplest, lightest approach wins.

The office runs all day on the owner's computer beside their real work, so it has to cost
close to nothing when they are not looking at it. Complexity costs twice: once
to build and again every time someone has to read it. On 2026-10-29 the floor
redrew all 10,464 sprites 60 times a second and an Odd's card looped a shine
forever. Together they used about 31% of a core while nothing moved. Drawing
only on change and sweeping the shine once cut that to about 6%.

## 14. Setup works on a Mac, Linux and Windows.

Setup is the first thing a new owner sees, and Oddboro ships on all three
systems. Grok, Codex and Gemini were built and measured on a Mac while the
Linux and Windows releases were going out, so a setup screen that assumed a
Mac would have offered tools those systems cannot run, or hidden the one they
can. A tool not offered on a system still shows there, greyed, with why. The
office's tests run each system's answer with `onPlatform`, and a person walks
through setup on each before a release reaches owners. (Decided 2026-11-05.)
