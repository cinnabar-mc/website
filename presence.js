(() => {
  /** Polls one aggregate independently, keeping failures from clearing the other count. */
  function pollCount(id, url, field, format) {
    const label = document.getElementById(id);
    let timer;
    let pending = false;

    /** Refreshes the aggregate while visible and clears unavailable or invalid counts. */
    async function refresh() {
      if (document.hidden || pending) return;
      pending = true;
      window.clearTimeout(timer);
      try {
        const response = await fetch(url, {
          cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(5000),
        });
        if (!response.ok) throw new Error('Count unavailable');
        const body = await response.json();
        if (!Number.isSafeInteger(body?.[field]) || body[field] < 0) throw new Error('Invalid count');
        label.textContent = document.hidden ? '' : format(body[field]);
      } catch {
        label.textContent = '';
      } finally {
        pending = false;
        if (!document.hidden) timer = window.setTimeout(refresh, 60_000);
      }
    }

    document.addEventListener('visibilitychange', () => {
      window.clearTimeout(timer);
      label.textContent = '';
      if (!document.hidden) void refresh();
    });
    void refresh();
  }

  pollCount('online-count', window.CINNABAR_DOWNLOADS.online_count_url, 'online', count => count === 1
    ? '1 person is using Cinnabar right now'
    : `${count.toLocaleString()} people are using Cinnabar right now`);
  pollCount('unique-count', window.CINNABAR_DOWNLOADS.unique_count_url, 'unique', count => count === 1
    ? '1 unique Cinnabar user since tracking began'
    : `${count.toLocaleString()} unique Cinnabar users since tracking began`);
})();
