<script module lang="ts">
  /**
   * Whether this terminal asks the session to draw again for it when the owner
   * comes back to it. Claude Code's background service draws a session for the
   * window that sized it last, so another window of a different width shows it
   * garbled. Oddboro cannot see another window take the size, so the terminal or
   * the browser window losing focus is the sign. Off, the terminal sends its
   * size only when that changes. It can go once Claude Code draws each window
   * at its own size.
   */
  export const REDRAW_ON_RETURN = true;
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import { projectApi } from './project-api.ts';
  import '@xterm/xterm/css/xterm.css';
  // The native terminal, filling the space its parent gives it and refitting
  // once it settles. The parent shows Take control, for this view's ID.
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
        if (writable) fitAndSend();
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
      // A post that fails after this view closed has no one to tell: it was
      // the view's own reply, a focus report or a size, to a session being let go.
      const report = (e: Error) => {
        if (!disposed) onerror(e.message);
      };
      let chain = Promise.resolve();
      const input = term.onData((data) => {
        chain = chain
          .then(async () => {
            if (!disposed && writable) await projectApi('keys', { id, view, data });
          })
          .catch(report);
      });
      // The terminal refits only once its box settles, in the same step as it
      // tells the session its size, and only when that differs. xterm drops
      // cells past a narrower width when it is resized partway through a slide,
      // and only a new size makes the program draw them again, so a box sliding
      // back to the size already sent must never resize it on the way.
      let sent = '',
        /** Whether another window may have sized the session since this one last did. */
        stale = false,
        settle: ReturnType<typeof setTimeout> | undefined;
      /** Sends this terminal's size. A new size redraws the session for it, so it clears `stale`. */
      const post = (redraw?: true) => {
        sent = `${term.cols}x${term.rows}`;
        stale = false;
        void projectApi('size', { id, view, cols: term.cols, rows: term.rows, redraw }).catch(
          report
        );
      };
      const send = () => {
        if (writable && `${term.cols}x${term.rows}` !== sent) post();
      };
      /** The same size, with `redraw`: the server nudges it, since an equal size redraws nothing. */
      const redraw = () => {
        if (writable && stale) post(true);
      };
      const lost = () => (stale = true);
      /** A hidden pane leaves the box with no size: the terminal keeps its own until it shows. */
      const sized = () => host.clientWidth > 0 && host.clientHeight > 0;
      const fitAndSend = () => {
        if (!sized()) return;
        fit.fit();
        send();
      };
      const resize = () => {
        clearTimeout(settle);
        settle = setTimeout(fitAndSend, 150);
      };
      const observer = new ResizeObserver(resize);
      observer.observe(host);
      if (REDRAW_ON_RETURN) {
        host.addEventListener('focusout', lost);
        window.addEventListener('blur', lost);
        host.addEventListener('focusin', redraw);
        // In the capture phase: xterm stops every key it sends to the terminal
        // from going further, so a listener waiting for it to bubble never hears one.
        host.addEventListener('keydown', redraw, { capture: true });
      }
      // The first fit sends nothing. The stream's first write comes after it, so
      // it lands at this size, and a size sent before the control event says
      // this view takes the typing could be refused. That event sends it.
      if (sized()) fit.fit();
      term.focus();
      cleanup = () => {
        window.removeEventListener('blur', lost);
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
