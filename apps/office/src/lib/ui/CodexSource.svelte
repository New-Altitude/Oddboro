<script lang="ts">
  import type { ChatSource } from '#lib/staff/chat-input.ts';
  let {
    staff,
    turn,
    text,
    source,
    files
  }: {
    staff: string;
    turn: string;
    text: string;
    source: ChatSource;
    files: { name: string }[];
  } = $props();
  let reading = $state<number>();
  let contents = $state('');
  let problem = $state('');
  const url = (i: number) => '/api/staff/' + staff + '/chat/' + turn + '/' + i;

  const picture = (name: string) => /\.(png|jpe?g|webp)$/i.test(name);

  async function read(i: number) {
    reading = i;
    contents = '';
    problem = '';
    if (picture(files[i].name)) return;
    try {
      const res = await fetch(url(i));
      if (!res.ok) throw Error('Could not open this file.');
      const text = await res.text();
      if (reading === i) contents = text;
    } catch {
      if (reading === i) problem = 'Could not open this file.';
    }
  }
</script>

<details class="whitespace-normal">
  <summary class="cursor-pointer font-medium">{text.split('\n')[0]}</summary>
  <p class="my-2 whitespace-pre-line">{text.split('\n').slice(1).join('\n')}</p>
  <p class="text-xs text-muted">Codex {source.id} · revision {source.revision?.slice(0, 12)}</p>
  {#each files as file, i (i)}
    <button class="block text-start text-sea underline" onclick={() => read(i)}>{file.name}</button>
  {/each}
  {#if reading !== undefined}
    {#if problem}
      <p class="text-coral" role="alert">{problem}</p>
    {:else if picture(files[reading].name)}
      <img
        class="mt-2 max-h-80 max-w-full object-contain"
        src={url(reading)}
        alt={files[reading].name}
        onerror={() => (problem = 'Could not open this picture.')}
      />
    {:else}
      <pre
        class="mt-2 max-h-80 overflow-auto whitespace-pre-wrap"
        aria-label={files[reading].name}>{contents}</pre>
    {/if}
    <a class="text-xs text-sea underline" href={url(reading)} download={files[reading].name}
      >Download original</a
    >
  {/if}
</details>
