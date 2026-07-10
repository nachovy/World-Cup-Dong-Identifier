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
import unicodedata
from pathlib import Path


WORLD_CUP_MORE_DIR = Path('/Users/miguel/worldcup/more')


def _normalize_team_key(value):
    if not value:
        return ''
    normalized = unicodedata.normalize('NFD', value)
    normalized = ''.join(ch for ch in normalized if unicodedata.category(ch) != 'Mn')
    normalized = normalized.lower().replace('&', ' and ')
    normalized = re.sub(r'[^a-z0-9]+', '', normalized)
    return normalized


def _canonicalize_team_name(raw_name, known_teams):
    if not raw_name:
        return raw_name
    key = _normalize_team_key(raw_name)
    by_key = {_normalize_team_key(team): team for team in known_teams}
    return by_key.get(key, raw_name)


def _extract_squad_players_by_team(squad_text):
    teams = {}
    team_header_pattern = re.compile(r"^==\s*(.+?)\s+#\s+\d+\s+Players\s*$", re.MULTILINE)
    player_pattern = re.compile(r"^\s*(\d+|-)\s*,\s*([^,\n]+?)\s*,\s*(GK|DF|MF|FW|MG)\b", re.MULTILINE)

    team_headers = list(team_header_pattern.finditer(squad_text))
    for index, header in enumerate(team_headers):
        team_name = header.group(1).strip()
        start = header.end()
        end = team_headers[index + 1].start() if index + 1 < len(team_headers) else len(squad_text)
        block = squad_text[start:end]

        players = []
        for player_match in player_pattern.finditer(block):
            shirt_number = player_match.group(1)
            name = _sanitize_name(player_match.group(2))
            role = player_match.group(3)

            if shirt_number == '-' or role == 'MG':
                continue
            if not name:
                continue

            players.append(name)

        # Preserve order while deduplicating possible wrapped duplicates.
        teams[team_name] = list(dict.fromkeys(players))

    return teams


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


def _prefer_appearance_detail(existing, incoming):
    if not existing:
        return incoming

    priorities = {
        '第': 3,        # e.g. "第45'分钟替补登场"
        '被换下': 2,    # e.g. "首发，第72'分钟被换下"
        '首发': 1
    }

    def score(value):
        if value.startswith('第'):
            return priorities['第']
        if '被换下' in value:
            return priorities['被换下']
        if value.startswith('首发'):
            return priorities['首发']
        return 0

    return incoming if score(incoming) > score(existing) else existing


def _extract_participants(lineup_block):
    text = lineup_block.replace('\n', ' ')
    text = re.sub(r'\[[^\]]*\]', '', text)
    text = text.replace(' - ', ', ')
    text = text.replace('-', ',')

    participants = {}

    for raw_token in text.split(','):
        token = raw_token.strip()
        if not token:
            continue

        sub_match = re.match(
            r"^([A-Za-zÀ-ÖØ-öø-ÿ'`\.\-\s]+?)\s*\((\d+(?:\+\d+)?')\s*([^\)]+)\)$",
            token
        )
        if sub_match:
            starter_name = _sanitize_name(sub_match.group(1))
            minute = sub_match.group(2)
            sub_name = _sanitize_name(sub_match.group(3))

            if starter_name and not any(ch.isdigit() for ch in starter_name):
                detail = f"首发，第{minute}分钟被换下"
                participants[starter_name] = _prefer_appearance_detail(participants.get(starter_name), detail)

            if sub_name and not any(ch.isdigit() for ch in sub_name):
                detail = f"第{minute}分钟替补登场"
                participants[sub_name] = _prefer_appearance_detail(participants.get(sub_name), detail)
            continue

        name = _sanitize_name(token)
        if not name:
            continue
        if any(ch.isdigit() for ch in name):
            continue

        participants[name] = _prefer_appearance_detail(participants.get(name), '首发')

    return participants

def _extract_scorer_events(scorer_text):
    events = []
    if not scorer_text:
        return events

    cleaned = scorer_text.replace('\n', ' ')
    parts = [p.strip() for p in cleaned.split(',') if p.strip()]
    last_scorer = None
    for part in parts:
        if '(og)' in part:
            continue

        # Some records omit repeated names and only list extra goal times,
        # e.g. "Lionel MESSI 23'(p), 108'".
        time_only = re.match(r"^(\d+(?:\+\d+)?'(?:\([^)]+\))?)$", part)
        if time_only and last_scorer:
            events.append({'name': last_scorer, 'minute': time_only.group(1)})
            continue

        match = re.match(
            r"^([A-Za-zÀ-ÖØ-öø-ÿ'`\.\-\s]+?)\s+(\d+(?:\+\d+)?'(?:\([^)]+\))?)",
            part
        )
        if not match:
            continue

        name = _sanitize_name(match.group(1))
        minute = match.group(2)
        if not name:
            continue

        events.append({'name': name, 'minute': minute})
        last_scorer = name

    return events


def _build_match_label(team1, team2):
    return f"{team1} vs {team2}"


def _build_appearance_record(team1, team2, appearance_time):
    return {
        'match': _build_match_label(team1, team2),
        'time': appearance_time or '时间未知'
    }


def _build_goal_record(team1, team2, minute):
    return {
        'match': _build_match_label(team1, team2),
        'time': minute or '时间未知'
    }


def _extract_scorer_counts(scorer_text):
    counts = {}
    for event in _extract_scorer_events(scorer_text):
        name = event['name']
        counts[name] = counts.get(name, 0) + 1

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
            'assists': 0,
            'appearanceRecords': [],
            'goalRecords': []
        }
    return player['tournaments'][year]


def parse_worldcup_full_files():
    player_map = {}
    teams_by_year = {}

    full_files = sorted(WORLD_CUP_MORE_DIR.glob('*_full.txt'))
    for file_path in full_files:
        year_match = re.match(r'^(\d{4})_full\.txt$', file_path.name)
        if not year_match:
            continue
        year = int(year_match.group(1))

        text = file_path.read_text(encoding='utf-8', errors='ignore')

        match_pattern = re.compile(
            r"\n\s*([A-Za-zÀ-ÖØ-öø-ÿ'\.\-\s]+?)\sv\s([A-Za-zÀ-ÖØ-öø-ÿ'\.\-\s]+?)\s+\d+-\d+(?:[ \t]+[^\n]+)?\n"
            r"([\s\S]*?)\nRefs:",
            re.MULTILINE
        )

        for match in match_pattern.finditer(text):
            team1 = match.group(1).strip()
            team2 = match.group(2).strip()
            teams_by_year.setdefault(year, set()).update([team1, team2])
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

            team1_players = _extract_participants(team1_lineup_match.group(1)) if team1_lineup_match else {}
            team2_players = _extract_participants(team2_lineup_match.group(1)) if team2_lineup_match else {}

            for player_name, appearance_time in team1_players.items():
                player = _get_or_create_player(player_map, player_name, team1)
                tournament = _get_or_create_tournament(player, year)
                tournament['appearances'] += 1
                tournament['appearanceRecords'].append(_build_appearance_record(team1, team2, appearance_time))

            for player_name, appearance_time in team2_players.items():
                player = _get_or_create_player(player_map, player_name, team2)
                tournament = _get_or_create_tournament(player, year)
                tournament['appearances'] += 1
                tournament['appearanceRecords'].append(_build_appearance_record(team1, team2, appearance_time))

            team1_scorers_text = ''
            team2_scorers_text = ''
            team1_goal_events = []
            team2_goal_events = []

            team1_players_lc = {p.lower() for p in team1_players.keys()}
            team2_players_lc = {p.lower() for p in team2_players.keys()}

            if ';' in scorers_text:
                team1_scorers_text, team2_scorers_text = [s.strip() for s in scorers_text.split(';', 1)]
                team1_goal_events = _extract_scorer_events(team1_scorers_text)
                team2_goal_events = _extract_scorer_events(team2_scorers_text)
            else:
                # Some lines only list scorers for one side without ";".
                # Resolve team ownership via lineup membership.
                single_side_goal_events = _extract_scorer_events(scorers_text)
                for event in single_side_goal_events:
                    scorer = event['name']
                    scorer_lc = scorer.lower()
                    in_team1 = scorer_lc in team1_players_lc
                    in_team2 = scorer_lc in team2_players_lc

                    if in_team1 and not in_team2:
                        team1_goal_events.append(event)
                    elif in_team2 and not in_team1:
                        team2_goal_events.append(event)
                    else:
                        # Fallback: keep historical behavior if unresolved.
                        team1_goal_events.append(event)

            for event in team1_goal_events:
                scorer = event['name']
                player = _get_or_create_player(player_map, scorer, team1)
                tournament = _get_or_create_tournament(player, year)
                tournament['goals'] += 1
                tournament['goalRecords'].append(_build_goal_record(team1, team2, event.get('minute')))

            for event in team2_goal_events:
                scorer = event['name']
                player = _get_or_create_player(player_map, scorer, team2)
                tournament = _get_or_create_tournament(player, year)
                tournament['goals'] += 1
                tournament['goalRecords'].append(_build_goal_record(team1, team2, event.get('minute')))

    # Merge official squad lists so non-appearing squad players are still searchable.
    squad_files = sorted(WORLD_CUP_MORE_DIR.glob('*_squads.txt'))
    for file_path in squad_files:
        year_match = re.match(r'^(\d{4})_squads\.txt$', file_path.name)
        if not year_match:
            continue

        year = int(year_match.group(1))

        squads_text = file_path.read_text(encoding='utf-8', errors='ignore')
        squads_by_team = _extract_squad_players_by_team(squads_text)
        known_teams = teams_by_year.get(year, set())

        for raw_team, squad_players in squads_by_team.items():
            team = _canonicalize_team_name(raw_team, known_teams)
            for player_name in squad_players:
                player = _get_or_create_player(player_map, player_name, team)
                _get_or_create_tournament(player, year)

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
