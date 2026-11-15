<script lang="ts">
  import { skillProblem, skillSizeProblem } from '../staff/skill.ts';
  import { call } from './api.ts';

  let { staff }: { staff: string } = $props();
  let shown = $state(false);
  let saved = $state<string | null>();
  let draft = $state<string | null>(null);
  let busy = $state(false);
  let problem = $state('');

  async function toggle() {
    shown = !shown;
    if (!shown) return;
    busy = true;
    problem = '';
    saved = undefined;
    try {
      const result = await call<{ skill: string | null }>(`/api/staff/${staff}/skill`);
      saved = draft = result.skill;
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  async function choose(input: HTMLInputElement) {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    busy = true;
    problem = '';
    try {
      if (file.name.toLowerCase() !== 'skill.md')
        throw new Error('Choose the file named SKILL.md.');
      const tooBig = skillSizeProblem(file.size);
      if (tooBig) throw new Error(tooBig);
      const text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
      const issue = skillProblem(text);
      if (issue) throw new Error(issue);
      draft = text;
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  async function save() {
    busy = true;
    problem = '';
    try {
      await call(`/api/staff/${staff}/skill`, { skill: draft, was: saved }, 'PUT');
      saved = draft;
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }
</script>

<section class="rounded-xl bg-raise p-3" aria-label="Skill">
  <button
    class="w-full text-start text-sm font-medium"
    aria-expanded={shown}
    disabled={busy}
    onclick={toggle}
  >
    {shown ? '▾' : '▸'} Skill
  </button>
  {#if shown}
    {#if problem}<p role="alert" class="mt-2 text-xs text-coral">{problem}</p>{/if}
    {#if saved !== undefined}
      <p class="my-2 text-xs text-faint">
        Choose a SKILL.md and review its instructions. This Odd uses the saved copy on its next run.
        Grant any tools or supporting files it needs in Settings.
      </p>
      <input
        aria-label="Choose SKILL.md"
        type="file"
        accept=".md"
        disabled={busy}
        onchange={(event) => choose(event.currentTarget)}
        class="w-full text-xs"
      />
      {#if saved && saved !== draft}
        <details class="mt-2 text-xs">
          <summary>Current instructions</summary>
          <pre class="max-h-48 overflow-auto whitespace-pre-wrap">{saved}</pre>
        </details>
      {/if}
      {#if draft}
        <pre
          aria-label="Skill instructions"
          class="my-2 max-h-48 overflow-auto rounded-lg bg-night/60 p-2 text-xs whitespace-pre-wrap">{draft}</pre>
      {/if}
      <div class="mt-2 flex items-center gap-2 text-xs">
        {#if saved !== draft}
          <button
            disabled={busy}
            class="rounded-lg bg-sea px-3 py-1 font-medium text-night"
            onclick={save}>{draft ? 'Save skill' : 'Confirm removal'}</button
          >
          <button
            disabled={busy}
            onclick={() => {
              draft = saved ?? null;
              problem = '';
            }}>Cancel</button
          >
        {:else if saved}
          <span class="text-faint">Saved</span>
          <button disabled={busy} onclick={() => (draft = null)}>Remove skill</button>
        {/if}
      </div>
    {/if}
  {/if}
</section>
