<script lang="ts">
  import DiagnosticsAsk from '../DiagnosticsAsk.svelte';

  // Help fix Oddboro: whether the office may send error and trace reports.
  // Next works without an answer; the Desk then asks once the office is open.
  type Props = { onnext: () => void; onback: () => void };
  let { onnext, onback }: Props = $props();
</script>

<DiagnosticsAsk />

<div class="mt-4 flex items-center gap-3">
  <button class="btn ghost" onclick={onback}>Back</button>
  <span class="flex-1"></span>
  <button class="btn primary" onclick={onnext}>Next</button>
</div>
