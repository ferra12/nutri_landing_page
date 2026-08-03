// Entrypoint del Worker. Gli asset statici sono serviti prima di questo script
// (default di Workers Assets): qui arrivano solo i path che non esistono in
// public/, quindi le API e i 404.
import { onRequestPost as book } from '../functions/api/book.js';
import { onRequestPost as contact } from '../functions/api/contact.js';

const ROUTES = {
  '/api/book': book,
  '/api/contact': contact,
};

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    const handler = ROUTES[pathname];

    if (handler) {
      if (request.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405, headers: { allow: 'POST' } });
      }
      return handler({ request, env });
    }

    return env.ASSETS.fetch(request);
  },
};
