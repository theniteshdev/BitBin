/* ─── Scroll Reveal ────────────────────────────────────────────────────────── */

function initScrollReveal() {
  const reveals = document.querySelectorAll('.reveal');

  if (!window.matchMedia('(prefers-reduced-motion: no-preference)').matches) {
    reveals.forEach(el => el.classList.add('visible'));
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.1, rootMargin: '0px 0px -40px 0px' }
  );

  reveals.forEach(el => observer.observe(el));
}

/* ─── Nav Scroll Effect ────────────────────────────────────────────────────── */

function initNavScroll() {
  const nav = document.getElementById('nav');
  let ticking = false;

  window.addEventListener('scroll', () => {
    if (!ticking) {
      window.requestAnimationFrame(() => {
        nav.classList.toggle('scrolled', window.scrollY > 20);
        ticking = false;
      });
      ticking = true;
    }
  });
}

/* ─── Hero Terminal Animation ──────────────────────────────────────────────── */

function initHeroTerminal() {
  const body = document.getElementById('hero-terminal-body');
  if (!body) return;

  const lines = [
    { text: 'bitbin init --secure', type: 'command' },
    { text: '✓ Initializing secure vault...', type: 'success', delay: 600 },
    { text: '✓ Generating AES-256 encryption key', type: 'success', delay: 400 },
    { text: '✓ Establishing secure connection', type: 'success', delay: 500 },
    { text: '', type: 'break', delay: 200 },
    { text: 'bitbin upload --encrypt document.pdf', type: 'command', delay: 800 },
    { text: 'Reading file: document.pdf (2.4 MB)', type: 'info', delay: 300 },
    { text: 'Encrypting with client-side AES-256...', type: 'info', delay: 600 },
    { text: 'Uploading encrypted blob...', type: 'info', delay: 400 },
    { text: '✓ File stored securely', type: 'success', delay: 500 },
    { text: '', type: 'break', delay: 200 },
    { text: 'bitbin status', type: 'command', delay: 600 },
    { text: 'Vault: Active | Files: 1 | Encryption: Enabled', type: 'warn', delay: 400 },
    { text: '', type: 'break', delay: 100 },
    { text: 'Ready.', type: 'success', delay: 200 },
  ];

  async function typeTerminal() {
    for (const line of lines) {
      if (line.type === 'break') {
        await delay(line.delay || 200);
        continue;
      }

      await delay(line.delay || 400);

      const lineEl = document.createElement('span');
      lineEl.className = `terminal-line terminal-${line.type}`;

      if (line.type === 'command') {
        lineEl.innerHTML = `<span class="prompt">$</span> `;
        body.appendChild(lineEl);

        for (const char of line.text) {
          lineEl.innerHTML += char;
          await delay(30 + Math.random() * 40);
          body.scrollTop = body.scrollHeight;
        }
      } else {
        lineEl.textContent = line.text;
        body.appendChild(lineEl);
        body.scrollTop = body.scrollHeight;
      }
    }

    // Restart after pause
    await delay(4000);
    body.innerHTML = '<span class="prompt">$</span> bitbin init --secure<span class="cursor"></span>';
    setTimeout(typeTerminal, 1000);
  }

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Start after a brief delay
  setTimeout(typeTerminal, 1500);
}

/* ─── Initialize ───────────────────────────────────────────────────────────── */

document.addEventListener('DOMContentLoaded', () => {
  initScrollReveal();
  initNavScroll();
  initHeroTerminal();
});
