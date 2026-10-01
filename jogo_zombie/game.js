const canvas = document.getElementById('gameCanvas');
const context = canvas.getContext('2d');
context.imageSmoothingEnabled = false;

// ============================================================
// CONFIGURAÇÕES
// ============================================================
const HUD_HEIGHT = 80;
const MAP_SOURCE = { x: 0, y: 80, width: 1536, height: 944 };
const WORLD = { width: canvas.width, height: canvas.height - HUD_HEIGHT };

const keys = {};
let paused = false;
let gameOver = false;
let lastTime = 0;
let score = 0;
let crystals = 0;
let coins = 0;
let enemiesDefeated = 0;
let wave = 1;
let spawnQueue = 0;
let spawnTimer = 0;

const images = {};
let loaded = 0;
const imageFiles = {
  map: 'assets/mapa.png',
  playerWalk: 'assets/player_walk.png',
  playerAttack: 'assets/player_attack.png',
  zombieWalk: 'assets/zombie_walk.png',
  zombieAttack: 'assets/zombie_attack.png'
};

function loadImages(callback) {
  const names = Object.keys(imageFiles);
  names.forEach(name => {
    images[name] = new Image();
    images[name].src = imageFiles[name];
    images[name].onload = () => {
      loaded++;
      if (loaded === names.length) callback();
    };
    images[name].onerror = () => {
      console.error('Não foi possível carregar:', imageFiles[name]);
    };
  });
}

// ============================================================
// TECLADO
// ============================================================
document.addEventListener('keydown', event => {
  keys[event.code] = true;

  if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'Enter'].includes(event.code)) {
    event.preventDefault();
  }

  if (event.code === 'Space' && !event.repeat && !paused && !gameOver) {
    player.attack();
  }

  if (event.code === 'Enter' && !event.repeat && !gameOver) {
    paused = !paused;
  }

  if (event.code === 'KeyR' && gameOver) {
    restartGame();
  }
});

document.addEventListener('keyup', event => {
  keys[event.code] = false;
});

// ============================================================
// SPRITE
// ============================================================
class SpriteAnimation {
  constructor(image, columns, rows, frameDuration = 100) {
    this.image = image;
    this.columns = columns;
    this.rows = rows;
    this.frameWidth = image.width / columns;
    this.frameHeight = image.height / rows;
    this.frame = 0;
    this.frameDuration = frameDuration;
    this.elapsed = 0;
    this.direction = 0;
  }

  update(dt, row, playing = true) {
    this.direction = row;
    if (!playing) return;

    this.elapsed += dt;
    if (this.elapsed >= this.frameDuration) {
      this.elapsed = 0;
      this.frame = (this.frame + 1) % this.columns;
    }
  }

  draw(x, y, width, height) {
    context.drawImage(
      this.image,
      this.frame * this.frameWidth,
      this.direction * this.frameHeight,
      this.frameWidth,
      this.frameHeight,
      x,
      y,
      width,
      height
    );
  }
}

// ============================================================
// JOGADOR
// ============================================================
class Player {
  constructor() {
    this.x = WORLD.width / 2 - 32;
    this.y = WORLD.height / 2 - 32;
    this.width = 82;
    this.height = 82;
    this.speed = 220;
    this.life = 100;
    this.maxLife = 100;
    this.direction = 0;
    this.attacking = false;
    this.attackTime = 0;
    this.attackDuration = 430;
    this.attackCooldown = 0;
    this.invulnerable = 0;

    this.walk = new SpriteAnimation(images.playerWalk, 12, 4, 80);
    this.attackAnimation = new SpriteAnimation(images.playerAttack, 8, 4, 55);
  }

  update(dt) {
    if (this.invulnerable > 0) this.invulnerable -= dt;
    if (this.attackCooldown > 0) this.attackCooldown -= dt;

    let dx = 0;
    let dy = 0;

    if (keys.KeyW) { dy -= 1; this.direction = 3; }
    if (keys.KeyS) { dy += 1; this.direction = 0; }
    if (keys.KeyA) { dx -= 1; this.direction = 1; }
    if (keys.KeyD) { dx += 1; this.direction = 2; }

    if (dx !== 0 || dy !== 0) {
      const length = Math.hypot(dx, dy);
      dx /= length;
      dy /= length;
      this.x += dx * this.speed * dt / 1000;
      this.y += dy * this.speed * dt / 1000;
    }

    this.x = Math.max(0, Math.min(WORLD.width - this.width, this.x));
    this.y = Math.max(0, Math.min(WORLD.height - this.height, this.y));

    if (this.attacking) {
      this.attackTime -= dt;
      this.attackAnimation.update(dt, this.direction, true);
      if (this.attackTime <= 0) this.attacking = false;
    } else {
      this.walk.update(dt, this.direction, dx !== 0 || dy !== 0);
    }
  }

  attack() {
    if (this.attackCooldown > 0 || this.attacking) return;
    this.attacking = true;
    this.attackTime = this.attackDuration;
    this.attackCooldown = 520;
    this.attackAnimation.frame = 0;
    this.attackAnimation.elapsed = 0;

    // O dano acontece no meio da animação.
    setTimeout(() => {
      if (!gameOver) checkPlayerAttack();
    }, 170);
  }

  draw() {
    // Pequeno efeito de piscar quando recebe dano.
    if (this.invulnerable > 0 && Math.floor(this.invulnerable / 70) % 2 === 0) return;

    if (this.attacking) {
      this.attackAnimation.draw(this.x, this.y + HUD_HEIGHT, this.width, this.height);
    } else {
      this.walk.draw(this.x, this.y + HUD_HEIGHT, this.width, this.height);
    }
  }

  takeDamage(amount) {
    if (this.invulnerable > 0 || gameOver) return;
    this.life -= amount;
    this.invulnerable = 650;
    if (this.life <= 0) {
      this.life = 0;
      endGame();
    }
  }
}

// ============================================================
// ZUMBI
// ============================================================
class Zombie {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.width = 78;
    this.height = 78;
    // A cada onda os zumbis ficam um pouco mais fortes, mas o crescimento é controlado.
    const strength = Math.min(wave - 1, 12);
    this.speed = 55 + strength * 5 + Math.random() * 25;
    this.life = Math.min(100, 40 + strength * 6);
    this.maxLife = this.life;
    this.damage = 8 + Math.floor(strength * 1.2);
    this.attackDelay = Math.max(620, 900 - strength * 20);
    this.direction = 0;
    this.attacking = false;
    this.attackTime = 0;
    this.attackCooldown = 0;
    this.dead = false;

    this.walk = new SpriteAnimation(images.zombieWalk, 6, 4, 100);
    this.attackAnimation = new SpriteAnimation(images.zombieAttack, 6, 4, 75);
  }

  update(dt) {
    if (this.dead) return;
    if (this.attackCooldown > 0) this.attackCooldown -= dt;

    const playerCenterX = player.x + player.width / 2;
    const playerCenterY = player.y + player.height / 2;
    const zombieCenterX = this.x + this.width / 2;
    const zombieCenterY = this.y + this.height / 2;

    let dx = playerCenterX - zombieCenterX;
    let dy = playerCenterY - zombieCenterY;
    const distance = Math.hypot(dx, dy);

    if (distance > 0) {
      dx /= distance;
      dy /= distance;
    }

    if (Math.abs(dx) > Math.abs(dy)) {
      this.direction = dx < 0 ? 1 : 2;
    } else {
      this.direction = dy < 0 ? 3 : 0;
    }

    if (distance < 55) {
      this.attacking = true;
      if (this.attackCooldown <= 0) {
        this.attackCooldown = this.attackDelay;
        player.takeDamage(this.damage);
      }
    } else {
      this.attacking = false;
      this.x += dx * this.speed * dt / 1000;
      this.y += dy * this.speed * dt / 1000;
    }

    this.x = Math.max(0, Math.min(WORLD.width - this.width, this.x));
    this.y = Math.max(0, Math.min(WORLD.height - this.height, this.y));

    if (this.attacking) {
      this.attackTime += dt;
      this.attackAnimation.update(dt, this.direction, true);
    } else {
      this.walk.update(dt, this.direction, true);
    }
  }

  takeDamage(amount) {
    if (this.dead) return;
    this.life -= amount;
    if (this.life <= 0) {
      this.life = 0;
      this.dead = true;
      score += 10 * wave;
      coins += 1;
      enemiesDefeated++;
      spawnQueue++;

      // A cada 4 inimigos derrotados começa uma nova onda.
      // A quantidade de inimigos vivos também aumenta gradualmente.
      if (enemiesDefeated % 4 === 0) {
        wave++;
      }
    }
  }

  draw() {
    if (this.dead) return;

    const sprite = this.attacking ? this.attackAnimation : this.walk;
    sprite.draw(this.x, this.y + HUD_HEIGHT, this.width, this.height);

    // Barra de vida do inimigo.
    const barWidth = 58;
    const barHeight = 6;
    const barX = this.x + (this.width - barWidth) / 2;
    const barY = this.y + HUD_HEIGHT - 9;

    context.fillStyle = '#1a1a1a';
    context.fillRect(barX, barY, barWidth, barHeight);
    context.fillStyle = '#e53935';
    context.fillRect(barX, barY, barWidth * (this.life / this.maxLife), barHeight);
  }
}

// ============================================================
// INSTÂNCIAS
// ============================================================
let player;
let zombies = [];

function createZombies() {
  zombies = [
    new Zombie(250, 260),
    new Zombie(690, 285),
    new Zombie(300, 555),
    new Zombie(820, 620)
  ];
}

function enemyTargetCount() {
  // Começa com 4 inimigos e chega no máximo a 10.
  return Math.min(10, 4 + Math.floor(enemiesDefeated / 4));
}

function randomSpawnPosition() {
  // Escolhe uma posição nas áreas abertas do mapa, longe do jogador.
  const positions = [
    [90, 180], [260, 260], [520, 180], [700, 280],
    [300, 520], [650, 520], [850, 610], [100, 700],
    [470, 760], [760, 760]
  ];

  const valid = positions.filter(([x, y]) => {
    const temp = { x, y, width: 78, height: 78 };
    return distanceBetween(temp, player) > 230;
  });

  const list = valid.length ? valid : positions;
  return list[Math.floor(Math.random() * list.length)];
}

function processEnemySpawning(dt) {
  if (spawnQueue <= 0) return;

  spawnTimer -= dt;
  if (spawnTimer > 0) return;

  const target = enemyTargetCount();
  if (zombies.length < target) {
    const [x, y] = randomSpawnPosition();
    zombies.push(new Zombie(x, y));
    spawnQueue--;
    spawnTimer = 900;
  } else {
    spawnQueue = 0;
  }
}

// ============================================================
// COLISÃO / ATAQUE
// ============================================================
function distanceBetween(a, b) {
  const ax = a.x + a.width / 2;
  const ay = a.y + a.height / 2;
  const bx = b.x + b.width / 2;
  const by = b.y + b.height / 2;
  return Math.hypot(ax - bx, ay - by);
}

function checkPlayerAttack() {
  const attackRange = 115;

  zombies.forEach(zombie => {
    if (!zombie.dead && distanceBetween(player, zombie) <= attackRange) {
      zombie.takeDamage(20);
    }
  });
}

// ============================================================
// FUNDO / HUD
// ============================================================
function drawMap() {
  context.drawImage(
    images.map,
    MAP_SOURCE.x,
    MAP_SOURCE.y,
    MAP_SOURCE.width,
    MAP_SOURCE.height,
    0,
    HUD_HEIGHT,
    WORLD.width,
    WORLD.height
  );
}

function drawHeart(x, y, size) {
  context.save();
  context.fillStyle = '#ef3030';
  context.strokeStyle = '#571010';
  context.lineWidth = 2;
  context.beginPath();
  const top = y + size * 0.25;
  context.moveTo(x + size / 2, y + size);
  context.bezierCurveTo(x, y + size * 0.62, x, top, x + size * 0.25, top);
  context.bezierCurveTo(x + size * 0.43, top, x + size / 2, top + size * 0.18, x + size / 2, top + size * 0.18);
  context.bezierCurveTo(x + size / 2, top + size * 0.18, x + size * 0.57, top, x + size * 0.75, top);
  context.bezierCurveTo(x + size, top, x + size, y + size * 0.62, x + size / 2, y + size);
  context.fill();
  context.stroke();
  context.restore();
}

function drawHUD() {
  context.fillStyle = '#08090d';
  context.fillRect(0, 0, canvas.width, HUD_HEIGHT);

  const fullHearts = 5;
  const hearts = Math.ceil(player.life / 20);
  for (let i = 0; i < fullHearts; i++) {
    if (i < hearts) drawHeart(25 + i * 40, 17, 30);
  }

  context.fillStyle = 'white';
  context.font = 'bold 28px Arial';
  context.fillText(`Vida: ${player.life}`, 235, 50);

  context.fillStyle = '#65d83b';
  context.font = 'bold 32px Arial';
  context.fillText('♦', 515, 50);
  context.fillStyle = 'white';
  context.font = 'bold 28px Arial';
  context.fillText(`x ${crystals}`, 550, 50);

  context.fillStyle = '#ffd32a';
  context.font = 'bold 32px Arial';
  context.fillText('●', 690, 50);
  context.fillStyle = 'white';
  context.font = 'bold 28px Arial';
  context.fillText(`x ${coins}`, 730, 50);

  context.fillStyle = '#ddd';
  context.font = 'bold 20px Arial';
  context.fillText(`Pontuação: ${score}`, 900, 50);
  context.fillText(`Onda: ${wave}`, 1130, 50);
}

function drawPause() {
  context.fillStyle = 'rgba(0,0,0,.55)';
  context.fillRect(0, HUD_HEIGHT, canvas.width, WORLD.height);
  context.fillStyle = 'white';
  context.strokeStyle = 'black';
  context.lineWidth = 5;
  context.font = 'bold 64px Arial';
  context.textAlign = 'center';
  context.strokeText('PAUSADO', canvas.width / 2, 330);
  context.fillText('PAUSADO', canvas.width / 2, 330);
  context.font = '22px Arial';
  context.fillText('Pressione ENTER para continuar', canvas.width / 2, 375);
  context.textAlign = 'left';
}

function drawGameOver() {
  context.fillStyle = 'rgba(0,0,0,.65)';
  context.fillRect(0, HUD_HEIGHT, canvas.width, WORLD.height);
  context.fillStyle = 'white';
  context.strokeStyle = 'black';
  context.lineWidth = 6;
  context.textAlign = 'center';
  context.font = 'bold 72px Arial';
  context.strokeText('GAME OVER', canvas.width / 2, 330);
  context.fillText('GAME OVER', canvas.width / 2, 330);
  context.font = '24px Arial';
  context.fillText(`Pontuação: ${score}`, canvas.width / 2, 380);
  context.fillText('Pressione R para reiniciar', canvas.width / 2, 425);
  context.textAlign = 'left';
}

// ============================================================
// JOGO
// ============================================================
function update(dt) {
  if (paused || gameOver) return;
  player.update(dt);
  zombies.forEach(zombie => zombie.update(dt));
  zombies = zombies.filter(zombie => !zombie.dead);
  processEnemySpawning(dt);
}

function draw() {
  context.clearRect(0, 0, canvas.width, canvas.height);
  drawMap();
  zombies.forEach(zombie => zombie.draw());
  player.draw();
  drawHUD();

  if (paused) drawPause();
  if (gameOver) drawGameOver();
}

function gameLoop(timestamp) {
  if (!lastTime) lastTime = timestamp;
  const dt = Math.min(timestamp - lastTime, 50);
  lastTime = timestamp;
  update(dt);
  draw();
  requestAnimationFrame(gameLoop);
}

function endGame() {
  gameOver = true;
  paused = false;
}

function restartGame() {
  score = 0;
  crystals = 0;
  coins = 0;
  enemiesDefeated = 0;
  wave = 1;
  spawnQueue = 0;
  spawnTimer = 0;
  gameOver = false;
  paused = false;
  player = new Player();
  createZombies();
}

loadImages(() => {
  restartGame();
  requestAnimationFrame(gameLoop);
});
