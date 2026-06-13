#!/usr/bin/env bash

# Bash script to start Twinsure backend and frontend servers on Linux/macOS
# The backend now runs on Node.js and serves the legacy PHP routes.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

echo "Reading .env configuration..."
ENV_FILE="backend/.env"

if [ ! -f "$ENV_FILE" ]; then
    echo -e "\033[0;31mError: .env file not found at $ENV_FILE\033[0m"
    exit 1
fi

while IFS='=' read -r key val || [ -n "$key" ]; do
    key=$(echo "$key" | xargs 2>/dev/null || echo "$key" | tr -d '[:space:]')
    if [[ -z "$key" || "$key" =~ ^# ]]; then
        continue
    fi
    val=$(echo "$val" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')
    val="${val#\"}"
    val="${val%\"}"
    val="${val#\'}"
    val="${val%\'}"
    export "$key"="$val"
done < "$ENV_FILE"

: "${HOST:=127.0.0.1}"
: "${BACKEND_PORT:=8000}"
: "${FRONTEND_PORT:=3000}"
: "${API_BASE_URL:=http://$HOST:$BACKEND_PORT/backend/api}"

if ! command -v node &> /dev/null; then
    echo -e "\033[0;31mError: node command not found. Please install Node.js first.\033[0m"
    exit 1
fi

echo "Generating frontend config.js..."
mkdir -p "public/js"
cat << EOF > public/js/config.js
// Twinsure Client Configuration
var API_BASE_URL = (function() {
    var isLocal = window.location.port === '$FRONTEND_PORT' || 
                  window.location.hostname === 'localhost' || 
                  window.location.hostname === '127.0.0.1';
    return isLocal ? (window.location.protocol + '//' + window.location.hostname + ':$BACKEND_PORT/backend/api') : '/backend/api';
})();
window.API_BASE_URL = API_BASE_URL;
window.BACKEND_ROOT = window.API_BASE_URL.replace(/\/backend\/api\/?$/, "");
EOF

echo -e "\033[0;34m========================================================\033[0m"
echo -e "\033[1;32mStarting Twinsure Services...\033[0m"
echo -e "Backend API : \033[4;36mhttp://$HOST:$BACKEND_PORT\033[0m"
echo -e "Frontend UI : \033[4;36mhttp://$HOST:$BACKEND_PORT\033[0m"
echo -e "Database    : \033[1;33m${MONGODB_DATABASE:-N/A}\033[0m"
echo -e "\033[0;34m========================================================\033[0m"
echo ""

BACKEND_PID=""

cleanup() {
    echo ""
    echo -e "\033[1;31mStopping TwinSure servers...\033[0m"

    if [ -n "$BACKEND_PID" ]; then
        if kill -0 "$BACKEND_PID" 2>/dev/null; then
            kill "$BACKEND_PID"
            echo "Stopped Backend Server (PID $BACKEND_PID)"
        fi
    fi

    echo -e "\033[1;32mServers stopped successfully.\033[0m"
    exit 0
}

trap cleanup SIGINT SIGTERM

echo "Starting Backend Server..."
(cd "$ROOT_DIR" && exec node src/server.js) &
BACKEND_PID=$!

echo ""
echo -e "\033[1;35mTwinSure servers are running in the background.\033[0m"
echo -e "\033[1;33mPress [Ctrl+C] to stop the backend server.\033[0m"
echo ""

wait
