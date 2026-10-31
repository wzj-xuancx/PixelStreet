import http from 'node:http';
export function startHealthServer(port = 0): http.Server {
  const server = http.createServer((req, res) => {
    const ok = req.method === 'GET' && req.url === '/health';
    res.writeHead(ok ? 200 : 404, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    res.end(JSON.stringify(ok ? { name: 'PixelStreet', phase: 'S1', version: '0.1.0-s1', gameplay: false } : { error: 'not-found' }));
  });
  server.listen(port, '127.0.0.1', () => { const a = server.address(); console.log(`PixelStreet S1 health only: http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}/health`); });
  return server;
}
