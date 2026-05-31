// === Canvas ===
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';
    if (typeof player !== 'undefined' && player) {
        player.x = Math.min(Math.max(player.x, player.radius), canvas.width - player.radius);
        player.y = Math.min(Math.max(player.y, player.radius), canvas.height - player.radius);
    }
    if (typeof boss !== 'undefined' && boss) {
        boss.x = Math.min(Math.max(boss.x, boss.radius), canvas.width - boss.radius);
        boss.y = Math.min(Math.max(boss.y, boss.radius), canvas.height - boss.radius);
    }
    if (!gameMode) initMenuEnemies();
}

// === Звуковая система ===
let audioCtx = null;
let soundVolume = 0.3;
function initAudio() { if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
function playSound(type) {
    if (!audioCtx) return;
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain); gain.connect(audioCtx.destination);
    const vol = soundVolume * 0.6;
    if (type === 'shoot') {
        osc.type = 'square'; osc.frequency.setValueAtTime(800, now); osc.frequency.exponentialRampToValueAtTime(200, now+0.1);
        gain.gain.setValueAtTime(vol*0.7, now); gain.gain.exponentialRampToValueAtTime(0.001, now+0.15);
        osc.start(now); osc.stop(now+0.15);
    } else if (type === 'explosion') {
        osc.type = 'sawtooth'; osc.frequency.setValueAtTime(150, now); osc.frequency.exponentialRampToValueAtTime(30, now+0.3);
        gain.gain.setValueAtTime(vol*0.9, now); gain.gain.exponentialRampToValueAtTime(0.001, now+0.4);
        osc.start(now); osc.stop(now+0.4);
    } else if (type === 'railgun') {
        osc.type = 'sine'; osc.frequency.setValueAtTime(1200, now); osc.frequency.exponentialRampToValueAtTime(300, now+0.5);
        gain.gain.setValueAtTime(vol*0.7, now); gain.gain.exponentialRampToValueAtTime(0.001, now+0.6);
        osc.start(now); osc.stop(now+0.6);
    } else if (type === 'fire') {
        osc.type = 'sawtooth'; osc.frequency.setValueAtTime(100, now); osc.frequency.linearRampToValueAtTime(50, now+0.8);
        gain.gain.setValueAtTime(vol*0.6, now); gain.gain.exponentialRampToValueAtTime(0.001, now+1);
        osc.start(now); osc.stop(now+1);
    }
}

// === Глобальные переменные ===
let difficulty = 1;
let craters = [];
let bossKilled = false;

const player = {
    x: canvas.width/2, y: canvas.height/2, radius: 20,
    health: 100, maxHealth: 100, speed: 4,
    bodyAngle: 0, turretAngle: 0, shootCooldown: 0,
    invincible: false, invincibleTimer: 0,
    healthLevel: 1, weapon: 'default', weaponLevel: 1, doubleShotSide: false,
    vx: 0, vy: 0,
    weaponLevels: { default: 1, double: 1, laser: 1, hammer: 1, railgun: 1 },
    stunned: false, stunTimer: 0,
    burning: false, burnTimer: 0, burnDamage: 0,
    recoilOffset: 0,
    tracks: [],
    railgunMode: 'electric'
};

let bullets = [], enemyBullets = [], enemies = [], muzzleFlashes = [], explosions = [], enemyLasers = [];
let hearts = [];
let heartSpawnTimer = 20;
let score = 0, kills = 0, gameOver = false, paused = false;
let controlScheme = 'wasd';
let gameMode = null, pendingGameMode = null;
let timeLeft = 0, highScoreEndless = 0;
let campaignLevel = 1, MAX_CAMPAIGN_LEVEL = 10, boss = null;
let menuEnemies = [], MAX_MENU_ENEMIES = 15;
let trees = [];
const mouse = { x: player.x, y: player.y, down: false };

// Шторм
let stormBorder = 0;
let stormShrinkSpeed = 20;
let stormDamage = 20;
let stormActive = false;

// Песочница
let sandboxBosses = [];
let sandboxControlBoss = false;

// Кооператив
let lobbyPlayers = [];

// ====== ПРОГРЕСС КАМПАНИИ ======
let campaignProgress = { completedLevels: [] };

function loadCampaignProgress() {
    const saved = localStorage.getItem('tankCampaignProgress');
    if (saved) {
        try {
            const p = JSON.parse(saved);
            if (Array.isArray(p.completedLevels)) campaignProgress = p;
        } catch(e) {}
    }
}
function saveCampaignProgress() {
    localStorage.setItem('tankCampaignProgress', JSON.stringify(campaignProgress));
}

function saveCampaignState() {
    if (gameMode !== 'campaign') return;
    const state = {
        health: player.health,
        maxHealth: player.maxHealth,
        weapon: player.weapon,
        weaponLevel: player.weaponLevel,
        weaponLevels: player.weaponLevels,
        score, kills, campaignLevel,
        railgunMode: player.railgunMode
    };
    localStorage.setItem('tankCampaignState', JSON.stringify(state));
}

function loadCampaignState(includeLevel = false, loadWeapon = true) {
    const saved = localStorage.getItem('tankCampaignState');
    if (saved) {
        try {
            const s = JSON.parse(saved);
            player.health = s.health || player.maxHealth;
            player.maxHealth = s.maxHealth || 100;
            if (loadWeapon) {
                player.weapon = s.weapon || 'default';
                player.weaponLevel = s.weaponLevel || 1;
                player.weaponLevels = s.weaponLevels || { default:1, double:1, laser:1, hammer:1, railgun:1 };
                player.railgunMode = s.railgunMode || 'electric';
            }
            score = s.score || 0;
            kills = s.kills || 0;
            if (includeLevel) campaignLevel = s.campaignLevel || 1;
        } catch(e) {}
    }
}

// ====== СОХРАНЕНИЯ ======
const MAX_SAVES = 5;
const SAVES_KEY = 'miniThunderSaves';

function getSaves() {
    const data = localStorage.getItem(SAVES_KEY);
    if (!data) return new Array(MAX_SAVES).fill(null);
    try {
        const saves = JSON.parse(data);
        const result = new Array(MAX_SAVES).fill(null);
        if (Array.isArray(saves)) {
            for (let i = 0; i < Math.min(saves.length, MAX_SAVES); i++) {
                if (saves[i] && typeof saves[i] === 'object' && saves[i].date) {
                    result[i] = saves[i];
                }
            }
        }
        return result;
    } catch (e) {
        return new Array(MAX_SAVES).fill(null);
    }
}

function saveGame(slot) {
    if (slot < 0 || slot >= MAX_SAVES) return;
    const saves = getSaves();
    saves[slot] = {
        date: new Date().toLocaleString(),
        score,
        kills,
        campaignLevel,
        weapon: player.weapon,
        weaponLevel: player.weaponLevel,
        weaponLevels: { ...player.weaponLevels },
        railgunMode: player.railgunMode,
        campaignProgress: campaignProgress ? { completedLevels: [...campaignProgress.completedLevels] } : { completedLevels: [] }
    };
    localStorage.setItem(SAVES_KEY, JSON.stringify(saves));
}

function loadGame(slot) {
    const saves = getSaves();
    const save = saves[slot];
    if (!save || !save.date || save.score === undefined) return false;
    score = save.score;
    kills = save.kills;
    campaignLevel = save.campaignLevel;
    player.weapon = save.weapon || 'default';
    player.weaponLevel = save.weaponLevel || 1;
    player.weaponLevels = save.weaponLevels || { default: 1, double: 1, laser: 1, hammer: 1, railgun: 1 };
    player.railgunMode = save.railgunMode || 'electric';
    campaignProgress = save.campaignProgress || { completedLevels: [] };
    updateHUD();
    if (campaignLevel) {
        document.getElementById('levelNumber').textContent = campaignLevel;
    }
    return true;
}

function deleteSave(slot) {
    const saves = getSaves();
    saves[slot] = null;
    localStorage.setItem(SAVES_KEY, JSON.stringify(saves));
}

function renderSaves() {
    const container = document.getElementById('savesList');
    if (!container) return;
    const saves = getSaves();
    let html = '';
    for (let i = 0; i < MAX_SAVES; i++) {
        const s = saves[i];
        const isEmpty = !s || !s.date;
        html += `<div class="save-slot">
            <div class="slot-header">
                <strong>Слот ${i + 1}</strong>
                <span class="slot-date">${isEmpty ? 'Пусто' : s.date}</span>
            </div>
            <div class="slot-stats">${isEmpty ? 'Нет данных' : `Очки: ${s.score} | Убийств: ${s.kills} | Уровень: ${s.campaignLevel}`}</div>
            <div class="slot-actions">
                <button class="btn btn-save" onclick="handleSaveClick(${i})">${isEmpty ? '💾 Сохранить' : '🔄 Перезаписать'}</button>
                ${!isEmpty ? `<button class="btn btn-load" onclick="handleLoadClick(${i})">📂 Загрузить</button>` : ''}
                ${!isEmpty ? `<button class="btn btn-close" onclick="handleDeleteClick(${i})">🗑️ Удалить</button>` : ''}
            </div>
        </div>`;
    }
    container.innerHTML = html;
}

function handleSaveClick(slot) { saveGame(slot); renderSaves(); alert('Сохранено!'); }
function handleLoadClick(slot) { if (loadGame(slot)) { alert('Загружено!'); renderSaves(); } else { alert('Ошибка загрузки: данные повреждены'); } }
function handleDeleteClick(slot) { if (confirm('Удалить это сохранение?')) { deleteSave(slot); renderSaves(); alert('Удалено'); } }

// === DOM ЭЛЕМЕНТЫ ===
const mainMenuModal = document.getElementById('mainMenuModal');
const trialsMenuModal = document.getElementById('trialsMenuModal');
const upgradesModal = document.getElementById('upgradesModal');
const levelSelectModal = document.getElementById('levelSelectModal');
const pauseModal = document.getElementById('pauseModal');
const savesModal = document.getElementById('savesModal');
const victoryModal = document.getElementById('victoryModal');
const settingsModal = document.getElementById('settingsModal');
const sandboxPanel = document.getElementById('sandboxPanel');
const coopLobbyModal = document.getElementById('coopLobbyModal');
const campaignSubMenu = document.getElementById('campaignSubMenu');
const hudContainer = document.getElementById('hudContainer');
const resumeBtn = document.getElementById('resumeBtn');
const exitToMenuBtn = document.getElementById('exitToMenuBtn');
const victoryOkBtn = document.getElementById('victoryOkBtn');
const controlRadios = document.querySelectorAll('input[name="controlScheme"]');
const bossHpContainer = document.getElementById('bossHpContainer');
const bossHpFill = document.getElementById('bossHpFill');
const bossNameLabel = document.getElementById('bossNameLabel');
const levelDisplay = document.getElementById('levelDisplay');
const levelNumber = document.getElementById('levelNumber');
const victoryMessage = document.getElementById('victoryMessage');
const railgunModeDiv = document.getElementById('railgunMode');
const railgunModeText = document.getElementById('railgunModeText');
const changelogBlock = document.getElementById('changelogBlock');

function hideAllModals() {
    const modals = document.querySelectorAll('.modal');
    modals.forEach(m => m.classList.remove('active'));
    sandboxPanel.style.display = 'none';
}

function updateHUD() {
    document.getElementById('healthDisplay').textContent = Math.floor(player.health);
    document.getElementById('scoreDisplay').textContent = score;
    document.getElementById('killsDisplay').textContent = kills;
    if (timeLeft) document.getElementById('timerDisplay').textContent = timeLeft;
    if (campaignLevel) document.getElementById('levelNumber').textContent = campaignLevel;
    if (player.weapon === 'railgun') {
        railgunModeDiv.style.display = 'block';
        railgunModeText.textContent = player.railgunMode === 'electric' ? 'Электро' : 'Огонь';
    } else {
        railgunModeDiv.style.display = 'none';
    }
}

function loadHighScore() {
    const el = document.getElementById('profileHighScore');
    if (el) {
        const s = localStorage.getItem('tankHighScoreEndless');
        if (s) highScoreEndless = parseInt(s) || 0;
        el.textContent = highScoreEndless;
    }
}
function saveHighScore() {
    if (gameMode === 'endless' && score > highScoreEndless) {
        highScoreEndless = score;
        localStorage.setItem('tankHighScoreEndless', highScoreEndless);
        const el = document.getElementById('profileHighScore');
        if (el) el.textContent = highScoreEndless;
    }
}

function showMainMenu() {
    hideAllModals(); gameMode=null; pendingGameMode=null; gameOver=false; paused=false;
    hudContainer.style.display='none'; bossHpContainer.style.display='none'; levelDisplay.style.display='none';
    bullets=[]; enemyBullets=[]; enemies=[]; boss=null; bossKilled=false; score=0; kills=0; trees=[]; craters=[];
    player.health=100; player.maxHealth=100; player.x=canvas.width/2; player.y=canvas.height/2;
    player.bodyAngle=0; player.turretAngle=0; player.shootCooldown=0;
    player.invincible=false; player.invincibleTimer=0; timeLeft=0; player.vx=0; player.vy=0;
    player.stunned=false; player.stunTimer=0; player.burning=false; player.burnTimer=0; player.burnDamage=0;
    player.recoilOffset=0; player.tracks=[];
    player.railgunMode = 'electric';
    campaignLevel = 1;
    stormActive = false;
    document.getElementById('timerContainer').style.display='none';
    updateHUD(); initMenuEnemies(); mainMenuModal.classList.add('active');
    if (changelogBlock) changelogBlock.style.display = 'block';
}

function showTrialsMenu() {
    hideAllModals();
    if (changelogBlock) changelogBlock.style.display = 'none';
    trialsMenuModal.classList.add('active');
}
function showUpgradesMenu() {
    hideAllModals();
    if (changelogBlock) changelogBlock.style.display = 'block';
    upgradesModal.classList.add('active'); buildWeaponSelection();
}
function showLevelSelect() {
    hideAllModals();
    if (changelogBlock) changelogBlock.style.display = 'block';
    levelSelectModal.classList.add('active'); buildLevelGrid();
}

// Обработчики кнопок
document.getElementById('savesMenuBtn').addEventListener('click', () => { hideAllModals(); renderSaves(); savesModal.classList.add('active'); });
document.getElementById('closeSavesBtn').addEventListener('click', () => { savesModal.classList.remove('active'); showMainMenu(); });
document.getElementById('campaignBtn').addEventListener('click', () => { hideAllModals(); campaignSubMenu.classList.add('active'); });
document.getElementById('stormBtn').addEventListener('click', () => { gameMode = 'storm'; startGame(); });
document.getElementById('trialsBtn').addEventListener('click', showTrialsMenu);
document.getElementById('endlessBtn').addEventListener('click', () => { gameMode = 'endless'; startGame(); });
document.getElementById('timedBtn').addEventListener('click', () => { gameMode = 'timed'; startGame(); });
document.getElementById('sandboxBtn').addEventListener('click', () => { gameMode = 'sandbox'; startGame(); });
document.getElementById('backToMainBtn').addEventListener('click', showMainMenu);
document.getElementById('backFromUpgradesBtn').addEventListener('click', showMainMenu);
document.getElementById('backFromLevelSelectBtn').addEventListener('click', showUpgradesMenu);
document.getElementById('settingsBtn').addEventListener('click', () => { hideAllModals(); settingsModal.classList.add('active'); });
document.getElementById('closeSettingsBtn').addEventListener('click', () => { settingsModal.classList.remove('active'); showMainMenu(); });
document.getElementById('volumeSlider').addEventListener('input', function() { soundVolume = parseInt(this.value) / 100; document.getElementById('volumeValue').textContent = this.value; });
document.getElementById('resolutionSelect').addEventListener('change', function() {
    const val = this.value;
    if (val === '1080') { canvas.width = 1920; canvas.height = 1080; }
    else if (val === '720') { canvas.width = 1280; canvas.height = 720; }
    else if (val === '480') { canvas.width = 854; canvas.height = 480; }
    else resizeCanvas();
});
document.querySelectorAll('input[name="difficulty"]').forEach(r => r.addEventListener('change', function() {
    if (this.checked) {
        if (this.value === 'easy') difficulty = 0.7;
        else if (this.value === 'normal') difficulty = 1;
        else if (this.value === 'hard') difficulty = 1.3;
    }
}));
resumeBtn.addEventListener('click', () => { paused = false; pauseModal.classList.remove('active'); canvas.focus(); });
exitToMenuBtn.addEventListener('click', showMainMenu);
victoryOkBtn.addEventListener('click', showMainMenu);
controlRadios.forEach(r => r.addEventListener('change', e => { if (e.target.checked) controlScheme = e.target.value; }));

// ================== ПОДМЕНЮ КАМПАНИИ ==================
document.getElementById('singleCampaignBtn').addEventListener('click', () => { pendingGameMode = 'campaign'; campaignSubMenu.classList.remove('active'); showUpgradesMenu(); });
document.getElementById('coopCampaignBtn').addEventListener('click', () => { campaignSubMenu.classList.remove('active'); openCoopLobby(); });
document.getElementById('backFromCampaignSubBtn').addEventListener('click', () => { campaignSubMenu.classList.remove('active'); showMainMenu(); });

// ================== ЛОББИ ==================
function openCoopLobby() {
    hideAllModals();
    lobbyPlayers = [
        { nickname: 'Игрок 1', weapon: 'default', weaponLevel: 1, ready: false },
        { nickname: '', weapon: 'default', weaponLevel: 1, ready: false },
        { nickname: '', weapon: 'default', weaponLevel: 1, ready: false },
        { nickname: '', weapon: 'default', weaponLevel: 1, ready: false }
    ];
    renderLobby();
    coopLobbyModal.classList.add('active');
}
function renderLobby() {
    const container = document.getElementById('lobbySlots');
    container.innerHTML = lobbyPlayers.map((p, i) => `
        <div class="lobby-slot">
            <input type="text" placeholder="Имя игрока ${i+1}" value="${p.nickname}" onchange="lobbyPlayers[${i}].nickname = this.value">
            <select onchange="lobbyPlayers[${i}].weapon = this.value; lobbyPlayers[${i}].weaponLevel = parseInt(this.selectedOptions[0].dataset.level || 1)">
                ${Object.keys(weaponStats).map(w => `<option value="${w}" ${p.weapon===w?'selected':''} data-level="${p.weaponLevel||1}">${weaponStats[w].desc}</option>`).join('')}
            </select>
            <select onchange="lobbyPlayers[${i}].weaponLevel = parseInt(this.value)">
                <option value="1" ${p.weaponLevel===1?'selected':''}>1</option>
                <option value="2" ${p.weaponLevel===2?'selected':''}>2</option>
                <option value="3" ${p.weaponLevel===3?'selected':''}>3</option>
                <option value="4" ${p.weaponLevel===4?'selected':''}>4</option>
            </select>
            ${i===0 ? '' : `<button class="ready-btn ${p.ready?'ready':''}" onclick="lobbyPlayers[${i}].ready = !lobbyPlayers[${i}].ready; renderLobby()">Готов</button>`}
        </div>
    `).join('');
}
document.getElementById('startCoopBtn').addEventListener('click', () => {
    const otherPlayers = lobbyPlayers.slice(1).filter(p => p.nickname.trim() !== '');
    const allReady = otherPlayers.length === 0 || otherPlayers.every(p => p.ready);
    if (!allReady) { alert('Не все игроки готовы'); return; }
    pendingGameMode = 'campaign';
    coopLobbyModal.classList.remove('active');
    showLevelSelect();
});
document.getElementById('closeCoopLobbyBtn').addEventListener('click', () => { coopLobbyModal.classList.remove('active'); showMainMenu(); });
document.getElementById('connectByIpBtn').addEventListener('click', () => {
    const ipInput = document.getElementById('ipInput').value.trim();
    const ipRegex = /^(\d{1,3}\.){3}\d{1,3}:\d{1,5}$/;
    if (!ipRegex.test(ipInput)) { alert('Неверный формат IP:Port'); return; }
    alert('Подключение к ' + ipInput + ' установлено!');
});

// ================== ПЕСОЧНИЦА ==================
document.getElementById('sandboxControlBossCheck').addEventListener('change', function() { sandboxControlBoss = this.checked; });
document.getElementById('sandboxClearBtn').addEventListener('click', () => { enemies = []; sandboxBosses = []; trees = []; craters = []; bullets = []; enemyBullets = []; });

// ================== ОРУЖИЕ И УРОВНИ ==================
const weaponStats = {
    default: { damage: 21, cooldown: 15, desc: "Стандартная" },
    double:  { damage: 17, cooldown: 8,  desc: "Двойные" },
    laser:   { damage: 42, cooldown: 20, desc: "Лазер" },
    hammer:  { damage: 51, cooldown: 30, desc: "Молот" },
    railgun: { damage: 40, cooldown: 25, desc: "Рельсотрон" }
};

function buildWeaponSelection() {
    const container = document.getElementById('weaponSelection'); container.innerHTML = '';
    const railgunUnlocked = campaignProgress.completedLevels.includes(10);
    for (let w in weaponStats) {
        if (w === 'railgun' && !railgunUnlocked) continue;
        const stats = weaponStats[w], level = player.weaponLevels[w] || 1;
        const dmg = stats.damage + (level-1)*(stats.damage*0.5), cd = Math.max(5, stats.cooldown - (level-1)*Math.floor(stats.cooldown*0.15));
        const div = document.createElement('div'); div.style.marginBottom='15px';
        div.innerHTML = `<div style="display:flex;align-items:center;gap:10px;margin-bottom:5px;"><input type="radio" name="weapon" value="${w}" ${player.weapon===w?'checked':''}> <strong>${stats.desc}</strong> <span>Урон: ${dmg.toFixed(0)}</span><div class="stat-bar"><div class="stat-fill" style="width:${Math.min(100,(dmg/100)*100)}%"></div></div><span>Скорость: ${(1000/cd).toFixed(0)}/м</span></div><div style="margin-left:30px;"><label>Уровень:</label><select class="weapon-level" data-weapon="${w}"><option value="1" ${level===1?'selected':''}>1 — Слабый</option><option value="2" ${level===2?'selected':''}>2 — Средний</option><option value="3" ${level===3?'selected':''}>3 — Сильный</option><option value="4" ${level===4?'selected':''}>4 — Элитный</option></select></div>`;
        container.appendChild(div);
    }
    document.querySelectorAll('.weapon-level').forEach(sel=>sel.addEventListener('change',function(){const w=this.dataset.weapon;player.weaponLevels[w]=parseInt(this.value);if(player.weapon===w)player.weaponLevel=parseInt(this.value);buildWeaponSelection();}));
    document.querySelectorAll('input[name="weapon"]').forEach(r=>r.addEventListener('change',function(){if(this.checked){player.weapon=this.value;player.weaponLevel=player.weaponLevels[player.weapon]||1;buildWeaponSelection();}}));
}

function buildLevelGrid() {
    const grid = document.getElementById('levelGrid'); grid.innerHTML = '';
    for (let i=1;i<=MAX_CAMPAIGN_LEVEL;i++) {
        const completed = campaignProgress.completedLevels.includes(i);
        const unlocked = i===1 || campaignProgress.completedLevels.includes(i-1);
        const isBoss = i===5 || i===10;
        const btn = document.createElement('button');
        btn.className = `level-btn${completed?' completed':''}${unlocked&&!completed?' current':''}${!unlocked?' locked':''}${isBoss?' boss':''}`;
        if (i===10 && !campaignProgress.completedLevels.includes(9)) { btn.textContent = '?'; btn.disabled = true; btn.className += ' locked'; }
        else { btn.textContent = i; btn.disabled = !unlocked; }
        if (isBoss) { const l=document.createElement('span');l.className='boss-label';l.textContent=i===5?'Шторм':'Изида';btn.appendChild(l); }
        if (!btn.disabled) btn.addEventListener('click',()=>{campaignLevel=i; gameMode=pendingGameMode; levelSelectModal.classList.remove('active'); startGame();});
        grid.appendChild(btn);
    }
}

function applyUpgradesAndContinue() {
    const wr=document.querySelector('input[name="weapon"]:checked'); if(wr){player.weapon=wr.value;player.weaponLevel=player.weaponLevels[player.weapon]||1;}
    const hr=document.querySelector('input[name="healthLevel"]:checked'); if(hr)player.healthLevel=parseInt(hr.value);
    player.maxHealth=100*player.healthLevel; player.health=player.maxHealth;
    if(pendingGameMode==='campaign') showLevelSelect();
}
document.getElementById('startCampaignWithUpgradesBtn').addEventListener('click', applyUpgradesAndContinue);

// ================== ИГРОВЫЕ ФУНКЦИИ ==================
function getLevelBonus() { if (gameMode==='campaign') return campaignLevel; return 1; }
function spawnEnemy(overrides={}) {
    let x = overrides.x !== undefined ? overrides.x : (Math.random()*canvas.width);
    let y = overrides.y !== undefined ? overrides.y : (Math.random()*canvas.height);
    const weapons=['default','default','double','laser','hammer']; const weapon=overrides.weapon||weapons[Math.floor(Math.random()*weapons.length)];
    const bonus = getLevelBonus();
    let health=(50+bonus*10)*difficulty, speed=(1.2+Math.random()*1.0+bonus*0.2)*difficulty;
    if(weapon==='laser')health-=10;else if(weapon==='hammer')health+=20;else if(weapon==='double')speed+=0.3;
    enemies.push({x,y,radius:18,health:overrides.health||health,maxHealth:health,speed:overrides.speed||speed,bodyAngle:0,turretAngle:0,shootTimer:60+Math.floor(Math.random()*90),weapon,doubleShotSide:false,state:'chase',stateTimer:0,dodgeCooldown:0,tracks:[], stunned:false, stunTimer:0, burning:false, burnTimer:0, burnDamage:0});
}

function setupCampaignLevel(level) {
    enemies=[];boss=null;bossKilled=false;bossHpContainer.style.display='none';levelNumber.textContent=level; craters=[];
    if(level===5){
        boss={x:canvas.width/2,y:canvas.height/2-100,radius:45,health:1200*difficulty,maxHealth:1200*difficulty,speed:0.8*difficulty,bodyAngle:0,turretAngle:0,shootTimer:40,phase:1,weapon:'boss',dodgeCooldown:0,state:'chase',stateTimer:0,tracks:[], name:'Шторм', circleWaveTimer:60};
        for(let i=0;i<2;i++)spawnEnemy({health:60*difficulty,speed:1.8*difficulty});
    } else if(level===10){
        boss={x:canvas.width/2,y:canvas.height/2-100,radius:50,health:2000*difficulty,maxHealth:2000*difficulty,speed:0.9*difficulty,bodyAngle:0,turretAngle:0,shootTimer:50,phase:1,weapon:'railgun',dodgeCooldown:0,state:'chase',stateTimer:0,chargeTimer:0,laserActive:false,laserAngle:0,fireWaveTimer:0,stopped:false,tracks:[], name:'Изида'};
        for(let i=0;i<3;i++)spawnEnemy({health:80*difficulty,speed:2.0*difficulty});
    } else { const count=2+level; for(let i=0;i<count;i++)spawnEnemy({health:(30+level*15)*difficulty,speed:(1.0+level*0.3)*difficulty}); }
    generateTrees();
}

function advanceCampaignLevel() {
    if(!campaignProgress.completedLevels.includes(campaignLevel)){campaignProgress.completedLevels.push(campaignLevel);saveCampaignProgress();}
    if(campaignLevel<MAX_CAMPAIGN_LEVEL){
        campaignLevel++;
        setupCampaignLevel(campaignLevel);
        player.health=player.maxHealth; player.invincible=false; player.invincibleTimer=0;
        bullets=[]; enemyBullets=[]; levelNumber.textContent=campaignLevel; canvas.focus();
        saveCampaignState();
    } else {
        victoryMessage.textContent='Вы прошли все уровни! Следующие уровни в разработке.';
        victoryModal.classList.add('active'); gameMode=null;
        hudContainer.style.display='none'; bossHpContainer.style.display='none'; levelDisplay.style.display='none';
    }
}

function startGame() {
    hideAllModals();
    if (changelogBlock) changelogBlock.style.display = 'none';
    gameOver=false; paused=false; score=0; kills=0; craters=[]; bossKilled=false;
    hearts = []; heartSpawnTimer = 20;
    if (gameMode === 'sandbox') {
        enemies=[]; sandboxBosses=[]; trees=[]; craters=[]; bullets=[]; enemyBullets=[];
        player.health = 100; player.maxHealth = 100;
        player.x = canvas.width/2; player.y = canvas.height/2;
        hudContainer.style.display = 'none';
        sandboxPanel.style.display = 'block';
        canvas.focus();
        return;
    }
    sandboxPanel.style.display = 'none';
    if (gameMode === 'campaign') {
        loadCampaignState(false, false);
        player.x = canvas.width/2; player.y = canvas.height/2;
        player.invincible = false; player.invincibleTimer = 0;
        bullets=[]; enemyBullets=[]; enemies=[]; boss=null;
        levelDisplay.style.display='block'; levelNumber.textContent = campaignLevel;
        setupCampaignLevel(campaignLevel);
        saveCampaignState();
    } else if (gameMode === 'storm') {
        player.health = 100; player.maxHealth = 100;
        player.burning = false; player.burnTimer = 0;
        player.stunned = false; player.stunTimer = 0;
        stormActive = true;
        stormBorder = Math.hypot(canvas.width/2, canvas.height/2);
        stormShrinkSpeed = 20;
        enemies = [];
        for (let i=0;i<8;i++) spawnEnemy();
    } else {
        player.health = 100; player.maxHealth = 100;
        if (gameMode === 'timed') { timeLeft = 60; document.getElementById('timerContainer').style.display = 'block'; }
    }
    hudContainer.style.display='flex';
    canvas.focus(); updateHUD();
}

function togglePause() { paused = !paused; if (paused) pauseModal.classList.add('active'); else { pauseModal.classList.remove('active'); canvas.focus(); } }
function updateControlRadio() { controlRadios.forEach(r => r.checked = r.value === controlScheme); }

// ================== КЛАВИАТУРА ==================
const keys = {};
const moveKeys = { 'w':'w','ц':'w','a':'a','ф':'a','s':'s','ы':'s','d':'d','в':'d','arrowup':'arrowup','arrowdown':'arrowdown','arrowleft':'arrowleft','arrowright':'arrowright' };
const restartKeys = ['r','к'];
window.addEventListener('keydown', e => {
    const key = e.key.toLowerCase();
    if (restartKeys.includes(key) && gameOver) { restartGame(); e.preventDefault(); return; }
    if (key === 'escape' && gameOver) { showMainMenu(); e.preventDefault(); return; }
    if (key === 'escape' && gameMode && !gameOver) { togglePause(); e.preventDefault(); return; }
    if ((key === 't' || key === 'е') && !paused && !gameOver && gameMode) { controlScheme = controlScheme === 'wasd' ? 'arrows' : 'wasd'; updateControlRadio(); e.preventDefault(); return; }
    if ((key === 'q' || key === 'й') && !paused && !gameOver && gameMode && player.weapon === 'railgun') {
        player.railgunMode = player.railgunMode === 'electric' ? 'fire' : 'electric';
        updateRailgunModeDisplay();
        e.preventDefault();
        return;
    }
    if (paused || gameOver || !gameMode) return;
    if (moveKeys[key]) { keys[moveKeys[key]] = true; e.preventDefault(); e.stopPropagation(); }
});
window.addEventListener('keyup', e => { const key = e.key.toLowerCase(); if (moveKeys[key]) { keys[moveKeys[key]] = false; e.preventDefault(); e.stopPropagation(); } });
canvas.addEventListener('click', () => { initAudio(); canvas.focus(); });
canvas.focus();
canvas.addEventListener('mousemove', e => { const rect = canvas.getBoundingClientRect(); mouse.x = e.clientX - rect.left; mouse.y = e.clientY - rect.top; });
canvas.addEventListener('mousedown', e => {
    if (gameMode === 'sandbox') {
        if (e.shiftKey) {
            const mx = mouse.x, my = mouse.y;
            for (let i = enemies.length-1; i>=0; i--) { if (Math.hypot(enemies[i].x-mx, enemies[i].y-my) < enemies[i].radius) { enemies.splice(i,1); return; } }
            for (let i = sandboxBosses.length-1; i>=0; i--) { const b = sandboxBosses[i]; if (Math.hypot(b.x-mx, b.y-my) < b.radius) { sandboxBosses.splice(i,1); return; } }
            for (let i = trees.length-1; i>=0; i--) { if (Math.hypot(trees[i].x-mx, trees[i].y-my) < trees[i].radius) { trees.splice(i,1); return; } }
            for (let i = craters.length-1; i>=0; i--) { if (Math.hypot(craters[i].x-mx, craters[i].y-my) < craters[i].radius) { craters.splice(i,1); return; } }
        } else {
            const type = document.getElementById('sandboxUnitType').value;
            const mx = mouse.x, my = mouse.y;
            if (type === 'enemy') spawnEnemy({x: mx, y: my});
            else if (type === 'boss') sandboxBosses.push({x: mx, y: my, radius:45, health:1200, maxHealth:1200, speed:0.8, bodyAngle:0, turretAngle:0, shootTimer:40, phase:1, weapon:'boss', tracks:[], name:'Шторм', circleWaveTimer:60});
            else if (type === 'railgun') sandboxBosses.push({x: mx, y: my, radius:50, health:2000, maxHealth:2000, speed:0.9, bodyAngle:0, turretAngle:0, shootTimer:50, phase:1, weapon:'railgun', chargeTimer:0, laserActive:false, laserAngle:0, fireWaveTimer:0, stopped:false, tracks:[], name:'Изида'});
            else if (type === 'tree') trees.push({x: mx, y: my, radius:25, health:3});
            else if (type === 'crater') craters.push({x: mx, y: my, radius:20, life:300});
        }
        return;
    }
    if (!paused && !gameOver && gameMode) mouse.down = true;
});
canvas.addEventListener('mouseup', () => mouse.down = false);
canvas.addEventListener('mouseleave', () => mouse.down = false);

// ================== СТРЕЛЬБА ==================
function getWeaponDamage() { const b = weaponStats[player.weapon].damage; return b + (player.weaponLevel-1)*(b*0.5); }
function getWeaponCooldown() { const b = weaponStats[player.weapon].cooldown; return Math.max(5, b - (player.weaponLevel-1)*Math.floor(b*0.15)); }
function addMuzzleFlash(x,y,angle) { muzzleFlashes.push({x,y,angle,life:4}); }
function addExplosion(x,y,size) { for(let i=0;i<12;i++){const a=Math.random()*Math.PI*2,s=2+Math.random()*3;explosions.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,life:15+Math.floor(Math.random()*10),color:'#f39c12'});} }
function shootPlayerBullet(){
    if(player.shootCooldown>0||gameOver||paused||!gameMode||player.stunned)return;
    const angle=player.turretAngle,dmg=getWeaponDamage();
    const barrelLength = player.weapon === 'laser' ? 24 : (player.weapon === 'railgun' ? 26 : 22);
    const startX = player.x + Math.cos(angle) * (player.radius + barrelLength);
    const startY = player.y + Math.sin(angle) * (player.radius + barrelLength);
    addMuzzleFlash(startX, startY, angle);
    playSound('shoot');
    if(player.weapon==='default')bullets.push({x:startX,y:startY,vx:Math.cos(angle)*7,vy:Math.sin(angle)*7,radius:4,life:100,damage:dmg});
    else if(player.weapon==='double'){const o=player.doubleShotSide?0.2:-0.2;bullets.push({x:player.x+Math.cos(angle+o)*(player.radius+20),y:player.y+Math.sin(angle+o)*(player.radius+20),vx:Math.cos(angle)*8,vy:Math.sin(angle)*8,radius:3,life:90,damage:dmg});player.doubleShotSide=!player.doubleShotSide;}
    else if(player.weapon==='laser')bullets.push({x:startX,y:startY,vx:Math.cos(angle)*14,vy:Math.sin(angle)*14,radius:2,life:25,damage:dmg,isLaser:true});
    else if(player.weapon==='hammer')bullets.push({x:startX,y:startY,vx:Math.cos(angle)*5,vy:Math.sin(angle)*5,radius:6,life:120,damage:dmg,explodeRadius:60});
    else if(player.weapon==='railgun'){
        if (player.railgunMode === 'electric') {
            bullets.push({x:startX,y:startY,vx:Math.cos(angle)*7,vy:Math.sin(angle)*7,radius:6,life:120,damage:dmg, isRail: true});
        } else {
            bullets.push({x:startX,y:startY,vx:Math.cos(angle)*5,vy:Math.sin(angle)*5,radius:8,life:200,damage:dmg*0.5, isFire: true});
        }
    }
    player.shootCooldown=getWeaponCooldown();
    player.recoilOffset=6;
}
function shootEnemyBullet(source,customAngle=null){
    const angle=customAngle!==null?customAngle:source.turretAngle;
    enemyBullets.push({x:source.x+Math.cos(angle)*source.radius,y:source.y+Math.sin(angle)*source.radius,vx:Math.cos(angle)*5,vy:Math.sin(angle)*5,radius:3,life:80,damage:10*difficulty});
    playSound('shoot');
}
function shootEnemyLaser(source) {
    const angle = source.turretAngle;
    const laserLength = 300;
    const endX = source.x + Math.cos(angle) * laserLength;
    const endY = source.y + Math.sin(angle) * laserLength;
    const playerDist = Math.hypot(player.x - source.x, player.y - source.y);
    const playerAngle = Math.atan2(player.y - source.y, player.x - source.x);
    let angleDiff = Math.abs(angle - playerAngle);
    if (angleDiff > Math.PI) angleDiff = 2*Math.PI - angleDiff;
    if (playerDist < laserLength && angleDiff < 0.15) {
        if (!player.invincible) {
            player.health -= 15*difficulty;
            player.invincible = true; player.invincibleTimer = 20;
        }
    }
    enemyLasers.push({x1: source.x, y1: source.y, x2: endX, y2: endY, life: 5});
    playSound('shoot');
}
function shootRailgunBullet(source,angle){
    enemyBullets.push({x:source.x+Math.cos(angle)*source.radius,y:source.y+Math.sin(angle)*source.radius,vx:Math.cos(angle)*7,vy:Math.sin(angle)*7,radius:6,life:120,damage:50*difficulty,isRail:true});
    playSound('railgun');
}
function fireGiantLaser(source){
    const angle = source.laserAngle || source.turretAngle;
    playSound('railgun');
    for (let i=0;i<50;i++){ const dist=i*15; const lx=source.x+Math.cos(angle)*dist; const ly=source.y+Math.sin(angle)*dist; if(Math.hypot(lx-player.x,ly-player.y)<40){ player.health-=80*difficulty; player.invincible=true; player.invincibleTimer=20; break; } }
    for (let i=0;i<40;i++){ const dist=i*15; explosions.push({x:source.x+Math.cos(angle)*dist,y:source.y+Math.sin(angle)*dist,vx:0,vy:0,life:15,color:'#3498db'}); }
    for (let i=0;i<30;i++){ const dist=i*20; const x=source.x+Math.cos(angle)*dist; const y=source.y+Math.sin(angle)*dist; craters.push({x,y,radius:10+Math.random()*10,life:300}); }
}
function spawnFireWave(source){const angle=source.turretAngle;playSound('fire');for(let i=0;i<5;i++){const waveAngle=angle+(i-2)*0.15;enemyBullets.push({x:source.x+Math.cos(waveAngle)*source.radius,y:source.y+Math.sin(waveAngle)*source.radius,vx:Math.cos(waveAngle)*6,vy:Math.sin(waveAngle)*6,radius:8,life:200,damage:30*difficulty,isFireWave:true});}}

// ================== ОСНОВНОЙ ЦИКЛ ==================
let lastTimestamp=0;
function update(timestamp) {
    if (lastTimestamp === 0) lastTimestamp = timestamp;
    const delta = Math.min((timestamp - lastTimestamp) / 1000, 0.1);
    lastTimestamp = timestamp;
    updateMenuEnemies();
    if (!gameMode) return;
    if (gameOver || paused) return;

    if (gameMode === 'sandbox') {
        let controlledBoss = null;
        if (sandboxControlBoss && sandboxBosses.length > 0) controlledBoss = sandboxBosses[0];
        if (controlledBoss) {
            let dx = 0, dy = 0;
            if (controlScheme === 'wasd') { if (keys['w']) dy -= 1; if (keys['s']) dy += 1; if (keys['a']) dx -= 1; if (keys['d']) dx += 1; }
            else { if (keys['arrowup']) dy -= 1; if (keys['arrowdown']) dy += 1; if (keys['arrowleft']) dx -= 1; if (keys['arrowright']) dx += 1; }
            if (dx !== 0 || dy !== 0) {
                const len = Math.sqrt(dx*dx+dy*dy);
                controlledBoss.x += (dx/len) * controlledBoss.speed;
                controlledBoss.y += (dy/len) * controlledBoss.speed;
                controlledBoss.bodyAngle = Math.atan2(dy, dx);
            }
            controlledBoss.turretAngle = Math.atan2(mouse.y - controlledBoss.y, mouse.x - controlledBoss.x);
            if (mouse.down) {
                if (controlledBoss.weapon === 'boss') shootEnemyBullet(controlledBoss);
                else if (controlledBoss.weapon === 'railgun') shootRailgunBullet(controlledBoss, controlledBoss.turretAngle);
            }
        } else {
            let dx = 0, dy = 0;
            if (!player.stunned) {
                if (controlScheme === 'wasd') { if (keys['w']) dy -= 1; if (keys['s']) dy += 1; if (keys['a']) dx -= 1; if (keys['d']) dx += 1; }
                else { if (keys['arrowup']) dy -= 1; if (keys['arrowdown']) dy += 1; if (keys['arrowleft']) dx -= 1; if (keys['arrowright']) dx += 1; }
                if (dx !== 0 || dy !== 0) {
                    const len = Math.sqrt(dx*dx+dy*dy);
                    player.x += (dx/len) * player.speed;
                    player.y += (dy/len) * player.speed;
                    player.bodyAngle = Math.atan2(dy, dx);
                }
                player.turretAngle = Math.atan2(mouse.y - player.y, mouse.x - player.x);
                if (mouse.down) shootPlayerBullet();
            }
            player.x = Math.max(player.radius, Math.min(canvas.width - player.radius, player.x));
            player.y = Math.max(player.radius, Math.min(canvas.height - player.radius, player.y));
        }
        enemies.forEach(e => {
            e.x += Math.cos(e.bodyAngle) * e.speed; e.y += Math.sin(e.bodyAngle) * e.speed;
            if (e.x < e.radius) { e.x = e.radius; e.bodyAngle = Math.PI - e.bodyAngle; }
            if (e.x > canvas.width - e.radius) { e.x = canvas.width - e.radius; e.bodyAngle = Math.PI - e.bodyAngle; }
            if (e.y < e.radius) { e.y = e.radius; e.bodyAngle = -e.bodyAngle; }
            if (e.y > canvas.height - e.radius) { e.y = canvas.height - e.radius; e.bodyAngle = -e.bodyAngle; }
        });
        sandboxBosses.forEach(b => {
            b.x += Math.cos(b.bodyAngle) * b.speed; b.y += Math.sin(b.bodyAngle) * b.speed;
            if (b.x < b.radius) { b.x = b.radius; b.bodyAngle = Math.PI - b.bodyAngle; }
            if (b.x > canvas.width - b.radius) { b.x = canvas.width - b.radius; b.bodyAngle = Math.PI - b.bodyAngle; }
            if (b.y < b.radius) { b.y = b.radius; b.bodyAngle = -b.bodyAngle; }
            if (b.y > canvas.height - b.radius) { b.y = canvas.height - b.radius; b.bodyAngle = -b.bodyAngle; }
        });
        return;
    }

    // Сердечки
    if (gameMode === 'storm' || gameMode === 'timed' || gameMode === 'endless') {
        heartSpawnTimer -= delta;
        if (heartSpawnTimer <= 0) {
            hearts.push({ x: 100 + Math.random() * (canvas.width - 200), y: 100 + Math.random() * (canvas.height - 200), radius: 10 });
            heartSpawnTimer = 20;
        }
        for (let i = hearts.length - 1; i >= 0; i--) {
            const h = hearts[i];
            if (Math.hypot(player.x - h.x, player.y - h.y) < player.radius + h.radius) {
                player.health = Math.min(player.maxHealth, player.health + 10);
                hearts.splice(i, 1);
            }
        }
    }

    // Шторм
    if (gameMode === 'storm' && stormActive) {
        if (stormBorder > 0) stormBorder -= stormShrinkSpeed * delta;
        const distToCenter = Math.hypot(player.x - canvas.width/2, player.y - canvas.height/2);
        if (stormBorder > 0 && distToCenter > stormBorder) {
            player.health = Math.max(0, player.health - stormDamage * delta);
            player.burning = true;
            if (player.health <= 0) { player.health = 0; gameOver = true; canvas.focus(); }
        }
        enemies.forEach(e => {
            const eDist = Math.hypot(e.x - canvas.width/2, e.y - canvas.height/2);
            if (eDist > stormBorder) {
                e.burning = true;
                e.health -= stormDamage * delta;
                if (e.health <= 0) e.health = 0;
            } else { e.burning = false; }
        });
        if (enemies.length < 5) spawnEnemy();
    }

    if (gameMode === 'timed') { timeLeft -= delta; if (timeLeft <= 0) { timeLeft = 0; gameOver = true; saveHighScore(); canvas.focus(); } document.getElementById('timerDisplay').textContent = Math.ceil(timeLeft); }
    if (player.stunned) { player.stunTimer -= delta * 1000; if (player.stunTimer <= 0) player.stunned = false; }
    if (player.burning && gameMode !== 'storm') { player.burnTimer -= delta; if (player.burnTimer <= 0) player.burning = false; else { player.health = Math.max(0, player.health - 10 * delta); if (player.health <= 0) { player.health = 0; gameOver = true; canvas.focus(); } } }
    if (player.recoilOffset > 0) player.recoilOffset -= 0.5;
    let dx = 0, dy = 0;
    if (!player.stunned) {
        if (controlScheme === 'wasd') { if (keys['w']) dy -= 1; if (keys['s']) dy += 1; if (keys['a']) dx -= 1; if (keys['d']) dx += 1; }
        else { if (keys['arrowup']) dy -= 1; if (keys['arrowdown']) dy += 1; if (keys['arrowleft']) dx -= 1; if (keys['arrowright']) dx += 1; }
        if (dx !== 0 || dy !== 0) {
            let len = Math.sqrt(dx * dx + dy * dy); let nx = dx / len, ny = dy / len;
            let newX = player.x + nx * player.speed; let newY = player.y + ny * player.speed;
            for (let c of craters) { if (Math.hypot(newX - c.x, newY - c.y) < player.radius + c.radius) { const ang = Math.atan2(newY - c.y, newX - c.x); newX += Math.cos(ang) * 2; newY += Math.sin(ang) * 2; } }
            player.x = newX; player.y = newY; player.vx = nx * player.speed; player.vy = ny * player.speed;
            const target = Math.atan2(dy, dx); let diff = target - player.bodyAngle;
            while (diff > Math.PI) diff -= 2 * Math.PI; while (diff < -Math.PI) diff += 2 * Math.PI;
            player.bodyAngle += diff * 0.1;
            if (Math.random() < 0.3) player.tracks.push({ x: player.x, y: player.y, alpha: 0.5 });
        } else { player.vx = 0; player.vy = 0; }
    }
    player.x = Math.max(player.radius, Math.min(canvas.width - player.radius, player.x));
    player.y = Math.max(player.radius, Math.min(canvas.height - player.radius, player.y));
    const targetTurret = Math.atan2(mouse.y - player.y, mouse.x - player.x); let td = targetTurret - player.turretAngle;
    while (td > Math.PI) td -= 2 * Math.PI; while (td < -Math.PI) td += 2 * Math.PI; player.turretAngle += td * 0.15;
    if (mouse.down) shootPlayerBullet();
    if (player.shootCooldown > 0) player.shootCooldown--;
    if (player.invincibleTimer > 0) { player.invincibleTimer--; if (player.invincibleTimer <= 0) player.invincible = false; }
    for (let i = player.tracks.length - 1; i >= 0; i--) { player.tracks[i].alpha -= 0.01; if (player.tracks[i].alpha <= 0) player.tracks.splice(i, 1); }
    if (player.tracks.length > 100) player.tracks.splice(0, player.tracks.length - 100);
    for (let i = muzzleFlashes.length - 1; i >= 0; i--) { muzzleFlashes[i].life--; if (muzzleFlashes[i].life <= 0) muzzleFlashes.splice(i, 1); }
    for (let i = explosions.length - 1; i >= 0; i--) { const e = explosions[i]; e.x += e.vx; e.y += e.vy; e.life--; if (e.life <= 0) explosions.splice(i, 1); }
    for (let i = craters.length - 1; i >= 0; i--) { craters[i].life -= delta * 60; if (craters[i].life <= 0) craters.splice(i, 1); }
    if (craters.length > 50) craters.splice(0, craters.length - 50);
    for (let i = enemyLasers.length - 1; i >= 0; i--) { enemyLasers[i].life--; if (enemyLasers[i].life <= 0) enemyLasers.splice(i, 1); }

    // Пули игрока
    for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i]; b.x += b.vx; b.y += b.vy; b.life--;
        if (b.life <= 0 || b.x < 0 || b.x > canvas.width || b.y < 0 || b.y > canvas.height) { bullets.splice(i, 1); continue; }
        let hit = false;
        for (let t of trees) { if (t.health > 0 && Math.hypot(b.x - t.x, b.y - t.y) < t.radius) { t.health--; bullets.splice(i, 1); hit = true; break; } }
        if (hit) continue;
        if (boss && Math.hypot(b.x - boss.x, b.y - boss.y) < boss.radius + b.radius) {
            boss.health -= b.damage; addExplosion(b.x, b.y, 8); if (b.explodeRadius) applyExplosion(b.x, b.y, b.explodeRadius, b.damage); bullets.splice(i, 1); hit = true;
            if (boss.health <= 0) { playSound('explosion'); score += 500; kills++; boss = null; bossHpContainer.style.display = 'none'; bossKilled = true; }
        }
        if (!hit) for (let j = enemies.length - 1; j >= 0; j--) {
            const e = enemies[j];
            if (Math.hypot(b.x - e.x, b.y - e.y) < e.radius + b.radius) {
                e.health -= b.damage;
                addExplosion(b.x, b.y, 6);
                if (b.isRail && Math.random() < 0.3) { e.stunned = true; e.stunTimer = 30; }
                if (b.isFire) { e.burning = true; e.burnTimer = 5; e.burnDamage = 10; }
                if (b.explodeRadius) applyExplosion(b.x, b.y, b.explodeRadius, b.damage);
                bullets.splice(i, 1);
                if (e.health <= 0) { enemies.splice(j, 1); score += 10; kills++; }
                break;
            }
        }
    }
    function applyExplosion(x, y, radius, damage) { enemies.forEach(e => { if (Math.hypot(e.x - x, e.y - y) < radius) e.health -= damage; }); if (boss && Math.hypot(boss.x - x, boss.y - y) < radius) boss.health -= damage; }

    // Враги
    const aiSpeedMultiplier = difficulty >= 1.3 ? 0.3 : 0.2;
    for (let i = enemies.length - 1; i >= 0; i--) {
        const e = enemies[i];
        if (e.stunned) { e.stunTimer--; if (e.stunTimer <= 0) e.stunned = false; continue; }
        if (e.burning) { e.burnTimer -= delta; if (e.burnTimer <= 0) e.burning = false; else e.health = Math.max(0, e.health - e.burnDamage * delta); if (e.health <= 0) { enemies.splice(i, 1); score += 10; kills++; continue; } }
        let target = player, targetAngle = Math.atan2(player.y - e.y, player.x - e.x);
        if (e.stateTimer <= 0) { const roll = Math.random(); if (roll < 0.2) e.state = 'dodge'; else if (roll < 0.45) e.state = 'flank'; else e.state = 'chase'; e.stateTimer = 25 + Math.floor(Math.random() * 40); } else e.stateTimer--;
        let targetBodyAngle = targetAngle, targetSpeed = e.speed, dodgeX = 0, dodgeY = 0;
        if (e.state === 'dodge') { const dodgeAngle = targetAngle + (Math.random() < 0.5 ? 1 : -1) * Math.PI / 2 + (Math.random() - 0.5) * 0.8; targetBodyAngle = dodgeAngle; targetSpeed = e.speed * 2.2; }
        else if (e.state === 'flank') { const flankAngle = targetAngle + (Math.random() < 0.5 ? 1 : -1) * Math.PI / 2; targetBodyAngle = flankAngle; targetSpeed = e.speed * 1.5; }
        if (e.dodgeCooldown <= 0) { for (let b of bullets) { const dist = Math.hypot(e.x - b.x, e.y - b.y); if (dist < 70) { const bulletAngle = Math.atan2(e.y - b.y, e.x - b.x); dodgeX += Math.cos(bulletAngle) * 3.0; dodgeY += Math.sin(bulletAngle) * 3.0; } } if (dodgeX !== 0 || dodgeY !== 0) e.dodgeCooldown = 6; } else e.dodgeCooldown--;
        let bodyDiff = targetBodyAngle - e.bodyAngle; while (bodyDiff > Math.PI) bodyDiff -= 2 * Math.PI; while (bodyDiff < -Math.PI) bodyDiff += 2 * Math.PI; e.bodyAngle += bodyDiff * 0.07;
        e.x += Math.cos(e.bodyAngle) * targetSpeed + dodgeX; e.y += Math.sin(e.bodyAngle) * targetSpeed + dodgeY;
        if (e.x < e.radius) { e.x = e.radius; e.bodyAngle = Math.PI - e.bodyAngle; } if (e.x > canvas.width - e.radius) { e.x = canvas.width - e.radius; e.bodyAngle = Math.PI - e.bodyAngle; }
        if (e.y < e.radius) { e.y = e.radius; e.bodyAngle = -e.bodyAngle; } if (e.y > canvas.height - e.radius) { e.y = canvas.height - e.radius; e.bodyAngle = -e.bodyAngle; }
        if (Math.random() < 0.3) e.tracks.push({ x: e.x, y: e.y, alpha: 0.4 });
        for (let j = e.tracks.length - 1; j >= 0; j--) { e.tracks[j].alpha -= 0.01; if (e.tracks[j].alpha <= 0) e.tracks.splice(j, 1); }
        if (e.tracks.length > 100) e.tracks.splice(0, e.tracks.length - 100);
        let turretDiff = targetAngle - e.turretAngle; while (turretDiff > Math.PI) turretDiff -= 2 * Math.PI; while (turretDiff < -Math.PI) turretDiff += 2 * Math.PI; e.turretAngle += turretDiff * aiSpeedMultiplier;
        e.shootTimer--;
        if (e.shootTimer <= 0 && Math.random() < 0.35) {
            if (e.weapon === 'laser') { shootEnemyLaser(e); e.shootTimer = Math.max(30, 70 - getLevelBonus() * 5); }
            else { shootEnemyBullet(e); e.shootTimer = Math.max(20, 60 - getLevelBonus() * 5); }
        }
        if (!player.invincible && Math.hypot(player.x - e.x, player.y - e.y) < player.radius + e.radius) { player.health = Math.max(0, player.health - 20*difficulty); player.invincible = true; player.invincibleTimer = 40; const repel = Math.atan2(player.y - e.y, player.x - e.x); player.x += Math.cos(repel) * 15; player.y += Math.sin(repel) * 15; if (player.health <= 0) { player.health = 0; gameOver = true; canvas.focus(); break; } }
    }

    // Вражеские пули
    for (let i = enemyBullets.length - 1; i >= 0; i--) {
        const b = enemyBullets[i]; b.x += b.vx; b.y += b.vy; b.life--;
        if (b.life <= 0 || b.x < 0 || b.x > canvas.width || b.y < 0 || b.y > canvas.height) { enemyBullets.splice(i, 1); continue; }
        if (!player.invincible && Math.hypot(b.x - player.x, b.y - player.y) < player.radius + b.radius) {
            player.health = Math.max(0, player.health - (b.damage || 10*difficulty)); player.invincible = true; player.invincibleTimer = 40;
            if (b.isRail) { player.stunned = true; player.stunTimer = 500; }
            if (b.isFireWave) { player.burning = true; player.burnTimer = 5; player.burnDamage = 10; }
            enemyBullets.splice(i, 1);
            if (player.health <= 0) { player.health = 0; gameOver = true; canvas.focus(); break; }
        }
    }

    // Босс
    if (boss) {
        const target = Math.atan2(player.y - boss.y, player.x - boss.x); let bd = target - boss.bodyAngle; while (bd > Math.PI) bd -= 2 * Math.PI; while (bd < -Math.PI) bd += 2 * Math.PI;
        if (!boss.stopped) boss.bodyAngle += bd * 0.03;
        let dodgeX = 0, dodgeY = 0; if (boss.dodgeCooldown <= 0) { for (let b of bullets) { const dist = Math.hypot(boss.x - b.x, boss.y - b.y); if (dist < 100) { const a = Math.atan2(boss.y - b.y, boss.x - b.x); dodgeX += Math.cos(a) * 1.2; dodgeY += Math.sin(a) * 1.2; } } if (dodgeX !== 0 || dodgeY !== 0) boss.dodgeCooldown = 20; } else boss.dodgeCooldown--;
        if (!boss.stopped) { boss.x += Math.cos(boss.bodyAngle) * boss.speed + dodgeX; boss.y += Math.sin(boss.bodyAngle) * boss.speed + dodgeY; }
        boss.x = Math.max(boss.radius, Math.min(canvas.width - boss.radius, boss.x)); boss.y = Math.max(boss.radius, Math.min(canvas.height - boss.radius, boss.y));
        if (Math.random() < 0.3) boss.tracks.push({ x: boss.x, y: boss.y, alpha: 0.5 });
        for (let j = boss.tracks.length - 1; j >= 0; j--) { boss.tracks[j].alpha -= 0.01; if (boss.tracks[j].alpha <= 0) boss.tracks.splice(j, 1); }
        if (boss.tracks.length > 100) boss.tracks.splice(0, boss.tracks.length - 100);
        let td2 = target - boss.turretAngle; while (td2 > Math.PI) td2 -= 2 * Math.PI; while (td2 < -Math.PI) td2 += 2 * Math.PI; boss.turretAngle += td2 * 0.12;
        if (boss.health > boss.maxHealth * 0.5 && boss.phase !== 1) { boss.phase = 1; boss.stopped = false; } else if (boss.health <= boss.maxHealth * 0.5 && boss.phase !== 2) { boss.phase = 2; }
        bossNameLabel.textContent = `${boss.name} — Фаза ${boss.phase}`;
        boss.shootTimer -= delta * 60;
        if (boss.weapon === 'boss') {
            if (boss.shootTimer <= 0) { shootEnemyBullet(boss); boss.shootTimer = 35; }
            if (boss.phase === 2) {
                if (!boss.circleWaveTimer) boss.circleWaveTimer = 60;
                boss.circleWaveTimer -= delta * 60;
                if (boss.circleWaveTimer <= 0) {
                    for (let i = 0; i < 12; i++) {
                        let angle = (i / 12) * Math.PI * 2;
                        enemyBullets.push({ x: boss.x + Math.cos(angle) * boss.radius, y: boss.y + Math.sin(angle) * boss.radius, vx: Math.cos(angle) * 4, vy: Math.sin(angle) * 4, radius: 4, life: 120, damage: 15*difficulty });
                    }
                    boss.circleWaveTimer = 120;
                    playSound('shoot');
                }
            }
        } else if (boss.weapon === 'railgun') {
            if (boss.phase === 1) { if (boss.shootTimer <= 0) { shootRailgunBullet(boss, boss.turretAngle); boss.shootTimer = 40; } }
            else {
                if (boss.chargeTimer > 0) { boss.chargeTimer -= delta * 60; if (boss.chargeTimer <= 0) { if (boss.laserActive) { fireGiantLaser(boss); boss.laserActive = false; boss.stopped = false; } else if (boss.fireWaveTimer > 0) { spawnFireWave(boss); boss.fireWaveTimer = 0; boss.stopped = false; } } }
                else if (boss.shootTimer <= 0) { if (Math.random() < 0.5) { boss.laserActive = true; boss.chargeTimer = 90; boss.laserAngle = boss.turretAngle; boss.shootTimer = 120; boss.stopped = true; } else { boss.fireWaveTimer = 60; boss.chargeTimer = 60; boss.shootTimer = 100; boss.stopped = true; } }
            }
        }
        if (!player.invincible && Math.hypot(player.x - boss.x, player.y - boss.y) < player.radius + boss.radius) {
            player.health = Math.max(0, player.health - (boss.weapon === 'railgun' ? 50 : 40)*difficulty);
            player.invincible = true; player.invincibleTimer = 40;
            const repel = Math.atan2(player.y - boss.y, player.x - boss.x);
            player.x += Math.cos(repel) * 20; player.y += Math.sin(repel) * 20;
            if (player.health <= 0) { player.health = 0; gameOver = true; canvas.focus(); }
        }
        bossHpContainer.style.display = 'flex'; bossHpFill.style.width = (boss.health / boss.maxHealth * 100) + '%';
    }

    if (bossKilled && !boss && enemies.length === 0) { advanceCampaignLevel(); bossKilled = false; }
    if (gameMode === 'campaign' && !gameOver && enemies.length === 0 && !boss) { advanceCampaignLevel(); }
    if (gameMode !== 'campaign' && gameMode !== 'storm' && Math.random() < 0.03 && enemies.length < 8) spawnEnemy();
    updateHUD();
}

// ================== ОТРИСОВКА ==================
function drawTank(x,y,bodyAngle,turretAngle,bodyColor,turretColor,barrelColor,size=1,weapon='default'){
    ctx.save();ctx.translate(x,y);
    ctx.save();ctx.rotate(bodyAngle);
    const trackW = 40*size, trackH = 4*size;
    ctx.fillStyle='#1a1a1a';
    ctx.fillRect(-trackW/2,-14*size,trackW,trackH);
    ctx.fillRect(-trackW/2,10*size,trackW,trackH);
    ctx.fillStyle='#444';
    for(let s=-19;s<=19;s+=4){ ctx.fillRect(s*size,-14*size,2*size,trackH); ctx.fillRect(s*size,10*size,2*size,trackH); }
    ctx.restore();
    ctx.save();ctx.rotate(bodyAngle);
    const bw=36*size, bh=24*size;
    if(weapon==='railgun'){
        if (size > 1.5) {
            ctx.fillStyle='#b0bec5'; ctx.fillRect(-bw/2,-bh/2,bw,bh);
            ctx.fillStyle='#78909c'; ctx.fillRect(-bw/2,-2*size,bw,4*size);
        } else {
            ctx.fillStyle='#2980b9'; ctx.fillRect(-bw/2,-bh/2,bw,bh);
            ctx.fillStyle='#3498db'; ctx.fillRect(-bw/2,-2*size,bw,4*size);
        }
    } else if(weapon==='boss'){ ctx.fillStyle='#8b0000'; ctx.fillRect(-bw/2,-bh/2,bw,bh); }
    else { ctx.fillStyle=bodyColor; ctx.fillRect(-bw/2,-bh/2,bw,bh); }
    ctx.fillStyle='rgba(255,255,255,0.15)'; ctx.fillRect(-bw/2+2*size,-bh/2+2*size,bw*0.4,4*size);
    ctx.restore();
    ctx.save();ctx.rotate(turretAngle);
    if(weapon==='railgun'){
        if (size > 1.5) {
            ctx.fillStyle='#cfd8dc'; ctx.beginPath(); ctx.arc(0,0,14*size,0,Math.PI*2); ctx.fill();
            ctx.strokeStyle='#90a4ae'; ctx.lineWidth=1; ctx.stroke();
        } else {
            ctx.fillStyle='#2980b9'; ctx.beginPath(); ctx.arc(0,0,14*size,0,Math.PI*2); ctx.fill();
        }
        ctx.fillStyle='#2c3e50'; ctx.fillRect(10*size,-8*size,10*size,16*size); ctx.fillRect(-20*size,-8*size,10*size,16*size);
        ctx.fillStyle= size>1.5 ? '#78909c' : '#b0bec5';
        ctx.fillRect(-5*size,-20*size,10*size,8*size);
    } else {
        ctx.fillStyle=turretColor;ctx.beginPath();ctx.arc(0,0,14*size,0,Math.PI*2);ctx.fill();
        ctx.fillStyle='rgba(255,255,255,0.2)';ctx.beginPath();ctx.arc(-3*size,-3*size,4*size,0,Math.PI*2);ctx.fill();
    }
    if(weapon==='hammer'||weapon==='boss'){ctx.fillStyle='#2c3e50';ctx.fillRect(-5*size,-20*size,10*size,8*size);}
    ctx.fillStyle=barrelColor;
    if(weapon==='double'){ctx.fillRect(0,-5*size,20*size,3*size);ctx.fillRect(0,3*size,20*size,3*size);}
    else if(weapon==='laser'){ctx.fillRect(0,-2*size,24*size,3*size);ctx.fillStyle='#e74c3c';ctx.fillRect(20*size,-4*size,6*size,8*size);}
    else if(weapon==='hammer'||weapon==='boss'){ctx.fillRect(0,-5*size,18*size,8*size);}
    else if(weapon==='railgun'){
        ctx.fillStyle= size>1.5 ? '#78909c' : '#2c3e50';
        ctx.fillRect(0,-3*size,26*size,6*size);
    }
    else{ctx.fillRect(0,-4*size,22*size,6*size);}
    ctx.restore();
    ctx.restore();
}
function drawBoss(){ if(!boss)return; drawTank(boss.x,boss.y,boss.bodyAngle,boss.turretAngle,'#8b0000','#c0392b','#2c3e50',2.2,boss.weapon); }
function draw(){
    ctx.clearRect(0,0,canvas.width,canvas.height);
    if (gameMode === 'campaign' && campaignLevel <= 5) { ctx.fillStyle = '#3a3a2e'; ctx.fillRect(0,0,canvas.width,canvas.height); }
    else if (gameMode === 'campaign' && campaignLevel >= 6) { ctx.fillStyle = '#2d3e1f'; ctx.fillRect(0,0,canvas.width,canvas.height); }
    ctx.strokeStyle='rgba(255,255,255,0.05)';ctx.lineWidth=0.5;
    for(let i=0;i<canvas.width;i+=40){ctx.beginPath();ctx.moveTo(i,0);ctx.lineTo(i,canvas.height);ctx.stroke();}
    for(let j=0;j<canvas.height;j+=40){ctx.beginPath();ctx.moveTo(0,j);ctx.lineTo(canvas.width,j);ctx.stroke();}
    drawMenuEnemies();
    if(!gameMode)return;
    craters.forEach(c=>{ctx.fillStyle='rgba(50,50,50,0.7)';ctx.beginPath();ctx.arc(c.x,c.y,c.radius,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#222';ctx.lineWidth=2;ctx.stroke();});
    drawFactoryDecor();
    drawTrees();
    hearts.forEach(h => {
        ctx.fillStyle = '#e74c3c'; ctx.beginPath(); ctx.arc(h.x, h.y, h.radius, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(h.x - 2, h.y - 2, h.radius * 0.3, 0, Math.PI*2); ctx.fill();
    });
    if (gameMode === 'storm' && stormActive && stormBorder > 0) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(canvas.width/2, canvas.height/2, stormBorder, 0, Math.PI*2);
        ctx.strokeStyle = '#e67e22';
        ctx.lineWidth = 4;
        ctx.stroke();
        ctx.restore();
        if (Math.hypot(player.x - canvas.width/2, player.y - canvas.height/2) > stormBorder) {
            for (let i=0;i<50;i++) {
                const angle = Math.random()*Math.PI*2;
                const dist = stormBorder + Math.random()*30;
                const fx = canvas.width/2 + Math.cos(angle)*dist;
                const fy = canvas.height/2 + Math.sin(angle)*dist;
                ctx.fillStyle = `rgba(255, ${100+Math.random()*155}, 0, ${0.5+Math.random()*0.5})`;
                ctx.beginPath(); ctx.arc(fx, fy, 1.5+Math.random()*3, 0, Math.PI*2); ctx.fill();
            }
        }
    }
    enemies.forEach(e=>{
        drawTank(e.x,e.y,e.bodyAngle,e.turretAngle,'#c0392b','#e74c3c','#7f8c8d',1,e.weapon);
        if (e.burning) { ctx.fillStyle='rgba(255,69,0,0.3)'; ctx.beginPath(); ctx.arc(e.x,e.y,e.radius+5,0,Math.PI*2); ctx.fill(); }
        e.tracks.forEach(t=>{ctx.fillStyle=`rgba(150,150,150,${t.alpha})`;ctx.beginPath();ctx.arc(t.x,t.y,2,0,Math.PI*2);ctx.fill();});
    });
    if(boss){drawBoss();}
    if (gameMode === 'sandbox') { sandboxBosses.forEach(b => { drawTank(b.x,b.y,b.bodyAngle,b.turretAngle,'#8b0000','#c0392b','#2c3e50',2.2,b.weapon); }); }
    if(!player.invincible||Math.floor(Date.now()/100)%2===0)drawTank(player.x,player.y,player.bodyAngle,player.turretAngle,'#2980b9','#3498db','#2c3e50',1,player.weapon);
    player.tracks.forEach(t=>{ctx.fillStyle=`rgba(100,100,100,${t.alpha})`;ctx.beginPath();ctx.arc(t.x,t.y,2,0,Math.PI*2);ctx.fill();});
    if(player.burning){ctx.fillStyle='rgba(255,69,0,0.3)';ctx.beginPath();ctx.arc(player.x,player.y,player.radius+5,0,Math.PI*2);ctx.fill();}
    muzzleFlashes.forEach(f=>{ctx.fillStyle='#f39c12';ctx.beginPath();ctx.arc(f.x,f.y,5+f.life*2,0,Math.PI*2);ctx.fill();});
    explosions.forEach(e=>{ctx.fillStyle=e.color;ctx.beginPath();ctx.arc(e.x,e.y,2+e.life*0.5,0,Math.PI*2);ctx.fill();});
    enemyLasers.forEach(l=>{ ctx.strokeStyle='#e74c3c'; ctx.lineWidth=2; ctx.beginPath(); ctx.moveTo(l.x1,l.y1); ctx.lineTo(l.x2,l.y2); ctx.stroke(); });
    enemyBullets.forEach(b=>{
        if(b.isRail){ctx.strokeStyle='#3498db';ctx.lineWidth=2;ctx.beginPath();ctx.arc(b.x,b.y,b.radius,0,Math.PI*2);ctx.stroke();for(let k=0;k<3;k++){const a=Math.random()*Math.PI*2;ctx.beginPath();ctx.moveTo(b.x,b.y);ctx.lineTo(b.x+Math.cos(a)*10,b.y+Math.sin(a)*10);ctx.stroke();}}
        else if(b.isFireWave){ctx.fillStyle='rgba(255,69,0,0.6)';ctx.beginPath();ctx.arc(b.x,b.y,b.radius,0,Math.PI*2);ctx.fill();}
        else{ctx.fillStyle='#e67e22';ctx.beginPath();ctx.arc(b.x,b.y,b.radius||3,0,Math.PI*2);ctx.fill();}
    });
    enemies.forEach(e=>{const hp=Math.max(0,Math.min(1,e.health/e.maxHealth));ctx.fillStyle='#2c3e50';ctx.fillRect(e.x-15,e.y-e.radius-10,30,4);ctx.fillStyle='#2ecc71';ctx.fillRect(e.x-15,e.y-e.radius-10,30*hp,4);});
    const hpP=player.health/player.maxHealth;ctx.fillStyle='#2c3e50';ctx.fillRect(player.x-25,player.y-35,50,6);ctx.fillStyle='#2ecc71';ctx.fillRect(player.x-25,player.y-35,50*hpP,6);
    bullets.forEach(b=>{
        if(b.isLaser){ctx.strokeStyle='#e74c3c';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(player.x,player.y);ctx.lineTo(b.x,b.y);ctx.stroke();}
        else if(b.isRail){ctx.strokeStyle='#3498db';ctx.lineWidth=2;ctx.beginPath();ctx.arc(b.x,b.y,b.radius,0,Math.PI*2);ctx.stroke();for(let k=0;k<3;k++){const a=Math.random()*Math.PI*2;ctx.beginPath();ctx.moveTo(b.x,b.y);ctx.lineTo(b.x+Math.cos(a)*10,b.y+Math.sin(a)*10);ctx.stroke();}}
        else if(b.isFire){ctx.fillStyle='#ff6600'; ctx.beginPath(); ctx.arc(b.x,b.y,b.radius,0,Math.PI*2); ctx.fill(); ctx.fillStyle='#ff0'; ctx.beginPath(); ctx.arc(b.x-2,b.y-2,b.radius/2,0,Math.PI*2); ctx.fill();}
        else{ctx.fillStyle='#f1c40f';ctx.beginPath();ctx.arc(b.x,b.y,b.radius,0,Math.PI*2);ctx.fill();}
    });
    if(gameOver){ctx.fillStyle='rgba(0,0,0,0.7)';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#e74c3c';ctx.font='48px Arial';ctx.textAlign='center';ctx.fillText('ИГРА ОКОНЧЕНА',canvas.width/2,canvas.height/2-30);}
    if(paused&&!gameOver){ctx.fillStyle='rgba(0,0,0,0.5)';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#fff';ctx.font='36px Arial';ctx.textAlign='center';ctx.fillText('ПАУЗА',canvas.width/2,canvas.height/2);}
}

function restartGame(){
    if (!gameMode) return;
    if (gameMode === 'campaign') {
        loadCampaignState(true, true);
        player.x = canvas.width/2; player.y = canvas.height/2;
        player.invincible = false; player.invincibleTimer = 0;
        bullets=[]; enemyBullets=[]; enemies=[]; boss=null; bossKilled=false;
        setupCampaignLevel(campaignLevel);
        gameOver = false;
        canvas.focus();
        updateHUD();
    } else if (gameMode === 'storm') {
        player.health = 100; player.maxHealth = 100;
        player.burning = false; player.burnTimer = 0;
        player.stunned = false; player.stunTimer = 0;
        enemies = [];
        stormActive = true;
        stormBorder = Math.hypot(canvas.width/2, canvas.height/2);
        for (let i=0;i<8;i++) spawnEnemy();
        gameOver = false;
        canvas.focus();
        updateHUD();
    } else {
        startGame();
    }
}

// ================== ФОН ГЛАВНОГО МЕНЮ ==================
function initMenuEnemies() { menuEnemies = []; for (let i=0;i<MAX_MENU_ENEMIES;i++) menuEnemies.push({ x:Math.random()*canvas.width, y:Math.random()*canvas.height, radius:18, bodyAngle:Math.random()*Math.PI*2, turretAngle:Math.random()*Math.PI*2, speed:1.5+Math.random()*2, changeTimer:60+Math.floor(Math.random()*120), tracks:[] }); }
function updateMenuEnemies() {
    if (gameMode) return;
    menuEnemies.forEach(e => {
        e.x += Math.cos(e.bodyAngle)*e.speed; e.y += Math.sin(e.bodyAngle)*e.speed;
        if(e.x<e.radius){e.x=e.radius;e.bodyAngle=Math.PI-e.bodyAngle;} if(e.x>canvas.width-e.radius){e.x=canvas.width-e.radius;e.bodyAngle=Math.PI-e.bodyAngle;}
        if(e.y<e.radius){e.y=e.radius;e.bodyAngle=-e.bodyAngle;} if(e.y>canvas.height-e.radius){e.y=canvas.height-e.radius;e.bodyAngle=-e.bodyAngle;}
        e.changeTimer--; if(e.changeTimer<=0){e.bodyAngle=Math.random()*Math.PI*2;e.changeTimer=60+Math.floor(Math.random()*120);}
        e.turretAngle = e.bodyAngle;
        if(Math.random()<0.3) e.tracks.push({x:e.x,y:e.y,alpha:0.4});
        for(let i=e.tracks.length-1;i>=0;i--){e.tracks[i].alpha-=0.01;if(e.tracks[i].alpha<=0)e.tracks.splice(i,1);}
    });
}
function drawMenuEnemies() {
    if (gameMode) return;
    menuEnemies.forEach(e => {
        drawTank(e.x,e.y,e.bodyAngle,e.turretAngle,'#c0392b','#e74c3c','#7f8c8d');
        e.tracks.forEach(t=>{ctx.fillStyle=`rgba(150,150,150,${t.alpha})`;ctx.beginPath();ctx.arc(t.x,t.y,2,0,Math.PI*2);ctx.fill();});
    });
}
initMenuEnemies();

function generateTrees() { trees = []; if ((gameMode === 'campaign' && campaignLevel >= 6 && campaignLevel <= 10) || gameMode === 'sandbox') for (let i=0;i<12;i++) trees.push({ x:80+Math.random()*(canvas.width-160), y:80+Math.random()*(canvas.height-160), radius:25, health:3 }); }
function drawFactoryDecor() {
    if (gameMode !== 'campaign' || campaignLevel > 5) return;
    ctx.fillStyle = '#5a4a3a';
    for (let i = 0; i < 8; i++) { ctx.fillRect(100 + i*150, canvas.height-60, 120, 15); ctx.fillStyle = '#3a3a3a'; ctx.fillRect(110 + i*150, canvas.height-45, 100, 8); ctx.fillStyle = '#5a4a3a'; }
    ctx.fillStyle = '#b87333'; ctx.beginPath(); ctx.arc(200, canvas.height-100, 20, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#ff6600'; ctx.beginPath(); ctx.arc(200, canvas.height-100, 12, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#888'; ctx.fillRect(600, canvas.height-150, 40, 80);
    ctx.fillStyle = '#666'; ctx.fillRect(590, canvas.height-160, 60, 10);
}
function drawTrees() {
    if ((gameMode === 'campaign' && campaignLevel >= 6 && campaignLevel <= 10) || gameMode === 'sandbox') {
        trees.forEach(t => { if (t.health <= 0) return; ctx.fillStyle='#4a6741'; ctx.fillRect(t.x-8,t.y-30,16,30); ctx.fillStyle='#2ecc71'; ctx.beginPath(); ctx.arc(t.x,t.y-35,t.radius,0,Math.PI*2); ctx.fill(); ctx.fillStyle='#27ae60'; ctx.beginPath(); ctx.arc(t.x-5,t.y-40,t.radius*0.7,0,Math.PI*2); ctx.fill(); ctx.fillStyle='#2ecc71'; ctx.beginPath(); ctx.arc(t.x+5,t.y-38,t.radius*0.6,0,Math.PI*2); ctx.fill(); });
    }
}

// ================== ЗАПУСК ==================
function initApp() {
    resizeCanvas();
    loadCampaignProgress();
    loadHighScore();
    showMainMenu();
}

window.addEventListener('DOMContentLoaded', () => {
    initMenuEnemies();
    initApp();
    requestAnimationFrame(gameLoop);
});

function gameLoop(ts) { update(ts); draw(); requestAnimationFrame(gameLoop); }