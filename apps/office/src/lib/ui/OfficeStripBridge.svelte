<script lang="ts">
  // Shares only the floor's activity words and receives a strip click. All
  // work and waiting data still comes from the server's existing live stream.
  import { onMount } from 'svelte';
  import { FLOOR_CHANNEL, officeLink, type OfficeLink } from './office-link.ts';
  import type { FloorActivity } from './office-status.ts';

  let {
    activities,
    onopen,
    onvisibility
  }: {
    activities: Record<string, FloorActivity>;
    onopen: (link: OfficeLink) => void;
    onvisibility: (visible: boolean) => void;
  } = $props();
  let channel: BroadcastChannel | undefined;
  let sent = '';
  $effect(() => {
    const next = JSON.stringify(activities);
    if (channel && next !== sent) {
      sent = next;
      channel.postMessage({ type: 'activity', rows: activities });
    }
  });
  onMount(() => {
    function open(event: Event) {
      const link = officeLink(event instanceof CustomEvent ? event.detail : undefined);
      if (link) onopen(link);
    }
    const hide = () => onvisibility(false);
    const show = () => onvisibility(true);
    window.addEventListener('oddboro:open', open);
    window.addEventListener('oddboro:hidden', hide);
    window.addEventListener('oddboro:shown', show);
    const query = new URLSearchParams(location.search);
    const link = officeLink(query.get('desk') === '1' ? { desk: true } : { odd: query.get('odd') });
    if (link) {
      onopen(link);
      const clean = new URL(location.href);
      clean.searchParams.delete('desk');
      clean.searchParams.delete('odd');
      history.replaceState(history.state, '', clean);
    }
    channel = new BroadcastChannel(FLOOR_CHANNEL);
    channel.onmessage = (event) => {
      if (event.data?.type === 'read') channel?.postMessage({ type: 'activity', rows: activities });
    };
    return () => {
      window.removeEventListener('oddboro:open', open);
      window.removeEventListener('oddboro:hidden', hide);
      window.removeEventListener('oddboro:shown', show);
      channel?.close();
      channel = undefined;
    };
  });
</script>
