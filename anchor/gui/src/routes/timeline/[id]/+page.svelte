<script>
  import { page } from '$app/stores';
  import { api, getToken, fmtDay, fmtTime } from '$lib/api.js';
  import { onMount } from 'svelte';

  let data = $state(null);
  let error = $state('');
  let audio = $state(null);

  const id = $page.params.id;
  const audioUrl = `/v1/artifacts/${id}/audio?token=${encodeURIComponent(getToken())}`;

  async function load() {
    try {
      data = await api(`/v1/artifacts/${id}`);
    } catch (e) {
      error = e.message;
    }
  }

  // Provenance made tangible: play the source at the exact offset.
  function playAt(seconds) {
    if (!audio) return;
    audio.currentTime = seconds;
    audio.play();
  }

  function mmss(s) {
    return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  }

  onMount(load);
</script>

{#if error}
  <p class="error">{error}</p>
{:else if !data}
  <p>Loading…</p>
{:else}
  {@const a = data.artifact}
  <a href="/timeline" class="back">← Timeline</a>
  <h1>
    {a.privileged ? '🔒 ' : ''}{a.contact_hint || a.phone_number || a.kind}
  </h1>
  <p class="meta">
    {a.kind} — {fmtDay(a.captured_at)} at {fmtTime(a.captured_at)}
    {#if a.classification} · {a.classification}{/if}
    {#if a.privileged} · <strong>privileged — excluded from exports</strong>{/if}
  </p>

  {#if a.duration_seconds}
    <audio bind:this={audio} controls preload="none" src={audioUrl}></audio>
  {/if}

  {#if a.agent_summary}
    <div class="card"><strong>What Anchor did:</strong> {a.agent_summary}</div>
  {/if}

  {#if data.events.length || data.tasks.length || data.facts.length}
    <h2>From this capture</h2>
    {#each data.events as e}
      <div class="card link">📅 {e.title} — {e.start} <span class="status">{e.status}</span></div>
    {/each}
    {#each data.tasks as t}
      <div class="card link">☐ {t.title} <span class="status">{t.status}</span></div>
    {/each}
    {#each data.facts as f}
      <div class="card link">💡 {f.body} <span class="status">{f.status}</span></div>
    {/each}
  {/if}

  {#if a.transcript_segments?.length}
    <h2>Transcript — tap a line to hear it</h2>
    {#each a.transcript_segments as seg}
      <button class="seg" onclick={() => playAt(seg.start)}>
        <span class="stamp">{mmss(seg.start)}</span> {seg.text}
      </button>
    {/each}
  {:else if a.transcript}
    <h2>Content</h2>
    <div class="card">{a.transcript}</div>
  {/if}
{/if}

<style>
  .back { color: #38bdf8; text-decoration: none; }
  h1 { font-size: 1.4rem; margin: 0.4rem 0 0.1rem; }
  h2 { color: #38bdf8; font-size: 1.05rem; text-transform: uppercase; letter-spacing: 0.05em; margin-top: 1.4rem; }
  .meta { color: #94a3b8; margin-top: 0; }
  audio { width: 100%; margin: 0.6rem 0; }
  .card { background: #1e293b; border-radius: 12px; padding: 0.9rem 1rem; margin-bottom: 0.6rem; overflow-wrap: anywhere; }
  .status { color: #64748b; font-size: 0.9rem; margin-left: 0.4rem; }
  .seg {
    display: block; width: 100%; text-align: left; background: #1e293b;
    color: #e2e8f0; margin-bottom: 0.35rem; border-radius: 10px;
    padding: 0.55rem 0.8rem; font-size: 1.05rem;
  }
  .seg:active { background: #334155; }
  .stamp { color: #38bdf8; font-variant-numeric: tabular-nums; margin-right: 0.5rem; }
  .error { color: #f87171; }
</style>
