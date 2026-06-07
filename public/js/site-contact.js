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
    const phoneDisplay = formatPhoneDisplay(settings.supportPhone);
    const phoneHref = normalizePhoneHref(settings.supportPhone);
    const whatsappHref = String(settings.whatsappGroupLink || DEFAULT_WHATSAPP_LINK).trim() || DEFAULT_WHATSAPP_LINK;

    document.querySelectorAll('a[href^="tel:"]').forEach((anchor) => {
      anchor.setAttribute('href', phoneHref);
      replaceTextNode(anchor, phoneDisplay);
    });

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

  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  async function loadTestimonials() {
    const container = document.getElementById('testimonialsContainer');
    if (!container) return;

    try {
      const response = await fetch(`${BASE_URL}/public/testimonials`);
      if (!response.ok) {
        return;
      }

      const testimonials = await response.json();
      if (!testimonials || testimonials.length === 0) {
        return;
      }

      container.innerHTML = testimonials.map((t, index) => {
        const isEven = index % 2 !== 0;
        const cardClass = isEven ? 'testimonial-new-card dark' : 'testimonial-new-card';
        const avatar = t.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(t.name)}&background=random`;
        const escapedAvatar = escapeHtml(avatar);
        
        return `
        <div class="${cardClass}">
          <div class="testimonial-left">
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
    } catch (error) {
      console.warn('Failed to load public testimonials:', error);
    }
  }
  async function loadSettings() {
    try {
      const response = await fetch(`${BASE_URL}/public/settings`);
      if (!response.ok) {
        return;
      }

      const settings = await response.json();
      applySettings(settings || {});
    } catch (error) {
      console.warn('Failed to load public contact settings:', error);
    }
  }

  function init() {
    loadSettings();
    loadTestimonials();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
