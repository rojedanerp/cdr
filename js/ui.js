// ============================================
// UI — cascarón de la aplicación: navegación entre secciones (inicio con
// tarjetas + botón "Volver al inicio"), menú de usuario y reloj del topbar.
// No depende de ningún módulo de dominio; los módulos de dominio importan
// showSection() de aquí cuando necesitan navegar (por ejemplo, al guardar
// un cliente o una remesa).
// ============================================

const sections = document.querySelectorAll('.section');
const homeTiles = document.querySelectorAll('.home-tile');
const topbarIcon = document.getElementById('topbarIcon');
const topbarTitle = document.getElementById('topbarTitle');
const topbarSubtitle = document.getElementById('topbarSubtitle');
const pageContext = document.getElementById('pageContext');
const backHomeBtn = document.getElementById('backHomeBtn');
const panelSwitcher = document.getElementById('panelSwitcher');
const panelSwitcherBtn = document.getElementById('panelSwitcherBtn');
const panelSwitcherMenu = document.getElementById('panelSwitcherMenu');
const panelSwitcherItems = document.getElementById('panelSwitcherItems');
const panelSwitcherClose = document.getElementById('panelSwitcherClose');
const panelSwitcherBackdrop = document.getElementById('panelSwitcherBackdrop');
const HOME_ID = 'home';

export function showSection(sectionId) {
    const target = document.getElementById(sectionId);
    if (!target) return;

    sections.forEach(s => s.classList.remove('active'));
    target.classList.add('active');

    const isHome = sectionId === HOME_ID;

    if (backHomeBtn) backHomeBtn.classList.toggle('visible', !isHome);
    if (pageContext) pageContext.classList.toggle('hidden', isHome);
    if (panelSwitcher) panelSwitcher.classList.toggle('visible', !isHome);

    if (!isHome && topbarTitle) {
        const tile = document.querySelector(`.home-tile[data-section="${sectionId}"]`);
        const iconClass = tile?.querySelector('i')?.className;
        if (iconClass && topbarIcon) topbarIcon.className = iconClass;
        topbarTitle.textContent = tile?.dataset.title || tile?.querySelector('.home-tile-title')?.textContent || '';
        topbarSubtitle.textContent = tile?.dataset.subtitle || '';
    }

    if (panelSwitcherMenu) {
        panelSwitcherMenu.querySelectorAll('.panel-switcher-item').forEach(item => {
            item.classList.toggle('active', item.dataset.section === sectionId);
        });
    }
    closePanelSwitcher();

    window.scrollTo({ top: 0, behavior: 'smooth' });
}
window.showSection = showSection;

function openPanelSwitcher() {
    if (!panelSwitcherMenu || !panelSwitcherBtn) return;
    panelSwitcherMenu.classList.add('open');
    panelSwitcherBackdrop?.classList.add('open');
    panelSwitcherBtn.setAttribute('aria-expanded', 'true');
    panelSwitcherBtn.querySelector('i').className = 'ti ti-x';
    document.body.classList.add('panel-switcher-locked');
}

function closePanelSwitcher() {
    if (!panelSwitcherMenu || !panelSwitcherBtn) return;
    panelSwitcherMenu.classList.remove('open');
    panelSwitcherBackdrop?.classList.remove('open');
    panelSwitcherBtn.setAttribute('aria-expanded', 'false');
    const icon = panelSwitcherBtn.querySelector('i');
    if (icon) icon.className = 'ti ti-layout-grid';
    document.body.classList.remove('panel-switcher-locked');
}

// Construye el menú del selector rápido de paneles a partir de las mismas
// tarjetas de inicio (data-section, data-title, ícono), para no duplicar
// la lista de secciones en ningún otro lugar.
function buildPanelSwitcherMenu() {
    const container = panelSwitcherItems || panelSwitcherMenu;
    if (!container) return;
    container.innerHTML = '';
    homeTiles.forEach(tile => {
        const sectionId = tile.dataset.section;
        const iconClass = tile.querySelector('i')?.className || 'ti ti-app-window';
        const title = tile.dataset.title || tile.querySelector('.home-tile-title')?.textContent || sectionId;

        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'panel-switcher-item';
        item.dataset.section = sectionId;
        item.innerHTML = `<i class="${iconClass}" aria-hidden="true"></i><span>${title}</span>`;
        item.addEventListener('click', () => showSection(sectionId));
        container.appendChild(item);
    });
}

// Inicializa la navegación, el menú de usuario y el reloj del topbar.
// Se llama una sola vez desde app.js al arrancar.
export function initUI() {
    homeTiles.forEach(tile => {
        tile.addEventListener('click', () => showSection(tile.dataset.section));
    });

    if (backHomeBtn) {
        backHomeBtn.addEventListener('click', () => showSection(HOME_ID));
    }

    // ============================================
    // SELECTOR RÁPIDO DE PANELES
    // Permite saltar de una sección a otra directamente,
    // sin pasar primero por Inicio.
    // ============================================
    buildPanelSwitcherMenu();
    if (panelSwitcherBtn && panelSwitcherMenu) {
        panelSwitcherBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (panelSwitcherMenu.classList.contains('open')) {
                closePanelSwitcher();
            } else {
                openPanelSwitcher();
            }
        });
        panelSwitcherClose?.addEventListener('click', () => closePanelSwitcher());
        panelSwitcherBackdrop?.addEventListener('click', () => closePanelSwitcher());
        document.addEventListener('click', (e) => {
            if (!panelSwitcherMenu.contains(e.target) && !panelSwitcherBtn.contains(e.target)) {
                closePanelSwitcher();
            }
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') closePanelSwitcher();
        });
    }

    // ============================================
    // MENÚ DE USUARIO (topbar)
    // ============================================
    const topbarUserBtn = document.getElementById('topbarUserBtn');
    const topbarUserMenu = document.getElementById('topbarUserMenu');
    if (topbarUserBtn && topbarUserMenu) {
        topbarUserBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const open = topbarUserMenu.classList.toggle('open');
            topbarUserBtn.setAttribute('aria-expanded', String(open));
        });
        document.addEventListener('click', (e) => {
            if (!topbarUserMenu.contains(e.target) && e.target !== topbarUserBtn) {
                topbarUserMenu.classList.remove('open');
                topbarUserBtn.setAttribute('aria-expanded', 'false');
            }
        });
    }

    // ============================================
    // RELOJ DEL TOPBAR
    // ============================================
    const topbarClock = document.getElementById('topbarClock');
    if (topbarClock) {
        const updateClock = () => {
            const now = new Date();
            topbarClock.textContent = now.toLocaleString('es-CL', {
                weekday: 'short', day: '2-digit', month: 'short',
                hour: '2-digit', minute: '2-digit'
            });
        };
        updateClock();
        setInterval(updateClock, 30000);
    }
}
