<script>
  import { api } from '$lib/api.js';
  import { onMount } from 'svelte';

  let tasks = $state([]);
  let showClosed = $state(false);
  let error = $state('');

  async function load() {
    try {
      const data = await api(`/v1/tasks?status=${showClosed ? 'closed' : 'open'}`);
      tasks = data.tasks;
    } catch (e) {
      error = e.message;
    }
  }

  async function closeTask(id) {
    if (!confirm('Mark this as done? (It stays in the record.)')) return;
    try {
      await api(`/v1/tasks/${id}/close`, {
        method: 'POST',
        body: JSON.stringify({ reason: 'marked done in Anchor Console' })
      });
      await load();
    } catch (e) {
      error = e.message;
    }
  }

  onMount(load);
</script>

<h1>Open loops</h1>
{#if error}<p class="error">{error}</p>{/if}

<label class="toggle">
  <input type="checkbox" bind:checked={showClosed} onchange={load} /> show closed
</label>

{#if !tasks.length}
  <p class="quiet big">{showClosed ? 'No closed tasks yet.' : 'Nothing waiting on you. ✓'}</p>
{/if}

{#each tasks as task}
  <div class="card">
    <div class="title">{task.title}</div>
    <div class="meta">
      {task.kind} · opened {task.created_at?.slice(0, 10)}
      {#if task.status === 'closed'} · closed: {task.close_reason}{/if}
    </div>
    {#if task.source_quote}<div class="source">“{task.source_quote}”</div>{/if}
    <div class="actions">
      {#if task.phone_number}
        <a class="call" href={'tel:' + task.phone_number}>Call {task.phone_number}</a>
      {/if}
      {#if task.status === 'open'}
        <button class="done" onclick={() => closeTask(task.id)}>Done</button>
      {/if}
      {#if task.source_artifact_id}
        <a class="src" href={`/timeline/${task.source_artifact_id}`}>source ▶</a>
      {/if}
    </div>
  </div>
{/each}

<style>
  h1 { font-size: 1.4rem; }
  .toggle { color: #94a3b8; display: block; margin-bottom: 0.8rem; }
  .card { background: #1e293b; border-radius: 14px; padding: 1rem 1.1rem; margin-bottom: 0.8rem; }
  .title { font-size: 1.3rem; font-weight: 700; }
  .meta { color: #64748b; font-size: 0.95rem; }
  .source { color: #94a3b8; font-style: italic; margin-top: 0.3rem; }
  .actions { display: flex; gap: 0.6rem; margin-top: 0.6rem; align-items: center; flex-wrap: wrap; }
  .call { background: #16a34a; color: white; padding: 0.5rem 1rem; border-radius: 10px; text-decoration: none; font-weight: 700; }
  .done { background: #334155; color: #e2e8f0; }
  .src { color: #38bdf8; text-decoration: none; }
  .quiet { color: #64748b; }
  .big { font-size: 1.4rem; }
  .error { color: #f87171; }
</style>
