(function () {
  "use strict";

  /**
   * A client for the live marketplace API. It sends the session cookie the API set after Microsoft sign-in,
   * and repeats the CSRF token from `GET /me` on every write. Uploads go as multipart, so the API reads the
   * component's grants and hash itself.
   */
  function createHttpApi(base, fetchImpl, location) {
    let csrf = "";
    const api = {
      backend: "http",
      /** Answers `{status, body}` like the mock; network failures reject. */
      request: async function (method, path, body) {
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
        if (path === "/me" && data && typeof data.csrf === "string") csrf = data.csrf;
        return { status: response.status, body: data };
      },
      /** Leaves for Microsoft sign-in, returning to this exact page. */
      signIn: function () {
        location.assign(base + "/auth/microsoft/start?return_to=" + encodeURIComponent(location.href));
      },
      /** Uploads the listing fields and the component file. */
      submit: function (fields, file) {
        if (String(fields.description || "").length > 2000) {
          return Promise.resolve({ status: 422, body: { error: "The current API allows descriptions up to 2,000 characters. Your draft has been retained.", fields: { description: "Use at most 2,000 characters for this API." } } });
        }
        const form = new FormData();
        form.set("listing", JSON.stringify(fields));
        form.set("file", file);
        return api.request("POST", "/submissions", form);
      },
    };
    return api;
  }

  if (typeof module !== "undefined") module.exports = { createHttpApi: createHttpApi };
  if (typeof window !== "undefined") window.CinnabarMarketHttp = { createHttpApi: createHttpApi };
})();
