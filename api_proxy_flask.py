#!/usr/bin/env python3
"""
Flask-based API proxy server for World Cup data
Properly handles CORS requests
"""

from flask import Flask, jsonify
import urllib.request
import urllib.error
import json

app = Flask(__name__)

# API key for football-data.org
API_KEY = '9e55236dd2ab4e9fb720895179ba8788'

@app.after_request
def after_request(response):
    """Add CORS headers to all responses"""
    response.headers.add('Access-Control-Allow-Origin', '*')
    response.headers.add('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    response.headers.add('Access-Control-Allow-Headers', 'Content-Type, X-Auth-Token')
    return response

@app.route('/api/football-data')
def football_data():
    """Proxy football-data.org API"""
    try:
        url = 'https://api.football-data.org/v4/competitions/WC/players'
        req = urllib.request.Request(url)
        req.add_header('X-Auth-Token', API_KEY)
        
        response = urllib.request.urlopen(req, timeout=10)
        data = json.loads(response.read().decode('utf-8'))
        
        print('✓ Proxied football-data.org request')
        return jsonify(data)
        
    except urllib.error.HTTPError as e:
        print(f'✗ football-data.org error: {e.code}')
        return jsonify({'error': f'HTTP {e.code}'}), e.code
    except Exception as e:
        print(f'✗ Proxy error: {e}')
        return jsonify({'error': str(e)}), 500

@app.route('/api/worldcup')
def worldcup():
    """Proxy worldcupjson.net API"""
    try:
        url = 'https://worldcupjson.net/data.json'
        response = urllib.request.urlopen(url, timeout=10)
        data = json.loads(response.read().decode('utf-8'))
        
        print('✓ Proxied worldcupjson.net request')
        return jsonify(data)
        
    except Exception as e:
        print(f'✗ worldcupjson.net error: {e}')
        return jsonify({'error': str(e)}), 500

@app.route('/health')
def health():
    """Health check endpoint"""
    return jsonify({'status': 'ok'})

if __name__ == '__main__':
    print('🔗 API Proxy started on http://localhost:5000')
    print('   /api/football-data - Football-data.org proxy')
    print('   /api/worldcup      - WorldCupJSON proxy')
    print('   /health            - Health check')
    print('   Press Ctrl+C to stop\n')
    
    app.run(host='127.0.0.1', port=5000, debug=False)
