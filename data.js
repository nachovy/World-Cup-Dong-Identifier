// World Cup Players Database - loaded from real API
let worldCupDatabase = [];

// Supplemental squad-only entries for players who made the final roster
// but did not appear in matches, so they are still searchable.
const supplementalSquadPlayers = [
    {
        name: 'Geronimo RULLI',
        nationality: 'Argentina',
        tournaments: [
            { year: 2022, appearances: 0, goals: 0, assists: 0 }
        ]
    }
];

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

function playerKey(player) {
    const name = (player.name || '').trim().toLowerCase();
    const nationality = (player.nationality || '').trim().toLowerCase();
    return `${name}::${nationality}`;
}

function mergePlayers(basePlayers, extraPlayers) {
    const map = new Map(basePlayers.map(player => [playerKey(player), player]));

    extraPlayers.forEach(extra => {
        const key = playerKey(extra);
        const existing = map.get(key);

        if (!existing) {
            map.set(key, extra);
            return;
        }

        // Merge tournament rows by year, preserving existing stats when present.
        const byYear = new Map((existing.tournaments || []).map(t => [Number(t.year), t]));
        (extra.tournaments || []).forEach(t => {
            const year = Number(t.year);
            if (!byYear.has(year)) {
                byYear.set(year, t);
            }
        });

        existing.tournaments = Array.from(byYear.values()).sort((a, b) => Number(a.year) - Number(b.year));
    });

    return Array.from(map.values());
}

// Fetch World Cup data from API
async function loadWorldCupData() {
    try {
        // Load from static JSON first (GitHub Pages friendly)
        console.log('Loading World Cup player data...');
        await fetchFromRealAPI();
        console.log('✓ Successfully loaded World Cup data');
    } catch (error) {
        console.error('✗ Failed to load World Cup data:', error);
        throw error;  // Don't use fallback - require real API data
    }
}

// Fetch aggregated data (prefer static JSON for GitHub Pages)
async function fetchFromRealAPI() {
    try {
        let data;

        // 1) GitHub Pages / static hosting path
        try {
            const staticResponse = await fetch('./worldcup-full.json');
            if (staticResponse.ok) {
                data = await staticResponse.json();
                console.log('✓ Loaded data from static worldcup-full.json');
            }
        } catch (e) {
            console.warn('Static JSON not available, trying local parser...');
        }

        // 2) Local development fallback
        if (!data) {
            const localResponse = await fetch('http://localhost:8001/api/worldcup-full');
            if (!localResponse.ok) {
                throw new Error(`API returned status ${localResponse.status}`);
            }
            data = await localResponse.json();
            console.log('✓ Loaded data from local parser');
        }

        if (!data || !Array.isArray(data.players)) {
            throw new Error('Invalid API response format: missing players array');
        }

        // Exclude malformed names and merge squad-only players so they remain searchable.
        const sanitizedPlayers = data.players
            .filter(player => !isLikelyCorruptedPlayerName(player.name))
            .map(player => ({
                ...player,
                tournaments: (player.tournaments || []).filter(t => Number(t.year) !== 2026)
            }));

        worldCupDatabase = mergePlayers(sanitizedPlayers, supplementalSquadPlayers);
        console.log(`✓ Loaded ${worldCupDatabase.length} players from World Cup history`);
        
    } catch (error) {
        throw new Error(`Failed to fetch World Cup data: ${error.message}`);
    }
}
