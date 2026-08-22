// ============================================
// SHARED — utilidades transversales usadas por varios módulos de dominio
// (formato de texto/números/fechas, y widgets genéricos de filtros y
// paneles colapsables). Extraído de app.js al modularizar por dominio.
// ============================================

// Escapa texto antes de insertarlo con innerHTML, para evitar XSS si algún
// campo (nombre, país, banco, etc.) contuviera caracteres HTML.
export const escapeHtml = (str) => {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
};

export const formatMoney = (num, currency) => {
    if (num === null || num === undefined || isNaN(num)) return '—';
    return `${Number(num).toLocaleString('es-CL', { maximumFractionDigits: 2 })} ${escapeHtml(currency || '')}`.trim();
};

export const formatDate = (timestamp) => {
    if (!timestamp || !timestamp.toDate) return '—';
    return timestamp.toDate().toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

// Texto plano (sin HTML) para exportar a PDF/Excel.
export const moneyTexto = (num, currency) => {
    if (num === null || num === undefined || isNaN(num)) return '—';
    return `${Number(num).toLocaleString('es-CL', { maximumFractionDigits: 2 })} ${currency || ''}`.trim();
};

// Nombre de archivo con la fecha de hoy, usado por todos los botones "Exportar".
export const fechaArchivo = () => new Date().toISOString().slice(0, 10);

// Comprueba si un Firestore Timestamp cae dentro del rango [desde, hasta]
// (strings 'YYYY-MM-DD' que vienen de un <input type="date">, ambos inclusive).
// Un extremo vacío significa "sin límite" por ese lado.
export const fechaEnRango = (timestamp, desde, hasta) => {
    if (!timestamp || !timestamp.toDate) return !desde && !hasta;
    const fecha = timestamp.toDate();
    if (desde && fecha < new Date(desde + 'T00:00:00')) return false;
    if (hasta && fecha > new Date(hasta + 'T23:59:59.999')) return false;
    return true;
};

// Devuelve la fecha de hoy en formato 'YYYY-MM-DD' (hora local), lista
// para precargar un <input type="date">.
export function hoyInputValue() {
    const hoy = new Date();
    const mes = String(hoy.getMonth() + 1).padStart(2, '0');
    const dia = String(hoy.getDate()).padStart(2, '0');
    return `${hoy.getFullYear()}-${mes}-${dia}`;
}

export const badgeClass = (estado) => {
    if (estado === 'completado') return 'badge badge-success';
    if (estado === 'cancelado') return 'badge badge-danger';
    return 'badge badge-pending';
};

export const badgeLabel = (estado) => {
    if (estado === 'completado') return 'Completado';
    if (estado === 'cancelado') return 'Cancelado';
    return 'Pendiente';
};

// Normaliza un nombre de cliente para usarlo como clave de caché
// (clientes.js) y para vincular remesas al cliente correspondiente
// (remesas.js).
export function normalizarNombre(nombre) {
    return (nombre || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

// ============================================
// FILTROS — panel colapsable + chips de filtros activos
// (helpers genéricos reutilizados por Clientes, Historial, Caja,
// Billetera y Boletas)
// ============================================

// Activa el botón que abre/cierra el cuerpo de un panel de filtros.
// prefix: ej. 'historial', 'caja', 'billeteraMovs' → usa los ids
// {prefix}FiltrosPanel y {prefix}FiltrosToggle.
export function initFiltrosToggle(prefix) {
    const panel = document.getElementById(`${prefix}FiltrosPanel`);
    const toggle = document.getElementById(`${prefix}FiltrosToggle`);
    if (!panel || !toggle) return;
    toggle.addEventListener('click', () => {
        const abierto = panel.classList.toggle('abierto');
        toggle.setAttribute('aria-expanded', abierto ? 'true' : 'false');
    });
}

// Repinta la fila de "chips" con los filtros activos de un panel, el
// contador junto al botón "Filtros" y el texto "X de Y" del resultado.
// prefix: mismo prefijo usado en initFiltrosToggle.
// defs: [{ label, activo, texto, onQuitar }] — uno por cada campo de filtro.
// resultado: { mostrados, total } para el texto "X de Y" (opcional).
export function actualizarPanelFiltros(prefix, defs, resultado) {
    const chipsEl = document.getElementById(`${prefix}FiltrosChips`);
    const countEl = document.getElementById(`${prefix}FiltrosCount`);
    const resultadoEl = document.getElementById(`${prefix}ResultCount`);
    const activos = defs.filter(d => d.activo);

    if (chipsEl) {
        chipsEl.innerHTML = '';
        activos.forEach((d, i) => {
            const chip = document.createElement('span');
            chip.className = 'filtro-chip';
            chip.innerHTML = `${escapeHtml(d.texto)} <button type="button" aria-label="Quitar filtro ${escapeHtml(d.label)}"><i class="ti ti-x" aria-hidden="true"></i></button>`;
            chip.querySelector('button').addEventListener('click', d.onQuitar);
            chipsEl.appendChild(chip);
        });
    }

    if (countEl) {
        countEl.textContent = String(activos.length);
        countEl.classList.toggle('hidden', activos.length === 0);
    }

    if (resultadoEl) {
        resultadoEl.textContent = resultado
            ? `${resultado.mostrados} de ${resultado.total}`
            : '';
    }
}

// ============================================
// PANELES MINIMIZABLES GENÉRICOS (título clicable en panel-header)
// Usado por Historial de ventas/compras y Movimientos de USDT en
// Billetera para no ocupar tanto espacio de golpe. El estado
// (abierto/cerrado) de cada uno se recuerda en localStorage.
// ============================================
const PANEL_COLAPSABLE_STORAGE_KEY = 'panelesColapsablesAbiertos';

export function leerEstadoPanelesColapsables() {
    try {
        return JSON.parse(localStorage.getItem(PANEL_COLAPSABLE_STORAGE_KEY)) || {};
    } catch (error) {
        return {};
    }
}

export function guardarEstadoPanelColapsable(id, abierto) {
    const estado = leerEstadoPanelesColapsables();
    estado[id] = abierto;
    try {
        localStorage.setItem(PANEL_COLAPSABLE_STORAGE_KEY, JSON.stringify(estado));
    } catch (error) {
        // localStorage no disponible (modo privado, etc.) — no es crítico.
    }
}

// panelId: id del contenedor .panel (ej. 'billeteraVentasPanel') → usa los
// ids {panelId sin "Panel"}CollapseToggle. abiertoPorDefecto solo se usa
// la primera vez, antes de que exista una preferencia guardada.
export function initPanelCollapseToggle(panelId, toggleId, abiertoPorDefecto) {
    const panel = document.getElementById(panelId);
    const toggle = document.getElementById(toggleId);
    if (!panel || !toggle) return;

    const estadoGuardado = leerEstadoPanelesColapsables()[panelId];
    const abierto = estadoGuardado !== undefined ? estadoGuardado : abiertoPorDefecto;
    panel.classList.toggle('abierto', abierto);
    toggle.setAttribute('aria-expanded', abierto ? 'true' : 'false');

    toggle.addEventListener('click', () => {
        const ahoraAbierto = panel.classList.toggle('abierto');
        toggle.setAttribute('aria-expanded', ahoraAbierto ? 'true' : 'false');
        guardarEstadoPanelColapsable(panelId, ahoraAbierto);
    });
}
