<script lang="ts">
  import type { GoalProject } from '../server/goal-projects.ts';
  import { PROJECT_TOOLS as tool, PROJECT_STATUS as status } from './project-words.ts';
  import { call } from './api.ts';
  import { advanced, openFile, openProject } from './windows.svelte.ts';
  import { shownPath } from '@oddboro/ledger/work-paths';

  let { goal, version }: { goal: number; version: number } = $props();
  let project = $state<GoalProject>();
  let problem = $state('');
  let refresh = $state(0);
  $effect(() => {
    void version;
    void advanced.on;
    void refresh;
    const controller = new AbortController();
    call<GoalProject>(`/api/goals/${goal}/project`, undefined, 'GET', controller.signal)
      .then((p) => {
        project = p;
        problem = '';
      })
      .catch((e: unknown) => {
        if (!controller.signal.aborted)
          problem = e instanceof Error ? e.message : 'Could not read the project.';
      });
    return () => controller.abort();
  });
</script>

<div class="mt-3 flex flex-col gap-3 text-xs">
  {#if problem}<p class="text-coral" role="alert">{problem}</p>{/if}
  {#if project}
    <div>
      <h4 class="font-medium text-muted">Project sessions</h4>
      {#if !project.advanced}
        <p class="mt-1 text-faint">
          Native project sessions are available in Advanced mode in Setup.
        </p>
      {:else if !project.sessions.length}
        <p class="mt-1 text-faint">No connected session in this folder.</p>
      {:else}
        <ul class="mt-1 flex flex-col gap-1">
          {#each project.sessions as session (session.id)}
            <li>
              <button
                class="w-full rounded-lg bg-night/30 px-2.5 py-2 text-start hover:bg-sea/10"
                onclick={() => openProject(session.id)}
                ><span class="text-ink">{session.title}</span><span class="ms-2 text-faint"
                  >{tool[session.agent]} · {status[session.status]}</span
                ></button
              >
            </li>
          {/each}
        </ul>
      {/if}
    </div>
    <div>
      <div class="flex items-center gap-2">
        <h4 class="flex-1 font-medium text-muted">Shared work files</h4>
        <button class="text-sea hover:underline" onclick={() => refresh++}>Refresh files</button>
      </div>
      {#if project.files.length}
        <ul class="mt-1 flex max-h-48 flex-col gap-1 overflow-y-auto">
          {#each project.files as file (file.path)}
            <li>
              <button
                class="w-full rounded-lg bg-night/30 px-2.5 py-1.5 text-start hover:bg-sea/10"
                onclick={() => openFile({ staff: file.staff, path: file.path, readOnly: true })}
                ><span class="text-sea">{shownPath(file.path)}</span><span class="ms-2 text-faint"
                  >{file.work}</span
                ></button
              >
            </li>
          {/each}
        </ul>
      {:else}<p class="mt-1 text-faint">No shared work files yet.</p>{/if}
      {#if project.capped}<p class="mt-1 text-faint">
          This project has more files. Open an Odd's Storage tab to see its work.
        </p>{/if}
    </div>
  {:else if !problem}<p class="text-faint">Reading the project's files and sessions.</p>{/if}
</div>
