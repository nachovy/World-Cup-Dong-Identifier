// Global state
let currentSelectedPlayer = null;
let filteredPlayers = [];

// DOM elements
const searchInput = document.getElementById('searchInput');
const playersList = document.getElementById('playersList');
const playerDetails = document.getElementById('playerDetails');

// Utility function to normalize strings for fuzzy search
// Removes accents and converts to lowercase
function normalizeString(str) {
    return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

// Event listeners
searchInput.addEventListener('input', handleSearch);

// Initialize the application
async function init() {
    try {
        // Wait for data to load from API before displaying players.
        await loadWorldCupData();
        displayAllPlayers(worldCupDatabase);
    } catch (error) {
        playersList.innerHTML = '<p class="no-records">数据加载失败，请先启动本地解析服务: python3 cors_proxy.py</p>';
        clearPlayerDetails();
        console.error('Initialization failed:', error);
    }
}

// Search functionality with fuzzy matching
function handleSearch(e) {
    const searchTerm = normalizeString(e.target.value.trim());
    
    if (searchTerm === '') {
        filteredPlayers = worldCupDatabase;
    } else {
        filteredPlayers = worldCupDatabase.filter(player => 
            normalizeString(player.name).includes(searchTerm) ||
            normalizeString(player.nationality).includes(searchTerm)
        );
    }
    
    displayAllPlayers(filteredPlayers);
    
    // Clear player details if no results
    if (filteredPlayers.length === 0) {
        clearPlayerDetails();
    }
}

// Display all players in the list
function displayAllPlayers(players) {
    playersList.innerHTML = '';
    
    if (players.length === 0) {
        playersList.innerHTML = '<p class="no-records">未找到匹配的球员</p>';
        return;
    }
    
    players.forEach(player => {
        const playerDiv = document.createElement('div');
        playerDiv.className = 'player-item';
        if (currentSelectedPlayer && currentSelectedPlayer.name === player.name) {
            playerDiv.classList.add('active');
        }
        playerDiv.textContent = `${player.name} (${player.nationality})`;
        playerDiv.addEventListener('click', () => selectPlayer(player));
        playersList.appendChild(playerDiv);
    });
}

// Select a player and display details
function selectPlayer(player) {
    currentSelectedPlayer = player;
    
    // Update active state in list
    const playerItems = document.querySelectorAll('.player-item');
    playerItems.forEach(item => {
        item.classList.remove('active');
        if (item.textContent.includes(player.name)) {
            item.classList.add('active');
        }
    });
    
    // Display player details
    displayPlayerDetails(player);
}

// Display player details and statistics
function displayPlayerDetails(player) {
    let html = `
        <div class="player-info">
            <div class="player-name">${player.name}</div>
            <div class="player-nationality">国家: ${player.nationality}</div>
    `;
    
    // Calculate career statistics
    const stats = calculateCareerStats(player.tournaments);
    
    // Display career summary statistics with enhanced styling
    html += `
        <div class="statistics" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border-left: 4px solid #fff;">
            <h3 style="color: white; border-bottom: 1px solid rgba(255,255,255,0.3); margin-bottom: 12px;">职业总统计</h3>
            <div class="stat-row" style="border-bottom: 1px solid rgba(255,255,255,0.2);">
                <span class="stat-label" style="color: rgba(255,255,255,0.95);">参加世界杯次数:</span>
                <span class="stat-value" style="color: #fff; font-size: 1.4em; font-weight: 800;">${player.tournaments.length}</span>
            </div>
            <div class="stat-row" style="border-bottom: 1px solid rgba(255,255,255,0.2);">
                <span class="stat-label" style="color: rgba(255,255,255,0.95);">总出场次数:</span>
                <span class="stat-value" style="color: #fff; font-size: 1.4em; font-weight: 800;">${stats.totalAppearances}</span>
            </div>
            <div class="stat-row" style="border-bottom: 1px solid rgba(255,255,255,0.2);">
                <span class="stat-label" style="color: rgba(255,255,255,0.95);">总进球数:</span>
                <span class="stat-value" style="color: #fff; font-size: 1.4em; font-weight: 800;">${stats.totalGoals}</span>
            </div>
        </div>
    `;
    
    // Display tournament history
    html += `
        <div class="world-cup-history">
            <h3>世界杯历史参赛记录</h3>
    `;
    
    if (player.tournaments.length === 0) {
        html += '<p class="no-records">无参赛记录</p>';
    } else {
        player.tournaments.forEach(tournament => {
            html += `
                <div class="tournament-record">
                    <div class="tournament-year">${tournament.year}年世界杯</div>
                    <div class="tournament-stats">
                        <div class="tournament-stat">
                            <span class="tournament-stat-label">出场次数</span>
                            <span class="tournament-stat-value">${tournament.appearances}</span>
                        </div>
                        <div class="tournament-stat">
                            <span class="tournament-stat-label">进球数</span>
                            <span class="tournament-stat-value">${tournament.goals}</span>
                        </div>
                    </div>
                </div>
            `;
        });
    }
    
    html += `
        </div>
        </div>
    `;
    
    playerDetails.innerHTML = html;
}

// Clear player details
function clearPlayerDetails() {
    playerDetails.innerHTML = '<p class="placeholder-text">请选择一名球员查看详细信息</p>';
}

// Calculate career statistics
function calculateCareerStats(tournaments) {
    return {
        totalAppearances: tournaments.reduce((sum, t) => sum + t.appearances, 0),
        totalGoals: tournaments.reduce((sum, t) => sum + t.goals, 0)
    };
}

// Start the application
init();
