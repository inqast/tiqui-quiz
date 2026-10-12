import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const types = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.md', 'text/markdown; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
]);

createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  const filePath = resolve(root, `.${pathname === '/' ? '/quiz.html' : pathname}`);

  if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) {
    response.writeHead(403).end('Forbidden');
    return;
  }

  try {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error('not a file');
    response.writeHead(200, { 'Content-Type': types.get(extname(filePath)) || 'application/octet-stream' });
    createReadStream(filePath).pipe(response);
  } catch {
    response.writeHead(404).end('Not found');
  }
}).listen(4173, '127.0.0.1');
