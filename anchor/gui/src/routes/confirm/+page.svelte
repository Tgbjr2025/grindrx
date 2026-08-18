<script>
  import { api, getToken } from '$lib/api.js';
  import { onMount } from 'svelte';

  let confirms = $state([]);
  let loaded = $state(false);
  let error = $state('');
  let busy = $state(0);

  async function load() {
    try {
      const data = await api('/v1/confirms');
      confirms = data.confirms;
      loaded = true;
    } catch (e) {
      error = e.message;
    }
  }

  async function resolve(id, action, fix = null) {
    busy = id;
    try {
      const body = fix ? { action: 'fix', fix } : { action };
      const result = await api(`/v1/confirms/${id}/resolve`, {
        method: 'POST',
        body: JSON.stringify(body)
      });
      if (result.result === 'apply_failed') {
        error = 'Could not apply that — it stays in the inbox. Details are in System health.';
      }
      await load();
    } catch (e) {
      error = e.message;
    } finally {
      busy = 0;
    }
  }

  function promptFix(item) {
    const text = prompt('What should it be instead? (e.g. start=2026-08-21T13:00, or title=...)');
    if (!text) return;
    const fix = {};
    for (const pair of text.split(',')) {
      const [k, ...rest] = pair.split('=');
      if (k && rest.length) fix[k.trim()] = rest.join('=').trim();
    }
    resolve(item.id, 'fix', fix);
  }

  onMount(load);
</script>

<h1>Confirm</h1>
{#if error}<p class="error">{error}</p>{/if}

{#if loaded && confirms.length === 0}
  <p class="quiet big">Nothing needs your OK. ✓</p>
{/if}

{#each confirms as item}
  <div class="card">
    <p class="summary">{item.summary}</p>
    {#if item.source_quote}
      <p class="source">They said: “{item.source_quote}”
        {#if item.source_artifact_id}
          <a href={`/v1/artifacts/${item.source_artifact_id}/audio?token=${encodeURIComponent(getToken())}`} target="_blank">▶ play source</a>
        {/if}
      </p>
    {/if}
    <div class="actions">
      <button class="ok" disabled={busy === item.id} onclick={() => resolve(item.id, 'approve')}>Yes, do it</button>
      <button class="fix" disabled={busy === item.id} onclick={() => promptFix(item)}>Fix it</button>
      <button class="no" disabled={busy === item.id} onclick={() => resolve(item.id, 'dismiss')}>Dismiss</button>
    </div>
  </div>
{/each}

<style>
  h1 { font-size: 1.4rem; }
  .card { background: #1e293b; border-radius: 14px; padding: 1.1rem; margin-bottom: 1rem; }
  .summary { font-size: 1.3rem; font-weight: 600; margin: 0 0 0.6rem; }
  .source { color: #94a3b8; font-style: italic; }
  .source a { color: #38bdf8; margin-left: 0.6rem; font-style: normal; }
  .actions { display: flex; gap: 0.6rem; margin-top: 0.8rem; flex-wrap: wrap; }
  .ok { background: #16a34a; color: white; font-weight: 700; }
  .fix { background: #f59e0b; color: #0f172a; font-weight: 700; }
  .no { background: #334155; color: #cbd5e1; }
  .quiet { color: #64748b; }
  .big { font-size: 1.5rem; }
  .error { color: #f87171; }
</style>
