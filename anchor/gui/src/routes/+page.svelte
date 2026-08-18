<script>
  import { api, fmtTime, fmtDay } from '$lib/api.js';
  import { badday } from '$lib/badday.js';
  import { onMount, onDestroy } from 'svelte';

  let data = $state(null);
  let error = $state('');
  let timer;

  async function load() {
    try {
      data = await api('/v1/today');
      error = '';
    } catch (e) {
      error = e.message === 'unauthorized' ? 'Wrong token — reload and re-enter it.' : `Cannot reach the server: ${e.message}`;
    }
  }

  onMount(() => {
    load();
    timer = setInterval(load, 60_000);
  });
  onDestroy(() => clearInterval(timer));
</script>

{#if error}
  <p class="error">{error}</p>
{:else if !data}
  <p>Loading…</p>
{:else}
  <p class="day">{fmtDay(data.now)}</p>

  {#if data.pending_confirms > 0}
    <a class="confirm-banner" href="/confirm">
      {data.pending_confirms} item{data.pending_confirms === 1 ? '' : 's'} need your OK →
    </a>
  {/if}

  <h2>Next up</h2>
  {#if data.events.length === 0}
    <p class="big quiet">Nothing on the calendar today.</p>
  {/if}
  {#each data.events as event}
    <div class="card event">
      <div class="time">{fmtTime(event.start)}</div>
      <div>
        <div class="title">{event.title}</div>
        {#if event.location}<div class="loc">{event.location}</div>{/if}
        {#if event.source_quote}<div class="source">“{event.source_quote}”</div>{/if}
      </div>
    </div>
  {/each}

  <h2>Open loops</h2>
  {#if data.open_tasks.length === 0}
    <p class="quiet">Nothing waiting on you.</p>
  {/if}
  {#each data.open_tasks as task}
    <div class="card task">
      <div class="title">{task.title}</div>
      {#if task.phone_number}
        <a class="call" href={'tel:' + task.phone_number}>Call {task.phone_number}</a>
      {/if}
      {#if task.source_quote}<div class="source">“{task.source_quote}”</div>{/if}
    </div>
  {/each}

  {#if $badday}
    <button class="exit-badday" onclick={() => badday.set(false)}>
      Feeling better? Turn off bad-day mode
    </button>
  {/if}
{/if}

<style>
  .day { color: #94a3b8; font-size: 1.2rem; margin: 0.3rem 0 0.8rem; }
  h2 { color: #38bdf8; font-size: 1.1rem; text-transform: uppercase; letter-spacing: 0.05em; margin-top: 1.6rem; }
  .card {
    background: #1e293b; border-radius: 14px; padding: 1rem 1.1rem; margin-bottom: 0.8rem;
  }
  .event { display: flex; gap: 1rem; align-items: baseline; }
  .time { font-size: 1.9rem; font-weight: 800; color: #f8fafc; white-space: nowrap; }
  .title { font-size: 1.45rem; font-weight: 700; }
  .loc { color: #94a3b8; font-size: 1.1rem; }
  .source { color: #64748b; font-size: 0.95rem; margin-top: 0.4rem; font-style: italic; }
  .call {
    display: inline-block; margin-top: 0.5rem; background: #16a34a; color: white;
    padding: 0.5rem 1rem; border-radius: 10px; text-decoration: none; font-weight: 700;
  }
  .confirm-banner {
    display: block; background: #f59e0b; color: #0f172a; font-weight: 800;
    padding: 0.9rem 1.1rem; border-radius: 14px; text-decoration: none;
    font-size: 1.2rem; margin-bottom: 0.5rem;
  }
  .big { font-size: 1.5rem; }
  .quiet { color: #64748b; }
  .error { color: #f87171; font-size: 1.2rem; }
  .exit-badday { margin-top: 2rem; width: 100%; background: #334155; color: #94a3b8; }
</style>
