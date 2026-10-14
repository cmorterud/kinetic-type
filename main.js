(() => {
  "use strict";

  const { Body, Bodies, Composite, Engine } = Matter;
  const canvas = document.getElementById("gameCanvas");
  const ctx = canvas.getContext("2d");
  const engine = Engine.create({ enableSleeping: true });
  const world = engine.world;

  const CELL_WIDTH = 8.4;
  const CELL_HEIGHT = 14;
  const COLUMNS = 30;
  const ROWS = 20;
  const BLAST_RADIUS = 200;
  const BLAST_MAGNITUDE = 0.05;
  const BOUNDARY_THICKNESS = 100;
  const STEP_MS = 1000 / 60;
  const glyphs = "#@T%+*:=?";

  let viewportWidth = 0;
  let viewportHeight = 0;
  let boundaries = [];
  let previousFrame = 0;

  function resizeCanvas() {
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

    // Rebuild the invisible boundaries to match both the new position and size.
    for (const boundary of boundaries) Composite.remove(world, boundary);
    const boundaryOptions = {
      isStatic: true,
      restitution: 0.2,
      friction: 0.8,
    };
    const halfThickness = BOUNDARY_THICKNESS / 2;
    boundaries = [
      Bodies.rectangle(
        viewportWidth / 2,
        viewportHeight + halfThickness,
        viewportWidth + BOUNDARY_THICKNESS * 2,
        BOUNDARY_THICKNESS,
        boundaryOptions
      ),
      Bodies.rectangle(
        -halfThickness,
        viewportHeight / 2,
        BOUNDARY_THICKNESS,
        viewportHeight + BOUNDARY_THICKNESS * 2,
        boundaryOptions
      ),
      Bodies.rectangle(
        viewportWidth + halfThickness,
        viewportHeight / 2,
        BOUNDARY_THICKNESS,
        viewportHeight + BOUNDARY_THICKNESS * 2,
        boundaryOptions
      ),
    ];
    Composite.add(world, boundaries);
  }

  function spawnTextWall() {
    const startX = (viewportWidth - COLUMNS * CELL_WIDTH) / 2 + CELL_WIDTH / 2;
    const startY = (viewportHeight - ROWS * CELL_HEIGHT) / 2 + CELL_HEIGHT / 2;
    const letters = [];

    for (let row = 0; row < ROWS; row += 1) {
      for (let column = 0; column < COLUMNS; column += 1) {
        const body = Bodies.rectangle(
          startX + column * CELL_WIDTH,
          startY + row * CELL_HEIGHT,
          CELL_WIDTH,
          CELL_HEIGHT,
          {
            density: 0.004,
            restitution: 0.1,
            friction: 0.8,
            frictionStatic: 1,
            sleepThreshold: 30,
          }
        );
        body.char = glyphs[(row * 7 + column * 11) % glyphs.length];
        // The centered wall has no support beneath it; release glyphs only when hit.
        Body.setStatic(body, true);
        letters.push(body);
      }
    }

    Composite.add(world, letters);
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

  function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (const body of Composite.allBodies(world)) {
      if (body.position.y > viewportHeight + 1000) {
        Composite.remove(world, body);
        continue;
      }
      if (!body.char) continue;

      ctx.save();
      ctx.translate(body.position.x, body.position.y);
      ctx.rotate(body.angle);
      ctx.fillText(body.char, 0, 0);
      ctx.restore();
    }
  }

  function frame(timestamp) {
    const elapsed = previousFrame === 0 ? STEP_MS : timestamp - previousFrame;
    previousFrame = timestamp;
    Engine.update(engine, Math.min(Math.max(elapsed, 1), 50));
    render();
    requestAnimationFrame(frame);
  }

  canvas.addEventListener("mousedown", (event) => {
    const bounds = canvas.getBoundingClientRect();
    explodeAt(event.clientX - bounds.left, event.clientY - bounds.top);
  });
  window.addEventListener("resize", resizeCanvas);

  resizeCanvas();
  spawnTextWall();
  requestAnimationFrame(frame);
})();
