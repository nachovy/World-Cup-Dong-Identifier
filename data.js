// World Cup Players Database - loaded from real API
let worldCupDatabase = [];

// Fetch World Cup data from API
async function loadWorldCupData() {
    try {
        // Load from local *_full.txt aggregated API
        console.log('Loading World Cup player data from *_full.txt...');
        await fetchFromRealAPI();
        console.log('✓ Successfully loaded World Cup data');
    } catch (error) {
        console.error('✗ Failed to load World Cup data:', error);
        throw error;  // Don't use fallback - require real API data
    }
}

// Fetch aggregated data from local *_full.txt parser via proxy
async function fetchFromRealAPI() {
    try {
        console.log('🔗 Fetching historical World Cup data via local parser...');
        
        const response = await fetch('http://localhost:8001/api/worldcup-full');
        
        if (!response.ok) {
            throw new Error(`API returned status ${response.status}`);
        }
        
        const data = await response.json();

        if (!data || !Array.isArray(data.players)) {
            throw new Error('Invalid API response format: missing players array');
        }

        // Exclude 2026 tournaments from current statistics.
        worldCupDatabase = data.players
            .map(player => ({
                ...player,
                tournaments: (player.tournaments || []).filter(t => Number(t.year) !== 2026)
            }))
            .filter(player => player.tournaments.length > 0);
        console.log(`✓ Loaded ${worldCupDatabase.length} players from *_full.txt history`);
        
    } catch (error) {
        throw new Error(`Failed to fetch from *_full.txt parser: ${error.message}`);
    }
}

// Process World Cup data from API
function processWorldCupData(apiData) {
    // Process the API response and convert it to our format
    // This depends on the API structure
    
    if (apiData && apiData.tournaments) {
        const playerMap = {};
        
        // Iterate through tournaments and matches
        apiData.tournaments.forEach(tournament => {
            const year = tournament.year;
            
            if (tournament.matches) {
                tournament.matches.forEach(match => {
                    // Process match data for both teams
                    processTeamPlayers(match.home, year, playerMap);
                    processTeamPlayers(match.away, year, playerMap);
                });
            }
        });
        
        // Convert playerMap to array
        worldCupDatabase = Object.values(playerMap);
        console.log(`Loaded ${worldCupDatabase.length} players from World Cup data`);
    } else {
        throw new Error('Unexpected API data format');
    }
}

// Process players from team data
function processTeamPlayers(teamData, year, playerMap) {
    if (!teamData || !teamData.squad) return;
    
    teamData.squad.forEach(player => {
        const key = player.name;
        
        if (!playerMap[key]) {
            playerMap[key] = {
                name: player.name,
                nationality: teamData.name,
                tournaments: []
            };
        }
        
        // Find or create tournament entry for this year
        let tournament = playerMap[key].tournaments.find(t => t.year === year);
        if (!tournament) {
            tournament = { year, appearances: 0, goals: 0, assists: 0 };
            playerMap[key].tournaments.push(tournament);
        }
        
        // Update statistics if available
        if (player.stats) {
            tournament.appearances = Math.max(tournament.appearances, player.stats.appearances || 0);
            tournament.goals = Math.max(tournament.goals, player.stats.goals || 0);
            tournament.assists = Math.max(tournament.assists, player.stats.assists || 0);
        }
    });
}

// Load fallback data with essential World Cup players
function loadFallbackData() {
    worldCupDatabase = [
        {
            name: "Lionel Messi",
            nationality: "Argentina",
            tournaments: [
                { year: 2006, appearances: 5, goals: 1, assists: 0 },
                { year: 2010, appearances: 5, goals: 0, assists: 0 },
                { year: 2014, appearances: 7, goals: 4, assists: 2 },
                { year: 2018, appearances: 5, goals: 0, assists: 0 },
                { year: 2022, appearances: 7, goals: 7, assists: 3 }
            ]
        },
        {
            name: "Cristiano Ronaldo",
            nationality: "Portugal",
            tournaments: [
                { year: 2006, appearances: 3, goals: 1, assists: 0 },
                { year: 2010, appearances: 4, goals: 0, assists: 0 },
                { year: 2014, appearances: 4, goals: 3, assists: 1 },
                { year: 2018, appearances: 5, goals: 1, assists: 0 }
            ]
        },
        {
            name: "Kylian Mbappé",
            nationality: "France",
            tournaments: [
                { year: 2018, appearances: 7, goals: 4, assists: 3 },
                { year: 2022, appearances: 8, goals: 8, assists: 3 }
            ]
        },
        {
            name: "Harry Kane",
            nationality: "England",
            tournaments: [
                { year: 2018, appearances: 6, goals: 6, assists: 0 },
                { year: 2022, appearances: 7, goals: 3, assists: 0 }
            ]
        },
        {
            name: "Neymar",
            nationality: "Brazil",
            tournaments: [
                { year: 2014, appearances: 4, goals: 4, assists: 0 },
                { year: 2018, appearances: 5, goals: 2, assists: 1 },
                { year: 2022, appearances: 4, goals: 2, assists: 0 }
            ]
        },
        {
            name: "Luis Suárez",
            nationality: "Uruguay",
            tournaments: [
                { year: 2010, appearances: 6, goals: 1, assists: 0 },
                { year: 2014, appearances: 5, goals: 6, assists: 0 },
                { year: 2018, appearances: 4, goals: 2, assists: 0 }
            ]
        },
        {
            name: "Thomas Müller",
            nationality: "Germany",
            tournaments: [
                { year: 2010, appearances: 6, goals: 5, assists: 0 },
                { year: 2014, appearances: 7, goals: 2, assists: 0 },
                { year: 2018, appearances: 3, goals: 0, assists: 0 }
            ]
        },
        {
            name: "Antoine Griezmann",
            nationality: "France",
            tournaments: [
                { year: 2014, appearances: 4, goals: 2, assists: 0 },
                { year: 2018, appearances: 7, goals: 4, assists: 2 },
                { year: 2022, appearances: 4, goals: 0, assists: 0 }
            ]
        },
        {
            name: "Eden Hazard",
            nationality: "Belgium",
            tournaments: [
                { year: 2014, appearances: 5, goals: 1, assists: 0 },
                { year: 2018, appearances: 6, goals: 0, assists: 1 }
            ]
        },
        {
            name: "Luka Modrić",
            nationality: "Croatia",
            tournaments: [
                { year: 2014, appearances: 4, goals: 0, assists: 0 },
                { year: 2018, appearances: 7, goals: 1, assists: 0 }
            ]
        }
    ];
    
    console.log('📋 Using fallback World Cup player data');
}

// Initialize app on page load
if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', function() {
        loadWorldCupData();
    });
}
