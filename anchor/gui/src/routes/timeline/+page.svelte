<script>
  import { api, fmtTime } from '$lib/api.js';
  import { onMount } from 'svelte';

  let items = $state([]);
  let error = $state('');
  let done = $state(false);
  let loading = $state(false);

  const icons = { call: '📞', voicemail: '📨', photo: '📷', note: '📝', sms: '💬', fix: '✏️' };

  async function load(more = false) {
    loading = true;
    try {
      const before = more && items.length ? `&before=${encodeURIComponent(items[items.length - 1].captured_at)}` : '';
      const data = await api(`/v1/timeline?limit=50${before}`);
      items = more ? [...items, ...data.items] : data.items;
      done = data.items.length < 50;
      error = '';
    } catch (e) {
      error = e.message;
    } finally {
      loading = false;
    }
  }

  function dayOf(iso) {
    return new Date(iso).toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'
    });
  }

  onMount(() => load());
</script>

<h1>Timeline</h1>
{#if error}<p class="error">{error}</p>{/if}

{#each items as item, i}
  {#if i === 0 || dayOf(item.captured_at) !== dayOf(items[i - 1].captured_at)}
    <p class="day">{dayOf(item.captured_at)}</p>
  {/if}
  <a class="card" href={`/timeline/${item.id}`}>
    <span class="icon">{icons[item.kind] ?? '📄'}</span>
    <span class="body">
      <span class="who">
        {item.privileged ? '🔒 privileged' : (item.contact_hint || item.phone_number || item.kind)}
        <span class="time">{fmtTime(item.captured_at)}</span>
      </span>
      {#if item.privileged}
        <span class="summary quiet">Content hidden — tap to view.</span>
      {:else if item.agent_summary}
        <span class="summary">{item.agent_summary.slice(0, 140)}</span>
      {:else}
        <span class="summary quiet">{item.status === 'processed' ? item.kind : 'processing…'}</span>
      {/if}
    </span>
  </a>
{/each}

{#if !done && items.length}
  <button onclick={() => load(true)} disabled={loading}>Load older</button>
{/if}
{#if !items.length && !error}
  <p class="quiet">Nothing captured yet.</p>
{/if}

<style>
  h1 { font-size: 1.4rem; }
  .day { color: #38bdf8; font-weight: 700; margin: 1rem 0 0.4rem; }
  .card {
    display: flex; gap: 0.8rem; background: #1e293b; border-radius: 14px;
    padding: 0.9rem 1rem; margin-bottom: 0.6rem; text-decoration: none; color: inherit;
  }
  .icon { font-size: 1.5rem; }
  .body { display: flex; flex-direction: column; gap: 0.2rem; min-width: 0; }
  .who { font-weight: 700; }
  .time { color: #64748b; font-weight: 400; margin-left: 0.5rem; }
  .summary { color: #cbd5e1; overflow-wrap: anywhere; }
  .quiet { color: #64748b; }
  .error { color: #f87171; }
  button { background: #334155; color: #e2e8f0; width: 100%; }
</style>
