// World Cup Players Database - loaded from real API
let worldCupDatabase = [];

function isLikelyCorruptedPlayerName(name) {
    if (!name || typeof name !== 'string') {
        return true;
    }

    // Reject lineup fragments accidentally parsed as names, e.g. "(71' Oscar ORTIZ".
    return /\(\s*\d+(?:\+\d+)?'|\d+(?:\+\d+)?'\s+[A-Za-z]/.test(name);
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

        // Exclude 2026 tournaments and malformed names from current statistics.
        worldCupDatabase = data.players
            .filter(player => !isLikelyCorruptedPlayerName(player.name))
            .map(player => ({
                ...player,
                tournaments: (player.tournaments || []).filter(t => Number(t.year) !== 2026)
            }))
            .filter(player => player.tournaments.length > 0);
        console.log(`✓ Loaded ${worldCupDatabase.length} players from World Cup history`);
        
    } catch (error) {
        throw new Error(`Failed to fetch World Cup data: ${error.message}`);
    }
}
