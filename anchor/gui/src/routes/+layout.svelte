<script>
  import { page } from '$app/stores';
  import { getToken, setToken } from '$lib/api.js';

  let { children } = $props();
  let hasToken = $state(!!getToken());
  let tokenInput = $state('');

  const tabs = [
    { href: '/', label: 'Today' },
    { href: '/confirm', label: 'Confirm' },
    { href: '/ask', label: 'Ask' }
  ];

  function saveToken() {
    if (!tokenInput.trim()) return;
    setToken(tokenInput);
    hasToken = true;
    location.reload();
  }
</script>

{#if !hasToken}
  <main class="login">
    <h1>Anchor</h1>
    <p>Paste the access token (it's in the CHEATSHEET envelope / on the server in /etc/anchor/anchor.env).</p>
    <input type="password" bind:value={tokenInput} placeholder="token" autocomplete="off" />
    <button onclick={saveToken}>Unlock</button>
  </main>
{:else}
  <nav>
    {#each tabs as tab}
      <a href={tab.href} class:active={$page.url.pathname === tab.href}>{tab.label}</a>
    {/each}
  </nav>
  <main>
    {@render children()}
  </main>
{/if}

<style>
  :global(html) {
    background: #0f172a;
    color: #f1f5f9;
    font-family: system-ui, sans-serif;
    font-size: 18px;
  }
  :global(body) { margin: 0; }
  :global(button) {
    font-size: 1.1rem;
    padding: 0.7rem 1.2rem;
    border-radius: 12px;
    border: none;
    cursor: pointer;
  }
  nav {
    display: flex;
    position: sticky;
    top: 0;
    background: #1e293b;
    z-index: 10;
  }
  nav a {
    flex: 1;
    text-align: center;
    padding: 1rem 0.5rem;
    color: #94a3b8;
    text-decoration: none;
    font-size: 1.15rem;
    font-weight: 600;
  }
  nav a.active {
    color: #38bdf8;
    border-bottom: 3px solid #38bdf8;
  }
  main { padding: 1rem; max-width: 640px; margin: 0 auto; }
  .login { text-align: center; padding-top: 4rem; }
  .login input {
    display: block; width: 90%; margin: 1rem auto; padding: 0.8rem;
    font-size: 1.1rem; border-radius: 10px; border: 1px solid #475569;
    background: #1e293b; color: #f1f5f9;
  }
  .login button { background: #38bdf8; color: #0f172a; font-weight: 700; }
</style>
