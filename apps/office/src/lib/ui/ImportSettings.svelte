<script lang="ts">
  import { OFFICE_TOOLS, RIDES_WITH, hasTool } from '@oddboro/ledger/tools';
  import type { AgentSettings } from '../staff/agent-file.ts';

  let { settings, granted }: { settings: AgentSettings; granted: string[] } = $props();

  function status(name: string) {
    const id = name.replace(/^mcp__office__/, '');
    const office = Object.hasOwn(RIDES_WITH, id) ? RIDES_WITH[id as keyof typeof RIDES_WITH] : id;
    if (!OFFICE_TOOLS.some((tool) => tool.id === office)) return 'Check the provider or service';
    return hasTool(granted, office) ? 'Granted in this office' : 'Needs an office grant';
  }
</script>

{#if settings.tools || settings.skills?.length || settings.excluded?.length || settings.skipped.length}
  <div
    class="max-h-44 shrink-0 space-y-1 overflow-y-auto border-b border-hairline p-3 text-xs"
    aria-label="Settings in the agent file"
    role="group"
  >
    {#if settings.tools?.length}
      <p class="font-medium">Tools named in the file</p>
      <ul>
        {#each settings.tools as tool (tool)}
          <li>{tool} · {status(tool)}</li>
        {/each}
      </ul>
    {:else if settings.tools}
      <p>The file lists no allowed tools.</p>
    {/if}
    {#if settings.excluded?.length}
      <p>
        The file excludes these tools: {settings.excluded.join(', ')}. Review the Odd's access
        before running it.
      </p>
    {/if}
    {#if settings.skills?.length}
      <p>
        Skills named in the file: {settings.skills.join(', ')}. Attach a skill on the Odd's info
        page.
      </p>
    {/if}
    {#if settings.skipped.length}
      <p>Settings left in the agent file: {settings.skipped.join(', ')}.</p>
    {/if}
    {#if settings.tools || settings.excluded?.length}
      <p class="text-muted">The office uses the access you give this Odd.</p>
    {/if}
  </div>
{/if}
