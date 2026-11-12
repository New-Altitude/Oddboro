<script lang="ts">
  import { onMount } from 'svelte';
  import { projectApi } from './project-api.ts';
  import '@xterm/xterm/css/xterm.css';
  // The native terminal, filling the space its parent gives it and refitting
  // as that changes. The parent shows Take control, for this view's ID.
  let {
    id,
    view,
    writable = $bindable(false),
    onerror,
    onstream
  }: {
    onstream: (stream: EventSource, id: string) => void;
    id: string;
    /** This window's terminal view: one view at a time takes the typing. */
    view: string;
    /** Whether this view takes the typing now. */
    writable?: boolean;
    onerror: (text: string) => void;
  } = $props();
  let host: HTMLDivElement;

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
        // Another view may have sized the terminal while this one watched.
        sent = '';
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
      // The terminal refits at once as its box changes, and tells the session
      // its new size once the box settles, and only when it differs, so a
      // panel sliding wider or narrower sends one size, not one per frame.
      let sent = '',
        settle: ReturnType<typeof setTimeout> | undefined;
      const send = () => {
        const size = `${term.cols}x${term.rows}`;
        if (!writable || size === sent) return;
        sent = size;
        void projectApi('size', { id, view, cols: term.cols, rows: term.rows }).catch((e) =>
          onerror(e.message)
        );
      };
      const resize = () => {
        if (!host.clientWidth || !host.clientHeight) return;
        fit.fit();
        clearTimeout(settle);
        settle = setTimeout(send, 150);
      };
      const observer = new ResizeObserver(resize);
      observer.observe(host);
      resize();
      term.focus();
      cleanup = () => {
        clearTimeout(settle);
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

<div class="min-h-0 w-full flex-1 overflow-hidden bg-night p-1" bind:this={host}></div>
