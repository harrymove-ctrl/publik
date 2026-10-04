import { createApp } from "./app";

const publicOrigin = process.env.PUBLIK_PUBLIC_ORIGIN ?? "http://127.0.0.1:5173";
const apiOrigin = process.env.PUBLIK_API_ORIGIN ?? publicOrigin;
const port = Number(process.env.PUBLIK_API_PORT ?? 8787);
const dbPath = process.env.PUBLIK_DB ?? "data/publik.sqlite";

const app = createApp({ dbPath, publicOrigin, apiOrigin });
Bun.serve({ port, fetch: (request) => app.handle(request) });
console.log(`Publik API listening on ${port}`);
