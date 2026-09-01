(() => {
  const route = location.pathname;
  const items = [
    ['/', 'Mission'],
    ['/memory.html', 'Memory'],
    ['/queue.html', 'Approvals'],
    ['/connectors.html', 'Connectors'],
  ];
  const activePath = route === '/index.html' ? '/' : route;
  const bar = document.createElement('header');
  bar.className = 'nexus-command-bar';
  bar.innerHTML = `
    <div class="nexus-brand"><span class="reactor-mini"></span><span class="brand-copy"><strong>NEXUS</strong><span>AI DEVELOPMENT SYSTEM</span></span></div>
    <div class="workspace-pill"><span>WORKSPACE</span><b>Nexus Labs / Sandbox</b></div>
    <div class="command-actions"><span class="system-online">SYSTEM ONLINE</span><span class="operator-chip">JL</span></div>`;
  const dock = document.createElement('nav');
  dock.className = 'nexus-dock';
  dock.setAttribute('aria-label', 'Nexus workspace');
  dock.innerHTML = items.map(([href,label]) => `<a href="${href}" class="${activePath === href ? 'active' : ''}">${label}</a>`).join('');
  document.body.prepend(bar);
  document.body.appendChild(dock);
  document.body.dataset.nexusScreen = items.find(([href]) => href === activePath)?.[1]?.toLowerCase() || 'workspace';
})();