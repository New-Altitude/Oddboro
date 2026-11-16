<script lang="ts">
  // How to give an Odd your Open Brain. Building the Open Brain stays on its
  // own GitHub guide; this page starts once the owner has one, and walks the
  // office's own steps: the Services tab, Takes a key with x-brain-key, then
  // the connect task on the desk. Keep each label in step with the office
  // (AccessTab.svelte, DeskTask.svelte, connectSteps in the ledger).
  import Guide from '#lib/components/Guide.svelte';
  import Meta from '#lib/components/Meta.svelte';
  import type { Part, Trouble } from '#lib/guides/types.ts';
  import { SITE } from '#lib/site.ts';

  const REPO = 'https://github.com/NateBJones-Projects/OB1';
  const SETUP = `${REPO}/blob/main/docs/01-getting-started.md`;

  const PARTS: Part[] = [
    {
      title: 'Add Open Brain to an Odd',
      steps: [
        {
          text: 'Click the Odd on the strip of Odds at the edge of the screen.',
          detail: 'Its panel opens.'
        },
        { text: 'Click Settings.' },
        { text: 'Click Services.' },
        { text: 'Click + Add service.' },
        {
          text: 'Paste your MCP Server URL into the search box.',
          detail:
            'Use the address that ends in /open-brain-mcp, with no ?key= after it. The key goes in later, somewhere safer.',
          example: 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/open-brain-mcp'
        },
        {
          text: 'Click Connect YOUR_PROJECT_REF.supabase.co, just under the box.'
        },
        { text: 'Click Takes a key.' },
        {
          text: 'In “The header the key goes in”, delete Authorization and type this.',
          detail: 'All lowercase, with the dashes.',
          copy: 'x-brain-key'
        },
        {
          text: 'Pick how far the Odd can go.',
          detail:
            'Read only lets it search your thoughts. Read and write also lets it save new ones. Read and write is greyed out until the Odd’s Permission level, on the Model tab, is Acts on its own.'
        },
        {
          text: 'Click Grant.',
          detail: 'You see: “A task with the steps to connect … is on your desk.”'
        }
      ]
    },
    {
      title: 'Connect it from your desk',
      steps: [
        { text: 'Click Desk.' },
        { text: 'Open the task named Connect YOUR_PROJECT_REF.supabase.co for your Odd.' },
        {
          text: 'Paste your MCP Access Key into the box.',
          detail:
            'It is the 64-character key from your credential tracker. It goes in this computer’s password store, never the office’s database.'
        },
        { text: 'Click Save.' },
        {
          text: 'Click Connect.',
          detail: 'The office reaches your Open Brain and lists its tools.'
        },
        {
          text: 'Click Confirm.',
          detail:
            'The list marks the tools Read only reaches: the ones Open Brain marks as only reading. capture_thought, the one that saves, needs Read and write.'
        }
      ]
    }
  ];

  const TROUBLE: Trouble[] = [
    {
      q: 'Connect fails, or says 401.',
      a: 'The header or the key is off. The header must be x-brain-key, exactly. The key must match your MCP Access Key, with no space before or after it. Click Revoke on the service and start again.'
    },
    {
      q: 'I pasted the address with ?key= on the end.',
      a: 'Click Revoke on the service, then add it again with the address that ends in /open-brain-mcp. That keeps your key in the password store instead of in the address.'
    },
    {
      q: 'Read and write is greyed out.',
      a: 'On the Odd’s Model tab, set Permission level to Acts on its own first. Read only works at any level.'
    },
    {
      q: 'I want a second Odd to use it too.',
      a: 'On that Odd, click Settings, then Services, then + Add service. Pick YOUR_PROJECT_REF.supabase.co from the list, where it shows “in the office”. Pick a level and click Grant. The office already has the key, so there is nothing to paste and nothing on your desk.'
    }
  ];
</script>

<Meta
  title="Connect Open Brain · {SITE.name}"
  description="Give an Odd your Open Brain, so it can search your thoughts and, if you let it, save new ones. Step by step, in about two minutes."
  path="/connectors/open-brain/"
/>

<Guide
  title="Open Brain"
  lede="Give an Odd your Open Brain, and it can search everything you have saved there. Let it, and it saves new thoughts too. It takes about two minutes."
  parts={PARTS}
  trouble={TROUBLE}
>
  {#snippet intro()}
    <h2 class="font-pixel text-ink text-2xl">What Open Brain is</h2>
    <p class="text-muted mt-3 leading-relaxed">
      Open Brain is a memory you own. It is a database of your thoughts, notes and ideas that any AI
      tool can search and add to, so they all remember the same things about you. You run it
      yourself, on your own Supabase project. Nate B. Jones made it, and it lives on GitHub.
    </p>
    <a
      href={REPO}
      target="_blank"
      rel="noopener noreferrer"
      class="text-sea mt-4 inline-flex items-center gap-1.5 font-medium hover:underline"
      >Open Brain on GitHub <span aria-hidden="true">↗</span></a
    >
  {/snippet}
  {#snippet before()}
    <ol class="text-muted mt-4 flex list-decimal flex-col gap-3 ps-5 leading-relaxed">
      <li>
        Build your Open Brain with
        <a
          href={SETUP}
          target="_blank"
          rel="noopener noreferrer"
          class="text-sea font-medium hover:underline">its setup guide</a
        >. Come back when it says you are done.
      </li>
      <li>
        Open your credential tracker from that guide. You need two things from it:
        <ul class="mt-2 flex list-disc flex-col gap-1 ps-5">
          <li>
            <span class="text-ink font-medium">MCP Server URL</span>, the address of your brain.
          </li>
          <li>
            <span class="text-ink font-medium">MCP Access Key</span>, the key that lets you in.
          </li>
        </ul>
      </li>
      <li>Open {SITE.name}, with the Odd you want to give it to already hired.</li>
    </ol>
  {/snippet}
  {#snippet after()}
    <h2 class="font-pixel text-ink text-2xl">Try it</h2>
    <p class="text-muted mt-3 leading-relaxed">
      Open a chat with the Odd and ask, “What have I saved about this week?” It searches your Open
      Brain and answers from it.
    </p>
    <p class="text-muted mt-6 text-sm leading-relaxed">
      For problems with Open Brain itself, see
      <a
        href={SETUP}
        target="_blank"
        rel="noopener noreferrer"
        class="text-sea font-medium hover:underline">its setup guide</a
      >.
    </p>
  {/snippet}
</Guide>
