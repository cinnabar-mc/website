(function () {
  "use strict";

  /**
   * A client for the live marketplace API. It sends the session cookie the API set after Microsoft sign-in,
   * and repeats the CSRF token from `GET /me` on every write. Uploads go as multipart, so the API reads the
   * component's grants and hash itself.
   */
  function createHttpApi(base, fetchImpl, location) {
    let csrf = "";
    let identityGeneration = 0;
    base = base.replace(/\/$/, '');
    /** Build image URLs only from server digests and numeric version IDs, never creator-provided URLs. */
    function release(data, privateView) {
      if (!data || typeof data !== 'object') return data;
      const id = /^[0-9]{1,12}$/.test(String(data.id)) ? String(data.id) : null;
      const gallery = (Array.isArray(data.gallery) ? data.gallery : []).filter(item => item && /^[0-9a-f]{64}$/.test(item.sha256))
        .map(item => ({ ...item, private: privateView, url: privateView
          ? (id ? base + '/me/mods/' + id + '/media/' + item.sha256 : '') : base + '/mods/media/' + item.sha256 }));
      return { ...data, gallery };
    }
    const api = {
      backend: "http",
      /** Answers `{status, body}` like the mock; network failures reject. */
      request: async function (method, path, body) {
        if (path === '/auth/signout') identityGeneration++;
        const identity = identityGeneration;
        const form = typeof FormData !== "undefined" && body instanceof FormData;
        const headers = { Accept: "application/json" };
        if (body && !form) headers["Content-Type"] = "application/json";
        if (method !== "GET") headers["X-Cinnabar-CSRF"] = csrf;
        const response = await fetchImpl(base + path, {
          method: method, credentials: "include", referrerPolicy: "strict-origin", headers: headers,
          body: form ? body : body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(form ? 120000 : 10000),
        });
        const data = await response.json().catch(function () { return { error: "The marketplace didn't answer properly." }; });
        if (path === "/me" && response.status === 200 && identity === identityGeneration) csrf = data && typeof data.csrf === "string" ? data.csrf : '';
        if (path === '/auth/signout' && response.status === 200) csrf = '';
        const privateView = path === '/me/mods' || path.startsWith('/staff/') || path === '/submissions';
        const bodyData = response.status === 200 && path !== '/me'
          ? (Array.isArray(data) ? data.map(item => release(item, privateView)) : release(data, privateView)) : data;
        return { status: response.status, body: bodyData };
      },
      /** Leaves for Microsoft sign-in, returning to this exact page. */
      signIn: function () {
        location.assign(base + "/auth/microsoft/start?return_to=" + encodeURIComponent(location.href));
      },
      /** Link to an authenticated attachment download of the exact quarantined release. */
      fileUrl: function (id) { return /^[0-9]{1,12}$/.test(String(id)) ? base + '/staff/versions/' + id + '/file' : null; },
      /** Upload re-encoded local raster bytes and their ordered captions/alt text alongside the exact component. */
      submit: async function (fields, file, gallery = []) {
        const fail = message => ({ status: 422, body: { error: message + ' Your draft has been retained.' } });
        if (String(fields.description || "").length > 40000) return fail('Descriptions can have up to 40,000 characters.');
        if (!Array.isArray(gallery) || gallery.length > 4) return fail('Upload at most four images.');
        if (!file || file.size > 16 * 1024 * 1024) return fail('Choose a component up to 16 MiB.');
        const form = new FormData();
        form.set("listing", JSON.stringify(fields));
        form.set("file", file);
        const metadata = [];
        for (const [index, image] of gallery.entries()) {
          const match = /^data:(image\/(png|jpeg|webp));base64,([a-zA-Z0-9+/=]+)$/.exec(image?.url || '');
          if (!match || image.url.length > 1400000) return fail('Reselect each image to prepare a local PNG, JPEG or WebP upload.');
          let bytes;
          try { bytes = Uint8Array.from(atob(match[3]), c => c.charCodeAt(0)); }
          catch (_) { return fail('An image could not be decoded. Reselect it.'); }
          if (bytes.length > 1024 * 1024) return fail('Each prepared image must fit within 1 MiB.');
          const caption = typeof image.caption === 'string' ? image.caption : '';
          const alt = typeof image.alt === 'string' ? image.alt : '';
          if (caption.length > 160 || alt.length > 300) return fail('Use captions up to 160 characters and alt text up to 300 characters.');
          form.append('images', new Blob([bytes], { type: match[1] }), 'screenshot-' + (index + 1) + '.' + match[2]);
          metadata.push({ caption, alt });
        }
        form.set('image_metadata', JSON.stringify(metadata));
        return api.request("POST", "/submissions", form);
      },
    };
    return api;
  }

  if (typeof module !== "undefined") module.exports = { createHttpApi: createHttpApi };
  if (typeof window !== "undefined") window.CinnabarMarketHttp = { createHttpApi: createHttpApi };
})();
