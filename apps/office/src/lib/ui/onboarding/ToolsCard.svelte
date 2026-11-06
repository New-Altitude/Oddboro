<script lang="ts">
  import type { AgentTools } from '../agent-tools.svelte.ts';
  import { signInRows } from '../tool-action.ts';
  import ToolRows from '../ToolRows.svelte';

  // Other AI tools, after Your Claude: the rows the Setup window shows too
  // (ToolRows), with the card's Back and Next. Optional: Claude Code stays the
  // default, so Next reads Skip until a tool is signed in.
  type Props = { tools: AgentTools; onnext: () => void; onback: () => void };
  let { tools, onnext, onback }: Props = $props();
</script>

<p class="text-lg font-semibold">Odds can also run on these.</p>
<p class="text-sm text-muted">Optional. Claude Code stays the default.</p>

<div class="mt-3"><ToolRows {tools} /></div>

<div class="mt-4 flex items-center gap-3">
  <button class="btn ghost" onclick={onback}>Back</button>
  <span class="flex-1"></span>
  <button class="btn primary" onclick={onnext}
    >{signInRows(tools.tools).some((r) => r.signIn.signedIn) ? 'Next' : 'Skip'}</button
  >
</div>
