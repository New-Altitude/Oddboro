// A job exchanges files only on the work the owner assigned. Check again as
// the clock starts it, since its goal, colleagues and sources may have changed.
import { lstatSync, realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  AGENT_NAMES,
  asksFor,
  connector,
  enabledJobs,
  filesViaOffice,
  goal,
  fileReaders,
  heldTools,
  lacking,
  modelSection,
  latestScheduledRuns,
  scheduledInput,
  roster,
  thread,
  toolNames,
  workFile,
  type JobFiles,
  type JobRow,
  type StaffRow,
  home
} from '@oddboro/ledger';
import { workName } from '@oddboro/ledger/work-paths';
import { sourceReady } from './access.ts';
import { missingSignIn, type ChatSignIn } from './agent-sign-in.ts';

export async function scheduledFiles(
  who: StaffRow,
  job: JobRow,
  files: JobFiles,
  when: 'review' | 'run'
) {
  const blocks = new Set<string>();
  const signIns: { name: string; request: ChatSignIn }[] = [];
  const browse: { id: string; name: string; ask?: { id: number; title: string } }[] = [];
  const t = await thread(files.thread);
  const g = t?.goalId ? await goal(t.goalId) : undefined;
  const people = await roster();
  const membership = t ? await fileReaders(t) : undefined;
  const members = people.filter((p) => membership?.readers.has(p.id));
  const others = members.filter((p) => p.id !== who.id);
  const rows = await heldTools(members.map((p) => p.id));
  const peers = (await enabledJobs()).filter(
    (j) =>
      j.id !== job.id &&
      j.files?.thread === files.thread &&
      (j.files?.input === `${who.id}/${files.output}` ||
        files.input === `${j.staffId}/${j.files?.output}`)
  );
  const jobs = [job, ...peers];
  for (const id of new Set(jobs.map((j) => j.staffId))) {
    const p = people.find((o) => o.id === id);
    if (!p) {
      blocks.add(
        `The writer or reader assigned to ${id} has left. Reassign that job to an Odd on this work.`
      );
      continue;
    }
    const request = await missingSignIn(p);
    if (request) signIns.push({ name: p.name, request });
    if (request)
      blocks.add(`${p.name} needs ${AGENT_NAMES[p.agent]} to run. Sign in from ${p.name}'s chat.`);
    if (!filesViaOffice(p.agent, process.platform))
      blocks.add(
        `${p.name} needs the office file tools to check the result. Choose a tool with office files on ${modelSection(p.name + "'s")}.`
      );
    if (!membership?.readers.has(id) || (g && !membership.assigned.has(id))) {
      blocks.add(
        `${p.name} has no current assignment on this work. Assign the job to an Odd who serves it or change the job's files.`
      );
    }
  }
  if (!t || t.status !== 'open' || (g && g.status !== 'active'))
    blocks.add(
      `${who.name} needs an active piece of work. Change the job's files to work that is still open, or pause the job.`
    );

  // A writer needs its source. A reader of the approved file needs no
  // account for that source. The checked plan names this output and audience.
  const checkedSources = new Map<string, boolean>();
  for (const j of jobs) {
    const p = people.find((o) => o.id === j.staffId);
    if (!p || !j.files) continue;
    for (const source of j.files.sources ?? []) {
      if (!rows.some((r) => r.staffId === p.id && r.id === source && r.inForce)) {
        if (when === 'review' && source === 'web' && !browse.some((b) => b.id === p.id)) {
          const ask = (await asksFor(p.id)).find(
            (a) => a.status === 'open' && a.web?.some((w) => w.id === p.id)
          );
          browse.push({ id: p.id, name: p.name, ask: ask && { id: ask.id, title: ask.title } });
        }
        blocks.add(
          source === 'web'
            ? `${p.name} needs Browse the web to produce ${j.files.output}. Ask in ${p.name}'s chat to turn on browsing for this job.`
            : `${p.name} needs ${source} to produce ${j.files.output}. In ${p.name}'s chat, request read access to that service.`
        );
      } else if (when === 'run' && source !== 'web') {
        if (!checkedSources.has(source)) {
          const service = await connector(source);
          checkedSources.set(source, !!service && (await sourceReady(service)));
        }
        if (!checkedSources.get(source))
          blocks.add(
            `${p.name} needs ${source} for ${j.files.output}. Reconnect that account from ${p.name}'s chat.`
          );
      }
      if (
        !j.files.share &&
        members.some(
          (m) =>
            m.id !== p.id && !rows.some((r) => r.staffId === m.id && r.id === source && r.inForce)
        )
      )
        blocks.add(
          `${p.name} needs your permission to include material from ${source} in ${j.files.output} for colleagues on this work. Open the job and approve sharing that result, or leave that source out.`
        );
    }
  }
  const source = files.input
    ? scheduledInput(job, jobs, await latestScheduledRuns(peers.map((j) => j.id)), new Date())
    : undefined;
  const waiting = source?.pending ? source.problem : undefined;
  if (source?.problem && (!waiting || when === 'run'))
    blocks.add(`${who.name} needs the current input. ${source.problem}`);
  const root = realpathSync.native(home());
  const output = join(root, 'threads', String(files.thread), who.id, files.output);
  let input: string | undefined;
  if (files.input && membership?.readers.has(who.id)) {
    input = await workFile(who.id, workName(files.thread, files.input));
    if (!input && !source?.problem)
      blocks.add(
        `${who.name} needs ${files.input}. Have its writer finish the file in their part before this job runs.`
      );
  }
  if (t && membership?.readers.has(who.id)) {
    // A root given to a file server must itself be the office's folder, not a
    // link. Check each existing step before making the Odd's part.
    for (const path of [
      join(root, 'threads'),
      join(root, 'threads', String(t.id)),
      join(root, 'threads', String(t.id), who.id)
    ]) {
      if (
        lstatSync(path, { throwIfNoEntry: false }) &&
        (!statSync(path, { throwIfNoEntry: false })?.isDirectory() ||
          realpathSync.native(path) !== path)
      ) {
        blocks.add(
          `${who.name}'s work folder moved. Restore its original folder before running this job.`
        );
        break;
      }
    }
  }
  const kept = [
    ...new Set(
      others.flatMap((p) =>
        lacking(rows, p.id, [who.id])
          .filter((r) => !(files.share && files.sources?.includes(r.id)))
          .map((r) => r.name)
      )
    )
  ];
  const withheld = lacking(
    rows,
    who.id,
    others.map((p) => p.id)
  ).map((r) => r.name);

  const brief = [
    input && `First read ${input} with read_file.`,
    `Use write_file or edit_file to save this run's result in ${output}.`,
    files.share &&
      files.sources?.length &&
      `The owner approved material from ${toolNames(files.sources)} only in ${files.output} for colleagues on this work. Keep the source notes private.`,
    kept.length &&
      `Keep material from ${toolNames(kept)} out of these files and your reply. A colleague lacks it.`,
    withheld.length &&
      `You have no direct access to ${toolNames(withheld)}. Use only the assigned result.`
  ]
    .filter(Boolean)
    .join(' ');
  return { blocks: [...blocks], signIns, browse, waiting, brief, input, output, source };
}
