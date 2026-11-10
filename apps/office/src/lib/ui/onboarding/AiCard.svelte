<script lang="ts">
  import { drawsLooks } from '@oddboro/ledger/agents';
  import type { AgentTools } from '../agent-tools.svelte.ts';
  import { officeAiReady } from '../magpie-ui.ts';
  import OfficeTools from '../OfficeTools.svelte';

  // Your AI chooses the office default for its own runs and new Odds. Magpie
  // uses included Pi for new setup and keeps an explicit compatible runner.
  // Next needs the real runner plus a ready gateway route, or the selected
  // direct tool's sign-in. The server supplies current platform offers; file
  // access and outside-write approvals stay with the shared run layer.
  type Props = {
    tools: AgentTools;
    onnext: () => void;
    onback: () => void;
    /**
     * Whether the office can design offices (not on Claude's Sonnet), and
     * whether it draws looks (`drawsLooks`: Claude Code on Opus, Codex on Sol).
     */
    ondraw: (can: boolean, looks: boolean) => void;
  };
  let { tools, onnext, onback, ondraw }: Props = $props();

  let claudeReady = $state(false);
  let model = $state<'opus' | 'sonnet'>('opus');
  const picked = $derived(tools.tools.find((t) => t.id === tools.selectedOffice));
  const ready = $derived(
    officeAiReady({
      throughMagpie: tools.magpieSelected,
      installed: !!picked?.installed,
      tooOld: !!picked?.tooOld,
      gatewayReady: !!picked?.magpieReady,
      directReady: tools.office === 'claude' ? claudeReady : !!picked?.signIn?.signedIn
    })
  );
  $effect(() =>
    ondraw(
      !tools.magpieSelected && (tools.office !== 'claude' || model !== 'sonnet'),
      !tools.magpieSelected &&
        (tools.office === 'claude' ? drawsLooks('claude', model) : tools.drawsLooks)
    )
  );
</script>

<p class="text-lg font-semibold">What your office runs on.</p>
<p class="text-sm text-muted">
  Choose a direct tool or Magpie for your models. Your Office Manager and new Odds use this choice;
  each Odd can change later.
</p>

<div class="mt-3">
  <OfficeTools {tools} onmodel={(m) => (model = m)} onclaudeready={(r) => (claudeReady = r)} />
</div>

<div class="mt-4 flex items-center gap-3">
  <button class="btn ghost" onclick={onback}>Back</button>
  <span class="flex-1 text-end text-xs text-muted">
    {#if tools.loaded && !ready && picked}
      {!picked.installed
        ? picked.id === 'pi'
          ? 'The included Pi runner is missing. Rebuild or reinstall Oddboro.'
          : `Install ${picked.name} to go on.`
        : picked.tooOld
          ? picked.id === 'pi'
            ? 'Rebuild or reinstall Oddboro to use the included Pi version.'
            : `Update ${picked.name} to go on.`
          : tools.magpieSelected
            ? 'Finish Magpie setup and choose a ready model or group to go on.'
            : `Sign in to ${picked.name} to go on.`}
    {/if}
  </span>
  <button class="btn primary" disabled={!ready} onclick={onnext}>Next</button>
</div>
