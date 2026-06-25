// API_BASE_URL should be loaded before this from config.js
const BASE_URL = typeof API_BASE_URL !== 'undefined' ? API_BASE_URL : '/backend/api';

async function parseResponseBody(response) {
    const contentType = response.headers.get('content-type') || '';
    const bodyText = await response.text();

    if (contentType.includes('application/json')) {
        try {
            return bodyText ? JSON.parse(bodyText) : null;
        } catch (error) {
            throw new Error(`Invalid JSON response from server: ${bodyText.slice(0, 160)}`);
        }
    }

    if (!bodyText) {
        return null;
    }

    try {
        return JSON.parse(bodyText);
    } catch (error) {
        throw new Error(`Expected JSON but received: ${bodyText.slice(0, 160)}`);
    }
}

const api = {
    async login(email, password) {
        const response = await fetch(`${BASE_URL}/auth/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ email, password })
        });
        
        const data = await parseResponseBody(response);
        if (response.ok) {
            localStorage.setItem('token', data.token);
            localStorage.setItem('role', data.role);
            localStorage.setItem('name', data.name);
            return { success: true, data };
        } else {
            return { success: false, message: data.message };
        }
    },

    async register(name, email, phone, password) {
        const response = await fetch(`${BASE_URL}/auth/register`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ name, email, phone, password })
        });
        
        const data = await parseResponseBody(response);
        if (response.ok) {
            return { success: true, message: data.message || 'Registration successful.' };
        } else {
            return { success: false, message: data.message || 'Registration failed.' };
        }
    },

    logout(redirectUrl = 'index.html') {
        localStorage.removeItem('token');
        localStorage.removeItem('role');
        localStorage.removeItem('name');
        window.location.replace(redirectUrl);
    },

    async get(endpoint) {
        const token = localStorage.getItem('token');
        const response = await fetch(`${BASE_URL}${endpoint}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        if (response.status === 401 || response.status === 403 || response.status === 503) {
            this.logout('login.html?maintenance=1');
            throw new Error('Unauthorized or Maintenance Mode');
        }
        return parseResponseBody(response);
    },

    async put(endpoint, payload) {
        const token = localStorage.getItem('token');
        const response = await fetch(`${BASE_URL}${endpoint}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(payload)
        });
        if (response.status === 401 || response.status === 403 || response.status === 503) {
            this.logout('login.html?maintenance=1');
            throw new Error('Unauthorized or Maintenance Mode');
        }
        return parseResponseBody(response);
    },

    async post(endpoint, payload) {
        const token = localStorage.getItem('token');
        const response = await fetch(`${BASE_URL}${endpoint}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(payload)
        });
        if (response.status === 401 || response.status === 403 || response.status === 503) {
            this.logout('login.html?maintenance=1');
            throw new Error('Unauthorized or Maintenance Mode');
        }
        return parseResponseBody(response);
    },

    async postMultipart(endpoint, formData) {
        const token = localStorage.getItem('token');
        const response = await fetch(`${BASE_URL}${endpoint}`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`
            },
            body: formData
        });
        if (response.status === 401 || response.status === 403 || response.status === 503) {
            this.logout('login.html?maintenance=1');
            throw new Error('Unauthorized or Maintenance Mode');
        }
        return parseResponseBody(response);
    },

    async delete(endpoint) {
        const token = localStorage.getItem('token');
        const response = await fetch(`${BASE_URL}${endpoint}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        if (response.status === 401 || response.status === 403 || response.status === 503) {
            this.logout('login.html?maintenance=1');
            throw new Error('Unauthorized or Maintenance Mode');
        }
        return parseResponseBody(response);
    }
};
