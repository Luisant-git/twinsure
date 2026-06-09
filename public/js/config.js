const isDev = window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost'; 
window.API_BASE_URL = isDev ? 'http://127.0.0.1:8000' : '/backend/api'; 
