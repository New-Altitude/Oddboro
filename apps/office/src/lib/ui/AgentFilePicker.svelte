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
    <option value="hermes">Hermes profile</option>
  </select>
</label>
{#if format === 'hermes'}
  <p class="text-xs text-muted">
    Choose a .tar.gz from hermes profile export. The office brings in the profile name, description
    and SOUL.md. Skills, connections, memories and schedules stay in the archive. Choose an office
    tool to run the Odd.
  </p>
{/if}
<input
  type="file"
  aria-label={format === 'hermes' ? 'Hermes profile archives' : 'Agent Markdown files'}
  accept={format === 'hermes' ? '.tar.gz,.tgz' : '.md,.markdown'}
  {multiple}
  {disabled}
  onchange={(e) => {
    const files = Array.from(e.currentTarget.files ?? []);
    e.currentTarget.value = '';
    if (files.length) onpick(files, format);
  }}
/>
