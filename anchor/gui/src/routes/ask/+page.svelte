<script>
  import { api, getToken } from '$lib/api.js';

  let question = $state('');
  let history = $state([]);
  let busy = $state(false);

  async function ask() {
    const q = question.trim();
    if (!q || busy) return;
    question = '';
    history = [...history, { role: 'you', text: q }];
    busy = true;
    try {
      const { answer } = await api('/v1/ask', {
        method: 'POST',
        body: JSON.stringify({ question: q })
      });
      history = [...history, { role: 'anchor', text: answer }];
    } catch (e) {
      history = [...history, { role: 'anchor', text: `Something went wrong: ${e.message}. The question was not lost — ask again.`, error: true }];
    } finally {
      busy = false;
    }
  }

  // Turn [#42 @ 3m10s] source chips into playable links.
  function linkSources(text) {
    return text.replace(
      /\[#(\d+)(?:\s*@\s*([\dms\s]+))?\]/g,
      (m, id) => `<a class="chip" target="_blank" href="/v1/artifacts/${id}/audio?token=${encodeURIComponent(getToken())}">${m}</a>`
    );
  }
</script>

<h1>Ask your record</h1>
<p class="hint">Answers come from recordings and messages — with sources — not from guessing.</p>

<div class="thread">
  {#each history as msg}
    <div class="msg {msg.role}" class:error={msg.error}>
      {#if msg.role === 'anchor'}
        {@html linkSources(msg.text.replace(/</g, '&lt;'))}
      {:else}
        {msg.text}
      {/if}
    </div>
  {/each}
  {#if busy}<div class="msg anchor quiet">Checking the record…</div>{/if}
</div>

<form onsubmit={(e) => { e.preventDefault(); ask(); }}>
  <input bind:value={question} placeholder="When is my next appointment?" />
  <button type="submit" disabled={busy}>Ask</button>
</form>

<style>
  h1 { font-size: 1.4rem; margin-bottom: 0.2rem; }
  .hint { color: #64748b; margin-top: 0; }
  .thread { display: flex; flex-direction: column; gap: 0.7rem; margin-bottom: 1rem; }
  .msg { padding: 0.8rem 1rem; border-radius: 14px; font-size: 1.15rem; white-space: pre-wrap; }
  .msg.you { background: #0ea5e9; color: #06283d; align-self: flex-end; max-width: 85%; }
  .msg.anchor { background: #1e293b; align-self: flex-start; max-width: 95%; }
  .msg.error { border: 1px solid #f87171; }
  .quiet { color: #64748b; }
  :global(.chip) {
    background: #334155; color: #38bdf8; border-radius: 8px;
    padding: 0.05rem 0.4rem; text-decoration: none; font-size: 0.95rem;
  }
  form { display: flex; gap: 0.6rem; position: sticky; bottom: 0.5rem; }
  input {
    flex: 1; padding: 0.9rem; font-size: 1.15rem; border-radius: 12px;
    border: 1px solid #475569; background: #1e293b; color: #f1f5f9;
  }
  button { background: #38bdf8; color: #0f172a; font-weight: 700; }
</style>
