// public/js/preview-engine.js
class PreviewEngine {
    constructor() {
        this.nodes = [];
        this.edges = [];
        this.history = []; // array of node ids
        this.selectedOptions = {}; // nodeId -> { text, branchText }
        this.currentNodeId = null;
        this.greetingText = "Welcome! Let's help you find the best insurance plan for your needs.";
        this.undoStack = [];
        this.pendingTimers = new Set();
        
        this.loadFlow();
        this.initEvents();
    }
    
    initEvents() {
        document.getElementById('restartFlowBtn').addEventListener('click', () => this.startFlow());
        document.getElementById('prevQuestionBtn').addEventListener('click', () => this.goBack());
        document.getElementById('undoLastChangeBtn')?.addEventListener('click', () => this.undoLastChange());
        const pubBtn = document.getElementById('publishFlowBtn');
        if(pubBtn) pubBtn.addEventListener('click', () => this.publishFlow());

        window.addEventListener('keydown', (e) => {
            const isUndoShortcut = (e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z');
            if (!isUndoShortcut) return;
            e.preventDefault();
            this.undoLastChange();
        }, true);

        const chatArea = document.getElementById('chatMessagesArea');
        chatArea?.addEventListener('beforeinput', (e) => {
            const target = e.target;
            if (!target || !target.matches) return;
            if (target.matches('input, textarea, select')) {
                this.captureUndoState();
            }
        }, true);
        chatArea?.addEventListener('pointerdown', (e) => {
            const target = e.target;
            if (!target || !target.matches) return;
            if (target.matches('select')) {
                this.captureUndoState();
            }
        }, true);
        chatArea?.addEventListener('keydown', (e) => {
            const target = e.target;
            if (!target || !target.matches || !target.matches('select')) return;
            if (['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', 'Enter', ' '].includes(e.key)) {
                this.captureUndoState();
            }
        }, true);
    }

    captureUndoState() {
        const chatArea = document.getElementById('chatMessagesArea');
        if (!chatArea) return;

        const snapshot = {
            history: [...this.history],
            selectedOptions: JSON.parse(JSON.stringify(this.selectedOptions || {})),
            currentNodeId: this.currentNodeId,
            chatHTML: chatArea.innerHTML,
            scrollTop: chatArea.scrollTop,
            fieldState: {}
        };

        chatArea.querySelectorAll('[id]').forEach((el) => {
            snapshot.fieldState[el.id] = {
                className: el.className,
                style: el.getAttribute('style') || '',
                value: 'value' in el ? el.value : undefined,
                checked: 'checked' in el ? el.checked : undefined,
                disabled: 'disabled' in el ? el.disabled : undefined,
                textContent: el.tagName === 'BUTTON' && el.id.startsWith('ampm_') ? el.textContent : undefined
            };
        });

        const last = this.undoStack[this.undoStack.length - 1];
        if (last && JSON.stringify(last) === JSON.stringify(snapshot)) return;

        this.undoStack.push(snapshot);
        this.updateUndoButton();
    }

    updateUndoButton() {
        const btn = document.getElementById('undoLastChangeBtn');
        if (!btn) return;
        btn.disabled = this.undoStack.length === 0;
    }

    clearPendingTimers() {
        this.pendingTimers.forEach((timerId) => clearTimeout(timerId));
        this.pendingTimers.clear();
    }

    restoreSnapshot(snapshot) {
        if (!snapshot) return;

        this.clearPendingTimers();

        this.history = [...snapshot.history];
        this.selectedOptions = JSON.parse(JSON.stringify(snapshot.selectedOptions || {}));
        this.currentNodeId = snapshot.currentNodeId;

        const chatArea = document.getElementById('chatMessagesArea');
        if (chatArea) {
            chatArea.innerHTML = snapshot.chatHTML || '';
            Object.entries(snapshot.fieldState || {}).forEach(([id, state]) => {
                const el = document.getElementById(id);
                if (!el) return;
                el.className = state.className || el.className;
                if (state.style !== undefined) el.setAttribute('style', state.style);
                if ('value' in state && state.value !== undefined && 'value' in el) el.value = state.value;
                if ('checked' in state && state.checked !== undefined && 'checked' in el) el.checked = state.checked;
                if ('disabled' in state && state.disabled !== undefined && 'disabled' in el) el.disabled = state.disabled;
                if (state.textContent !== undefined) el.textContent = state.textContent;
            });
            chatArea.scrollTop = snapshot.scrollTop || 0;
        }

        this.updateAnalytics();
        this.updateUndoButton();
    }

    undoLastChange() {
        if (!this.undoStack.length) return;
        const snapshot = this.undoStack.pop();
        this.restoreSnapshot(snapshot);
    }

    async publishFlow() {
        const btn = document.getElementById('publishFlowBtn');
        const originalText = btn.innerText;
        btn.innerText = 'Publishing...';
        btn.disabled = true;
        
        try {
            const draft = localStorage.getItem('draft_flow');
            if(draft) {
                const data = JSON.parse(draft);
                await api.post('/admin/recommendations', data);
                btn.innerText = 'Published!';
                setTimeout(() => {
                    btn.innerText = originalText;
                    btn.disabled = false;
                }, 2000);
            }
        } catch(e) {
            console.error(e);
            alert('Failed to publish flow. Check console.');
            btn.innerText = originalText;
            btn.disabled = false;
        }
    }

    async loadFlow() {
        try {
            const draft = localStorage.getItem('draft_flow');
            if(draft) {
                const data = JSON.parse(draft);
                this.nodes = data.nodes || [];
                this.edges = data.edges || [];
                if(data.greeting) this.greetingText = data.greeting;
                this.undoStack = [];
                this.startFlow();
            } else {
                this.renderBotMessage("No draft flow found. Go back to builder and click Preview Flow.");
            }
        } catch(e) {
            console.error('Failed to load draft', e);
        }
    }
    
    startFlow() {
        this.clearPendingTimers();
        this.history = [];
        this.selectedOptions = {};
        this.undoStack = [];
        document.getElementById('chatMessagesArea').innerHTML = '';
        
        // 1. Render greeting
        this.renderBotMessage(this.greetingText);
        
        // Find first node connected to greeting
        const firstEdge = this.edges.find(e => e.fromNode === 'greeting');
        if(firstEdge) {
            this.currentNodeId = firstEdge.toNode;
            this.history.push(this.currentNodeId);
            this.renderCurrentNode();
        } else if(this.nodes.length > 0) {
            // Fallback to node_1 or first node
            this.currentNodeId = this.nodes[0].id;
            this.history.push(this.currentNodeId);
            this.renderCurrentNode();
        } else {
            this.renderBotMessage("No flow has been configured yet.");
        }
        this.updateAnalytics();
    }
    
    goBack() {
        if(this.history.length <= 1) return;
        
        // Remove current node from history
        const removedNodeId = this.history.pop();
        delete this.selectedOptions[removedNodeId];
        
        // Get previous node
        this.currentNodeId = this.history[this.history.length - 1];
        
        // Re-render chat
        this.rebuildChatFromHistory();
    }

    rebuildChatFromHistory() {
        document.getElementById('chatMessagesArea').innerHTML = '';
        this.renderBotMessage(this.greetingText);
        
        for(let i=0; i<this.history.length; i++) {
            const nId = this.history[i];
            const node = this.nodes.find(n => n.id === nId);
            if(!node) continue;
            
            this.renderBotMessage(node.text);
            
            // If it's the last node, render options. Otherwise render the user's choice.
            if(i === this.history.length - 1) {
                this.renderOptions(node);
            } else {
                const choice = this.selectedOptions[nId];
                if(choice) this.renderUserMessage(choice.text);
            }
        }
        this.updateAnalytics();
    }
    
    renderCurrentNode() {
        const node = this.nodes.find(n => n.id === this.currentNodeId);
        if(!node) return;
        
        const typingId = this.showTypingIndicator();
        const timerId = setTimeout(() => {
            this.pendingTimers.delete(timerId);
            this.removeTypingIndicator(typingId);
            this.renderBotMessage(node.text);
            this.renderOptions(node);
            this.updateAnalytics();
        }, 600);
        this.pendingTimers.add(timerId);
    }
    
    renderBotMessage(text) {
        const area = document.getElementById('chatMessagesArea');
        const html = `
            <div class="chat-row bot-row">
                <div class="chat-bot-icon"><i class="fas fa-robot"></i></div>
                <div class="chat-bubble bot-bubble">${text}</div>
            </div>
        `;
        area.insertAdjacentHTML('beforeend', html);
        this.scrollToBottom();
    }
    
    renderUserMessage(text) {
        const area = document.getElementById('chatMessagesArea');
        const html = `
            <div class="chat-row user-row">
                <div class="chat-bubble user-bubble">${text}</div>
            </div>
        `;
        area.insertAdjacentHTML('beforeend', html);
        this.scrollToBottom();
    }
    
    renderOptions(node) {
        ChatInputs.render(node, this, 'previewEngine');
    }
    
    selectOption(nodeId, optionId, optionText, branchTitle) {
        if(!optionText) return;
        this.captureUndoState();
        
        // Disable existing options
        const container = document.getElementById(`opts_${nodeId}`);
        if(container) container.style.pointerEvents = 'none';
        
        this.renderUserMessage(optionText);
        this.selectedOptions[nodeId] = { text: optionText, branch: branchTitle };
        
        // Find next node
        const nextEdge = this.edges.find(e => e.fromNode === nodeId && e.fromOption === optionId);
        if(nextEdge) {
            this.currentNodeId = nextEdge.toNode;
            this.history.push(this.currentNodeId);
            this.renderCurrentNode();
        } else {
            const typingId = this.showTypingIndicator();
            const timerId = setTimeout(() => {
                this.pendingTimers.delete(timerId);
                this.removeTypingIndicator(typingId);
                this.renderBotMessage("Thank you! That's all the information we need. We are generating your recommendation.");
                this.updateAnalytics();
            }, 600);
            this.pendingTimers.add(timerId);
        }
        this.updateAnalytics();
    }
    
    showTypingIndicator() {
        const id = 'typing_' + Date.now();
        const area = document.getElementById('chatMessagesArea');
        const html = `
            <div class="chat-row bot-row" id="${id}">
                <div class="chat-bot-icon"><i class="fas fa-robot"></i></div>
                <div class="chat-bubble bot-bubble typing-indicator">
                    <div class="typing-dot"></div>
                    <div class="typing-dot"></div>
                    <div class="typing-dot"></div>
                </div>
            </div>
        `;
        area.insertAdjacentHTML('beforeend', html);
        this.scrollToBottom();
        return id;
    }
    
    removeTypingIndicator(id) {
        const el = document.getElementById(id);
        if(el) el.remove();
    }
    
    scrollToBottom() {
        const area = document.getElementById('chatMessagesArea');
        area.scrollTop = area.scrollHeight;
    }
    
    updateAnalytics() {
        document.getElementById('analyticsCompleted').innerText = Math.max(0, this.history.length - 1);
        document.getElementById('analyticsCurrentId').innerText = '#' + (this.currentNodeId || 'END');
        
        // Build Branch Path
        const branchParts = [];
        const answersList = [];
        
        this.history.forEach(nId => {
            const opt = this.selectedOptions[nId];
            if(opt) {
                branchParts.push(opt.branch || opt.text);
                answersList.push(`${opt.branch ? opt.branch + ' > ' : ''}${opt.text}`);
            }
        });
        
        if(branchParts.length === 0) {
            document.getElementById('analyticsBranch').innerText = 'Start';
        } else {
            document.getElementById('analyticsBranch').innerText = branchParts.join(' > ');
        }
        
        if(answersList.length === 0) {
            document.getElementById('analyticsAnswers').innerHTML = '<em>None</em>';
        } else {
            document.getElementById('analyticsAnswers').innerHTML = answersList.join('<br>');
        }
        
        document.getElementById('flowProgressText').innerText = `Question ${this.history.length} of ${this.nodes.length}`;
        const pct = this.nodes.length > 0 ? (this.history.length / this.nodes.length) * 100 : 0;
        document.getElementById('flowProgressFill').style.width = Math.min(100, pct) + '%';
        
        document.getElementById('prevQuestionBtn').disabled = this.history.length <= 1;
    }
}
