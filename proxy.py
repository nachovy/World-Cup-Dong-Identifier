#!/usr/bin/env python3
"""
Simple reverse proxy to forward requests from localhost:80 to localhost:8000
This helps bypass CORS restrictions that only allow http://localhost
"""

import sys
try:
    from http.server import HTTPServer, BaseHTTPRequestHandler
    import urllib.request
    import urllib.error
except ImportError:
    print("Error: Required modules not found")
    sys.exit(1)

TARGET_HOST = 'localhost'
TARGET_PORT = 8000
PROXY_PORT = 80

class ProxyHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.proxy_request('GET')
    
    def do_POST(self):
        self.proxy_request('POST')
    
    def do_PUT(self):
        self.proxy_request('PUT')
    
    def do_DELETE(self):
        self.proxy_request('DELETE')
    
    def do_HEAD(self):
        self.proxy_request('HEAD')
    
    def proxy_request(self, method):
        # Build target URL
        target_url = f'http://{TARGET_HOST}:{TARGET_PORT}{self.path}'
        
        try:
            # Create request
            req = urllib.request.Request(target_url, method=method)
            
            # Copy headers
            for header, value in self.headers.items():
                if header.lower() not in ['host', 'connection']:
                    req.add_header(header, value)
            
            # Copy body if present
            if method in ['POST', 'PUT']:
                content_length = self.headers.get('Content-Length')
                if content_length:
                    body = self.rfile.read(int(content_length))
                    req.data = body
            
            # Make request
            response = urllib.request.urlopen(req)
            
            # Send response
            self.send_response(response.status)
            for header, value in response.headers.items():
                if header.lower() not in ['connection', 'content-encoding']:
                    self.send_header(header, value)
            self.end_headers()
            
            # Send body
            self.wfile.write(response.read())
            
        except urllib.error.HTTPError as e:
            self.send_response(e.code)
            self.send_header('Content-Type', 'text/plain')
            self.end_headers()
            self.wfile.write(f'Error: {e.reason}'.encode())
        except Exception as e:
            self.send_response(500)
            self.send_header('Content-Type', 'text/plain')
            self.end_headers()
            self.wfile.write(f'Proxy Error: {str(e)}'.encode())
    
    def log_message(self, format, *args):
        # Custom logging
        print(f'[Proxy] {self.address_string()} - {format % args}')

if __name__ == '__main__':
    server = HTTPServer(('127.0.0.1', PROXY_PORT), ProxyHandler)
    print(f'🔗 Reverse proxy started on http://localhost:{PROXY_PORT}')
    print(f'   Forwarding to http://{TARGET_HOST}:{TARGET_PORT}')
    print(f'   This allows football-data.org API calls from http://localhost')
    print(f'   Press Ctrl+C to stop\n')
    
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n✓ Proxy stopped')
        sys.exit(0)
