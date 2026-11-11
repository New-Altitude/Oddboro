<script lang="ts">
  import type { GoalsWindow, ProjectReview, ProjectSession } from '@oddboro/ledger';
  import { call } from './api.ts';
  import { projectApi } from './project-api.ts';
  let { session, version = 0 }: { session: ProjectSession; version?: number } = $props();
  let reviews = $state<ProjectReview[]>([]),
    personas = $state<{ id: string; name: string; slug: string; quiet?: string }[]>([]);
  let goals = $state<GoalsWindow['goals']>([]);
  let personaId = $state(''),
    file = $state(''),
    question = $state(''),
    recommendation = $state<Record<string, string>>({});
  let start = $state(1),
    end = $state(100),
    busy = $state(false),
    problem = $state('');
  async function load() {
    const r = await call<{ reviews: ProjectReview[]; personas: typeof personas }>(
      `/api/project-reviews?session=${session.id}`
    );
    reviews = r.reviews;
    personas = r.personas;
    goals = (await call<GoalsWindow>('/api/goals')).goals;
  }
  $effect(() => {
    void session.id;
    void version;
    void load().catch((e) => (problem = String(e)));
  });
  async function act(action: string, fields: Record<string, unknown>) {
    busy = true;
    problem = '';
    try {
      await call('/api/project-reviews', { action, ...fields });
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    } finally {
      try {
        await load();
      } catch (e) {
        problem = e instanceof Error ? e.message : String(e);
      }
      busy = false;
    }
  }
</script>

<div class="flex flex-col gap-2 border-t pt-3">
  <label
    >Existing goal
    <select
      class="field w-full"
      value={session.goalId ?? ''}
      onchange={async (e) => {
        try {
          await projectApi('goal', {
            id: session.id,
            goalId: Number(e.currentTarget.value) || null
          });
        } catch (e) {
          problem = String(e);
        }
      }}
      ><option value="">No goal</option>{#each goals as g (g.id)}<option value={g.id}
          >{g.title}</option
        >{/each}</select
    >
  </label>
  <details>
    <summary>Ask a persona to review this project</summary>
    <p>
      The selected text goes to New Altitude after you review it. The answer stays with this
      conversation.
    </p>
    <label
      >Persona<select class="field w-full" bind:value={personaId}
        ><option value="">Choose a connected persona</option>{#each personas as p (p.id)}<option
            value={p.id}
            disabled={!!p.quiet}>{p.name} · {p.slug}{p.quiet ? ' · connection needed' : ''}</option
          >{/each}</select
      ></label
    >
    <label
      >Project file<input
        class="field w-full"
        bind:value={file}
        placeholder="notes/argument.md"
      /></label
    >
    <div class="flex gap-2">
      <label
        >First line<input class="field w-full" type="number" min="1" bind:value={start} /></label
      ><label>Last line<input class="field w-full" type="number" min="1" bind:value={end} /></label>
    </div>
    <label>Question<textarea class="field w-full" rows="3" bind:value={question}></textarea></label>
    <button
      class="btn"
      disabled={busy || !session.staffId || !personaId || !file || !question}
      onclick={() =>
        act('preview', { sessionId: session.id, personaId, file, start, end, question })}
      >Preview selected context</button
    >
    {#if !session.staffId}<p>Choose the responsible Odd in the session first.</p>{/if}
  </details>
  {#each reviews as r (r.id)}
    <details>
      <summary>{r.slug} · {r.state} · {r.source.file}</summary>
      <p>{r.question}</p>
      <p>
        {r.source.omitted} characters omitted. Lines {r.source.start}–{r.source.end}. Revision {r.source.sha256.slice(
          0,
          12
        )}.
      </p>
      <details>
        <summary>Exact text sent to the persona</summary>
        <pre class="max-h-96 overflow-auto whitespace-pre-wrap text-xs">{r.message}</pre>
      </details>
      {#if r.answer}<pre class="whitespace-pre-wrap text-sm">{r.answer}</pre>{:else if r.reason}<p>
          {r.reason}
        </p>{/if}
      {#if r.state === 'ready' || r.state === 'unanswered'}<button
          class="btn"
          disabled={busy}
          onclick={() => act('ask', { id: r.id })}
          >{r.state === 'ready' ? 'Send this context to the persona' : 'Retry the persona'}</button
        >{/if}
      {#if r.state === 'asking'}<p>
          The consultation is running or was interrupted before its result was saved. It will not
          repeat automatically. Inspect the persona’s history before starting another.
        </p>{/if}
      {#if r.state === 'answered' && !r.requestId}<label
          >Separate office recommendation (optional)<textarea
            class="field w-full"
            bind:value={recommendation[r.id]}></textarea></label
        ><button
          class="btn"
          disabled={busy}
          onclick={() => act('return', { id: r.id, recommendation: recommendation[r.id] ?? '' })}
          >Return answer to this conversation</button
        >{/if}
      {#if r.requestId}<p>
          The return assignment is in this session’s history. Draft access waits for your approval
          there.
        </p>{/if}
      {#if r.state !== 'cancelled'}<button
          class="btn"
          disabled={busy}
          onclick={() => act('cancel', { id: r.id })}>Withdraw review</button
        >{/if}
    </details>
  {/each}
  {#if problem}<p class="text-ember" role="alert">{problem}</p>{/if}
</div>
