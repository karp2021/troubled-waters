const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const startScreen = document.getElementById('startScreen');
const startButton = document.getElementById('startButton');
const gameUIOverlay = document.getElementById('gameUIOverlay');
const scoreDisplay = document.getElementById('scoreDisplay');
const highScoreDisplay = document.getElementById('highScoreDisplay');
const startHighScoreDisplay = document.getElementById('startHighScore');
const debugToggle = document.getElementById('debugToggle');
const godModeToggle = document.getElementById('godModeToggle');

const STATE_START = 0, STATE_PLAYING = 1, STATE_GAMEOVER = 2, STATE_PAUSED = 3, STATE_TRANSITION = 4;
let currentState = STATE_START, frames = 0, score = 0, isDebugMode = false, isGodMode = false;
let gameSpeed = 350, phaseActive = "open_sea", transitionSafe = false;
let highScore = localStorage.getItem('troubledWatersHighScore') || 0;
let phaseObstacleCounter = 0, speechBubbleTimer = 0;

let lastFrameTime = 0;
const targetFPS = 60;
const frameInterval = 1000 / targetFPS;

// ASSETS
const playerSprite = new Image(); playerSprite.src = 'assets/ship.png'; 
const barrelSprite = new Image(); barrelSprite.src = 'assets/barrel.png'; 
const obstacleSprite = new Image(); obstacleSprite.src = 'assets/rock.png'; 
const canyonObstacleSprite = new Image(); canyonObstacleSprite.src = 'assets/canyon_rock.png'; 
const coinSprite = new Image(); coinSprite.src = 'assets/coin.png'; 
const sharkSprite = new Image(); sharkSprite.src = 'assets/shark_fin.png'; 

// MUSIC
const musicTracks = ['assets/music.mp3', 'assets/music2.mp3', 'assets/music3.mp3', 'assets/music4.mp3'];
const bgm = new Audio(); bgm.volume = 0.4;
const sounds = { jump: new Audio('assets/jump.mp3'), crash: new Audio('assets/crash.mp3') };

// --- SAFETY: Audio Wrapper ---
function playSound(sound) {
    if (sound) {
        sound.currentTime = 0;
        sound.play().catch(() => {}); 
    }
}

// BACKGROUNDS
const COLOR_STAGES = [
    { top: [30, 60, 114], mid: [42, 82, 152] }, 
    { top: [56, 95, 79], mid: [95, 122, 107] }, 
    { top: [30, 70, 50], mid: [60, 90, 80] },
    { top: [40, 20, 10], mid: [70, 30, 20] } 
];
let currentDrawTop = [...COLOR_STAGES[0].top], currentDrawMid = [...COLOR_STAGES[0].mid];

function updateBackgroundColors(dt) {
    let stage = phaseActive === "canyon" ? 3 : (Math.floor(score / 150) % 3);
    let targetTop = COLOR_STAGES[stage].top;
    let targetMid = COLOR_STAGES[stage].mid;
    for (let i = 0; i < 3; i++) {
        currentDrawTop[i] += (targetTop[i] - currentDrawTop[i]) * 2 * dt;
        currentDrawMid[i] += (targetMid[i] - currentDrawMid[i]) * 2 * dt;
    }
}

function drawGameBackground(timestamp) {
    const toRGB = (c) => `rgb(${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])})`;
    const grad = ctx.createLinearGradient(0, 0, 0, 1000);
    grad.addColorStop(0, toRGB(currentDrawTop));
    grad.addColorStop(0.5, toRGB(currentDrawMid));
    grad.addColorStop(1, toRGB(currentDrawTop));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 1800, 1000);

    ctx.strokeStyle = 'rgba(255,255,255,0.1)'; ctx.lineWidth = 2;
    for (let y = 0; y < 1000; y += 50) {
        ctx.beginPath();
        for (let x = 0; x <= 1800; x += 40) {
            let yOff = Math.sin((x * 0.005) + (timestamp * 0.002) + (y * 0.01)) * 15;
            if (x === 0) ctx.moveTo(x, y + yOff); else ctx.lineTo(x, y + yOff);
        }
        ctx.stroke();
    }
}

const canyonMist = {
    particles: [],
    update(dt) {
        if (phaseActive !== "canyon") { this.particles = []; return; }
        if (Math.random() < 0.2) {
            this.particles.push({
                x: 1850, y: Math.random() * 1000,
                vx: -gameSpeed * (1 + Math.random()),
                size: Math.random() * 80 + 40,
                alpha: Math.random() * 0.2
            });
        }
        for (let i = this.particles.length - 1; i >= 0; i--) {
            this.particles[i].x += this.particles[i].vx * dt;
            if (this.particles[i].x < -200) this.particles.splice(i, 1);
        }
    },
    draw() {
        ctx.save();
        this.particles.forEach(p => {
            ctx.globalAlpha = p.alpha;
            ctx.fillStyle = "#4e6b5a";
            ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
        });
        ctx.restore();
    }
};

const sharkSystem = {
    sharks: [],
    update(dt) {
        if (phaseActive === "canyon") { this.sharks = []; return; }
        if (Math.random() < 0.003) {
            this.sharks.push({ 
                x: 1900, 
                y: Math.random() * 900 + 50, 
                speed: gameSpeed * 1.5,
                bobPhase: Math.random() * Math.PI * 2 
            });
        }
        this.sharks.forEach((s, i) => { s.x -= s.speed * dt; if (s.x < -150) this.sharks.splice(i, 1); });
    },
    draw(timestamp) {
        if (phaseActive === "canyon") return;
        this.sharks.forEach(s => {
            let waveY = Math.sin((timestamp * 0.003) + s.bobPhase) * 10;
            ctx.drawImage(sharkSprite, s.x, s.y + waveY, 70, 70);
        });
    }
};

const player = {
    x: 200, y: 500, w: 80, h: 70, velocity: 0, gravity: 1200, jumpPower: -520, invincibleTimer: 0,
    wakeParticles: [], prevVelocity: 0,
    update(dt) {
        if (this.invincibleTimer > 0) this.invincibleTimer -= dt;
        this.prevVelocity = this.velocity;
        this.velocity += this.gravity * dt;
        this.y += this.velocity * dt;

        // --- SAFETY: NaN Protection ---
        if (isNaN(this.y)) { this.y = 500; this.velocity = 0; }

        if (this.prevVelocity > 0 && this.velocity < 0) this.createSplash();

        if ((this.y > 970 || this.y < 30) && !isGodMode && !transitionSafe) gameOver();
        else if (this.y > 970 || this.y < 30) { this.y = Math.max(30, Math.min(970, this.y)); this.velocity = 0; }

        if (frames % 2 === 0) {
            this.wakeParticles.push({
                x: this.x + 28, y: this.y + 20, vx: -gameSpeed * 0.7, vy: (Math.random() - 0.5) * 50, 
                size: Math.random() * 1.0 + 0.5, alpha: 0.8, type: 'wake'
            });
        }
        for (let i = 0; i < this.wakeParticles.length; i++) {
            let p = this.wakeParticles[i];
            p.x += p.vx * dt; p.y += p.vy * dt; 
            p.alpha -= (p.type === 'splash' ? 3.0 : 5.5) * dt; 
            if (p.alpha <= 0) this.wakeParticles.splice(i--, 1);
        }
    },
    createSplash() {
        for(let i=0; i<8; i++) {
            this.wakeParticles.push({
                x: this.x + 10, y: this.y + 30, vx: (Math.random() - 0.7) * 200, vy: (Math.random() - 0.5) * 150,
                size: Math.random() * 4 + 2, alpha: 1.0, type: 'splash'
            });
        }
    },
    draw() {
        ctx.save(); ctx.translate(this.x, this.y);
        if (this.invincibleTimer > 0 || isGodMode) {
            ctx.strokeStyle = isGodMode ? '#ff00ff' : '#00ffff'; ctx.lineWidth = 4;
            ctx.beginPath(); ctx.arc(0,0,60,0,Math.PI*2); ctx.stroke();
            if (!isGodMode) {
                ctx.fillStyle = '#ffffff'; ctx.font = 'bold 24px Courier New';
                ctx.textAlign = 'center'; ctx.fillText(Math.ceil(this.invincibleTimer), 0, 85);
            }
        }
        ctx.rotate(this.velocity * 0.0005);
        ctx.drawImage(playerSprite, -40, -35, 80, 70);
        ctx.restore();

        ctx.save();
        this.wakeParticles.forEach(p => {
            ctx.globalAlpha = p.alpha;
            ctx.fillStyle = p.type === 'splash' ? "rgba(255,255,255,0.9)" : "rgba(255, 255, 255, 0.7)";
            ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
        });
        ctx.restore();

        if (currentState === STATE_TRANSITION && speechBubbleTimer > 0) this.drawSpeechBubble();
    },
    drawSpeechBubble() {
        const text = "Capt'n! Cutthroat Canyon is on the horizon!";
        ctx.font = 'bold 24px Courier New';
        const tw = ctx.measureText(text).width;
        const bx = this.x + 50, by = this.y - 120, bw = tw + 30, bh = 50;
        ctx.fillStyle = "white"; ctx.strokeStyle = "black"; ctx.lineWidth = 2;
        
        // --- SAFETY: Using standard Rectangles instead of roundRect ---
        ctx.fillRect(bx, by, bw, bh);
        ctx.strokeRect(bx, by, bw, bh);
        
        ctx.beginPath();
        ctx.moveTo(bx + 20, by + bh); 
        ctx.lineTo(bx + 10, by + bh + 15); 
        ctx.lineTo(bx + 40, by + bh);
        ctx.fill(); ctx.stroke();
        
        ctx.fillStyle = "black"; ctx.textAlign = "left"; ctx.fillText(text, bx + 15, by + 32);
    }
};

const boulders = {
    list: [], spawnTimer: 0, obstacleCounter: 0, channelY: 500, channelDrift: 0,
    update(dt) {
        const baseSpeed = 350;
        const speedIncrements = Math.floor(score / 50);
        gameSpeed = baseSpeed + (speedIncrements * 30);

        const cycle = score % 650; 
        if (cycle >= 450 && phaseActive === "open_sea") { startPhaseTransition("canyon"); return; }
        else if (cycle < 450 && score > 0 && phaseActive === "canyon") { startPhaseTransition("open_sea"); return; }

        this.spawnTimer += dt;
        const isC = phaseActive === "canyon";
        const interval = isC ? (130 / gameSpeed) : (700 / gameSpeed);

        if (this.spawnTimer > interval && phaseActive !== "transitioning") {
            this.obstacleCounter++;
            let gap = isC ? 320 : 260, topH, item = null;
            if (isC) {
                const horizontalDist = 140; 
                const timeToTravel = horizontalDist / gameSpeed;
                const maxFall = 0.5 * player.gravity * Math.pow(timeToTravel, 2) * 0.8; 
                this.channelDrift += (Math.random() - 0.5) * 180; 
                this.channelDrift *= 0.99; 
                const maxVerticalVelocity = maxFall / timeToTravel;
                this.channelDrift = Math.max(-maxVerticalVelocity, Math.min(maxVerticalVelocity, this.channelDrift));
                this.channelY += this.channelDrift; 
                if (this.channelY < 300) this.channelDrift += 2.5;
                if (this.channelY > 700) this.channelDrift -= 2.5;
                this.channelY = Math.max(220, Math.min(780, this.channelY));
                topH = this.channelY - (gap / 2);
                if (this.obstacleCounter % 40 === 0) item = 'barrel';
                else if (Math.random() < 0.1) item = 'coin';
            } else {
                topH = Math.random() * 450 + 100;
                if (score >= 20 && this.obstacleCounter % 15 === 0) item = 'barrel';
                else if (Math.random() < 0.6) item = 'coin';
            }
            let vOff = []; for(let j=0; j<10; j++) vOff.push((Math.random() - 0.5) * (isC ? 60 : 0));
            this.list.push({ 
                x: 1850, top: topH, bot: 1000 - topH - gap, passed: false, item, 
                itemY: isC ? this.channelY : (topH + gap/2), isCanyon: isC, 
                visualOffsets: vOff, shouldRotate: (this.obstacleCounter % 3 === 0 && isC)
            });
            this.spawnTimer = 0;
        }

        for (let i = this.list.length - 1; i >= 0; i--) {
            let b = this.list[i];
            b.x -= gameSpeed * dt;
            let rx = 30, ry = 25;
            let hitX = b.x + 30, hitW = 60;
            let closestX = Math.max(hitX, Math.min(player.x, hitX + hitW));
            let hitT = (Math.pow(player.x - closestX, 2) / Math.pow(rx, 2)) + (Math.pow(player.y - Math.min(player.y, b.top), 2) / Math.pow(ry, 2)) <= 1;
            let hitB = (Math.pow(player.x - closestX, 2) / Math.pow(rx, 2)) + (Math.pow(player.y - Math.max(player.y, 1000 - b.bot), 2) / Math.pow(ry, 2)) <= 1;
            if ((hitT || hitB) && player.invincibleTimer <= 0 && !isGodMode && !transitionSafe) gameOver();
            if (b.item && Math.hypot(player.x - (b.x+60), player.y - b.itemY) < 40) {
                if (b.item === 'coin') score += 5; else player.invincibleTimer = 8;
                b.item = null;
            }
            if (b.x + 120 < player.x && !b.passed) { 
                b.passed = true; 
                if (b.isCanyon) { phaseObstacleCounter++; if(phaseObstacleCounter >= 10) { score++; phaseObstacleCounter = 0; } }
                else score++;
            }
            if (b.x < -200) this.list.splice(i, 1);
        }
    },
    draw() {
        this.list.forEach(b => {
            const currentSprite = b.isCanyon ? canyonObstacleSprite : obstacleSprite;
            const size = b.isCanyon ? 108 : 120; 
            const drawStack = (yStart, isT) => {
                let idx = isT ? 0 : 5;
                for (let y = yStart; isT ? y > -120 : y < 1120; isT ? y -= 120 : y += 120) {
                    let ox = b.isCanyon ? b.visualOffsets[idx % 10] : 0;
                    ctx.save(); ctx.translate(b.x + ox + size / 2, y + size / 2);
                    if (b.shouldRotate) ctx.rotate(Math.PI / 2);
                    ctx.drawImage(currentSprite, -size / 2, -size / 2, size, size);
                    ctx.restore(); idx++;
                }
            };
            drawStack(b.top - 120, true); drawStack(1000 - b.bot, false);
            if (isDebugMode) {
                ctx.strokeStyle = 'red'; ctx.lineWidth = 2;
                ctx.strokeRect(b.x + 30, 0, 60, b.top); ctx.strokeRect(b.x + 30, 1000 - b.bot, 60, b.bot);
            }
            if (b.item === 'coin') ctx.drawImage(coinSprite, b.x + 40, b.itemY - 20, 40, 40);
            if (b.item === 'barrel') ctx.drawImage(barrelSprite, b.x + 40, b.itemY - 25, 40, 50);
        });
    }
};

function startPhaseTransition(next) {
    currentState = STATE_TRANSITION; phaseActive = "transitioning";
    transitionSafe = true; speechBubbleTimer = 3.5;
    setTimeout(() => { phaseActive = next; currentState = STATE_PLAYING; transitionSafe = false; }, 3500);
}

function gameLoop(timestamp) {
    const elapsed = timestamp - lastFrameTime;
    if (elapsed >= frameInterval) {
        lastFrameTime = timestamp - (elapsed % frameInterval);
        const dt = frameInterval / 1000;
        ctx.clearRect(0, 0, 1800, 1000);
        drawGameBackground(timestamp);
        if (currentState === STATE_PLAYING || currentState === STATE_TRANSITION) {
            frames++; updateBackgroundColors(dt); sharkSystem.update(dt); boulders.update(dt); player.update(dt);
            canyonMist.update(dt);
            if (speechBubbleTimer > 0) speechBubbleTimer -= dt;
        }
        sharkSystem.draw(timestamp); boulders.draw(); player.draw();
        canyonMist.draw();
        if (currentState === STATE_PAUSED) drawPauseMenu();
        if (currentState === STATE_GAMEOVER) drawGameOver();
        scoreDisplay.textContent = `TREASURE: ${score}`;
        highScoreDisplay.textContent = `HIGH: ${highScore}`;
    }
    requestAnimationFrame(gameLoop);
}

function drawPauseMenu() {
    ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(0, 0, 1800, 1000);
    ctx.fillStyle = 'white'; ctx.font = 'bold 80px Courier New'; ctx.textAlign = 'center';
    ctx.fillText("PAUSED", 900, 400);
    ctx.fillStyle = bgm.muted ? '#ff4444' : '#d4af37';
    ctx.fillRect(750, 480, 300, 80);
    ctx.fillStyle = '#1a1a1a'; ctx.font = 'bold 30px Courier New';
    ctx.fillText(bgm.muted ? "UNMUTE" : "MUTE", 900, 530);
}

function drawGameOver() {
    ctx.fillStyle = 'rgba(0,0,0,0.85)'; ctx.fillRect(0,0,1800,1000);
    ctx.fillStyle = '#ff4444'; ctx.font = 'bold 100px Courier New'; ctx.textAlign = 'center';
    ctx.fillText("SHIPWRECKED", 900, 460);
    ctx.fillStyle = '#d4af37'; ctx.font = 'bold 45px Courier New';
    ctx.fillText(`TREASURE LOST: ${score}`, 900, 540);
}

function startGame() {
    isDebugMode = debugToggle.checked; isGodMode = godModeToggle.checked;
    score = 0; gameSpeed = 350; currentState = STATE_PLAYING; phaseActive = "open_sea";
    player.y = 500; player.velocity = 0; player.invincibleTimer = 0; player.wakeParticles = [];
    boulders.list = []; boulders.channelY = 500; boulders.channelDrift = 0;
    sharkSystem.sharks = []; boulders.obstacleCounter = 0; phaseObstacleCounter = 0; speechBubbleTimer = 0;
    startScreen.classList.add('hidden'); gameUIOverlay.style.display = 'flex';
    
    currentTrackIndex = Math.floor(Math.random() * musicTracks.length);
    bgm.src = musicTracks[currentTrackIndex]; 
    bgm.play().catch(() => {});
}

function gameOver() {
    if (currentState === STATE_GAMEOVER) return;
    currentState = STATE_GAMEOVER; bgm.pause(); playSound(sounds.crash);
    if (score > highScore) { highScore = score; localStorage.setItem('troubledWatersHighScore', highScore); }
    startHighScoreDisplay.textContent = highScore;
}

bgm.addEventListener('ended', () => {
    setTimeout(() => { bgm.currentTime = 0; bgm.play().catch(() => {}); }, 1000);
});

window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && (currentState === STATE_PLAYING || currentState === STATE_PAUSED)) {
        currentState = (currentState === STATE_PLAYING) ? STATE_PAUSED : STATE_PLAYING;
        currentState === STATE_PAUSED ? bgm.pause() : bgm.play();
    }
    if (e.code === 'Space') {
        if (currentState === STATE_PLAYING || currentState === STATE_TRANSITION) { 
            player.velocity = player.jumpPower; playSound(sounds.jump); 
        }
        else if (currentState === STATE_GAMEOVER || currentState === STATE_START) startGame();
    }
});

// --- UPDATED INPUT HANDLER (Handles ALL pointers: Mouse, Touch, Pen) ---
function handleInput(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const mx = (clientX - rect.left) * (1800 / rect.width);
    const my = (clientY - rect.top) * (1000 / rect.height);

    if (currentState === STATE_PAUSED) {
        if (mx >= 750 && mx <= 1050 && my >= 480 && my <= 560) bgm.muted = !bgm.muted;
        else { currentState = STATE_PLAYING; bgm.play(); }
    } else if (currentState === STATE_PLAYING || currentState === STATE_TRANSITION) {
        player.velocity = player.jumpPower; playSound(sounds.jump);
    } else if (currentState === STATE_GAMEOVER) startGame();
}

// --- RESTORED: Snappy Pointer Events ---
canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault(); 
    handleInput(e.clientX, e.clientY);
});

startButton.addEventListener('click', startGame);
startButton.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    startGame();
});

startHighScoreDisplay.textContent = highScore;
requestAnimationFrame(gameLoop);