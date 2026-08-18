<script>
  import { api, getToken } from '$lib/api.js';
  import { badday } from '$lib/badday.js';

  let symptom = $state('');
  let logStatus = $state('');
  let packTopic = $state('');

  const reportUrl = `/v1/symptoms/report.pdf?days=90&token=${encodeURIComponent(getToken())}`;

  function downloadPack() {
    const topic = packTopic.trim();
    if (!topic) return;
    window.open(
      `/v1/pack?topic=${encodeURIComponent(topic)}&token=${encodeURIComponent(getToken())}`,
      '_blank'
    );
  }

  async function logSymptom() {
    const text = symptom.trim();
    if (!text) return;
    logStatus = 'saving…';
    try {
      await api('/v1/symptoms', { method: 'POST', body: JSON.stringify({ text }) });
      symptom = '';
      logStatus = 'Logged. ✓';
    } catch (e) {
      logStatus = `Failed: ${e.message}`;
    }
  }
</script>

<h1>More</h1>

<a class="card link" href="/tasks">☐ Open loops / tasks</a>
<a class="card link" href="/contacts">👥 Contacts registry</a>
<a class="card link" href="/health">❤️ System health</a>

<h2>Bad-day mode</h2>
<p class="hint">Maximum text size. Only Today and Confirm. Everything else hidden.</p>
<button class="badday" class:on={$badday} onclick={() => badday.update((v) => !v)}>
  {$badday ? 'Bad-day mode is ON — tap to turn off' : 'Turn on bad-day mode'}
</button>

<h2>Export a pack</h2>
<p class="hint">Everything on a topic, dated and source-linked, as a zip. Attorney material is excluded automatically.</p>
<form onsubmit={(e) => { e.preventDefault(); downloadPack(); }}>
  <input bind:value={packTopic} placeholder="e.g. imaging, insurance claim" />
  <button type="submit">Export</button>
</form>

<h2>Symptom log</h2>
<form onsubmit={(e) => { e.preventDefault(); logSymptom(); }}>
  <input bind:value={symptom} placeholder="headache since lunch, light-sensitive" />
  <button type="submit">Log</button>
</form>
{#if logStatus}<p class="hint">{logStatus}</p>{/if}
<a class="card link" href={reportUrl} target="_blank">📄 Symptom report PDF (last 90 days)</a>

<style>
  h1 { font-size: 1.4rem; }
  h2 { color: #38bdf8; font-size: 1rem; text-transform: uppercase; letter-spacing: 0.05em; margin-top: 1.5rem; }
  .card {
    display: block; background: #1e293b; border-radius: 14px;
    padding: 1rem 1.1rem; margin-bottom: 0.7rem;
  }
  .link { color: #f1f5f9; text-decoration: none; font-size: 1.15rem; font-weight: 600; }
  .hint { color: #64748b; margin: 0.2rem 0 0.6rem; }
  .badday { width: 100%; background: #334155; color: #e2e8f0; font-weight: 700; }
  .badday.on { background: #f59e0b; color: #0f172a; }
  form { display: flex; gap: 0.6rem; }
  input {
    flex: 1; padding: 0.8rem; font-size: 1.05rem; border-radius: 12px;
    border: 1px solid #475569; background: #1e293b; color: #f1f5f9;
  }
  form button { background: #38bdf8; color: #0f172a; font-weight: 700; }
</style>
