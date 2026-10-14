(() => {
  "use strict";

  const { Body, Bodies, Composite, Engine, Events } = Matter;
  const canvas = document.getElementById("gameCanvas");
  const ctx = canvas.getContext("2d");
  const engine = Engine.create();
  engine.gravity.y = 0;
  const world = engine.world;

  const CELL_WIDTH = 8.4;
  const CELL_HEIGHT = 14;
  const CORE_WIDTH = 80;
  const CORE_HEIGHT = 20;
  const BLAST_RADIUS = 200;
  const BLAST_MAGNITUDE = 0.05;
  const BLAST_COOLDOWN = 1500;
  const ENEMY_FORCE = 0.0005;
  const BOUNDARY_THICKNESS = 100;
  const STEP_MS = 1000 / 60;
  const glyphs = "#@T%+*:=?";
  const enemyGlyphs = "XVW*";

  let viewportWidth = 0;
  let viewportHeight = 0;
  let boundaries = [];
  let core = null;
  let coreHealth = 100;
  let gameOver = false;
  let gameStartTime = 0;
  let survivedMs = 0;
  let lastBlastTime = 0;
  let spawnTimer = null;
  let previousFrame = 0;

  function resizeCanvas() {
    const centerShiftX = (window.innerWidth - viewportWidth) / 2;
    const centerShiftY = (window.innerHeight - viewportHeight) / 2;
    viewportWidth = window.innerWidth;
    viewportHeight = window.innerHeight;
    const pixelRatio = window.devicePixelRatio || 1;

    canvas.style.width = `${viewportWidth}px`;
    canvas.style.height = `${viewportHeight}px`;
    canvas.width = Math.round(viewportWidth * pixelRatio);
    canvas.height = Math.round(viewportHeight * pixelRatio);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(pixelRatio, pixelRatio);
    ctx.font = "14px 'Courier New', monospace";
    ctx.fillStyle = "#00FF41";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    if (core) {
      Body.setPosition(core, { x: viewportWidth / 2, y: viewportHeight / 2 });
      for (const body of Composite.allBodies(world)) {
        if (!body.char) continue;
        let x = body.position.x + centerShiftX;
        let y = body.position.y + centerShiftY;
        if (body.isEnemy) {
          x = Math.max(-20, Math.min(viewportWidth + 20, x));
          y = Math.max(-20, Math.min(viewportHeight - 20, y));
        }
        Body.setPosition(body, {
          x,
          y,
        });
      }
    }

    // Side walls sit beyond the spawn points so enemies can enter the screen.
    for (const boundary of boundaries) Composite.remove(world, boundary);
    const boundaryOptions = {
      isStatic: true,
      restitution: 0.2,
      friction: 0.8,
    };
    const halfThickness = BOUNDARY_THICKNESS / 2;
    const sideOffset = 25 + halfThickness;
    boundaries = [
      Bodies.rectangle(
        viewportWidth / 2,
        viewportHeight + halfThickness,
        viewportWidth + BOUNDARY_THICKNESS * 3,
        BOUNDARY_THICKNESS,
        boundaryOptions
      ),
      Bodies.rectangle(
        -sideOffset,
        viewportHeight / 2,
        BOUNDARY_THICKNESS,
        viewportHeight + BOUNDARY_THICKNESS * 2,
        boundaryOptions
      ),
      Bodies.rectangle(
        viewportWidth + sideOffset,
        viewportHeight / 2,
        BOUNDARY_THICKNESS,
        viewportHeight + BOUNDARY_THICKNESS * 2,
        boundaryOptions
      ),
    ];
    Composite.add(world, boundaries);
  }

  function spawnBarricade() {
    const centerX = viewportWidth / 2;
    const centerY = viewportHeight / 2;
    const letters = [];
    let glyphIndex = 0;

    function addGlyph(x, y) {
      const body = Bodies.rectangle(x, y, CELL_WIDTH, CELL_HEIGHT, {
        density: 0.004,
        restitution: 0.1,
        friction: 0.8,
        frictionAir: 0.03,
      });
      body.char = glyphs[(glyphIndex * 7) % glyphs.length];
      glyphIndex += 1;
      letters.push(body);
    }

    for (let column = 0; column < 16; column += 1) {
      const x = centerX + (column - 7.5) * CELL_WIDTH;
      addGlyph(x, centerY - 70);
      addGlyph(x, centerY + 70);
    }
    for (let row = 0; row < 6; row += 1) {
      const y = centerY + (row - 2.5) * CELL_HEIGHT;
      addGlyph(centerX - 96, y);
      addGlyph(centerX + 96, y);
    }
    Composite.add(world, letters);
  }

  function spawnEnemy() {
    const edge = Math.floor(Math.random() * 3);
    let x;
    let y;
    if (edge === 0) {
      x = Math.random() * viewportWidth;
      y = -20;
    } else {
      x = edge === 1 ? -20 : viewportWidth + 20;
      y = Math.random() * viewportHeight;
    }

    const body = Bodies.rectangle(x, y, CELL_WIDTH, CELL_HEIGHT, {
      density: 0.004,
      frictionAir: 0.02,
      friction: 0.5,
      restitution: 0.2,
    });
    body.char = enemyGlyphs[Math.floor(Math.random() * enemyGlyphs.length)];
    body.isEnemy = true;
    Composite.add(world, body);
  }

  function spawnWave() {
    if (gameOver) return;
    const count = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < count; i += 1) spawnEnemy();

    const survivedSeconds = (performance.now() - gameStartTime) / 1000;
    const nextDelay = Math.max(550, 1500 - survivedSeconds * 12);
    spawnTimer = setTimeout(spawnWave, nextDelay);
  }

  function steerEnemies() {
    for (const body of Composite.allBodies(world)) {
      if (!body.isEnemy) continue;
      const dx = core.position.x - body.position.x;
      const dy = core.position.y - body.position.y;
      const distance = Math.hypot(dx, dy);
      if (distance < 0.001) continue;
      Body.applyForce(body, body.position, {
        x: (dx / distance) * ENEMY_FORCE,
        y: (dy / distance) * ENEMY_FORCE,
      });
    }
  }

  function explodeAt(x, y) {
    for (const body of Composite.allBodies(world)) {
      if (!body.char) continue;

      const dx = body.position.x - x;
      const dy = body.position.y - y;
      const distance = Math.hypot(dx, dy);
      if (distance >= BLAST_RADIUS) continue;

      // A click exactly on a body's center still needs a valid direction.
      const directionX = distance > 0 ? dx / distance : 0;
      const directionY = distance > 0 ? dy / distance : -1;
      const force = BLAST_MAGNITUDE * (1 - distance / BLAST_RADIUS);
      if (body.isStatic) Body.setStatic(body, false);
      Body.applyForce(
        body,
        { x: body.position.x, y: body.position.y },
        { x: directionX * force, y: directionY * force }
      );
    }
  }

  function endGame() {
    if (gameOver) return;
    gameOver = true;
    survivedMs = performance.now() - gameStartTime;
    clearTimeout(spawnTimer);
  }

  Events.on(engine, "collisionStart", (event) => {
    for (const pair of event.pairs) {
      const enemy = pair.bodyA === core ? pair.bodyB : pair.bodyB === core ? pair.bodyA : null;
      if (!enemy?.isEnemy || enemy.consumed) continue;

      enemy.consumed = true;
      coreHealth = Math.max(0, coreHealth - 10);
      Composite.remove(world, enemy);
      if (coreHealth === 0) {
        endGame();
        break;
      }
    }
  });

  function drawHud(now) {
    const elapsed = gameOver ? survivedMs : now - gameStartTime;
    const cooldownProgress = Math.min(1, (now - lastBlastTime) / BLAST_COOLDOWN);
    const filled = Math.floor(cooldownProgress * 10);

    ctx.save();
    ctx.font = "14px 'Courier New', monospace";
    ctx.textBaseline = "middle";
    ctx.textAlign = "right";
    ctx.fillStyle = "#FFFFFF";
    ctx.fillText(`SURVIVED: ${(elapsed / 1000).toFixed(1)}s`, viewportWidth - 16, 24);

    ctx.textAlign = "center";
    ctx.fillStyle = coreHealth <= 30 ? "#FF0033" : "#00FFFF";
    ctx.fillText(`INTEGRITY: ${coreHealth}%`, core.position.x, core.position.y - 36);

    ctx.fillStyle = cooldownProgress >= 1 ? "#00FF41" : "#FFFFFF";
    ctx.fillText(
      `BLAST: [${"|".repeat(filled)}${" ".repeat(10 - filled)}]`,
      viewportWidth / 2,
      viewportHeight - 28
    );
    ctx.restore();

    if (gameOver) {
      ctx.save();
      ctx.fillStyle = "rgba(0, 0, 0, 0.85)";
      ctx.fillRect(0, 0, viewportWidth, viewportHeight);
      ctx.fillStyle = "#FF0033";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `bold ${Math.min(48, Math.max(22, viewportWidth / 15))}px monospace`;
      ctx.fillText("SYSTEM FAILURE", viewportWidth / 2, viewportHeight / 2);
      ctx.font = "14px 'Courier New', monospace";
      ctx.fillText(`SURVIVED: ${(survivedMs / 1000).toFixed(1)}s`, viewportWidth / 2, viewportHeight / 2 + 44);
      ctx.restore();
    }
  }

  function render(now) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (const body of Composite.allBodies(world)) {
      if (body.position.y > viewportHeight + 1000) {
        Composite.remove(world, body);
        continue;
      }
      if (body !== core && !body.char) continue;

      ctx.save();
      ctx.translate(body.position.x, body.position.y);
      ctx.rotate(body.angle);
      ctx.fillStyle = body === core ? "#00FFFF" : body.isEnemy ? "#FF0033" : "#00FF41";
      ctx.fillText(body === core ? "[ CORE ]" : body.char, 0, 0);
      ctx.restore();
    }

    drawHud(now);
  }

  function frame(timestamp) {
    const elapsed = previousFrame === 0 ? STEP_MS : timestamp - previousFrame;
    previousFrame = timestamp;
    steerEnemies();
    Engine.update(engine, Math.min(Math.max(elapsed, 1), 50));
    render(timestamp);
    if (!gameOver) requestAnimationFrame(frame);
  }

  canvas.addEventListener("mousedown", (event) => {
    if (gameOver) return;
    const now = performance.now();
    if (now - lastBlastTime < BLAST_COOLDOWN) return;
    lastBlastTime = now;
    const bounds = canvas.getBoundingClientRect();
    explodeAt(event.clientX - bounds.left, event.clientY - bounds.top);
  });
  window.addEventListener("resize", () => {
    resizeCanvas();
    if (gameOver) render(performance.now());
  });

  resizeCanvas();
  core = Bodies.rectangle(viewportWidth / 2, viewportHeight / 2, CORE_WIDTH, CORE_HEIGHT, {
    isStatic: true,
  });
  Composite.add(world, core);
  spawnBarricade();
  gameStartTime = performance.now();
  lastBlastTime = gameStartTime - BLAST_COOLDOWN;
  spawnTimer = setTimeout(spawnWave, 1500);
  requestAnimationFrame(frame);
})();
