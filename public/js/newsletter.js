/**
 * TwinSure Newsletter Subscription Handler
 */
async function handleNewsletterSubmit(event, formElement) {
    if (event) {
        event.preventDefault();
    }
    
    if (!formElement) {
        formElement = event ? event.target : null;
    }
    if (!formElement) return;

    const input = formElement.querySelector('input[type="email"]');
    const btn = formElement.querySelector('button[type="submit"]');
    const msgDiv = formElement.querySelector('.newsletter-msg');
    
    // Prevent double-submission/loading lock
    if (btn && (btn.disabled || btn.getAttribute('data-submitting') === 'true')) {
        return;
    }

    const email = input ? input.value.trim() : '';

    if (!email) {
        if (msgDiv) {
            msgDiv.style.color = '#f87171';
            msgDiv.textContent = 'Please enter a valid email address.';
        }
        return;
    }

    // Capture the true original button content
    const originalBtnContent = btn ? btn.innerHTML : 'Subscribe';
    
    if (btn) {
        btn.disabled = true;
        btn.setAttribute('data-submitting', 'true');
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Subscribing...';
    }

    if (msgDiv) {
        msgDiv.style.color = '#94a3b8';
        msgDiv.textContent = 'Subscribing...';
    }

    const apiBase = typeof window.API_BASE_URL !== 'undefined' ? window.API_BASE_URL : '/backend/api';

    try {
        const response = await fetch(`${apiBase}/newsletter/subscribe`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ email })
        });

        const contentType = response.headers.get('content-type') || '';
        let data = {};
        if (contentType.includes('application/json')) {
            data = await response.json();
        } else {
            const text = await response.text();
            data = { message: text };
        }

        if (response.ok && data.success !== false) {
            if (msgDiv) {
                msgDiv.style.color = '#4ade80';
                msgDiv.textContent = data.message || 'Thank you for subscribing to our newsletter!';
            }
            formElement.reset();
        } else {
            if (msgDiv) {
                msgDiv.style.color = '#f87171';
                msgDiv.textContent = data.message || 'Failed to subscribe. Please try again.';
            }
        }
    } catch (err) {
        console.error('Newsletter error:', err);
        if (msgDiv) {
            msgDiv.style.color = '#f87171';
            msgDiv.textContent = 'Network error. Please try again later.';
        }
    } finally {
        if (btn) {
            btn.removeAttribute('data-submitting');
            btn.disabled = false;
            btn.innerHTML = originalBtnContent;
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const forms = document.querySelectorAll('.newsletter-form, [data-newsletter-form]');
    forms.forEach(form => {
        // Only bind programmatically if there is no inline onsubmit attribute
        if (!form.getAttribute('onsubmit')) {
            form.addEventListener('submit', (e) => handleNewsletterSubmit(e, form));
        }
    });
});
