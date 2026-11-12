<script lang="ts">
  import type { AskRow } from '@oddboro/ledger';
  import { goalWhen } from '@oddboro/ledger/goals';
  import { describe } from '@oddboro/ledger/time';
  import { LEVEL_LABEL } from '@oddboro/ledger/access';
  import type { StaffProfile } from '../staff/roster.ts';
  import { openFile } from './windows.svelte.ts';

  let {
    a,
    staff,
    skip,
    onskip
  }: {
    a: AskRow;
    staff: StaffProfile[];
    skip: Record<number, boolean>;
    onskip: (index: number, skipped: boolean) => void;
  } = $props();
</script>

{#if a.goal}
  {@const g = a.goal}
  <div>
    <dt class="text-xs text-muted">The goal</dt>
    <dd class="mt-1 flex flex-col gap-1 rounded-lg bg-raise px-2.5 py-2 text-xs">
      <div class="text-sm text-ink">{g.title}</div>
      {#if g.why}<div><span class="text-muted">Why:</span> {g.why}</div>{/if}
      {#if g.doneWhen}
        <div><span class="text-muted">Done when:</span> {g.doneWhen}</div>
      {/if}
      <div><span class="text-muted">When:</span> {goalWhen(g)} · {g.area}</div>
    </dd>
    <p class="mt-1.5 text-[11px] text-faint">
      Setting it sends {staff.find((p) => p.id === a.staffId)?.name ?? 'your manager'} off to plan it.
      The plan comes back to your desk.
    </p>
  </div>
{:else if a.plan}
  {@const plan = a.plan}
  <div>
    <dt class="text-xs text-muted">The plan · untick any part to leave it out</dt>
    <dd class="mt-1 flex flex-col gap-1.5">
      {#each plan.items as item, i (i)}
        <label
          class="flex cursor-pointer items-start gap-2.5 rounded-lg bg-raise px-2.5 py-2 text-xs"
          class:opacity-50={skip[i]}
        >
          <input
            type="checkbox"
            class="mt-0.5"
            checked={!skip[i]}
            onchange={(e) => onskip(i, !e.currentTarget.checked)}
          />
          <span class="flex min-w-0 flex-1 flex-col gap-0.5">
            {#if item.kind === 'hire'}
              {@const h = item.hire}
              <span class="text-sm text-ink">Hire {h.name}, {h.role}</span>
              <span>{item.part}</span>
              <span class="text-muted"
                >{LEVEL_LABEL[h.permission]}{h.room ? ` · ${h.room}` : ''}</span
              >
              {#if h.job}
                <span class="text-muted">First job: {h.job.name}, {describe(h.job.schedule)}</span>
              {/if}
              <span class="flex flex-wrap gap-x-2">
                <button
                  type="button"
                  class="text-sea underline underline-offset-2"
                  onclick={() => openFile({ staff: a.staffId, path: h.jobDescriptionFile })}
                  >Job description</button
                >
                {#if h.intakeFile}
                  {@const intake = h.intakeFile}
                  <button
                    type="button"
                    class="text-sea underline underline-offset-2"
                    onclick={() => openFile({ staff: a.staffId, path: intake })}
                    >Your intake answers</button
                  >
                {/if}
              </span>
            {:else}
              {@const files = item.job?.files ?? item.editJob?.files}
              <span class="text-sm text-ink"
                >{staff.find((p) => p.id === item.staff)?.name ?? item.staff} takes it on</span
              >
              {#if files}
                <span
                  >In this goal’s folder: {files.input ? `read ${files.input}, then ` : ''}write {item.staff}/{files.output}.{files
                    .sources?.length
                    ? ` ${files.share ? 'Allow everyone on this goal to read this file with material from' : 'Needs'} ${files.sources.join(', ')}.`
                    : ''}</span
                >
              {/if}
              <span>{item.part}</span>
              {#if item.job}
                <span class="text-muted"
                  >New job: {item.job.name}, {describe(item.job.schedule)}</span
                >
              {/if}
              {#if item.editJob}
                <span class="text-muted"
                  >Changes its job "{item.editJob.name}"{item.editJob.newName
                    ? ` to "${item.editJob.newName}"`
                    : ''}{item.editJob.schedule
                    ? ` to ${describe(item.editJob.schedule).toLowerCase()}`
                    : ''}</span
                >
              {/if}
            {/if}
          </span>
        </label>
      {/each}
      {#if plan.ownerSteps?.length}
        <div class="rounded-lg bg-ember/10 px-2.5 py-2 text-xs">
          <div class="text-muted">Yours to do, as a task on your desk</div>
          <ol class="mt-1 list-decimal ps-4">
            {#each plan.ownerSteps as s, i (i)}<li>{s}</li>{/each}
          </ol>
        </div>
      {/if}
    </dd>
    <p class="mt-1.5 text-[11px] text-faint">
      Odds already here take on their part as soon as you approve. Each hire opens in the hire
      window.
    </p>
  </div>
{/if}
