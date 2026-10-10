/* EventSync frontend - Modern 3D & Glassmorphic SPA */
(() => {
  const ICON = { catering: '🍽️', decoration: '🎨', photography: '📷', sound: '🔊' };
  const CATS = ['catering', 'decoration', 'photography', 'sound'];
  const UNIT = { flat: 'flat', per_guest: 'per guest', per_hour: 'per hour' };

  // Registration rules. These mirror the server rules in server.js.
  const NAME_RE = /^[A-Za-z][A-Za-z .'-]{1,59}$/;
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  const PASSWORD_RE = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;

  const state = {
    token: localStorage.getItem('es_token'),
    user: null,
    notif: { items: [], unread: 0 },
    chatUnread: 0,
    chatTimer: null,
    notifOpen: false,
    authMode: 'login',
    authRole: 'organizer',
    match: null
  };
  let renderId = 0;

  // ---------- utils ----------
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const inr = n => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
  const fmtDate = d => new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  const todayStr = () => new Date().toISOString().slice(0, 10);
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  const STATUS_LABEL = {
    confirmed: 'Confirmed', pending: 'Pending', attention: 'Needs attention',
    unassigned: 'No vendor yet', ready: 'Fully coordinated', at_risk: 'At risk',
    in_progress: 'In progress', requested: 'Requested', accepted: 'Accepted',
    declined: 'Declined', cancelled: 'Cancelled', withdrawn: 'Withdrawn'
  };
  const badge = s => `<span class="badge ${s}">${STATUS_LABEL[s] || s}</span>`;

  // Returns the first problem with the registration fields, or null if all are valid.
  function validateRegister({ uname = '', email = '', password = '', confirmPassword = '' }) {
    const name = uname.trim();
    if (!name) return 'Full name is required';
    if (!NAME_RE.test(name)) return 'Name must start with a letter and use only letters, spaces, dots, apostrophes or hyphens';
    if (!EMAIL_RE.test(email.trim())) return 'Enter a valid email address, such as name@example.com';
    if (!PASSWORD_RE.test(password)) return 'Password must be at least 8 characters and include a letter and a number';
    if (password !== confirmPassword) return 'Passwords do not match';
    return null;
  }

  async function api(path, method = 'GET', body) {
    const res = await fetch('/api' + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(state.token ? { Authorization: 'Bearer ' + state.token } : {})
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 401 && state.token) { clearSession(); render(); }
      const err = new Error(data.error || 'Request failed'); err.data = data; throw err;
    }
    return data;
  }

  function toast(msg, type = '') {
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.innerHTML = `<span>${type === 'error' ? '⚠️' : '✨'}</span> <span>${esc(msg)}</span>`;
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    $('#toast-root').appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(12px) scale(0.95)';
      el.style.transition = 'all 0.3s ease';
      setTimeout(() => el.remove(), 300);
    }, type === 'error' ? 5500 : 3500);
  }
  const fail = e => toast(e.message + (e.data?.reasons ? ': ' + e.data.reasons.join('; ') : ''), 'error');
  const formData = f => Object.fromEntries(new FormData(f));
  function clearSession() { localStorage.removeItem('es_token'); state.token = null; state.user = null; }

  function openModal(html, narrow) {
    $('#modal-root').innerHTML = `
      <div class="overlay" data-act="overlay">
        <div class="modal ${narrow ? 'narrow' : ''}" role="dialog" aria-modal="true">
          ${html}
        </div>
      </div>`;
    const f = $('#modal-root input, #modal-root select, #modal-root button.primary');
    if (f) f.focus();
    apply3DTilt();
  }
  const closeModal = () => { $('#modal-root').innerHTML = ''; state.match = null; };
  const route = () => location.hash.replace(/^#/, '') || (state.user?.role === 'vendor' ? '/vendor/requests' : '/events');

  // ---------- Theme Management (Light & Dark Mode) ----------
  function getTheme() {
    return document.documentElement.getAttribute('data-theme') ||
      localStorage.getItem('eventsync-theme') ||
      (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  }

  function updateThreeTheme(theme) {
    const isLight = theme === 'light';
    const canvas = document.getElementById('bg-canvas-3d');
    if (canvas) {
      canvas.style.opacity = isLight ? '0.35' : '0.65';
    }
    if (bgParticles && bgParticles.material) {
      bgParticles.material.opacity = isLight ? 0.45 : 0.7;
      bgParticles.material.blending = isLight ? THREE.NormalBlending : THREE.AdditiveBlending;
      bgParticles.material.needsUpdate = true;
    }
    if (bgShapesGroup) {
      bgShapesGroup.children.forEach(c => {
        if (c.material) {
          c.material.color.setHex(isLight ? 0x1d4ed8 : 0x2563eb);
          c.material.opacity = isLight ? 0.08 : 0.16;
          c.material.needsUpdate = true;
        }
      });
    }
  }

  function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const meta = document.querySelector('meta[name="color-scheme"]');
    if (meta) meta.content = theme;
    try { localStorage.setItem('eventsync-theme', theme); } catch (e) {}
    updateThreeTheme(theme);
    document.querySelectorAll('.theme-toggle-btn').forEach(btn => {
      btn.setAttribute('data-theme', theme);
      btn.setAttribute('aria-label', `Toggle theme, currently ${theme} mode`);
      const lbl = btn.querySelector('.theme-toggle-label');
      if (lbl) lbl.textContent = theme === 'light' ? 'Light' : 'Dark';
    });
  }

  function toggleTheme() {
    const current = getTheme();
    const next = current === 'light' ? 'dark' : 'light';
    setTheme(next);
    toast(`Switched to ${next === 'light' ? 'Light' : 'Dark'} mode ✨`);
  }

  function themeToggleMarkup() {
    const t = getTheme();
    return `
      <button type="button" class="theme-toggle-btn" data-act="toggle-theme" data-theme="${t}" aria-label="Toggle theme, currently ${t} mode" title="Switch between Light and Dark mode">
        <span class="theme-toggle-track" aria-hidden="true">
          <span class="theme-toggle-thumb">
            <span class="icon-moon">🌙</span>
            <span class="icon-sun">☀️</span>
          </span>
        </span>
        <span class="theme-toggle-label">${t === 'light' ? 'Light' : 'Dark'}</span>
      </button>`;
  }

  // ---------- 3D Three.js Engine ----------
  let bgRenderer, bgScene, bgCamera, bgParticles, bgShapesGroup, bgAnimId;
  function initBackground3D() {
    const canvas = document.getElementById('bg-canvas-3d');
    if (!canvas || typeof THREE === 'undefined') return;
    if (bgRenderer) return;

    bgScene = new THREE.Scene();
    bgCamera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 1000);
    bgCamera.position.z = 28;

    bgRenderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    bgRenderer.setSize(window.innerWidth, window.innerHeight);
    bgRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    function getGlowParticleTexture() {
      const c = document.createElement('canvas');
      c.width = 32; c.height = 32;
      const ctx = c.getContext('2d');
      const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
      grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
      grad.addColorStop(0.35, 'rgba(56, 189, 248, 0.85)');
      grad.addColorStop(0.75, 'rgba(37, 99, 235, 0.25)');
      grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 32, 32);
      return new THREE.CanvasTexture(c);
    }

    // Particle constellation in vibrant shades of blue
    const particleCount = 120;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);

    const blueShades = [
      new THREE.Color(0x2563eb), // Royal Blue
      new THREE.Color(0x38bdf8), // Electric Sky Blue
      new THREE.Color(0x06b6d4), // Cyan Blue
      new THREE.Color(0x7dd3fc), // Ice Blue
      new THREE.Color(0x1d4ed8)  // Cobalt Blue
    ];

    for (let i = 0; i < particleCount; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 80;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 60;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 35;

      const chosen = blueShades[Math.floor(Math.random() * blueShades.length)];
      colors[i * 3] = chosen.r;
      colors[i * 3 + 1] = chosen.g;
      colors[i * 3 + 2] = chosen.b;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const pMat = new THREE.PointsMaterial({
      size: 1.8,
      map: getGlowParticleTexture(),
      vertexColors: true,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });

    bgParticles = new THREE.Points(geometry, pMat);
    bgScene.add(bgParticles);

    // Floating subtle 3D wireframe constellation nodes
    bgShapesGroup = new THREE.Group();
    const wireGeom = new THREE.IcosahedronGeometry(2.0, 1);
    const wireMat = new THREE.MeshBasicMaterial({ color: 0x2563eb, wireframe: true, transparent: true, opacity: 0.16 });

    for (let i = 0; i < 3; i++) {
      const mesh = new THREE.Mesh(wireGeom, wireMat);
      mesh.position.set((i - 1) * 32, Math.sin(i * 2) * 12, -12);
      mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
      bgShapesGroup.add(mesh);
    }
    bgScene.add(bgShapesGroup);

    updateThreeTheme(getTheme());

    let mouseX = 0, mouseY = 0;
    window.addEventListener('mousemove', (e) => {
      mouseX = (e.clientX - window.innerWidth / 2) * 0.0006;
      mouseY = (e.clientY - window.innerHeight / 2) * 0.0006;
    }, { passive: true });

    window.addEventListener('resize', () => {
      if (!bgCamera || !bgRenderer) return;
      bgCamera.aspect = window.innerWidth / window.innerHeight;
      bgCamera.updateProjectionMatrix();
      bgRenderer.setSize(window.innerWidth, window.innerHeight);
    });

    function animate() {
      bgAnimId = requestAnimationFrame(animate);
      if (bgParticles) {
        bgParticles.rotation.y += 0.0006;
        bgParticles.rotation.x += 0.0003;
      }
      if (bgShapesGroup) {
        bgShapesGroup.rotation.y += 0.0008;
        bgShapesGroup.rotation.x += 0.0005;
        bgShapesGroup.children.forEach((c) => {
          c.rotation.y += 0.002;
          c.rotation.x += 0.001;
        });
      }
      bgCamera.position.x += (mouseX * 12 - bgCamera.position.x) * 0.04;
      bgCamera.position.y += (-mouseY * 12 - bgCamera.position.y) * 0.04;
      bgCamera.lookAt(bgScene.position);
      bgRenderer.render(bgScene, bgCamera);
    }
    animate();
  }

  // Hero 3D interactive holographic scene in Login page:
  // Replaced solar system with Futuristic 3D Event Coordination Lattice Matrix
  let authAnimId, authRenderer, authScene, authCamera;
  function initAuthHero3D() {
    const wrap = document.getElementById('auth-hero-canvas-wrap');
    if (!wrap || typeof THREE === 'undefined') return;
    if (authAnimId) cancelAnimationFrame(authAnimId);

    wrap.innerHTML = '';
    const canvas = document.createElement('canvas');
    canvas.id = 'auth-hero-canvas';
    wrap.appendChild(canvas);

    authScene = new THREE.Scene();
    const w = wrap.clientWidth || 440;
    const h = wrap.clientHeight || 280;

    authCamera = new THREE.PerspectiveCamera(45, w / h, 0.1, 100);
    authCamera.position.set(0, 0, 7.4);

    authRenderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    authRenderer.setSize(w, h);
    authRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    const matrixGroup = new THREE.Group();

    // 1. Central Coordination Prism Core (Dual-Nested Octahedral & Crystal Hyper-Nexus)
    const outerCoreGeom = new THREE.OctahedronGeometry(1.65, 0);
    const outerCoreMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      wireframe: true,
      transparent: true,
      opacity: 0.65
    });
    const outerCore = new THREE.Mesh(outerCoreGeom, outerCoreMat);
    matrixGroup.add(outerCore);

    const innerCoreGeom = new THREE.DodecahedronGeometry(1.08, 0);
    const innerCoreMat = new THREE.MeshStandardMaterial({
      color: 0x1d4ed8,
      emissive: 0x0284c7,
      emissiveIntensity: 0.4,
      roughness: 0.18,
      metalness: 0.85,
      transparent: true,
      opacity: 0.92
    });
    const innerCore = new THREE.Mesh(innerCoreGeom, innerCoreMat);
    matrixGroup.add(innerCore);

    // 2. 4 Floating Isometric Service Command Nodes (Catering, Decoration, Photography, Sound)
    // Styled in diverse, harmonious shades of blue (Ice Blue, Sky Blue, Royal Blue, Cyan Blue)
    const nodeDefs = [
      { name: 'catering', color: 0x7dd3fc, glow: 0x38bdf8, base: [-2.3, 1.25, 0.4], phase: 0 },
      { name: 'decoration', color: 0x38bdf8, glow: 0x0ea5e9, base: [2.3, 1.25, -0.4], phase: Math.PI * 0.5 },
      { name: 'photography', color: 0x2563eb, glow: 0x1d4ed8, base: [2.1, -1.25, 0.5], phase: Math.PI },
      { name: 'sound', color: 0x06b6d4, glow: 0x0891b2, base: [-2.1, -1.25, -0.5], phase: Math.PI * 1.5 }
    ];

    const nodes = [];
    const nodeGeom = new THREE.BoxGeometry(0.52, 0.52, 0.52);
    const nodeEdgeGeom = new THREE.BoxGeometry(0.58, 0.58, 0.58);

    nodeDefs.forEach(def => {
      const g = new THREE.Group();
      g.position.set(def.base[0], def.base[1], def.base[2]);

      const nMat = new THREE.MeshStandardMaterial({
        color: def.color,
        emissive: def.glow,
        emissiveIntensity: 0.5,
        roughness: 0.2,
        metalness: 0.8,
        transparent: true,
        opacity: 0.9
      });
      const box = new THREE.Mesh(nodeGeom, nMat);
      g.add(box);

      const edgeMat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        wireframe: true,
        transparent: true,
        opacity: 0.4
      });
      const edge = new THREE.Mesh(nodeEdgeGeom, edgeMat);
      g.add(edge);

      matrixGroup.add(g);
      nodes.push({ group: g, base: def.base, phase: def.phase, mesh: box });
    });

    // 3. Dynamic Laser Sync Lines connecting Core to Nodes and Nodes in a Diamond Loop
    const lineSegCount = 8;
    const linePositions = new Float32Array(lineSegCount * 2 * 3);
    const lineGeom = new THREE.BufferGeometry();
    lineGeom.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));

    const laserMat = new THREE.LineBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending
    });
    const laserMesh = new THREE.LineSegments(lineGeom, laserMat);
    matrixGroup.add(laserMesh);

    // 4. Rotating Telemetry Radar Disk at the base
    const radarGeom = new THREE.RingGeometry(2.5, 2.54, 48);
    const radarMat = new THREE.MeshBasicMaterial({
      color: 0x0ea5e9,
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide
    });
    const radarDisk = new THREE.Mesh(radarGeom, radarMat);
    radarDisk.position.y = -2.35;
    radarDisk.rotation.x = Math.PI / 2.2;
    matrixGroup.add(radarDisk);

    const innerRadarGeom = new THREE.RingGeometry(1.6, 1.63, 36);
    const innerRadarDisk = new THREE.Mesh(innerRadarGeom, radarMat);
    innerRadarDisk.position.y = -2.35;
    innerRadarDisk.rotation.x = Math.PI / 2.2;
    matrixGroup.add(innerRadarDisk);

    // 5. Drifting Telemetry Blue Data Sparks
    const sparkCount = 40;
    const sparkGeom = new THREE.BufferGeometry();
    const sparkPos = new Float32Array(sparkCount * 3);
    const sparkVel = [];
    for (let i = 0; i < sparkCount; i++) {
      sparkPos[i * 3] = (Math.random() - 0.5) * 6;
      sparkPos[i * 3 + 1] = (Math.random() - 0.5) * 4;
      sparkPos[i * 3 + 2] = (Math.random() - 0.5) * 3;
      sparkVel.push(0.008 + Math.random() * 0.012);
    }
    sparkGeom.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
    const sparkMat = new THREE.PointsMaterial({
      color: 0x7dd3fc,
      size: 0.08,
      transparent: true,
      opacity: 0.75,
      blending: THREE.AdditiveBlending
    });
    const sparks = new THREE.Points(sparkGeom, sparkMat);
    matrixGroup.add(sparks);

    // Lighting (Luminous Blue Highlights)
    const amb = new THREE.AmbientLight(0xdbeafe, 0.85);
    authScene.add(amb);
    const d1 = new THREE.DirectionalLight(0x38bdf8, 2.6);
    d1.position.set(5, 6, 5);
    authScene.add(d1);
    const d2 = new THREE.DirectionalLight(0x1d4ed8, 2.2);
    d2.position.set(-5, -4, 4);
    authScene.add(d2);
    const d3 = new THREE.DirectionalLight(0x06b6d4, 1.5);
    d3.position.set(0, 5, -4);
    authScene.add(d3);

    authScene.add(matrixGroup);

    let targetRotX = 0, targetRotY = 0;
    const onMove = (e) => {
      const rect = wrap.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
      targetRotY = x * 0.65;
      targetRotX = -y * 0.65;
    };
    wrap.addEventListener('mousemove', onMove);

    let clock = 0;
    function loop() {
      authAnimId = requestAnimationFrame(loop);
      clock += 0.016;

      // Rotate and pulse the Core Prism
      outerCore.rotation.y += 0.008;
      outerCore.rotation.x += 0.004;
      innerCore.rotation.y -= 0.006;
      innerCore.rotation.z += 0.005;

      const pulse = 1 + Math.sin(clock * 2.4) * 0.035;
      innerCore.scale.set(pulse, pulse, pulse);

      // Rotate radar discs
      radarDisk.rotation.z += 0.003;
      innerRadarDisk.rotation.z -= 0.004;

      // Parallax damping
      matrixGroup.rotation.y += (targetRotY - matrixGroup.rotation.y) * 0.06;
      matrixGroup.rotation.x += (targetRotX - matrixGroup.rotation.x) * 0.06;

      // Animate Nodes floating & update laser line positions
      const posArr = lineGeom.attributes.position.array;
      let ptr = 0;

      nodes.forEach((n, idx) => {
        n.group.position.y = n.base[1] + Math.sin(clock * 1.8 + n.phase) * 0.18;
        n.group.rotation.x += 0.012;
        n.group.rotation.y += 0.016;

        // Center to Node laser beam
        posArr[ptr++] = 0; posArr[ptr++] = 0; posArr[ptr++] = 0;
        posArr[ptr++] = n.group.position.x;
        posArr[ptr++] = n.group.position.y;
        posArr[ptr++] = n.group.position.z;

        // Node to adjacent Node perimeter laser beam
        const nextNode = nodes[(idx + 1) % nodes.length];
        posArr[ptr++] = n.group.position.x;
        posArr[ptr++] = n.group.position.y;
        posArr[ptr++] = n.group.position.z;
        posArr[ptr++] = nextNode.group.position.x;
        posArr[ptr++] = nextNode.group.position.y;
        posArr[ptr++] = nextNode.group.position.z;
      });

      lineGeom.attributes.position.needsUpdate = true;
      laserMat.opacity = 0.38 + Math.sin(clock * 3.2) * 0.22;

      // Animate drifting telemetry sparks
      const spArr = sparkGeom.attributes.position.array;
      for (let i = 0; i < sparkCount; i++) {
        spArr[i * 3 + 1] += sparkVel[i];
        if (spArr[i * 3 + 1] > 2.8) {
          spArr[i * 3 + 1] = -2.4;
        }
      }
      sparkGeom.attributes.position.needsUpdate = true;

      authRenderer.render(authScene, authCamera);
    }
    loop();
  }

  // 3D Card Tilt on hover
  function apply3DTilt() {
    const cards = document.querySelectorAll('.card, .stat-card, .match, .auth-form-card');
    cards.forEach(card => {
      if (card._hasTilt) return;
      card._hasTilt = true;

      card.addEventListener('mousemove', (e) => {
        const rect = card.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;

        const rotX = ((y - centerY) / centerY) * -6;
        const rotY = ((x - centerX) / centerX) * 6;

        card.style.transform = `perspective(1000px) rotateX(${rotX.toFixed(2)}deg) rotateY(${rotY.toFixed(2)}deg) translateY(-3px) scale3d(1.01, 1.01, 1.01)`;
        card.style.setProperty('--mouse-x', `${(x / rect.width * 100).toFixed(1)}%`);
        card.style.setProperty('--mouse-y', `${(y / rect.height * 100).toFixed(1)}%`);
      });

      card.addEventListener('mouseleave', () => {
        card.style.transform = '';
      });
    });
  }

  // ---------- shared components ----------
  function rail(status, booking) {
    const steps = [
      ['Chosen', status !== 'unassigned' ? 'on' : ''],
      ['Requested', status === 'pending' ? 'wait' : (status === 'confirmed' || status === 'attention') ? 'on' : ''],
      [status === 'attention' ? cap(booking?.status || 'failed') : 'Confirmed', status === 'confirmed' ? 'on' : status === 'attention' ? 'bad' : ''],
    ];
    return `<div class="rail" aria-label="Progress: ${STATUS_LABEL[status]}">` + steps.map((s, i) =>
      (i ? `<div class="seg-line ${s[1] === 'bad' ? 'bad' : steps[i - 1][1] === 'on' && s[1] ? 'on' : ''}"></div>` : '') +
      `<div class="node ${s[1]}"><span class="dot"></span>${esc(s[0])}</div>`).join('') + '</div>';
  }

  const vendorFields = (v = {}) => `
    <div class="form-grid">
      <div class="field"><label for="vf-name">Business name</label><input id="vf-name" name="name" value="${esc(v.name)}" placeholder="e.g. Royal Banquet Catering" required></div>
      <div class="field"><label for="vf-cat">Service category</label>
        <select id="vf-cat" name="category">${CATS.map(c => `<option value="${c}" ${v.category === c ? 'selected' : ''}>${ICON[c]} ${cap(c)}</option>`).join('')}</select></div>
      <div class="field"><label for="vf-areas">Cities you serve</label><input id="vf-areas" name="service_areas" value="${esc(v.service_areas)}" placeholder="Bengaluru, Mysuru" required><div class="hint">Comma separated. Must match the event city.</div></div>
      <div class="field"><label for="vf-price">Price (₹)</label><input id="vf-price" type="number" min="1" name="price" value="${esc(v.price)}" placeholder="e.g. 25000" required></div>
      <div class="field"><label for="vf-unit">Pricing unit</label>
        <select id="vf-unit" name="price_unit">${Object.entries(UNIT).map(([k, l]) => `<option value="${k}" ${v.price_unit === k ? 'selected' : ''}>${cap(l)}</option>`).join('')}</select></div>
      <div class="field"><label for="vf-mg">Max guests per event</label><input id="vf-mg" type="number" min="1" name="max_guests" value="${esc(v.max_guests ?? '')}" placeholder="No limit"><div class="hint">Events larger than this will not match you.</div></div>
      <div class="field"><label for="vf-mc">Events you can run at the same time</label><input id="vf-mc" type="number" min="1" name="max_concurrent" value="${esc(v.max_concurrent ?? 1)}"><div class="hint">Your capacity for overlapping bookings.</div></div>
      <div class="field"><label for="vf-pkg">Package summary</label><input id="vf-pkg" name="package" value="${esc(v.package)}" placeholder="e.g. Full 3-course menu with live buffet counters"></div>
    </div>
    <div class="field" style="margin-top:16px"><label for="vf-desc">About your service</label><textarea id="vf-desc" name="description" rows="2" placeholder="Tell organizers what makes your service exceptional...">${esc(v.description)}</textarea></div>`;

  // ---------- minimal auth view ----------
  function authView() {
    const reg = state.authMode === 'register';
    const isVendor = reg && state.authRole === 'vendor';

    $('#app').innerHTML = `
    <div class="auth-minimal-page">
      <div class="auth-top-bar">
        <a class="brand" href="#" style="font-size:22px">
          <span class="brand-logo-badge">ES</span>
          <span>EventSync</span>
        </a>
        <div>
          ${themeToggleMarkup()}
        </div>
      </div>

      <div class="auth-minimal-card ${isVendor ? 'wide' : ''}">
        <div class="auth-minimal-header">
          <h2>${reg ? 'Create account' : 'Welcome back'}</h2>
          <p>${reg ? 'Join to coordinate events or offer vendor services' : 'Sign in to access your event coordination dashboard'}</p>
        </div>

        <div class="auth-tabs" role="group" aria-label="Sign in or Register">
          <button type="button" data-act="authmode" class="auth-tab ${!reg ? 'active' : ''}">Sign In</button>
          <button type="button" data-act="authmode" class="auth-tab ${reg ? 'active' : ''}">Register</button>
        </div>

        <form data-form="${reg ? 'register' : 'login'}" class="stack auth-form" ${reg ? 'novalidate' : ''}>
          ${reg ? `
            <div class="role-pill-switch" role="group" aria-label="Account type">
              <button type="button" data-act="role" data-role="organizer" class="role-pill-btn ${state.authRole === 'organizer' ? 'active' : ''}">
                <span>🎯</span>
                <span>Organizer</span>
              </button>
              <button type="button" data-act="role" data-role="vendor" class="role-pill-btn ${state.authRole === 'vendor' ? 'active' : ''}">
                <span>🎪</span>
                <span>Vendor</span>
              </button>
            </div>

            <div class="field">
              <label for="a-name">Full name</label>
              <input id="a-name" name="uname" placeholder="Bhargav Hathwar" required autocomplete="name">
            </div>` : ''}

          <div class="field">
            <label for="a-email">Email address</label>
            <input id="a-email" type="email" name="email" placeholder="name@domain.com" required autocomplete="email">
          </div>

          <div class="field">
            <label for="a-pw">Password</label>
            <input id="a-pw" type="password" name="password" placeholder="••••••••" required autocomplete="${reg ? 'new-password' : 'current-password'}">
            ${reg ? '<div class="hint">At least 8 characters, with a letter and a number.</div>' : ''}
          </div>

          ${reg ? `
            <div class="field">
              <label for="a-cpw">Confirm password</label>
              <input id="a-cpw" type="password" name="confirmPassword" placeholder="••••••••" required autocomplete="new-password">
            </div>
            <p id="a-err" role="alert" style="display:none;color:var(--red);font-size:13.5px;margin:0"></p>` : ''}

          ${reg && state.authRole === 'vendor' ? `
            <fieldset style="margin-top:6px;padding:16px;border-radius:12px;border:1px solid var(--line-strong);background:var(--bg-surface)">
              <legend style="padding:0 8px;font-size:13px;font-weight:600;color:var(--text-secondary)">Business & Service Profile</legend>
              ${vendorFields({ max_concurrent: 1, price_unit: 'flat' })}
            </fieldset>` : ''}

          <button class="btn primary glow-btn" type="submit" style="width:100%;padding:12px;margin-top:8px;font-size:15px;font-weight:600">
            ${reg ? 'Create My Account' : 'Sign In'}
          </button>
        </form>

        <p class="small muted" style="margin-top:16px;text-align:center">
          ${reg ? 'Already have an account?' : "Don't have an account yet?"}
          <button class="linkbtn" style="color:var(--accent-sky);font-weight:600;margin-left:4px" data-act="authmode">
            ${reg ? 'Sign in here' : 'Register here'}
          </button>
        </p>

        <div class="auth-demo-section">
          <div class="auth-demo-divider">
            <span>⚡ Instant Demo Access</span>
          </div>
          <div class="auth-demo-chips">
            <button type="button" class="auth-demo-chip" data-act="demo" data-email="organizer@demo.com" title="Tech Fest Organizer">
              <span>🎯 Organizer</span>
            </button>
            <button type="button" class="auth-demo-chip" data-act="demo" data-email="royalbanquet@demo.com" title="Royal Banquet Catering">
              <span>🍽️ Catering</span>
            </button>
            <button type="button" class="auth-demo-chip" data-act="demo" data-email="auroraflowers@demo.com" title="Aurora Floral Decor">
              <span>🎨 Decor</span>
            </button>
            <button type="button" class="auth-demo-chip" data-act="demo" data-email="shutterstories@demo.com" title="Shutter Stories Studio">
              <span>📷 Photography</span>
            </button>
            <button type="button" class="auth-demo-chip" data-act="demo" data-email="pulsepro@demo.com" title="PulsePro Sound">
              <span>🔊 Sound</span>
            </button>
          </div>
        </div>
      </div>
    </div>`;

    apply3DTilt();
  }

  // ---------- app shell ----------
  function shell(active) {
    const org = state.user.role === 'organizer';
    const msgCountBadge = state.chatUnread > 0 ? `<span class="nav-msg-count">${state.chatUnread}</span>` : '';
    const nav = org
      ? [['/events', 'My events'], ['/events/new', 'New event'], ['/messages', `Messages${msgCountBadge}`]]
      : [['/vendor/requests', 'Requests'], ['/vendor/commitments', 'Commitments'], ['/vendor/availability', 'Availability'], ['/vendor/profile', 'Profile'], ['/messages', `Messages${msgCountBadge}`]];

    $('#app').innerHTML = `
    <header class="topbar">
      <div class="topbar-inner">
        <a class="brand" href="#">
          <span class="brand-logo-badge">ES</span>
          <span>EventSync</span>
        </a>
        <nav class="nav" aria-label="Main">
          ${nav.map(([h, l]) => `<a href="#${h}" class="${active === h || (h === '/events' && /^\/events\/\d+/.test(active)) || (h === '/messages' && /^\/messages/.test(active)) ? 'active' : ''}">${l}</a>`).join('')}
        </nav>
        <div class="userbox">
          ${themeToggleMarkup()}
          <button class="bell" data-act="bell" aria-label="Notifications, ${state.notif.unread} unread">
            🔔${state.notif.unread ? `<span class="count">${state.notif.unread}</span>` : ''}
          </button>
          <span>${esc(state.user.name)}</span>
          <span class="rolepill">${state.user.role}</span>
          <button class="linkbtn" data-act="logout">Sign out</button>
        </div>
      </div>
    </header>
    <div id="notif-slot"></div>
    <main id="view"><p class="muted">Loading…</p></main>`;
    drawNotif();
    apply3DTilt();
  }

  function drawNotif() {
    const slot = $('#notif-slot');
    if (!slot) return;
    if (!state.notifOpen) { slot.innerHTML = ''; return; }
    slot.innerHTML = `
      <div class="notif-panel">
        <header>
          <span>Notifications</span>
          <button class="btn small" data-act="readall">Mark all read</button>
        </header>
        ${state.notif.items.length ? state.notif.items.map(n => `
          <div class="notif-item ${n.is_read ? '' : 'unread'}">
            <div>${esc(n.message)}</div>
            <time>${esc(n.created_at)} UTC</time>
          </div>`).join('') : '<div class="notif-item muted">Nothing yet. Updates about requests and cancellations appear here.</div>'}
      </div>`;
  }

  async function refreshNotifs() {
    if (!state.token) return;
    try {
      const [n, c] = await Promise.all([
        api('/notifications'),
        api('/messages/unread/count').catch(() => ({ unread: 0 }))
      ]);
      const changed = n.unread !== state.notif.unread || (c && c.unread !== state.chatUnread);
      state.notif = n;
      state.chatUnread = c ? c.unread : 0;
      return changed;
    } catch { }
  }

  // ---------- organizer views ----------
  async function eventsView(v) {
    const { events } = await api('/events');

    // Calculate aggregated summary for top 3D stats banner
    let totalConfirmedServices = 0;
    let totalAttentionServices = 0;
    let totalBudget = 0;
    events.forEach(e => {
      totalBudget += Number(e.budget || 0);
      if (e.summary) {
        totalConfirmedServices += e.summary.confirmed || 0;
        totalAttentionServices += e.summary.attention || 0;
      }
    });

    v.innerHTML = `
      <div class="page-head">
        <div>
          <h1>My events</h1>
          <p class="muted">Track every vendor commitment and live booking status for each event in real time.</p>
        </div>
        <a class="btn primary" href="#/events/new" style="text-decoration:none">+ Create new event</a>
      </div>

      <div class="hero-stats-banner">
        <div class="stat-card">
          <div class="stat-icon">📅</div>
          <div>
            <div class="stat-num">${events.length}</div>
            <div class="stat-lbl">Active Events</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon" style="background:rgba(14,165,233,0.16);border-color:rgba(56,189,248,0.4)">✨</div>
          <div>
            <div class="stat-num">${totalConfirmedServices}</div>
            <div class="stat-lbl">Services Confirmed</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon" style="background:rgba(244,63,94,0.15);border-color:rgba(244,63,94,0.3)">⚡</div>
          <div>
            <div class="stat-num" style="color:${totalAttentionServices ? 'var(--red)' : '#fff'}">${totalAttentionServices}</div>
            <div class="stat-lbl">Need Attention</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon" style="background:rgba(6,182,212,0.15);border-color:rgba(6,182,212,0.3)">💎</div>
          <div>
            <div class="stat-num">${inr(totalBudget)}</div>
            <div class="stat-lbl">Total Budget</div>
          </div>
        </div>
      </div>

      ${events.length ? `
        <div class="grid cols-2">
          ${events.map(e => {
            const s = e.summary;
            return `
              <article class="card ${s.overall === 'at_risk' ? 'flag-red' : s.overall === 'ready' ? 'flag-green' : 'flag-amber'}">
                <div class="row between">
                  <h3><a href="#/events/${e.id}" style="color:inherit;text-decoration:none">${esc(e.name)}</a></h3>
                  ${badge(s.overall)}
                </div>
                <div class="kv" style="margin:10px 0 14px">
                  <span><b>🗓️</b> ${fmtDate(e.date)}</span>
                  <span><b>⏰</b> ${e.start_time}–${e.end_time}</span>
                  <span><b>📍</b> ${esc(e.city)}</span>
                  <span><b>👥</b> <b>${e.attendees}</b> guests</span>
                </div>
                <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="${s.total}" aria-valuenow="${s.confirmed}">
                  <span style="width:${s.total ? s.confirmed / s.total * 100 : 0}%"></span>
                </div>
                <p class="small muted" style="margin-top:8px">
                  <b>${s.confirmed}</b> of <b>${s.total}</b> services confirmed
                  ${s.attention ? ` · <b style="color:var(--red)">${s.attention} need attention</b>` : ''}
                </p>
                <div class="row" style="margin-top:14px;gap:8px">
                  ${s.services.map(x => `<span class="badge ${x.status}" title="${cap(x.category)}: ${STATUS_LABEL[x.status]}">${ICON[x.category]} ${cap(x.category)}: ${STATUS_LABEL[x.status]}</span>`).join('')}
                </div>
                <div style="margin-top:16px;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
                  <button class="btn danger small" data-act="cancelevent" data-id="${e.id}" data-name="${esc(e.name)}">🗑️ Cancel event</button>
                  <a class="btn small" href="#/events/${e.id}" style="color:#93c5fd;background:rgba(37,99,235,0.16);border-color:rgba(56,189,248,0.4)">Manage Event & Vendors →</a>
                </div>
              </article>`;
          }).join('')}
        </div>` : `
        <div class="empty">
          <div style="font-size:36px;margin-bottom:12px">🎪</div>
          <h3>No events planned yet</h3>
          <p class="muted" style="margin-bottom:18px">Create your first event and EventSync will find vetted local vendors who fit your date, guest count and budget.</p>
          <a class="btn primary" href="#/events/new" style="text-decoration:none">+ Create first event</a>
        </div>`}
    `;
    apply3DTilt();
  }

  function newEventView(v) {
    v.innerHTML = `
      <div class="page-head">
        <div>
          <h1>Create event</h1>
          <p class="muted">Tell us what you need. We only match vendors who are free, within your service area and within budget.</p>
        </div>
      </div>
      <form data-form="newevent" class="stack">
        <div class="card">
          <h3 style="margin-bottom:16px">Event details</h3>
          ${eventFields({}, true)}
        </div>
        <div class="card">
          <h3 style="margin-bottom:6px">Services you need</h3>
          <p class="small muted" style="margin-bottom:12px">Set a budget per service so we only match vendors whose quote fits. Leave it blank for no limit.</p>
          ${CATS.map(c => `
            <div class="svc-pick">
              <input type="checkbox" id="sv-${c}" name="svc_${c}">
              <label for="sv-${c}" style="margin:0;font-size:15px;cursor:pointer">${ICON[c]} ${cap(c)}</label>
              <div class="budget">
                <input type="number" min="0" name="bud_${c}" placeholder="Budget (₹)" aria-label="${cap(c)} budget">
              </div>
            </div>`).join('')}
        </div>
        <div class="row" style="margin-top:10px">
          <button class="btn primary" type="submit" style="padding:11px 24px">Create event & match vendors</button>
          <a class="btn" href="#/events" style="text-decoration:none">Cancel</a>
        </div>
      </form>`;
    apply3DTilt();
  }

  function eventFields(e = {}, future = false) {
    return `
    <div class="form-grid">
      <div class="field"><label for="e-name">Event name</label><input id="e-name" name="name" value="${esc(e.name)}" placeholder="e.g. Annual Tech Symposium 2026" required></div>
      <div class="field"><label for="e-date">Date</label><input id="e-date" type="date" name="date" value="${esc(e.date)}" ${future ? `min="${todayStr()}"` : ''} required></div>
      <div class="field"><label for="e-st">Start time</label><input id="e-st" type="time" name="start_time" value="${esc(e.start_time || '10:00')}" required></div>
      <div class="field"><label for="e-et">End time</label><input id="e-et" type="time" name="end_time" value="${esc(e.end_time || '18:00')}" required></div>
      <div class="field"><label for="e-city">City</label><input id="e-city" name="city" value="${esc(e.city)}" placeholder="Bengaluru" required></div>
      <div class="field"><label for="e-venue">Venue</label><input id="e-venue" name="venue" value="${esc(e.venue)}" placeholder="e.g. Palace Grounds, Hall 3"></div>
      <div class="field"><label for="e-att">Expected attendees</label><input id="e-att" type="number" min="1" name="attendees" value="${esc(e.attendees)}" placeholder="300" required></div>
      <div class="field"><label for="e-bud">Total budget (₹)</label><input id="e-bud" type="number" min="0" name="budget" value="${esc(e.budget)}" placeholder="150000"></div>
    </div>`;
  }

  async function eventDetailView(v, id) {
    const { event: e, summary: s } = await api('/events/' + id);
    const missing = CATS.filter(c => !s.services.some(x => x.category === c));
    const committed = s.services.reduce((t, x) => t + (x.booking && ['requested', 'accepted'].includes(x.booking.status) ? x.booking.quoted_price : 0), 0);
    const bannerText = s.overall === 'ready' ? 'All services are confirmed. This event is fully coordinated.'
      : s.overall === 'at_risk' ? `${s.attention} service${s.attention > 1 ? 's' : ''} need${s.attention > 1 ? '' : 's'} attention. Find a replacement below.`
      : `${s.confirmed} of ${s.total} services confirmed. Waiting on the rest.`;

    v.innerHTML = `
      <p class="small"><a href="#/events" style="display:inline-flex;align-items:center;gap:4px">← Back to My Events</a></p>
      <div class="page-head" style="margin-top:12px">
        <div>
          <h1>${esc(e.name)}</h1>
          <div class="kv" style="margin-top:10px">
            <span><b>🗓️</b> <b>${fmtDate(e.date)}</b></span>
            <span><b>⏰</b> ${e.start_time}–${e.end_time}</span>
            <span><b>📍</b> ${esc(e.city)}${e.venue ? ', ' + esc(e.venue) : ''}</span>
            <span><b>👥</b> <b>${e.attendees}</b> guests</span>
            <span>Total Budget <b>${inr(e.budget)}</b></span>
            <span>Quoted so far <b>${inr(committed)}</b></span>
          </div>
        </div>
        <div class="row" style="gap:10px;align-items:center">
          <button class="btn" data-act="editevent" data-event='${esc(JSON.stringify(e))}'>✏️ Edit event</button>
          <button class="btn danger" data-act="cancelevent" data-id="${e.id}" data-name="${esc(e.name)}">🗑️ Cancel event</button>
        </div>
      </div>

      <div class="banner ${s.overall}" role="status">
        <span>${s.overall === 'ready' ? '🎉' : s.overall === 'at_risk' ? '⚠️' : '⏳'}</span>
        <span>${bannerText}</span>
      </div>

      <div class="hero-stats-banner" style="margin-bottom:20px">
        <div class="stat-card">
          <div class="stat-icon" style="background:rgba(37,99,235,0.16);border-color:rgba(56,189,248,0.4)">💎</div>
          <div>
            <div class="stat-num">${inr(e.budget)}</div>
            <div class="stat-lbl">Allocated Budget</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon" style="background:rgba(6,182,212,0.15);border-color:rgba(6,182,212,0.3)">📊</div>
          <div>
            <div class="stat-num">${inr(committed)}</div>
            <div class="stat-lbl">Quoted So Far</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon" style="background:rgba(14,165,233,0.16);border-color:rgba(56,189,248,0.4)">✨</div>
          <div>
            <div class="stat-num">${s.confirmed} / ${s.total}</div>
            <div class="stat-lbl">Services Confirmed</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon" style="background:rgba(244,63,94,0.15);border-color:rgba(244,63,94,0.3)">⚡</div>
          <div>
            <div class="stat-num" style="color:${s.attention ? 'var(--red)' : '#fff'}">${s.attention ? s.attention + ' Needs Action' : 'All Clear'}</div>
            <div class="stat-lbl">Status Attention</div>
          </div>
        </div>
      </div>

      <div class="stack">
        ${s.services.map(x => serviceCard(x)).join('')}
      </div>

      ${missing.length ? `
        <form data-form="addservice" data-event="${e.id}" class="card row" style="margin-top:20px;padding:16px 20px">
          <b>+ Add another service category:</b>
          <select name="category" style="width:auto">
            ${missing.map(c => `<option value="${c}">${ICON[c]} ${cap(c)}</option>`).join('')}
          </select>
          <input type="number" min="0" name="budget" placeholder="Budget (₹)" style="width:160px" aria-label="Service budget">
          <button class="btn primary" type="submit">Add Service</button>
        </form>` : ''}
    `;
    apply3DTilt();
  }

  function serviceCard(x) {
    const b = x.booking;
    let actions = '';
    if (x.status === 'unassigned') actions = `<button class="btn primary" data-act="match" data-id="${x.id}">Find vendors</button>`;
    if (x.status === 'pending') actions = `<button class="btn danger" data-act="cancelbooking" data-id="${b.id}" data-ask="Withdraw this request?">Withdraw request</button>`;
    if (x.status === 'confirmed') actions = `<button class="btn danger" data-act="cancelbooking" data-id="${b.id}" data-ask="Cancel this confirmed booking?">Cancel booking</button>`;
    if (x.status === 'attention') actions = `<button class="btn primary" data-act="match" data-id="${x.id}">Find replacement</button>`;

    const flag = x.status === 'attention' ? 'flag-red' : x.status === 'confirmed' ? 'flag-green' : x.status === 'pending' ? 'flag-amber' : '';
    const vendorName = b ? x.bookings?.find(k => k.id === b.id)?.vendor_name : '';
    const vendorUserId = b?.vendor_user_id || x.bookings?.find(k => k.id === b?.id)?.vendor_user_id;
    if (vendorUserId) {
      actions = `<a href="#/messages/${vendorUserId}" class="btn outline small glow-btn" style="display:inline-flex;align-items:center;gap:6px;text-decoration:none">💬 Chat</a> ` + actions;
    }

    return `
    <article class="card ${flag}">
      <div class="svc-head">
        <div>
          <div class="svc-title">
            <span class="svc-icon">${ICON[x.category]}</span>
            <h3>${cap(x.category)}</h3>
            ${badge(x.status)}
          </div>
          <div class="row" style="margin-top:6px;gap:8px;align-items:center;flex-wrap:wrap">
            <p class="small muted" style="margin:0">${x.budget ? 'Service budget limit ' + inr(x.budget) : 'No budget limit set'}</p>
            <button class="btn tiny outline" data-act="changesvcbudget" data-id="${x.id}" data-category="${x.category}" data-budget="${x.budget ?? ''}" style="padding:2px 8px;font-size:12px;border-radius:6px;line-height:1.4">✏️ Change budget</button>
          </div>
        </div>
        <div class="row">${actions}</div>
      </div>
      ${rail(x.status, b)}
      ${b ? `
        <p style="margin-top:14px;font-size:14.5px">
          ${x.status === 'attention'
            ? `<b style="color:var(--red)">${esc(vendorName)} ${b.status}.</b> Choose another vendor to keep this event on track.`
            : `<b>${esc(vendorName)}</b> · quote <b>${inr(b.quoted_price)}</b> · ${x.status === 'pending' ? 'waiting for vendor confirmation' : 'confirmed by vendor'}`}
        </p>`
        : '<p class="muted" style="margin-top:14px;font-size:14.5px">Nobody selected yet. Find vendors who are free on your date, in range and within budget.</p>'}
      ${x.bookings?.length ? `
        <details class="history">
          <summary>Booking history log (${x.bookings.length})</summary>
          <ul>
            ${x.bookings.map(k => `
              <li>
                <b>${esc(k.vendor_name)}</b> ${badge(k.status)}
                <ul>
                  ${k.history.map(h => `<li>${esc(h.at)} · ${esc(h.actor)} ${esc(h.action.replace(/_/g, ' '))}${h.note ? ' — ' + esc(h.note) : ''}</li>`).join('')}
                </ul>
              </li>`).join('')}
          </ul>
        </details>` : ''}
    </article>`;
  }

  // matching modal
  async function openMatch(serviceId) {
    try {
      const data = await api(`/services/${serviceId}/matches`);
      state.match = { serviceId, data, sort: 'probability' };
      drawMatch();
    } catch (e) { fail(e); }
  }

  function drawMatch() {
    const { data, sort } = state.match;
    const { service, event, excluded } = data;
    const sortMode = sort || 'probability';
    const matches = [...data.matches].sort(
      sortMode === 'rating' ? (a, b) => b.rating - a.rating :
      sortMode === 'price' ? (a, b) => a.quote - b.quote :
      (a, b) => (b.match_probability ?? 0) - (a.match_probability ?? 0) || a.quote - b.quote || b.rating - a.rating
    );

    openModal(`
      <div class="modal-head">
        <div>
          <h2 style="text-transform:capitalize">${ICON[service.category]} ${service.category} vendors</h2>
          <div class="row" style="align-items:center;gap:10px;margin-top:6px;flex-wrap:wrap">
            <span class="small muted">${fmtDate(event.date)} · ${event.start_time}–${event.end_time} · ${esc(event.city)} · ${event.attendees} guests</span>
            <span class="small" style="font-weight:600">· Budget: ${service.budget ? inr(service.budget) : 'No limit'}</span>
            <button class="btn tiny outline" data-act="changesvcbudget" data-id="${service.id}" data-category="${service.category}" data-budget="${service.budget ?? ''}" style="padding:2px 8px;font-size:12px;border-radius:6px;line-height:1.4">✏️ Change budget</button>
          </div>
        </div>
        <button class="xbtn" data-act="closemodal" aria-label="Close">×</button>
      </div>
      <div class="modal-body">
        <div class="prob-intro-banner">
          <span style="font-size:20px">🎯</span>
          <div>
            <b>Vendor Match Probability Engine</b>
            <p class="tiny muted" style="margin:2px 0 0">Vendors are evaluated against your date, guest count (${event.attendees}), city (${esc(event.city)}), and budget (${service.budget ? inr(service.budget) : 'flexible'}). Probability score reflects overall booking compatibility out of 100%.</p>
          </div>
        </div>

        <div class="row between" style="margin:16px 0;align-items:center">
          <b>${matches.length} vendor${matches.length === 1 ? '' : 's'} can serve this event</b>
          <div class="seg" role="group" aria-label="Sort">
            <button data-act="sort" data-sort="probability" class="${sortMode === 'probability' ? 'on' : ''}">Probability match %</button>
            <button data-act="sort" data-sort="price" class="${sortMode === 'price' ? 'on' : ''}">Lowest price</button>
            <button data-act="sort" data-sort="rating" class="${sortMode === 'rating' ? 'on' : ''}">Top rated</button>
          </div>
        </div>
        ${matches.length ? matches.map(m => `
          <div class="card match">
            <div style="flex:1">
              <div class="row" style="align-items:center;gap:10px;margin-bottom:6px;flex-wrap:wrap">
                <h3 style="margin:0">${esc(m.name)} <span class="stars">★ ${m.rating.toFixed(1)}</span></h3>
                <div class="match-score-badge ${m.match_probability >= 90 ? 'score-high' : m.match_probability >= 75 ? 'score-mid' : 'score-low'}">
                  <span class="score-percent">${m.match_probability ?? 95}%</span>
                  <span class="score-label">Match</span>
                </div>
              </div>
              <div class="prob-progress-track" title="${m.match_probability}% Requirement Match Probability">
                <div class="prob-progress-bar" style="width:${m.match_probability}%"></div>
              </div>
              <p class="small muted" style="margin-top:8px">${esc(m.package || m.description)}</p>
              <ul class="reasons" style="margin-top:10px">
                <li style="color:#7dd3fc;font-weight:600">🎯 ${m.match_probability}% Overall Requirement Match for this event</li>
                ${m.reasons.map(r => `<li>${esc(r)}</li>`).join('')}
              </ul>
              ${m.competing_requests ? `<div class="warn">${m.competing_requests} other event${m.competing_requests > 1 ? 's have' : ' has'} a pending request for this vendor at an overlapping time. Your request is not a confirmation until they accept.</div>` : ''}
            </div>
            <div style="text-align:right;min-width:145px;display:flex;flex-direction:column;justify-content:space-between">
              <div>
                <div class="price">${inr(m.quote)}</div>
                <p class="tiny muted" style="text-align:right">${inr(m.price)} ${UNIT[m.price_unit]}</p>
              </div>
              <button class="btn primary glow-btn" style="margin-top:14px;width:100%" data-act="request" data-vendor="${m.vendor_id}">Request booking</button>
              ${m.user_id ? `<a href="#/messages/${m.user_id}" onclick="closeModal()" class="btn outline tiny" style="margin-top:6px;width:100%;text-align:center;text-decoration:none;display:inline-flex;align-items:center;justify-content:center;gap:4px">💬 Chat with Vendor</a>` : ''}
            </div>
          </div>`).join('')
        : `<div class="empty"><h3>No vendor meets every requirement</h3><p class="muted">See why each vendor was excluded below. You can adjust the budget, date or city and search again.</p></div>`}
        ${excluded.length ? `
          <details style="margin-top:18px" open>
            <summary style="cursor:pointer;font-weight:600;color:var(--text-secondary);margin-bottom:8px">${excluded.length} vendor${excluded.length > 1 ? 's' : ''} not currently qualified for this event</summary>
            ${excluded.map(m => {
              const budgetIssue = m.reasons.some(r => /exceeds service budget/i.test(r));
              const prob = m.match_probability || 0;
              return `
              <div class="card" style="margin-top:8px;border-left:${budgetIssue ? '3px solid #38bdf8' : '1px solid var(--line)'}">
                <div class="row between" style="align-items:flex-start;gap:12px">
                  <div style="flex:1">
                    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
                      <b>${esc(m.name)}</b>
                      <span class="stars">★ ${m.rating.toFixed(1)}</span>
                      ${prob > 0 ? `
                        <div class="match-score-badge ${prob >= 75 ? 'score-mid' : 'score-low'}">
                          <span class="score-percent">${prob}%</span>
                          <span class="score-label">Compatibility</span>
                        </div>
                      ` : ''}
                    </div>
                    ${m.package ? `<p class="tiny muted" style="margin-top:3px">${esc(m.package)}</p>` : ''}
                    <ul class="reasons bad" style="margin-top:6px">${m.reasons.map(r => `<li>${esc(r)}</li>`).join('')}</ul>
                  </div>
                  <div style="text-align:right;flex-shrink:0">
                    <div class="price" style="font-size:16px">${inr(m.quote)}</div>
                    <p class="tiny muted">${inr(m.price)} ${UNIT[m.price_unit]}</p>
                    ${budgetIssue ? `
                      <button class="btn primary tiny glow-btn" data-act="quickbudgetmatch" data-service="${service.id}" data-vendor="${m.vendor_id}" data-quote="${m.quote}" data-name="${esc(m.name)}" style="margin-top:8px;white-space:nowrap">
                        ⚡ Adjust budget to ${inr(m.quote)} & request
                      </button>
                    ` : ''}
                  </div>
                </div>
              </div>`;
            }).join('')}
          </details>` : ''}
      </div>`);
  }

  // ---------- vendor views ----------
  async function vendorRequests(v) {
    const { bookings, vendor } = await api('/vendor/bookings');
    const pending = bookings.filter(b => b.status === 'requested');
    const acceptedCount = bookings.filter(b => b.status === 'accepted').length;

    v.innerHTML = `
      <div class="page-head">
        <div>
          <h1>Booking requests</h1>
          <p class="muted">${esc(vendor.name)} · Accept only what you can deliver. Real-time availability is checked again when you confirm.</p>
        </div>
      </div>

      <div class="hero-stats-banner">
        <div class="stat-card">
          <div class="stat-icon" style="background:rgba(245,158,11,0.15);border-color:rgba(245,158,11,0.3)">📬</div>
          <div>
            <div class="stat-num">${pending.length}</div>
            <div class="stat-lbl">Pending Requests</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon" style="background:rgba(14,165,233,0.16);border-color:rgba(56,189,248,0.4)">📅</div>
          <div>
            <div class="stat-num">${acceptedCount}</div>
            <div class="stat-lbl">Confirmed Bookings</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon" style="background:rgba(37,99,235,0.16);border-color:rgba(56,189,248,0.4)">⚡</div>
          <div>
            <div class="stat-num">${vendor.max_concurrent}</div>
            <div class="stat-lbl">Concurrent Capacity</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon" style="background:rgba(6,182,212,0.15);border-color:rgba(6,182,212,0.3)">💰</div>
          <div>
            <div class="stat-num">${inr(vendor.price)}</div>
            <div class="stat-lbl">${UNIT[vendor.price_unit] || 'flat'} Base Rate</div>
          </div>
        </div>
      </div>

      ${pending.length ? pending.map(b => bookingCard(b, true)).join('')
        : `<div class="empty">
            <div style="font-size:36px;margin-bottom:12px">📬</div>
            <h3>No pending requests</h3>
            <p class="muted">New booking requests from organizers will appear here. Keep your availability up to date so you only receive suitable requests.</p>
          </div>`}
    `;
    apply3DTilt();
  }

  function bookingCard(b, actionable) {
    const conflict = b.conflict && b.conflict.length;
    return `
    <article class="card ${conflict ? 'flag-red' : b.status === 'accepted' ? 'flag-green' : 'flag-amber'}">
      <div class="row between">
        <h3>${esc(b.event_name)}</h3>
        ${badge(b.status)}
      </div>
      <div class="kv" style="margin:8px 0 12px">
        <span><b>🗓️</b> <b>${fmtDate(b.date)}</b></span>
        <span><b>⏰</b> ${b.start_time}–${b.end_time}</span>
        <span><b>📍</b> ${esc(b.city)}${b.venue ? ', ' + esc(b.venue) : ''}</span>
        <span><b>👥</b> <b>${b.attendees}</b> guests</span>
        <span><b>${ICON[b.category]}</b> ${cap(b.category)}</span>
        <span>Quote <b>${inr(b.quoted_price)}</b></span>
        <span>By ${esc(b.organizer_name)}</span>
      </div>
      ${conflict ? `<div class="warn red"><b>Cannot confirm.</b> ${b.conflict.map(esc).join(' · ')}</div>` : ''}
      ${actionable ? `
        <div class="row" style="margin-top:14px">
          <button class="btn good" data-act="accept" data-id="${b.id}" ${conflict ? 'disabled' : ''}>Accept booking</button>
          <button class="btn danger" data-act="decline" data-id="${b.id}">Decline</button>
          ${b.organizer_id ? `<a href="#/messages/${b.organizer_id}" class="btn outline small glow-btn" style="display:inline-flex;align-items:center;gap:6px;text-decoration:none">💬 Chat with Organizer</a>` : ''}
        </div>`
        : b.status === 'accepted' ? `
        <div class="row" style="margin-top:14px">
          <button class="btn danger" data-act="cancelbooking" data-id="${b.id}" data-ask="Cancel this confirmed booking? The organizer will be told to find a replacement." data-reason="1">Cancel booking</button>
          ${b.organizer_id ? `<a href="#/messages/${b.organizer_id}" class="btn outline small glow-btn" style="display:inline-flex;align-items:center;gap:6px;text-decoration:none">💬 Chat with Organizer</a>` : ''}
        </div>` : b.organizer_id ? `
        <div class="row" style="margin-top:14px">
          <a href="#/messages/${b.organizer_id}" class="btn outline small glow-btn" style="display:inline-flex;align-items:center;gap:6px;text-decoration:none">💬 Chat with Organizer</a>
        </div>` : ''}
    </article>`;
  }

  async function vendorCommitments(v) {
    const { bookings } = await api('/vendor/bookings');
    const acc = bookings.filter(b => b.status === 'accepted'), rest = bookings.filter(b => !['accepted', 'requested'].includes(b.status));
    const totalRev = acc.reduce((t, b) => t + (b.quoted_price || 0), 0);

    v.innerHTML = `
      <div class="page-head">
        <div>
          <h1>Commitments</h1>
          <p class="muted">Confirmed bookings on your schedule.</p>
        </div>
      </div>

      <div class="hero-stats-banner">
        <div class="stat-card">
          <div class="stat-icon" style="background:rgba(14,165,233,0.16);border-color:rgba(56,189,248,0.4)">📅</div>
          <div>
            <div class="stat-num">${acc.length}</div>
            <div class="stat-lbl">Confirmed Bookings</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon" style="background:rgba(37,99,235,0.16);border-color:rgba(56,189,248,0.4)">💎</div>
          <div>
            <div class="stat-num">${inr(totalRev)}</div>
            <div class="stat-lbl">Confirmed Revenue</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon" style="background:rgba(6,182,212,0.15);border-color:rgba(6,182,212,0.3)">⏳</div>
          <div>
            <div class="stat-num">${rest.length}</div>
            <div class="stat-lbl">Past / Closed</div>
          </div>
        </div>
      </div>

      ${acc.length ? acc.map(b => bookingCard(b, false)).join('')
        : `<div class="empty">
            <div style="font-size:36px;margin-bottom:12px">📅</div>
            <h3>No confirmed bookings yet</h3>
            <p class="muted">Accepted requests will show up here.</p>
          </div>`}
      ${rest.length ? `
        <h2 style="margin:36px 0 14px">Past and closed bookings</h2>
        <div class="card">
          <table>
            <thead><tr><th>Event</th><th>Date</th><th>Service</th><th>Status</th></tr></thead>
            <tbody>
              ${rest.map(b => `<tr><td>${esc(b.event_name)}</td><td>${b.date}</td><td>${cap(b.category)}</td><td>${badge(b.status)}</td></tr>`).join('')}
            </tbody>
          </table>
        </div>` : ''}
    `;
    apply3DTilt();
  }

  async function vendorAvailability(v) {
    const [{ dates }, { bookings }] = await Promise.all([api('/vendor/blocked'), api('/vendor/bookings')]);
    const acc = bookings.filter(b => b.status === 'accepted');
    v.innerHTML = `
      <div class="page-head">
        <div>
          <h1>Availability</h1>
          <p class="muted">Days you mark as unavailable are excluded from organizer matching automatically.</p>
        </div>
      </div>
      <form data-form="block" class="card row" style="padding:18px 22px">
        <div class="field">
          <label for="b-date">Date</label>
          <input id="b-date" type="date" name="date" min="${todayStr()}" required>
        </div>
        <div class="field" style="flex:1;min-width:220px">
          <label for="b-reason">Reason (optional)</label>
          <input id="b-reason" name="reason" placeholder="Personal leave, equipment maintenance, another commitment…">
        </div>
        <button class="btn primary" type="submit" style="align-self:flex-end">Mark unavailable</button>
      </form>

      <div class="grid cols-2" style="margin-top:20px">
        <div class="card">
          <h3 style="margin-bottom:12px">Unavailable days</h3>
          ${dates.length ? `
            <table>
              <tbody>
                ${dates.map(d => `<tr><td><b>${fmtDate(d.date)}</b></td><td class="muted">${esc(d.reason)}</td><td><button class="btn small danger" data-act="unblock" data-id="${d.id}">Remove</button></td></tr>`).join('')}
              </tbody>
            </table>` : '<p class="muted">No blocked days.</p>'}
        </div>
        <div class="card">
          <h3 style="margin-bottom:12px">Confirmed bookings</h3>
          ${acc.length ? `
            <table>
              <tbody>
                ${acc.map(b => `<tr><td><b>${fmtDate(b.date)}</b></td><td>${b.start_time}–${b.end_time}</td><td>${esc(b.event_name)}</td></tr>`).join('')}
              </tbody>
            </table>` : '<p class="muted">None yet.</p>'}
        </div>
      </div>
    `;
    apply3DTilt();
  }

  async function vendorProfile(v) {
    const { vendor } = await api('/vendor/profile');
    v.innerHTML = `
      <div class="page-head">
        <div>
          <h1>Your profile</h1>
          <p class="muted">Organizers are matched using these details. Keep capacity, areas, and pricing accurate.</p>
        </div>
      </div>
      <form data-form="profile" class="card stack">
        ${vendorFields(vendor)}
        <div style="margin-top:16px"><button class="btn primary" type="submit" style="padding:11px 24px">Save profile</button></div>
      </form>
    `;
    apply3DTilt();
  }

  // ---------- messaging view ----------
  async function messagesView(v, initialPartnerId) {
    if (state.chatTimer) {
      clearInterval(state.chatTimer);
      state.chatTimer = null;
    }

    v.innerHTML = `
      <div class="chat-page">
        <div class="page-head" style="margin-bottom:0">
          <div>
            <h1>Messages</h1>
            <p class="muted">Live direct text messaging between event organizers and service vendors.</p>
          </div>
        </div>
        <div class="chat-container">
          <aside class="chat-sidebar">
            <div class="chat-sidebar-head">
              <div class="chat-sidebar-title">
                <h2>💬 Conversations</h2>
              </div>
              <input type="text" class="chat-search-input" id="chat-filter-input" placeholder="🔍 Search conversations..." />
            </div>
            <div class="chat-conv-list" id="chat-conv-list">
              <div style="padding:24px;text-align:center" class="muted">Loading conversations…</div>
            </div>
          </aside>
          <section class="chat-main" id="chat-main-pane">
            <div class="chat-empty-state">
              <div class="chat-empty-icon">💬</div>
              <h3>Select a conversation</h3>
              <p class="muted">Choose an organizer or vendor from the left to start messaging.</p>
            </div>
          </section>
        </div>
      </div>
    `;

    apply3DTilt();

    let conversations = [];
    try {
      const res = await api('/conversations');
      conversations = res.conversations || [];
    } catch (e) {
      fail(e);
      return;
    }

    let activePartnerId = initialPartnerId ? parseInt(initialPartnerId, 10) : null;
    if (!activePartnerId && conversations.length > 0) {
      activePartnerId = conversations[0].partner_id;
    }

    const convListEl = $('#chat-conv-list');
    const mainPaneEl = $('#chat-main-pane');
    const filterInput = $('#chat-filter-input');

    function renderConversations(filterText = '') {
      const q = filterText.trim().toLowerCase();
      const filtered = conversations.filter(c => {
        if (!q) return true;
        return (c.partner_name && c.partner_name.toLowerCase().includes(q)) ||
               (c.vendor_category && c.vendor_category.toLowerCase().includes(q)) ||
               (c.context?.event_name && c.context.event_name.toLowerCase().includes(q)) ||
               (c.last_message?.text && c.last_message.text.toLowerCase().includes(q));
      });

      if (!filtered.length) {
        convListEl.innerHTML = `
          <div style="padding:28px 16px;text-align:center" class="muted small">
            ${conversations.length === 0 ? 'No conversations yet.<br><br>Book a vendor or open an event to start communicating!' : 'No conversations matching "' + esc(q) + '"'}
          </div>
        `;
        return;
      }

      convListEl.innerHTML = filtered.map(c => {
        const isActive = c.partner_id === activePartnerId;
        const icon = c.partner_role === 'vendor' ? (ICON[c.vendor_category] || '🏢') : '👤';
        const roleLabel = c.partner_role === 'vendor' ? `${cap(c.vendor_category || 'Vendor')}` : 'Organizer';
        const timeStr = c.last_message ? new Date(c.last_message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
        const preview = c.last_message ? esc(c.last_message.text) : '<em>Click to start conversation</em>';

        return `
          <a class="chat-conv-item ${isActive ? 'active' : ''} ${c.unread_count > 0 ? 'unread' : ''}" data-conv-id="${c.partner_id}" href="#/messages/${c.partner_id}">
            <div class="chat-avatar">${icon}</div>
            <div class="chat-conv-body">
              <div class="chat-conv-top">
                <span class="chat-conv-name">${esc(c.partner_name)}</span>
                ${timeStr ? `<span class="chat-conv-time">${timeStr}</span>` : ''}
              </div>
              <div class="chat-conv-context">
                <span class="rolepill" style="font-size:10px;padding:1px 6px">${roleLabel}</span>
                ${c.context?.event_name ? `<span>· ${esc(c.context.event_name)}</span>` : ''}
              </div>
              <div class="chat-conv-preview">${preview}</div>
            </div>
            ${c.unread_count > 0 ? `<span class="chat-unread-badge">${c.unread_count}</span>` : ''}
          </a>
        `;
      }).join('');
    }

    if (filterInput) {
      filterInput.addEventListener('input', e => {
        renderConversations(e.target.value);
      });
    }

    renderConversations();

    let currentMsgCount = 0;
    let activeThreadContext = null;

    async function loadActiveThread(partnerId, isPolling = false) {
      if (!partnerId) return;
      try {
        const threadData = await api('/messages/' + partnerId);
        const { messages, partner, context } = threadData;
        activeThreadContext = context;

        if (isPolling && messages.length === currentMsgCount) {
          return;
        }

        currentMsgCount = messages.length;

        // Reset unread count for this partner in local conversations
        const found = conversations.find(c => c.partner_id === partnerId);
        if (found) {
          found.unread_count = 0;
          if (messages.length > 0) {
            found.last_message = messages[messages.length - 1];
          }
        }
        renderConversations(filterInput ? filterInput.value : '');

        // Update nav badge count
        await refreshNotifs();
        const navCount = $('.nav-msg-count');
        if (navCount) {
          if (state.chatUnread > 0) navCount.textContent = state.chatUnread;
          else navCount.remove();
        }

        const icon = partner.role === 'vendor' ? (ICON[partner.category] || '🏢') : '👤';
        const roleLabel = partner.role === 'vendor' ? `${cap(partner.category || 'Vendor')}` : 'Organizer';

        // Suggestion chips
        const isOrg = state.user.role === 'organizer';
        const chips = isOrg ? [
          'Can you customize the package options?',
          'What time will your team arrive for setup?',
          'Is transportation/delivery included in the quote?',
          'Looking forward to working together on this!'
        ] : [
          'Yes, we can customize that to your exact needs!',
          'Our team arrives 1 hour prior to start time for setup.',
          'All setup, delivery and teardown are fully included.',
          'Thank you, excited for this event!'
        ];

        mainPaneEl.innerHTML = `
          <header class="chat-header">
            <div class="chat-header-user">
              <div class="chat-avatar">${icon}</div>
              <div class="chat-header-info">
                <div class="chat-header-name">
                  <span>${esc(partner.name)}</span>
                  <span class="chat-status-dot" title="Active"></span>
                </div>
                <div class="chat-header-meta">
                  <span class="rolepill">${roleLabel}</span>
                  ${partner.rating ? `<span class="stars">★ ${partner.rating.toFixed(1)}</span>` : ''}
                </div>
              </div>
            </div>
            ${context ? `
              <div class="chat-event-chip">
                <span>🗓️ <b>${esc(context.event_name)}</b></span>
                <span>· ${fmtDate(context.event_date)}</span>
                ${badge(context.booking_status)}
              </div>
            ` : ''}
          </header>

          <div class="chat-messages" id="chat-messages-container">
            <div class="chat-date-divider">Today</div>
            ${messages.length === 0 ? `
              <div class="chat-empty-state" style="padding:40px 0">
                <div class="chat-empty-icon">👋</div>
                <h4>Start the conversation</h4>
                <p class="muted small">Send a message to discuss event details, timing, or requirements.</p>
              </div>
            ` : messages.map(m => {
              const isOutgoing = m.sender_id === state.user.id;
              const time = new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
              return `
                <div class="msg-row ${isOutgoing ? 'outgoing' : 'incoming'}">
                  <div class="msg-bubble">${esc(m.text)}</div>
                  <div class="msg-meta">
                    <span>${isOutgoing ? 'You' : esc(partner.name)} · ${time}</span>
                    ${isOutgoing ? `<span class="msg-check" title="Delivered">✓✓</span>` : ''}
                  </div>
                </div>
              `;
            }).join('')}
          </div>

          <div class="chat-chips-bar">
            ${chips.map(chip => `<button type="button" class="chat-chip" data-chip="${esc(chip)}">${esc(chip)}</button>`).join('')}
          </div>

          <form class="chat-input-bar" id="chat-send-form">
            <textarea class="chat-textarea" id="chat-msg-input" placeholder="Type a message (Press Enter to send, Shift+Enter for new line)..." rows="1"></textarea>
            <button type="submit" class="btn primary glow-btn chat-send-btn" id="chat-send-btn">
              <span>Send</span>
              <span>➤</span>
            </button>
          </form>
        `;

        const messagesContainer = $('#chat-messages-container');
        if (messagesContainer) {
          messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }

        const msgInput = $('#chat-msg-input');
        const sendForm = $('#chat-send-form');

        // Suggestion chip clicks
        mainPaneEl.querySelectorAll('.chat-chip').forEach(btn => {
          btn.addEventListener('click', () => {
            const chipText = btn.getAttribute('data-chip');
            if (msgInput) {
              msgInput.value = chipText;
              msgInput.focus();
            }
          });
        });

        // Auto-expand textarea & Enter to send
        if (msgInput) {
          msgInput.addEventListener('keydown', e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              sendForm.dispatchEvent(new Event('submit'));
            }
          });
        }

        // Form submit
        sendForm.addEventListener('submit', async e => {
          e.preventDefault();
          const text = msgInput.value.trim();
          if (!text) return;

          const sendBtn = $('#chat-send-btn');
          sendBtn.disabled = true;

          try {
            const sentRes = await api('/messages', 'POST', {
              receiver_id: partnerId,
              text,
              booking_id: activeThreadContext?.booking_id || null
            });

            msgInput.value = '';
            await loadActiveThread(partnerId, false);
            const conv = conversations.find(c => c.partner_id === partnerId);
            if (conv) {
              conv.last_message = sentRes.message;
              renderConversations(filterInput ? filterInput.value : '');
            }
          } catch (err) {
            fail(err);
          } finally {
            sendBtn.disabled = false;
            msgInput.focus();
          }
        });

      } catch (err) {
        mainPaneEl.innerHTML = `
          <div class="empty" style="padding:40px">
            <h3>Could not load conversation</h3>
            <p class="muted">${esc(err.message)}</p>
          </div>
        `;
      }
    }

    if (activePartnerId) {
      await loadActiveThread(activePartnerId, false);
    }

    state.chatTimer = setInterval(async () => {
      const currentRoute = route();
      if (!currentRoute.startsWith('/messages')) {
        clearInterval(state.chatTimer);
        state.chatTimer = null;
        return;
      }
      if (activePartnerId) {
        await loadActiveThread(activePartnerId, true);
      }
    }, 3000);
  }

  // ---------- render loop ----------
  async function render() {
    const my = ++renderId;
    initBackground3D();

    if (!state.token) return authView();
    if (!state.user) {
      try { state.user = (await api('/me')).user; } catch { return authView(); }
    }
    const r = route();
    const org = state.user.role === 'organizer';
    if (org && r.startsWith('/vendor')) return go('/events');
    if (!org && !r.startsWith('/vendor') && !r.startsWith('/messages')) return go('/vendor/requests');
    await refreshNotifs();
    if (my !== renderId) return;

    shell(r);
    const v = $('#view');
    try {
      let m;
      if (r === '/events') await eventsView(v);
      else if (r === '/events/new') newEventView(v);
      else if ((m = r.match(/^\/events\/(\d+)$/))) await eventDetailView(v, m[1]);
      else if (r === '/vendor/requests') await vendorRequests(v);
      else if (r === '/vendor/commitments') await vendorCommitments(v);
      else if (r === '/vendor/availability') await vendorAvailability(v);
      else if (r === '/vendor/profile') await vendorProfile(v);
      else if (r === '/messages' || (m = r.match(/^\/messages\/(\d+)$/))) await messagesView(v, m ? m[1] : null);
      else go(org ? '/events' : '/vendor/requests');
    } catch (e) {
      v.innerHTML = `
        <div class="empty">
          <h3>Could not load this page</h3>
          <p class="muted">${esc(e.message)}</p>
          <a href="#" class="btn" style="margin-top:12px">Go back</a>
        </div>`;
    }
  }

  function go(path) {
    if (location.hash === '#' + path) render();
    else location.hash = path;
  }

  async function startSession(data) {
    state.token = data.token;
    localStorage.setItem('es_token', data.token);
    state.user = data.user;
    location.hash = '';
    render();
  }

  // ---------- events ----------
  document.addEventListener('click', async ev => {
    const t = ev.target.closest('[data-act]');
    if (!t) {
      if (state.notifOpen && !ev.target.closest('.notif-panel')) {
        state.notifOpen = false;
        drawNotif();
      }
      return;
    }
    const act = t.dataset.act;
    if (act === 'toggle-theme') { toggleTheme(); return; }
    if (act === 'overlay') { if (ev.target === t) closeModal(); return; }
    try {
      if (act === 'authmode') {
        state.authMode = state.authMode === 'login' ? 'register' : 'login';
        authView();
      }
      else if (act === 'role') {
        state.authRole = t.dataset.role;
        authView();
      }
      else if (act === 'demo') {
        startSession(await api('/auth/login', 'POST', { email: t.dataset.email, password: 'demo123' }));
      }
      else if (act === 'logout') {
        try { await api('/auth/logout', 'POST'); } catch { }
        clearSession();
        state.notifOpen = false;
        location.hash = '';
        render();
      }
      else if (act === 'bell') {
        ev.stopPropagation();
        state.notifOpen = !state.notifOpen;
        await refreshNotifs();
        drawNotif();
      }
      else if (act === 'readall') {
        await api('/notifications/read', 'POST');
        await refreshNotifs();
        shell(route());
        state.notifOpen = true;
        drawNotif();
        render();
      }
      else if (act === 'closemodal') closeModal();
      else if (act === 'match') openMatch(t.dataset.id);
      else if (act === 'sort') {
        state.match.sort = t.dataset.sort;
        drawMatch();
      }
      else if (act === 'request') {
        const { serviceId } = state.match;
        const name = state.match.data.matches.find(m => m.vendor_id == t.dataset.vendor).name;
        t.disabled = true;
        try {
          await api(`/services/${serviceId}/bookings`, 'POST', { vendor_id: t.dataset.vendor });
          closeModal();
          toast(`Request sent to ${name}. It stays pending until they accept.`);
          render();
        } catch (e) {
          fail(e);
          t.disabled = false;
          openMatch(serviceId);
        }
      }
      else if (act === 'cancelbooking') {
        let reason = '';
        if (t.dataset.reason) {
          reason = prompt(t.dataset.ask + '\n\nReason (optional):');
          if (reason === null) return;
        } else if (!confirm(t.dataset.ask)) {
          return;
        }
        const r = await api(`/bookings/${t.dataset.id}/cancel`, 'POST', { reason });
        toast(r.status === 'withdrawn' ? 'Request withdrawn' : 'Booking cancelled. The other party has been notified.');
        render();
      }
      else if (act === 'accept') {
        try {
          await api(`/bookings/${t.dataset.id}/accept`, 'POST');
          toast('Booking confirmed successfully!');
        } catch (e) { fail(e); }
        render();
      }
      else if (act === 'decline') {
        const reason = prompt('Decline this request?\n\nReason (optional):');
        if (reason === null) return;
        await api(`/bookings/${t.dataset.id}/decline`, 'POST', { reason });
        toast('Request declined');
        render();
      }
      else if (act === 'unblock') {
        await api('/vendor/blocked/' + t.dataset.id, 'DELETE');
        toast('Date is available again');
        render();
      }
      else if (act === 'editevent') {
        const e = JSON.parse(t.dataset.event);
        openModal(`
          <div class="modal-head">
            <h2>Edit event</h2>
            <button class="xbtn" data-act="closemodal" aria-label="Close">×</button>
          </div>
          <div class="modal-body">
            <p class="small muted" style="margin-bottom:14px">Changing date, time, city or guest count asks confirmed vendors to re-confirm.</p>
            <form data-form="editevent" data-id="${e.id}" class="stack">
              ${eventFields(e)}
              <div class="row" style="margin-top:16px">
                <button class="btn primary" type="submit">Save changes</button>
                <button type="button" class="btn" data-act="closemodal">Cancel</button>
              </div>
            </form>
          </div>`, true);
      }
      else if (act === 'cancelevent') {
        const id = t.dataset.id;
        const name = t.dataset.name || 'this event';
        openModal(`
          <div class="modal-head">
            <h2>Cancel Event</h2>
            <button class="xbtn" data-act="closemodal" aria-label="Close">×</button>
          </div>
          <div class="modal-body">
            <p style="font-size:15px;line-height:1.6">Are you sure you want to cancel <b>${esc(name)}</b>?</p>
            <div class="banner at_risk" style="margin:16px 0">
              <span>⚠️</span>
              <span>All active and confirmed vendor bookings for this event will be immediately cancelled, and booked vendors will be notified.</span>
            </div>
            <div class="row end" style="gap:10px;margin-top:20px">
              <button class="btn" data-act="closemodal">Keep Event</button>
              <button class="btn danger" data-act="confirmcancelevent" data-id="${id}">Yes, Cancel Event</button>
            </div>
          </div>
        `);
      }
      else if (act === 'confirmcancelevent') {
        const id = t.dataset.id;
        t.disabled = true;
        t.textContent = 'Cancelling…';
        try {
          await api('/events/' + id, 'DELETE');
          closeModal();
          toast('Event cancelled successfully');
          go('/events');
        } catch (e) {
          fail(e);
          t.disabled = false;
          t.textContent = 'Yes, Cancel Event';
        }
      }
      else if (act === 'changesvcbudget') {
        const serviceId = t.dataset.id;
        const cat = t.dataset.category;
        const currentBudget = t.dataset.budget || '';
        openModal(`
          <div class="modal-head">
            <div>
              <h2>Change Budget for ${cap(cat)}</h2>
              <p class="small muted" style="margin-top:4px">Adjust the allocated budget limit for this vendor category</p>
            </div>
            <button class="xbtn" data-act="closemodal" aria-label="Close">×</button>
          </div>
          <form data-form="updatesvcbudget" data-id="${serviceId}" class="modal-body stack">
            <p class="muted" style="font-size:14px;line-height:1.5">Increasing this budget allows higher-tier vendors whose quotes exceeded your previous limit to satisfy requirements and be booked.</p>
            <div class="field">
              <label for="f-svcbudget">Allocated Budget (₹ INR)</label>
              <input id="f-svcbudget" type="number" min="0" step="500" name="budget" value="${esc(currentBudget)}" placeholder="e.g. 75000 (leave blank for no limit)" autofocus>
            </div>
            <div class="row end" style="gap:10px;margin-top:16px">
              <button type="button" class="btn" data-act="closemodal">Cancel</button>
              <button type="submit" class="btn primary">Save & Update Budget</button>
            </div>
          </form>
        `);
      }
      else if (act === 'quickbudgetmatch') {
        const serviceId = t.dataset.service;
        const vendorId = t.dataset.vendor;
        const quote = t.dataset.quote;
        const vendorName = t.dataset.name;
        try {
          t.disabled = true;
          t.textContent = 'Updating…';
          await api('/services/' + serviceId, 'PUT', { budget: quote });
          t.textContent = 'Requesting…';
          await api(`/services/${serviceId}/bookings`, 'POST', { vendor_id: vendorId });
          closeModal();
          toast(`Budget adjusted to ${inr(Number(quote))} and booking requested with ${vendorName}!`);
          render();
        } catch (e) {
          fail(e);
          t.disabled = false;
        }
      }
    } catch (e) { fail(e); }
  });

  document.addEventListener('submit', async ev => {
    const f = ev.target.closest('[data-form]');
    if (!f) return;
    ev.preventDefault();
    const d = formData(f), kind = f.dataset.form;
    try {
      if (kind === 'login') {
        startSession(await api('/auth/login', 'POST', { email: d.email, password: d.password }));
      }
      else if (kind === 'register') {
        // Check the rules in the browser first so the user sees the problem immediately.
        const errorEl = f.querySelector('#a-err');
        const problem = validateRegister(d);
        if (errorEl) {
          errorEl.textContent = problem || '';
          errorEl.style.display = problem ? 'block' : 'none';
        }
        if (problem) return;

        const body = {
          name: d.uname,
          email: d.email,
          password: d.password,
          confirmPassword: d.confirmPassword,
          role: state.authRole
        };
        if (state.authRole === 'vendor') {
          const { uname, email, password, confirmPassword, ...vendor } = d;
          body.vendor = vendor;
        }
        startSession(await api('/auth/register', 'POST', body));
      }
      else if (kind === 'newevent') {
        const services = CATS.filter(c => d['svc_' + c]).map(c => ({ category: c, budget: d['bud_' + c] || null }));
        const body = { ...d, services };
        const { id } = await api('/events', 'POST', body);
        toast('Event created. Now find vendors for each service.');
        location.hash = '/events/' + id;
      }
      else if (kind === 'addservice') {
        await api(`/events/${f.dataset.event}/services`, 'POST', d);
        toast('Service added successfully');
        render();
      }
      else if (kind === 'editevent') {
        const r = await api('/events/' + f.dataset.id, 'PUT', d);
        closeModal();
        toast(r.reconfirm ? `Event updated. ${r.reconfirm} booking${r.reconfirm > 1 ? 's' : ''} need vendor re-confirmation.` : 'Event updated');
        render();
      }
      else if (kind === 'updatesvcbudget') {
        const serviceId = f.dataset.id;
        try {
          await api('/services/' + serviceId, 'PUT', { budget: d.budget });
          closeModal();
          toast('Budget limit updated successfully');
          if (state.match && state.match.serviceId == serviceId) {
            await openMatch(serviceId);
          } else {
            render();
          }
        } catch (e) { fail(e); }
      }
      else if (kind === 'block') {
        await api('/vendor/blocked', 'POST', d);
        toast('Marked unavailable. You will not match events on that day.');
        render();
      }
      else if (kind === 'profile') {
        await api('/vendor/profile', 'PUT', d);
        toast('Profile saved successfully');
      }
    } catch (e) { fail(e); }
  });

  window.addEventListener('hashchange', () => { state.notifOpen = false; render(); });

  setInterval(async () => {
    if (!state.token || !state.user || document.hidden) return;
    const changed = await refreshNotifs();
    if (changed && !$('#modal-root').innerHTML && !/new$/.test(route()) && !document.activeElement?.closest('form')) {
      render();
    }
  }, 15000);

  render();
})();