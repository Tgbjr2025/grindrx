<script>
  import { api } from '$lib/api.js';
  import { onMount, onDestroy } from 'svelte';

  let data = $state(null);
  let error = $state('');
  let timer;

  function age(iso) {
    if (!iso) return 'never';
    const h = (Date.now() - new Date(iso).getTime()) / 3.6e6;
    return h < 1 ? `${Math.round(h * 60)}m ago` : `${h.toFixed(1)}h ago`;
  }

  function beatClass(component, iso) {
    if (!iso) return 'bad';
    const hours = (Date.now() - new Date(iso).getTime()) / 3.6e6;
    const limit = { phone: 2, worker: 0.2, api: 24, backup: 26 }[component] ?? 24;
    return hours > limit ? 'bad' : 'ok';
  }

  async function load() {
    try {
      data = await api('/v1/health');
      error = '';
    } catch (e) {
      error = `Cannot reach the server: ${e.message}`;
    }
  }

  onMount(() => {
    load();
    timer = setInterval(load, 30_000);
  });
  onDestroy(() => clearInterval(timer));
</script>

<h1>System health</h1>
{#if error}<p class="error big">{error}</p>{/if}

{#if data}
  <h2>Heartbeats</h2>
  {#each ['phone', 'worker', 'api', 'backup'] as comp}
    {@const beat = data.heartbeats[comp]}
    <div class="row {beatClass(comp, beat?.last_seen)}">
      <span class="comp">{comp}</span>
      <span>{age(beat?.last_seen)}</span>
    </div>
  {/each}

  <h2>Queue</h2>
  <div class="row"><span>waiting</span><span>{data.queue.queued ?? 0}</span></div>
  <div class="row"><span>working</span><span>{data.queue.processing ?? 0}</span></div>
  <div class="row"><span>done</span><span>{data.queue.done ?? 0}</span></div>
  <div class="row {data.queue.failed ? 'bad' : ''}"><span>failed</span><span>{data.queue.failed ?? 0}</span></div>

  <h2>Agent backend</h2>
  <div class="row"><span>{data.llm_backend}</span><span>{data.dry_run ? 'DRY RUN' : 'live'}</span></div>

  {#if data.semantic_index}
    <h2>Semantic index</h2>
    <div class="row {data.semantic_index.pending > 100 ? 'bad' : 'ok'}">
      <span>indexed</span>
      <span>{data.semantic_index.indexed} / {data.semantic_index.total}</span>
    </div>
  {/if}

  {#if data.failed_jobs.length}
    <h2>Failed jobs</h2>
    {#each data.failed_jobs as job}
      <div class="card bad">#{job.id} {job.type}{job.artifact_id ? ` (artifact ${job.artifact_id})` : ''}<br />
        <span class="err">{(job.last_error || '').split('\n')[0].slice(0, 160)}</span></div>
    {/each}
  {/if}

  {#if data.recent_errors.length}
    <h2>Recent errors</h2>
    {#each data.recent_errors.slice(0, 8) as e}
      <div class="card"><span class="quiet">{e.ts?.slice(0, 16)}</span> {e.action}</div>
    {/each}
  {/if}
{/if}

<style>
  h1 { font-size: 1.4rem; }
  h2 { color: #38bdf8; font-size: 1rem; text-transform: uppercase; letter-spacing: 0.05em; margin-top: 1.3rem; }
  .row {
    display: flex; justify-content: space-between; background: #1e293b;
    border-radius: 10px; padding: 0.6rem 1rem; margin-bottom: 0.4rem;
  }
  .comp { font-weight: 700; }
  .row.ok { border-left: 4px solid #16a34a; }
  .row.bad { border-left: 4px solid #f87171; }
  .card { background: #1e293b; border-radius: 10px; padding: 0.7rem 1rem; margin-bottom: 0.4rem; overflow-wrap: anywhere; }
  .card.bad { border-left: 4px solid #f87171; }
  .err { color: #fca5a5; font-size: 0.9rem; }
  .quiet { color: #64748b; }
  .error { color: #f87171; }
  .big { font-size: 1.3rem; }
</style>
