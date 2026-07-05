(function() {
  const DEFAULT_PHONE_DISPLAY = '+91 9750003600';
  const DEFAULT_PHONE_TEL = 'tel:+919750003600';
  const DEFAULT_WHATSAPP_LINK =
    'https://wa.me/919750003600?text=Hello,%20I%20would%20like%20to%20know%20more%20about%20Twinsure%20services.';
  const BASE_URL = window.API_BASE_URL || '/backend/api';

  function normalizePhoneHref(phone) {
    const value = String(phone || '').trim();
    if (!value) {
      return DEFAULT_PHONE_TEL;
    }

    if (value.startsWith('tel:')) {
      return value;
    }

    const plusDigits = value.replace(/[^\d+]/g, '');
    if (plusDigits.startsWith('+') && plusDigits.length > 1) {
      return `tel:${plusDigits}`;
    }

    const digits = value.replace(/\D/g, '');
    if (!digits) {
      return DEFAULT_PHONE_TEL;
    }

    if (digits.length === 10) {
      return `tel:+91${digits}`;
    }

    return `tel:+${digits}`;
  }

  function formatPhoneDisplay(phone) {
    const value = String(phone || '').trim();
    return value || DEFAULT_PHONE_DISPLAY;
  }

  function replaceTextNode(anchor, newText) {
    const walker = document.createTreeWalker(anchor, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();

    while (node) {
      if (node.nodeValue && node.nodeValue.trim()) {
        node.nodeValue = newText;
        return;
      }
      node = walker.nextNode();
    }

    anchor.textContent = newText;
  }

  function applySettings(settings) {
    if (!settings) return;

    if (settings.supportPhone) {
      const phoneDisplay = formatPhoneDisplay(settings.supportPhone);
      const phoneHref = normalizePhoneHref(settings.supportPhone);
      document.querySelectorAll('a[href^="tel:"]').forEach((anchor) => {
        anchor.setAttribute('href', phoneHref);
        replaceTextNode(anchor, phoneDisplay);
      });
    }

    if (settings.whatsappGroupLink) {
      const whatsappHref = String(settings.whatsappGroupLink).trim();
      document.querySelectorAll('a[href*="wa.me"], a[href*="whatsapp"]').forEach((anchor) => {
        anchor.setAttribute('href', whatsappHref);
        if (!anchor.target) {
          anchor.target = '_blank';
        }
        if (!anchor.rel) {
          anchor.rel = 'noopener noreferrer';
        }
      });
    }

    if (settings.supportEmail) {
      const emailDisplay = String(settings.supportEmail).trim();
      document.querySelectorAll('a[href^="mailto:"]').forEach((anchor) => {
        const href = anchor.getAttribute('href') || '';
        if (href.includes('support')) {
          anchor.setAttribute('href', `mailto:${emailDisplay}`);
          replaceTextNode(anchor, emailDisplay);
        }
      });
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  let testimonialIndex = 0;
  let testimonialTimer = null;
  let testimonialHoldTimer = null;
  const autoplayDelay = 5000;
  const holdDelay = 10000;

  function initTestimonialCarousel() {
    const container = document.getElementById('testimonialsContainer');
    if (!container) return;
    const cards = container.querySelectorAll('.testimonial-new-card');
    if (cards.length === 0) return;

    // Build dots
    const dotsContainer = document.getElementById('testimonialDots');
    if (dotsContainer) {
      dotsContainer.innerHTML = Array.from({ length: cards.length })
        .map((_, i) => `<div class="carousel-dot ${i === 0 ? 'active' : ''}" data-index="${i}"></div>`)
        .join('');

      dotsContainer.querySelectorAll('.carousel-dot').forEach(dot => {
        dot.addEventListener('click', (e) => {
          const idx = parseInt(e.target.getAttribute('data-index'), 10);
          testimonialIndex = idx;
          updateSlide();
          handleUserInteraction();
        });
      });
    }

    // Set buttons
    const prevBtn = document.getElementById('btnTestimonialPrev');
    const nextBtn = document.getElementById('btnTestimonialNext');
    if (prevBtn) {
      prevBtn.onclick = () => {
        slidePrev();
        handleUserInteraction();
      };
    }
    if (nextBtn) {
      nextBtn.onclick = () => {
        slideNext();
        handleUserInteraction();
      };
    }

    testimonialIndex = 0;
    updateSlide();
    startAutoplay();
  }

  function startAutoplay() {
    stopAutoplay();
    const container = document.getElementById('testimonialsContainer');
    if (!container) return;
    const cards = container.querySelectorAll('.testimonial-new-card');
    if (cards.length <= 1) return;

    testimonialTimer = setInterval(() => {
      slideNext();
    }, autoplayDelay);
  }

  function stopAutoplay() {
    if (testimonialTimer) {
      clearInterval(testimonialTimer);
      testimonialTimer = null;
    }
  }

  function handleUserInteraction() {
    stopAutoplay();
    if (testimonialHoldTimer) {
      clearTimeout(testimonialHoldTimer);
    }
    testimonialHoldTimer = setTimeout(() => {
      startAutoplay();
    }, holdDelay);
  }

  function slideNext() {
    const container = document.getElementById('testimonialsContainer');
    if (!container) return;
    const cards = container.querySelectorAll('.testimonial-new-card');
    if (cards.length <= 1) return;
    testimonialIndex = (testimonialIndex + 1) % cards.length;
    updateSlide();
  }

  function slidePrev() {
    const container = document.getElementById('testimonialsContainer');
    if (!container) return;
    const cards = container.querySelectorAll('.testimonial-new-card');
    if (cards.length <= 1) return;
    testimonialIndex = (testimonialIndex - 1 + cards.length) % cards.length;
    updateSlide();
  }

  function updateSlide() {
    const container = document.getElementById('testimonialsContainer');
    if (!container) return;
    const cards = container.querySelectorAll('.testimonial-new-card');
    cards.forEach((card, idx) => {
      if (idx === testimonialIndex) {
        card.style.display = 'flex';
        card.style.opacity = '0';
        // Fade in
        requestAnimationFrame(() => {
          card.style.transition = 'opacity 0.4s ease';
          card.style.opacity = '1';
        });
      } else {
        card.style.display = 'none';
        card.style.opacity = '0';
      }
    });

    const dots = document.querySelectorAll('.carousel-dot');
    dots.forEach((dot, idx) => {
      if (idx === testimonialIndex) {
        dot.classList.add('active');
      } else {
        dot.classList.remove('active');
      }
    });
  }

  async function loadTestimonials() {
    const container = document.getElementById('testimonialsContainer');
    if (!container) return;

    try {
      const response = await fetch(`${BASE_URL}/public/testimonials`);
      if (!response.ok) {
        const sec = document.getElementById('testimonialsSection');
        if (sec) sec.style.display = 'none';
        return;
      }

      const testimonials = await response.json();
      if (!testimonials || testimonials.length === 0) {
        const sec = document.getElementById('testimonialsSection');
        if (sec) sec.style.display = 'none';
        return;
      }

      container.innerHTML = testimonials.map((t, index) => {
        const isEven = index % 2 !== 0;
        const cardClass = isEven ? 'testimonial-new-card dark' : 'testimonial-new-card';
        
        let avatar = t.avatarUrl;
        if (avatar && avatar.includes('your-public-url.r2.dev')) {
          avatar = avatar.replace(/^https?:\/\/your-public-url\.r2\.dev/, '');
        }
        if (avatar && avatar.startsWith('/')) {
          const backendRoot = typeof window.BACKEND_ROOT !== "undefined" ? window.BACKEND_ROOT : "";
          avatar = `${backendRoot}${avatar}`;
        }
        if (!avatar) {
          avatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(t.name)}&background=random`;
        }
        const escapedAvatar = escapeHtml(avatar);
        const headingHtml = t.heading 
          ? `<div class="testimonial-main-heading">${escapeHtml(t.heading)}</div>` 
          : '';
        
        return `
        <div class="${cardClass}">
          <div class="testimonial-left">
            ${headingHtml}
            <div class="testimonial-avatar" style="background-image: url('${escapedAvatar}');"></div>
            <div class="testimonial-name">${escapeHtml(t.name)}</div>
            <div class="testimonial-type">${escapeHtml(t.from)}</div>
          </div>
          <div class="testimonial-right">
            <div class="testimonial-section">
              <div class="testimonial-heading">Before</div>
              <div class="testimonial-content">
                <p>${escapeHtml(t.before)}</p>
              </div>
            </div>
            <div class="testimonial-section">
              <div class="testimonial-heading">How Twins Consultancy Helped</div>
              <div class="testimonial-content">
                <p>${escapeHtml(t.helped)}</p>
              </div>
            </div>
            <div class="testimonial-section">
              <div class="testimonial-heading">Result</div>
              <div class="testimonial-content">
                <p>${escapeHtml(t.after)}</p>
              </div>
            </div>
          </div>
        </div>
        `;
      }).join('');

      initTestimonialCarousel();
    } catch (error) {
      console.warn('Failed to load public testimonials:', error);
      const sec = document.getElementById('testimonialsSection');
      if (sec) sec.style.display = 'none';
    }
  }

  let blogIndex = 0;
  let activeBlogsCount = 0;

  async function loadPublicBlogs() {
    const container = document.getElementById('blogsContainer');
    if (!container) return;

    try {
      const response = await fetch(`${BASE_URL}/public/blogs`);
      if (!response.ok) {
        const sec = document.getElementById('blogsSection');
        if (sec) sec.style.display = 'none';
        return;
      }

      const blogs = await response.json();
      if (!blogs || blogs.length === 0) {
        const sec = document.getElementById('blogsSection');
        if (sec) sec.style.display = 'none';
        return;
      }

      activeBlogsCount = blogs.length;

      container.innerHTML = blogs.map((b) => {
        const linkHtml = b.link 
          ? `<div class="blog-card-footer">
               <a href="${escapeHtml(b.link)}" target="_blank" rel="noopener noreferrer" class="blog-read-btn">
                 Read Full Article <i class="fas fa-arrow-right"></i>
               </a>
             </div>`
          : '';

          // Normalize cover URL (same logic as testimonial avatars)
          let coverUrl = b.coverUrl || '';
          if (coverUrl && coverUrl.includes('your-public-url.r2.dev')) {
            coverUrl = coverUrl.replace(/^https?:\/\/your-public-url\.r2\.dev/, '');
          }
          if (coverUrl && coverUrl.startsWith('/')) {
            const backendRoot = typeof window.BACKEND_ROOT !== 'undefined' ? window.BACKEND_ROOT : '';
            coverUrl = `${backendRoot}${coverUrl}`;
          }

          const coverStyle = coverUrl
            ? `style="position:relative; background-image:url('${coverUrl}'); background-size:cover; background-position:center;"`
            : '';
          const hasCover = !!coverUrl;

          return `
          <div class="blog-card${hasCover ? ' has-cover' : ''}" ${coverStyle}>
            ${hasCover ? '<div class="blog-card-cover-overlay"></div>' : ''}
            <div class="blog-card-accent"></div>
            <div class="blog-card-content${hasCover ? ' on-cover' : ''}">
              <div class="blog-card-meta">
                <span class="blog-card-author"><i class="fas fa-pen-nib"></i> ${escapeHtml(b.author)}</span>
                <span class="blog-card-tag"><i class="fas fa-bookmark"></i> Insights</span>
              </div>
              <div class="blog-card-header">
                <h3 class="blog-card-title">${escapeHtml(b.title)}</h3>
              </div>
              <div class="blog-card-divider"></div>
              <div class="blog-card-body">
                <p>${escapeHtml(b.content)}</p>
              </div>
              ${linkHtml}
            </div>
            <div class="blog-card-panel"${hasCover ? ` style="background-image:url('${coverUrl}'); background-size:cover; background-position:center;"` : ''}>
              ${hasCover ? '<div class="blog-panel-cover-blur"></div>' : ''}
              <div class="blog-panel-icon" style="z-index:2;"><i class="fas fa-newspaper"></i></div>
              <div class="blog-panel-label" style="z-index:2;">Twinsure<br>Insights</div>
            </div>
          </div>
        `;
        }).join('');

      initBlogCarousel();
    } catch (error) {
      console.warn('Failed to load public blogs:', error);
      const sec = document.getElementById('blogsSection');
      if (sec) sec.style.display = 'none';
    }
  }

  function initBlogCarousel() {
    const dotsContainer = document.getElementById('blogDots');
    if (dotsContainer && activeBlogsCount > 1) {
      dotsContainer.innerHTML = Array.from({ length: activeBlogsCount })
        .map((_, i) => `<div class="blog-dot ${i === 0 ? 'active' : ''}" data-index="${i}"></div>`)
        .join('');

      dotsContainer.querySelectorAll('.blog-dot').forEach(dot => {
        dot.addEventListener('click', (e) => {
          const idx = parseInt(e.target.getAttribute('data-index'), 10);
          blogIndex = idx;
          updateBlogSlide();
        });
      });
    }

    const prevBtn = document.getElementById('btnBlogPrev');
    const nextBtn = document.getElementById('btnBlogNext');
    if (prevBtn) {
      prevBtn.onclick = () => {
        slideBlogPrev();
      };
    }
    if (nextBtn) {
      nextBtn.onclick = () => {
        slideBlogNext();
      };
    }

    blogIndex = 0;
    updateBlogSlide();
  }

  function updateBlogSlide() {
    const container = document.getElementById('blogsContainer');
    if (!container) return;
    const cards = container.querySelectorAll('.blog-card');
    cards.forEach((card, idx) => {
      if (idx === blogIndex) {
        card.style.display = 'flex';
        // Double RAF ensures browser has repainted display:flex before opacity transition
        requestAnimationFrame(() => requestAnimationFrame(() => {
          card.style.opacity = '1';
        }));
      } else {
        card.style.opacity = '0';
        // Small delay before hiding to allow fade-out if needed
        setTimeout(() => { if (card.style.opacity === '0') card.style.display = 'none'; }, 50);
      }
    });

    const dots = document.querySelectorAll('.blog-dot');
    dots.forEach((dot, idx) => {
      if (idx === blogIndex) {
        dot.classList.add('active');
      } else {
        dot.classList.remove('active');
      }
    });
  }

  function slideBlogNext() {
    if (activeBlogsCount <= 1) return;
    blogIndex = (blogIndex + 1) % activeBlogsCount;
    updateBlogSlide();
  }

  function slideBlogPrev() {
    if (activeBlogsCount <= 1) return;
    blogIndex = (blogIndex - 1 + activeBlogsCount) % activeBlogsCount;
    updateBlogSlide();
  }

  async function loadSettings() {
    try {
      const response = await fetch(`${BASE_URL}/public/settings`);
      if (!response.ok) {
        return;
      }

      const settings = await response.json();
      window.contactSettings = settings || {};
      applySettings(settings || {});
    } catch (error) {
      console.warn('Failed to load public contact settings:', error);
    }
  }

  function init() {
    window.applySettings = applySettings;
    loadSettings();
    loadTestimonials();
    loadPublicBlogs();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
