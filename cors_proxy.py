#!/usr/bin/env python3
"""
Simple HTTP API proxy with proper CORS headers
Uses only standard library
"""

from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.request import Request, urlopen
from urllib.error import HTTPError
import json
import sys
import re
from pathlib import Path


WORLD_CUP_MORE_DIR = Path('/Users/miguel/worldcup/more')


def _sanitize_name(value):
    value = re.sub(r'\[[^\]]*\]', '', value)
    # Remove malformed substitution snippets that may miss a closing parenthesis,
    # e.g. "Norberto ALONSO (71' Oscar ORTIZ".
    value = re.sub(r"\s*\(\s*\d+(?:\+\d+)?'\s+[^\)]*$", '', value)
    value = re.sub(r"\s*\d+(?:\+\d+)?'\s+[A-Za-zÀ-ÖØ-öø-ÿ'`\.\-\s]+$", '', value)
    # Remove trailing orphaned parentheses/brackets from malformed lineup fragments
    value = re.sub(r'[()\[\]]+\s*$', '', value)
    value = value.strip()
    return value


def _extract_participants(lineup_block):
    text = lineup_block.replace('\n', ' ')
    text = re.sub(r'\[[^\]]*\]', '', text)

    subs_in = re.findall(r"\((?:\d+(?:\+\d+)?'\s*)([^\)]+)\)", text)
    sub_names = [_sanitize_name(name) for name in subs_in if _sanitize_name(name)]

    starters_text = re.sub(r"\((?:\d+(?:\+\d+)?'[^\)]*)\)", '', text)
    starters_text = starters_text.replace(' - ', ', ')
    starters_text = starters_text.replace('-', ',')

    starters = []
    for token in starters_text.split(','):
        name = _sanitize_name(token)
        if not name:
            continue
        if any(ch.isdigit() for ch in name):
            continue
        starters.append(name)

    return set(starters + sub_names)


def _extract_scorer_counts(scorer_text):
    counts = {}
    if not scorer_text:
        return counts

    cleaned = scorer_text.replace('\n', ' ')
    parts = [p.strip() for p in cleaned.split(',') if p.strip()]
    last_scorer = None
    for part in parts:
        if '(og)' in part:
            continue

        # Some records omit repeated names and only list extra goal times,
        # e.g. "Lionel MESSI 23'(p), 108'".
        if re.match(r"^\d+(?:\+\d+)?'", part) and last_scorer:
            counts[last_scorer] = counts.get(last_scorer, 0) + 1
            continue

        match = re.match(r"^([A-Za-zÀ-ÖØ-öø-ÿ'`\.\-\s]+?)\s+\d", part)
        if not match:
            continue
        name = _sanitize_name(match.group(1))
        if not name:
            continue
        counts[name] = counts.get(name, 0) + 1
        last_scorer = name

    return counts


def _get_or_create_player(player_map, name, nationality):
    key = f"{name.lower()}::{nationality.lower()}"
    if key not in player_map:
        player_map[key] = {
            'name': name,
            'nationality': nationality,
            'tournaments': {}
        }
    return player_map[key]


def _get_or_create_tournament(player, year):
    if year not in player['tournaments']:
        player['tournaments'][year] = {
            'year': year,
            'appearances': 0,
            'goals': 0,
            'assists': 0
        }
    return player['tournaments'][year]


def parse_worldcup_full_files():
    player_map = {}

    full_files = sorted(WORLD_CUP_MORE_DIR.glob('*_full.txt'))
    for file_path in full_files:
        year_match = re.match(r'^(\d{4})_full\.txt$', file_path.name)
        if not year_match:
            continue
        year = int(year_match.group(1))
        if year == 2026:
            continue

        text = file_path.read_text(encoding='utf-8', errors='ignore')

        match_pattern = re.compile(
            r"\n\s*([A-Za-zÀ-ÖØ-öø-ÿ'\.\-\s]+?)\sv\s([A-Za-zÀ-ÖØ-öø-ÿ'\.\-\s]+?)\s+\d+-\d+(?:[ \t]+[^\n]+)?\n"
            r"([\s\S]*?)\nRefs:",
            re.MULTILINE
        )

        for match in match_pattern.finditer(text):
            team1 = match.group(1).strip()
            team2 = match.group(2).strip()

            match_body = match.group(3)
            scorers_text = ''
            details_block = match_body

            body_lines = match_body.splitlines()
            idx = 0
            while idx < len(body_lines) and not body_lines[idx].strip():
                idx += 1

            if idx < len(body_lines) and body_lines[idx].lstrip().startswith('('):
                scorer_lines = []
                while idx < len(body_lines):
                    scorer_lines.append(body_lines[idx])
                    if body_lines[idx].strip().endswith(')'):
                        idx += 1
                        break
                    idx += 1

                merged = '\n'.join(scorer_lines).strip()
                if merged.startswith('('):
                    merged = merged[1:]
                if merged.endswith(')'):
                    merged = merged[:-1]
                scorers_text = merged.strip()

                while idx < len(body_lines) and not body_lines[idx].strip():
                    idx += 1
                details_block = '\n'.join(body_lines[idx:])

            team1_lineup_match = re.search(rf"{re.escape(team1)}:\s*([\s\S]*?)(?=\n{re.escape(team2)}:)", details_block)
            team2_lineup_match = re.search(rf"{re.escape(team2)}:\s*([\s\S]*?)$", details_block)

            team1_players = _extract_participants(team1_lineup_match.group(1)) if team1_lineup_match else set()
            team2_players = _extract_participants(team2_lineup_match.group(1)) if team2_lineup_match else set()

            for player_name in team1_players:
                player = _get_or_create_player(player_map, player_name, team1)
                tournament = _get_or_create_tournament(player, year)
                tournament['appearances'] += 1

            for player_name in team2_players:
                player = _get_or_create_player(player_map, player_name, team2)
                tournament = _get_or_create_tournament(player, year)
                tournament['appearances'] += 1

            team1_scorers_text = ''
            team2_scorers_text = ''
            team1_goal_counts = {}
            team2_goal_counts = {}

            team1_players_lc = {p.lower() for p in team1_players}
            team2_players_lc = {p.lower() for p in team2_players}

            if ';' in scorers_text:
                team1_scorers_text, team2_scorers_text = [s.strip() for s in scorers_text.split(';', 1)]
                team1_goal_counts = _extract_scorer_counts(team1_scorers_text)
                team2_goal_counts = _extract_scorer_counts(team2_scorers_text)
            else:
                # Some lines only list scorers for one side without ";".
                # Resolve team ownership via lineup membership.
                single_side_goal_counts = _extract_scorer_counts(scorers_text)
                for scorer, goals in single_side_goal_counts.items():
                    scorer_lc = scorer.lower()
                    in_team1 = scorer_lc in team1_players_lc
                    in_team2 = scorer_lc in team2_players_lc

                    if in_team1 and not in_team2:
                        team1_goal_counts[scorer] = team1_goal_counts.get(scorer, 0) + goals
                    elif in_team2 and not in_team1:
                        team2_goal_counts[scorer] = team2_goal_counts.get(scorer, 0) + goals
                    else:
                        # Fallback: keep historical behavior if unresolved.
                        team1_goal_counts[scorer] = team1_goal_counts.get(scorer, 0) + goals

            for scorer, goals in team1_goal_counts.items():
                player = _get_or_create_player(player_map, scorer, team1)
                tournament = _get_or_create_tournament(player, year)
                tournament['goals'] += goals

            for scorer, goals in team2_goal_counts.items():
                player = _get_or_create_player(player_map, scorer, team2)
                tournament = _get_or_create_tournament(player, year)
                tournament['goals'] += goals

    players = []
    for player in player_map.values():
        tournaments = sorted(player['tournaments'].values(), key=lambda t: t['year'])
        players.append({
            'name': player['name'],
            'nationality': player['nationality'],
            'tournaments': tournaments
        })

    players.sort(key=lambda p: p['name'].lower())
    return {
        'source': 'worldcup-more-full-txt',
        'players': players,
        'count': len(players)
    }

class CORSHandler(BaseHTTPRequestHandler):
    API_KEY = '9e55236dd2ab4e9fb720895179ba8788'  # User's valid football-data.org API key
    
    def log_message(self, format, *args):
        """Custom logging"""
        print(f'[{self.client_address[0]}] {format % args}')
    
    def send_cors_headers(self):
        """Send CORS headers"""
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
    
    def do_OPTIONS(self):
        """Handle CORS preflight"""
        self.send_response(200)
        self.send_cors_headers()
        self.end_headers()
    
    def do_GET(self):
        if self.path == '/api/football-data':
            self.handle_football_data()
        elif self.path == '/api/worldcup-full':
            self.handle_worldcup_full()
        elif self.path == '/api/worldcup':
            self.handle_worldcup()
        elif self.path == '/health':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_cors_headers()
            self.end_headers()
            self.wfile.write(b'{"status":"ok"}')
        else:
            self.send_response(404)
            self.send_cors_headers()
            self.end_headers()
    
    def handle_football_data(self):
        """Proxy football-data.org World Cup teams and players"""
        try:
            # Fetch World Cup teams with squad info
            req = Request('https://api.football-data.org/v4/competitions/2000/teams')
            req.add_header('X-Auth-Token', self.API_KEY)
            
            with urlopen(req, timeout=10) as response:
                data = response.read()
            
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_cors_headers()
            self.end_headers()
            self.wfile.write(data)
            print('✓ football-data.org World Cup teams request successful')
            
        except HTTPError as e:
            self.send_response(e.code)
            self.send_header('Content-Type', 'application/json')
            self.send_cors_headers()
            self.end_headers()
            self.wfile.write(json.dumps({'error': f'HTTP {e.code}'}).encode())
            print(f'✗ football-data.org error: {e.code}')
        except Exception as e:
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.send_cors_headers()
            self.end_headers()
            self.wfile.write(json.dumps({'error': str(e)}).encode())
            print(f'✗ Error: {e}')
    
    def handle_worldcup(self):
        """Proxy worldcupjson.net"""
        try:
            with urlopen('https://worldcupjson.net/data.json', timeout=10) as response:
                data = response.read()
            
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_cors_headers()
            self.end_headers()
            self.wfile.write(data)
            print('✓ worldcupjson.net request successful')
            
        except Exception as e:
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.send_cors_headers()
            self.end_headers()
            self.wfile.write(json.dumps({'error': str(e)}).encode())
            print(f'✗ worldcupjson.net error: {e}')

    def handle_worldcup_full(self):
        """Parse local *_full.txt World Cup files and return aggregated player stats."""
        try:
            data = parse_worldcup_full_files()
            payload = json.dumps(data, ensure_ascii=False).encode('utf-8')

            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_cors_headers()
            self.end_headers()
            self.wfile.write(payload)
            print(f"✓ Parsed local World Cup full files: {data['count']} players")
        except Exception as e:
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.send_cors_headers()
            self.end_headers()
            self.wfile.write(json.dumps({'error': str(e)}).encode())
            print(f'✗ worldcup full parse error: {e}')

if __name__ == '__main__':
    PORT = 8001
    server = HTTPServer(('127.0.0.1', PORT), CORSHandler)
    print(f'🔗 API Proxy started on http://localhost:{PORT}')
    print(f'   GET /api/football-data  - Football-data.org proxy')
    print(f'   GET /api/worldcup-full  - Local *_full.txt parser')
    print(f'   GET /api/worldcup       - WorldCupJSON proxy')
    print(f'   GET /health             - Health check')
    print(f'   All responses include CORS headers')
    print(f'   Press Ctrl+C to stop\n')
    
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n✓ Proxy stopped')
        sys.exit(0)
