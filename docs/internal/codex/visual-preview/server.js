const http = require('http');
const fs = require('fs');
const path = require('path');
const port = Number(process.env.PORT || 61779);
const root = process.cwd();
const server = http.createServer((req, res) => {
  const file = req.url === '/' ? 'index.html' : req.url.replace(/^\//,'');
  const target = path.join(root, file);
  fs.readFile(target, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, {'content-type': file.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8'});
    res.end(data);
  });
});
server.listen(port, '127.0.0.1');
