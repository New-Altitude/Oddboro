<script lang="ts">
  import { onMount } from 'svelte';
  import { projectApi } from './project-api.ts';
  import '@xterm/xterm/css/xterm.css';
  let {
    id,
    onerror,
    onstream
  }: {
    onstream: (stream: EventSource, id: string) => void;
    id: string;
    onerror: (text: string) => void;
  } = $props();
  let host: HTMLDivElement;
  const view = crypto.randomUUID();
  let writable = $state(false);

  onMount(() => {
    let disposed = false,
      cleanup = () => {};
    void (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit')
      ]);
      if (disposed) return;
      // The terminal's own colours come from the office tokens.
      const token = (name: string) =>
        getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      const term = new Terminal({
        theme: {
          background: token('--color-night'),
          foreground: token('--color-ink'),
          cursor: token('--color-ink'),
          selectionBackground: token('--color-sea-deep')
        },
        cursorBlink: false,
        scrollback: 2000,
        allowProposedApi: false,
        disableStdin: true
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(host);
      term.parser.registerOscHandler(52, () => true);
      const stream = new EventSource(
        '/api/project-sessions/' + id + '/events?terminal=1&view=' + view
      );
      onstream(stream, id);
      stream.addEventListener('screen', (e) => {
        term.reset();
        term.write(JSON.parse(e.data));
      });
      stream.addEventListener('control', (e) => {
        writable = JSON.parse(e.data);
        term.options.disableStdin = !writable;
        if (writable) resize();
      });
      stream.addEventListener('output', (e) => term.write(JSON.parse(e.data)));
      stream.addEventListener('end', () => {
        term.options.disableStdin = true;
        stream.close();
      });
      stream.onerror = () => {
        writable = false;
        term.options.disableStdin = true;
      };
      let chain = Promise.resolve();
      const input = term.onData((data) => {
        chain = chain
          .then(async () => {
            if (!disposed && writable) await projectApi('keys', { id, view, data });
          })
          .catch((e) => onerror(e.message));
      });
      const resize = () => {
        if (!host.clientWidth || !host.clientHeight) return;
        fit.fit();
        if (!writable) return;
        void projectApi('size', { id, view, cols: term.cols, rows: term.rows }).catch((e) =>
          onerror(e.message)
        );
      };
      const observer = new ResizeObserver(resize);
      observer.observe(host);
      resize();
      term.focus();
      cleanup = () => {
        stream.close();
        observer.disconnect();
        input.dispose();
        term.dispose();
      };
    })().catch((e) => onerror(e.message));
    return () => {
      disposed = true;
      cleanup();
    };
  });
</script>

{#if !writable}<button
    class="mb-2 rounded-lg bg-raise px-2.5 py-1 text-xs hover:bg-sea/25"
    onclick={() => projectApi('control', { id, view }).catch((e) => onerror(e.message))}
    >Take control of terminal</button
  >{/if}
<div class="h-96 min-h-72 w-full overflow-hidden rounded-lg bg-night p-1" bind:this={host}></div>
