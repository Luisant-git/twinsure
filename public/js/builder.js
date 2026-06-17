// public/js/builder.js
class VisualBuilder {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.svg = document.getElementById('builderSvg');
        this.nodes = [];
        this.edges = [];
        this.draggingNode = null;
        this.offset = { x: 0, y: 0 };
        this.connectingFrom = null;

        this.initEvents();
    }

    initEvents() {
        this.container.addEventListener('mousemove', (e) => this.onMouseMove(e));
        this.container.addEventListener('mouseup', () => this.onMouseUp());
        this.container.addEventListener('mouseleave', () => this.onMouseUp());
    }

    async loadFlow() {
        try {
            const data = await api.get('/admin/recommendations');
            document.getElementById('greetingText').value = data.greeting || '';
            this.nodes = data.nodes || [];
            this.edges = data.edges || [];
            this.renderAll();
        } catch (e) {
            console.error("Failed to load flow", e);
        }
    }

    async saveFlow() {
        const greeting = document.getElementById('greetingText').value;
        try {
            await api.post('/admin/recommendations', {
                greeting,
                nodes: this.nodes,
                edges: this.edges
            });
            alert('Flow saved successfully!');
        } catch (e) {
            alert('Failed to save flow.');
            console.error(e);
        }
    }

    addNode() {
        const id = 'node_' + Date.now();
        const node = {
            id: id,
            title: 'New Question',
            type: 'radio',
            options: [
                { id: 'opt_' + Date.now() + '_1', text: 'Option 1', color: 'purple' },
                { id: 'opt_' + Date.now() + '_2', text: 'Option 2', color: 'blue' }
            ],
            x: 50 + (Math.random() * 100),
            y: 50 + (Math.random() * 100)
        };
        this.nodes.push(node);
        this.renderAll();
    }

    deleteNode(id) {
        this.nodes = this.nodes.filter(n => n.id !== id);
        this.edges = this.edges.filter(e => e.from !== id && e.to !== id && e.fromNode !== id && e.toNode !== id);
        this.renderAll();
    }

    updateNodeData(id, field, value) {
        const node = this.nodes.find(n => n.id === id);
        if (node) {
            node[field] = value;
        }
    }

    updateOptions(id, optionsStr) {
        const node = this.nodes.find(n => n.id === id);
        if (node) {
            node.options = optionsStr.split(',').map((s, index) => {
                const text = s.trim();
                const existing = node.options && node.options[index];
                if (existing && typeof existing === 'object') {
                    return {
                        id: existing.id || ('opt_' + Date.now() + '_' + index),
                        text: text,
                        color: existing.color || 'blue'
                    };
                }
                return {
                    id: 'opt_' + Date.now() + '_' + index,
                    text: text,
                    color: 'blue'
                };
            });
        }
    }

    renderAll() {
        // Clear HTML nodes (keep SVG)
        const htmlNodes = this.container.querySelectorAll('.node');
        htmlNodes.forEach(n => n.remove());

        // Render Nodes
        this.nodes.forEach(nodeData => {
            const el = document.createElement('div');
            el.className = 'node';
            el.id = nodeData.id;
            el.style.left = nodeData.x + 'px';
            el.style.top = nodeData.y + 'px';

            el.innerHTML = `
                <div class="node-endpoint endpoint-in" data-type="in" data-id="${nodeData.id}" title="Drag connection to here"></div>
                <div class="node-header" onmousedown="builder.startDrag(event, '${nodeData.id}')">
                    <input type="text" value="${nodeData.title}" onchange="builder.updateNodeData('${nodeData.id}', 'title', this.value)" style="width:70%; background:transparent; border:none; color:white; font-weight:bold;">
                    <span style="cursor:pointer; color:#ff4d4d;" onclick="builder.deleteNode('${nodeData.id}')">✕</span>
                </div>
                <div class="node-body">
                    <select onchange="builder.updateNodeData('${nodeData.id}', 'type', this.value)" style="width:100%; margin-bottom:10px; padding:5px;">
                        <option value="radio" ${nodeData.type==='radio'?'selected':''}>Radio Choice</option>
                        <option value="checkbox" ${nodeData.type==='checkbox'?'selected':''}>Checkbox</option>
                        <option value="text" ${nodeData.type==='text'?'selected':''}>Text Input</option>
                    </select>
                    <label style="font-size:0.8rem; color:#666;">Options (comma separated):</label>
                    <input type="text" value="${(nodeData.options || []).map(o => typeof o === 'object' && o !== null ? o.text : o).join(', ')}" onchange="builder.updateOptions('${nodeData.id}', this.value)" style="width:100%; padding:5px; font-size:0.9rem;">
                </div>
                <div class="node-endpoint endpoint-out" data-type="out" data-id="${nodeData.id}" title="Drag to connect"></div>
            `;

            this.container.appendChild(el);

            // Setup endpoint events for connections
            const epOut = el.querySelector('.endpoint-out');
            epOut.addEventListener('mousedown', (e) => {
                e.stopPropagation();
                this.connectingFrom = nodeData.id;
            });

            const epIn = el.querySelector('.endpoint-in');
            epIn.addEventListener('mouseup', (e) => {
                if (this.connectingFrom && this.connectingFrom !== nodeData.id) {
                    const fromId = this.connectingFrom;
                    const toId = nodeData.id;
                    const exists = this.edges.find(edge => (edge.fromNode === fromId || edge.from === fromId) && (edge.toNode === toId || edge.to === toId));
                    if(!exists) {
                        this.edges.push({
                            fromNode: fromId,
                            fromOption: 'default',
                            toNode: toId,
                            from: fromId,
                            to: toId
                        });
                    }
                    this.connectingFrom = null;
                    this.renderAll();
                }
            });
        });

        this.drawConnections();
    }

    startDrag(e, id) {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'SPAN') return;
        this.draggingNode = this.nodes.find(n => n.id === id);
        const el = document.getElementById(id);
        const rect = el.getBoundingClientRect();
        const containerRect = this.container.getBoundingClientRect();
        
        this.offset.x = e.clientX - rect.left;
        this.offset.y = e.clientY - rect.top;
    }

    onMouseMove(e) {
        if (this.draggingNode) {
            const containerRect = this.container.getBoundingClientRect();
            let newX = e.clientX - containerRect.left - this.offset.x;
            let newY = e.clientY - containerRect.top - this.offset.y;
            
            // Constrain
            newX = Math.max(0, newX);
            newY = Math.max(0, newY);

            this.draggingNode.x = newX;
            this.draggingNode.y = newY;

            const el = document.getElementById(this.draggingNode.id);
            el.style.left = newX + 'px';
            el.style.top = newY + 'px';

            this.drawConnections();
        }

        // Handle visual line drawing when connecting
        if (this.connectingFrom) {
            this.drawTempConnection(e);
        }
    }

    onMouseUp() {
        this.draggingNode = null;
        if(this.connectingFrom) {
            this.connectingFrom = null; // Drop connection if released outside target
            this.drawConnections();
        }
    }

    drawConnections() {
        this.svg.innerHTML = '';
        this.edges.forEach(edge => {
            const fromId = edge.fromNode || edge.from;
            const toId = edge.toNode || edge.to;
            const fromNode = this.nodes.find(n => n.id === fromId);
            const toNode = this.nodes.find(n => n.id === toId);
            if (fromNode && toNode) {
                this.drawLine(fromNode.x + 125, fromNode.y + 115, toNode.x + 125, toNode.y); // Adjust offsets based on node size
            }
        });
    }

    drawTempConnection(e) {
        const fromNode = this.nodes.find(n => n.id === this.connectingFrom);
        const containerRect = this.container.getBoundingClientRect();
        if (fromNode) {
            this.drawConnections(); // Redraw static ones
            this.drawLine(fromNode.x + 125, fromNode.y + 115, e.clientX - containerRect.left, e.clientY - containerRect.top);
        }
    }

    drawLine(x1, y1, x2, y2) {
        // Create curved SVG path
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        const d = `M ${x1} ${y1} C ${x1} ${y1 + 50}, ${x2} ${y2 - 50}, ${x2} ${y2}`;
        path.setAttribute('d', d);
        path.setAttribute('class', 'connection-line');
        this.svg.appendChild(path);
    }
}
