/* =========================================================
   CSRF PROTECTION (double-submit cookie)
   Must be loaded before any other script that calls fetch().
   Reads the non-HttpOnly `fiable_csrf` cookie (set by the server on
   login) and attaches it as an X-CSRF-Token header on every
   state-changing request, so existing fetch() calls don't need to be
   edited individually.
========================================================= */
(function () {
  function readCookie(name) {
    const match = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
    return match ? decodeURIComponent(match[1]) : null;
  }

  const originalFetch = window.fetch.bind(window);

  window.fetch = function (input, init) {
    const options = init ? Object.assign({}, init) : {};
    const method = (options.method || "GET").toUpperCase();

    if (method !== "GET" && method !== "HEAD") {
      const token = readCookie("fiable_csrf");
      if (token) {
        const headers = new Headers(options.headers || {});
        headers.set("X-CSRF-Token", token);
        options.headers = headers;
      }
    }

    return originalFetch(input, options);
  };
})();
