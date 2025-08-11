// --- Ensure DOM is loaded before running any logic ---
document.addEventListener('DOMContentLoaded', function() {
  // CI/CD Pipeline Visualizer - Vanilla JS
  // Features:
  // - Drag stage cards onto canvas to create nodes
  // - Click two nodes to toggle a connection (directed)
  // - Run simulation: token flows along connections, simulated logs

  const addStageBtn = document.getElementById('addStageBtn');
  const runBtn = document.getElementById('runBtn');
  const resetBtn = document.getElementById('resetBtn');
  const stagesContainer = document.getElementById('stagesContainer');
  const svg = document.getElementById('svgConnections');
  const logsBox = document.getElementById('logs');

  let nodes = {};           // id -> node DOM + metadata
  let connections = [];     // {from, to}
  let nextId = 1;
  let selectedNode = null;

  // Palette drag handlers
  document.querySelectorAll('.draggable').forEach(card => {
    card.addEventListener('dragstart', e => {
      e.dataTransfer.setData('text/plain', card.dataset.type || 'custom');
    });
  });

  // Canvas drop (handle dragover/drop for all relevant canvas children)
  const canvas = document.getElementById('pipelineCanvas');
  const allowDrop = e => { e.preventDefault(); };
  [canvas, stagesContainer, svg].forEach(el => {
    el.addEventListener('dragover', allowDrop);
    el.addEventListener('drop', function(e) {
      e.preventDefault();
      const type = e.dataTransfer.getData('text/plain') || 'custom';
      const rect = stagesContainer.getBoundingClientRect();
      // coordinate relative to container
      const x = e.clientX - rect.left - 80; // center node (160/2)
      const y = e.clientY - rect.top - 45;  // center node (90/2)
      createNode({ type, x: Math.max(8, x), y: Math.max(8, y) });
      renderConnections();
    });
  });

  // Create node via button
  addStageBtn.addEventListener('click', () => {
    createNode({ type: 'custom', x: 20 + (nextId % 6) * 20, y: 20 + Math.floor(nextId / 6) * 10 });
    renderConnections();
  });

  // Run pipeline: find start nodes (no incoming edges) and animate token
  runBtn.addEventListener('click', async () => {
    clearLogs();
    const starts = findStartNodes();
    if (starts.length === 0) {
      log("No start node found. Create at least one stage and connect pipeline.");
      return;
    }
    log(`Starting pipeline run (${new Date().toLocaleTimeString()})`);
    // run each start path sequentially
    for (const s of starts) {
      await runFromNode(s);
    }
    log("Pipeline run complete ✨");
  });

  // Reset
  resetBtn.addEventListener('click', () => {
    Object.keys(nodes).forEach(id => nodes[id].el.remove());
    nodes = {};
    connections = [];
    nextId = 1;
    selectedNode = null;
    svg.innerHTML = '';
    clearLogs();
    // Restore default pipeline
    addDefaultPipeline();
  });

  // All helper functions moved inside so they have access to state
  function createNode({ type='custom', x=20, y=20 }) {
    const id = `n${nextId++}`;
    const el = document.createElement('div');
    el.className = 'stage-node';
    el.dataset.id = id;
    el.style.position = 'absolute';
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    // Default label for custom stages
    let label = type === 'custom' ? 'Custom Stage' : capitalize(type);
    el.innerHTML = `
      <div class="title"><span class="stage-label" style="cursor:pointer;">${label}</span> <span class="meta" style="float:right;font-weight:600;color:var(--muted)">#${id}</span></div>
      <div class="meta">${type === 'custom' ? 'Custom Stage' : type}</div>
      <div class="actions">
        <div style="flex:1"></div>
        <button class="btn-icon btn-connect" title="Connect">🔗</button>
        <button class="btn-icon btn-run" title="Run stage">▶</button>
        <button class="btn-icon btn-delete" title="Delete">✖</button>
      </div>
    `;
    stagesContainer.appendChild(el);

    nodes[id] = {
      id, type, x, y, el, state: 'idle', label: label
    };

    // Make node draggable within container
    makeNodeDraggable(el);

    // Editable label logic
    const labelSpan = el.querySelector('.stage-label');
    labelSpan.addEventListener('click', function(e) {
      e.stopPropagation();
      const input = document.createElement('input');
      input.type = 'text';
      input.value = nodes[id].label;
      input.className = 'edit-label-input';
      input.style.fontWeight = '600';
      input.style.fontSize = '1em';
      input.style.width = Math.max(80, labelSpan.offsetWidth + 20) + 'px';
      labelSpan.replaceWith(input);
      input.focus();
      input.select();
      function finishEdit() {
        const newLabel = input.value.trim() || 'Custom Stage';
        nodes[id].label = newLabel;
        const newSpan = document.createElement('span');
        newSpan.className = 'stage-label';
        newSpan.style.cursor = 'pointer';
        newSpan.textContent = newLabel;
        input.replaceWith(newSpan);
        // Re-attach edit handler
        newSpan.addEventListener('click', labelSpan.onclick);
      }
      input.addEventListener('blur', finishEdit);
      input.addEventListener('keydown', function(ev) {
        if (ev.key === 'Enter') {
          input.blur();
        }
      });
    });

    // Click to select for connection
    el.addEventListener('click', (ev) => {
      if (ev.target.closest('button')) return;
      toggleSelectNode(id);
    });

    // Buttons
    el.querySelector('.btn-delete').addEventListener('click', (e) => {
      e.stopPropagation();
      deleteNode(id);
    });

    el.querySelector('.btn-connect').addEventListener('click', (e) => {
      e.stopPropagation();
      toggleSelectNode(id);
    });

    el.querySelector('.btn-run').addEventListener('click', async (e) => {
      e.stopPropagation();
      await runFromNode(id);
    });

    return id;
  }

  function deleteNode(id) {
    // remove connections referencing this node
    connections = connections.filter(c => c.from !== id && c.to !== id);
    nodes[id].el.remove();
    delete nodes[id];
    selectedNode = null;
    renderConnections();
  }

  function toggleSelectNode(id) {
    if (!selectedNode) {
      selectedNode = id;
      nodes[id].el.classList.add('selected');
    } else if (selectedNode === id) {
      nodes[id].el.classList.remove('selected');
      selectedNode = null;
    } else {
      // create or remove connection (directed from selectedNode -> id)
      const exists = connections.find(c => c.from === selectedNode && c.to === id);
      if (exists) {
        connections = connections.filter(c => !(c.from === selectedNode && c.to === id));
        log(`Removed connection ${selectedNode} → ${id}`);
      } else {
        connections.push({ from: selectedNode, to: id });
        log(`Added connection ${selectedNode} → ${id}`);
      }
      nodes[selectedNode].el.classList.remove('selected');
      selectedNode = null;
      renderConnections();
    }
  }

  function makeNodeDraggable(el) {
    let startX, startY, origX, origY;
    let dragging = false;
    let onMouseMove, onMouseUp;

    // Mouse events
    el.addEventListener('mousedown', e => {
      if (e.target.closest('button')) return;
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      origX = parseFloat(el.style.left);
      origY = parseFloat(el.style.top);
      el.style.cursor = 'grabbing';
      document.body.style.userSelect = 'none';

      onMouseMove = function(e) {
        if (!dragging) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        el.style.left = `${Math.max(8, origX + dx)}px`;
        el.style.top = `${Math.max(8, origY + dy)}px`;
        const id = el.dataset.id;
        nodes[id].x = parseFloat(el.style.left);
        nodes[id].y = parseFloat(el.style.top);
        renderConnections();
      };
      onMouseUp = function() {
        if (dragging) {
          dragging = false;
          el.style.cursor = 'grab';
          document.body.style.userSelect = '';
          document.removeEventListener('mousemove', onMouseMove);
          document.removeEventListener('mouseup', onMouseUp);
        }
      };
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });

    // Touch events for mobile
    el.addEventListener('touchstart', function(e) {
      if (e.target.closest('button')) return;
      if (e.touches.length !== 1) return;
      dragging = true;
      const touch = e.touches[0];
      startX = touch.clientX;
      startY = touch.clientY;
      origX = parseFloat(el.style.left);
      origY = parseFloat(el.style.top);
      el.style.cursor = 'grabbing';
      document.body.style.userSelect = 'none';

      function onTouchMove(ev) {
        if (!dragging || ev.touches.length !== 1) return;
        const t = ev.touches[0];
        const dx = t.clientX - startX;
        const dy = t.clientY - startY;
        el.style.left = `${Math.max(8, origX + dx)}px`;
        el.style.top = `${Math.max(8, origY + dy)}px`;
        const id = el.dataset.id;
        nodes[id].x = parseFloat(el.style.left);
        nodes[id].y = parseFloat(el.style.top);
        renderConnections();
      }
      function onTouchEnd() {
        if (dragging) {
          dragging = false;
          el.style.cursor = 'grab';
          document.body.style.userSelect = '';
          document.removeEventListener('touchmove', onTouchMove);
          document.removeEventListener('touchend', onTouchEnd);
        }
      }
      document.addEventListener('touchmove', onTouchMove);
      document.addEventListener('touchend', onTouchEnd);
    });
  }

  function renderConnections() {
    // clear
    svg.innerHTML = '';
    // draw each connection as a path + arrow
    connections.forEach((c, idx) => {
      const a = nodes[c.from];
      const b = nodes[c.to];
      if (!a || !b) return;
      const p1 = centerOf(a.el);
      const p2 = centerOf(b.el);

      // compute simple cubic curve
      const dx = Math.abs(p2.x - p1.x);
      const dy = Math.abs(p2.y - p1.y);
      const c1x = p1.x + dx * 0.4;
      const c1y = p1.y;
      const c2x = p2.x - dx * 0.4;
      const c2y = p2.y;
      const path = `M${p1.x},${p1.y} C${c1x},${c1y} ${c2x},${c2y} ${p2.x},${p2.y}`;

      // Draw path
      const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      pathEl.setAttribute('d', path);
      pathEl.setAttribute('stroke', '#38bdf8');
      pathEl.setAttribute('stroke-width', '3');
      pathEl.setAttribute('fill', 'none');
      pathEl.setAttribute('marker-end', 'url(#arrowhead)');
      pathEl.style.cursor = 'pointer';
      // Add click handler to remove connection
      pathEl.addEventListener('click', (e) => {
        e.stopPropagation();
        const fromLabel = a.label || a.type;
        const toLabel = b.label || b.type;
        if (confirm(`Remove link from "${fromLabel}" to "${toLabel}"?`)) {
          connections.splice(idx, 1);
          renderConnections();
        }
      });
      // Highlight on hover
      pathEl.addEventListener('mouseenter', () => {
        pathEl.setAttribute('stroke', '#f59e42');
      });
      pathEl.addEventListener('mouseleave', () => {
        pathEl.setAttribute('stroke', '#38bdf8');
      });
      svg.appendChild(pathEl);
    });

    // Add arrowhead marker if not present
    if (!svg.querySelector('marker#arrowhead')) {
      const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
      marker.setAttribute('id', 'arrowhead');
      marker.setAttribute('markerWidth', '10');
      marker.setAttribute('markerHeight', '7');
      marker.setAttribute('refX', '10');
      marker.setAttribute('refY', '3.5');
      marker.setAttribute('orient', 'auto');
      marker.setAttribute('markerUnits', 'strokeWidth');
      const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      arrow.setAttribute('points', '0 0, 10 3.5, 0 7');
      arrow.setAttribute('fill', '#38bdf8');
      marker.appendChild(arrow);
      svg.appendChild(marker);
    }
  }

  function centerOf(el) {
    const rect = el.getBoundingClientRect();
    const parentRect = svg.getBoundingClientRect();
    return {
      x: rect.left - parentRect.left + rect.width / 2,
      y: rect.top - parentRect.top + rect.height / 2
    };
  }

  function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  function clearLogs() {
    if (logsBox) logsBox.innerHTML = '';
  }

  function log(msg) {
    if (!logsBox) return;
    const line = document.createElement('div');
    line.className = 'log-line';
    line.textContent = msg;
    logsBox.appendChild(line);
    logsBox.scrollTop = logsBox.scrollHeight;
  }

  function findStartNodes() {
    const allIds = Object.keys(nodes);
    const targets = new Set(connections.map(c => c.to));
    return allIds.filter(id => !targets.has(id));
  }

  async function runFromNode(id) {
    if (!nodes[id]) return;
    const node = nodes[id];
    node.el.classList.add('running');
    // Prefer label, fallback to type
    const label = node.label || capitalize(node.type) + ` (#${id})`;
    log(`Running ${label}...`);
    await new Promise(res => setTimeout(res, 600));
    node.el.classList.remove('running');
    node.el.classList.add('success');
    setTimeout(() => node.el.classList.remove('success'), 800);
    // Run next nodes
    const next = connections.filter(c => c.from === id).map(c => c.to);
    for (const n of next) {
      await runFromNode(n);
    }
  }

  // --- Add default pipeline stages and connections ---
  function addDefaultPipeline() {
    // Improved positions for clarity and spacing
    const defaultStages = [
      { id: 'start', label: 'Start Build', x: 40, y: 180 },
      { id: 'build', label: 'Code Build and Test', x: 260, y: 100 },
      { id: 'scan', label: 'Scan and Containerise', x: 520, y: 100 },
      { id: 'system', label: 'System Test', x: 520, y: 260 },
      { id: 'deputy', label: 'Security Compliance', x: 780, y: 100 },
      { id: 'perf', label: 'Performance Test', x: 780, y: 260 },
      { id: 'complete', label: 'Complete Build', x: 1040, y: 180 }
    ];
    // Create stages
    const idMap = {};
    defaultStages.forEach(s => {
      const nodeId = createNode({ type: 'custom', x: s.x, y: s.y });
      // Set label
      const node = nodes[nodeId];
      node.label = s.label;
      // Update title in DOM
      node.el.querySelector('.title').childNodes[0].textContent = s.label + ' ';
      idMap[s.id] = nodeId;
    });
    // Connections (from → to) as per user request
    const defaultLinks = [
      ['start', 'build'],
      ['build', 'scan'],
      ['scan', 'system'],
      ['build', 'deputy'],
      ['deputy', 'perf'],
      ['deputy', 'complete']
    ];
    defaultLinks.forEach(([from, to]) => {
      connections.push({ from: idMap[from], to: idMap[to] });
    });
    renderConnections();
  }

  // Add default pipeline on load (after all functions/vars are defined)
  setTimeout(addDefaultPipeline, 0);
});

/* ------------ Node creation & interactions ------------ */

function createNode({ type='custom', x=20, y=20 }) {
  const id = `n${nextId++}`;
  const el = document.createElement('div');
  el.className = 'stage-node';
  el.dataset.id = id;
  el.style.position = 'absolute';
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  // Default label for custom stages
  let label = type === 'custom' ? 'Custom Stage' : capitalize(type);
  el.innerHTML = `
    <div class="title"><span class="stage-label" style="cursor:pointer;">${label}</span> <span class="meta" style="float:right;font-weight:600;color:var(--muted)">#${id}</span></div>
    <div class="meta">${type === 'custom' ? 'Custom Stage' : type}</div>
    <div class="actions">
      <div style="flex:1"></div>
      <button class="btn-icon btn-connect" title="Connect">🔗</button>
      <button class="btn-icon btn-run" title="Run stage">▶</button>
      <button class="btn-icon btn-delete" title="Delete">✖</button>
    </div>`;
  stagesContainer.appendChild(el);

  nodes[id] = {
    id, type, x, y, el, state: 'idle', label: label
  };

  // Make node draggable within container
  makeNodeDraggable(el);

  // Editable label logic
  const labelSpan = el.querySelector('.stage-label');
  labelSpan.addEventListener('click', function(e) {
    e.stopPropagation();
    const input = document.createElement('input');
    input.type = 'text';
    input.value = nodes[id].label;
    input.className = 'edit-label-input';
    input.style.fontWeight = '600';
    input.style.fontSize = '1em';
    input.style.width = Math.max(80, labelSpan.offsetWidth + 20) + 'px';
    labelSpan.replaceWith(input);
    input.focus();
    input.select();
    function finishEdit() {
      const newLabel = input.value.trim() || 'Custom Stage';
      nodes[id].label = newLabel;
      const newSpan = document.createElement('span');
      newSpan.className = 'stage-label';
      newSpan.style.cursor = 'pointer';
      newSpan.textContent = newLabel;
      input.replaceWith(newSpan);
      // Re-attach edit handler
      newSpan.addEventListener('click', labelSpan.onclick);
    }
    input.addEventListener('blur', finishEdit);
    input.addEventListener('keydown', function(ev) {
      if (ev.key === 'Enter') {
        input.blur();
      }
    });
  });

  // Click to select for connection
  el.addEventListener('click', (ev) => {
    // avoid selecting when clicking a button
    if (ev.target.closest('button')) return;
    toggleSelectNode(id);
  });

  // Buttons
  el.querySelector('.btn-delete').addEventListener('click', (e) => {
    e.stopPropagation();
    deleteNode(id);
  });

  el.querySelector('.btn-connect').addEventListener('click', (e) => {
    e.stopPropagation();
    // emulate clicking node to select for connection
    toggleSelectNode(id);
  });

  el.querySelector('.btn-run').addEventListener('click', async (e) => {
    e.stopPropagation();
    await runFromNode(id);
  });

  return id;
}

function deleteNode(id) {
  // remove connections referencing this node
  connections = connections.filter(c => c.from !== id && c.to !== id);
  nodes[id].el.remove();
  delete nodes[id];
  selectedNode = null;
  renderConnections();
}

/* ------------ Selection & connecting ------------ */

function toggleSelectNode(id) {
  if (!selectedNode) {
    selectedNode = id;
    nodes[id].el.classList.add('selected');
  } else if (selectedNode === id) {
    nodes[id].el.classList.remove('selected');
    selectedNode = null;
  } else {
    // create or remove connection (directed from selectedNode -> id)
    const exists = connections.find(c => c.from === selectedNode && c.to === id);
    if (exists) {
      connections = connections.filter(c => !(c.from === selectedNode && c.to === id));
      log(`Removed connection ${selectedNode} → ${id}`);
    } else {
      connections.push({ from: selectedNode, to: id });
      log(`Added connection ${selectedNode} → ${id}`);
    }
    nodes[selectedNode].el.classList.remove('selected');
    selectedNode = null;
    renderConnections();
  }
}

/* ------------ Dragging nodes ------------ */

function makeNodeDraggable(el) {
  let startX, startY, origX, origY;
  let dragging = false;
  let onMouseMove, onMouseUp;

  // Mouse events
  el.addEventListener('mousedown', e => {
    if (e.target.closest('button')) return;
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    origX = parseFloat(el.style.left);
    origY = parseFloat(el.style.top);
    el.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';

    onMouseMove = function(e) {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      el.style.left = `${Math.max(8, origX + dx)}px`;
      el.style.top = `${Math.max(8, origY + dy)}px`;
      const id = el.dataset.id;
      nodes[id].x = parseFloat(el.style.left);
      nodes[id].y = parseFloat(el.style.top);
      renderConnections();
    };
    onMouseUp = function() {
      if (dragging) {
        dragging = false;
        el.style.cursor = 'grab';
        document.body.style.userSelect = '';
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      }
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });

  // Touch events for mobile
  el.addEventListener('touchstart', function(e) {
    if (e.target.closest('button')) return;
    if (e.touches.length !== 1) return;
    dragging = true;
    const touch = e.touches[0];
    startX = touch.clientX;
    startY = touch.clientY;
    origX = parseFloat(el.style.left);
    origY = parseFloat(el.style.top);
    el.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';

    function onTouchMove(ev) {
      if (!dragging || ev.touches.length !== 1) return;
      const t = ev.touches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      el.style.left = `${Math.max(8, origX + dx)}px`;
      el.style.top = `${Math.max(8, origY + dy)}px`;
      const id = el.dataset.id;
      nodes[id].x = parseFloat(el.style.left);
      nodes[id].y = parseFloat(el.style.top);
      renderConnections();
    }
    function onTouchEnd() {
      if (dragging) {
        dragging = false;
        el.style.cursor = 'grab';
        document.body.style.userSelect = '';
        document.removeEventListener('touchmove', onTouchMove);
        document.removeEventListener('touchend', onTouchEnd);
      }
    }
    document.addEventListener('touchmove', onTouchMove);
    document.addEventListener('touchend', onTouchEnd);
  });
}

/* ------------ Draw svg connections ------------ */

function renderConnections() {
  // clear
  svg.innerHTML = '';
  // draw each connection as a path + arrow
  connections.forEach((c, idx) => {
    const a = nodes[c.from];
    const b = nodes[c.to];
    if (!a || !b) return;
    const p1 = centerOf(a.el);
    const p2 = centerOf(b.el);

    // compute simple cubic curve
    const dx = Math.abs(p2.x - p1.x);
    const dy = Math.abs(p2.y - p1.y);
    const c1x = p1.x + dx * 0.4;
    const c1y = p1.y;
    const c2x = p2.x - dx * 0.4;
    const c2y = p2.y;
    const path = `M${p1.x},${p1.y} C${c1x},${c1y} ${c2x},${c2y} ${p2.x},${p2.y}`;

    // Draw path
    const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    pathEl.setAttribute('d', path);
    pathEl.setAttribute('stroke', '#38bdf8');
    pathEl.setAttribute('stroke-width', '3');
    pathEl.setAttribute('fill', 'none');
    pathEl.setAttribute('marker-end', 'url(#arrowhead)');
    pathEl.style.cursor = 'pointer';
    // Add click handler to remove connection
    pathEl.addEventListener('click', (e) => {
      e.stopPropagation();
      const fromLabel = a.label || a.type;
      const toLabel = b.label || b.type;
      if (confirm(`Remove link from "${fromLabel}" to "${toLabel}"?`)) {
        connections.splice(idx, 1);
        renderConnections();
      }
    });
    // Highlight on hover
    pathEl.addEventListener('mouseenter', () => {
      pathEl.setAttribute('stroke', '#f59e42');
    });
    pathEl.addEventListener('mouseleave', () => {
      pathEl.setAttribute('stroke', '#38bdf8');
    });
    svg.appendChild(pathEl);
  });

  // Add arrowhead marker if not present
  if (!svg.querySelector('marker#arrowhead')) {
    const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
    marker.setAttribute('id', 'arrowhead');
    marker.setAttribute('markerWidth', '10');
    marker.setAttribute('markerHeight', '7');
    marker.setAttribute('refX', '10');
    marker.setAttribute('refY', '3.5');
    marker.setAttribute('orient', 'auto');
    marker.setAttribute('markerUnits', 'strokeWidth');
    const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    arrow.setAttribute('points', '0 0, 10 3.5, 0 7');
    arrow.setAttribute('fill', '#38bdf8');
    marker.appendChild(arrow);
    svg.appendChild(marker);
  }
}

// Helper: get center of a node element
function centerOf(el) {
  const rect = el.getBoundingClientRect();
  const parentRect = svg.getBoundingClientRect();
  return {
    x: rect.left - parentRect.left + rect.width / 2,
    y: rect.top - parentRect.top + rect.height / 2
  };
}

// Helper: capitalize first letter
function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// Helper: clear logs
function clearLogs() {
  if (logsBox) logsBox.innerHTML = '';
}

// Helper: log to logs box
function log(msg) {
  if (!logsBox) return;
  const line = document.createElement('div');
  line.className = 'log-line';
  line.textContent = msg;
  logsBox.appendChild(line);
  logsBox.scrollTop = logsBox.scrollHeight;
}

// Helper: find start nodes (no incoming edges)
function findStartNodes() {
  const allIds = Object.keys(nodes);
  const targets = new Set(connections.map(c => c.to));
  return allIds.filter(id => !targets.has(id));
}

// Helper: run from a node (simulate pipeline)
async function runFromNode(id) {
  if (!nodes[id]) return;
  const node = nodes[id];
  node.el.classList.add('running');
  // Prefer label, fallback to type
  const label = node.label || capitalize(node.type) + ` (#${id})`;
  log(`Running ${label}...`);
  await new Promise(res => setTimeout(res, 600));
  node.el.classList.remove('running');
  node.el.classList.add('success');
  setTimeout(() => node.el.classList.remove('success'), 800);
  // Run next nodes
  const next = connections.filter(c => c.from === id).map(c => c.to);
  for (const n of next) {
    await runFromNode(n);
  }
}
