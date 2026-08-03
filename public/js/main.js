/* =========================================
   NAVBAR — scroll effect + active link
   ========================================= */
const navbar  = document.getElementById('navbar');
const sections = document.querySelectorAll('section[id]');
const navLinks = document.querySelectorAll('.nav-link');

function onScroll() {
  // Scrolled style
  navbar.classList.toggle('scrolled', window.scrollY > 20);

  // Active nav link
  const scrollY = window.scrollY + parseInt(getComputedStyle(document.documentElement).getPropertyValue('--nav-height')) + 40;
  sections.forEach(section => {
    if (scrollY >= section.offsetTop && scrollY < section.offsetTop + section.offsetHeight) {
      navLinks.forEach(link => {
        link.classList.toggle('active', link.getAttribute('href') === '#' + section.id);
      });
    }
  });
}

window.addEventListener('scroll', onScroll, { passive: true });
onScroll(); // run once on load

/* =========================================
   MOBILE MENU
   ========================================= */
const hamburger  = document.querySelector('.hamburger');
const mobileMenu = document.getElementById('mobileMenu');

hamburger.addEventListener('click', () => {
  const open = hamburger.classList.toggle('open');
  mobileMenu.classList.toggle('open', open);
  mobileMenu.setAttribute('aria-hidden', String(!open));
  hamburger.setAttribute('aria-expanded', String(open));
  document.body.style.overflow = open ? 'hidden' : '';
});

// Close on any mobile link click
mobileMenu.querySelectorAll('a').forEach(link => {
  link.addEventListener('click', () => {
    hamburger.classList.remove('open');
    mobileMenu.classList.remove('open');
    mobileMenu.setAttribute('aria-hidden', 'true');
    hamburger.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
  });
});

/* =========================================
   SMOOTH SCROLL (fallback for older Safari)
   ========================================= */
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', e => {
    const href = anchor.getAttribute('href');
    if (href === '#') return;
    const target = document.querySelector(href);
    if (!target) return;
    e.preventDefault();
    const navH = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--nav-height'));
    window.scrollTo({ top: target.offsetTop - navH, behavior: 'smooth' });
  });
});

/* =========================================
   SCROLL ANIMATIONS (Intersection Observer)
   ========================================= */
const animEls = document.querySelectorAll('.fade-in, .fade-in-left, .fade-in-right');

const observer = new IntersectionObserver(
  entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.1, rootMargin: '0px 0px -30px 0px' }
);

animEls.forEach(el => observer.observe(el));

/* =========================================
   FORMS (contatti + prenotazione)
   ========================================= */
function showMsg(el, text, type) {
  el.textContent = text;
  el.className = 'form-message ' + type;
  el.hidden = false;
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  setTimeout(() => { el.hidden = true; }, 7000);
}

function bindForm(form, url, msgEl, successText) {
  if (!form) return;

  form.addEventListener('submit', async e => {
    e.preventDefault();

    const required = form.querySelectorAll('[required]');
    let valid = true;
    required.forEach(field => {
      const invalid = field.type === 'checkbox' ? !field.checked : !field.value.trim();
      field.style.borderColor = invalid ? '#ef4444' : '';
      if (invalid) valid = false;
    });

    if (!valid) {
      showMsg(msgEl, 'Compila tutti i campi obbligatori (*).', 'error');
      return;
    }

    const emailField = form.querySelector('input[type="email"]');
    if (emailField && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailField.value)) {
      emailField.style.borderColor = '#ef4444';
      showMsg(msgEl, 'Inserisci un indirizzo email valido.', 'error');
      return;
    }

    const btn = form.querySelector('button[type="submit"]');
    const originalText = btn.textContent;
    btn.textContent = 'Invio in corso…';
    btn.disabled = true;

    try {
      const data = Object.fromEntries(new FormData(form).entries());
      // Una checkbox spedisce la stringa "on"; il server pretende un booleano.
      data.privacy = form.querySelector('[name="privacy"]').checked;

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      if (response.ok) {
        showMsg(msgEl, successText, 'success');
        form.reset();
        required.forEach(f => (f.style.borderColor = ''));
      } else {
        const err = await response.json().catch(() => ({}));
        showMsg(msgEl, err.error || 'Errore nell\'invio. Riprova o contattami direttamente.', 'error');
      }
    } catch {
      showMsg(msgEl, 'Errore di rete. Controlla la connessione e riprova.', 'error');
    } finally {
      btn.textContent = originalText;
      btn.disabled = false;
    }
  });

  form.querySelectorAll('input, select, textarea').forEach(field => {
    field.addEventListener('input', () => { field.style.borderColor = ''; });
  });
}

bindForm(
  document.getElementById('contactForm'),
  '/api/contact',
  document.getElementById('formMessage'),
  'Messaggio inviato! Ti risponderò al più presto.',
);

// Form di prenotazione disattivato: il markup è commentato in index.html.
// bindForm(
//   document.getElementById('bookingForm'),
//   '/api/book',
//   document.getElementById('bookingMessage'),
//   'Richiesta inviata! Ti confermo data e ora entro 24h.',
// );
