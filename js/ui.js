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
const HOME_ID = 'home';

export function showSection(sectionId) {
    const target = document.getElementById(sectionId);
    if (!target) return;

    sections.forEach(s => s.classList.remove('active'));
    target.classList.add('active');

    const isHome = sectionId === HOME_ID;

    if (backHomeBtn) backHomeBtn.classList.toggle('visible', !isHome);
    if (pageContext) pageContext.classList.toggle('hidden', isHome);

    if (!isHome && topbarTitle) {
        const tile = document.querySelector(`.home-tile[data-section="${sectionId}"]`);
        const iconClass = tile?.querySelector('i')?.className;
        if (iconClass && topbarIcon) topbarIcon.className = iconClass;
        topbarTitle.textContent = tile?.dataset.title || tile?.querySelector('.home-tile-title')?.textContent || '';
        topbarSubtitle.textContent = tile?.dataset.subtitle || '';
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
}
window.showSection = showSection;

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
