// Global state
let currentSelectedPlayer = null;
let filteredPlayers = [];
let recordsModal = null;
let recordsModalTitle = null;
let recordsModalMeta = null;
let recordsModalList = null;

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
playerDetails.addEventListener('click', handleDetailsClick);

document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
        closeRecordsModal();
    }
});

// Initialize the application
async function init() {
    try {
        initRecordsModal();
        // Wait for data to load from API before displaying players.
        await loadWorldCupData();
        displayAllPlayers(worldCupDatabase);
    } catch (error) {
        playersList.innerHTML = '<p class="no-records">数据加载失败，请先启动本地解析服务: python3 cors_proxy.py</p>';
        clearPlayerDetails();
        console.error('Initialization failed:', error);
    }
}

function initRecordsModal() {
    if (recordsModal) {
        return;
    }

    const modalHtml = `
        <div id="recordsModal" class="records-modal" hidden>
            <div class="records-modal__backdrop" data-close-modal="true"></div>
            <div class="records-modal__panel" role="dialog" aria-modal="true" aria-labelledby="recordsModalTitle">
                <button class="records-modal__close" data-close-modal="true" aria-label="关闭">×</button>
                <h3 id="recordsModalTitle" class="records-modal__title"></h3>
                <div id="recordsModalMeta" class="records-modal__meta"></div>
                <div id="recordsModalList" class="records-list"></div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);
    recordsModal = document.getElementById('recordsModal');
    recordsModalTitle = document.getElementById('recordsModalTitle');
    recordsModalMeta = document.getElementById('recordsModalMeta');
    recordsModalList = document.getElementById('recordsModalList');

    recordsModal.addEventListener('click', (event) => {
        if (event.target.closest('[data-close-modal="true"]')) {
            closeRecordsModal();
        }
    });
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
                <button class="stat-value stat-open-btn" data-scope="career" data-record-type="appearance" style="color: #fff; font-size: 1.4em; font-weight: 800;">${stats.totalAppearances}</button>
            </div>
            <div class="stat-row" style="border-bottom: 1px solid rgba(255,255,255,0.2);">
                <span class="stat-label" style="color: rgba(255,255,255,0.95);">总进球数:</span>
                <button class="stat-value stat-open-btn" data-scope="career" data-record-type="goal" style="color: #fff; font-size: 1.4em; font-weight: 800;">${stats.totalGoals}</button>
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
                            <button class="tournament-stat-value stat-open-btn" data-scope="tournament" data-year="${tournament.year}" data-record-type="appearance">${tournament.appearances}</button>
                        </div>
                        <div class="tournament-stat">
                            <span class="tournament-stat-label">进球数</span>
                            <button class="tournament-stat-value stat-open-btn" data-scope="tournament" data-year="${tournament.year}" data-record-type="goal">${tournament.goals}</button>
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

function handleDetailsClick(event) {
    const trigger = event.target.closest('.stat-open-btn');
    if (!trigger || !currentSelectedPlayer) {
        return;
    }

    const recordType = trigger.dataset.recordType;
    const scope = trigger.dataset.scope;
    const year = scope === 'tournament' ? Number(trigger.dataset.year) : null;
    openRecordsModal(currentSelectedPlayer, recordType, scope, year);
}

function openRecordsModal(player, recordType, scope, year) {
    initRecordsModal();

    const isGoal = recordType === 'goal';
    const label = isGoal ? '进球' : '出场';
    const records = scope === 'career'
        ? collectCareerRecords(player, recordType)
        : collectTournamentRecords(player, year, recordType);

    const titlePrefix = scope === 'career' ? '全部' : `${year} 年世界杯`;
    recordsModalTitle.textContent = `${player.name} · ${titlePrefix}${label}记录`;
    recordsModalMeta.textContent = `共 ${records.length} 条`;

    if (records.length === 0) {
        recordsModalList.innerHTML = '<p class="records-empty">暂无记录</p>';
    } else {
        recordsModalList.innerHTML = records.map((record, index) => `
            <div class="record-item">
                <div class="record-item__head">
                    <span class="record-item__index">#${index + 1}</span>
                    <span class="record-item__year">${record.year} 年</span>
                </div>
                <div class="record-item__line">对阵: <strong>${record.match}</strong></div>
                <div class="record-item__line">时间: <strong>${record.time}</strong></div>
            </div>
        `).join('');
    }

    recordsModal.hidden = false;
    document.body.classList.add('modal-open');
}

function closeRecordsModal() {
    if (!recordsModal || recordsModal.hidden) {
        return;
    }
    recordsModal.hidden = true;
    document.body.classList.remove('modal-open');
}

function collectCareerRecords(player, recordType) {
    const records = [];
    player.tournaments.forEach(tournament => {
        records.push(...collectTournamentRecords(player, Number(tournament.year), recordType));
    });
    return records;
}

function collectTournamentRecords(player, year, recordType) {
    const tournament = player.tournaments.find(t => Number(t.year) === Number(year));
    if (!tournament) {
        return [];
    }

    const records = getStructuredRecords(tournament, recordType);
    if (records.length > 0) {
        return records.map(record => ({
            year: Number(year),
            match: record.match || record.opponent || '未知对阵',
            time: record.time || record.minute || '时间未知'
        }));
    }

    // Fallback for aggregate-only data source.
    const count = Number(recordType === 'goal' ? tournament.goals : tournament.appearances) || 0;
    return Array.from({ length: count }, (_, index) => ({
        year: Number(year),
        match: `${year} 年世界杯（对阵信息缺失）`,
        time: `第 ${index + 1} 条记录（时间缺失）`
    }));
}

function getStructuredRecords(tournament, recordType) {
    const keys = recordType === 'goal'
        ? ['goalRecords', 'goal_records', 'goals_detail', 'goalDetails']
        : ['appearanceRecords', 'appearance_records', 'appearances_detail', 'appearanceDetails'];

    for (const key of keys) {
        if (Array.isArray(tournament[key])) {
            return tournament[key];
        }
    }

    return [];
}

// Start the application
init();
