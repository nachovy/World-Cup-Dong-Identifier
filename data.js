// World Cup Players Database - loaded from openfootball/worldcup repository.
let worldCupDatabase = [];

const OPENFOOTBALL_MORE_API = 'https://api.github.com/repos/openfootball/worldcup/contents/more?ref=master';
const OPENFOOTBALL_RAW_BASE = 'https://raw.githubusercontent.com/openfootball/worldcup/master/more/';

function isLikelyCorruptedPlayerName(name) {
    if (!name || typeof name !== 'string') {
        return true;
    }

    // Reject lineup fragments and malformed names:
    // 1. Substitution minute fragments: "(71' Oscar" or "71' Name"
    // 2. Trailing special chars/parentheses: "Name )", "Name (", etc.
    // 3. Leading/trailing whitespace after stripping
    const trimmed = name.trim();
    if (trimmed !== name || /[()\[\]]$/.test(trimmed)) {
        return true;
    }
    return /\(\s*\d+(?:\+\d+)?'|\d+(?:\+\d+)?'\s+[A-Za-z]/.test(name);
}

function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeTeamKey(value) {
    if (!value) {
        return '';
    }

    return value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/&/g, ' and ')
        .replace(/[^a-z0-9]+/g, '');
}

function canonicalizeTeamName(rawName, knownTeams) {
    if (!rawName) {
        return rawName;
    }

    const key = normalizeTeamKey(rawName);
    const byKey = new Map();
    knownTeams.forEach(team => {
        byKey.set(normalizeTeamKey(team), team);
    });

    return byKey.get(key) || rawName;
}

function sanitizeName(value) {
    return value
        .replace(/\[[^\]]*\]/g, '')
        .replace(/\s*\(\s*\d+(?:\+\d+)?'\s+[^\)]*$/, '')
        .replace(/\s*\d+(?:\+\d+)?'\s+[A-Za-zÀ-ÖØ-öø-ÿ'`.\-\s]+$/, '')
        .replace(/[()\[\]]+\s*$/g, '')
        .trim();
}

function preferAppearanceDetail(existing, incoming) {
    if (!existing) {
        return incoming;
    }

    const score = value => {
        if (value.startsWith('第')) {
            return 3;
        }
        if (value.includes('被换下')) {
            return 2;
        }
        if (value.startsWith('首发')) {
            return 1;
        }
        return 0;
    };

    return score(incoming) > score(existing) ? incoming : existing;
}

function extractParticipants(lineupBlock) {
    const text = lineupBlock
        .replace(/\n/g, ' ')
        .replace(/\[[^\]]*\]/g, '')
        .replace(/ - /g, ', ')
        .replace(/-/g, ',');

    const participants = {};

    text.split(',').forEach(rawToken => {
        const token = rawToken.trim();
        if (!token) {
            return;
        }

        const subMatch = token.match(/^([A-Za-zÀ-ÖØ-öø-ÿ'`.\-\s]+?)\s*\((\d+(?:\+\d+)?')\s*([^\)]+)\)$/);
        if (subMatch) {
            const starterName = sanitizeName(subMatch[1]);
            const minute = subMatch[2];
            const subName = sanitizeName(subMatch[3]);

            if (starterName && !/\d/.test(starterName)) {
                const detail = `首发，第${minute}分钟被换下`;
                participants[starterName] = preferAppearanceDetail(participants[starterName], detail);
            }

            if (subName && !/\d/.test(subName)) {
                const detail = `第${minute}分钟替补登场`;
                participants[subName] = preferAppearanceDetail(participants[subName], detail);
            }
            return;
        }

        const name = sanitizeName(token);
        if (!name || /\d/.test(name)) {
            return;
        }

        participants[name] = preferAppearanceDetail(participants[name], '首发');
    });

    return participants;
}

function extractScorerEvents(scorerText) {
    if (!scorerText) {
        return [];
    }

    const events = [];
    const parts = scorerText
        .replace(/\n/g, ' ')
        .split(',')
        .map(part => part.trim())
        .filter(Boolean);

    let lastScorer = null;
    parts.forEach(part => {
        if (part.includes('(og)')) {
            return;
        }

        const timeOnly = part.match(/^(\d+(?:\+\d+)?'(?:\([^)]+\))?)$/);
        if (timeOnly && lastScorer) {
            events.push({ name: lastScorer, minute: timeOnly[1] });
            return;
        }

        const match = part.match(/^([A-Za-zÀ-ÖØ-öø-ÿ'`.\-\s]+?)\s+(\d+(?:\+\d+)?'(?:\([^)]+\))?)/);
        if (!match) {
            return;
        }

        const name = sanitizeName(match[1]);
        const minute = match[2];
        if (!name) {
            return;
        }

        events.push({ name, minute });
        lastScorer = name;
    });

    return events;
}

function extractSquadPlayersByTeam(squadText) {
    const teams = new Map();
    const headerPattern = /^==\s*(.+?)\s+#\s+\d+\s+Players\s*$/gm;
    const playerPattern = /^\s*(\d+|-)\s*,\s*([^,\n]+?)\s*,\s*(GK|DF|MF|FW|MG)\b/gm;

    const headers = [...squadText.matchAll(headerPattern)];
    headers.forEach((header, index) => {
        const teamName = header[1].trim();
        const start = header.index + header[0].length;
        const end = index + 1 < headers.length ? headers[index + 1].index : squadText.length;
        const block = squadText.slice(start, end);

        const players = [];
        [...block.matchAll(playerPattern)].forEach(playerMatch => {
            const shirtNumber = playerMatch[1];
            const name = sanitizeName(playerMatch[2]);
            const role = playerMatch[3];

            if (shirtNumber === '-' || role === 'MG' || !name) {
                return;
            }

            players.push(name);
        });

        teams.set(teamName, [...new Set(players)]);
    });

    return teams;
}

function buildMatchLabel(team1, team2) {
    return `${team1} vs ${team2}`;
}

function getOrCreatePlayer(playerMap, name, nationality) {
    const key = `${name.toLowerCase()}::${nationality.toLowerCase()}`;
    if (!playerMap.has(key)) {
        playerMap.set(key, {
            name,
            nationality,
            tournaments: new Map()
        });
    }

    return playerMap.get(key);
}

function getOrCreateTournament(player, year) {
    if (!player.tournaments.has(year)) {
        player.tournaments.set(year, {
            year,
            appearances: 0,
            goals: 0,
            assists: 0,
            appearanceRecords: [],
            goalRecords: []
        });
    }

    return player.tournaments.get(year);
}

function parseWorldCupData(fullFileTexts, squadFileTexts) {
    const playerMap = new Map();
    const teamsByYear = new Map();
    const matchPattern = /\n\s*([A-Za-zÀ-ÖØ-öø-ÿ'.\-\s]+?)\sv\s([A-Za-zÀ-ÖØ-öø-ÿ'.\-\s]+?)\s+\d+-\d+(?:[ \t]+[^\n]+)?\n([\s\S]*?)\nRefs:/gm;

    fullFileTexts.forEach(({ year, text }) => {
        const matches = text.matchAll(matchPattern);

        for (const match of matches) {
            const team1 = match[1].trim();
            const team2 = match[2].trim();

            if (!teamsByYear.has(year)) {
                teamsByYear.set(year, new Set());
            }
            teamsByYear.get(year).add(team1);
            teamsByYear.get(year).add(team2);

            const matchBody = match[3];
            const bodyLines = matchBody.split('\n');
            let scorerText = '';
            let detailsBlock = matchBody;

            let idx = 0;
            while (idx < bodyLines.length && !bodyLines[idx].trim()) {
                idx += 1;
            }

            if (idx < bodyLines.length && bodyLines[idx].trimStart().startsWith('(')) {
                const scorerLines = [];
                while (idx < bodyLines.length) {
                    scorerLines.push(bodyLines[idx]);
                    if (bodyLines[idx].trim().endsWith(')')) {
                        idx += 1;
                        break;
                    }
                    idx += 1;
                }

                scorerText = scorerLines.join('\n').trim();
                if (scorerText.startsWith('(')) {
                    scorerText = scorerText.slice(1);
                }
                if (scorerText.endsWith(')')) {
                    scorerText = scorerText.slice(0, -1);
                }
                scorerText = scorerText.trim();

                while (idx < bodyLines.length && !bodyLines[idx].trim()) {
                    idx += 1;
                }
                detailsBlock = bodyLines.slice(idx).join('\n');
            }

            const team1LineupMatch = detailsBlock.match(
                new RegExp(`${escapeRegex(team1)}:\\s*([\\s\\S]*?)(?=\\n${escapeRegex(team2)}:)`)
            );
            const team2LineupMatch = detailsBlock.match(
                new RegExp(`${escapeRegex(team2)}:\\s*([\\s\\S]*?)$`)
            );

            const team1Players = team1LineupMatch ? extractParticipants(team1LineupMatch[1]) : {};
            const team2Players = team2LineupMatch ? extractParticipants(team2LineupMatch[1]) : {};

            Object.entries(team1Players).forEach(([playerName, appearanceTime]) => {
                const player = getOrCreatePlayer(playerMap, playerName, team1);
                const tournament = getOrCreateTournament(player, year);
                tournament.appearances += 1;
                tournament.appearanceRecords.push({
                    match: buildMatchLabel(team1, team2),
                    time: appearanceTime || '时间未知'
                });
            });

            Object.entries(team2Players).forEach(([playerName, appearanceTime]) => {
                const player = getOrCreatePlayer(playerMap, playerName, team2);
                const tournament = getOrCreateTournament(player, year);
                tournament.appearances += 1;
                tournament.appearanceRecords.push({
                    match: buildMatchLabel(team1, team2),
                    time: appearanceTime || '时间未知'
                });
            });

            const team1PlayersLc = new Set(Object.keys(team1Players).map(name => name.toLowerCase()));
            const team2PlayersLc = new Set(Object.keys(team2Players).map(name => name.toLowerCase()));
            const team1GoalEvents = [];
            const team2GoalEvents = [];

            if (scorerText.includes(';')) {
                const [team1Scorers = '', team2Scorers = ''] = scorerText.split(';', 2).map(value => value.trim());
                team1GoalEvents.push(...extractScorerEvents(team1Scorers));
                team2GoalEvents.push(...extractScorerEvents(team2Scorers));
            } else {
                extractScorerEvents(scorerText).forEach(event => {
                    const scorerLc = event.name.toLowerCase();
                    const inTeam1 = team1PlayersLc.has(scorerLc);
                    const inTeam2 = team2PlayersLc.has(scorerLc);

                    if (inTeam1 && !inTeam2) {
                        team1GoalEvents.push(event);
                    } else if (inTeam2 && !inTeam1) {
                        team2GoalEvents.push(event);
                    } else {
                        team1GoalEvents.push(event);
                    }
                });
            }

            team1GoalEvents.forEach(event => {
                const player = getOrCreatePlayer(playerMap, event.name, team1);
                const tournament = getOrCreateTournament(player, year);
                tournament.goals += 1;
                tournament.goalRecords.push({
                    match: buildMatchLabel(team1, team2),
                    time: event.minute || '时间未知'
                });
            });

            team2GoalEvents.forEach(event => {
                const player = getOrCreatePlayer(playerMap, event.name, team2);
                const tournament = getOrCreateTournament(player, year);
                tournament.goals += 1;
                tournament.goalRecords.push({
                    match: buildMatchLabel(team1, team2),
                    time: event.minute || '时间未知'
                });
            });
        }
    });

    squadFileTexts.forEach(({ year, text }) => {
        const squadsByTeam = extractSquadPlayersByTeam(text);
        const knownTeams = teamsByYear.get(year) || new Set();

        squadsByTeam.forEach((squadPlayers, rawTeam) => {
            const team = canonicalizeTeamName(rawTeam, knownTeams);
            squadPlayers.forEach(playerName => {
                const player = getOrCreatePlayer(playerMap, playerName, team);
                getOrCreateTournament(player, year);
            });
        });
    });

    const players = [...playerMap.values()].map(player => ({
        name: player.name,
        nationality: player.nationality,
        tournaments: [...player.tournaments.values()].sort((a, b) => Number(a.year) - Number(b.year))
    }));

    players.sort((a, b) => a.name.localeCompare(b.name));
    return {
        source: 'openfootball/worldcup more/*_full.txt + more/*_squads.txt',
        players
    };
}

// Fetch World Cup data from API
async function loadWorldCupData() {
    try {
        console.log('Loading World Cup player data from openfootball...');
        await fetchFromOpenFootball();
        console.log('✓ Successfully loaded World Cup data');
    } catch (error) {
        console.error('✗ Failed to load World Cup data:', error);
        throw error;
    }
}

async function fetchJson(url) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Request failed: ${response.status} ${url}`);
    }
    return response.json();
}

async function fetchText(url) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Request failed: ${response.status} ${url}`);
    }
    return response.text();
}

async function fetchFromOpenFootball() {
    const listing = await fetchJson(OPENFOOTBALL_MORE_API);
    if (!Array.isArray(listing)) {
        throw new Error('Invalid openfootball listing response');
    }

    const fullFiles = listing
        .filter(item => item.type === 'file' && /^\d{4}_full\.txt$/.test(item.name))
        .map(item => ({
            year: Number(item.name.slice(0, 4)),
            url: item.download_url || `${OPENFOOTBALL_RAW_BASE}${item.name}`
        }))
        .sort((a, b) => a.year - b.year);

    const squadFiles = listing
        .filter(item => item.type === 'file' && /^\d{4}_squads\.txt$/.test(item.name))
        .map(item => ({
            year: Number(item.name.slice(0, 4)),
            url: item.download_url || `${OPENFOOTBALL_RAW_BASE}${item.name}`
        }))
        .sort((a, b) => a.year - b.year);

    if (fullFiles.length === 0) {
        throw new Error('No *_full.txt files found in openfootball repository');
    }

    const [fullTexts, squadTexts] = await Promise.all([
        Promise.all(fullFiles.map(async file => ({ year: file.year, text: await fetchText(file.url) }))),
        Promise.all(squadFiles.map(async file => ({ year: file.year, text: await fetchText(file.url) })))
    ]);

    const data = parseWorldCupData(fullTexts, squadTexts);

    const sanitizedPlayers = data.players
        .filter(player => !isLikelyCorruptedPlayerName(player.name))
        .map(player => ({
            ...player,
            tournaments: player.tournaments || []
        }));

    worldCupDatabase = sanitizedPlayers;
    console.log(`✓ Loaded ${worldCupDatabase.length} players from openfootball/worldcup`);
}
