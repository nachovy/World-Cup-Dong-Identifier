#!/usr/bin/env python3
"""
Backend proxy server for World Cup API requests
Runs on port 5000 and proxies requests to football-data.org
This bypasses CORS restrictions
"""

from http.server import HTTPServer, BaseHTTPRequestHandler
import urllib.request
import urllib.error
import urllib.parse
import json

class APIProxyHandler(BaseHTTPRequestHandler):
    # Football-data.org API key
    API_KEY = '9e55236dd2ab4e9fb720895179ba8788'
    
    def end_headers(self):
        """Override to add CORS headers to all responses"""
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, X-Auth-Token')
        BaseHTTPRequestHandler.end_headers(self)
    
    def do_GET(self):
        if self.path == '/api/football-data':
            self.proxy_football_data()
        elif self.path == '/api/worldcup':
            self.proxy_worldcup()
        else:
            self.send_response(404)
            self.end_headers()
    
    def proxy_football_data(self):
        """Proxy requests to football-data.org"""
        try:
            url = 'https://api.football-data.org/v4/competitions/WC/players'
            req = urllib.request.Request(url)
            req.add_header('X-Auth-Token', self.API_KEY)
            
            response = urllib.request.urlopen(req)
            data = response.read()
            
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(data)
            print(f'✓ Proxied football-data.org request')
            
        except urllib.error.HTTPError as e:
            self.send_response(e.code)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({'error': str(e)}).encode())
            print(f'✗ football-data.org error: {e.code}')
        except Exception as e:
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({'error': str(e)}).encode())
            print(f'✗ Proxy error: {e}')
    
    def proxy_worldcup(self):
        """Proxy requests to worldcupjson.net"""
        try:
            url = 'https://worldcupjson.net/data.json'
            response = urllib.request.urlopen(url)
            data = response.read()
            
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(data)
            print(f'✓ Proxied worldcupjson.net request')
            
        except Exception as e:
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({'error': str(e)}).encode())
            print(f'✗ worldcupjson.net error: {e}')
    
    def do_OPTIONS(self):
        """Handle CORS preflight requests"""
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, X-Auth-Token')
        self.end_headers()
    
    def log_message(self, format, *args):
        return  # Suppress default logging

if __name__ == '__main__':
    PORT = 5000
    server = HTTPServer(('127.0.0.1', PORT), APIProxyHandler)
    print(f'🔗 API Proxy started on http://localhost:{PORT}')
    print(f'   /api/football-data - Football-data.org proxy')
    print(f'   /api/worldcup      - WorldCupJSON proxy')
    print(f'   Press Ctrl+C to stop\n')
    
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n✓ Proxy stopped')
