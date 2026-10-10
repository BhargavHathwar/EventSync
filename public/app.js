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
          c.material.color.setHex(isLight ? 0x4f46e5 : 0x6366f1);
          c.material.opacity = isLight ? 0.08 : 0.15;
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
      grad.addColorStop(0.35, 'rgba(129, 140, 248, 0.85)');
      grad.addColorStop(0.75, 'rgba(99, 102, 241, 0.2)');
      grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 32, 32);
      return new THREE.CanvasTexture(c);
    }

    // Particle constellation
    const particleCount = 120;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);

    const c1 = new THREE.Color(0x818cf8);
    const c2 = new THREE.Color(0x38bdf8);
    const c3 = new THREE.Color(0xc084fc);

    for (let i = 0; i < particleCount; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 80;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 60;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 35;

      const chosen = Math.random() > 0.6 ? c1 : (Math.random() > 0.3 ? c2 : c3);
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
    const wireMat = new THREE.MeshBasicMaterial({ color: 0x6366f1, wireframe: true, transparent: true, opacity: 0.15 });

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

  // Hero 3D interactive holographic scene in Login page
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
    authCamera.position.z = 7.2;

    authRenderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    authRenderer.setSize(w, h);
    authRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    const coreGroup = new THREE.Group();

    // Outer wireframe glowing icosahedron
    const outerGeom = new THREE.IcosahedronGeometry(1.85, 1);
    const outerMat = new THREE.MeshBasicMaterial({
      color: 0x818cf8,
      wireframe: true,
      transparent: true,
      opacity: 0.45
    });
    const outerMesh = new THREE.Mesh(outerGeom, outerMat);
    coreGroup.add(outerMesh);

    // Inner glowing solid crystal
    const innerGeom = new THREE.IcosahedronGeometry(1.3, 0);
    const innerMat = new THREE.MeshStandardMaterial({
      color: 0x4f46e5,
      roughness: 0.25,
      metalness: 0.8,
      wireframe: false,
      transparent: true,
      opacity: 0.85
    });
    const innerMesh = new THREE.Mesh(innerGeom, innerMat);
    coreGroup.add(innerMesh);

    // Orbiting Rings
    const ring1Geom = new THREE.TorusGeometry(2.65, 0.035, 16, 100);
    const ring1Mat = new THREE.MeshBasicMaterial({ color: 0x06b6d4, transparent: true, opacity: 0.8 });
    const ring1 = new THREE.Mesh(ring1Geom, ring1Mat);
    ring1.rotation.x = Math.PI / 3;
    coreGroup.add(ring1);

    const ring2Geom = new THREE.TorusGeometry(3.05, 0.03, 16, 100);
    const ring2Mat = new THREE.MeshBasicMaterial({ color: 0xa855f7, transparent: true, opacity: 0.7 });
    const ring2 = new THREE.Mesh(ring2Geom, ring2Mat);
    ring2.rotation.x = -Math.PI / 3.5;
    ring2.rotation.y = Math.PI / 5;
    coreGroup.add(ring2);

    // 4 Orbiting Satellites representing the 4 services
    const satGroup = new THREE.Group();
    const satColors = [0x10b981, 0xf59e0b, 0x06b6d4, 0xf43f5e];
    const sats = [];
    for (let i = 0; i < 4; i++) {
      const sGeom = new THREE.SphereGeometry(0.18, 16, 16);
      const sMat = new THREE.MeshStandardMaterial({
        color: satColors[i],
        emissive: satColors[i],
        emissiveIntensity: 0.6,
        roughness: 0.2
      });
      const sMesh = new THREE.Mesh(sGeom, sMat);
      satGroup.add(sMesh);
      sats.push({ mesh: sMesh, angle: (i * Math.PI) / 2, radius: 2.7, speed: 0.016 + i * 0.004 });
    }
    coreGroup.add(satGroup);

    // Lighting
    const amb = new THREE.AmbientLight(0xffffff, 0.85);
    authScene.add(amb);
    const d1 = new THREE.DirectionalLight(0x818cf8, 2.5);
    d1.position.set(5, 5, 5);
    authScene.add(d1);
    const d2 = new THREE.DirectionalLight(0x06b6d4, 1.8);
    d2.position.set(-5, -3, 3);
    authScene.add(d2);

    authScene.add(coreGroup);

    let targetRotX = 0, targetRotY = 0;
    const onMove = (e) => {
      const rect = wrap.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
      targetRotY = x * 0.7;
      targetRotX = -y * 0.7;
    };
    wrap.addEventListener('mousemove', onMove);

    function loop() {
      authAnimId = requestAnimationFrame(loop);
      coreGroup.rotation.y += 0.005;
      coreGroup.rotation.x += 0.0025;
      ring1.rotation.z += 0.008;
      ring2.rotation.z -= 0.006;

      coreGroup.rotation.y += (targetRotY - coreGroup.rotation.y) * 0.06;
      coreGroup.rotation.x += (targetRotX - coreGroup.rotation.x) * 0.06;

      sats.forEach(s => {
        s.angle += s.speed;
        s.mesh.position.x = Math.cos(s.angle) * s.radius;
        s.mesh.position.y = Math.sin(s.angle) * (s.radius * 0.45);
        s.mesh.position.z = Math.sin(s.angle * 1.5) * 0.9;
      });

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

  // ---------- redesigned auth view ----------
  function authView() {
    const reg = state.authMode === 'register';
    $('#app').innerHTML = `
    <div class="auth-wrap">
      <div class="auth-top-actions">
        ${themeToggleMarkup()}
      </div>
      <section class="auth-hero">
        <div>
          <a class="brand" href="#" style="font-size:24px">
            <svg class="brand-mark" viewBox="0 0 24 24" fill="none" stroke="#818cf8" stroke-width="2.4" stroke-linecap="round"><path d="M4 8h12M12 4l4 4-4 4M20 16H8M12 12l-4 4 4 4"/></svg>
            <span>EventSync</span>
          </a>
          <h1>Every vendor. One event.<br><span style="background:linear-gradient(135deg,#818cf8,#38bdf8);-webkit-background-clip:text;-webkit-text-fill-color:transparent">Perfectly Coordinated.</span></h1>
          <p class="hero-desc">Describe your event once. EventSync seamlessly matches verified vendors free on your date, capable of handling your guest count and city, with live state synchronization.</p>
        </div>

        <div class="auth-hero-3d-box" id="auth-hero-canvas-wrap" title="Interactive 3D Event Core - Hover to interact"></div>

        <div>
          <div class="sync-demo" aria-hidden="true">
            <div><span>🍽️ Catering</span><span class="badge confirmed">Confirmed · Ready</span></div>
            <div><span>🎨 Decoration</span><span class="badge pending">Matching · In Progress</span></div>
            <div><span>🔊 Sound</span><span class="badge attention">Auto-Resolving · Replacement</span></div>
          </div>
          <p class="small muted" style="margin-top:24px">THE LAST COMMIT · High-Precision Local Event Vendor Coordination</p>
        </div>
      </section>

      <section class="auth-form-wrap">
        <div class="auth-form-card">
          <div class="row between" style="margin-bottom:16px">
            <div>
              <h2>${reg ? 'Create Account' : 'Welcome Back'}</h2>
              <p class="subtitle">${reg ? 'Join as an organizer or local vendor' : 'Sign in to manage and sync your events'}</p>
            </div>
            <div class="seg" role="group" aria-label="Auth Mode">
              <button type="button" data-act="authmode" class="${!reg ? 'on' : ''}">Sign In</button>
              <button type="button" data-act="authmode" class="${reg ? 'on' : ''}">Register</button>
            </div>
          </div>

          <form data-form="${reg ? 'register' : 'login'}" class="stack" ${reg ? 'novalidate' : ''}>
            ${reg ? `
              <div class="role-selector-3d" role="group" aria-label="Account type">
                <button type="button" data-act="role" data-role="organizer" class="role-btn ${state.authRole === 'organizer' ? 'on' : ''}">
                  <span class="role-icon">🎯</span>
                  <span class="role-title">Organizer</span>
                  <div class="role-desc">Plan events & book verified vendors</div>
                </button>
                <button type="button" data-act="role" data-role="vendor" class="role-btn ${state.authRole === 'vendor' ? 'on' : ''}">
                  <span class="role-icon">🎪</span>
                  <span class="role-title">Vendor</span>
                  <div class="role-desc">Get booked & manage schedule</div>
                </button>
              </div>
              <div class="field">
                <label for="a-name">Full name</label>
                <input id="a-name" name="uname" placeholder="Bhargav Hathwar" required>
              </div>` : ''}

            <div class="field">
              <label for="a-email">Email address</label>
              <input id="a-email" type="email" name="email" placeholder="name@domain.com" required>
            </div>

            <div class="field">
              <label for="a-pw">Password</label>
              <input id="a-pw" type="password" name="password" placeholder="••••••••" required>
              ${reg ? '<div class="hint">At least 8 characters, with a letter and a number.</div>' : ''}
            </div>

            ${reg ? `
              <div class="field">
                <label for="a-cpw">Confirm password</label>
                <input id="a-cpw" type="password" name="confirmPassword" placeholder="••••••••" required>
              </div>
              <p id="a-err" role="alert" style="display:none;color:#f87171;font-size:14px;margin:0"></p>` : ''}

            ${reg && state.authRole === 'vendor' ? `
              <fieldset>
                <legend>Business & Service Profile</legend>
                ${vendorFields({ max_concurrent: 1, price_unit: 'flat' })}
              </fieldset>` : ''}

            <button class="btn primary" type="submit" style="width:100%;padding:12px;margin-top:6px;font-size:15px">
              ${reg ? 'Create My Account' : 'Sign In to EventSync'}
            </button>
          </form>

          <p class="small muted" style="margin-top:16px;text-align:center">
            ${reg ? 'Already have an account?' : "Don't have an account yet?"}
            <button class="linkbtn" style="color:var(--primary);font-weight:600" data-act="authmode">
              ${reg ? 'Sign in here' : 'Create an account'}
            </button>
          </p>

          <div class="demo-box">
            <header>
              <span class="small" style="font-weight:700">⚡ 1-Click Demo Logins</span>
              <span class="tiny muted">password: demo123</span>
            </header>
            <div class="demo-grid">
              <div class="demo-chip" data-act="demo" data-email="organizer@demo.com">
                <span>🎯 Tech Fest Organizer (Bengaluru)</span>
                <span class="chip-role">Organizer</span>
              </div>
              <div class="demo-chip" data-act="demo" data-email="organizer2@demo.com">
                <span>🏢 Corporate Day Organizer (Mysuru)</span>
                <span class="chip-role">Organizer</span>
              </div>
              <div class="demo-chip" data-act="demo" data-email="royalbanquet@demo.com">
                <span>🍽️ Royal Banquet</span>
                <span class="chip-role">Catering</span>
              </div>
              <div class="demo-chip" data-act="demo" data-email="auroraflowers@demo.com">
                <span>🎨 Aurora Floral Decor</span>
                <span class="chip-role">Decoration</span>
              </div>
              <div class="demo-chip" data-act="demo" data-email="shutterstories@demo.com">
                <span>📷 Shutter Stories Studio</span>
                <span class="chip-role">Photography</span>
              </div>
              <div class="demo-chip" data-act="demo" data-email="pulsepro@demo.com">
                <span>🔊 PulsePro Sound</span>
                <span class="chip-role">Sound</span>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>`;

    initAuthHero3D();
    apply3DTilt();
  }

  // ---------- app shell ----------
  function shell(active) {
    const org = state.user.role === 'organizer';
    const nav = org
      ? [['/events', 'My events'], ['/events/new', 'New event']]
      : [['/vendor/requests', 'Requests'], ['/vendor/commitments', 'Commitments'], ['/vendor/availability', 'Availability'], ['/vendor/profile', 'Profile']];

    $('#app').innerHTML = `
    <header class="topbar">
      <div class="topbar-inner">
        <a class="brand" href="#">
          <svg class="brand-mark" viewBox="0 0 24 24" fill="none" stroke="#818cf8" stroke-width="2.4" stroke-linecap="round"><path d="M4 8h12M12 4l4 4-4 4M20 16H8M12 12l-4 4 4 4"/></svg>
          <span>EventSync</span>
        </a>
        <nav class="nav" aria-label="Main">
          ${nav.map(([h, l]) => `<a href="#${h}" class="${active === h || (h === '/events' && /^\/events\/\d+/.test(active)) ? 'active' : ''}">${l}</a>`).join('')}
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
      const n = await api('/notifications');
      const changed = n.unread !== state.notif.unread;
      state.notif = n;
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
          <div class="stat-icon" style="background:rgba(16,185,129,0.15);border-color:rgba(16,185,129,0.3)">✨</div>
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
                <div style="margin-top:16px;display:flex;justify-content:flex-end">
                  <a class="btn small" href="#/events/${e.id}" style="color:#c7d2fe;background:rgba(99,102,241,0.15);border-color:rgba(99,102,241,0.3)">Manage Event & Vendors →</a>
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
        <button class="btn" data-act="editevent" data-event='${esc(JSON.stringify(e))}'>✏️ Edit event</button>
      </div>

      <div class="banner ${s.overall}" role="status">
        <span>${s.overall === 'ready' ? '🎉' : s.overall === 'at_risk' ? '⚠️' : '⏳'}</span>
        <span>${bannerText}</span>
      </div>

      <div class="hero-stats-banner" style="margin-bottom:20px">
        <div class="stat-card">
          <div class="stat-icon" style="background:rgba(99,102,241,0.15);border-color:rgba(99,102,241,0.3)">💎</div>
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
          <div class="stat-icon" style="background:rgba(16,185,129,0.15);border-color:rgba(16,185,129,0.3)">✨</div>
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

    return `
    <article class="card ${flag}">
      <div class="svc-head">
        <div>
          <div class="svc-title">
            <span class="svc-icon">${ICON[x.category]}</span>
            <h3>${cap(x.category)}</h3>
            ${badge(x.status)}
          </div>
          <p class="small muted" style="margin-top:6px">${x.budget ? 'Service budget limit ' + inr(x.budget) : 'No budget limit set'}</p>
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
      state.match = { serviceId, data, sort: 'price' };
      drawMatch();
    } catch (e) { fail(e); }
  }

  function drawMatch() {
    const { data, sort } = state.match;
    const { service, event, excluded } = data;
    const matches = [...data.matches].sort(sort === 'rating' ? (a, b) => b.rating - a.rating : (a, b) => a.quote - b.quote);
    openModal(`
      <div class="modal-head">
        <div>
          <h2 style="text-transform:capitalize">${ICON[service.category]} ${service.category} vendors</h2>
          <p class="small muted" style="margin-top:6px">${fmtDate(event.date)} · ${event.start_time}–${event.end_time} · ${esc(event.city)} · ${event.attendees} guests${service.budget ? ' · budget ' + inr(service.budget) : ''}</p>
        </div>
        <button class="xbtn" data-act="closemodal" aria-label="Close">×</button>
      </div>
      <div class="modal-body">
        <div class="row between" style="margin-bottom:16px">
          <b>${matches.length} vendor${matches.length === 1 ? '' : 's'} can serve this event</b>
          <div class="seg" role="group" aria-label="Sort">
            <button data-act="sort" data-sort="price" class="${sort === 'price' ? 'on' : ''}">Lowest price</button>
            <button data-act="sort" data-sort="rating" class="${sort === 'rating' ? 'on' : ''}">Top rated</button>
          </div>
        </div>
        ${matches.length ? matches.map(m => `
          <div class="card match">
            <div>
              <h3>${esc(m.name)} <span class="stars">★ ${m.rating.toFixed(1)}</span></h3>
              <p class="small muted" style="margin-top:4px">${esc(m.package || m.description)}</p>
              <ul class="reasons">
                ${m.reasons.map(r => `<li>${esc(r)}</li>`).join('')}
              </ul>
              ${m.competing_requests ? `<div class="warn">${m.competing_requests} other event${m.competing_requests > 1 ? 's have' : ' has'} a pending request for this vendor at an overlapping time. Your request is not a confirmation until they accept.</div>` : ''}
            </div>
            <div>
              <div class="price">${inr(m.quote)}</div>
              <p class="tiny" style="text-align:right">${inr(m.price)} ${UNIT[m.price_unit]}</p>
              <button class="btn primary" style="margin-top:12px;width:100%" data-act="request" data-vendor="${m.vendor_id}">Request booking</button>
            </div>
          </div>`).join('')
        : `<div class="empty"><h3>No vendor meets every requirement</h3><p class="muted">See why each vendor was excluded below. You can adjust the budget, date or city and search again.</p></div>`}
        ${excluded.length ? `
          <details style="margin-top:18px">
            <summary style="cursor:pointer;font-weight:600;color:var(--text-secondary)">${excluded.length} vendor${excluded.length > 1 ? 's' : ''} not available for this event</summary>
            ${excluded.map(m => `
              <div class="card" style="margin-top:8px">
                <b>${esc(m.name)}</b>
                <ul class="reasons bad">${m.reasons.map(r => `<li>${esc(r)}</li>`).join('')}</ul>
              </div>`).join('')}
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
          <div class="stat-icon" style="background:rgba(16,185,129,0.15);border-color:rgba(16,185,129,0.3)">📅</div>
          <div>
            <div class="stat-num">${acceptedCount}</div>
            <div class="stat-lbl">Confirmed Bookings</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon" style="background:rgba(99,102,241,0.15);border-color:rgba(99,102,241,0.3)">⚡</div>
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
        </div>`
        : b.status === 'accepted' ? `
        <div class="row" style="margin-top:14px">
          <button class="btn danger" data-act="cancelbooking" data-id="${b.id}" data-ask="Cancel this confirmed booking? The organizer will be told to find a replacement." data-reason="1">Cancel booking</button>
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
          <div class="stat-icon" style="background:rgba(16,185,129,0.15);border-color:rgba(16,185,129,0.3)">📅</div>
          <div>
            <div class="stat-num">${acc.length}</div>
            <div class="stat-lbl">Confirmed Bookings</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon" style="background:rgba(99,102,241,0.15);border-color:rgba(99,102,241,0.3)">💎</div>
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
    if (!org && !r.startsWith('/vendor')) return go('/vendor/requests');
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