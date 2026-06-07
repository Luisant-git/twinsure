// Twinsure Client Configuration
var API_BASE_URL = (function() {
    var isLocal = window.location.port === '3000' || 
                  window.location.hostname === 'localhost' || 
                  window.location.hostname === '127.0.0.1';
    return isLocal ? (window.location.protocol + '//' + window.location.hostname + ':8000') : '/backend/api';
})();
window.API_BASE_URL = API_BASE_URL;
