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
      const term = new Terminal({
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
    class="btn"
    onclick={() => projectApi('control', { id, view }).catch((e) => onerror(e.message))}
    >Take control of terminal</button
  >{/if}
<div class="min-h-72 h-96 w-full overflow-hidden bg-black" bind:this={host}></div>
