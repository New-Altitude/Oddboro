<script lang="ts">
  import AccountSignIn from '../AccountSignIn.svelte';
  import { account } from '../account.svelte.ts';

  // New Altitude: an optional sign-in to the owner's account. Skip leaves
  // nothing behind; Next shows once they are signed in.
  type Props = { onnext: () => void; onback: () => void };
  let { onnext, onback }: Props = $props();
</script>

<div class="text-sm">
  <AccountSignIn />
</div>

<div class="mt-4 flex items-center gap-3">
  <button class="btn ghost" onclick={onback}>Back</button>
  <span class="flex-1"></span>
  {#if account.status.state === 'in'}
    <button class="btn primary" onclick={onnext}>Next</button>
  {:else}
    <button class="btn" onclick={onnext}>Skip</button>
  {/if}
</div>
