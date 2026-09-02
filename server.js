const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')

const port = Number(process.env.PORT || 3000)
const publicDir = path.join(__dirname, 'public')

const server = http.createServer((req, res) => {
  if (req.url === '/input' || req.url.startsWith('/input?')) {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(JSON.stringify({ data: null, history: [], total: 0, timestamp: new Date().toISOString() }))
    return
  }

  const requestedPath = decodeURIComponent(req.url.split('?')[0])
  const filePath = path.join(publicDir, requestedPath === '/' ? 'index.html' : requestedPath)
  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403)
    res.end('Forbidden')
    return
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('Not found')
      return
    }
    const extension = path.extname(filePath)
    const contentTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' }
    res.writeHead(200, { 'Content-Type': contentTypes[extension] || 'application/octet-stream' })
    res.end(content)
  })
})

server.listen(port, '0.0.0.0', () => {
  console.log(`Preview server running on http://localhost:${port}`)
})
