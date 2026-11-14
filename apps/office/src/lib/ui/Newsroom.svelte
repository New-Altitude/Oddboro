<script lang="ts">
  import { untrack } from 'svelte';
  import { connect, personas } from './persona-offers.svelte.ts';
  import { account } from './account.svelte.ts';
  import { chatAbout } from './chat-about.svelte.ts';
  import {
    channelNames,
    channels,
    publicationGroups,
    todayStories,
    topicNames,
    topics,
    type Command,
    type NewsroomView,
    type Preferences,
    type Story
  } from '../newsroom/edition.ts';
  let { version, active, onconnect }: { version: number; active: boolean; onconnect: () => void } =
    $props();
  let view = $state<NewsroomView>();
  let pending = $state(false);
  let problem = $state('');
  let since = $state<string>();
  let tab = $state<'Today' | 'Wire' | 'From the publisher' | 'Saved'>('Today');
  let tune = $state(false);
  let seq = 0;
  async function request(action?: Command) {
    const n = ++seq;
    const reply = await fetch(
      '/api/newsroom',
      action
        ? {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(action)
          }
        : {}
    );
    const result = await reply.json();
    if (!reply.ok) throw new Error(result.message || 'The newsroom did not answer.');
    if (seq === n) view = result as NewsroomView;
    return result as NewsroomView;
  }
  async function act(c: Command) {
    pending = true;
    problem = '';
    try {
      await request(c);
      if (c.op === 'remove') {
        since = undefined;
        tab = 'Today';
        tune = false;
      }
    } catch (e) {
      problem = e instanceof Error ? e.message : 'Try again.';
    } finally {
      pending = false;
    }
  }
  let visited = false;
  $effect(() => {
    version;
    if (!active) {
      visited = false;
      return;
    }
    const visit = !visited;
    visited = true;
    untrack(() => {
      void request()
        .then(async (result) => {
          if (visit && active && result.edition) {
            since = result.lastVisit;
            await request({ op: 'visit' });
          }
        })
        .catch(() => (problem = 'Could not read the newsroom on this computer.'));
    });
  });
  const e = $derived(view?.edition);
  const posts = $derived(e && view ? publicationGroups(e, view.prefs) : []);
  const stories = $derived.by(() => {
    if (!e || !view) return [];
    if (tab === 'Saved') return view.kept.filter((s) => view?.marks[s.id]?.saved);
    if (tab === 'Today') return todayStories(e, view.prefs, view.marks);
    return [...e.stories].sort((a, b) => Date.parse(b.changed) - Date.parse(a.changed));
  });
  const catchup = $derived(
    e && since
      ? e.stories.filter(
          (s) => Date.parse(s.changed) > Date.parse(since!) && !view?.marks[s.id]?.muted
        )
      : []
  );
  function prefer(p: Partial<Preferences>) {
    if (view) void act({ op: 'preferences', prefs: { ...view.prefs, ...p } });
  }
  function discuss(s: Story) {
    if (view?.staff)
      chatAbout(view.staff, 'What should I take away from “' + s.title + '”? ' + s.sources[0].url);
    else if (account.status.state !== 'in') onconnect();
    else if (e) void connect(e.persona);
  }
  const stamp = (iso: string) => new Date(iso).toLocaleString();
</script>

<section class="h-full overflow-y-auto p-4 text-sm text-ink" aria-label="Newsroom">
  {#if problem}<p role="alert" class="mb-3 text-coral">{problem}</p>{/if}
  {#if !view}<p>Loading newsroom...</p>
  {:else if !e}
    <h2 class="text-lg font-semibold">AI Newsroom</h2>
    <p class="my-3">
      Get a sourced AI brief each morning, follow the news as it develops, and read the publisher’s
      latest work.
    </p>
    <button disabled={pending} onclick={() => act({ op: 'add' })}
      >{pending ? 'Opening the edition...' : 'Add Nate’s AI Newsroom'}</button
    >
  {:else}
    <h2 class="text-lg font-semibold">{e.name}</h2>
    <p>{e.day} · Edition updated {stamp(e.updated)}</p>
    {#if view.paused}<p>Delivery paused</p>{/if}
    {#if view.problem}<p role="status">{view.problem}</p>{/if}
    {#if Date.now() - Date.parse(e.checked) > 2 * 3600_000}<p role="status">
        Showing the last published edition. Source checks are overdue.
      </p>{/if}
    {#if personas[e.persona]?.problem}<p role="alert">{personas[e.persona].problem}</p>{/if}
    {#if personas[e.persona]?.waiting}<a
        href={personas[e.persona].waiting}
        target="_blank"
        rel="noreferrer">Finish connecting the AI persona</a
      >{/if}
    <nav class="my-3 flex flex-wrap gap-2" aria-label="Newsroom sections">
      {#each ['Today', 'Wire', 'From the publisher', 'Saved'] as item}
        <button aria-pressed={tab === item} onclick={() => (tab = item as typeof tab)}
          >{item === 'From the publisher' ? 'From ' + (e.byline || 'the publisher') : item}</button
        >
      {/each}
    </nav>
    {#if tab === 'Today' && catchup.length}
      <details>
        <summary>Since your last visit ({catchup.length})</summary
        >{#each catchup.slice(0, 5) as s}<p>{s.title}</p>{/each}
      </details>
    {/if}
    {#if tab === 'Today' && view.notices.length}
      <details>
        <summary>Newsroom updates ({view.notices.length})</summary
        >{#each view.notices.slice(0, 12) as n}<p>{stamp(n.at)} · {n.text}</p>{/each}
      </details>
    {/if}
    {#if tab !== 'From the publisher'}
      {#each stories as s (s.id)}
        <article class="my-4 border-t border-hairline pt-3">
          <small
            >{topicNames[s.topic]} · {stamp(s.changed)}{s.withdrawn
              ? ' · Withdrawn'
              : s.alert === 'correction'
                ? ' · Correction'
                : ''}</small
          >
          <h3 class="my-1 font-semibold">{s.title}</h3>
          <p>{s.summary}</p>
          {#if s.consequence}<p class="mt-1">{s.consequence}</p>{/if}
          {#if s.spread}<p class="mt-1">{s.spread}</p>{/if}
          {#if !s.withdrawn}{#each s.sources as source}<a
                href={source.url}
                target="_blank"
                rel="noreferrer">{source.label}</a
              >{' '}{/each}{/if}
          {#each s.history ?? [] as update}<p>
              <small>{stamp(update.at)} · {update.text}</small>
            </p>{/each}
          {#if view.prefs.creator === 'brief'}
            {#each posts.filter((g) => g.some((p) => p.storyId === s.id)) as g}<p>
                Publisher’s analysis · <a href={g[0].url} target="_blank" rel="noreferrer"
                  >{g[0].title}</a
                >
              </p>{/each}
          {/if}
          <div class="mt-2 flex flex-wrap gap-2">
            {#each [['saved', 'Save'], ['followed', 'Follow'], ['muted', 'Mute']] as pair}
              {@const key = pair[0] as 'saved' | 'followed' | 'muted'}
              <button
                disabled={pending}
                aria-pressed={!!view.marks[s.id]?.[key]}
                onclick={() =>
                  act({ op: 'mark', id: s.id, mark: key, on: !view?.marks[s.id]?.[key] })}
                >{pair[1]}</button
              >
            {/each}
            {#if !s.withdrawn}<button onclick={() => discuss(s)}
                >{view.staff
                  ? 'Discuss with the AI persona'
                  : 'Connect the publisher’s AI persona'}</button
              >{/if}
          </div>
        </article>
      {:else}<p>
          {tab === 'Saved' ? 'Saved stories appear here.' : 'No stories in this section yet.'}
        </p>{/each}
    {/if}
    {#if tab === 'From the publisher' || (tab === 'Today' && view.prefs.creator === 'brief' && posts.length)}
      {#if tab === 'Today'}<h3 class="mt-5 font-semibold">
          From {e.byline || 'the publisher'}
        </h3>{/if}
      {#each tab === 'Today' ? posts.slice(0, 3) : posts as group}
        <article class="my-2">
          <h3>{group[0].title}</h3>
          <small>{stamp(group[0].published)}</small>
          {#each group as post}<a href={post.url} target="_blank" rel="noreferrer"
              >{channelNames[post.channel]}</a
            >{' '}{/each}
        </article>
      {:else}<p>No publications in your selected channels.</p>{/each}
    {/if}
    <footer class="my-5 border-t border-hairline pt-3">
      <p>Sources checked through {stamp(e.checked)}</p>
      {#each e.coverage as note}<p>{note}</p>{/each}
    </footer>
    <div class="flex flex-wrap gap-2">
      <button onclick={() => (tune = !tune)} aria-expanded={tune}>Tune my newsroom</button><button
        disabled={pending}
        onclick={() => act({ op: 'refresh' })}>Check again</button
      >
    </div>
    {#if tune}
      <fieldset disabled={pending} class="mt-3 grid gap-2">
        <legend>Reading and delivery</legend>
        <label
          >Lead with <select
            aria-label="Lead with"
            value={view.prefs.topic}
            onchange={(ev) => prefer({ topic: ev.currentTarget.value as Preferences['topic'] })}
            ><option value="balanced">Balanced</option>{#each topics as t}<option value={t}
                >{topicNames[t]}</option
              >{/each}</select
          ></label
        >
        <label
          >Delivery <select
            aria-label="Delivery"
            value={view.prefs.delivery}
            onchange={(ev) =>
              prefer({ delivery: ev.currentTarget.value as Preferences['delivery'] })}
            ><option value="read">On demand</option><option value="brief">Morning brief</option
            ><option value="alerts">Morning brief and major alerts</option></select
          ></label
        >
        {#each [['briefTime', 'Brief time'], ['quietStart', 'Quiet hours start'], ['quietEnd', 'Quiet hours end']] as pair}
          {@const key = pair[0] as 'briefTime' | 'quietStart' | 'quietEnd'}
          <label
            >{pair[1]}
            <input
              type="time"
              value={view.prefs[key]}
              onchange={(ev) => prefer({ [key]: ev.currentTarget.value })}
            /></label
          >
        {/each}
        <label
          ><input
            type="checkbox"
            checked={view.prefs.desktop}
            onchange={(ev) => prefer({ desktop: ev.currentTarget.checked })}
          /> Desktop notifications</label
        >
        <label
          >Publisher’s work <select
            aria-label="Publisher’s work"
            value={view.prefs.creator}
            onchange={(ev) => prefer({ creator: ev.currentTarget.value as Preferences['creator'] })}
            ><option value="brief">Include in Today</option><option value="chat"
              >Announce in connected persona chat</option
            ><option value="shelf">Publications tab only</option></select
          ></label
        >
        {#each channels as c}<label
            ><input
              type="checkbox"
              checked={view.prefs.channels.includes(c)}
              onchange={(ev) =>
                prefer({
                  channels: ev.currentTarget.checked
                    ? [...(view?.prefs.channels ?? []), c]
                    : (view?.prefs.channels ?? []).filter((v) => v !== c)
                })}
            />
            {channelNames[c]}</label
          >{/each}
        <button onclick={() => act({ op: 'pause', on: !view?.paused })}
          >{view.paused ? 'Resume delivery' : 'Pause delivery'}</button
        >
        <button onclick={() => act({ op: 'remove' })}>Remove newsroom and saved stories</button>
      </fieldset>
    {/if}
  {/if}
</section>

<style>
  button {
    padding: 0.25rem 0.55rem;
    border: 1px solid var(--color-hairline);
    border-radius: 0.5rem;
  }
  button[aria-pressed='true'] {
    background: var(--color-sea);
    color: var(--color-canvas);
  }
  a {
    text-decoration: underline;
  }
</style>
