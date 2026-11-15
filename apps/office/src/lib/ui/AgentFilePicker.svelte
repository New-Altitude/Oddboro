<script lang="ts">
  import type { AgentSource } from '@oddboro/ledger/agents';

  let {
    multiple = false,
    disabled = false,
    onpick
  }: {
    multiple?: boolean;
    disabled?: boolean;
    onpick: (files: File[], format: AgentSource['format']) => void;
  } = $props();
  let format = $state<AgentSource['format']>('claude');
</script>

<label class="block text-xs text-muted">
  Agent file format
  <select bind:value={format} {disabled}>
    <option value="claude">Claude Code</option>
    <option value="grok">Grok Build</option>
  </select>
</label>
<input
  type="file"
  aria-label="Agent Markdown files"
  accept=".md,.markdown"
  {multiple}
  {disabled}
  onchange={(e) => {
    const files = Array.from(e.currentTarget.files ?? []);
    e.currentTarget.value = '';
    if (files.length) onpick(files, format);
  }}
/>
