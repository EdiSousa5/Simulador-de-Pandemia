/**
 * Simulador de Propagacao de uma Pandemia
 * Projeto de Computacao Grafica - Canvas 2D
 *
 * O mundo e desenhado num espaco logico fixo de 1024x580; o canvas e redimensionado
 * para o ecra e a transformacao do contexto trata da escala (inclui devicePixelRatio).
 */
(function () {
  "use strict";

  // ---------------------------------------------------------------------------
  // Constantes
  // ---------------------------------------------------------------------------

  const WORLD_WIDTH = 1024;
  const WORLD_HEIGHT = 580;

  /** Milissegundos de tempo simulado por tick. O passo e fixo para a simulacao
   *  ser independente da taxa de fotogramas. */
  const TICK_MS = 50;
  /** Limite de ticks por fotograma, evita a "espiral da morte" apos o separador
   *  estar em segundo plano. */
  const MAX_TICKS_PER_FRAME = 20;

  const PERSON_RADIUS = 2.5;
  const INFECTION_RADIUS = 9;
  const INFECTION_JITTER = 2.5;
  const AIRPORT_RADIUS = 7;
  /** Raio, a volta de um aeroporto, usado para contagio de/para avioes. */
  const AIRPORT_CONTACT_RADIUS = 22;
  const PLANE_SPRITE_WIDTH = 26;
  const PLANE_SPEED = 70; // unidades do mundo por segundo simulado
  /** Intervalo entre tentativas de cura/morte de um infetado. */
  const RESOLVE_INTERVAL_MS = 1000;
  /** Tolerancia de clique minima, em unidades do mundo. */
  const CLICK_TOLERANCE = 7;
  /** Alvo de toque confortavel, em pixeis CSS; convertido para unidades do mundo. */
  const TOUCH_TARGET_PX = 16;

  const STATE = { HEALTHY: 0, INFECTED: 1, DEAD: 2, CURED: 3 };

  const STATE_COLORS = {
    [STATE.HEALTHY]: "#ffffff",
    [STATE.INFECTED]: "#ef4444",
    [STATE.DEAD]: "#16202e",
    [STATE.CURED]: "#f59e0b",
  };

  const AIRPORT_COLOR = "#60a5fa";
  const AIRPORT_INFECTED_COLOR = "#971c0e";

  const DEFAULTS = {
    infectionChance: 0.4,
    deathChance: 0.08,
    cureChance: 0.2,
    infectionDelayMs: 4000,
    resolveDelayMs: 40000,
    planeCount: 3,
  };

  const INITIAL_AIRPORTS = [
    { x: 390, y: 350 },
    { x: 480, y: 200 },
    { x: 520, y: 380 },
    { x: 770, y: 450 },
    { x: 770, y: 150 },
  ];

  const MODE = { INFECT: "infect", ADD_AIRPORT: "add-airport", REMOVE_AIRPORT: "remove-airport" };

  // ---------------------------------------------------------------------------
  // Estado
  // ---------------------------------------------------------------------------

  const canvas = document.getElementById("worldCanvas");
  const ctx = canvas.getContext("2d", { alpha: true });

  /** @type {{x:number,y:number,state:number,infectedFor:number,nextSpreadAt:number,nextResolveAt:number}[]} */
  let people = [];
  /** Lista de adjacencia pre-calculada: neighbours[i] = indices vizinhos de i. */
  /** @type {Int32Array[]} */
  let neighbours = [];
  /** @type {{x:number,y:number,infected:boolean,nearby:Int32Array}[]} */
  let airports = [];
  /** @type {{x:number,y:number,from:number,to:number,infected:boolean,angle:number}[]} */
  let planes = [];

  const counts = { healthy: 0, infected: 0, dead: 0, cured: 0 };

  const settings = { ...DEFAULTS };

  let speed = 0; // 0 = pausado, 1 = normal, 4 = avanco rapido
  let mode = MODE.INFECT;
  let simElapsedMs = 0;
  let outbreakStarted = false;
  let accumulator = 0;
  let lastFrameTime = 0;
  let lastRenderedDay = -1;
  let statsDirty = true;

  const startDate = new Date();

  const planeSprite = new Image();
  const planeInfectedSprite = new Image();
  let spritesReady = 0;

  // ---------------------------------------------------------------------------
  // Utilitarios
  // ---------------------------------------------------------------------------

  const $ = (id) => document.getElementById(id);
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  function distance(ax, ay, bx, by) {
    const dx = ax - bx;
    const dy = ay - by;
    return Math.sqrt(dx * dx + dy * dy);
  }

  let toastTimer = 0;
  function toast(message, type) {
    const el = $("toast");
    el.textContent = message;
    el.dataset.type = type || "info";
    el.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("is-visible"), 2600);
  }

  // ---------------------------------------------------------------------------
  // Construcao do mundo
  // ---------------------------------------------------------------------------

  function buildPeople() {
    people = WORLD_POINTS.map((point) => ({
      x: point.x,
      y: point.y,
      state: STATE.HEALTHY,
      infectedFor: 0,
      nextSpreadAt: 0,
      nextResolveAt: 0,
    }));
  }

  /**
   * Indexacao espacial (hash grid) para calcular vizinhos em O(n) em vez de O(n^2).
   * Como as pessoas nunca se movem, a lista de adjacencia e calculada uma unica vez.
   */
  function buildNeighbourIndex() {
    const reach = INFECTION_RADIUS + INFECTION_JITTER;
    const cellSize = reach;
    const buckets = new Map();
    const cellKey = (cx, cy) => cx * 100003 + cy;

    for (let i = 0; i < people.length; i++) {
      const key = cellKey(Math.floor(people[i].x / cellSize), Math.floor(people[i].y / cellSize));
      const bucket = buckets.get(key);
      if (bucket) bucket.push(i);
      else buckets.set(key, [i]);
    }

    neighbours = new Array(people.length);
    const found = [];

    for (let i = 0; i < people.length; i++) {
      const person = people[i];
      const cx = Math.floor(person.x / cellSize);
      const cy = Math.floor(person.y / cellSize);
      found.length = 0;

      for (let ox = -1; ox <= 1; ox++) {
        for (let oy = -1; oy <= 1; oy++) {
          const bucket = buckets.get(cellKey(cx + ox, cy + oy));
          if (!bucket) continue;
          for (let b = 0; b < bucket.length; b++) {
            const j = bucket[b];
            if (j === i) continue;
            if (distance(person.x, person.y, people[j].x, people[j].y) <= reach) found.push(j);
          }
        }
      }
      neighbours[i] = Int32Array.from(found);
    }
  }

  function resetWorld() {
    for (const person of people) {
      person.state = STATE.HEALTHY;
      person.infectedFor = 0;
      person.nextSpreadAt = 0;
      person.nextResolveAt = 0;
    }
    airports = INITIAL_AIRPORTS.map((airport) => createAirport(airport.x, airport.y));
    planes = [];
    setPlaneCount(DEFAULTS.planeCount);
    simElapsedMs = 0;
    outbreakStarted = false;
    accumulator = 0;
    lastRenderedDay = -1;
    statsDirty = true;
  }

  // ---------------------------------------------------------------------------
  // Avioes e aeroportos
  // ---------------------------------------------------------------------------

  /** A lista de pessoas em redor e fixa, logo e calculada uma vez por aeroporto. */
  function createAirport(x, y) {
    const nearby = [];
    for (let i = 0; i < people.length; i++) {
      if (distance(people[i].x, people[i].y, x, y) <= AIRPORT_CONTACT_RADIUS) nearby.push(i);
    }
    return { x, y, infected: false, nearby: Int32Array.from(nearby) };
  }

  function pickDifferentAirport(exclude) {
    if (airports.length < 2) return exclude;
    let index;
    do {
      index = Math.floor(Math.random() * airports.length);
    } while (index === exclude);
    return index;
  }

  function setPlaneCount(count) {
    const target = clamp(Math.round(count), 0, 20);
    while (planes.length > target) planes.pop();
    while (planes.length < target) {
      const from = Math.floor(Math.random() * Math.max(airports.length, 1));
      const origin = airports[from] || { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 };
      planes.push({
        x: origin.x,
        y: origin.y,
        from,
        to: pickDifferentAirport(from),
        infected: false,
        angle: 0,
      });
    }
  }

  function infectPerson(person) {
    if (person.state !== STATE.HEALTHY) return false;
    person.state = STATE.INFECTED;
    person.infectedFor = 0;
    person.nextSpreadAt = settings.infectionDelayMs;
    person.nextResolveAt = settings.resolveDelayMs;
    statsDirty = true;
    outbreakStarted = true;
    return true;
  }

  /** Semeia infecoes em torno de um aeroporto contaminado. */
  function seedOutbreakAt(airport) {
    let seeded = 0;
    for (let n = 0; n < airport.nearby.length && seeded < 3; n++) {
      const person = people[airport.nearby[n]];
      if (person.state !== STATE.HEALTHY) continue;
      if (Math.random() < settings.infectionChance) {
        infectPerson(person);
        seeded++;
      }
    }
  }

  function updateAirportContamination() {
    for (const airport of airports) {
      if (airport.infected) continue;
      for (let n = 0; n < airport.nearby.length; n++) {
        if (people[airport.nearby[n]].state === STATE.INFECTED) {
          airport.infected = true;
          break;
        }
      }
    }
  }

  function updatePlanes(deltaMs) {
    if (airports.length < 2) return;
    const step = (PLANE_SPEED * deltaMs) / 1000;

    for (const plane of planes) {
      const destination = airports[plane.to] || airports[0];
      const dx = destination.x - plane.x;
      const dy = destination.y - plane.y;
      const remaining = Math.sqrt(dx * dx + dy * dy);
      plane.angle = Math.atan2(dy, dx);

      if (remaining <= step || remaining === 0) {
        plane.x = destination.x;
        plane.y = destination.y;

        // Chegada: o aviao contamina o aeroporto, ou e contaminado por ele.
        if (plane.infected && !destination.infected) {
          destination.infected = true;
          seedOutbreakAt(destination);
        } else if (destination.infected) {
          plane.infected = true;
        }

        plane.from = plane.to;
        plane.to = pickDifferentAirport(plane.from);
        continue;
      }

      plane.x += (dx / remaining) * step;
      plane.y += (dy / remaining) * step;
    }
  }

  // ---------------------------------------------------------------------------
  // Simulacao
  // ---------------------------------------------------------------------------

  function tick(deltaMs) {
    simElapsedMs += deltaMs;

    for (let i = 0; i < people.length; i++) {
      const person = people[i];
      if (person.state !== STATE.INFECTED) continue;

      person.infectedFor += deltaMs;

      // Contagio dos vizinhos
      while (person.infectedFor >= person.nextSpreadAt) {
        person.nextSpreadAt += settings.infectionDelayMs;
        const adjacency = neighbours[i];
        for (let n = 0; n < adjacency.length; n++) {
          const other = people[adjacency[n]];
          if (other.state !== STATE.HEALTHY) continue;
          // Distancia efetiva com ruido, para a mancha nao crescer como um circulo perfeito.
          const reach = INFECTION_RADIUS + (Math.random() * 2 - 1) * INFECTION_JITTER;
          if (distance(person.x, person.y, other.x, other.y) > reach) continue;
          if (Math.random() < settings.infectionChance) infectPerson(other);
        }
      }

      // Desfecho: morte ou cura
      if (person.infectedFor >= person.nextResolveAt) {
        person.nextResolveAt += RESOLVE_INTERVAL_MS;
        const roll = Math.random();
        if (roll < settings.deathChance) {
          person.state = STATE.DEAD;
          statsDirty = true;
        } else if (roll < settings.deathChance + settings.cureChance) {
          person.state = STATE.CURED;
          statsDirty = true;
        }
      }
    }

    updatePlanes(deltaMs);
    updateAirportContamination();
  }

  // ---------------------------------------------------------------------------
  // Desenho
  // ---------------------------------------------------------------------------

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    const scale = (rect.width / WORLD_WIDTH) * dpr;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
  }

  /** Desenha todas as pessoas de um estado num unico path, para reduzir drawcalls. */
  function drawPeopleOfState(state) {
    ctx.fillStyle = STATE_COLORS[state];
    ctx.beginPath();
    for (const person of people) {
      if (person.state !== state) continue;
      ctx.moveTo(person.x + PERSON_RADIUS, person.y);
      ctx.arc(person.x, person.y, PERSON_RADIUS, 0, Math.PI * 2);
    }
    ctx.fill();
  }

  function drawRoutes() {
    if (airports.length < 2) return;
    ctx.save();
    ctx.setLineDash([4, 6]);
    ctx.lineWidth = 0.6;
    for (const plane of planes) {
      const destination = airports[plane.to];
      if (!destination) continue;
      ctx.strokeStyle = plane.infected ? "rgba(239, 68, 68, 0.5)" : "rgba(226, 242, 255, 0.4)";
      ctx.beginPath();
      ctx.moveTo(plane.x, plane.y);
      ctx.lineTo(destination.x, destination.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawAirports() {
    for (const airport of airports) {
      const color = airport.infected ? AIRPORT_INFECTED_COLOR : AIRPORT_COLOR;
      ctx.beginPath();
      ctx.arc(airport.x, airport.y, AIRPORT_RADIUS + 4, 0, Math.PI * 2);
      ctx.fillStyle = airport.infected ? "rgba(151, 28, 14, 0.35)" : "rgba(96, 165, 250, 0.3)";
      ctx.fill();

      ctx.beginPath();
      ctx.arc(airport.x, airport.y, AIRPORT_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
      ctx.stroke();
    }
  }

  function drawPlanes() {
    if (spritesReady < 2) return;
    for (const plane of planes) {
      const sprite = plane.infected ? planeInfectedSprite : planeSprite;
      const width = PLANE_SPRITE_WIDTH;
      const height = (sprite.naturalHeight / sprite.naturalWidth) * width;
      ctx.save();
      ctx.translate(plane.x, plane.y);
      ctx.rotate(plane.angle);
      ctx.drawImage(sprite, -width / 2, -height / 2, width, height);
      ctx.restore();
    }
  }

  function render() {
    ctx.clearRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    drawRoutes();
    drawPeopleOfState(STATE.HEALTHY);
    drawPeopleOfState(STATE.CURED);
    drawPeopleOfState(STATE.DEAD);
    drawPeopleOfState(STATE.INFECTED);
    drawAirports();
    drawPlanes();
  }

  // ---------------------------------------------------------------------------
  // HUD
  // ---------------------------------------------------------------------------

  function refreshStats() {
    counts.healthy = 0;
    counts.infected = 0;
    counts.dead = 0;
    counts.cured = 0;
    for (const person of people) {
      if (person.state === STATE.HEALTHY) counts.healthy++;
      else if (person.state === STATE.INFECTED) counts.infected++;
      else if (person.state === STATE.DEAD) counts.dead++;
      else counts.cured++;
    }

    const total = people.length || 1;
    const percent = (value) => ((value / total) * 100).toFixed(1);

    $("statHealthy").textContent = percent(counts.healthy) + "%";
    $("statInfected").textContent = percent(counts.infected) + "%";
    $("statDead").textContent = percent(counts.dead) + "%";
    $("statCured").textContent = percent(counts.cured) + "%";

    $("barHealthy").style.width = percent(counts.healthy) + "%";
    $("barInfected").style.width = percent(counts.infected) + "%";
    $("barCured").style.width = percent(counts.cured) + "%";
    $("barDead").style.width = percent(counts.dead) + "%";
  }

  function refreshClock() {
    const day = Math.floor(simElapsedMs / 1000);
    if (day === lastRenderedDay) return;
    lastRenderedDay = day;

    const date = new Date(startDate.getTime());
    date.setDate(date.getDate() + day);
    $("clock").textContent = date.toLocaleDateString("pt-PT", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
    $("dayCounter").textContent = "Dia " + day;
  }

  function refreshSpeedButtons() {
    for (const button of document.querySelectorAll("[data-speed]")) {
      const value = Number(button.dataset.speed);
      button.classList.toggle("is-active", value === speed);
      button.setAttribute("aria-pressed", String(value === speed));
    }
    $("hint").hidden = outbreakStarted;
  }

  function setSpeed(value) {
    speed = value;
    if (value > 0) lastFrameTime = performance.now();
    refreshSpeedButtons();
  }

  function setMode(next) {
    mode = mode === next ? MODE.INFECT : next;
    canvas.dataset.mode = mode;
    for (const button of document.querySelectorAll("[data-mode]")) {
      const active = button.dataset.mode === mode;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    }
  }

  // ---------------------------------------------------------------------------
  // Interacao com o mapa
  // ---------------------------------------------------------------------------

  function toWorldCoords(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * WORLD_WIDTH,
      y: ((event.clientY - rect.top) / rect.height) * WORLD_HEIGHT,
    };
  }

  /** Quanto menor o mapa no ecra, maior tem de ser a tolerancia em unidades do mundo. */
  function clickTolerance() {
    const displayScale = canvas.getBoundingClientRect().width / WORLD_WIDTH;
    return Math.max(CLICK_TOLERANCE, TOUCH_TARGET_PX / (displayScale || 1));
  }

  function findNearestPerson(x, y, maxDistance) {
    let best = null;
    let bestDistance = maxDistance;
    for (const person of people) {
      const d = distance(person.x, person.y, x, y);
      if (d < bestDistance) {
        bestDistance = d;
        best = person;
      }
    }
    return best;
  }

  function handleAddAirport(x, y) {
    const target = findNearestPerson(x, y, clickTolerance());
    if (!target) {
      toast("Coloque o aeroporto sobre uma zona habitada.", "warn");
      return;
    }
    if (airports.some((airport) => distance(airport.x, airport.y, target.x, target.y) < AIRPORT_RADIUS * 2)) {
      toast("J\u00e1 existe um aeroporto demasiado perto.", "warn");
      return;
    }
    airports.push(createAirport(target.x, target.y));
    toast("Aeroporto criado.", "success");
    setMode(MODE.INFECT);
  }

  function handleRemoveAirport(x, y) {
    const index = airports.findIndex((airport) => distance(airport.x, airport.y, x, y) <= AIRPORT_RADIUS + clickTolerance());
    if (index === -1) {
      toast("Clique sobre um aeroporto para o remover.", "warn");
      return;
    }
    if (airports.length <= 2) {
      toast("S\u00e3o necess\u00e1rios pelo menos dois aeroportos.", "warn");
      return;
    }

    airports.splice(index, 1);
    // Reindexa as rotas: quem ia para o aeroporto removido recebe um novo destino.
    for (const plane of planes) {
      if (plane.from === index) plane.from = 0;
      else if (plane.from > index) plane.from--;
      if (plane.to === index) plane.to = pickDifferentAirport(plane.from);
      else if (plane.to > index) plane.to--;
    }
    toast("Aeroporto removido.", "success");
    setMode(MODE.INFECT);
  }

  function handleInfect(x, y) {
    const target = findNearestPerson(x, y, clickTolerance());
    if (!target) return;
    if (target.state !== STATE.HEALTHY) {
      toast("Essa popula\u00e7\u00e3o j\u00e1 foi afetada.", "warn");
      return;
    }
    infectPerson(target);
    if (speed === 0) setSpeed(1);
    refreshSpeedButtons();
  }

  canvas.addEventListener("click", (event) => {
    const { x, y } = toWorldCoords(event);
    if (mode === MODE.ADD_AIRPORT) handleAddAirport(x, y);
    else if (mode === MODE.REMOVE_AIRPORT) handleRemoveAirport(x, y);
    else handleInfect(x, y);
  });

  // ---------------------------------------------------------------------------
  // Controlos
  // ---------------------------------------------------------------------------

  function bindRange(id, labelId, format, apply) {
    const input = $(id);
    const label = $(labelId);
    const sync = () => {
      label.textContent = format(input.value);
      apply(parseFloat(input.value));
    };
    input.addEventListener("input", sync);
    return { input, label, sync };
  }

  const infectionRange = bindRange(
    "infectionChance",
    "infectionChanceLabel",
    (v) => v + "%",
    (v) => (settings.infectionChance = v / 100)
  );

  const deathRange = bindRange(
    "deathChance",
    "deathChanceLabel",
    (v) => v + "%",
    (v) => {
      settings.deathChance = v / 100;
      // Morte + cura nunca pode exceder 100% das probabilidades por tentativa.
      if (settings.deathChance + settings.cureChance > 1) {
        settings.cureChance = 1 - settings.deathChance;
        cureRange.input.value = String(Math.round(settings.cureChance * 100));
        cureRange.label.textContent = cureRange.input.value + "%";
      }
    }
  );

  const cureRange = bindRange(
    "cureChance",
    "cureChanceLabel",
    (v) => v + "%",
    (v) => {
      settings.cureChance = v / 100;
      if (settings.deathChance + settings.cureChance > 1) {
        settings.deathChance = 1 - settings.cureChance;
        deathRange.input.value = String(Math.round(settings.deathChance * 100));
        deathRange.label.textContent = deathRange.input.value + "%";
      }
    }
  );

  const infectTimeRange = bindRange(
    "infectTime",
    "infectTimeLabel",
    (v) => v + "s",
    (v) => (settings.infectionDelayMs = v * 1000)
  );

  const resolveTimeRange = bindRange(
    "resolveTime",
    "resolveTimeLabel",
    (v) => v + "s",
    (v) => (settings.resolveDelayMs = v * 1000)
  );

  const planeRange = bindRange(
    "planeCount",
    "planeCountLabel",
    (v) => v,
    (v) => setPlaneCount(v)
  );

  function applyDefaultsToControls() {
    infectionRange.input.value = String(DEFAULTS.infectionChance * 100);
    deathRange.input.value = String(DEFAULTS.deathChance * 100);
    cureRange.input.value = String(DEFAULTS.cureChance * 100);
    infectTimeRange.input.value = String(DEFAULTS.infectionDelayMs / 1000);
    resolveTimeRange.input.value = String(DEFAULTS.resolveDelayMs / 1000);
    planeRange.input.value = String(DEFAULTS.planeCount);

    Object.assign(settings, DEFAULTS);
    for (const range of [infectionRange, deathRange, cureRange, infectTimeRange, resolveTimeRange]) {
      range.label.textContent = range.input.value + (range.input.id.includes("Time") ? "s" : "%");
    }
    planeRange.label.textContent = planeRange.input.value;
  }

  for (const button of document.querySelectorAll("[data-speed]")) {
    button.addEventListener("click", () => setSpeed(Number(button.dataset.speed)));
  }

  for (const button of document.querySelectorAll("[data-mode]")) {
    button.addEventListener("click", () => setMode(button.dataset.mode));
  }

  $("resetButton").addEventListener("click", () => {
    applyDefaultsToControls();
    resetWorld();
    setSpeed(0);
    setMode(MODE.INFECT);
    refreshStats();
    refreshClock();
    toast("Simula\u00e7\u00e3o reiniciada.", "success");
  });

  const drawer = $("drawer");
  const scrim = $("scrim");
  function setDrawer(open) {
    drawer.classList.toggle("is-open", open);
    scrim.classList.toggle("is-visible", open);
    $("drawerToggle").setAttribute("aria-expanded", String(open));
    drawer.setAttribute("aria-hidden", String(!open));
  }
  $("drawerToggle").addEventListener("click", () => setDrawer(!drawer.classList.contains("is-open")));
  $("drawerClose").addEventListener("click", () => setDrawer(false));
  scrim.addEventListener("click", () => setDrawer(false));

  document.addEventListener("keydown", (event) => {
    if (event.target instanceof HTMLInputElement) return;
    if (event.code === "Space") {
      event.preventDefault();
      setSpeed(speed === 0 ? 1 : 0);
    } else if (event.key === "Escape") {
      setMode(MODE.INFECT);
      setDrawer(false);
    } else if (event.key.toLowerCase() === "m") {
      setDrawer(!drawer.classList.contains("is-open"));
    }
  });

  new ResizeObserver(resizeCanvas).observe(canvas);

  // ---------------------------------------------------------------------------
  // Ciclo principal
  // ---------------------------------------------------------------------------

  function frame(now) {
    const delta = Math.min(now - lastFrameTime, 250);
    lastFrameTime = now;

    if (speed > 0) {
      accumulator += delta * speed;
      let ticks = 0;
      while (accumulator >= TICK_MS && ticks < MAX_TICKS_PER_FRAME) {
        tick(TICK_MS);
        accumulator -= TICK_MS;
        ticks++;
      }
      if (ticks === MAX_TICKS_PER_FRAME) accumulator = 0;
      refreshClock();
    }

    if (statsDirty) {
      refreshStats();
      statsDirty = false;
    }

    render();
    requestAnimationFrame(frame);
  }

  function onSpriteLoaded() {
    spritesReady++;
  }

  function init() {
    planeSprite.addEventListener("load", onSpriteLoaded);
    planeInfectedSprite.addEventListener("load", onSpriteLoaded);
    planeSprite.src = "assets/plane.png";
    planeInfectedSprite.src = "assets/infected-plane.png";

    buildPeople();
    buildNeighbourIndex();
    applyDefaultsToControls();
    resetWorld();
    resizeCanvas();
    refreshStats();
    refreshClock();
    refreshSpeedButtons();
    setMode(MODE.INFECT);

    $("populationTotal").textContent = people.length.toLocaleString("pt-PT");
    $("loader").hidden = true;

    lastFrameTime = performance.now();
    requestAnimationFrame(frame);
  }

  init();
})();
