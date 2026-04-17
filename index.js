(function () {
  'use strict';

  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  function clamp(val, min, max) {
    return Math.min(Math.max(val, min), max);
  }

  function easeOut(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  function animateCounter(el, target, duration) {
    const start = performance.now();
    function step(now) {
      const elapsed = now - start;
      const progress = clamp(elapsed / duration, 0, 1);
      const value = Math.round(easeOut(progress) * target);
      el.textContent = value.toLocaleString('pt-BR');
      if (progress < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function initNavbarScroll() {
    const navbar = document.getElementById('navbar');
    if (!navbar) return;
    const onScroll = () => {
      navbar.classList.toggle('scrolled', window.scrollY > 20);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  function initMobileMenu() {
    const btn  = document.getElementById('btn-hamburger');
    const menu = document.getElementById('mobile-menu');
    if (!btn || !menu) return;

    let isOpen = false;

    function setOpen(open) {
      isOpen = open;
      btn.classList.toggle('open', open);
      menu.classList.toggle('active', open);
      btn.setAttribute('aria-expanded', String(open));
      menu.setAttribute('aria-hidden', String(!open));
      document.body.style.overflow = open ? 'hidden' : '';
    }

    btn.addEventListener('click', () => setOpen(!isOpen));

    menu.querySelectorAll('.mobile-link').forEach(link => {
      link.addEventListener('click', () => setOpen(false));
    });

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && isOpen) setOpen(false);
    });
  }

  function initScrollReveal() {
    const elements = document.querySelectorAll('.reveal');
    if (!elements.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
    );

    elements.forEach(el => observer.observe(el));
  }

  const startedCounters = new WeakSet();

  function startCounter(el) {
    if (startedCounters.has(el)) return;
    startedCounters.add(el);
    const target = parseInt(el.dataset.target, 10);
    if (isNaN(target)) return;
    animateCounter(el, target, 1400);
  }

  function initStatCounters() {
    const statItems = document.querySelectorAll('.stat-item');
    if (!statItems.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return;
          entry.target.querySelectorAll('.stat-num[data-target]').forEach(el => {
            startCounter(el);
          });
        });
      },
      { threshold: 0.3 }
    );

    statItems.forEach(item => observer.observe(item));
  }

  function initSmoothScroll() {
    document.querySelectorAll('a[href^="#"]').forEach(link => {
      link.addEventListener('click', e => {
        const id = link.getAttribute('href').slice(1);
        if (!id) return;
        const target = document.getElementById(id);
        if (!target) return;
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  }

  function initCardHoverGlow() {
    document.querySelectorAll('.feat-card').forEach(card => {
      card.addEventListener('mousemove', e => {
        const rect = card.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width)  * 100;
        const y = ((e.clientY - rect.top)  / rect.height) * 100;
        card.style.setProperty('--mx', `${x}%`);
        card.style.setProperty('--my', `${y}%`);
      });
    });
  }

  function initActiveNavLinks() {
    const sections = document.querySelectorAll('section[id]');
    const links    = document.querySelectorAll('.nav-link[href^="#"]');
    if (!sections.length || !links.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return;
          const id = entry.target.id;
          links.forEach(link => {
            link.style.color = link.getAttribute('href') === `#${id}` ? 'var(--text)' : '';
          });
        });
      },
      { threshold: 0.4 }
    );

    sections.forEach(s => observer.observe(s));
  }

  ready(function () {
    initNavbarScroll();
    initMobileMenu();
    initScrollReveal();
    initStatCounters();
    initSmoothScroll();
    initCardHoverGlow();
    initActiveNavLinks();

    // Revela elementos já visíveis no carregamento inicial
    document.querySelectorAll('.reveal').forEach(el => {
      const rect = el.getBoundingClientRect();
      if (rect.top < window.innerHeight * 0.92) {
        el.classList.add('visible');
      }
    });
  });

})();