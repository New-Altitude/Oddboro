<script lang="ts">
  import type { ProjectGoalSummary } from '@oddboro/ledger';
  import ProjectSessions from './ProjectSessions.svelte';
  import { projectApi } from './project-api.ts';
  let {
    goalId,
    staff,
    version
  }: { goalId: number; staff: { id: string; name: string }[]; version: number } = $props();
  let sessions = $state<ProjectGoalSummary[]>([]),
    open = $state(''),
    problem = $state('');
  $effect(() => {
    void version;
    void projectApi<ProjectGoalSummary[]>('summaries')
      .then((r) => (sessions = r))
      .catch((e) => (problem = String(e)));
  });
</script>

{#each sessions.filter((s) => s.goalId === goalId) as s (s.id)}
  <div class="rounded border border-hairline p-2">
    <strong>{s.title} · {s.agent === 'claude' ? 'Claude Code' : 'Codex'}</strong>
    <p class="break-all text-xs">{s.folder} · {s.nativeId}</p>
    <p>Responsible: {staff.find((p) => p.id === s.staffId)?.name ?? 'Owner only'}</p>
    {#if s.latest}<details>
        <summary>Latest result</summary>
        <p class="whitespace-pre-wrap">{s.latest.answer}</p>
      </details>{/if}
    {#if s.pending}<p>
        {s.pending.state === 'proposed'
          ? 'Decision needed: approve the proposed assignment.'
          : s.pending.state === 'uncertain'
            ? 'Decision needed: inspect uncertain delivery in the native conversation.'
            : `Assignment ${s.pending.state}.`}
      </p>{/if}
    <button class="btn" onclick={() => (open = open === s.id ? '' : s.id)}
      >{open === s.id ? 'Close project' : 'Open original conversation'}</button
    >
    {#if open === s.id}<ProjectSessions {staff} sessionId={s.id} />{/if}
  </div>
{/each}
{#if problem}<p role="alert">{problem}</p>{/if}
