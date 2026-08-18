<script>
  import { api } from '$lib/api.js';
  import { onMount } from 'svelte';

  let contacts = $state([]);
  let error = $state('');

  const catColor = {
    medical: '#38bdf8', legal: '#f59e0b', scheduling: '#a78bfa',
    personal: '#4ade80', spam: '#f87171', unknown: '#64748b'
  };

  onMount(async () => {
    try {
      contacts = (await api('/v1/contacts')).contacts;
    } catch (e) {
      error = e.message;
    }
  });
</script>

<h1>Contacts registry</h1>
{#if error}<p class="error">{error}</p>{/if}
{#if !contacts.length}<p class="quiet">No contacts registered yet — backfill and calls will populate this.</p>{/if}

{#each contacts as c}
  <div class="card">
    <div class="name">
      {c.name}
      {#if c.privileged}<span class="priv">🔒 privileged</span>{/if}
    </div>
    <div class="meta">
      <span class="cat" style={`color:${catColor[c.category] ?? '#64748b'}`}>{c.category}</span>
      · {c.origin}{c.people_resource ? ' · on phone' : ''}
    </div>
    {#each JSON.parse(c.numbers) as n}
      <a class="num" href={'tel:' + n}>{n}</a>
    {/each}
    {#if c.organization}<div class="meta">{c.organization}</div>{/if}
  </div>
{/each}

<style>
  h1 { font-size: 1.4rem; }
  .card { background: #1e293b; border-radius: 14px; padding: 0.9rem 1.1rem; margin-bottom: 0.7rem; }
  .name { font-size: 1.2rem; font-weight: 700; }
  .priv { color: #f59e0b; font-size: 0.9rem; margin-left: 0.5rem; }
  .meta { color: #94a3b8; font-size: 0.95rem; }
  .cat { font-weight: 700; }
  .num { display: inline-block; color: #38bdf8; text-decoration: none; margin-right: 0.8rem; margin-top: 0.2rem; }
  .quiet { color: #64748b; }
  .error { color: #f87171; }
</style>
