<script lang="ts">
  import { AgentTools } from './agent-tools.svelte.ts';
  import OfficeTools from './OfficeTools.svelte';
  import AdvancedSection from './AdvancedSection.svelte';
  let { ready = $bindable(false) }: { ready?: boolean } = $props();
  const tools = new AgentTools();
  let claudeReady = $state(false);
  const picked = $derived(tools.tools.find((t) => t.id === tools.office));
  $effect(() => {
    ready =
      !!picked?.installed &&
      !picked.tooOld &&
      (tools.office === 'claude' ? claudeReady : !!picked.signIn?.signedIn);
  });
</script>

<OfficeTools {tools} onclaudeready={(v) => (claudeReady = v)} />
<AdvancedSection />
