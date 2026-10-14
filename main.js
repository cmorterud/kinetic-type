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
  const BLAST_RADIUS = 240;
  const BLAST_MAGNITUDE = 0.05;
  const SHIELD_BLAST_MAGNITUDE = 0.015;
  const BLAST_COOLDOWN = 1500;
  const ENEMY_FORCE = 0.00008;
  const SHIELD_RECALL_DELAY = 1200;
  const BOUNDARY_THICKNESS = 100;
  const STEP_MS = 1000 / 60;
  const glyphs = "#@T%+*:=?";
  const enemyGlyphs = "XVW*";

  let viewportWidth = 0;
  let viewportHeight = 0;
  let boundaries = [];
  let core = null;
  let coreHealth = 100;
  let phase = "ready";
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
      body.home = { x: x - centerX, y: y - centerY };
      body.recallAt = 0;
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
    if (phase !== "playing") return;
    const survivedSeconds = (performance.now() - gameStartTime) / 1000;
    const maxEnemies = survivedSeconds < 15 ? 1 : survivedSeconds < 40 ? 2 : 3;
    const count = 1 + Math.floor(Math.random() * maxEnemies);
    for (let i = 0; i < count; i += 1) spawnEnemy();

    const nextDelay = Math.max(800, 1500 - survivedSeconds * 10);
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

  function recallShield(now) {
    for (const body of Composite.allBodies(world)) {
      if (!body.home) continue;

      const targetX = core.position.x + body.home.x;
      const targetY = core.position.y + body.home.y;
      const dx = targetX - body.position.x;
      const dy = targetY - body.position.y;
      const distance = Math.hypot(dx, dy);

      if (distance > 18 && body.recallAt === 0) {
        body.recallAt = now + SHIELD_RECALL_DELAY;
      }
      if (body.recallAt === 0 || now < body.recallAt) continue;

      if (distance < 4) {
        Body.setPosition(body, { x: targetX, y: targetY });
        Body.setVelocity(body, { x: 0, y: 0 });
        Body.setAngle(body, 0);
        Body.setAngularVelocity(body, 0);
        body.recallAt = 0;
        continue;
      }

      const speed = Math.min(2.5, distance * 0.035);
      Body.setVelocity(body, {
        x: body.velocity.x * 0.85 + (dx / distance) * speed * 0.15,
        y: body.velocity.y * 0.85 + (dy / distance) * speed * 0.15,
      });
      Body.setAngularVelocity(body, body.angularVelocity * 0.85);
      Body.setAngle(body, body.angle * 0.9);
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
      const magnitude = body.isEnemy ? BLAST_MAGNITUDE : SHIELD_BLAST_MAGNITUDE;
      const force = magnitude * (1 - distance / BLAST_RADIUS);
      if (body.home) body.recallAt = performance.now() + SHIELD_RECALL_DELAY;
      if (body.isStatic) Body.setStatic(body, false);
      Body.applyForce(
        body,
        { x: body.position.x, y: body.position.y },
        { x: directionX * force, y: directionY * force }
      );
    }
  }

  function endGame() {
    if (phase !== "playing") return;
    phase = "gameOver";
    survivedMs = performance.now() - gameStartTime;
    clearTimeout(spawnTimer);
  }

  function startGame() {
    clearTimeout(spawnTimer);
    for (const body of Composite.allBodies(world)) {
      if (body.char) Composite.remove(world, body);
    }
    spawnBarricade();
    coreHealth = 100;
    survivedMs = 0;
    gameStartTime = performance.now();
    lastBlastTime = gameStartTime - BLAST_COOLDOWN;
    previousFrame = 0;
    phase = "playing";
    spawnTimer = setTimeout(spawnWave, 3000);
    requestAnimationFrame(frame);
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
    const elapsed = phase === "gameOver" ? survivedMs : now - gameStartTime;
    const cooldownProgress = Math.min(1, (now - lastBlastTime) / BLAST_COOLDOWN);
    const filled = Math.floor(cooldownProgress * 10);

    ctx.save();
    ctx.font = "14px 'Courier New', monospace";
    ctx.textBaseline = "middle";
    ctx.textAlign = "right";
    ctx.fillStyle = "#FFFFFF";
    ctx.fillText(`SURVIVED: ${phase === "ready" ? "0.0" : (elapsed / 1000).toFixed(1)}s`, viewportWidth - 16, 24);

    ctx.textAlign = "center";
    ctx.fillStyle = coreHealth <= 30 ? "#FF0033" : "#00FFFF";
    ctx.fillText(`INTEGRITY: ${coreHealth}%`, core.position.x, core.position.y - 36);

    const blastReady = phase === "ready" || cooldownProgress >= 1;
    ctx.fillStyle = blastReady ? "#00FF41" : "#FFFFFF";
    ctx.fillText(
      blastReady ? "BLAST READY — CLICK NEAR RED ENEMIES" : `RECHARGING: ${((1 - cooldownProgress) * BLAST_COOLDOWN / 1000).toFixed(1)}s`,
      viewportWidth / 2,
      viewportHeight - 50,
      viewportWidth - 24
    );
    ctx.fillText(
      `BLAST: [${"|".repeat(filled)}${" ".repeat(10 - filled)}]`,
      viewportWidth / 2,
      viewportHeight - 28
    );
    ctx.restore();

    if (phase === "ready" || phase === "gameOver") {
      ctx.save();
      ctx.fillStyle = "rgba(0, 0, 0, 0.82)";
      ctx.fillRect(0, 0, viewportWidth, viewportHeight);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `bold ${Math.min(48, Math.max(22, viewportWidth / 15))}px monospace`;
      ctx.fillStyle = phase === "ready" ? "#00FFFF" : "#FF0033";
      ctx.fillText(phase === "ready" ? "DEFEND THE CORE" : "SYSTEM FAILURE", viewportWidth / 2, viewportHeight / 2 - 72, viewportWidth - 24);
      ctx.font = "14px 'Courier New', monospace";
      ctx.fillStyle = "#FFFFFF";
      ctx.fillText(
        phase === "ready" ? "RED LETTERS DAMAGE THE CYAN CORE" : `SURVIVED: ${(survivedMs / 1000).toFixed(1)}s`,
        viewportWidth / 2,
        viewportHeight / 2 - 18,
        viewportWidth - 24
      );
      if (phase === "ready") {
        ctx.fillText("CLICK NEAR RED LETTERS TO BLAST THEM AWAY", viewportWidth / 2, viewportHeight / 2 + 10, viewportWidth - 24);
        ctx.fillText("BLAST RECHARGES EVERY 1.5 SECONDS", viewportWidth / 2, viewportHeight / 2 + 38, viewportWidth - 24);
        ctx.fillText("GREEN LETTERS RETURN TO THE CORE", viewportWidth / 2, viewportHeight / 2 + 66, viewportWidth - 24);
      }
      ctx.fillStyle = "#00FF41";
      ctx.fillText(
        phase === "ready" ? "CLICK OR PRESS SPACE TO START" : "CLICK OR PRESS SPACE TO RETRY",
        viewportWidth / 2,
        viewportHeight / 2 + (phase === "ready" ? 108 : 80),
        viewportWidth - 24
      );
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
    if (phase !== "playing") return;
    const elapsed = previousFrame === 0 ? STEP_MS : timestamp - previousFrame;
    previousFrame = timestamp;
    steerEnemies();
    recallShield(timestamp);
    Engine.update(engine, Math.min(Math.max(elapsed, 1), 50));
    render(timestamp);
    if (phase === "playing") requestAnimationFrame(frame);
  }

  canvas.addEventListener("pointerdown", (event) => {
    if (phase !== "playing") {
      startGame();
      return;
    }
    const now = performance.now();
    if (now - lastBlastTime < BLAST_COOLDOWN) return;
    lastBlastTime = now;
    const bounds = canvas.getBoundingClientRect();
    explodeAt(event.clientX - bounds.left, event.clientY - bounds.top);
  });
  window.addEventListener("keydown", (event) => {
    if (event.code !== "Space" || event.repeat) return;
    event.preventDefault();
    if (phase !== "playing") startGame();
  });
  window.addEventListener("resize", () => {
    resizeCanvas();
    if (phase !== "playing") render(performance.now());
  });

  resizeCanvas();
  core = Bodies.rectangle(viewportWidth / 2, viewportHeight / 2, CORE_WIDTH, CORE_HEIGHT, {
    isStatic: true,
  });
  Composite.add(world, core);
  spawnBarricade();
  render(performance.now());
})();
