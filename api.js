// Thin client for the CMS D9 backend (PostgreSQL + Express).
// Point it at your deployed API by setting window.CMS_API_BASE before this script loads,
// e.g.  <script>window.CMS_API_BASE = 'https://your-api.onrender.com/api';</script>
(function () {
  const isLocal = ['localhost', '127.0.0.1', ''].includes(location.hostname);
  const BASE = window.CMS_API_BASE || (isLocal ? 'http://localhost:4000/api' : '/api');
  const TOKEN_KEY = 'cms_token';

  const API = {
    getToken: () => sessionStorage.getItem(TOKEN_KEY),
    setToken: (t) => (t ? sessionStorage.setItem(TOKEN_KEY, t) : sessionStorage.removeItem(TOKEN_KEY)),

    async request(method, path, body) {
      let res;
      try {
        res = await fetch(BASE + path, {
          method,
          headers: {
            'Content-Type': 'application/json',
            ...(API.getToken() ? { Authorization: 'Bearer ' + API.getToken() } : {}),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      } catch (e) {
        const err = new Error('Cannot reach the server. Is the backend running?');
        err.code = 'NETWORK';
        throw err;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = new Error(data.message || 'Request failed.');
        err.status = res.status;
        err.code = data.error;
        err.field = data.field;
        if (res.status === 401 && API.getToken() && typeof API.onUnauthorized === 'function') API.onUnauthorized();
        throw err;
      }
      return data;
    },
    get: (p) => API.request('GET', p),
    post: (p, b) => API.request('POST', p, b === undefined ? {} : b),
    put: (p, b) => API.request('PUT', p, b),
    patch: (p, b) => API.request('PATCH', p, b === undefined ? {} : b),
    del: (p) => API.request('DELETE', p),
  };
  window.API = API;
})();
