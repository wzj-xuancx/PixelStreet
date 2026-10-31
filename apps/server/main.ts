import { startHealthServer } from './server';
const server = startHealthServer();
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => server.close());
