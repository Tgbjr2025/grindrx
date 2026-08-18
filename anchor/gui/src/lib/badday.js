// Bad-day mode: one toggle — maximum text size, Today + Confirm only.
import { writable } from 'svelte/store';

const KEY = 'anchor_badday';

function init() {
  const store = writable(localStorage.getItem(KEY) === '1');
  store.subscribe((on) => {
    localStorage.setItem(KEY, on ? '1' : '0');
    document.documentElement.style.fontSize = on ? '24px' : '18px';
  });
  return store;
}

export const badday = init();
