// public/js/recommendation-builder.js
class AdvancedBuilder {
    constructor() {
        this.canvasContainer = document.getElementById('canvasContainer');
        this.canvasContent = document.getElementById('canvasContent');
        this.svg = document.getElementById('connectionSvg');
        
        this.nodes = [];
        this.edges = [];
        this.selectedNodeId = null;
        
        this.draggingNode = null;
        this.dragOffset = { x: 0, y: 0 };
        
        this.drawingEdge = false;
        this.edgeStart = null; // { nodeId, optionId, element }

        this.colors = ['purple', 'blue', 'orange', 'red', 'teal', 'green', 'pink', 'yellow', 'indigo', 'cyan'];
        this.scale = 1;
        this.undoStack = [];
        
        this.initEvents();
        this.loadFlow();
    }

    initEvents() {
        // Dragging nodes & drawing edges
        this.canvasContainer.addEventListener('mousemove', (e) => this.onMouseMove(e));
        window.addEventListener('mouseup', () => this.onMouseUp());
        window.addEventListener('keydown', (e) => {
            const isUndoShortcut = (e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z');
            if (!isUndoShortcut) return;

            const active = document.activeElement;
            if (active && (active.matches('input, textarea, select') || active.isContentEditable)) {
                return;
            }

            e.preventDefault();
            this.undoLastChange();
        }, true);
        
        // Buttons
        document.getElementById('undoBuilderChangeBtn')?.addEventListener('click', () => this.undoLastChange());
        document.getElementById('addQuestionBtn').addEventListener('click', () => { this.isDirty = true; this.addNode(); });
        document.getElementById('closeSidebar').addEventListener('click', () => this.selectNode(null));
        document.getElementById('previewFlowBtn').addEventListener('click', () => {
            this.saveDraft();
            window.open('recommendation.html?mode=preview', '_blank');
        });

        // Warn before closing
        window.addEventListener('beforeunload', (e) => {
            if(this.isDirty) {
                e.preventDefault();
                e.returnValue = '';
            }
        });
        
        // Sidebar inputs
        document.getElementById('greetingInput').addEventListener('beforeinput', () => this.captureUndoState());
        document.getElementById('propQuestionTitle').addEventListener('input', (e) => this.updateSelectedNode('title', e.target.value));
        document.getElementById('propQuestionText').addEventListener('input', (e) => this.updateSelectedNode('text', e.target.value));
        document.getElementById('propQuestionType').addEventListener('change', (e) => this.updateSelectedNode('type', e.target.value));
        document.getElementById('propAddOptionBtn').addEventListener('click', () => this.addOptionToSelected());
        document.getElementById('propRequired').addEventListener('click', (e) => {
            const isActive = e.target.classList.toggle('active');
            this.updateSelectedNode('required', isActive);
        });

        // Zoom controls
        document.getElementById('zoomInBtn').addEventListener('click', () => this.setZoom(this.scale + 0.02));
        document.getElementById('zoomOutBtn').addEventListener('click', () => this.setZoom(this.scale - 0.02));
        
        this.canvasContainer.addEventListener('wheel', (e) => {
            if(e.ctrlKey) {
                e.preventDefault();
                const delta = e.deltaY > 0 ? -0.02 : 0.02;
                const rect = this.canvasContainer.getBoundingClientRect();
                this.setZoom(this.scale + delta, e.clientX - rect.left, e.clientY - rect.top);
            }
        });

        // Pan canvas
        let isPanning = false;
        let startPan = {x:0, y:0};
        let scrollStart = {x:0, y:0};
        
        this.canvasContainer.addEventListener('mousedown', (e) => {
            if(e.button === 1 || e.target === this.canvasContainer || e.target === this.svg || e.target === this.canvasContent) {
                isPanning = true;
                startPan = { x: e.clientX, y: e.clientY };
                scrollStart = { x: this.canvasContainer.scrollLeft, y: this.canvasContainer.scrollTop };
                this.canvasContainer.style.cursor = 'grabbing';
            }
        });
        
        window.addEventListener('mousemove', (e) => {
            if(isPanning) {
                const dx = e.clientX - startPan.x;
                const dy = e.clientY - startPan.y;
                this.canvasContainer.scrollLeft = scrollStart.x - dx;
                this.canvasContainer.scrollTop = scrollStart.y - dy;
            }
        });
        
        window.addEventListener('mouseup', () => {
            isPanning = false;
            this.canvasContainer.style.cursor = 'grab';
        });
    }

    captureUndoState() {
        const snapshot = {
            nodes: JSON.parse(JSON.stringify(this.nodes)),
            edges: JSON.parse(JSON.stringify(this.edges)),
            selectedNodeId: this.selectedNodeId,
            greeting: document.getElementById('greetingInput')?.value || '',
            scale: this.scale,
            scrollLeft: this.canvasContainer.scrollLeft,
            scrollTop: this.canvasContainer.scrollTop
        };

        const last = this.undoStack[this.undoStack.length - 1];
        if (last && JSON.stringify(last) === JSON.stringify(snapshot)) return;

        this.undoStack.push(snapshot);
        this.updateUndoButton();
    }

    updateUndoButton() {
        const button = document.getElementById('undoBuilderChangeBtn');
        if (button) button.disabled = this.undoStack.length === 0;
    }

    undoLastChange() {
        if (!this.undoStack.length) return;

        const snapshot = this.undoStack.pop();
        this.nodes = JSON.parse(JSON.stringify(snapshot.nodes || []));
        this.edges = JSON.parse(JSON.stringify(snapshot.edges || []));
        this.selectedNodeId = snapshot.selectedNodeId || null;
        this.scale = snapshot.scale || 1;

        const greetingInput = document.getElementById('greetingInput');
        if (greetingInput) greetingInput.value = snapshot.greeting || '';

        this.canvasContent.style.transform = `scale(${this.scale})`;
        this.updateCanvasSize();
        this.renderAll();

        this.canvasContainer.scrollLeft = snapshot.scrollLeft || 0;
        this.canvasContainer.scrollTop = snapshot.scrollTop || 0;
        this.selectNode(this.selectedNodeId);
        this.isDirty = true;
        this.updateUndoButton();
    }

    setZoom(newScale, mouseX = null, mouseY = null) {
        newScale = Math.max(0.3, Math.min(newScale, 2)); // Clamp between 30% and 200%
        const oldScale = this.scale;
        this.scale = newScale;
        
        this.canvasContent.style.transform = `scale(${this.scale})`;
        document.getElementById('zoomLevelIndicator').innerText = Math.round(this.scale * 100) + '%';
        
        this.updateCanvasSize();
        
        // Zoom to cursor logic
        if(mouseX !== null && mouseY !== null) {
            const logicalX = (mouseX + this.canvasContainer.scrollLeft) / oldScale;
            const logicalY = (mouseY + this.canvasContainer.scrollTop) / oldScale;
            
            this.canvasContainer.scrollLeft = logicalX * newScale - mouseX;
            this.canvasContainer.scrollTop = logicalY * newScale - mouseY;
        }

        this.renderConnections();
    }

    updateCanvasSize() {
        let maxX = this.canvasContainer.clientWidth / this.scale;
        let maxY = this.canvasContainer.clientHeight / this.scale;
        
        this.nodes.forEach(n => {
            if(n.x + 400 > maxX) maxX = n.x + 400; // 400 includes width and padding
            if(n.y + 350 > maxY) maxY = n.y + 350;
        });
        
        this.canvasContent.style.width = maxX + 'px';
        this.canvasContent.style.height = maxY + 'px';
    }

    async loadFlow() {
        try {
            const data = await api.get('/admin/recommendations');
            document.getElementById('greetingInput').value = data.greeting || 'Welcome! Let\'s help you find the best insurance plan for your needs.';
            this.nodes = data.nodes || [];
            this.edges = data.edges || [];
            this.undoStack = [];
            
            if(this.nodes.length === 0) {
                this.addNode(300, 200, true); // creates node_1
                this.edges.push({
                    fromNode: 'greeting',
                    fromOption: 'greeting',
                    toNode: this.nodes[0].id
                });
                this.renderConnections();
            } else {
                this.renderAll();
            }
        } catch(e) {
            console.error(e);
            this.addNode(300, 200, true);
        }
    }

    saveDraft() {
        const payload = {
            greeting: document.getElementById('greetingInput').value,
            nodes: this.nodes,
            edges: this.edges
        };
        localStorage.setItem('draft_flow', JSON.stringify(payload));
    }

    addNode(x = null, y = null, isFirst = false) {
        this.captureUndoState();
        const id = 'node_' + Date.now();
        // Calculate center of current view if x/y not provided
        if(x === null) {
            const offset = (this.nodes.length % 10) * 30; // Prevent overlap
            x = (this.canvasContainer.scrollLeft + (this.canvasContainer.clientWidth / 2) - 140) / this.scale + offset;
            y = (this.canvasContainer.scrollTop + (this.canvasContainer.clientHeight / 2) - 100) / this.scale + offset;
        }

        const color = this.colors[this.nodes.length % this.colors.length];

        const node = {
            id,
            title: 'Question Title',
            text: isFirst ? 'What type of insurance are you looking for?' : 'New Question',
            type: 'radio',
            color: color,
            required: true,
            x: x,
            y: y,
            options: [
                { id: 'opt_' + Date.now() + '_1', text: 'Option 1', color: 'purple' },
                { id: 'opt_' + Date.now() + '_2', text: 'Option 2', color: 'blue' }
            ]
        };
        
        this.nodes.push(node);
        this.renderAll();
        this.selectNode(id);
    }

    deleteNode(id) {
        this.captureUndoState();
        this.nodes = this.nodes.filter(n => n.id !== id);
        this.edges = this.edges.filter(e => e.fromNode !== id && e.toNode !== id);
        if(this.selectedNodeId === id) this.selectNode(null);
        this.renderAll();
        this.isDirty = true;
    }

    addOptionToSelected() {
        const input = document.getElementById('propNewOption');
        const text = input.value.trim();
        if(!text || !this.selectedNodeId) return;

        this.captureUndoState();

        const node = this.nodes.find(n => n.id === this.selectedNodeId);
        node.options.push({
            id: 'opt_' + Date.now(),
            text: text,
            color: 'blue' // default pill color
        });
        input.value = '';
        this.renderAll();
        this.updateSidebar();
        this.isDirty = true;
    }

    deleteOption(nodeId, optId) {
        this.captureUndoState();
        const node = this.nodes.find(n => n.id === nodeId);
        node.options = node.options.filter(o => o.id !== optId);
        // remove edges connected to this option
        this.edges = this.edges.filter(e => e.fromOption !== optId);
        this.renderAll();
        this.updateSidebar();
        this.isDirty = true;
    }

    deleteEdge(edgeIndex) {
        this.captureUndoState();
        this.edges.splice(edgeIndex, 1);
        this.renderConnections();
        this.isDirty = true;
    }

    selectNode(id) {
        this.selectedNodeId = id;
        document.querySelectorAll('.flow-node').forEach(el => el.classList.remove('selected'));
        if(id) {
            document.getElementById(id).classList.add('selected');
        }
        this.updateSidebar();
    }

    updateSelectedNode(field, value) {
        if(!this.selectedNodeId) return;
        this.captureUndoState();
        const node = this.nodes.find(n => n.id === this.selectedNodeId);
        node[field] = value;
        this.renderAll();
        this.isDirty = true;
    }

    renderAll() {
        const container = document.getElementById('nodesContainer');
        container.innerHTML = '';
        
        // DYNAMIC SYNC: Always inherit title & color from parent option on every render
        this.nodes.forEach(node => {
            const incomingEdge = this.edges.find(e => e.toNode === node.id);
            if(incomingEdge && incomingEdge.fromNode !== 'greeting') {
                const sourceNode = this.nodes.find(n => n.id === incomingEdge.fromNode);
                const sourceOpt = sourceNode?.options.find(o => o.id === incomingEdge.fromOption);
                if(sourceOpt) {
                    node.color = sourceOpt.color;
                    node.title = sourceOpt.text;
                }
            }
        });

        this.nodes.forEach(node => {
            const el = document.createElement('div');
            el.className = `flow-node border-${node.color} ${this.selectedNodeId === node.id ? 'selected' : ''}`;
            el.id = node.id;
            el.style.left = node.x + 'px';
            el.style.top = node.y + 'px';
            
            // Input port
            const portIn = `<div class="port port-in" data-node="${node.id}"><i class="fas fa-plus" style="font-size:0.5rem"></i></div>`;

            // Options HTML
            let optionsHtml = '';
            if(node.type === 'radio' || node.type === 'checkbox') {
                optionsHtml = '<div class="node-options">';
                node.options.forEach(opt => {
                    optionsHtml += `
                        <div class="node-option">
                            <div class="option-indicator ${node.type}"></div>
                            <div class="option-pill color-${opt.color}">${opt.text}</div>
                            <div class="port port-out" data-node="${node.id}" data-opt="${opt.id}"><i class="fas fa-plus"></i></div>
                        </div>
                    `;
                });
                optionsHtml += '</div>';
            } else if (node.type === 'text') {
                optionsHtml = `
                    <div class="node-input-preview">
                        <i class="fas fa-font"></i>
                        <span>Text input</span>
                    </div>
                    <div class="port port-out" data-node="${node.id}" data-opt="default_text_opt" style="position:absolute; right:-11px; top:50%; transform:translateY(-50%);"><i class="fas fa-plus"></i></div>`;
            } else if (node.type === 'slider') {
                optionsHtml = `<input type="range" style="width:100%" disabled>
                               <div class="port port-out" data-node="${node.id}" data-opt="default_slider_opt" style="position:absolute; right:-11px; top:50%; transform:translateY(-50%);"><i class="fas fa-plus"></i></div>`;
            } else if (node.type === 'phone') {
                optionsHtml = `
                    <div class="node-input-preview">
                        <i class="fas fa-phone"></i>
                        <span>Phone number (10 digits)</span>
                    </div>
                    <div class="port port-out" data-node="${node.id}" data-opt="phone_input" style="position:absolute; right:-11px; top:50%; transform:translateY(-50%);"><i class="fas fa-plus"></i></div>`;
            } else if (node.type === 'email') {
                optionsHtml = `
                    <div class="node-input-preview">
                        <i class="fas fa-envelope"></i>
                        <span>Email address</span>
                    </div>
                    <div class="port port-out" data-node="${node.id}" data-opt="email_input" style="position:absolute; right:-11px; top:50%; transform:translateY(-50%);"><i class="fas fa-plus"></i></div>`;
            } else if (node.type === 'date') {
                optionsHtml = `
                    <div class="node-input-preview">
                        <i class="fas fa-calendar-alt"></i>
                        <span>Date (Year → Month → Day)</span>
                    </div>
                    <div class="port port-out" data-node="${node.id}" data-opt="date_input" style="position:absolute; right:-11px; top:50%; transform:translateY(-50%);"><i class="fas fa-plus"></i></div>`;
            } else if (node.type === 'daterange') {
                optionsHtml = `
                    <div class="node-input-preview">
                        <i class="fas fa-calendar-alt"></i>
                        <span>Date Range (Start → End, optional)</span>
                    </div>
                    <div class="port port-out" data-node="${node.id}" data-opt="daterange_input" style="position:absolute; right:-11px; top:50%; transform:translateY(-50%);"><i class="fas fa-plus"></i></div>`;
            } else if (node.type === 'time') {
                optionsHtml = `
                    <div class="node-input-preview">
                        <i class="fas fa-clock"></i>
                        <span>Time Picker (HH:MM AM/PM)</span>
                    </div>
                    <div class="port port-out" data-node="${node.id}" data-opt="time_input" style="position:absolute; right:-11px; top:50%; transform:translateY(-50%);"><i class="fas fa-plus"></i></div>`;
            }

            el.innerHTML = `
                ${portIn}
                <div class="node-header" data-id="${node.id}">
                    <h4 class="node-header-title">${node.title}</h4>
                    <div class="node-header-actions">
                        <button class="icon-btn edit-node" data-id="${node.id}"><i class="fas fa-pen"></i></button>
                        <button class="icon-btn del-node" data-id="${node.id}"><i class="fas fa-trash"></i></button>
                    </div>
                </div>
                <div class="node-body">
                    <div class="node-question-text">${node.text} ${node.required ? '<span style="color:red; font-weight:bold;">*</span>' : ''}</div>
                    ${optionsHtml}
                </div>
                <div class="node-footer">
                    <button class="icon-btn add-opt-quick" data-id="${node.id}"><i class="fas fa-plus"></i></button>
                    <button class="icon-btn"><i class="fas fa-arrows-alt-v"></i></button>
                </div>
            `;

            container.appendChild(el);
        });

        this.attachNodeEvents();
        this.updateCanvasSize();
        this.renderConnections();
    }

    attachNodeEvents() {
        // Dragging & Selecting
        document.querySelectorAll('.flow-node').forEach(nodeEl => {
            nodeEl.addEventListener('mousedown', (e) => {
                // Ignore interactive elements
                if(e.target.closest('input, button, select, .port, .option-pill, .edit-node, .del-node')) return;
                
                // Allow drag on double-click anywhere on the node, OR single click on header
                if(e.detail >= 2 || e.target.closest('.node-header')) {
                    const id = nodeEl.id;
                    this.selectNode(id);
                    this.draggingNode = this.nodes.find(n => n.id === id);
                    const rect = nodeEl.getBoundingClientRect();
                    this.dragOffset = {
                        x: (e.clientX - rect.left) / this.scale,
                        y: (e.clientY - rect.top) / this.scale
                    };
                } else if(e.detail === 1) {
                    this.selectNode(nodeEl.id);
                }
            });
        });

        // Click to select (body)
        document.querySelectorAll('.node-body').forEach(body => {
            body.addEventListener('mousedown', (e) => {
                const id = body.closest('.flow-node').id;
                this.selectNode(id);
            });
        });

        // Edit / Delete buttons
        document.querySelectorAll('.edit-node').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.selectNode(btn.getAttribute('data-id'));
            });
        });

        document.querySelectorAll('.del-node').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                if(confirm('Delete this question?')) {
                    this.deleteNode(btn.getAttribute('data-id'));
                }
            });
        });

        document.querySelectorAll('.add-opt-quick').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.selectNode(btn.getAttribute('data-id'));
                document.getElementById('propNewOption').focus();
            });
        });

        // Output ports (Start drawing connection)
        document.querySelectorAll('.port-out').forEach(port => {
            port.addEventListener('mousedown', (e) => {
                e.stopPropagation();
                this.drawingEdge = true;
                this.edgeStart = {
                    nodeId: port.getAttribute('data-node'),
                    optionId: port.getAttribute('data-opt'),
                    element: port
                };
            });
        });

        // Input ports (Finish connection)
        document.querySelectorAll('.port-in').forEach(port => {
            port.addEventListener('mouseup', (e) => {
                if(this.drawingEdge && this.edgeStart) {
                    const targetNodeId = port.getAttribute('data-node');
                    // Prevent connecting to self
                    if(targetNodeId !== this.edgeStart.nodeId) {
                        const exists = this.edges.find(edge => edge.fromOption === this.edgeStart.optionId && edge.toNode === targetNodeId);
                        if(!exists) {
                            this.edges.push({
                                fromNode: this.edgeStart.nodeId,
                                fromOption: this.edgeStart.optionId,
                                toNode: targetNodeId
                            });
                            
                            this.renderAll();
                            this.drawingEdge = false;
                            this.edgeStart = null;
                        }
                    }
                }
            });
        });
    }

    onMouseMove(e) {
        if(this.draggingNode) {
            const canvasRect = this.canvasContent.getBoundingClientRect();
            let newX = ((e.clientX - canvasRect.left) / this.scale) - this.dragOffset.x;
            let newY = ((e.clientY - canvasRect.top) / this.scale) - this.dragOffset.y;
            
            // Constrain
            newX = Math.max(0, newX);
            newY = Math.max(0, newY);

            this.draggingNode.x = newX;
            this.draggingNode.y = newY;

            const el = document.getElementById(this.draggingNode.id);
            el.style.left = newX + 'px';
            el.style.top = newY + 'px';

            this.updateCanvasSize();
            this.renderConnections();
        }

        if(this.drawingEdge && this.edgeStart) {
            this.renderConnections(e);
        }
    }

    onMouseUp() {
        this.draggingNode = null;
        if(this.drawingEdge) {
            this.drawingEdge = false;
            this.edgeStart = null;
            this.renderConnections();
        }
    }

    renderConnections(mouseEvent = null) {
        this.svg.innerHTML = '';
        
        // Define arrow marker
        const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
        defs.innerHTML = `
            <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                <polygon points="0 0, 10 3.5, 0 7" class="connection-arrow" />
            </marker>
        `;
        this.svg.appendChild(defs);

        const canvasRect = this.canvasContent.getBoundingClientRect();

        // Draw saved edges
        this.edges.forEach((edge, index) => {
            let outPort;
            if(edge.fromNode === 'greeting') {
                outPort = document.querySelector(`.port-out[data-node="greeting"]`);
            } else {
                outPort = document.querySelector(`.port-out[data-opt="${edge.fromOption}"]`);
            }
            const inPort = document.querySelector(`.port-in[data-node="${edge.toNode}"]`);
            
            if(outPort && inPort) {
                const outRect = outPort.getBoundingClientRect();
                const inRect = inPort.getBoundingClientRect();
                
                let x1, y1;
                if(edge.fromNode === 'greeting') {
                    x1 = (outRect.left + (outRect.width/2) - canvasRect.left) / this.scale;
                    y1 = (outRect.bottom - canvasRect.top) / this.scale;
                } else {
                    x1 = (outRect.right - canvasRect.left) / this.scale;
                    y1 = (outRect.top + (outRect.height/2) - canvasRect.top) / this.scale;
                }
                
                const x2 = (inRect.left - canvasRect.left) / this.scale;
                const y2 = (inRect.top + (inRect.height/2) - canvasRect.top) / this.scale;
                
                this.drawSvgLine(x1, y1, x2, y2, index);
            }
        });

        // Draw temp edge following mouse
        if(this.drawingEdge && this.edgeStart && mouseEvent) {
            const outPort = this.edgeStart.element;
            const outRect = outPort.getBoundingClientRect();
            
            let x1, y1;
            if(this.edgeStart.nodeId === 'greeting') {
                x1 = (outRect.left + (outRect.width/2) - canvasRect.left) / this.scale;
                y1 = (outRect.bottom - canvasRect.top) / this.scale;
            } else {
                x1 = (outRect.right - canvasRect.left) / this.scale;
                y1 = (outRect.top + (outRect.height/2) - canvasRect.top) / this.scale;
            }
            
            const x2 = (mouseEvent.clientX - canvasRect.left) / this.scale;
            const y2 = (mouseEvent.clientY - canvasRect.top) / this.scale;
            
            this.drawSvgLine(x1, y1, x2, y2, null, true);
        }
    }

    drawSvgLine(x1, y1, x2, y2, edgeIndex, isTemp = false) {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        // Bezier curve logic for smooth routing
        const offset = Math.max(Math.abs(x2 - x1) / 2, 50);
        const d = `M ${x1} ${y1} C ${x1 + offset} ${y1}, ${x2 - offset} ${y2}, ${x2} ${y2}`;
        
        path.setAttribute('d', d);
        path.setAttribute('class', 'connection-path');
        if(!isTemp) {
            path.setAttribute('marker-end', 'url(#arrowhead)');
            // Click to delete line
            path.addEventListener('click', () => {
                if(confirm('Delete connection?')) this.deleteEdge(edgeIndex);
            });
        }
        
        this.svg.appendChild(path);
    }

    updateSidebar() {
        const empty = document.getElementById('sidebarEmpty');
        const form = document.getElementById('sidebarForm');
        
        if(!this.selectedNodeId) {
            empty.style.display = 'block';
            form.style.display = 'none';
            return;
        }

        const node = this.nodes.find(n => n.id === this.selectedNodeId);
        if(!node) return;

        empty.style.display = 'none';
        form.style.display = 'flex';

        document.getElementById('propQuestionTitle').value = node.title;
        document.getElementById('propQuestionText').value = node.text;
        document.getElementById('propQuestionType').value = node.type;
        
        const reqToggle = document.getElementById('propRequired');
        if(node.required) reqToggle.classList.add('active');
        else reqToggle.classList.remove('active');

        // Render options list in sidebar
        const optionsContainer = document.getElementById('propOptionsList');
        optionsContainer.innerHTML = '';
        if(node.type === 'radio' || node.type === 'checkbox') {
            node.options.forEach(opt => {
                const optDiv = document.createElement('div');
                optDiv.style.display = 'flex';
                optDiv.style.alignItems = 'center';
                optDiv.style.gap = '0.5rem';
                optDiv.style.marginTop = '0.5rem';
                
                optDiv.innerHTML = `
                    <select class="prop-select" style="width:auto; padding:0.4rem;" onchange="builder.updateOptionColor('${node.id}', '${opt.id}', this.value)">
                        <option value="purple" ${opt.color==='purple'?'selected':''}>Purple</option>
                        <option value="blue" ${opt.color==='blue'?'selected':''}>Blue</option>
                        <option value="red" ${opt.color==='red'?'selected':''}>Red</option>
                        <option value="orange" ${opt.color==='orange'?'selected':''}>Orange</option>
                        <option value="teal" ${opt.color==='teal'?'selected':''}>Teal</option>
                        <option value="green" ${opt.color==='green'?'selected':''}>Green</option>
                        <option value="pink" ${opt.color==='pink'?'selected':''}>Pink</option>
                        <option value="yellow" ${opt.color==='yellow'?'selected':''}>Yellow</option>
                        <option value="indigo" ${opt.color==='indigo'?'selected':''}>Indigo</option>
                        <option value="cyan" ${opt.color==='cyan'?'selected':''}>Cyan</option>
                    </select>
                    <input type="text" class="prop-input" style="padding:0.4rem;" value="${opt.text}" onchange="builder.updateOptionText('${node.id}', '${opt.id}', this.value)">
                    <button class="icon-btn" onclick="builder.deleteOption('${node.id}', '${opt.id}')" style="color:#e64c4c;"><i class="fas fa-trash"></i></button>
                `;
                optionsContainer.appendChild(optDiv);
            });
        }
    }

    updateOptionText(nodeId, optId, val) {
        this.captureUndoState();
        const node = this.nodes.find(n => n.id === nodeId);
        const opt = node.options.find(o => o.id === optId);
        if(opt) opt.text = val;
        this.renderAll();
        this.isDirty = true;
    }

    updateOptionColor(nodeId, optId, color) {
        this.captureUndoState();
        const node = this.nodes.find(n => n.id === nodeId);
        const opt = node.options.find(o => o.id === optId);
        if(opt) opt.color = color;
        this.renderAll();
        this.isDirty = true;
    }
}
