import { createReadStream } from 'node:fs';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { repositoryDirectory } from './lib.mjs';

const port = Number(process.env.PORT || 8765);
const contentTypes = new Map([
  ['.json', 'application/json; charset=utf-8'],
  ['.md', 'text/markdown; charset=utf-8'],
]);

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || '/', `http://${request.headers.host || '127.0.0.1'}`);
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'catalog.json';
    const file = path.resolve(repositoryDirectory, relative);
    if (file !== repositoryDirectory && !file.startsWith(`${repositoryDirectory}${path.sep}`)) {
      response.writeHead(403).end('Forbidden');
      return;
    }
    const stat = await fs.stat(file);
    if (!stat.isFile()) throw new Error('Not a file');
    response.writeHead(200, {
      'content-type': contentTypes.get(path.extname(file)) || 'application/octet-stream',
      'content-length': stat.size,
      'cache-control': 'no-store',
    });
    createReadStream(file).pipe(response);
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found');
  }
});

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`Extension repository: http://127.0.0.1:${port}/catalog.json\n`);
});
