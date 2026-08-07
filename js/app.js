import { auth, db } from './firebase-config.js';

// ============================================
// AUTENTICACIÓN — proteger la página
// ============================================
auth.onAuthStateChanged(user => {
    if (!user) {
        window.location.href = 'index.html';
    } else {
        document.getElementById('userEmail').textContent = user.email;
        const avatar = document.getElementById('topbarUserAvatar');
        if (avatar) avatar.textContent = user.email.slice(0, 1);
    }
});

window.logout = async () => {
    await auth.signOut();
    window.location.href = 'index.html';
};

// ============================================
// NAVEGACIÓN — inicio con tarjetas + botón "Volver al inicio"
// ============================================
const sections = document.querySelectorAll('.section');
const homeTiles = document.querySelectorAll('.home-tile');
const topbarIcon = document.getElementById('topbarIcon');
const topbarTitle = document.getElementById('topbarTitle');
const topbarSubtitle = document.getElementById('topbarSubtitle');
const pageContext = document.getElementById('pageContext');
const backHomeBtn = document.getElementById('backHomeBtn');
const HOME_ID = 'home';

function showSection(sectionId) {
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

// ============================================
// UTILIDADES
// ============================================

// Escapa texto antes de insertarlo con innerHTML, para evitar XSS si algún
// campo (nombre, país, banco, etc.) contuviera caracteres HTML.
const escapeHtml = (str) => {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
};

const formatMoney = (num, currency) => {
    if (num === null || num === undefined || isNaN(num)) return '—';
    return `${Number(num).toLocaleString('es-CL', { maximumFractionDigits: 2 })} ${escapeHtml(currency || '')}`.trim();
};

const formatDate = (timestamp) => {
    if (!timestamp || !timestamp.toDate) return '—';
    return timestamp.toDate().toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

// ============================================
// AUDITORÍA — registro automático de cambios importantes
// (tasas, remesas y caja), para poder reconstruir qué
// pasó y quién lo hizo si algún día aparece una diferencia.
// ============================================
const auditoriaColeccion = db.collection('auditoria');

function registrarAuditoria(tipo, accion, detalle = {}) {
    auditoriaColeccion.add({
        tipo,     // 'tasa' | 'remesa' | 'caja'
        accion,   // 'crear' | 'editar' | 'eliminar' | 'abrir' | 'cerrar'
        detalle,
        usuarioEmail: auth.currentUser ? auth.currentUser.email : null,
        usuarioUid: auth.currentUser ? auth.currentUser.uid : null,
        creadoEn: firebase.firestore.FieldValue.serverTimestamp()
    }).catch(err => console.warn('No se pudo registrar la auditoría:', err));
    // No bloqueante a propósito: si falla el registro de auditoría, la
    // operación principal (guardar tasa, remesa, caja) igual debe completarse.
}

// Comprueba si un Firestore Timestamp cae dentro del rango [desde, hasta]
// (strings 'YYYY-MM-DD' que vienen de un <input type="date">, ambos inclusive).
// Un extremo vacío significa "sin límite" por ese lado.
const fechaEnRango = (timestamp, desde, hasta) => {
    if (!timestamp || !timestamp.toDate) return !desde && !hasta;
    const fecha = timestamp.toDate();
    if (desde && fecha < new Date(desde + 'T00:00:00')) return false;
    if (hasta && fecha > new Date(hasta + 'T23:59:59.999')) return false;
    return true;
};

const badgeClass = (estado) => {
    if (estado === 'completado') return 'badge badge-success';
    if (estado === 'cancelado') return 'badge badge-danger';
    return 'badge badge-pending';
};

const badgeLabel = (estado) => {
    if (estado === 'completado') return 'Completado';
    if (estado === 'cancelado') return 'Cancelado';
    return 'Pendiente';
};

// ============================================
// NUEVA REMESA — cálculo en vivo del monto a recibir
// ============================================
const montoEnviadoInput = document.getElementById('montoEnviado');
const tasaCambioInput = document.getElementById('tasaCambio');
const montoRecibidoInput = document.getElementById('montoRecibido');
const monedaEnviadoInput = document.getElementById('monedaEnviado');
const monedaRecibidoInput = document.getElementById('monedaRecibido');
const tasaHint = document.getElementById('tasaHint');

function recalcularMontoRecibido() {
    const enviado = parseFloat(montoEnviadoInput.value);
    const tasa = parseFloat(tasaCambioInput.value);
    if (!isNaN(enviado) && !isNaN(tasa)) {
        const resultado = enviado * tasa;
        montoRecibidoInput.value = formatMoney(resultado, monedaRecibidoInput.value);
    } else {
        montoRecibidoInput.value = '—';
    }
}

[montoEnviadoInput, tasaCambioInput, monedaRecibidoInput].forEach(el => {
    el.addEventListener('input', recalcularMontoRecibido);
});

// ============================================
// FORMA DE PAGO — mostrar banco solo si es transferencia
// ============================================
const formaPagoSelect = document.getElementById('formaPago');
const bancoGroup = document.getElementById('bancoGroup');
const bancoOrigenInput = document.getElementById('bancoOrigen');
const comisionDestinoInput = document.getElementById('comisionDestino');
const comisionDestinoActivaInput = document.getElementById('comisionDestinoActiva');

comisionDestinoActivaInput.addEventListener('change', () => {
    comisionDestinoInput.disabled = !comisionDestinoActivaInput.checked;
    comisionDestinoInput.classList.toggle('input-readonly', !comisionDestinoActivaInput.checked);
});

function actualizarVisibilidadBanco() {
    if (formaPagoSelect.value === 'transferencia') {
        bancoGroup.classList.remove('hidden');
        bancoOrigenInput.required = true;
    } else {
        bancoGroup.classList.add('hidden');
        bancoOrigenInput.required = false;
        bancoOrigenInput.value = '';
    }
}

formaPagoSelect.addEventListener('change', actualizarVisibilidadBanco);
actualizarVisibilidadBanco();

const badgePagoLabel = (formaPago, banco) => {
    if (formaPago === 'transferencia') return `Transferencia${banco ? ' · ' + escapeHtml(banco) : ''}`;
    if (formaPago === 'caja_vecina') return 'Caja Vecina';
    return 'Efectivo';
};

// ============================================
// TASAS DE CAMBIO — automáticas (API en vivo) + manuales (Configuración)
// ============================================
let tasasCache = {};          // { "CLP_PEN": 0.1234, ... } — configuradas manualmente en Configuración
let tasasMercadoCache = {};   // { "CLP_PEN": 0.1234, ... } — tasa de mercado (sin margen) para calcular ganancia real
let liveRatesCache = {};      // { CLP: { PEN: 0.12, USD: 0.001, ... }, ... } — cacheadas por sesión
let liveRateFetchInFlight = {};
let isAutoFilling = false;    // evita marcar como "manual" el autollenado
let tasaManual = false;       // el usuario editó la tasa a mano para este par
let tasaReferenciaActual = null; // última tasa configurada/en vivo sugerida (para calcular margen luego)
let autocompletarTimeout = null;
let autocompletarToken = 0;

function claveTasa(origen, destino) {
    return `${(origen || '').trim().toUpperCase()}_${(destino || '').trim().toUpperCase()}`;
}

// Convierte un monto de una moneda a otra usando las tasas guardadas en
// Configuración (tasasCache). Prueba el par directo en ambos sentidos y, si
// no existe, intenta un puente pasando por CLP (la moneda base del negocio).
// Devuelve null si no hay ninguna tasa configurada que permita el cálculo.
function convertirMoneda(monto, desde, hacia) {
    if (desde === hacia) return monto;

    const tasaInversa = tasasCache[claveTasa(hacia, desde)]; // 1 hacia = X desde
    if (tasaInversa) return monto / tasaInversa;

    const tasaDirecta = tasasCache[claveTasa(desde, hacia)]; // 1 desde = X hacia
    if (tasaDirecta) return monto * tasaDirecta;

    if (desde !== 'CLP' && hacia !== 'CLP') {
        const enClp = convertirMoneda(monto, desde, 'CLP');
        if (enClp !== null) return convertirMoneda(enClp, 'CLP', hacia);
    }
    return null;
}

// Consulta (y cachea por sesión) las tasas en vivo de una moneda base
// usando el endpoint abierto y gratuito de ExchangeRate-API.
async function obtenerTasaEnVivo(origen, destino) {
    if (!liveRatesCache[origen]) {
        if (!liveRateFetchInFlight[origen]) {
            liveRateFetchInFlight[origen] = fetch(`https://open.er-api.com/v6/latest/${origen}`)
                .then(res => res.json())
                .then(json => {
                    if (json.result === 'success' && json.rates) {
                        liveRatesCache[origen] = json.rates;
                        return json.rates;
                    }
                    throw new Error('Respuesta inválida de la API de tasas');
                })
                .finally(() => { delete liveRateFetchInFlight[origen]; });
        }
        await liveRateFetchInFlight[origen];
    }
    const rates = liveRatesCache[origen];
    return rates ? rates[destino] : undefined;
}

function aplicarTasaAlFormulario(valor, tasaReferenciaReal) {
    isAutoFilling = true;
    tasaCambioInput.value = valor;
    isAutoFilling = false;
    // Si hay una tasa de mercado real guardada (costo, sin margen), esa es la referencia
    // para calcular ganancia. Si no, se usa la misma tasa ofrecida (comportamiento anterior).
    tasaReferenciaActual = (tasaReferenciaReal !== undefined && tasaReferenciaReal !== null)
        ? tasaReferenciaReal
        : valor;
    recalcularMontoRecibido();
}

async function intentarAutocompletarTasa() {
    const origen = monedaEnviadoInput.value.trim().toUpperCase();
    const destino = monedaRecibidoInput.value.trim().toUpperCase();

    if (!origen || !destino) {
        tasaHint.textContent = '';
        tasaHint.classList.remove('input-hint-active');
        return;
    }

    const guardada = tasasCache[claveTasa(origen, destino)];
    const mercadoGuardada = tasasMercadoCache[claveTasa(origen, destino)];

    // El usuario ya editó la tasa a mano para este par: no la pisamos,
    // solo avisamos si existe una tasa configurada distinta.
    if (tasaManual) {
        if (guardada !== undefined) {
            tasaHint.textContent = `Hay una tasa configurada (${guardada}), pero se mantiene el valor ingresado manualmente.`;
        } else {
            tasaHint.textContent = '';
        }
        tasaHint.classList.remove('input-hint-active');
        return;
    }

    // 1) Prioridad: tasa configurada manualmente en "Configuración"
    if (guardada !== undefined) {
        aplicarTasaAlFormulario(guardada, mercadoGuardada);
        tasaHint.textContent = `Tasa configurada manualmente (1 ${origen} = ${guardada} ${destino}).`;
        tasaHint.classList.add('input-hint-active');
        return;
    }

    // 2) No hay tasa configurada para este par: se limpia cualquier valor
    // anterior (puede ser de otro par de monedas, ej. quedó de CLP→VES)
    // para no confundir mientras se busca una tasa en vivo.
    isAutoFilling = true;
    tasaCambioInput.value = '';
    isAutoFilling = false;
    recalcularMontoRecibido();

    const token = ++autocompletarToken;
    tasaHint.textContent = 'Buscando tasa en vivo...';
    tasaHint.classList.remove('input-hint-active');

    try {
        const tasaViva = await obtenerTasaEnVivo(origen, destino);

        if (token !== autocompletarToken || tasaManual) return; // el usuario siguió escribiendo o editó a mano

        if (tasaViva !== undefined) {
            const tasaRedondeada = Number(tasaViva.toFixed(6));
            aplicarTasaAlFormulario(tasaRedondeada);
            tasaHint.textContent = `Tasa en vivo aproximada (1 ${origen} = ${tasaViva.toFixed(4)} ${destino}). Verifícala antes de confirmar.`;
            tasaHint.classList.add('input-hint-active');
        } else {
            tasaHint.textContent = `No se encontró una tasa en vivo para ${origen} → ${destino}. Ingresa el valor manualmente.`;
            tasaHint.classList.remove('input-hint-active');
        }
    } catch (error) {
        if (token !== autocompletarToken) return;
        console.error('Error obteniendo tasa en vivo:', error);
        tasaHint.textContent = 'No se pudo obtener una tasa en vivo. Ingresa el valor manualmente.';
        tasaHint.classList.remove('input-hint-active');
    }
}

function onMonedaInputChange() {
    clearTimeout(autocompletarTimeout);
    autocompletarTimeout = setTimeout(intentarAutocompletarTasa, 400);
}

[monedaEnviadoInput, monedaRecibidoInput].forEach(el => {
    el.addEventListener('input', onMonedaInputChange);
});

tasaCambioInput.addEventListener('input', () => {
    if (!isAutoFilling) tasaManual = true;
});

// ============================================
// CLIENTES — CRUD + caché para vincular remesas
// ============================================
let clientesCache = {};       // { "juan perez": { id, nombre, telefono, paisDestino, ... } } — clave normalizada por nombre
let clientesPorId = {};       // { docId: data }

function normalizarNombre(nombre) {
    return (nombre || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function formatClienteFecha(timestamp) {
    if (!timestamp || !timestamp.toDate) return '—';
    return timestamp.toDate().toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

const clienteForm = document.getElementById('clienteForm');
const clienteFormTitle = document.getElementById('clienteFormTitle');
const clienteDocIdInput = document.getElementById('clienteDocId');
const clienteFormNombreInput = document.getElementById('clienteFormNombre');
const clienteFormTelefonoInput = document.getElementById('clienteFormTelefono');
const clienteFormPaisDestinoInput = document.getElementById('clienteFormPaisDestino');
const clienteFormNotasInput = document.getElementById('clienteFormNotas');
const clienteSubmitBtn = document.getElementById('clienteSubmitBtn');
const clienteCancelBtn = document.getElementById('clienteCancelBtn');
const clienteMessage = document.getElementById('clienteMessage');
const clientesBody = document.getElementById('clientesBody');
const clientesEmpty = document.getElementById('clientesEmpty');
const clientesTableWrap = document.getElementById('clientesTableWrap');
const listaClientesDatalist = document.getElementById('listaClientes');
const clientesFiltroPais = document.getElementById('clientesFiltroPais');
const clientesFiltroBuscar = document.getElementById('clientesFiltroBuscar');
const clientesFiltroLimpiar = document.getElementById('clientesFiltroLimpiar');
// Guarda el listado completo de clientes (tal como llega de Firestore) para
// poder re-filtrar en el cliente sin volver a consultar.
let clientesListaCache = [];
// Subconjunto actualmente visible según los filtros de Clientes, usado para exportar.
let clientesFiltrado = [];

function resetClienteForm() {
    clienteForm.reset();
    clienteDocIdInput.value = '';
    clienteFormTitle.textContent = 'Nuevo cliente';
    clienteSubmitBtn.querySelector('.btn-text').textContent = 'Guardar cliente';
    clienteCancelBtn.classList.add('hidden');
    clienteMessage.textContent = '';
    clienteMessage.className = 'form-message';
}

clienteCancelBtn.addEventListener('click', resetClienteForm);

clienteForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const docId = clienteDocIdInput.value;
    const nombre = clienteFormNombreInput.value.trim();
    const claveNombre = normalizarNombre(nombre);

    // Evitar duplicados: si ya existe un cliente con ese nombre (y no es el que estamos editando), avisar.
    const existente = clientesCache[claveNombre];
    if (existente && existente.id !== docId) {
        clienteMessage.textContent = `Ya existe un cliente llamado "${nombre}". Edítalo en vez de crear uno nuevo.`;
        clienteMessage.className = 'form-message form-message-error';
        return;
    }

    const data = {
        nombre,
        telefono: clienteFormTelefonoInput.value.trim(),
        paisDestino: clienteFormPaisDestinoInput.value.trim(),
        notas: clienteFormNotasInput.value.trim(),
        actualizadoEn: firebase.firestore.FieldValue.serverTimestamp(),
        actualizadoPor: auth.currentUser ? auth.currentUser.email : null
    };

    clienteSubmitBtn.disabled = true;
    clienteSubmitBtn.querySelector('.btn-text').textContent = 'Guardando...';
    clienteSubmitBtn.querySelector('.spinner').classList.remove('hidden');
    clienteMessage.textContent = '';
    clienteMessage.className = 'form-message';

    try {
        if (docId) {
            await db.collection('clientes').doc(docId).update(data);
        } else {
            data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
            await db.collection('clientes').add(data);
        }
        resetClienteForm();
        clienteMessage.textContent = 'Cliente guardado correctamente.';
        clienteMessage.className = 'form-message form-message-success';
    } catch (error) {
        console.error('Error al guardar cliente:', error);
        clienteMessage.textContent = 'No se pudo guardar el cliente. Intenta de nuevo.';
        clienteMessage.className = 'form-message form-message-error';
    } finally {
        clienteSubmitBtn.disabled = false;
        clienteSubmitBtn.querySelector('.spinner').classList.add('hidden');
    }
});

window.editarCliente = (docId) => {
    const data = clientesPorId[docId];
    if (!data) return;

    clienteDocIdInput.value = docId;
    clienteFormNombreInput.value = data.nombre || '';
    clienteFormTelefonoInput.value = data.telefono || '';
    clienteFormPaisDestinoInput.value = data.paisDestino || '';
    clienteFormNotasInput.value = data.notas || '';
    clienteFormTitle.textContent = `Editando: ${data.nombre}`;
    clienteSubmitBtn.querySelector('.btn-text').textContent = 'Actualizar cliente';
    clienteCancelBtn.classList.remove('hidden');
    clienteMessage.textContent = '';
    clienteMessage.className = 'form-message';
    clienteFormNombreInput.focus();
    showSection('clientes');
};

window.eliminarCliente = async (docId) => {
    if (!confirm('¿Eliminar este cliente? Las remesas ya registradas no se verán afectadas.')) return;
    try {
        await db.collection('clientes').doc(docId).delete();
    } catch (error) {
        console.error('Error al eliminar cliente:', error);
        alert('No se pudo eliminar el cliente. Intenta de nuevo.');
    }
};

function renderClienteRow(docId, data) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
        <td>${escapeHtml(data.nombre) || '—'}</td>
        <td class="mono-cell">${escapeHtml(data.telefono) || '—'}</td>
        <td>${escapeHtml(data.paisDestino) || '—'}</td>
        <td>${formatClienteFecha(data.ultimaRemesaEn)}</td>
        <td>
            <button type="button" class="btn-icon-action" onclick="editarCliente('${docId}')"><i class="ti ti-pencil" aria-hidden="true"></i> Editar</button>
            <button type="button" class="btn-icon-action danger" onclick="eliminarCliente('${docId}')"><i class="ti ti-trash" aria-hidden="true"></i> Eliminar</button>
        </td>
    `;
    return tr;
}

db.collection('clientes').orderBy('nombre').onSnapshot(snapshot => {
    clientesCache = {};
    clientesPorId = {};
    listaClientesDatalist.innerHTML = '';

    const lista = [];
    snapshot.forEach(doc => {
        const data = doc.data();
        const entry = { id: doc.id, ...data };
        clientesCache[normalizarNombre(data.nombre)] = entry;
        clientesPorId[doc.id] = data;
        lista.push({ id: doc.id, data });

        const option = document.createElement('option');
        option.value = data.nombre;
        listaClientesDatalist.appendChild(option);
    });

    clientesListaCache = lista;
    poblarSelectPaisesClientes(lista);
    aplicarFiltroClientes();
}, error => {
    console.error('Error escuchando clientes:', error);
});

// Repuebla el <select> de país destino con los países que realmente
// aparecen en los clientes, conservando la selección actual si sigue existiendo.
function poblarSelectPaisesClientes(lista) {
    const paises = [...new Set(lista.map(({ data }) => data.paisDestino).filter(Boolean))].sort();
    const valorActual = clientesFiltroPais.value;
    clientesFiltroPais.innerHTML = '<option value="todos">Todos</option>' +
        paises.map(p => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join('');
    clientesFiltroPais.value = paises.includes(valorActual) ? valorActual : 'todos';
}

// Aplica los filtros de país destino y búsqueda por nombre/teléfono sobre
// clientesListaCache, y vuelve a pintar la tabla de Clientes.
function aplicarFiltroClientes() {
    const paisFiltro = clientesFiltroPais.value;
    const textoBusqueda = clientesFiltroBuscar.value.trim().toLowerCase();
    const hayFiltrosActivos = paisFiltro !== 'todos' || textoBusqueda !== '';

    const filtrados = clientesListaCache.filter(({ data }) => {
        if (paisFiltro !== 'todos' && data.paisDestino !== paisFiltro) return false;
        if (textoBusqueda) {
            const enNombre = (data.nombre || '').toLowerCase().includes(textoBusqueda);
            const enTelefono = (data.telefono || '').toLowerCase().includes(textoBusqueda);
            if (!enNombre && !enTelefono) return false;
        }
        return true;
    });

    actualizarPanelFiltros('clientes', [
        {
            label: 'País destino', activo: paisFiltro !== 'todos',
            texto: `País: ${paisFiltro}`,
            onQuitar: () => { clientesFiltroPais.value = 'todos'; aplicarFiltroClientes(); }
        },
        {
            label: 'Búsqueda', activo: textoBusqueda !== '',
            texto: `Nombre/teléfono: "${clientesFiltroBuscar.value.trim()}"`,
            onQuitar: () => { clientesFiltroBuscar.value = ''; aplicarFiltroClientes(); }
        }
    ], { mostrados: filtrados.length, total: clientesListaCache.length });

    clientesFiltrado = filtrados;
    clientesBody.innerHTML = '';
    if (filtrados.length === 0) {
        clientesEmpty.style.display = 'block';
        clientesTableWrap.style.display = 'none';
        clientesEmpty.querySelector('p').textContent = hayFiltrosActivos
            ? 'No hay clientes que coincidan con el filtro.'
            : 'Todavía no hay clientes registrados.';
        return;
    }
    clientesEmpty.style.display = 'none';
    clientesTableWrap.style.display = 'block';
    filtrados.forEach(({ id, data }) => {
        clientesBody.appendChild(renderClienteRow(id, data));
    });
}

clientesFiltroPais.addEventListener('change', aplicarFiltroClientes);
clientesFiltroBuscar.addEventListener('input', aplicarFiltroClientes);
clientesFiltroLimpiar.addEventListener('click', () => {
    clientesFiltroPais.value = 'todos';
    clientesFiltroBuscar.value = '';
    aplicarFiltroClientes();
});
initFiltrosToggle('clientes');

// ============================================
// EXPORTAR CLIENTES — PDF (jsPDF) y Excel (SheetJS)
// Exporta siempre lo que está visible en pantalla (respeta los filtros activos).
// ============================================
const clientesExportarPdfBtn = document.getElementById('clientesExportarPdfBtn');
const clientesExportarExcelBtn = document.getElementById('clientesExportarExcelBtn');

function filasExportClientes() {
    return clientesFiltrado.map(({ data }) => ({
        Nombre: data.nombre || '—',
        Teléfono: data.telefono || '—',
        'País destino': data.paisDestino || '—',
        'Última remesa': formatClienteFecha(data.ultimaRemesaEn)
    }));
}

clientesExportarPdfBtn.addEventListener('click', () => {
    if (clientesFiltrado.length === 0) {
        alert('No hay clientes para exportar con los filtros actuales.');
        return;
    }
    const filas = filasExportClientes();
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape' });

    doc.setFontSize(14);
    doc.text('Clientes', 14, 15);
    doc.setFontSize(10);
    doc.setTextColor(120);
    doc.text(`Generado el ${new Date().toLocaleDateString('es-CL')} · ${filas.length} cliente(s)`, 14, 21);

    doc.autoTable({
        startY: 26,
        head: [['Nombre', 'Teléfono', 'País destino', 'Última remesa']],
        body: filas.map(f => [f.Nombre, f.Teléfono, f['País destino'], f['Última remesa']]),
        styles: { fontSize: 8.5, cellPadding: 3 },
        headStyles: { fillColor: [30, 41, 59] },
        alternateRowStyles: { fillColor: [245, 246, 248] }
    });

    doc.save(`clientes-${fechaArchivo()}.pdf`);
});

clientesExportarExcelBtn.addEventListener('click', () => {
    if (clientesFiltrado.length === 0) {
        alert('No hay clientes para exportar con los filtros actuales.');
        return;
    }
    const filas = filasExportClientes();
    const hoja = XLSX.utils.json_to_sheet(filas);
    hoja['!cols'] = [{ wch: 24 }, { wch: 16 }, { wch: 16 }, { wch: 16 }];
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, 'Clientes');
    XLSX.writeFile(libro, `clientes-${fechaArchivo()}.xlsx`);
});

// Autocompletar teléfono en "Nueva Remesa" si el nombre coincide con un cliente existente
const clienteNombreInput = document.getElementById('clienteNombre');
const clienteIdInput = document.getElementById('clienteId');
const clienteTelefonoInput = document.getElementById('clienteTelefono');
const clienteHint = document.getElementById('clienteHint');

clienteNombreInput.addEventListener('input', () => {
    const match = clientesCache[normalizarNombre(clienteNombreInput.value)];
    if (match) {
        clienteIdInput.value = match.id;
        if (!clienteTelefonoInput.value.trim() && match.telefono) {
            clienteTelefonoInput.value = match.telefono;
        }
        clienteHint.textContent = 'Cliente existente — se vinculará a su historial.';
        clienteHint.classList.add('input-hint-active');
    } else {
        clienteIdInput.value = '';
        clienteHint.textContent = clienteNombreInput.value.trim() ? 'Cliente nuevo — se creará al guardar.' : '';
        clienteHint.classList.remove('input-hint-active');
    }
});

// ============================================
// NUEVA REMESA — envío del formulario
// ============================================
const remesaForm = document.getElementById('remesaForm');
const remesaDocIdInput = document.getElementById('remesaDocId');
const remesaSubmitBtn = document.getElementById('remesaSubmitBtn');
const remesaCancelBtn = document.getElementById('remesaCancelBtn');
const remesaMessage = document.getElementById('remesaMessage');
let remesasPorId = {};

function resetRemesaForm() {
    remesaForm.reset();
    remesaDocIdInput.value = '';
    montoRecibidoInput.value = '—';
    actualizarVisibilidadBanco();
    comisionDestinoInput.disabled = false;
    comisionDestinoInput.classList.remove('input-readonly');
    clienteIdInput.value = '';
    clienteHint.textContent = '';
    clienteHint.classList.remove('input-hint-active');
    tasaManual = false;
    tasaReferenciaActual = null;
    tasaHint.textContent = '';
    tasaHint.classList.remove('input-hint-active');
    remesaSubmitBtn.querySelector('.btn-text').textContent = 'Registrar remesa';
    remesaCancelBtn.classList.add('hidden');
    remesaMessage.textContent = '';
    intentarAutocompletarTasa(); // CLP/VES quedan precargados por defecto tras el reset, así que se reintenta el autocompletado
    remesaMessage.className = 'form-message';
}

remesaCancelBtn.addEventListener('click', resetRemesaForm);

remesaForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const remesaDocId = remesaDocIdInput.value;
    const montoEnviado = parseFloat(montoEnviadoInput.value);
    const tasaCambio = parseFloat(tasaCambioInput.value);
    const monedaRecibido = monedaRecibidoInput.value.trim().toUpperCase();
    const montoRecibido = montoEnviado * tasaCambio;
    const clienteNombre = clienteNombreInput.value.trim();
    const clienteTelefono = clienteTelefonoInput.value.trim();
    const formaPago = formaPagoSelect.value;
    const bancoOrigen = formaPago === 'transferencia' ? bancoOrigenInput.value.trim() : '';
    const comisionDestino = comisionDestinoActivaInput.checked ? (parseFloat(comisionDestinoInput.value) || 0) : 0;

    remesaSubmitBtn.disabled = true;
    remesaSubmitBtn.querySelector('.btn-text').textContent = 'Guardando...';
    remesaSubmitBtn.querySelector('.spinner').classList.remove('hidden');
    remesaMessage.textContent = '';
    remesaMessage.className = 'form-message';

    try {
        // Resolver el cliente: reutilizar uno existente o crear uno nuevo automáticamente
        let clienteId = clienteIdInput.value || null;
        const existente = clientesCache[normalizarNombre(clienteNombre)];

        if (existente) {
            clienteId = existente.id;
        } else {
            const nuevoCliente = await db.collection('clientes').add({
                nombre: clienteNombre,
                telefono: clienteTelefono,
                paisDestino: document.getElementById('paisDestino').value.trim(),
                notas: '',
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                actualizadoPor: auth.currentUser ? auth.currentUser.email : null
            });
            clienteId = nuevoCliente.id;
        }

        const data = {
            clienteId,
            clienteNombre,
            clienteTelefono,
            paisOrigen: document.getElementById('paisOrigen').value.trim(),
            paisDestino: document.getElementById('paisDestino').value.trim(),
            montoEnviado,
            monedaEnviado: document.getElementById('monedaEnviado').value.trim().toUpperCase(),
            tasaCambio,
            // Si no hay tasa de referencia (ej. la tasa se ingresó a mano y nunca se
            // autocompletó), se usa la misma tasa ofrecida como respaldo para que la
            // remesa igual aparezca en reportes (con ganancia $0 en vez de quedar oculta).
            tasaReferencia: tasaReferenciaActual != null ? tasaReferenciaActual : tasaCambio,
            montoRecibido,
            monedaRecibido,
            estado: document.getElementById('estado').value,
            formaPago,
            bancoOrigen,
            comisionDestino
        };

        let remesaIdGuardada = remesaDocId;
        const remesaAnterior = remesaDocId ? remesasPorId[remesaDocId] : null;
        if (remesaDocId) {
            data.actualizadoEn = firebase.firestore.FieldValue.serverTimestamp();
            data.actualizadoPor = auth.currentUser ? auth.currentUser.email : null;
            await db.collection('remesas').doc(remesaDocId).update(data);
        } else {
            data.creadoPor = auth.currentUser ? auth.currentUser.uid : null;
            data.creadoPorEmail = auth.currentUser ? auth.currentUser.email : null;
            data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
            const nuevaRemesa = await db.collection('remesas').add(data);
            remesaIdGuardada = nuevaRemesa.id;
        }

        if (remesaAnterior) {
            // Solo se registran los campos que realmente cambiaron
            const cambios = {};
            ['montoEnviado', 'monedaEnviado', 'tasaCambio', 'montoRecibido', 'monedaRecibido', 'estado', 'formaPago', 'comisionDestino'].forEach(campo => {
                if (data[campo] !== undefined && data[campo] !== remesaAnterior[campo]) {
                    cambios[campo] = { antes: remesaAnterior[campo] ?? null, despues: data[campo] };
                }
            });
            registrarAuditoria('remesa', 'editar', {
                remesaId: remesaIdGuardada,
                cliente: clienteNombre,
                cambios
            });
        } else {
            registrarAuditoria('remesa', 'crear', {
                remesaId: remesaIdGuardada,
                cliente: clienteNombre,
                montoEnviado,
                monedaEnviado: data.monedaEnviado,
                tasaCambio
            });
        }

        // Crear/actualizar/quitar el movimiento de caja automático ligado a esta remesa
        // (no bloqueante: si falla, la remesa igual queda guardada)
        sincronizarCajaDeRemesa(remesaIdGuardada, data).catch(err =>
            console.warn('No se pudo sincronizar la caja con la remesa:', err)
        );

        // Marcar la fecha de última remesa en el cliente (no bloqueante para el flujo principal)
        db.collection('clientes').doc(clienteId).update({
            ultimaRemesaEn: firebase.firestore.FieldValue.serverTimestamp()
        }).catch(err => console.warn('No se pudo actualizar ultimaRemesaEn:', err));

        const fueEdicion = !!remesaDocId;
        resetRemesaForm();
        remesaMessage.textContent = fueEdicion ? 'Remesa actualizada correctamente.' : 'Remesa registrada correctamente.';
        remesaMessage.className = 'form-message form-message-success';
    } catch (error) {
        console.error('Error al guardar remesa:', error);
        remesaMessage.textContent = 'No se pudo guardar la remesa. Intenta de nuevo.';
        remesaMessage.className = 'form-message form-message-error';
    } finally {
        remesaSubmitBtn.disabled = false;
        remesaSubmitBtn.querySelector('.btn-text').textContent = remesaDocIdInput.value ? 'Actualizar remesa' : 'Registrar remesa';
        remesaSubmitBtn.querySelector('.spinner').classList.add('hidden');
    }
});

window.editarRemesa = (docId) => {
    const r = remesasPorId[docId];
    if (!r) return;

    remesaDocIdInput.value = docId;
    clienteNombreInput.value = r.clienteNombre || '';
    clienteIdInput.value = r.clienteId || '';
    clienteTelefonoInput.value = r.clienteTelefono || '';
    document.getElementById('paisOrigen').value = r.paisOrigen || '';
    document.getElementById('paisDestino').value = r.paisDestino || '';
    montoEnviadoInput.value = r.montoEnviado != null ? r.montoEnviado : '';
    document.getElementById('monedaEnviado').value = r.monedaEnviado || '';
    tasaManual = true; // evita que el autocompletado pise la tasa original al editar
    tasaReferenciaActual = r.tasaReferencia != null ? r.tasaReferencia : null;
    tasaCambioInput.value = r.tasaCambio != null ? r.tasaCambio : '';
    monedaRecibidoInput.value = r.monedaRecibido || '';
    recalcularMontoRecibido();
    document.getElementById('estado').value = r.estado || 'pendiente';
    formaPagoSelect.value = r.formaPago || 'efectivo';
    actualizarVisibilidadBanco();
    bancoOrigenInput.value = r.bancoOrigen || '';
    comisionDestinoActivaInput.checked = !!(r.comisionDestino && r.comisionDestino > 0);
    comisionDestinoInput.value = r.comisionDestino != null && r.comisionDestino > 0 ? r.comisionDestino : 0.3;
    comisionDestinoInput.disabled = !comisionDestinoActivaInput.checked;
    comisionDestinoInput.classList.toggle('input-readonly', !comisionDestinoActivaInput.checked);

    remesaSubmitBtn.querySelector('.btn-text').textContent = 'Actualizar remesa';
    remesaCancelBtn.classList.remove('hidden');
    remesaMessage.textContent = '';
    remesaMessage.className = 'form-message';

    showSection('nueva');
};

window.eliminarRemesa = async (docId) => {
    if (!confirm('¿Eliminar esta remesa? Esta acción no se puede deshacer.')) return;
    const remesaEliminada = remesasPorId[docId] || null;
    try {
        await db.collection('remesas').doc(docId).delete();
        await eliminarMovimientosCajaDeRemesa(docId);
        registrarAuditoria('remesa', 'eliminar', {
            remesaId: docId,
            cliente: remesaEliminada ? remesaEliminada.clienteNombre : null,
            montoEnviado: remesaEliminada ? remesaEliminada.montoEnviado : null,
            monedaEnviado: remesaEliminada ? remesaEliminada.monedaEnviado : null
        });
    } catch (error) {
        console.error('Error al eliminar remesa:', error);
        alert('No se pudo eliminar la remesa. Intenta de nuevo.');
    }
};

// ============================================
// FILTROS — panel colapsable + chips de filtros activos
// (helpers genéricos reutilizados por Historial, Caja y Billetera)
// ============================================

// Activa el botón que abre/cierra el cuerpo de un panel de filtros.
// prefix: ej. 'historial', 'caja', 'billeteraMovs' → usa los ids
// {prefix}FiltrosPanel y {prefix}FiltrosToggle.
function initFiltrosToggle(prefix) {
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
function actualizarPanelFiltros(prefix, defs, resultado) {
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
// HISTORIAL + DASHBOARD — escucha en tiempo real
// ============================================
const historialBody = document.getElementById('historialBody');
const historialEmpty = document.getElementById('historialEmpty');
const historialEmptyText = document.getElementById('historialEmptyText');
const historialTableWrap = document.querySelector('#historial .table-wrap');
const dashboardPanel = document.querySelector('#dashboard .panel');

const historialFiltroEstado = document.getElementById('historialFiltroEstado');
const historialFiltroPago = document.getElementById('historialFiltroPago');
const historialFiltroOrigen = document.getElementById('historialFiltroOrigen');
const historialFiltroDestino = document.getElementById('historialFiltroDestino');
const historialFiltroBuscar = document.getElementById('historialFiltroBuscar');
const historialFiltroDesde = document.getElementById('historialFiltroDesde');
const historialFiltroHasta = document.getElementById('historialFiltroHasta');
const historialFiltroLimpiar = document.getElementById('historialFiltroLimpiar');

let historialCache = []; // [{ id, r }] — todas las remesas, sin filtrar
let historialFiltrado = []; // [{ id, r }] — subconjunto actualmente visible (según filtros), usado para exportar

function routeTagHTML(origen, destino) {
    const o = escapeHtml(origen);
    const d = escapeHtml(destino);
    return `
        <span class="route-tag" title="${o} → ${d}">
            <i class="dot dot-origin"></i><i class="route-line"></i><i class="dot dot-dest"></i>
        </span>
        <span class="route-text">${o} → ${d}</span>
    `;
}

function renderHistorialRow(id, r) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
        <td>${formatDate(r.createdAt)}</td>
        <td>${escapeHtml(r.clienteNombre) || '—'}</td>
        <td class="route-cell">${routeTagHTML(r.paisOrigen || '?', r.paisDestino || '?')}</td>
        <td class="mono-cell">${formatMoney(r.montoEnviado, r.monedaEnviado)}</td>
        <td class="mono-cell">${formatMoney(r.montoRecibido, r.monedaRecibido)}</td>
        <td>${badgePagoLabel(r.formaPago, r.bancoOrigen)}</td>
        <td><span class="${badgeClass(r.estado)}">${badgeLabel(r.estado)}</span></td>
        <td>
            <button type="button" class="btn-icon-action" onclick="editarRemesa('${id}')"><i class="ti ti-pencil" aria-hidden="true"></i> Editar</button>
            <button type="button" class="btn-icon-action danger" onclick="eliminarRemesa('${id}')"><i class="ti ti-trash" aria-hidden="true"></i> Eliminar</button>
        </td>
    `;
    return tr;
}

// Rellena un <select> de país con las opciones disponibles en los datos,
// conservando la selección actual si sigue siendo válida.
function poblarSelectPaises(selectEl, paises) {
    const valorActual = selectEl.value;
    selectEl.innerHTML = '<option value="todos">Todos</option>' +
        paises.map(p => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join('');
    if (paises.includes(valorActual)) {
        selectEl.value = valorActual;
    } else {
        selectEl.value = 'todos';
    }
}

// Aplica los filtros de estado, forma de pago, país de origen/destino y
// búsqueda por cliente sobre historialCache, y vuelve a pintar la tabla.
function aplicarFiltroHistorial() {
    const estadoFiltro = historialFiltroEstado.value;
    const pagoFiltro = historialFiltroPago.value;
    const origenFiltro = historialFiltroOrigen.value;
    const destinoFiltro = historialFiltroDestino.value;
    const textoBusqueda = historialFiltroBuscar.value.trim().toLowerCase();
    const desdeFiltro = historialFiltroDesde.value;
    const hastaFiltro = historialFiltroHasta.value;
    const hayFiltrosActivos = estadoFiltro !== 'todos' || pagoFiltro !== 'todos' ||
        origenFiltro !== 'todos' || destinoFiltro !== 'todos' || textoBusqueda !== '' ||
        desdeFiltro !== '' || hastaFiltro !== '';

    const filtrados = historialCache.filter(({ r }) => {
        if (estadoFiltro !== 'todos' && (r.estado || 'pendiente') !== estadoFiltro) return false;
        if (pagoFiltro !== 'todos' && (r.formaPago || 'efectivo') !== pagoFiltro) return false;
        if (origenFiltro !== 'todos' && r.paisOrigen !== origenFiltro) return false;
        if (destinoFiltro !== 'todos' && r.paisDestino !== destinoFiltro) return false;
        if (textoBusqueda && !(r.clienteNombre || '').toLowerCase().includes(textoBusqueda)) return false;
        if ((desdeFiltro || hastaFiltro) && !fechaEnRango(r.createdAt, desdeFiltro, hastaFiltro)) return false;
        return true;
    });

    actualizarPanelFiltros('historial', [
        {
            label: 'Estado', activo: estadoFiltro !== 'todos',
            texto: historialFiltroEstado.options[historialFiltroEstado.selectedIndex].text,
            onQuitar: () => { historialFiltroEstado.value = 'todos'; aplicarFiltroHistorial(); }
        },
        {
            label: 'Forma de pago', activo: pagoFiltro !== 'todos',
            texto: historialFiltroPago.options[historialFiltroPago.selectedIndex].text,
            onQuitar: () => { historialFiltroPago.value = 'todos'; aplicarFiltroHistorial(); }
        },
        {
            label: 'País de origen', activo: origenFiltro !== 'todos',
            texto: `Desde: ${origenFiltro}`,
            onQuitar: () => { historialFiltroOrigen.value = 'todos'; aplicarFiltroHistorial(); }
        },
        {
            label: 'País de destino', activo: destinoFiltro !== 'todos',
            texto: `Hacia: ${destinoFiltro}`,
            onQuitar: () => { historialFiltroDestino.value = 'todos'; aplicarFiltroHistorial(); }
        },
        {
            label: 'Rango de fechas', activo: !!desdeFiltro || !!hastaFiltro,
            texto: `Fecha: ${desdeFiltro || '…'} – ${hastaFiltro || '…'}`,
            onQuitar: () => { historialFiltroDesde.value = ''; historialFiltroHasta.value = ''; aplicarFiltroHistorial(); }
        },
        {
            label: 'Búsqueda', activo: textoBusqueda !== '',
            texto: `Cliente: "${historialFiltroBuscar.value.trim()}"`,
            onQuitar: () => { historialFiltroBuscar.value = ''; aplicarFiltroHistorial(); }
        }
    ], { mostrados: filtrados.length, total: historialCache.length });

    historialFiltrado = filtrados;

    historialBody.innerHTML = '';
    if (filtrados.length === 0) {
        historialEmpty.style.display = 'block';
        historialTableWrap.style.display = 'none';
        historialEmptyText.textContent = hayFiltrosActivos
            ? 'No hay remesas que coincidan con el filtro.'
            : 'Todavía no hay remesas registradas.';
        return;
    }
    historialEmpty.style.display = 'none';
    historialTableWrap.style.display = 'block';
    filtrados.forEach(({ id, r }) => {
        historialBody.appendChild(renderHistorialRow(id, r));
    });
}

[historialFiltroEstado, historialFiltroPago, historialFiltroOrigen, historialFiltroDestino, historialFiltroDesde, historialFiltroHasta].forEach(el => {
    el.addEventListener('change', aplicarFiltroHistorial);
});
historialFiltroBuscar.addEventListener('input', aplicarFiltroHistorial);
historialFiltroLimpiar.addEventListener('click', () => {
    historialFiltroEstado.value = 'todos';
    historialFiltroPago.value = 'todos';
    historialFiltroOrigen.value = 'todos';
    historialFiltroDestino.value = 'todos';
    historialFiltroBuscar.value = '';
    historialFiltroDesde.value = '';
    historialFiltroHasta.value = '';
    aplicarFiltroHistorial();
});
initFiltrosToggle('historial');

// ============================================
// EXPORTAR HISTORIAL — PDF (jsPDF) y Excel (SheetJS)
// Exporta siempre lo que está visible en pantalla, es decir,
// historialFiltrado (respeta los filtros activos).
// ============================================
const historialExportarPdfBtn = document.getElementById('historialExportarPdfBtn');
const historialExportarExcelBtn = document.getElementById('historialExportarExcelBtn');

// Variantes de texto plano (sin escapado HTML) de los formateadores de la tabla,
// para no arrastrar entidades como "&amp;" a un PDF o una celda de Excel.
const moneyTexto = (num, currency) => {
    if (num === null || num === undefined || isNaN(num)) return '—';
    return `${Number(num).toLocaleString('es-CL', { maximumFractionDigits: 2 })} ${currency || ''}`.trim();
};

const pagoTexto = (formaPago, banco) => {
    if (formaPago === 'transferencia') return `Transferencia${banco ? ' · ' + banco : ''}`;
    if (formaPago === 'caja_vecina') return 'Caja Vecina';
    return 'Efectivo';
};

const fechaArchivo = () => new Date().toISOString().slice(0, 10);

function filasExportHistorial() {
    return historialFiltrado.map(({ r }) => ({
        Fecha: formatDate(r.createdAt),
        Cliente: r.clienteNombre || '—',
        Origen: r.paisOrigen || '—',
        Destino: r.paisDestino || '—',
        Enviado: moneyTexto(r.montoEnviado, r.monedaEnviado),
        Recibido: moneyTexto(r.montoRecibido, r.monedaRecibido),
        Pago: pagoTexto(r.formaPago, r.bancoOrigen),
        Estado: badgeLabel(r.estado)
    }));
}

historialExportarPdfBtn.addEventListener('click', () => {
    if (historialFiltrado.length === 0) {
        alert('No hay remesas para exportar con los filtros actuales.');
        return;
    }
    const filas = filasExportHistorial();
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape' });

    doc.setFontSize(14);
    doc.text('Historial de remesas', 14, 15);
    doc.setFontSize(10);
    doc.setTextColor(120);
    doc.text(`Generado el ${new Date().toLocaleDateString('es-CL')} · ${filas.length} remesa(s)`, 14, 21);

    doc.autoTable({
        startY: 26,
        head: [['Fecha', 'Cliente', 'Origen', 'Destino', 'Enviado', 'Recibido', 'Pago', 'Estado']],
        body: filas.map(f => [f.Fecha, f.Cliente, f.Origen, f.Destino, f.Enviado, f.Recibido, f.Pago, f.Estado]),
        styles: { fontSize: 8.5, cellPadding: 3 },
        headStyles: { fillColor: [30, 41, 59] },
        alternateRowStyles: { fillColor: [245, 246, 248] }
    });

    doc.save(`historial-remesas-${fechaArchivo()}.pdf`);
});

historialExportarExcelBtn.addEventListener('click', () => {
    if (historialFiltrado.length === 0) {
        alert('No hay remesas para exportar con los filtros actuales.');
        return;
    }
    const filas = filasExportHistorial();
    const hoja = XLSX.utils.json_to_sheet(filas);
    hoja['!cols'] = [
        { wch: 12 }, { wch: 24 }, { wch: 14 }, { wch: 14 },
        { wch: 16 }, { wch: 16 }, { wch: 22 }, { wch: 12 }
    ];
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, 'Historial');
    XLSX.writeFile(libro, `historial-remesas-${fechaArchivo()}.xlsx`);
});

// ============================================
// DASHBOARD EJECUTIVO — caja disponible, totales convertidos,
// ganancia del día, operaciones y clientes atendidos hoy, y la
// última tasa realmente usada en una remesa.
// Se recalcula cada vez que cambian remesas, caja, cierres o tasas.
// ============================================
function actualizarDashboardEjecutivo() {
    const hoy = new Date();
    const esHoy = (ts) => ts && ts.toDate && ts.toDate().toDateString() === hoy.toDateString();
    const remesasHoy = historialCache.filter(({ r }) => esHoy(r.createdAt));

    const operacionesEl = document.querySelector('[data-stat="operaciones-dia"]');
    if (operacionesEl) operacionesEl.textContent = remesasHoy.length;

    const clientesHoy = new Set(remesasHoy.map(({ r }) => r.clienteNombre).filter(Boolean)).size;
    const clientesEl = document.querySelector('[data-stat="clientes-dia"]');
    if (clientesEl) clientesEl.textContent = clientesHoy;

    // Ganancia del día, agrupada por moneda de envío (igual que en Reportes),
    // solo considerando remesas que tienen tasa de referencia guardada.
    const gananciaPorMoneda = {};
    remesasHoy.forEach(({ r }) => {
        if (r.tasaReferencia == null || !(r.tasaReferencia > 0) || r.montoRecibido == null) return;
        const moneda = r.monedaEnviado || '?';
        gananciaPorMoneda[moneda] = (gananciaPorMoneda[moneda] || 0) + calcularGananciaNeta(r);
    });
    const gananciaEl = document.querySelector('[data-stat="ganancia-dia"]');
    if (gananciaEl) {
        const entradas = Object.entries(gananciaPorMoneda);
        gananciaEl.textContent = entradas.length === 0 ? '$0' : entradas.map(([m, v]) => formatMoney(v, m)).join(' · ');
    }

    // Última tasa realmente usada: la remesa más reciente con tasa registrada
    // (historialCache ya viene ordenado por createdAt descendente).
    const ultimaTasaEl = document.querySelector('[data-stat="ultima-tasa"]');
    const ultimaTasaHint = document.getElementById('dashUltimaTasaHint');
    const ultimaConTasa = historialCache.find(({ r }) => r.tasaCambio && r.monedaEnviado && r.monedaRecibido);
    if (ultimaTasaEl) {
        if (ultimaConTasa) {
            const { r } = ultimaConTasa;
            ultimaTasaEl.textContent = `1 ${r.monedaEnviado} = ${r.tasaCambio} ${r.monedaRecibido}`;
            if (ultimaTasaHint) {
                const fecha = r.createdAt && r.createdAt.toDate ? r.createdAt.toDate().toLocaleString('es-CL') : '—';
                ultimaTasaHint.textContent = `Usada el ${fecha}${r.clienteNombre ? ` · ${r.clienteNombre}` : ''}`;
            }
        } else {
            ultimaTasaEl.textContent = '—';
            if (ultimaTasaHint) ultimaTasaHint.textContent = 'Aún no hay remesas registradas';
        }
    }

    // Caja disponible: saldo real por moneda (caja abierta en vivo, o el
    // último saldo contado si está cerrada), igual que en la sección Caja.
    const { saldosPorMoneda } = calcularSaldosActuales(movimientosCajaActuales);
    const monedas = Object.keys(saldosPorMoneda).sort();
    const cajaDisponibleEl = document.getElementById('dashCajaDisponible');
    const cajaDisponibleHint = document.getElementById('dashCajaDisponibleHint');
    if (cajaDisponibleEl) {
        if (monedas.length === 0) {
            cajaDisponibleEl.textContent = '—';
            if (cajaDisponibleHint) cajaDisponibleHint.textContent = 'Sin movimientos de caja todavía';
        } else {
            cajaDisponibleEl.innerHTML = monedas.map(m => `
                <span class="stat-value-list-row">
                    <span class="stat-value-list-moneda">${escapeHtml(m)}</span>
                    <span>${formatMoney(saldosPorMoneda[m], '')}</span>
                </span>
            `).join('');
            if (cajaDisponibleHint) {
                cajaDisponibleHint.textContent = cierreAbiertoActual
                    ? 'Caja abierta · saldo en vivo'
                    : 'Caja cerrada · último saldo contado';
            }
        }
    }

    // Totales convertidos a USD y a moneda local (CLP), usando las tasas
    // configuradas en Configuración. Si falta una tasa para alguna moneda,
    // el total queda incompleto y se avisa en el hint (no se inventa un valor).
    let totalUsd = 0, totalUsdCompleto = true;
    let totalLocal = 0, totalLocalCompleto = true;
    monedas.forEach(m => {
        const enUsd = convertirMoneda(saldosPorMoneda[m], m, 'USDT');
        if (enUsd === null) totalUsdCompleto = false; else totalUsd += enUsd;
        const enLocal = convertirMoneda(saldosPorMoneda[m], m, 'CLP');
        if (enLocal === null) totalLocalCompleto = false; else totalLocal += enLocal;
    });

    const totalUsdEl = document.querySelector('[data-stat="total-usd"]');
    const totalUsdHint = document.getElementById('dashTotalUsdHint');
    if (totalUsdEl) {
        totalUsdEl.textContent = monedas.length === 0 ? '—' : formatMoney(totalUsd, 'USDT');
        if (totalUsdHint) {
            totalUsdHint.textContent = monedas.length === 0
                ? 'Sin saldo en caja'
                : (totalUsdCompleto ? 'Convertido con tus tasas configuradas' : 'Incompleto: falta una tasa a USDT para alguna moneda');
        }
    }

    const totalLocalEl = document.querySelector('[data-stat="total-local"]');
    const totalLocalHint = document.getElementById('dashTotalLocalHint');
    if (totalLocalEl) {
        totalLocalEl.textContent = monedas.length === 0 ? '—' : formatMoney(totalLocal, 'CLP');
        if (totalLocalHint) {
            totalLocalHint.textContent = monedas.length === 0
                ? 'Sin saldo en caja'
                : (totalLocalCompleto ? 'Convertido con tus tasas configuradas' : 'Incompleto: falta una tasa a CLP para alguna moneda');
        }
    }
}

db.collection('remesas').orderBy('createdAt', 'desc').onSnapshot(snapshot => {
    // --- Historial completo ---
    remesasPorId = {};
    historialCache = [];
    snapshot.forEach(doc => {
        remesasPorId[doc.id] = doc.data();
        historialCache.push({ id: doc.id, r: doc.data() });
    });

    const paisesOrigen = [...new Set(historialCache.map(({ r }) => r.paisOrigen).filter(Boolean))].sort();
    const paisesDestino = [...new Set(historialCache.map(({ r }) => r.paisDestino).filter(Boolean))].sort();
    poblarSelectPaises(historialFiltroOrigen, paisesOrigen);
    poblarSelectPaises(historialFiltroDestino, paisesDestino);
    poblarSelectPaises(reportesFiltroOrigen, paisesOrigen);
    poblarSelectPaises(reportesFiltroDestino, paisesDestino);

    aplicarFiltroHistorial();

    renderBoletas(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));

    // --- Dashboard ejecutivo: operaciones, clientes, ganancia y última tasa ---
    actualizarDashboardEjecutivo();

    // --- Últimas remesas en el dashboard (máx 5) ---
    const ultimasWrap = dashboardPanel.querySelector('.dashboard-latest-wrap');
    const ultimasEmpty = dashboardPanel.querySelector('.empty-state');

    if (snapshot.empty) {
        if (ultimasWrap) ultimasWrap.remove();
        if (ultimasEmpty) ultimasEmpty.style.display = 'block';
    } else {
        if (ultimasEmpty) ultimasEmpty.style.display = 'none';

        let wrap = dashboardPanel.querySelector('.dashboard-latest-wrap');
        if (!wrap) {
            wrap = document.createElement('div');
            wrap.className = 'dashboard-latest-wrap table-wrap';
            dashboardPanel.appendChild(wrap);
        }
        wrap.innerHTML = '<table class="data-table"><tbody></tbody></table>';
        const tbody = wrap.querySelector('tbody');
        snapshot.docs.slice(0, 5).forEach(doc => {
            const r = doc.data();
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${formatDate(r.createdAt)}</td>
                <td>${escapeHtml(r.clienteNombre) || '—'}</td>
                <td class="route-cell">${routeTagHTML(r.paisOrigen || '?', r.paisDestino || '?')}</td>
                <td class="mono-cell">${formatMoney(r.montoEnviado, r.monedaEnviado)}</td>
                <td><span class="${badgeClass(r.estado)}">${badgeLabel(r.estado)}</span></td>
            `;
            tbody.appendChild(tr);
        });
    }

    renderizarReportes();
}, error => {
    console.error('Error escuchando remesas:', error);
});

// ============================================
// CALCULADORA — movida a js/calculadora.js (script independiente,
// sin dependencia de Firebase, para que siempre funcione).
// ============================================

const tasaForm = document.getElementById('tasaForm');
const tasaDocIdInput = document.getElementById('tasaDocId');
const tasaMonedaOrigenInput = document.getElementById('tasaMonedaOrigen');
const tasaMonedaDestinoInput = document.getElementById('tasaMonedaDestino');
const tasaValorInput = document.getElementById('tasaValor');
const tasaSubmitBtn = document.getElementById('tasaSubmitBtn');
const tasaCancelBtn = document.getElementById('tasaCancelBtn');
const tasaLiveBtn = document.getElementById('tasaLiveBtn');
const tasaMessage = document.getElementById('tasaMessage');
const tasasBody = document.getElementById('tasasBody');
const tasasEmpty = document.getElementById('tasasEmpty');
const tasasTableWrap = document.querySelector('#config .table-wrap');

function formatTasaFecha(timestamp) {
    if (!timestamp || !timestamp.toDate) return '—';
    return timestamp.toDate().toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function resetTasaForm() {
    tasaForm.reset();
    tasaDocIdInput.value = '';
    tasaSubmitBtn.querySelector('.btn-text').textContent = 'Guardar tasa';
    tasaCancelBtn.classList.add('hidden');
    tasaMessage.textContent = '';
    tasaMessage.className = 'form-message';
}

tasaCancelBtn.addEventListener('click', resetTasaForm);

tasaLiveBtn.addEventListener('click', async () => {
    const origen = tasaMonedaOrigenInput.value.trim().toUpperCase();
    const destino = tasaMonedaDestinoInput.value.trim().toUpperCase();

    if (!origen || !destino) {
        tasaMessage.textContent = 'Ingresa la moneda de origen y destino primero.';
        tasaMessage.className = 'form-message form-message-error';
        return;
    }

    tasaLiveBtn.disabled = true;
    const textoOriginal = tasaLiveBtn.textContent;
    tasaLiveBtn.textContent = 'Buscando...';

    try {
        const tasaViva = await obtenerTasaEnVivo(origen, destino);
        if (tasaViva !== undefined) {
            tasaValorInput.value = Number(tasaViva.toFixed(6));
            tasaMessage.textContent = `Tasa en vivo cargada: 1 ${origen} = ${tasaViva.toFixed(4)} ${destino}. Revísala y guárdala si te parece correcta.`;
            tasaMessage.className = 'form-message form-message-success';
        } else {
            tasaMessage.textContent = `No se encontró una tasa en vivo para ${origen} → ${destino}.`;
            tasaMessage.className = 'form-message form-message-error';
        }
    } catch (error) {
        console.error('Error obteniendo tasa en vivo:', error);
        tasaMessage.textContent = 'No se pudo obtener la tasa en vivo. Intenta de nuevo.';
        tasaMessage.className = 'form-message form-message-error';
    } finally {
        tasaLiveBtn.disabled = false;
        tasaLiveBtn.textContent = textoOriginal;
    }
});

tasaForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const origen = tasaMonedaOrigenInput.value.trim().toUpperCase();
    const destino = tasaMonedaDestinoInput.value.trim().toUpperCase();
    const tasa = parseFloat(tasaValorInput.value);
    const tasaMercadoValorInput = document.getElementById('tasaMercadoValor');
    const tasaMercadoRaw = tasaMercadoValorInput ? parseFloat(tasaMercadoValorInput.value) : NaN;
    const tasaMercado = isNaN(tasaMercadoRaw) ? null : tasaMercadoRaw;
    const docId = claveTasa(origen, destino);
    const tasaAnterior = tasasCache[`__doc_${docId}`] || null;
    const esEdicion = !!tasaAnterior;

    tasaSubmitBtn.disabled = true;
    tasaSubmitBtn.querySelector('.btn-text').textContent = 'Guardando...';
    tasaSubmitBtn.querySelector('.spinner').classList.remove('hidden');
    tasaMessage.textContent = '';
    tasaMessage.className = 'form-message';

    try {
        await db.collection('tasasCambio').doc(docId).set({
            monedaOrigen: origen,
            monedaDestino: destino,
            tasa,
            tasaMercado,
            actualizadoEn: firebase.firestore.FieldValue.serverTimestamp(),
            actualizadoPor: auth.currentUser ? auth.currentUser.email : null
        }, { merge: true });

        registrarAuditoria('tasa', esEdicion ? 'editar' : 'crear', {
            par: `${origen}/${destino}`,
            tasaAnterior: tasaAnterior ? tasaAnterior.tasa : null,
            tasaNueva: tasa,
            tasaMercadoAnterior: tasaAnterior ? tasaAnterior.tasaMercado : null,
            tasaMercadoNueva: tasaMercado
        });

        resetTasaForm();
        tasaMessage.textContent = 'Tasa guardada correctamente.';
        tasaMessage.className = 'form-message form-message-success';
    } catch (error) {
        console.error('Error al guardar tasa de cambio:', error);
        tasaMessage.textContent = 'No se pudo guardar la tasa. Intenta de nuevo.';
        tasaMessage.className = 'form-message form-message-error';
    } finally {
        tasaSubmitBtn.disabled = false;
        tasaSubmitBtn.querySelector('.spinner').classList.add('hidden');
    }
});

window.editarTasa = (docId) => {
    const data = tasasCache[`__doc_${docId}`];
    if (!data) return;

    const tasaMercadoValorInput = document.getElementById('tasaMercadoValor');
    tasaDocIdInput.value = docId;
    tasaMonedaOrigenInput.value = data.monedaOrigen;
    tasaMonedaDestinoInput.value = data.monedaDestino;
    tasaValorInput.value = data.tasa;
    if (tasaMercadoValorInput) tasaMercadoValorInput.value = data.tasaMercado != null ? data.tasaMercado : '';
    tasaSubmitBtn.querySelector('.btn-text').textContent = 'Actualizar tasa';
    tasaCancelBtn.classList.remove('hidden');
    tasaMessage.textContent = '';
    tasaMessage.className = 'form-message';
    tasaMonedaOrigenInput.focus();
};

window.eliminarTasa = async (docId) => {
    if (!confirm('¿Eliminar esta tasa de cambio?')) return;
    const tasaEliminada = tasasCache[`__doc_${docId}`] || null;
    try {
        await db.collection('tasasCambio').doc(docId).delete();
        registrarAuditoria('tasa', 'eliminar', {
            par: tasaEliminada ? `${tasaEliminada.monedaOrigen}/${tasaEliminada.monedaDestino}` : docId,
            tasa: tasaEliminada ? tasaEliminada.tasa : null
        });
    } catch (error) {
        console.error('Error al eliminar tasa de cambio:', error);
        alert('No se pudo eliminar la tasa. Intenta de nuevo.');
    }
};

function renderTasaRow(docId, data) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
        <td>${escapeHtml(data.monedaOrigen)}</td>
        <td>${escapeHtml(data.monedaDestino)}</td>
        <td class="mono-cell">${data.tasa}</td>
        <td class="mono-cell">${data.tasaMercado != null ? data.tasaMercado : '—'}</td>
        <td>${formatTasaFecha(data.actualizadoEn)}</td>
        <td>
            <button type="button" class="btn-icon-action" onclick="compartirTasaImagen('${docId}')"><i class="ti ti-share-2" aria-hidden="true"></i> Compartir</button>
            <button type="button" class="btn-icon-action" onclick="editarTasa('${docId}')"><i class="ti ti-pencil" aria-hidden="true"></i> Editar</button>
            <button type="button" class="btn-icon-action danger" onclick="eliminarTasa('${docId}')"><i class="ti ti-trash" aria-hidden="true"></i> Eliminar</button>
        </td>
    `;
    return tr;
}

db.collection('tasasCambio').orderBy('monedaOrigen').onSnapshot(snapshot => {
    // Reconstruir la caché usada para el autocompletado en Nueva Remesa
    tasasCache = {};
    tasasMercadoCache = {};
    snapshot.forEach(doc => {
        const data = doc.data();
        const clave = claveTasa(data.monedaOrigen, data.monedaDestino);
        tasasCache[clave] = data.tasa;
        if (data.tasaMercado != null) tasasMercadoCache[clave] = data.tasaMercado;
        tasasCache[`__doc_${doc.id}`] = data;
    });

    // Re-evaluar el autocompletado por si el par actual ya tiene tasa
    intentarAutocompletarTasa();

    // Renderizar tabla de Configuración
    tasasBody.innerHTML = '';
    if (snapshot.empty) {
        tasasEmpty.style.display = 'block';
        tasasTableWrap.style.display = 'none';
    } else {
        tasasEmpty.style.display = 'none';
        tasasTableWrap.style.display = 'block';
        snapshot.forEach(doc => {
            tasasBody.appendChild(renderTasaRow(doc.id, doc.data()));
        });
    }

    actualizarDashboardEjecutivo();
}, error => {
    console.error('Error escuchando tasas de cambio:', error);
});

// ============================================
// CONCILIACIÓN SII — comparar boletas exentas emitidas
// (pegadas desde la web/CSV del SII) contra las remesas
// registradas en la app.
// ============================================
const conciliacionInput = document.getElementById('conciliacionInput');
const conciliacionArchivo = document.getElementById('conciliacionArchivo');
const conciliacionArchivoHint = document.getElementById('conciliacionArchivoHint');
const conciliacionBtn = document.getElementById('conciliacionBtn');
const conciliacionLimpiarBtn = document.getElementById('conciliacionLimpiarBtn');
const conciliacionMessage = document.getElementById('conciliacionMessage');
const conciliacionParseHint = document.getElementById('conciliacionParseHint');
const conciliacionResumen = document.getElementById('conciliacionResumen');
const conciliacionStatBoletas = document.getElementById('conciliacionStatBoletas');
const conciliacionStatRemesas = document.getElementById('conciliacionStatRemesas');
const conciliacionStatMatch = document.getElementById('conciliacionStatMatch');
const conciliacionStatSinPar = document.getElementById('conciliacionStatSinPar');
const conciliacionCoincidenciasPanel = document.getElementById('conciliacionCoincidenciasPanel');
const conciliacionCoincidenciasBody = document.getElementById('conciliacionCoincidenciasBody');
const conciliacionSinBoletaPanel = document.getElementById('conciliacionSinBoletaPanel');
const conciliacionSinBoletaBody = document.getElementById('conciliacionSinBoletaBody');
const conciliacionSinRemesaPanel = document.getElementById('conciliacionSinRemesaPanel');
const conciliacionSinRemesaBody = document.getElementById('conciliacionSinRemesaBody');

// --- Normalización de texto (para reconocer encabezados sin importar tildes/mayúsculas) ---
function normalizarTexto(str) {
    return (str || '')
        .toString()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // quita tildes
        .trim()
        .toLowerCase();
}

// --- Detecta el delimitador más probable de la tabla pegada ---
function detectarDelimitador(linea) {
    const candidatos = [
        { d: '\t', c: (linea.match(/\t/g) || []).length },
        { d: ';', c: (linea.match(/;/g) || []).length },
        { d: ',', c: (linea.match(/,/g) || []).length }
    ];
    candidatos.sort((a, b) => b.c - a.c);
    return candidatos[0].c > 0 ? candidatos[0].d : '\t';
}

// --- Parsea una línea respetando comillas si el delimitador es coma ---
function parsearLinea(linea, delimitador) {
    if (delimitador !== ',') return linea.split(delimitador).map(c => c.trim());
    const celdas = [];
    let actual = '';
    let dentroComillas = false;
    for (let i = 0; i < linea.length; i++) {
        const ch = linea[i];
        if (ch === '"') { dentroComillas = !dentroComillas; continue; }
        if (ch === ',' && !dentroComillas) { celdas.push(actual.trim()); actual = ''; continue; }
        actual += ch;
    }
    celdas.push(actual.trim());
    return celdas;
}

// --- Convierte un monto en formato chileno ("$ 15.000", "15000", "15.000,50") a número ---
function parsearMontoCLP(valor) {
    if (valor === null || valor === undefined) return NaN;
    let limpio = String(valor).replace(/[^\d.,-]/g, '');
    if (!limpio) return NaN;
    // Si tiene coma, se asume que la coma es el separador decimal y el punto es de miles
    if (limpio.includes(',')) {
        limpio = limpio.replace(/\./g, '').replace(',', '.');
    } else if ((limpio.match(/\./g) || []).length > 1) {
        // Varios puntos: son separadores de miles (ej. 1.234.567)
        limpio = limpio.replace(/\./g, '');
    }
    const numero = parseFloat(limpio);
    return isNaN(numero) ? NaN : Math.round(numero);
}

// --- Convierte una fecha en varios formatos comunes (dd-mm-yyyy, dd/mm/yyyy, yyyy-mm-dd) a Date ---
function parsearFechaSII(valor) {
    if (!valor) return null;
    const texto = String(valor).trim();
    let m = texto.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); // yyyy-mm-dd
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    m = texto.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/); // dd-mm-yyyy o dd/mm/yyyy
    if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
    const fallback = new Date(texto);
    return isNaN(fallback.getTime()) ? null : fallback;
}

function diferenciaEnDias(a, b) {
    if (!a || !b) return null;
    return Math.abs(Math.round((a.getTime() - b.getTime()) / 86400000));
}

// --- Parsea el texto pegado en boletas: [{ folio, fecha, monto, estado }] ---
function parsearBoletasPegadas(texto) {
    const lineas = texto.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
    if (lineas.length < 2) return { boletas: [], error: 'Pega al menos una fila de encabezado y una boleta.' };

    const delimitador = detectarDelimitador(lineas[0]);
    const encabezados = parsearLinea(lineas[0], delimitador).map(normalizarTexto);

    const buscarColumna = (...palabrasClave) => {
        for (const palabra of palabrasClave) {
            const idx = encabezados.findIndex(h => h.includes(palabra));
            if (idx !== -1) return idx;
        }
        return -1;
    };

    const idxFolio = buscarColumna('folio');
    const idxFecha = buscarColumna('fecha emision', 'fecha emisión', 'fecha');
    const idxMonto = buscarColumna('monto total', 'monto exento', 'monto neto', 'monto', 'total');
    const idxEstado = buscarColumna('estado');

    if (idxMonto === -1) {
        return { boletas: [], error: 'No se pudo identificar la columna de Monto. Verifica que la tabla tenga encabezados (Folio, Fecha, Monto, etc.).' };
    }

    const boletas = [];
    for (let i = 1; i < lineas.length; i++) {
        const celdas = parsearLinea(lineas[i], delimitador);
        const estado = idxEstado !== -1 ? normalizarTexto(celdas[idxEstado]) : '';
        if (estado.includes('anulad') || estado.includes('nula')) continue; // ignorar boletas anuladas

        const monto = parsearMontoCLP(celdas[idxMonto]);
        if (isNaN(monto) || monto <= 0) continue;

        boletas.push({
            folio: idxFolio !== -1 ? celdas[idxFolio] : `fila ${i + 1}`,
            fecha: idxFecha !== -1 ? parsearFechaSII(celdas[idxFecha]) : null,
            monto
        });
    }

    return { boletas, error: null, columnasDetectadas: { idxFolio, idxFecha, idxMonto, idxEstado } };
}

// --- Obtiene el monto en CLP de una remesa (según cuál lado del envío esté en CLP) ---
function montoCLPDeRemesa(r) {
    if ((r.monedaEnviado || '').toUpperCase() === 'CLP' && r.montoEnviado) return r.montoEnviado;
    if ((r.monedaRecibido || '').toUpperCase() === 'CLP' && r.montoRecibido) return r.montoRecibido;
    return null;
}

function limpiarResultadosConciliacion() {
    conciliacionResumen.classList.add('hidden');
    conciliacionCoincidenciasPanel.classList.add('hidden');
    conciliacionSinBoletaPanel.classList.add('hidden');
    conciliacionSinRemesaPanel.classList.add('hidden');
    conciliacionCoincidenciasBody.innerHTML = '';
    conciliacionSinBoletaBody.innerHTML = '';
    conciliacionSinRemesaBody.innerHTML = '';
    conciliacionMessage.textContent = '';
    conciliacionMessage.className = 'form-message';
    conciliacionLimpiarBtn.classList.add('hidden');
}

conciliacionLimpiarBtn.addEventListener('click', limpiarResultadosConciliacion);

function ejecutarConciliacion() {
    conciliacionMessage.textContent = '';
    conciliacionMessage.className = 'form-message';

    const { boletas, error } = parsearBoletasPegadas(conciliacionInput.value);
    if (error) {
        conciliacionMessage.textContent = error;
        conciliacionMessage.className = 'form-message form-message-error';
        return;
    }
    if (boletas.length === 0) {
        conciliacionMessage.textContent = 'No se encontraron boletas vigentes en el texto pegado.';
        conciliacionMessage.className = 'form-message form-message-error';
        return;
    }

    // Remesas candidatas: las que tienen un monto identificable en CLP y no están canceladas
    const remesas = Object.entries(remesasPorId)
        .map(([id, r]) => ({ id, ...r, montoCLP: montoCLPDeRemesa(r) }))
        .filter(r => r.montoCLP && r.estado !== 'cancelado');

    const boletasDisponibles = boletas.map(b => ({ ...b, usada: false }));
    const coincidencias = [];
    const remesasSinBoleta = [];

    // Se ordenan por fecha para que el emparejamiento sea más estable
    remesas.sort((a, b) => {
        const fa = a.createdAt && a.createdAt.toDate ? a.createdAt.toDate().getTime() : 0;
        const fb = b.createdAt && b.createdAt.toDate ? b.createdAt.toDate().getTime() : 0;
        return fa - fb;
    });

    remesas.forEach(r => {
        const fechaRemesa = r.createdAt && r.createdAt.toDate ? r.createdAt.toDate() : null;

        // Entre las boletas con el mismo monto (no usadas), se elige la de fecha más cercana
        let mejorIdx = -1;
        let mejorDiferencia = Infinity;
        boletasDisponibles.forEach((b, idx) => {
            if (b.usada || b.monto !== Math.round(r.montoCLP)) return;
            const diff = fechaRemesa && b.fecha ? diferenciaEnDias(fechaRemesa, b.fecha) : 0;
            if (diff < mejorDiferencia) { mejorDiferencia = diff; mejorIdx = idx; }
        });

        if (mejorIdx !== -1) {
            boletasDisponibles[mejorIdx].usada = true;
            coincidencias.push({ remesa: r, boleta: boletasDisponibles[mejorIdx] });
        } else {
            remesasSinBoleta.push(r);
        }
    });

    const boletasSinRemesa = boletasDisponibles.filter(b => !b.usada);

    // --- Render resumen ---
    conciliacionResumen.classList.remove('hidden');
    conciliacionStatBoletas.textContent = boletas.length;
    conciliacionStatRemesas.textContent = remesas.length;
    conciliacionStatMatch.textContent = coincidencias.length;
    conciliacionStatSinPar.textContent = remesasSinBoleta.length + boletasSinRemesa.length;

    // --- Render coincidencias ---
    if (coincidencias.length > 0) {
        conciliacionCoincidenciasPanel.classList.remove('hidden');
        coincidencias.forEach(({ remesa, boleta }) => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${formatDate(remesa.createdAt)}</td>
                <td>${escapeHtml(remesa.clienteNombre) || '—'}</td>
                <td class="mono-cell">${formatMoney(remesa.montoCLP, 'CLP')}</td>
                <td>${escapeHtml(boleta.folio)}</td>
                <td>${boleta.fecha ? boleta.fecha.toLocaleDateString('es-CL') : '—'}</td>
            `;
            conciliacionCoincidenciasBody.appendChild(tr);
        });
    }

    // --- Render remesas sin boleta ---
    if (remesasSinBoleta.length > 0) {
        conciliacionSinBoletaPanel.classList.remove('hidden');
        remesasSinBoleta.forEach(r => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${formatDate(r.createdAt)}</td>
                <td>${escapeHtml(r.clienteNombre) || '—'}</td>
                <td class="mono-cell">${formatMoney(r.montoCLP, 'CLP')}</td>
                <td><span class="${badgeClass(r.estado)}">${badgeLabel(r.estado)}</span></td>
            `;
            conciliacionSinBoletaBody.appendChild(tr);
        });
    }

    // --- Render boletas sin remesa ---
    if (boletasSinRemesa.length > 0) {
        conciliacionSinRemesaPanel.classList.remove('hidden');
        boletasSinRemesa.forEach(b => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${escapeHtml(b.folio)}</td>
                <td>${b.fecha ? b.fecha.toLocaleDateString('es-CL') : '—'}</td>
                <td class="mono-cell">${formatMoney(b.monto, 'CLP')}</td>
            `;
            conciliacionSinRemesaBody.appendChild(tr);
        });
    }

    conciliacionLimpiarBtn.classList.remove('hidden');
    conciliacionMessage.textContent = `Comparación lista: ${coincidencias.length} coincidencia(s) de ${boletas.length} boleta(s) y ${remesas.length} remesa(s) en CLP.`;
    conciliacionMessage.className = 'form-message form-message-success';
}

conciliacionBtn.addEventListener('click', ejecutarConciliacion);

// --- Subir archivo CSV directamente (en vez de copiar y pegar) ---
conciliacionArchivo.addEventListener('change', () => {
    const file = conciliacionArchivo.files[0];
    if (!file) return;

    conciliacionArchivoHint.textContent = 'Leyendo archivo...';
    conciliacionArchivoHint.classList.remove('input-hint-active');

    const reader = new FileReader();
    reader.onload = () => {
        conciliacionInput.value = reader.result;
        conciliacionArchivoHint.textContent = `Archivo "${file.name}" cargado. Revisa el texto y presiona "Comparar con remesas".`;
        conciliacionArchivoHint.classList.add('input-hint-active');
        ejecutarConciliacion();
    };
    reader.onerror = () => {
        conciliacionArchivoHint.textContent = 'No se pudo leer el archivo. Intenta pegarlo manualmente abajo.';
        conciliacionArchivoHint.classList.remove('input-hint-active');
    };
    reader.readAsText(file, 'UTF-8');
});

// ============================================
// REPORTES — ganancia por remesa (margen de tasa), volumen mensual
// por moneda destino, y gráfico de remesas por día.
// ============================================
const reportesPeriodo = document.getElementById('reportesPeriodo');
const reportesDesdeInput = document.getElementById('reportesDesde');
const reportesHastaInput = document.getElementById('reportesHasta');
const reportesRangoCustom = document.getElementById('reportesRangoCustom');
const reportesRangoCustomHasta = document.getElementById('reportesRangoCustomHasta');
const repStatCantidad = document.getElementById('repStatCantidad');
const repStatTicket = document.getElementById('repStatTicket');
const repStatGanancia = document.getElementById('repStatGanancia');
const repStatSinRef = document.getElementById('repStatSinRef');
const repChart = document.getElementById('repChart');
const repChartWrap = document.getElementById('repChartWrap');
const repChartEmpty = document.getElementById('repChartEmpty');
const repChartSubtitulo = document.getElementById('repChartSubtitulo');
const repVolumenBody = document.getElementById('repVolumenBody');
const repVolumenWrap = document.getElementById('repVolumenWrap');
const repVolumenEmpty = document.getElementById('repVolumenEmpty');
const repGananciaBody = document.getElementById('repGananciaBody');
const repGananciaWrap = document.getElementById('repGananciaWrap');
const repGananciaEmpty = document.getElementById('repGananciaEmpty');

// Snapshot del último render, usado por los botones de exportar (PDF/Excel)
// para que siempre exporten exactamente lo que se ve en pantalla.
let reportesExportState = {
    periodoLabel: '',
    stats: { cantidad: 0, ticket: '—', ganancia: '—', sinRef: 0 },
    volumen: [],   // [{ mes, moneda, count, total }]
    ganancia: []   // [{ fecha, cliente, enviado, tasaAplicada, tasaReferencia, gananciaNeta, monedaGanancia }]
};

// Filtros avanzados de Reportes (mismo patrón colapsable de Historial/Caja/Billetera)
const reportesFiltroEstado = document.getElementById('reportesFiltroEstado');
const reportesFiltroPago = document.getElementById('reportesFiltroPago');
const reportesFiltroOrigen = document.getElementById('reportesFiltroOrigen');
const reportesFiltroDestino = document.getElementById('reportesFiltroDestino');
const reportesFiltroBuscar = document.getElementById('reportesFiltroBuscar');
const reportesFiltroLimpiar = document.getElementById('reportesFiltroLimpiar');

initFiltrosToggle('reportes');

[reportesFiltroEstado, reportesFiltroPago, reportesFiltroOrigen, reportesFiltroDestino].forEach(el => {
    el.addEventListener('change', renderizarReportes);
});
reportesFiltroBuscar.addEventListener('input', renderizarReportes);
reportesFiltroLimpiar.addEventListener('click', () => {
    reportesFiltroEstado.value = 'todos';
    reportesFiltroPago.value = 'todos';
    reportesFiltroOrigen.value = 'todos';
    reportesFiltroDestino.value = 'todos';
    reportesFiltroBuscar.value = '';
    renderizarReportes();
});

reportesPeriodo.addEventListener('change', () => {
    const esCustom = reportesPeriodo.value === 'custom';
    reportesRangoCustom.classList.toggle('hidden', !esCustom);
    reportesRangoCustomHasta.classList.toggle('hidden', !esCustom);
    if (esCustom && !reportesDesdeInput.value) {
        // Rango por defecto al abrir "personalizado": este mes hasta hoy.
        const ahora = new Date();
        const inicioMes = new Date(ahora.getFullYear(), ahora.getMonth(), 1);
        reportesDesdeInput.value = claveDiaLocal(inicioMes);
        reportesHastaInput.value = claveDiaLocal(ahora);
    }
    renderizarReportes();
});
reportesDesdeInput.addEventListener('change', renderizarReportes);
reportesHastaInput.addEventListener('change', renderizarReportes);

function claveDiaLocal(fecha) {
    const y = fecha.getFullYear();
    const m = String(fecha.getMonth() + 1).padStart(2, '0');
    const d = String(fecha.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function claveMesLocal(fecha) {
    const y = fecha.getFullYear();
    const m = String(fecha.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
}

function nombreMesCapitalizado(claveMes) {
    const [y, m] = claveMes.split('-').map(Number);
    const fecha = new Date(y, m - 1, 1);
    const texto = fecha.toLocaleDateString('es-CL', { month: 'long', year: 'numeric' });
    return texto.charAt(0).toUpperCase() + texto.slice(1);
}

// Ganancia neta de una remesa: la diferencia entre lo que cobraste (montoEnviado)
// y lo que realmente te costó en tu moneda, valorado a la tasa de mercado
// (tasaReferencia, sin margen). Esto incluye TANTO el monto enviado al destinatario
// COMO la comisión bancaria extra (si aplica) — ambos salen de tu bolsillo.
function calcularGananciaNeta(r) {
    const comisionMonto = (r.montoRecibido || 0) * ((r.comisionDestino || 0) / 100);
    const costoTotalDestino = (r.montoRecibido || 0) + comisionMonto;
    return r.montoEnviado - (costoTotalDestino / r.tasaReferencia);
}

// Calcula el rango [desde, hasta) para cada opción de Periodo.
// "hasta" es un límite superior EXCLUSIVO (o null si no hay límite, es decir, incluye hasta ahora).
function calcularRangoPeriodo(periodo) {
    const ahora = new Date();
    let desde = null;
    let hasta = null;

    if (periodo === 'hoy') {
        desde = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
    } else if (periodo === 'ayer') {
        const ayer = new Date(ahora);
        ayer.setDate(ayer.getDate() - 1);
        desde = new Date(ayer.getFullYear(), ayer.getMonth(), ayer.getDate());
        hasta = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
    } else if (periodo === '7d') {
        desde = new Date(ahora);
        desde.setDate(desde.getDate() - 6);
        desde.setHours(0, 0, 0, 0);
    } else if (periodo === '30d') {
        desde = new Date(ahora);
        desde.setDate(desde.getDate() - 29);
        desde.setHours(0, 0, 0, 0);
    } else if (periodo === 'mes') {
        desde = new Date(ahora.getFullYear(), ahora.getMonth(), 1);
    } else if (periodo === 'mesAnterior') {
        desde = new Date(ahora.getFullYear(), ahora.getMonth() - 1, 1);
        hasta = new Date(ahora.getFullYear(), ahora.getMonth(), 1);
    } else if (periodo === 'anio') {
        desde = new Date(ahora.getFullYear(), 0, 1);
    } else if (periodo === 'custom') {
        const desdeStr = reportesDesdeInput ? reportesDesdeInput.value : '';
        const hastaStr = reportesHastaInput ? reportesHastaInput.value : '';
        if (desdeStr) {
            const [y, m, d] = desdeStr.split('-').map(Number);
            desde = new Date(y, m - 1, d);
        }
        if (hastaStr) {
            const [y, m, d] = hastaStr.split('-').map(Number);
            hasta = new Date(y, m - 1, d);
            hasta.setDate(hasta.getDate() + 1); // incluye todo el día "hasta"
        }
    } // 'todo' -> sin límites

    return { desde, hasta };
}

function renderizarReportes() {
    if (!reportesPeriodo) return;

    const periodo = reportesPeriodo.value;
    const { desde, hasta } = calcularRangoPeriodo(periodo);

    // Primero se acota solo por periodo (esto es lo que se usa como "total"
    // de referencia en el contador "X de Y" del panel de filtros).
    const enPeriodoSinFiltrosExtra = Object.entries(remesasPorId)
        .map(([id, r]) => ({ id, ...r }))
        .filter(r => {
            if (r.estado === 'cancelado') return false;
            if (!r.createdAt || !r.createdAt.toDate) return false;
            const fecha = r.createdAt.toDate();
            if (desde && fecha < desde) return false;
            if (hasta && fecha >= hasta) return false;
            return true;
        });

    // Luego se aplican los filtros avanzados (estado, forma de pago,
    // país de origen/destino y búsqueda por cliente).
    const estadoFiltro = reportesFiltroEstado.value;
    const pagoFiltro = reportesFiltroPago.value;
    const origenFiltro = reportesFiltroOrigen.value;
    const destinoFiltro = reportesFiltroDestino.value;
    const textoBusqueda = reportesFiltroBuscar.value.trim().toLowerCase();

    const enPeriodo = enPeriodoSinFiltrosExtra.filter(r => {
        if (estadoFiltro !== 'todos' && (r.estado || 'pendiente') !== estadoFiltro) return false;
        if (pagoFiltro !== 'todos' && (r.formaPago || 'efectivo') !== pagoFiltro) return false;
        if (origenFiltro !== 'todos' && r.paisOrigen !== origenFiltro) return false;
        if (destinoFiltro !== 'todos' && r.paisDestino !== destinoFiltro) return false;
        if (textoBusqueda && !(r.clienteNombre || '').toLowerCase().includes(textoBusqueda)) return false;
        return true;
    });

    actualizarPanelFiltros('reportes', [
        {
            label: 'Estado', activo: estadoFiltro !== 'todos',
            texto: reportesFiltroEstado.options[reportesFiltroEstado.selectedIndex].text,
            onQuitar: () => { reportesFiltroEstado.value = 'todos'; renderizarReportes(); }
        },
        {
            label: 'Forma de pago', activo: pagoFiltro !== 'todos',
            texto: reportesFiltroPago.options[reportesFiltroPago.selectedIndex].text,
            onQuitar: () => { reportesFiltroPago.value = 'todos'; renderizarReportes(); }
        },
        {
            label: 'País de origen', activo: origenFiltro !== 'todos',
            texto: `Desde: ${origenFiltro}`,
            onQuitar: () => { reportesFiltroOrigen.value = 'todos'; renderizarReportes(); }
        },
        {
            label: 'País de destino', activo: destinoFiltro !== 'todos',
            texto: `Hacia: ${destinoFiltro}`,
            onQuitar: () => { reportesFiltroDestino.value = 'todos'; renderizarReportes(); }
        },
        {
            label: 'Cliente', activo: textoBusqueda !== '',
            texto: `Cliente: "${reportesFiltroBuscar.value.trim()}"`,
            onQuitar: () => { reportesFiltroBuscar.value = ''; renderizarReportes(); }
        }
    ], { mostrados: enPeriodo.length, total: enPeriodoSinFiltrosExtra.length });

    // --- Stat: cantidad ---
    repStatCantidad.textContent = enPeriodo.length;

    // --- Stat: ticket promedio (en la moneda de envío más frecuente del periodo) ---
    const conteoMonedaEnviado = {};
    enPeriodo.forEach(r => {
        const m = (r.monedaEnviado || '').toUpperCase();
        if (m) conteoMonedaEnviado[m] = (conteoMonedaEnviado[m] || 0) + 1;
    });
    const monedaPrincipal = Object.entries(conteoMonedaEnviado).sort((a, b) => b[1] - a[1])[0];

    if (monedaPrincipal) {
        const moneda = monedaPrincipal[0];
        const delGrupo = enPeriodo.filter(r => (r.monedaEnviado || '').toUpperCase() === moneda);
        const totalEnviado = delGrupo.reduce((sum, r) => sum + (r.montoEnviado || 0), 0);
        repStatTicket.textContent = formatMoney(delGrupo.length ? totalEnviado / delGrupo.length : 0, moneda);
    } else {
        repStatTicket.textContent = '—';
    }

    // --- Stat: ganancia estimada (solo remesas con tasa de referencia guardada) ---
    const conReferencia = enPeriodo.filter(r => r.tasaReferencia != null && r.tasaReferencia > 0 && r.tasaCambio != null && r.montoRecibido != null);
    repStatSinRef.textContent = enPeriodo.length - conReferencia.length;

    const gananciaPorMoneda = {};
    conReferencia.forEach(r => {
        const ganancia = calcularGananciaNeta(r);
        const moneda = (r.monedaEnviado || '').toUpperCase();
        gananciaPorMoneda[moneda] = (gananciaPorMoneda[moneda] || 0) + ganancia;
    });
    const entradasGanancia = Object.entries(gananciaPorMoneda);
    repStatGanancia.textContent = entradasGanancia.length === 0
        ? '—'
        : entradasGanancia.map(([moneda, total]) => formatMoney(total, moneda)).join(' · ');

    reportesExportState.periodoLabel = reportesPeriodo.options[reportesPeriodo.selectedIndex].text;
    reportesExportState.stats = {
        cantidad: repStatCantidad.textContent,
        ticket: repStatTicket.textContent,
        ganancia: repStatGanancia.textContent,
        sinRef: repStatSinRef.textContent
    };

    renderizarGraficoDiario(enPeriodo, periodo, desde, hasta);
    renderizarVolumenMensual(enPeriodo);
    renderizarGananciaPorRemesa(conReferencia);
}

// Dibuja las barras del gráfico a partir de una lista de "buckets"
// ({ valor, label, mostrarEtiqueta, tooltip }). Usado tanto para vista diaria como mensual.
function pintarBarrasReportes(items) {
    const totalEnRango = items.reduce((sum, item) => sum + item.valor, 0);

    if (totalEnRango === 0) {
        repChartWrap.style.display = 'none';
        repChartEmpty.style.display = 'block';
        return;
    }
    repChartWrap.style.display = 'block';
    repChartEmpty.style.display = 'none';

    const max = Math.max(...items.map(item => item.valor), 1);
    repChart.innerHTML = '';
    items.forEach(item => {
        const alturaPct = item.valor > 0 ? Math.max((item.valor / max) * 100, 4) : 0;
        const bar = document.createElement('div');
        bar.className = 'rep-chart-bar';
        bar.title = item.tooltip;
        bar.innerHTML = `
            <div class="rep-chart-bar-fill" style="height:${alturaPct}%"></div>
            ${item.mostrarEtiqueta ? `<span class="rep-chart-bar-label">${item.label}</span>` : ''}
        `;
        repChart.appendChild(bar);
    });
}

function renderizarGraficoDiario(remesas, periodo, desde, hasta) {
    const ahora = new Date();
    let dias = [];
    let modoMensual = false;

    if (periodo === 'hoy') {
        dias = [new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate())];
        repChartSubtitulo.textContent = 'Hoy';
    } else if (periodo === 'ayer') {
        const ayer = new Date(ahora);
        ayer.setDate(ayer.getDate() - 1);
        dias = [new Date(ayer.getFullYear(), ayer.getMonth(), ayer.getDate())];
        repChartSubtitulo.textContent = 'Ayer';
    } else if (periodo === '7d') {
        for (let i = 6; i >= 0; i--) {
            const d = new Date(ahora);
            d.setDate(d.getDate() - i);
            dias.push(d);
        }
        repChartSubtitulo.textContent = 'Últimos 7 días';
    } else if (periodo === 'mes') {
        const inicio = new Date(ahora.getFullYear(), ahora.getMonth(), 1);
        const fin = new Date(ahora.getFullYear(), ahora.getMonth() + 1, 0);
        for (let d = new Date(inicio); d <= fin; d.setDate(d.getDate() + 1)) dias.push(new Date(d));
        repChartSubtitulo.textContent = 'Este mes';
    } else if (periodo === 'mesAnterior') {
        const inicio = new Date(ahora.getFullYear(), ahora.getMonth() - 1, 1);
        const fin = new Date(ahora.getFullYear(), ahora.getMonth(), 0);
        for (let d = new Date(inicio); d <= fin; d.setDate(d.getDate() + 1)) dias.push(new Date(d));
        repChartSubtitulo.textContent = 'Mes anterior';
    } else if (periodo === 'anio') {
        modoMensual = true;
    } else if (periodo === 'custom' && desde) {
        const finInclusive = new Date((hasta || ahora));
        if (hasta) finInclusive.setDate(finInclusive.getDate() - 1); // "hasta" es exclusivo
        const rangoDias = Math.round((finInclusive - desde) / 86400000) + 1;
        if (rangoDias > 62) {
            modoMensual = true;
        } else {
            for (let d = new Date(desde); d <= finInclusive; d.setDate(d.getDate() + 1)) dias.push(new Date(d));
            repChartSubtitulo.textContent = 'Rango personalizado';
        }
    } else {
        // '30d' y 'todo' (el gráfico siempre se acota a los últimos 30 días para que sea legible)
        for (let i = 29; i >= 0; i--) {
            const d = new Date(ahora);
            d.setDate(d.getDate() - i);
            dias.push(d);
        }
        repChartSubtitulo.textContent = periodo === 'todo' ? 'Últimos 30 días (de todo el historial)' : 'Últimos 30 días';
    }

    if (modoMensual) {
        renderizarGraficoMensual(remesas, periodo, desde, hasta);
        return;
    }

    const conteoPorDia = {};
    remesas.forEach(r => {
        if (!r.createdAt || !r.createdAt.toDate) return;
        const clave = claveDiaLocal(r.createdAt.toDate());
        conteoPorDia[clave] = (conteoPorDia[clave] || 0) + 1;
    });

    const items = dias.map((d, i) => ({
        valor: conteoPorDia[claveDiaLocal(d)] || 0,
        label: `${d.getDate()}/${d.getMonth() + 1}`,
        mostrarEtiqueta: d.getDate() === 1 || i === 0 || i === dias.length - 1,
        tooltip: `${d.toLocaleDateString('es-CL')}: ${conteoPorDia[claveDiaLocal(d)] || 0} remesa(s)`
    }));

    pintarBarrasReportes(items);
}

// Vista mensual del gráfico (usada para "Este año" y rangos personalizados largos,
// donde mostrar un punto por día dejaría de ser legible).
function renderizarGraficoMensual(remesas, periodo, desde, hasta) {
    const ahora = new Date();
    let inicioMes;
    let finMes; // primer día del último mes a incluir

    if (periodo === 'anio') {
        inicioMes = new Date(ahora.getFullYear(), 0, 1);
        finMes = new Date(ahora.getFullYear(), ahora.getMonth(), 1);
        repChartSubtitulo.textContent = 'Este año, por mes';
    } else {
        inicioMes = new Date(desde.getFullYear(), desde.getMonth(), 1);
        const finReferencia = hasta ? new Date(hasta.getTime() - 1) : ahora;
        finMes = new Date(finReferencia.getFullYear(), finReferencia.getMonth(), 1);
        repChartSubtitulo.textContent = 'Rango personalizado, por mes';
    }

    const meses = [];
    for (let m = new Date(inicioMes); m <= finMes; m.setMonth(m.getMonth() + 1)) meses.push(new Date(m));

    const conteoPorMes = {};
    remesas.forEach(r => {
        if (!r.createdAt || !r.createdAt.toDate) return;
        const clave = claveMesLocal(r.createdAt.toDate());
        conteoPorMes[clave] = (conteoPorMes[clave] || 0) + 1;
    });

    const items = meses.map(m => {
        const clave = claveMesLocal(m);
        const valor = conteoPorMes[clave] || 0;
        return {
            valor,
            label: m.toLocaleDateString('es-CL', { month: 'short' }).replace('.', ''),
            mostrarEtiqueta: true,
            tooltip: `${nombreMesCapitalizado(clave)}: ${valor} remesa(s)`
        };
    });

    pintarBarrasReportes(items);
}

function renderizarVolumenMensual(remesas) {
    const grupos = {};
    remesas.forEach(r => {
        if (!r.createdAt || !r.createdAt.toDate) return;
        const mes = claveMesLocal(r.createdAt.toDate());
        const moneda = (r.monedaRecibido || '—').toUpperCase();
        const clave = `${mes}|${moneda}`;
        if (!grupos[clave]) grupos[clave] = { mes, moneda, count: 0, total: 0 };
        grupos[clave].count += 1;
        grupos[clave].total += (r.montoRecibido || 0);
    });

    const filas = Object.values(grupos).sort((a, b) => {
        if (a.mes !== b.mes) return b.mes.localeCompare(a.mes);
        return b.total - a.total;
    });

    repVolumenBody.innerHTML = '';
    if (filas.length === 0) {
        repVolumenWrap.style.display = 'none';
        repVolumenEmpty.style.display = 'block';
        reportesExportState.volumen = [];
        return;
    }
    repVolumenWrap.style.display = 'block';
    repVolumenEmpty.style.display = 'none';

    reportesExportState.volumen = filas.map(f => ({
        mes: nombreMesCapitalizado(f.mes),
        moneda: f.moneda,
        count: f.count,
        total: f.total,
        totalTexto: moneyTexto(f.total, f.moneda)
    }));

    filas.forEach(f => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${nombreMesCapitalizado(f.mes)}</td>
            <td>${escapeHtml(f.moneda)}</td>
            <td>${f.count}</td>
            <td class="mono-cell">${formatMoney(f.total, f.moneda)}</td>
        `;
        repVolumenBody.appendChild(tr);
    });
}

function renderizarGananciaPorRemesa(conReferencia) {
    const filas = [...conReferencia].sort((a, b) => {
        const fa = a.createdAt && a.createdAt.toDate ? a.createdAt.toDate().getTime() : 0;
        const fb = b.createdAt && b.createdAt.toDate ? b.createdAt.toDate().getTime() : 0;
        return fb - fa;
    });

    repGananciaBody.innerHTML = '';
    if (filas.length === 0) {
        repGananciaWrap.style.display = 'none';
        repGananciaEmpty.style.display = 'block';
        reportesExportState.ganancia = [];
        return;
    }
    repGananciaWrap.style.display = 'block';
    repGananciaEmpty.style.display = 'none';

    reportesExportState.ganancia = filas.map(r => {
        const ganancia = calcularGananciaNeta(r);
        const moneda = (r.monedaEnviado || '').toUpperCase();
        return {
            fecha: formatDate(r.createdAt),
            cliente: r.clienteNombre || '—',
            enviado: moneyTexto(r.montoEnviado, r.monedaEnviado),
            tasaAplicada: r.tasaCambio,
            tasaReferencia: r.tasaReferencia,
            gananciaNeta: moneyTexto(ganancia, moneda)
        };
    });

    filas.forEach(r => {
        const ganancia = calcularGananciaNeta(r);
        const moneda = (r.monedaEnviado || '').toUpperCase();
        const claseGanancia = ganancia > 0 ? 'rep-ganancia-positiva' : (ganancia < 0 ? 'rep-ganancia-negativa' : 'rep-ganancia-cero');
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${formatDate(r.createdAt)}</td>
            <td>${escapeHtml(r.clienteNombre) || '—'}</td>
            <td class="mono-cell">${formatMoney(r.montoEnviado, r.monedaEnviado)}</td>
            <td class="mono-cell">${r.tasaCambio}</td>
            <td class="mono-cell">${r.tasaReferencia}</td>
            <td class="mono-cell ${claseGanancia}">${formatMoney(ganancia, moneda)}</td>
        `;
        repGananciaBody.appendChild(tr);
    });
}

// --- Exportar Reportes — PDF (jsPDF) y Excel (SheetJS) ---
// Exporta siempre lo que está visible en pantalla (respeta el periodo y los
// filtros avanzados activos), usando el snapshot guardado en reportesExportState.
const reportesExportarPdfBtn = document.getElementById('reportesExportarPdfBtn');
const reportesExportarExcelBtn = document.getElementById('reportesExportarExcelBtn');

reportesExportarPdfBtn.addEventListener('click', () => {
    const { stats, volumen, ganancia, periodoLabel } = reportesExportState;
    if (Number(stats.cantidad) === 0 && volumen.length === 0 && ganancia.length === 0) {
        alert('No hay datos para exportar con los filtros actuales.');
        return;
    }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape' });

    doc.setFontSize(14);
    doc.text('Reportes', 14, 15);
    doc.setFontSize(10);
    doc.setTextColor(120);
    doc.text(`Generado el ${new Date().toLocaleDateString('es-CL')} · Periodo: ${periodoLabel}`, 14, 21);

    doc.autoTable({
        startY: 26,
        head: [['Remesas', 'Ticket promedio', 'Ganancia neta estimada', 'Sin tasa de referencia']],
        body: [[stats.cantidad, stats.ticket, stats.ganancia, stats.sinRef]],
        styles: { fontSize: 8.5, cellPadding: 3 },
        headStyles: { fillColor: [30, 41, 59] }
    });

    let cursorY = doc.lastAutoTable.finalY + 10;

    if (volumen.length > 0) {
        doc.setFontSize(11);
        doc.setTextColor(0);
        doc.text('Volumen mensual por moneda destino', 14, cursorY);
        doc.autoTable({
            startY: cursorY + 4,
            head: [['Mes', 'Moneda', '# Remesas', 'Monto total recibido']],
            body: volumen.map(f => [f.mes, f.moneda, f.count, f.totalTexto]),
            styles: { fontSize: 8.5, cellPadding: 3 },
            headStyles: { fillColor: [30, 41, 59] },
            alternateRowStyles: { fillColor: [245, 246, 248] }
        });
        cursorY = doc.lastAutoTable.finalY + 10;
    }

    if (ganancia.length > 0) {
        if (cursorY > 180) { doc.addPage(); cursorY = 15; }
        doc.setFontSize(11);
        doc.setTextColor(0);
        doc.text('Ganancia por remesa', 14, cursorY);
        doc.autoTable({
            startY: cursorY + 4,
            head: [['Fecha', 'Cliente', 'Enviado', 'Tasa aplicada', 'Tasa referencia', 'Ganancia neta']],
            body: ganancia.map(g => [g.fecha, g.cliente, g.enviado, g.tasaAplicada, g.tasaReferencia, g.gananciaNeta]),
            styles: { fontSize: 8.5, cellPadding: 3 },
            headStyles: { fillColor: [30, 41, 59] },
            alternateRowStyles: { fillColor: [245, 246, 248] }
        });
    }

    doc.save(`reportes-${fechaArchivo()}.pdf`);
});

reportesExportarExcelBtn.addEventListener('click', () => {
    const { stats, volumen, ganancia, periodoLabel } = reportesExportState;
    if (Number(stats.cantidad) === 0 && volumen.length === 0 && ganancia.length === 0) {
        alert('No hay datos para exportar con los filtros actuales.');
        return;
    }
    const libro = XLSX.utils.book_new();

    const hojaResumen = XLSX.utils.json_to_sheet([{
        Periodo: periodoLabel,
        'Remesas en el periodo': stats.cantidad,
        'Ticket promedio': stats.ticket,
        'Ganancia neta estimada': stats.ganancia,
        'Sin tasa de referencia': stats.sinRef
    }]);
    hojaResumen['!cols'] = [{ wch: 18 }, { wch: 20 }, { wch: 18 }, { wch: 22 }, { wch: 20 }];
    XLSX.utils.book_append_sheet(libro, hojaResumen, 'Resumen');

    if (volumen.length > 0) {
        const hojaVolumen = XLSX.utils.json_to_sheet(volumen.map(f => ({
            Mes: f.mes,
            Moneda: f.moneda,
            '# Remesas': f.count,
            'Monto total recibido': f.totalTexto
        })));
        hojaVolumen['!cols'] = [{ wch: 14 }, { wch: 10 }, { wch: 12 }, { wch: 20 }];
        XLSX.utils.book_append_sheet(libro, hojaVolumen, 'Volumen mensual');
    }

    if (ganancia.length > 0) {
        const hojaGanancia = XLSX.utils.json_to_sheet(ganancia.map(g => ({
            Fecha: g.fecha,
            Cliente: g.cliente,
            Enviado: g.enviado,
            'Tasa aplicada': g.tasaAplicada,
            'Tasa referencia': g.tasaReferencia,
            'Ganancia neta': g.gananciaNeta
        })));
        hojaGanancia['!cols'] = [{ wch: 12 }, { wch: 24 }, { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 16 }];
        XLSX.utils.book_append_sheet(libro, hojaGanancia, 'Ganancia por remesa');
    }

    XLSX.writeFile(libro, `reportes-${fechaArchivo()}.xlsx`);
});

// ============================================
// CAJA — control de efectivo por moneda
// ============================================
const cajaColeccion = db.collection('movimientosCaja');

// --- Sincronización automática: cada remesa puede generar hasta TRES
// movimientos en movimientosCaja, ligados por remesaId y diferenciados por "rol":
//   - "ingreso_cliente": entrada en la moneda que paga el cliente, SIEMPRE que la
//      remesa esté activa, sin importar si pagó en efectivo o por transferencia.
//   - "salida_destino": salida en la moneda de destino, SIEMPRE que la remesa esté
//      activa, porque el envío al destino siempre se transfiere desde el saldo de
//      esa moneda en caja, sin importar cómo pagó el cliente.
//   - "comision_destino": salida EXTRA en la moneda de destino, solo si la remesa
//      tiene un % de comisión bancaria de destino (ej. 0.3% en pago móvil/
//      transferencias interbancarias en Venezuela). El destinatario recibe el
//      monto completo; esta comisión sale aparte de tu saldo.
// Si la remesa se edita (cambia forma de pago, monto, moneda, comisión o se
// cancela) o se elimina, los tres movimientos se actualizan/borran solos. ---
async function sincronizarCajaDeRemesa(remesaId, data) {
    if (!remesaId) return;

    const activa = data.estado !== 'cancelado';
    const montoComision = (data.montoRecibido || 0) * ((data.comisionDestino || 0) / 100);

    await sincronizarMovimientoCajaDeRemesa(remesaId, 'ingreso_cliente', {
        debeExistir: activa && data.montoEnviado > 0 && !!data.monedaEnviado,
        tipo: 'entrada',
        moneda: data.monedaEnviado,
        monto: data.montoEnviado,
        concepto: (() => {
            if (data.formaPago === 'efectivo') return `Remesa en efectivo — ${data.clienteNombre}`;
            if (data.formaPago === 'caja_vecina') return `Remesa por Caja Vecina — ${data.clienteNombre}`;
            return `Remesa por transferencia — ${data.clienteNombre}`;
        })()
    });

    await sincronizarMovimientoCajaDeRemesa(remesaId, 'salida_destino', {
        debeExistir: activa && data.montoRecibido > 0 && !!data.monedaRecibido,
        tipo: 'salida',
        moneda: data.monedaRecibido,
        monto: data.montoRecibido,
        concepto: `Envío a destino — ${data.clienteNombre}`
    });

    await sincronizarMovimientoCajaDeRemesa(remesaId, 'comision_destino', {
        debeExistir: activa && montoComision > 0 && !!data.monedaRecibido,
        tipo: 'salida',
        moneda: data.monedaRecibido,
        monto: montoComision,
        concepto: `Comisión bancaria (${data.comisionDestino}%) — ${data.clienteNombre}`
    });
}

async function sincronizarMovimientoCajaDeRemesa(remesaId, rol, { debeExistir, tipo, moneda, monto, concepto }) {
    const existentes = await cajaColeccion
        .where('remesaId', '==', remesaId)
        .where('rol', '==', rol)
        .limit(1)
        .get();

    if (!debeExistir) {
        if (!existentes.empty) {
            await Promise.all(existentes.docs.map(doc => doc.ref.delete()));
        }
        return;
    }

    const payload = {
        tipo,
        moneda,
        monto,
        concepto,
        origen: 'remesa',
        remesaId,
        rol,
        actualizadoEn: firebase.firestore.FieldValue.serverTimestamp()
    };

    if (existentes.empty) {
        payload.createdAt = firebase.firestore.FieldValue.serverTimestamp();
        await cajaColeccion.add(payload);
    } else {
        await existentes.docs[0].ref.update(payload);
    }
}

async function eliminarMovimientosCajaDeRemesa(remesaId) {
    const existentes = await cajaColeccion.where('remesaId', '==', remesaId).get();
    if (existentes.empty) return;
    await Promise.all(existentes.docs.map(doc => doc.ref.delete()));
}

// --- Formulario de movimiento manual ---
const cajaForm = document.getElementById('cajaForm');
const cajaSubmitBtn = document.getElementById('cajaSubmitBtn');
const cajaMessage = document.getElementById('cajaMessage');

cajaForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const tipo = document.getElementById('cajaTipo').value;
    const moneda = document.getElementById('cajaMoneda').value.trim().toUpperCase();
    const monto = parseFloat(document.getElementById('cajaMonto').value);
    const concepto = document.getElementById('cajaConcepto').value.trim();

    cajaSubmitBtn.disabled = true;
    cajaSubmitBtn.querySelector('.btn-text').textContent = 'Guardando...';
    cajaSubmitBtn.querySelector('.spinner').classList.remove('hidden');
    cajaMessage.textContent = '';
    cajaMessage.className = 'form-message';

    try {
        await cajaColeccion.add({
            tipo,
            moneda,
            monto,
            concepto,
            origen: 'manual',
            remesaId: null,
            clienteNombre: null,
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            creadoPorEmail: auth.currentUser ? auth.currentUser.email : null
        });

        cajaForm.reset();
        document.getElementById('cajaTipo').value = 'entrada';
        cajaMessage.textContent = 'Movimiento registrado correctamente.';
        cajaMessage.className = 'form-message form-message-success';
    } catch (error) {
        console.error('Error al registrar movimiento de caja:', error);
        cajaMessage.textContent = 'No se pudo registrar el movimiento. Intenta de nuevo.';
        cajaMessage.className = 'form-message form-message-error';
    } finally {
        cajaSubmitBtn.disabled = false;
        cajaSubmitBtn.querySelector('.btn-text').textContent = 'Registrar movimiento';
        cajaSubmitBtn.querySelector('.spinner').classList.add('hidden');
    }
});

window.eliminarMovimientoCaja = async (docId) => {
    if (!confirm('¿Eliminar este movimiento de caja? Esta acción no se puede deshacer.')) return;
    try {
        await cajaColeccion.doc(docId).delete();
    } catch (error) {
        console.error('Error al eliminar movimiento de caja:', error);
        alert('No se pudo eliminar el movimiento. Intenta de nuevo.');
    }
};

// --- Listado + saldos por moneda, en tiempo real ---
const cajaBody = document.getElementById('cajaBody');
const cajaEmpty = document.getElementById('cajaEmpty');
const cajaEmptyText = document.getElementById('cajaEmptyText');
const cajaTableWrap = document.getElementById('cajaTableWrap');
const cajaSaldosGrid = document.getElementById('cajaSaldosGrid');
const cajaSaldosEmpty = document.getElementById('cajaSaldosEmpty');
const cajaFiltroDesde = document.getElementById('cajaFiltroDesde');
const cajaFiltroHasta = document.getElementById('cajaFiltroHasta');
const cajaFiltroTipo = document.getElementById('cajaFiltroTipo');
const cajaFiltroMoneda = document.getElementById('cajaFiltroMoneda');
const cajaFiltroOrigen = document.getElementById('cajaFiltroOrigen');
const cajaFiltroBuscar = document.getElementById('cajaFiltroBuscar');
const cajaFiltroLimpiar = document.getElementById('cajaFiltroLimpiar');
// Guarda el listado completo de movimientos de caja (tal como llega de
// Firestore) para poder re-filtrar en el cliente sin volver a consultar.
let cajaMovsCache = [];
// Subconjunto actualmente visible según los filtros de Caja, usado para exportar.
let cajaFiltrado = [];

function origenBadgeHTML(mov) {
    if (mov.origen === 'remesa') return '<span class="badge badge-neutral">Remesa automática</span>';
    if (mov.origen === 'compra_usdt') return '<span class="badge badge-neutral">Compra USDT</span>';
    if (mov.origen === 'venta_usdt') return '<span class="badge badge-neutral">Venta USDT</span>';
    return '<span class="badge badge-pending">Manual</span>';
}

function tipoBadgeHTML(tipo) {
    return tipo === 'entrada'
        ? '<span class="badge badge-success">Entrada</span>'
        : '<span class="badge badge-danger">Salida</span>';
}

// Variantes en texto plano de los badges de arriba, para exportar a PDF/Excel.
function origenTexto(mov) {
    if (mov.origen === 'remesa') return 'Remesa automática';
    if (mov.origen === 'compra_usdt') return 'Compra USDT';
    if (mov.origen === 'venta_usdt') return 'Venta USDT';
    return 'Manual';
}

function tipoTexto(tipo) {
    return tipo === 'entrada' ? 'Entrada' : 'Salida';
}

function renderCajaRow(id, mov) {
    const tr = document.createElement('tr');
    const signo = mov.tipo === 'entrada' ? '+' : '−';
    tr.innerHTML = `
        <td>${formatDate(mov.createdAt)}</td>
        <td>${tipoBadgeHTML(mov.tipo)}</td>
        <td>${escapeHtml(mov.moneda)}</td>
        <td class="mono-cell">${signo} ${formatMoney(mov.monto, '')}</td>
        <td>${escapeHtml(mov.concepto) || '—'}</td>
        <td>${origenBadgeHTML(mov)}</td>
        <td>
            ${mov.origen === 'remesa'
                ? '<span class="input-hint">Se edita desde la remesa</span>'
                : `<button type="button" class="btn-icon-action danger" onclick="eliminarMovimientoCaja('${id}')"><i class="ti ti-trash" aria-hidden="true"></i> Eliminar</button>`}
        </td>
    `;
    return tr;
}

// Calcula el saldo "real" por moneda: si hay una caja abierta hoy, es el
// mismo cálculo que "Saldo esperado ahora" en el Cierre de caja diario
// (saldo inicial de ESA apertura + entradas/salidas SOLO desde que se abrió).
// Si no hay caja abierta, se muestra el acumulado histórico de todos los
// movimientos (con aviso), porque no hay una apertura vigente que sirva de base.
function calcularSaldosActuales(movimientos) {
    if (cierreAbiertoActual) {
        const { data } = cierreAbiertoActual;
        const abiertoEnFecha = data.abiertoEn && data.abiertoEn.toDate ? data.abiertoEn.toDate() : null;
        const abiertoEnMs = abiertoEnFecha ? abiertoEnFecha.getTime() : 0;
        const movsDesdeApertura = movimientos.filter(m => {
            const t = m.createdAt && m.createdAt.toDate ? m.createdAt.toDate().getTime() : 0;
            return t >= abiertoEnMs;
        });

        const monedas = new Set(Object.keys(data.saldosIniciales || {}));
        movsDesdeApertura.forEach(m => { if (m.moneda) monedas.add(m.moneda); });

        const saldosPorMoneda = {};
        monedas.forEach(moneda => {
            const inicial = (data.saldosIniciales && data.saldosIniciales[moneda]) || 0;
            const entradas = movsDesdeApertura
                .filter(m => m.moneda === moneda && m.tipo === 'entrada')
                .reduce((s, m) => s + (m.monto || 0), 0);
            const salidas = movsDesdeApertura
                .filter(m => m.moneda === moneda && m.tipo === 'salida')
                .reduce((s, m) => s + (m.monto || 0), 0);
            saldosPorMoneda[moneda] = inicial + entradas - salidas;
        });
        return { saldosPorMoneda, cajaAbierta: true };
    }

    // Sin caja abierta: se usa lo último que contaste al cerrar la caja
    // anterior (dato real), en vez de sumar todo el historial (que no
    // significa nada útil sin una apertura de referencia).
    if (ultimoCierreCerrado && ultimoCierreCerrado.data.saldosContados) {
        return { saldosPorMoneda: { ...ultimoCierreCerrado.data.saldosContados }, cajaAbierta: false, esUltimoContado: true };
    }

    // Si tampoco hay ningún cierre cerrado todavía, se cae al acumulado
    // histórico total como último recurso (con aviso).
    const saldosPorMoneda = {};
    movimientos.forEach(mov => {
        const moneda = mov.moneda || '?';
        const signo = mov.tipo === 'entrada' ? 1 : -1;
        saldosPorMoneda[moneda] = (saldosPorMoneda[moneda] || 0) + signo * (mov.monto || 0);
    });
    return { saldosPorMoneda, cajaAbierta: false, esUltimoContado: false };
}

function renderCajaSaldos(movimientos) {
    const { saldosPorMoneda, cajaAbierta, esUltimoContado } = calcularSaldosActuales(movimientos);
    const monedas = Object.keys(saldosPorMoneda).sort();
    cajaSaldosGrid.innerHTML = '';

    if (monedas.length === 0) {
        cajaSaldosGrid.style.display = 'none';
        cajaSaldosEmpty.style.display = 'block';
        return;
    }
    cajaSaldosGrid.style.display = 'grid';
    cajaSaldosEmpty.style.display = 'none';

    let avisoHTML = '';
    if (!cajaAbierta) {
        avisoHTML = esUltimoContado
            ? '<span class="cell-subtext"><i class="ti ti-clipboard" aria-hidden="true"></i> Sin caja abierta — esto es lo último que contaste al cerrar. Abre caja para ver el saldo en vivo.</span>'
            : '<span class="cell-subtext"><i class="ti ti-alert-triangle" aria-hidden="true"></i> Sin caja abierta ni cierres previos — esto es el acumulado histórico total, no el saldo real</span>';
    }

    monedas.forEach(moneda => {
        const saldo = saldosPorMoneda[moneda];
        const card = document.createElement('div');
        card.className = 'stat-card';
        card.innerHTML = `
            <span class="stat-label">Saldo en caja · ${escapeHtml(moneda)}</span>
            <span class="stat-value ${saldo < 0 ? 'stat-value-negative' : ''}">${formatMoney(saldo, moneda)}</span>
            ${equivalenteClpHTML(moneda, saldo)}
            ${avisoHTML}
        `;
        cajaSaldosGrid.appendChild(card);
    });
}

// Muestra "≈ X CLP" debajo del saldo de una moneda distinta a CLP, usando la
// tasa vigente guardada en Configuración para ese par (la misma que se
// autocompleta en Nueva Remesa) — para que sepas cuánto vale tu saldo sin
// tener que ir a calcularlo aparte.
function equivalenteClpHTML(moneda, saldo) {
    if (moneda === 'CLP') return '';
    const tasa = tasasCache[claveTasa('CLP', moneda)];
    if (!tasa || tasa <= 0) return '';
    const equivalente = saldo / tasa;
    return `<span class="cell-subtext">≈ ${formatMoney(equivalente, 'CLP')} (tasa vigente: 1 CLP = ${tasa} ${escapeHtml(moneda)})</span>`;
}

cajaColeccion.orderBy('createdAt', 'desc').onSnapshot(snapshot => {
    const movimientos = [];
    snapshot.forEach(doc => movimientos.push({ id: doc.id, ...doc.data() }));
    renderCajaSaldos(movimientos);
    renderBilletera(movimientos);

    movimientosCajaActuales = movimientos;
    actualizarVistaCierre();
    actualizarDashboardEjecutivo();

    cajaMovsCache = movimientos.map(mov => ({ id: mov.id, mov }));
    const monedasCaja = [...new Set(movimientos.map(m => m.moneda).filter(Boolean))].sort();
    poblarSelectMonedasCaja(monedasCaja);
    aplicarFiltroCaja();
}, error => {
    console.error('Error al escuchar movimientos de caja:', error);
});

// Repuebla el <select> de moneda con las monedas que realmente aparecen en
// los movimientos de caja, conservando la selección actual si sigue existiendo.
function poblarSelectMonedasCaja(monedas) {
    const valorActual = cajaFiltroMoneda.value;
    cajaFiltroMoneda.innerHTML = '<option value="todos">Todas</option>' +
        monedas.map(m => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('');
    cajaFiltroMoneda.value = monedas.includes(valorActual) ? valorActual : 'todos';
}

// Lee un input type="date" (yyyy-mm-dd) como fecha local, evitando el
// desfase de timezone que da `new Date('yyyy-mm-dd')` (que lo interpreta en UTC).
function leerFechaLocal(valor) {
    if (!valor) return null;
    const [y, m, d] = valor.split('-').map(Number);
    return new Date(y, m - 1, d);
}

// Aplica los filtros de fecha, tipo, moneda, origen y búsqueda por concepto
// sobre cajaMovsCache, y vuelve a pintar la tabla de Movimientos de caja.
function aplicarFiltroCaja() {
    const desde = leerFechaLocal(cajaFiltroDesde.value);
    let hasta = leerFechaLocal(cajaFiltroHasta.value);
    if (hasta) hasta.setDate(hasta.getDate() + 1); // incluye todo el día "hasta"
    const tipoFiltro = cajaFiltroTipo.value;
    const monedaFiltro = cajaFiltroMoneda.value;
    const origenFiltro = cajaFiltroOrigen.value;
    const textoBusqueda = cajaFiltroBuscar.value.trim().toLowerCase();
    const hayFiltrosActivos = !!desde || !!hasta || tipoFiltro !== 'todos' || monedaFiltro !== 'todos' || origenFiltro !== 'todos' || textoBusqueda !== '';

    const filtrados = cajaMovsCache.filter(({ mov }) => {
        if (desde || hasta) {
            const fecha = mov.createdAt && mov.createdAt.toDate ? mov.createdAt.toDate() : null;
            if (!fecha) return false;
            if (desde && fecha < desde) return false;
            if (hasta && fecha >= hasta) return false;
        }
        if (tipoFiltro !== 'todos' && mov.tipo !== tipoFiltro) return false;
        if (monedaFiltro !== 'todos' && mov.moneda !== monedaFiltro) return false;
        if (origenFiltro !== 'todos' && (mov.origen || 'manual') !== origenFiltro) return false;
        if (textoBusqueda && !(mov.concepto || '').toLowerCase().includes(textoBusqueda)) return false;
        return true;
    });

    actualizarPanelFiltros('caja', [
        {
            label: 'Rango de fechas', activo: !!cajaFiltroDesde.value || !!cajaFiltroHasta.value,
            texto: `Fecha: ${cajaFiltroDesde.value || '…'} – ${cajaFiltroHasta.value || '…'}`,
            onQuitar: () => { cajaFiltroDesde.value = ''; cajaFiltroHasta.value = ''; aplicarFiltroCaja(); }
        },
        {
            label: 'Tipo', activo: tipoFiltro !== 'todos',
            texto: cajaFiltroTipo.options[cajaFiltroTipo.selectedIndex].text,
            onQuitar: () => { cajaFiltroTipo.value = 'todos'; aplicarFiltroCaja(); }
        },
        {
            label: 'Moneda', activo: monedaFiltro !== 'todos',
            texto: `Moneda: ${monedaFiltro}`,
            onQuitar: () => { cajaFiltroMoneda.value = 'todos'; aplicarFiltroCaja(); }
        },
        {
            label: 'Origen', activo: origenFiltro !== 'todos',
            texto: cajaFiltroOrigen.options[cajaFiltroOrigen.selectedIndex].text,
            onQuitar: () => { cajaFiltroOrigen.value = 'todos'; aplicarFiltroCaja(); }
        },
        {
            label: 'Búsqueda', activo: textoBusqueda !== '',
            texto: `Concepto: "${cajaFiltroBuscar.value.trim()}"`,
            onQuitar: () => { cajaFiltroBuscar.value = ''; aplicarFiltroCaja(); }
        }
    ], { mostrados: filtrados.length, total: cajaMovsCache.length });

    cajaFiltrado = filtrados;
    cajaBody.innerHTML = '';
    if (filtrados.length === 0) {
        cajaEmpty.style.display = 'block';
        cajaTableWrap.style.display = 'none';
        cajaEmptyText.textContent = hayFiltrosActivos
            ? 'No hay movimientos que coincidan con el filtro.'
            : 'Todavía no hay movimientos registrados.';
        return;
    }
    cajaEmpty.style.display = 'none';
    cajaTableWrap.style.display = 'block';
    filtrados.forEach(({ id, mov }) => {
        cajaBody.appendChild(renderCajaRow(id, mov));
    });
}

[cajaFiltroTipo, cajaFiltroMoneda, cajaFiltroOrigen].forEach(el => {
    el.addEventListener('change', aplicarFiltroCaja);
});
[cajaFiltroDesde, cajaFiltroHasta].forEach(el => {
    el.addEventListener('change', aplicarFiltroCaja);
});
cajaFiltroBuscar.addEventListener('input', aplicarFiltroCaja);
cajaFiltroLimpiar.addEventListener('click', () => {
    cajaFiltroDesde.value = '';
    cajaFiltroHasta.value = '';
    cajaFiltroTipo.value = 'todos';
    cajaFiltroMoneda.value = 'todos';
    cajaFiltroOrigen.value = 'todos';
    cajaFiltroBuscar.value = '';
    aplicarFiltroCaja();
});
initFiltrosToggle('caja');

// ============================================
// EXPORTAR CAJA (Movimientos) — PDF (jsPDF) y Excel (SheetJS)
// Exporta siempre lo que está visible en pantalla (respeta los filtros activos).
// ============================================
const cajaExportarPdfBtn = document.getElementById('cajaExportarPdfBtn');
const cajaExportarExcelBtn = document.getElementById('cajaExportarExcelBtn');

function filasExportCaja() {
    return cajaFiltrado.map(({ mov }) => ({
        Fecha: formatDate(mov.createdAt),
        Tipo: tipoTexto(mov.tipo),
        Moneda: mov.moneda || '—',
        Monto: moneyTexto(mov.monto, ''),
        Concepto: mov.concepto || '—',
        Origen: origenTexto(mov)
    }));
}

cajaExportarPdfBtn.addEventListener('click', () => {
    if (cajaFiltrado.length === 0) {
        alert('No hay movimientos para exportar con los filtros actuales.');
        return;
    }
    const filas = filasExportCaja();
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape' });

    doc.setFontSize(14);
    doc.text('Caja — Movimientos', 14, 15);
    doc.setFontSize(10);
    doc.setTextColor(120);
    doc.text(`Generado el ${new Date().toLocaleDateString('es-CL')} · ${filas.length} movimiento(s)`, 14, 21);

    doc.autoTable({
        startY: 26,
        head: [['Fecha', 'Tipo', 'Moneda', 'Monto', 'Concepto', 'Origen']],
        body: filas.map(f => [f.Fecha, f.Tipo, f.Moneda, f.Monto, f.Concepto, f.Origen]),
        styles: { fontSize: 8.5, cellPadding: 3 },
        headStyles: { fillColor: [30, 41, 59] },
        alternateRowStyles: { fillColor: [245, 246, 248] }
    });

    doc.save(`caja-movimientos-${fechaArchivo()}.pdf`);
});

cajaExportarExcelBtn.addEventListener('click', () => {
    if (cajaFiltrado.length === 0) {
        alert('No hay movimientos para exportar con los filtros actuales.');
        return;
    }
    const filas = filasExportCaja();
    const hoja = XLSX.utils.json_to_sheet(filas);
    hoja['!cols'] = [{ wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 16 }, { wch: 26 }, { wch: 18 }];
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, 'Caja');
    XLSX.writeFile(libro, `caja-movimientos-${fechaArchivo()}.xlsx`);
});

// ============================================
// BILLETERA — control de compras de USDT con CLP
// ============================================
const billeteraForm = document.getElementById('billeteraForm');
const billeteraClpGastadoInput = document.getElementById('billeteraClpGastado');
const billeteraUsdtCompradoInput = document.getElementById('billeteraUsdtComprado');
const billeteraTasaCompraInput = document.getElementById('billeteraTasaCompra');
const billeteraConceptoInput = document.getElementById('billeteraConcepto');
const billeteraMessage = document.getElementById('billeteraMessage');
const billeteraSubmitBtn = document.getElementById('billeteraSubmitBtn');
const billeteraBody = document.getElementById('billeteraBody');
const billeteraTableWrap = document.getElementById('billeteraTableWrap');
const billeteraEmpty = document.getElementById('billeteraEmpty');
const billeteraComprasFiltroDesde = document.getElementById('billeteraComprasFiltroDesde');
const billeteraComprasFiltroHasta = document.getElementById('billeteraComprasFiltroHasta');
const billeteraComprasFiltroBuscar = document.getElementById('billeteraComprasFiltroBuscar');
const billeteraComprasFiltroLimpiar = document.getElementById('billeteraComprasFiltroLimpiar');
// Guarda el listado completo de compras de USDT para poder re-filtrar en el
// cliente sin volver a consultar.
let billeteraComprasCache = [];
// Subconjunto actualmente visible según los filtros de Historial de compras, usado para exportar.
let billeteraComprasFiltrado = [];
const billeteraSaldoUsdtEl = document.getElementById('billeteraSaldoUsdt');
const billeteraClpInvertidoEl = document.getElementById('billeteraClpInvertido');
const billeteraTasaPromedioEl = document.getElementById('billeteraTasaPromedio');
const billeteraTasaPromedioVentaEl = document.getElementById('billeteraTasaPromedioVenta');
const billeteraMovsBody = document.getElementById('billeteraMovsBody');
const billeteraMovsTableWrap = document.getElementById('billeteraMovsTableWrap');
const billeteraMovsEmpty = document.getElementById('billeteraMovsEmpty');
const billeteraMovsEmptyText = document.getElementById('billeteraMovsEmptyText');
const billeteraMovsFiltroTipo = document.getElementById('billeteraMovsFiltroTipo');
const billeteraMovsFiltroOrigen = document.getElementById('billeteraMovsFiltroOrigen');
const billeteraMovsFiltroBuscar = document.getElementById('billeteraMovsFiltroBuscar');
const billeteraMovsFiltroDesde = document.getElementById('billeteraMovsFiltroDesde');
const billeteraMovsFiltroHasta = document.getElementById('billeteraMovsFiltroHasta');
const billeteraMovsFiltroLimpiar = document.getElementById('billeteraMovsFiltroLimpiar');
// Guarda el listado completo (con saldo acumulado ya calculado) para poder
// re-filtrar en el cliente sin tener que recalcular saldos ni volver a
// consultar Firestore cada vez que cambia un filtro.
let billeteraMovsConSaldoCache = [];
// Subconjunto actualmente visible según los filtros de Todos los movimientos, usado para exportar.
let billeteraMovsFiltrado = [];
const billeteraVentaForm = document.getElementById('billeteraVentaForm');
const billeteraUsdtVendidoInput = document.getElementById('billeteraUsdtVendido');
const billeteraVesRecibidoInput = document.getElementById('billeteraVesRecibido');
const billeteraComisionUsdtInput = document.getElementById('billeteraComisionUsdt');
const billeteraTasaVentaInput = document.getElementById('billeteraTasaVenta');
const billeteraVentaConceptoInput = document.getElementById('billeteraVentaConcepto');
const billeteraVentaMessage = document.getElementById('billeteraVentaMessage');
const billeteraVentaSubmitBtn = document.getElementById('billeteraVentaSubmitBtn');
const billeteraVentasBody = document.getElementById('billeteraVentasBody');
const billeteraVentasTableWrap = document.getElementById('billeteraVentasTableWrap');
const billeteraVentasEmpty = document.getElementById('billeteraVentasEmpty');
const billeteraVentasFiltroDesde = document.getElementById('billeteraVentasFiltroDesde');
const billeteraVentasFiltroHasta = document.getElementById('billeteraVentasFiltroHasta');
const billeteraVentasFiltroBuscar = document.getElementById('billeteraVentasFiltroBuscar');
const billeteraVentasFiltroLimpiar = document.getElementById('billeteraVentasFiltroLimpiar');
// Guarda el listado completo de ventas de USDT para poder re-filtrar en el
// cliente sin volver a consultar.
let billeteraVentasCache = [];
// Subconjunto actualmente visible según los filtros de Historial de ventas, usado para exportar.
let billeteraVentasFiltrado = [];

function recalcularTasaCompraBilletera() {
    const clp = parseFloat(billeteraClpGastadoInput.value);
    const usdt = parseFloat(billeteraUsdtCompradoInput.value);
    billeteraTasaCompraInput.value = (!isNaN(clp) && !isNaN(usdt) && usdt > 0)
        ? formatMoney(clp / usdt, 'CLP')
        : '—';
}
[billeteraClpGastadoInput, billeteraUsdtCompradoInput].forEach(el => {
    el.addEventListener('input', recalcularTasaCompraBilletera);
});

function recalcularTasaVentaBilletera() {
    const usdt = parseFloat(billeteraUsdtVendidoInput.value);
    const ves = parseFloat(billeteraVesRecibidoInput.value);
    billeteraTasaVentaInput.value = (!isNaN(usdt) && !isNaN(ves) && usdt > 0)
        ? formatMoney(ves / usdt, 'VES')
        : '—';
}
[billeteraUsdtVendidoInput, billeteraVesRecibidoInput].forEach(el => {
    el.addEventListener('input', recalcularTasaVentaBilletera);
});

function renderBilletera(movimientos) {
    // Saldo actual de USDT: TODO lo que entra y sale en esa moneda, incluyendo
    // compras aquí y lo enviado en remesas pagadas directo en USDT.
    let entradasUsdt = 0;
    let salidasUsdt = 0;
    let clpInvertidoTotal = 0;
    let usdtCompradoTotal = 0;
    let vesRecibidoTotal = 0;
    let usdtVendidoTotal = 0;
    const compras = [];
    const ventas = [];
    const movimientosUsdt = [];

    movimientos.forEach(mov => {
        if ((mov.moneda || '').toUpperCase() === 'USDT') {
            if (mov.tipo === 'entrada') entradasUsdt += (mov.monto || 0);
            else salidasUsdt += (mov.monto || 0);
            movimientosUsdt.push(mov);
        }
        if (mov.origen === 'compra_usdt' && mov.tipo === 'entrada') {
            compras.push(mov);
            clpInvertidoTotal += (mov.clpGastado || 0);
            usdtCompradoTotal += (mov.monto || 0);
        }
        if (mov.origen === 'venta_usdt' && mov.tipo === 'salida') {
            ventas.push(mov);
            vesRecibidoTotal += (mov.vesRecibido || 0);
            usdtVendidoTotal += (mov.monto || 0);
        }
    });

    const saldoUsdt = entradasUsdt - salidasUsdt;
    billeteraSaldoUsdtEl.textContent = formatMoney(saldoUsdt, 'USDT');
    billeteraSaldoUsdtEl.classList.toggle('stat-value-negative', saldoUsdt < 0);
    billeteraClpInvertidoEl.textContent = formatMoney(clpInvertidoTotal, 'CLP');
    billeteraTasaPromedioEl.textContent = usdtCompradoTotal > 0
        ? formatMoney(clpInvertidoTotal / usdtCompradoTotal, 'CLP')
        : '—';
    billeteraTasaPromedioVentaEl.textContent = usdtVendidoTotal > 0
        ? formatMoney(vesRecibidoTotal / usdtVendidoTotal, 'VES')
        : '—';

    renderBilleteraCompras(compras);
    renderBilleteraVentas(ventas);
    renderBilleteraMovimientos(movimientosUsdt);
}

function renderBilleteraMovimientos(movimientosUsdt) {
    // movimientosUsdt viene ordenado de más nuevo a más antiguo (así llega la
    // consulta de Caja). Para calcular el saldo acumulado hay que recorrerlo
    // de más antiguo a más nuevo, y luego mostrarlo en el orden original.
    const cronologico = movimientosUsdt.slice().reverse();
    let saldoCorrido = 0;
    const conSaldo = cronologico.map(mov => {
        saldoCorrido += (mov.tipo === 'entrada' ? 1 : -1) * (mov.monto || 0);
        return { mov, saldo: saldoCorrido };
    }).reverse();

    billeteraMovsConSaldoCache = conSaldo;
    aplicarFiltroBilleteraMovs();
}

// Aplica los filtros de tipo, origen y búsqueda por concepto sobre el listado
// ya calculado en billeteraMovsConSaldoCache. El saldo mostrado en cada fila
// siempre corresponde al histórico completo (no cambia según el filtro), solo
// se decide qué filas mostrar.
function aplicarFiltroBilleteraMovs() {
    const tipoFiltro = billeteraMovsFiltroTipo.value;
    const origenFiltro = billeteraMovsFiltroOrigen.value;
    const textoBusqueda = billeteraMovsFiltroBuscar.value.trim().toLowerCase();
    const desdeFiltro = billeteraMovsFiltroDesde.value;
    const hastaFiltro = billeteraMovsFiltroHasta.value;
    const hayFiltrosActivos = tipoFiltro !== 'todos' || origenFiltro !== 'todos' || textoBusqueda !== '' ||
        desdeFiltro !== '' || hastaFiltro !== '';

    const filtrados = billeteraMovsConSaldoCache.filter(({ mov }) => {
        if (tipoFiltro !== 'todos' && mov.tipo !== tipoFiltro) return false;
        if (origenFiltro !== 'todos' && (mov.origen || 'manual') !== origenFiltro) return false;
        if (textoBusqueda && !(mov.concepto || '').toLowerCase().includes(textoBusqueda)) return false;
        if ((desdeFiltro || hastaFiltro) && !fechaEnRango(mov.createdAt, desdeFiltro, hastaFiltro)) return false;
        return true;
    });

    actualizarPanelFiltros('billeteraMovs', [
        {
            label: 'Tipo', activo: tipoFiltro !== 'todos',
            texto: billeteraMovsFiltroTipo.options[billeteraMovsFiltroTipo.selectedIndex].text,
            onQuitar: () => { billeteraMovsFiltroTipo.value = 'todos'; aplicarFiltroBilleteraMovs(); }
        },
        {
            label: 'Origen', activo: origenFiltro !== 'todos',
            texto: billeteraMovsFiltroOrigen.options[billeteraMovsFiltroOrigen.selectedIndex].text,
            onQuitar: () => { billeteraMovsFiltroOrigen.value = 'todos'; aplicarFiltroBilleteraMovs(); }
        },
        {
            label: 'Rango de fechas', activo: !!desdeFiltro || !!hastaFiltro,
            texto: `Fecha: ${desdeFiltro || '…'} – ${hastaFiltro || '…'}`,
            onQuitar: () => { billeteraMovsFiltroDesde.value = ''; billeteraMovsFiltroHasta.value = ''; aplicarFiltroBilleteraMovs(); }
        },
        {
            label: 'Búsqueda', activo: textoBusqueda !== '',
            texto: `Concepto: "${billeteraMovsFiltroBuscar.value.trim()}"`,
            onQuitar: () => { billeteraMovsFiltroBuscar.value = ''; aplicarFiltroBilleteraMovs(); }
        }
    ], { mostrados: filtrados.length, total: billeteraMovsConSaldoCache.length });

    billeteraMovsFiltrado = filtrados;
    billeteraMovsBody.innerHTML = '';
    if (filtrados.length === 0) {
        billeteraMovsEmpty.style.display = 'block';
        billeteraMovsTableWrap.style.display = 'none';
        billeteraMovsEmptyText.textContent = hayFiltrosActivos
            ? 'No hay movimientos que coincidan con el filtro.'
            : 'Todavía no hay movimientos de USDT.';
        return;
    }
    billeteraMovsEmpty.style.display = 'none';
    billeteraMovsTableWrap.style.display = 'block';

    filtrados.forEach(({ mov, saldo }) => {
        const signo = mov.tipo === 'entrada' ? '+' : '−';
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${formatDate(mov.createdAt)}</td>
            <td>${tipoBadgeHTML(mov.tipo)}</td>
            <td class="mono-cell">${signo} ${formatMoney(mov.monto, 'USDT')}</td>
            <td>${escapeHtml(mov.concepto) || '—'}</td>
            <td>${origenBadgeHTML(mov)}</td>
            <td class="mono-cell ${saldo < 0 ? 'stat-value-negative' : ''}">${formatMoney(saldo, 'USDT')}</td>
        `;
        billeteraMovsBody.appendChild(tr);
    });
}

[billeteraMovsFiltroTipo, billeteraMovsFiltroOrigen, billeteraMovsFiltroDesde, billeteraMovsFiltroHasta].forEach(el => {
    el.addEventListener('change', aplicarFiltroBilleteraMovs);
});
billeteraMovsFiltroBuscar.addEventListener('input', aplicarFiltroBilleteraMovs);
billeteraMovsFiltroLimpiar.addEventListener('click', () => {
    billeteraMovsFiltroTipo.value = 'todos';
    billeteraMovsFiltroOrigen.value = 'todos';
    billeteraMovsFiltroBuscar.value = '';
    billeteraMovsFiltroDesde.value = '';
    billeteraMovsFiltroHasta.value = '';
    aplicarFiltroBilleteraMovs();
});
initFiltrosToggle('billeteraMovs');

// ============================================
// EXPORTAR BILLETERA (Todos los movimientos) — PDF (jsPDF) y Excel (SheetJS)
// Exporta siempre lo que está visible en pantalla (respeta los filtros activos).
// ============================================
const billeteraMovsExportarPdfBtn = document.getElementById('billeteraMovsExportarPdfBtn');
const billeteraMovsExportarExcelBtn = document.getElementById('billeteraMovsExportarExcelBtn');

function filasExportBilleteraMovs() {
    return billeteraMovsFiltrado.map(({ mov, saldo }) => ({
        Fecha: formatDate(mov.createdAt),
        Tipo: tipoTexto(mov.tipo),
        Monto: moneyTexto(mov.monto, 'USDT'),
        Concepto: mov.concepto || '—',
        Origen: origenTexto(mov),
        Saldo: moneyTexto(saldo, 'USDT')
    }));
}

billeteraMovsExportarPdfBtn.addEventListener('click', () => {
    if (billeteraMovsFiltrado.length === 0) {
        alert('No hay movimientos para exportar con los filtros actuales.');
        return;
    }
    const filas = filasExportBilleteraMovs();
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape' });

    doc.setFontSize(14);
    doc.text('Billetera — Todos los movimientos de USDT', 14, 15);
    doc.setFontSize(10);
    doc.setTextColor(120);
    doc.text(`Generado el ${new Date().toLocaleDateString('es-CL')} · ${filas.length} movimiento(s)`, 14, 21);

    doc.autoTable({
        startY: 26,
        head: [['Fecha', 'Tipo', 'Monto', 'Concepto', 'Origen', 'Saldo']],
        body: filas.map(f => [f.Fecha, f.Tipo, f.Monto, f.Concepto, f.Origen, f.Saldo]),
        styles: { fontSize: 8.5, cellPadding: 3 },
        headStyles: { fillColor: [30, 41, 59] },
        alternateRowStyles: { fillColor: [245, 246, 248] }
    });

    doc.save(`billetera-movimientos-${fechaArchivo()}.pdf`);
});

billeteraMovsExportarExcelBtn.addEventListener('click', () => {
    if (billeteraMovsFiltrado.length === 0) {
        alert('No hay movimientos para exportar con los filtros actuales.');
        return;
    }
    const filas = filasExportBilleteraMovs();
    const hoja = XLSX.utils.json_to_sheet(filas);
    hoja['!cols'] = [{ wch: 12 }, { wch: 10 }, { wch: 16 }, { wch: 26 }, { wch: 18 }, { wch: 16 }];
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, 'Movimientos USDT');
    XLSX.writeFile(libro, `billetera-movimientos-${fechaArchivo()}.xlsx`);
});

function renderBilleteraCompras(compras) {
    billeteraComprasCache = compras;
    aplicarFiltroBilleteraCompras();
}

// Aplica los filtros de fecha y búsqueda por concepto sobre
// billeteraComprasCache, y vuelve a pintar la tabla de Historial de compras.
function aplicarFiltroBilleteraCompras() {
    const desdeFiltro = billeteraComprasFiltroDesde.value;
    const hastaFiltro = billeteraComprasFiltroHasta.value;
    const textoBusqueda = billeteraComprasFiltroBuscar.value.trim().toLowerCase();
    const hayFiltrosActivos = !!desdeFiltro || !!hastaFiltro || textoBusqueda !== '';

    const filtrados = billeteraComprasCache.filter(mov => {
        if ((desdeFiltro || hastaFiltro) && !fechaEnRango(mov.createdAt, desdeFiltro, hastaFiltro)) return false;
        if (textoBusqueda && !(mov.concepto || '').toLowerCase().includes(textoBusqueda)) return false;
        return true;
    });

    actualizarPanelFiltros('billeteraCompras', [
        {
            label: 'Rango de fechas', activo: !!desdeFiltro || !!hastaFiltro,
            texto: `Fecha: ${desdeFiltro || '…'} – ${hastaFiltro || '…'}`,
            onQuitar: () => { billeteraComprasFiltroDesde.value = ''; billeteraComprasFiltroHasta.value = ''; aplicarFiltroBilleteraCompras(); }
        },
        {
            label: 'Búsqueda', activo: textoBusqueda !== '',
            texto: `Concepto: "${billeteraComprasFiltroBuscar.value.trim()}"`,
            onQuitar: () => { billeteraComprasFiltroBuscar.value = ''; aplicarFiltroBilleteraCompras(); }
        }
    ], { mostrados: filtrados.length, total: billeteraComprasCache.length });

    billeteraComprasFiltrado = filtrados;
    billeteraBody.innerHTML = '';
    if (filtrados.length === 0) {
        billeteraEmpty.style.display = 'block';
        billeteraTableWrap.style.display = 'none';
        billeteraEmpty.querySelector('p').textContent = hayFiltrosActivos
            ? 'No hay compras que coincidan con el filtro.'
            : 'Todavía no has registrado compras de USDT.';
        return;
    }
    billeteraEmpty.style.display = 'none';
    billeteraTableWrap.style.display = 'block';

    filtrados.forEach(mov => {
        const tasa = mov.monto > 0 ? mov.clpGastado / mov.monto : 0;
        const fecha = formatDate(mov.createdAt);
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${fecha}</td>
            <td class="mono-cell">${formatMoney(mov.clpGastado, 'CLP')}</td>
            <td class="mono-cell">${formatMoney(mov.monto, 'USDT')}</td>
            <td class="mono-cell">${formatMoney(tasa, 'CLP')}</td>
            <td>${escapeHtml(mov.concepto) || '—'}</td>
            <td><button type="button" class="btn-icon-action danger" data-compra-id="${mov.compraId}"><i class="ti ti-trash" aria-hidden="true"></i></button></td>
        `;
        tr.querySelector('button').addEventListener('click', () => eliminarCompraUsdt(mov.compraId));
        billeteraBody.appendChild(tr);
    });
}

[billeteraComprasFiltroDesde, billeteraComprasFiltroHasta].forEach(el => {
    el.addEventListener('change', aplicarFiltroBilleteraCompras);
});
billeteraComprasFiltroBuscar.addEventListener('input', aplicarFiltroBilleteraCompras);
billeteraComprasFiltroLimpiar.addEventListener('click', () => {
    billeteraComprasFiltroDesde.value = '';
    billeteraComprasFiltroHasta.value = '';
    billeteraComprasFiltroBuscar.value = '';
    aplicarFiltroBilleteraCompras();
});
initFiltrosToggle('billeteraCompras');

// ============================================
// EXPORTAR BILLETERA (Historial de compras) — PDF (jsPDF) y Excel (SheetJS)
// Exporta siempre lo que está visible en pantalla (respeta los filtros activos).
// ============================================
const billeteraComprasExportarPdfBtn = document.getElementById('billeteraComprasExportarPdfBtn');
const billeteraComprasExportarExcelBtn = document.getElementById('billeteraComprasExportarExcelBtn');

function filasExportBilleteraCompras() {
    return billeteraComprasFiltrado.map(mov => {
        const tasa = mov.monto > 0 ? mov.clpGastado / mov.monto : 0;
        return {
            Fecha: formatDate(mov.createdAt),
            'CLP gastado': moneyTexto(mov.clpGastado, 'CLP'),
            'USDT comprado': moneyTexto(mov.monto, 'USDT'),
            Tasa: moneyTexto(tasa, 'CLP'),
            Concepto: mov.concepto || '—'
        };
    });
}

billeteraComprasExportarPdfBtn.addEventListener('click', () => {
    if (billeteraComprasFiltrado.length === 0) {
        alert('No hay compras para exportar con los filtros actuales.');
        return;
    }
    const filas = filasExportBilleteraCompras();
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape' });

    doc.setFontSize(14);
    doc.text('Billetera — Historial de compras', 14, 15);
    doc.setFontSize(10);
    doc.setTextColor(120);
    doc.text(`Generado el ${new Date().toLocaleDateString('es-CL')} · ${filas.length} compra(s)`, 14, 21);

    doc.autoTable({
        startY: 26,
        head: [['Fecha', 'CLP gastado', 'USDT comprado', 'Tasa', 'Concepto']],
        body: filas.map(f => [f.Fecha, f['CLP gastado'], f['USDT comprado'], f.Tasa, f.Concepto]),
        styles: { fontSize: 8.5, cellPadding: 3 },
        headStyles: { fillColor: [30, 41, 59] },
        alternateRowStyles: { fillColor: [245, 246, 248] }
    });

    doc.save(`billetera-compras-${fechaArchivo()}.pdf`);
});

billeteraComprasExportarExcelBtn.addEventListener('click', () => {
    if (billeteraComprasFiltrado.length === 0) {
        alert('No hay compras para exportar con los filtros actuales.');
        return;
    }
    const filas = filasExportBilleteraCompras();
    const hoja = XLSX.utils.json_to_sheet(filas);
    hoja['!cols'] = [{ wch: 12 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 26 }];
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, 'Compras USDT');
    XLSX.writeFile(libro, `billetera-compras-${fechaArchivo()}.xlsx`);
});

billeteraForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const clpGastado = parseFloat(billeteraClpGastadoInput.value);
    const usdtComprado = parseFloat(billeteraUsdtCompradoInput.value);
    const concepto = billeteraConceptoInput.value.trim() || 'Compra de USDT';

    if (isNaN(clpGastado) || clpGastado <= 0 || isNaN(usdtComprado) || usdtComprado <= 0) {
        billeteraMessage.textContent = 'Ingresa montos válidos en ambos campos.';
        billeteraMessage.className = 'form-message form-message-error';
        return;
    }

    billeteraSubmitBtn.disabled = true;
    billeteraSubmitBtn.querySelector('.btn-text').classList.add('hidden');
    billeteraSubmitBtn.querySelector('.spinner').classList.remove('hidden');

    try {
        const compraId = `compra_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const batch = db.batch();

        const salidaRef = cajaColeccion.doc();
        batch.set(salidaRef, {
            tipo: 'salida',
            moneda: 'CLP',
            monto: clpGastado,
            concepto,
            origen: 'compra_usdt',
            compraId,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        const entradaRef = cajaColeccion.doc();
        batch.set(entradaRef, {
            tipo: 'entrada',
            moneda: 'USDT',
            monto: usdtComprado,
            clpGastado,
            concepto,
            origen: 'compra_usdt',
            compraId,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        await batch.commit();

        billeteraMessage.textContent = 'Compra registrada. Caja se actualizó sola (CLP −, USDT +).';
        billeteraMessage.className = 'form-message form-message-success';
        billeteraForm.reset();
        billeteraTasaCompraInput.value = '—';
    } catch (error) {
        console.error('Error al registrar compra de USDT:', error);
        billeteraMessage.textContent = 'Ocurrió un error al registrar la compra. Intenta de nuevo.';
        billeteraMessage.className = 'form-message form-message-error';
    } finally {
        billeteraSubmitBtn.disabled = false;
        billeteraSubmitBtn.querySelector('.btn-text').classList.remove('hidden');
        billeteraSubmitBtn.querySelector('.spinner').classList.add('hidden');
    }
});

async function eliminarCompraUsdt(compraId) {
    if (!compraId) return;
    if (!confirm('¿Eliminar esta compra de USDT? Se borrarán también sus movimientos de Caja (CLP y USDT).')) return;
    try {
        const existentes = await cajaColeccion.where('compraId', '==', compraId).get();
        await Promise.all(existentes.docs.map(doc => doc.ref.delete()));
    } catch (error) {
        console.error('Error al eliminar compra de USDT:', error);
        alert('No se pudo eliminar la compra. Intenta de nuevo.');
    }
}

function renderBilleteraVentas(ventas) {
    billeteraVentasCache = ventas;
    aplicarFiltroBilleteraVentas();
}

// Aplica los filtros de fecha y búsqueda por concepto sobre
// billeteraVentasCache, y vuelve a pintar la tabla de Historial de ventas.
function aplicarFiltroBilleteraVentas() {
    const desdeFiltro = billeteraVentasFiltroDesde.value;
    const hastaFiltro = billeteraVentasFiltroHasta.value;
    const textoBusqueda = billeteraVentasFiltroBuscar.value.trim().toLowerCase();
    const hayFiltrosActivos = !!desdeFiltro || !!hastaFiltro || textoBusqueda !== '';

    const filtrados = billeteraVentasCache.filter(mov => {
        if ((desdeFiltro || hastaFiltro) && !fechaEnRango(mov.createdAt, desdeFiltro, hastaFiltro)) return false;
        if (textoBusqueda && !(mov.concepto || '').toLowerCase().includes(textoBusqueda)) return false;
        return true;
    });

    actualizarPanelFiltros('billeteraVentas', [
        {
            label: 'Rango de fechas', activo: !!desdeFiltro || !!hastaFiltro,
            texto: `Fecha: ${desdeFiltro || '…'} – ${hastaFiltro || '…'}`,
            onQuitar: () => { billeteraVentasFiltroDesde.value = ''; billeteraVentasFiltroHasta.value = ''; aplicarFiltroBilleteraVentas(); }
        },
        {
            label: 'Búsqueda', activo: textoBusqueda !== '',
            texto: `Concepto: "${billeteraVentasFiltroBuscar.value.trim()}"`,
            onQuitar: () => { billeteraVentasFiltroBuscar.value = ''; aplicarFiltroBilleteraVentas(); }
        }
    ], { mostrados: filtrados.length, total: billeteraVentasCache.length });

    billeteraVentasFiltrado = filtrados;
    billeteraVentasBody.innerHTML = '';
    if (filtrados.length === 0) {
        billeteraVentasEmpty.style.display = 'block';
        billeteraVentasTableWrap.style.display = 'none';
        billeteraVentasEmpty.querySelector('p').textContent = hayFiltrosActivos
            ? 'No hay ventas que coincidan con el filtro.'
            : 'Todavía no has registrado ventas de USDT.';
        return;
    }
    billeteraVentasEmpty.style.display = 'none';
    billeteraVentasTableWrap.style.display = 'block';

    filtrados.forEach(mov => {
        const vesRecibido = mov.vesRecibido || 0;
        const tasa = mov.monto > 0 ? vesRecibido / mov.monto : 0;
        const fecha = formatDate(mov.createdAt);
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${fecha}</td>
            <td class="mono-cell">${formatMoney(mov.monto, 'USDT')}</td>
            <td class="mono-cell">${formatMoney(vesRecibido, 'VES')}</td>
            <td class="mono-cell">${formatMoney(tasa, 'VES')}</td>
            <td class="mono-cell">${mov.comisionUsdt ? formatMoney(mov.comisionUsdt, 'USDT') : '—'}</td>
            <td>${escapeHtml(mov.concepto) || '—'}</td>
            <td><button type="button" class="btn-icon-action danger" data-venta-id="${mov.ventaId}"><i class="ti ti-trash" aria-hidden="true"></i></button></td>
        `;
        tr.querySelector('button').addEventListener('click', () => eliminarVentaUsdt(mov.ventaId));
        billeteraVentasBody.appendChild(tr);
    });
}

[billeteraVentasFiltroDesde, billeteraVentasFiltroHasta].forEach(el => {
    el.addEventListener('change', aplicarFiltroBilleteraVentas);
});
billeteraVentasFiltroBuscar.addEventListener('input', aplicarFiltroBilleteraVentas);
billeteraVentasFiltroLimpiar.addEventListener('click', () => {
    billeteraVentasFiltroDesde.value = '';
    billeteraVentasFiltroHasta.value = '';
    billeteraVentasFiltroBuscar.value = '';
    aplicarFiltroBilleteraVentas();
});
initFiltrosToggle('billeteraVentas');

// ============================================
// EXPORTAR BILLETERA (Historial de ventas) — PDF (jsPDF) y Excel (SheetJS)
// Exporta siempre lo que está visible en pantalla (respeta los filtros activos).
// ============================================
const billeteraVentasExportarPdfBtn = document.getElementById('billeteraVentasExportarPdfBtn');
const billeteraVentasExportarExcelBtn = document.getElementById('billeteraVentasExportarExcelBtn');

function filasExportBilleteraVentas() {
    return billeteraVentasFiltrado.map(mov => {
        const vesRecibido = mov.vesRecibido || 0;
        const tasa = mov.monto > 0 ? vesRecibido / mov.monto : 0;
        return {
            Fecha: formatDate(mov.createdAt),
            'USDT vendido': moneyTexto(mov.monto, 'USDT'),
            'VES recibido': moneyTexto(vesRecibido, 'VES'),
            Tasa: moneyTexto(tasa, 'VES'),
            'Comisión USDT': mov.comisionUsdt ? moneyTexto(mov.comisionUsdt, 'USDT') : '—',
            Concepto: mov.concepto || '—'
        };
    });
}

billeteraVentasExportarPdfBtn.addEventListener('click', () => {
    if (billeteraVentasFiltrado.length === 0) {
        alert('No hay ventas para exportar con los filtros actuales.');
        return;
    }
    const filas = filasExportBilleteraVentas();
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape' });

    doc.setFontSize(14);
    doc.text('Billetera — Historial de ventas', 14, 15);
    doc.setFontSize(10);
    doc.setTextColor(120);
    doc.text(`Generado el ${new Date().toLocaleDateString('es-CL')} · ${filas.length} venta(s)`, 14, 21);

    doc.autoTable({
        startY: 26,
        head: [['Fecha', 'USDT vendido', 'VES recibido', 'Tasa', 'Comisión USDT', 'Concepto']],
        body: filas.map(f => [f.Fecha, f['USDT vendido'], f['VES recibido'], f.Tasa, f['Comisión USDT'], f.Concepto]),
        styles: { fontSize: 8.5, cellPadding: 3 },
        headStyles: { fillColor: [30, 41, 59] },
        alternateRowStyles: { fillColor: [245, 246, 248] }
    });

    doc.save(`billetera-ventas-${fechaArchivo()}.pdf`);
});

billeteraVentasExportarExcelBtn.addEventListener('click', () => {
    if (billeteraVentasFiltrado.length === 0) {
        alert('No hay ventas para exportar con los filtros actuales.');
        return;
    }
    const filas = filasExportBilleteraVentas();
    const hoja = XLSX.utils.json_to_sheet(filas);
    hoja['!cols'] = [{ wch: 12 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 26 }];
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, 'Ventas USDT');
    XLSX.writeFile(libro, `billetera-ventas-${fechaArchivo()}.xlsx`);
});

billeteraVentaForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const usdtVendido = parseFloat(billeteraUsdtVendidoInput.value);
    const vesRecibido = parseFloat(billeteraVesRecibidoInput.value);
    const comisionUsdt = parseFloat(billeteraComisionUsdtInput.value) || 0;
    const concepto = billeteraVentaConceptoInput.value.trim() || 'Venta de USDT';

    if (isNaN(usdtVendido) || usdtVendido <= 0 || isNaN(vesRecibido) || vesRecibido <= 0) {
        billeteraVentaMessage.textContent = 'Ingresa montos válidos en ambos campos.';
        billeteraVentaMessage.className = 'form-message form-message-error';
        return;
    }

    billeteraVentaSubmitBtn.disabled = true;
    billeteraVentaSubmitBtn.querySelector('.btn-text').classList.add('hidden');
    billeteraVentaSubmitBtn.querySelector('.spinner').classList.remove('hidden');

    try {
        const ventaId = `venta_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const batch = db.batch();

        const salidaRef = cajaColeccion.doc();
        batch.set(salidaRef, {
            tipo: 'salida',
            moneda: 'USDT',
            monto: usdtVendido,
            vesRecibido,
            comisionUsdt,
            concepto,
            origen: 'venta_usdt',
            ventaId,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        const entradaRef = cajaColeccion.doc();
        batch.set(entradaRef, {
            tipo: 'entrada',
            moneda: 'VES',
            monto: vesRecibido,
            concepto,
            origen: 'venta_usdt',
            ventaId,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        await batch.commit();

        billeteraVentaMessage.textContent = 'Venta registrada. Caja se actualizó sola (USDT −, VES +).';
        billeteraVentaMessage.className = 'form-message form-message-success';
        billeteraVentaForm.reset();
        billeteraTasaVentaInput.value = '—';
    } catch (error) {
        console.error('Error al registrar venta de USDT:', error);
        billeteraVentaMessage.textContent = 'Ocurrió un error al registrar la venta. Intenta de nuevo.';
        billeteraVentaMessage.className = 'form-message form-message-error';
    } finally {
        billeteraVentaSubmitBtn.disabled = false;
        billeteraVentaSubmitBtn.querySelector('.btn-text').classList.remove('hidden');
        billeteraVentaSubmitBtn.querySelector('.spinner').classList.add('hidden');
    }
});

async function eliminarVentaUsdt(ventaId) {
    if (!ventaId) return;
    if (!confirm('¿Eliminar esta venta de USDT? Se borrarán también sus movimientos de Caja (USDT y VES).')) return;
    try {
        const existentes = await cajaColeccion.where('ventaId', '==', ventaId).get();
        await Promise.all(existentes.docs.map(doc => doc.ref.delete()));
    } catch (error) {
        console.error('Error al eliminar venta de USDT:', error);
        alert('No se pudo eliminar la venta. Intenta de nuevo.');
    }
}

// ============================================
// CIERRE DE CAJA DIARIO — apertura, resumen en vivo y cierre
// ============================================
const cierresColeccion = db.collection('cierresCaja');
let movimientosCajaActuales = [];
let cierreAbiertoActual = null; // { id, data } | null
let ultimoCierreCerrado = null; // { id, data } | null — el cierre cerrado más reciente
let resumenPorMoneda = {}; // saldo esperado por moneda de la caja abierta, recalculado en cada render

const cierreCerradoView = document.getElementById('cierreCerradoView');
const cierreAbiertoView = document.getElementById('cierreAbiertoView');
const cierreEstadoBadge = document.getElementById('cierreEstadoBadge');
const cierreAbiertoInfo = document.getElementById('cierreAbiertoInfo');
const cierreResumenBody = document.getElementById('cierreResumenBody');
const cierreFormWrap = document.getElementById('cierreFormWrap');
const cierreFormBody = document.getElementById('cierreFormBody');
const cierreNotasInput = document.getElementById('cierreNotas');
const cierreMessage = document.getElementById('cierreMessage');
const cierreSubmitBtn = document.getElementById('cierreSubmitBtn');
const abrirCierreFormBtn = document.getElementById('abrirCierreFormBtn');
const cierreCancelBtn = document.getElementById('cierreCancelBtn');
const cierresHistorialBody = document.getElementById('cierresHistorialBody');
const cierresHistorialEmpty = document.getElementById('cierresHistorialEmpty');
const cierresHistorialWrap = document.getElementById('cierresHistorialWrap');

// --- Apertura: filas dinámicas de moneda + saldo inicial ---
const aperturaFilas = document.getElementById('aperturaFilas');
const aperturaAgregarFilaBtn = document.getElementById('aperturaAgregarFilaBtn');
const aperturaSubmitBtn = document.getElementById('aperturaSubmitBtn');
const aperturaMessage = document.getElementById('aperturaMessage');

function agregarFilaApertura() {
    const fila = document.createElement('div');
    fila.className = 'apertura-fila';
    fila.innerHTML = `
        <input type="text" class="apertura-moneda" placeholder="Moneda (ej. CLP)" maxlength="6">
        <input type="number" class="apertura-monto" placeholder="Saldo inicial" min="0" step="0.01">
        <input type="text" class="apertura-concepto" placeholder="Concepto (ej. BancoEstado, Banco de Chile)">
        <button type="button" class="btn-icon-action danger"><i class="ti ti-x" aria-hidden="true"></i></button>
    `;
    fila.querySelector('button').addEventListener('click', () => {
        if (aperturaFilas.children.length > 1) fila.remove();
    });
    aperturaFilas.appendChild(fila);
}
agregarFilaApertura();
aperturaAgregarFilaBtn.addEventListener('click', agregarFilaApertura);

aperturaSubmitBtn.addEventListener('click', async () => {
    const saldosIniciales = {};
    const conceptosIniciales = {};
    aperturaFilas.querySelectorAll('.apertura-fila').forEach(fila => {
        const moneda = fila.querySelector('.apertura-moneda').value.trim().toUpperCase();
        const monto = parseFloat(fila.querySelector('.apertura-monto').value);
        const concepto = fila.querySelector('.apertura-concepto').value.trim();
        if (moneda && !isNaN(monto) && monto >= 0) {
            // Si ya hay un monto cargado para esta moneda (dos filas con la misma
            // moneda), se SUMAN en vez de sobrescribirse.
            saldosIniciales[moneda] = (saldosIniciales[moneda] || 0) + monto;
            if (concepto) {
                conceptosIniciales[moneda] = conceptosIniciales[moneda]
                    ? `${conceptosIniciales[moneda]}; ${concepto}`
                    : concepto;
            }
        }
    });

    if (Object.keys(saldosIniciales).length === 0) {
        aperturaMessage.textContent = 'Agrega al menos una moneda con su saldo inicial.';
        aperturaMessage.className = 'form-message form-message-error';
        return;
    }

    aperturaSubmitBtn.disabled = true;
    aperturaSubmitBtn.querySelector('.btn-text').textContent = 'Abriendo...';
    aperturaSubmitBtn.querySelector('.spinner').classList.remove('hidden');
    aperturaMessage.textContent = '';
    aperturaMessage.className = 'form-message';

    try {
        const nuevaCaja = await cierresColeccion.add({
            estado: 'abierto',
            fecha: new Date().toISOString().slice(0, 10),
            saldosIniciales,
            conceptosIniciales,
            abiertoEn: firebase.firestore.FieldValue.serverTimestamp(),
            abiertoPorEmail: auth.currentUser ? auth.currentUser.email : null,
            cerradoEn: null,
            cerradoPorEmail: null,
            saldosEsperados: null,
            saldosContados: null,
            diferencias: null,
            notas: ''
        });
        registrarAuditoria('caja', 'abrir', {
            cierreId: nuevaCaja.id,
            saldosIniciales
        });
        aperturaFilas.innerHTML = '';
        agregarFilaApertura();
        aperturaMessage.textContent = '';
    } catch (error) {
        console.error('Error al abrir caja:', error);
        aperturaMessage.textContent = 'No se pudo abrir la caja. Intenta de nuevo.';
        aperturaMessage.className = 'form-message form-message-error';
    } finally {
        aperturaSubmitBtn.disabled = false;
        aperturaSubmitBtn.querySelector('.btn-text').textContent = 'Abrir caja';
        aperturaSubmitBtn.querySelector('.spinner').classList.add('hidden');
    }
});

// --- Vista de caja abierta: resumen en vivo (inicial + movimientos desde la apertura) ---
function actualizarVistaCierre() {
    if (!cierreAbiertoActual) {
        cierreCerradoView.classList.remove('hidden');
        cierreAbiertoView.classList.add('hidden');
        cierreFormWrap.classList.add('hidden');
        cierreEstadoBadge.textContent = 'Sin abrir';
        cierreEstadoBadge.className = 'badge badge-neutral';
        return;
    }

    cierreCerradoView.classList.add('hidden');
    cierreAbiertoView.classList.remove('hidden');
    cierreEstadoBadge.textContent = 'Abierta';
    cierreEstadoBadge.className = 'badge badge-success';

    const { data } = cierreAbiertoActual;
    const abiertoEnFecha = data.abiertoEn && data.abiertoEn.toDate ? data.abiertoEn.toDate() : null;
    cierreAbiertoInfo.textContent = abiertoEnFecha
        ? `Abierta el ${abiertoEnFecha.toLocaleString('es-CL')} por ${data.abiertoPorEmail || '—'}.`
        : `Abierta por ${data.abiertoPorEmail || '—'}.`;

    const abiertoEnMs = abiertoEnFecha ? abiertoEnFecha.getTime() : 0;
    const movsDesdeApertura = movimientosCajaActuales.filter(m => {
        const t = m.createdAt && m.createdAt.toDate ? m.createdAt.toDate().getTime() : 0;
        return t >= abiertoEnMs;
    });

    const monedas = new Set(Object.keys(data.saldosIniciales || {}));
    movsDesdeApertura.forEach(m => { if (m.moneda) monedas.add(m.moneda); });

    resumenPorMoneda = {};
    cierreResumenBody.innerHTML = '';
    cierreFormBody.innerHTML = '';

    [...monedas].sort().forEach(moneda => {
        const inicial = (data.saldosIniciales && data.saldosIniciales[moneda]) || 0;
        const entradas = movsDesdeApertura
            .filter(m => m.moneda === moneda && m.tipo === 'entrada')
            .reduce((s, m) => s + (m.monto || 0), 0);
        const salidas = movsDesdeApertura
            .filter(m => m.moneda === moneda && m.tipo === 'salida')
            .reduce((s, m) => s + (m.monto || 0), 0);
        const esperado = inicial + entradas - salidas;
        resumenPorMoneda[moneda] = esperado;

        const trResumen = document.createElement('tr');
        const conceptoInicial = (data.conceptosIniciales && data.conceptosIniciales[moneda]) || '';
        trResumen.innerHTML = `
            <td>${escapeHtml(moneda)}${conceptoInicial ? `<div class="cell-subtext">${escapeHtml(conceptoInicial)}</div>` : ''}</td>
            <td class="mono-cell">${formatMoney(inicial, '')}</td>
            <td class="mono-cell">${formatMoney(entradas, '')}</td>
            <td class="mono-cell">${formatMoney(salidas, '')}</td>
            <td class="mono-cell">${formatMoney(esperado, '')}</td>
        `;
        cierreResumenBody.appendChild(trResumen);

        const trForm = document.createElement('tr');
        trForm.innerHTML = `
            <td>${escapeHtml(moneda)}</td>
            <td class="mono-cell">${formatMoney(esperado, '')}</td>
            <td><input type="number" step="0.01" min="0" class="cierre-contado-input" data-moneda="${escapeHtml(moneda)}" placeholder="0"></td>
            <td class="mono-cell" data-moneda-diff="${escapeHtml(moneda)}">—</td>
        `;
        cierreFormBody.appendChild(trForm);
    });

    cierreFormBody.querySelectorAll('.cierre-contado-input').forEach(input => {
        input.addEventListener('input', () => {
            const moneda = input.dataset.moneda;
            const celda = cierreFormBody.querySelector(`[data-moneda-diff="${moneda}"]`);
            const contado = parseFloat(input.value);
            if (isNaN(contado)) {
                celda.textContent = '—';
                celda.className = 'mono-cell';
                return;
            }
            const diferencia = contado - resumenPorMoneda[moneda];
            celda.textContent = formatMoney(diferencia, '');
            celda.className = 'mono-cell ' + (diferencia === 0 ? '' : (diferencia > 0 ? 'rep-ganancia-positiva' : 'rep-ganancia-negativa'));
        });
    });
}

abrirCierreFormBtn.addEventListener('click', () => {
    cierreFormWrap.classList.remove('hidden');
});

cierreCancelBtn.addEventListener('click', () => {
    cierreFormWrap.classList.add('hidden');
    cierreMessage.textContent = '';
    cierreMessage.className = 'form-message';
});

cierreSubmitBtn.addEventListener('click', async () => {
    if (!cierreAbiertoActual) return;

    const saldosContados = {};
    let faltaAlguno = false;
    cierreFormBody.querySelectorAll('.cierre-contado-input').forEach(input => {
        const contado = parseFloat(input.value);
        if (isNaN(contado)) { faltaAlguno = true; return; }
        saldosContados[input.dataset.moneda] = contado;
    });

    if (faltaAlguno || Object.keys(saldosContados).length === 0) {
        cierreMessage.textContent = 'Ingresa el saldo contado para cada moneda antes de confirmar.';
        cierreMessage.className = 'form-message form-message-error';
        return;
    }

    const saldosEsperados = { ...resumenPorMoneda };
    const diferencias = {};
    Object.keys(saldosContados).forEach(moneda => {
        diferencias[moneda] = saldosContados[moneda] - (saldosEsperados[moneda] || 0);
    });

    cierreSubmitBtn.disabled = true;
    cierreSubmitBtn.querySelector('.btn-text').textContent = 'Cerrando...';
    cierreSubmitBtn.querySelector('.spinner').classList.remove('hidden');
    cierreMessage.textContent = '';
    cierreMessage.className = 'form-message';

    try {
        await cierresColeccion.doc(cierreAbiertoActual.id).update({
            estado: 'cerrado',
            cerradoEn: firebase.firestore.FieldValue.serverTimestamp(),
            cerradoPorEmail: auth.currentUser ? auth.currentUser.email : null,
            saldosEsperados,
            saldosContados,
            diferencias,
            notas: cierreNotasInput.value.trim()
        });
        registrarAuditoria('caja', 'cerrar', {
            cierreId: cierreAbiertoActual.id,
            saldosEsperados,
            saldosContados,
            diferencias
        });
        cierreFormWrap.classList.add('hidden');
        cierreNotasInput.value = '';
    } catch (error) {
        console.error('Error al cerrar caja:', error);
        cierreMessage.textContent = 'No se pudo cerrar la caja. Intenta de nuevo.';
        cierreMessage.className = 'form-message form-message-error';
    } finally {
        cierreSubmitBtn.disabled = false;
        cierreSubmitBtn.querySelector('.btn-text').textContent = 'Confirmar cierre';
        cierreSubmitBtn.querySelector('.spinner').classList.add('hidden');
    }
});

// --- Historial de cierres cerrados ---
function renderHistorialCierres(cerrados) {
    cierresHistorialBody.innerHTML = '';
    let filas = 0;

    cerrados.forEach(({ data }) => {
        const monedas = new Set([
            ...Object.keys(data.saldosIniciales || {}),
            ...Object.keys(data.saldosContados || {})
        ]);
        monedas.forEach(moneda => {
            filas++;
            const inicial = (data.saldosIniciales && data.saldosIniciales[moneda]) || 0;
            const esperado = (data.saldosEsperados && data.saldosEsperados[moneda]) || 0;
            const contado = (data.saldosContados && data.saldosContados[moneda]) || 0;
            const diferencia = (data.diferencias && data.diferencias[moneda]) || 0;
            const claseDiff = diferencia === 0 ? '' : (diferencia > 0 ? 'rep-ganancia-positiva' : 'rep-ganancia-negativa');

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${formatDate(data.cerradoEn || data.abiertoEn)}</td>
                <td>${escapeHtml(moneda)}</td>
                <td class="mono-cell">${formatMoney(inicial, '')}</td>
                <td class="mono-cell">${formatMoney(esperado, '')}</td>
                <td class="mono-cell">${formatMoney(contado, '')}</td>
                <td class="mono-cell ${claseDiff}">${formatMoney(diferencia, '')}</td>
                <td>${escapeHtml(data.cerradoPorEmail) || '—'}</td>
            `;
            cierresHistorialBody.appendChild(tr);
        });
    });

    if (filas === 0) {
        cierresHistorialEmpty.style.display = 'block';
        cierresHistorialWrap.style.display = 'none';
    } else {
        cierresHistorialEmpty.style.display = 'none';
        cierresHistorialWrap.style.display = 'block';
    }
}

cierresColeccion.orderBy('abiertoEn', 'desc').onSnapshot(snapshot => {
    let abierto = null;
    const cerrados = [];
    snapshot.forEach(doc => {
        const data = doc.data();
        if (data.estado === 'abierto' && !abierto) {
            abierto = { id: doc.id, data };
        } else if (data.estado === 'cerrado') {
            cerrados.push({ id: doc.id, data });
        }
    });
    cierreAbiertoActual = abierto;
    ultimoCierreCerrado = cerrados.length > 0 ? cerrados[0] : null;
    actualizarVistaCierre();
    renderHistorialCierres(cerrados);
    renderCajaSaldos(movimientosCajaActuales); // re-sincroniza las tarjetas de arriba con la apertura vigente
    actualizarDashboardEjecutivo();
}, error => {
    console.error('Error al escuchar cierres de caja:', error);
});

// ============================================
// BOLETAS SII — checklist manual (NO conectado al SII)
// ============================================
const boletasPendientesCount = document.getElementById('boletasPendientesCount');
const boletasPendientesMonto = document.getElementById('boletasPendientesMonto');
const boletasEmitidasMes = document.getElementById('boletasEmitidasMes');
const boletasPendientesBody = document.getElementById('boletasPendientesBody');
const boletasPendientesTableWrap = document.getElementById('boletasPendientesTableWrap');
const boletasPendientesEmpty = document.getElementById('boletasPendientesEmpty');
const boletasEmitidasBody = document.getElementById('boletasEmitidasBody');
const boletasEmitidasTableWrap = document.getElementById('boletasEmitidasTableWrap');
const boletasEmitidasEmpty = document.getElementById('boletasEmitidasEmpty');
const boletasMarcarGrupoBtn = document.getElementById('boletasMarcarGrupoBtn');
const boletasSeleccionadasCount = document.getElementById('boletasSeleccionadasCount');
const boletasPendientesFiltroDesde = document.getElementById('boletasPendientesFiltroDesde');
const boletasPendientesFiltroHasta = document.getElementById('boletasPendientesFiltroHasta');
const boletasPendientesFiltroBuscar = document.getElementById('boletasPendientesFiltroBuscar');
const boletasPendientesFiltroLimpiar = document.getElementById('boletasPendientesFiltroLimpiar');
const boletasEmitidasFiltroDesde = document.getElementById('boletasEmitidasFiltroDesde');
const boletasEmitidasFiltroHasta = document.getElementById('boletasEmitidasFiltroHasta');
const boletasEmitidasFiltroBuscar = document.getElementById('boletasEmitidasFiltroBuscar');
const boletasEmitidasFiltroLimpiar = document.getElementById('boletasEmitidasFiltroLimpiar');

let boletasSeleccionadas = new Set();
let pendientesPorId = {};
// Guarda los listados completos (tal como salen de renderBoletas) para poder
// re-filtrar en el cliente sin volver a consultar.
let boletasPendientesCache = [];
let boletasEmitidasCache = [];
// Subconjuntos actualmente visibles según los filtros de cada tabla, usados para exportar.
let boletasPendientesFiltrado = [];
let boletasEmitidasFiltrado = [];

function actualizarBotonGrupoBoleta() {
    boletasSeleccionadasCount.textContent = boletasSeleccionadas.size;
    boletasMarcarGrupoBtn.disabled = boletasSeleccionadas.size < 2;
}

// Determina si una remesa requiere boleta: solo cuando el CLP entra al negocio
// (el cliente paga en CLP). Si el CLP sale (por ejemplo, un cambio de VES a
// CLP donde el cliente entrega VES y recibe CLP), no corresponde emitir boleta.
function requiereBoleta(r) {
    return (r.monedaEnviado || '').toUpperCase() === 'CLP';
}

function renderBoletas(remesas) {
    const activas = remesas.filter(r => r.estado !== 'cancelado' && requiereBoleta(r));
    const pendientes = activas.filter(r => !r.boletaEmitida);
    const emitidas = activas.filter(r => r.boletaEmitida);

    pendientesPorId = {};
    pendientes.forEach(r => { pendientesPorId[r.id] = r; });
    // Si una remesa seleccionada ya no está pendiente (se marcó desde otra
    // pestaña, por ejemplo), se quita sola de la selección.
    boletasSeleccionadas.forEach(id => { if (!pendientesPorId[id]) boletasSeleccionadas.delete(id); });
    actualizarBotonGrupoBoleta();

    // --- Resumen ---
    boletasPendientesCount.textContent = pendientes.length;
    const montoPendienteClp = pendientes
        .filter(r => (r.monedaEnviado || '').toUpperCase() === 'CLP')
        .reduce((sum, r) => sum + (r.montoEnviado || 0), 0);
    boletasPendientesMonto.textContent = formatMoney(montoPendienteClp, 'CLP');

    const hoy = new Date();
    const emitidasEsteMes = emitidas.filter(r => r.fechaBoleta && r.fechaBoleta.toDate
        && r.fechaBoleta.toDate().getMonth() === hoy.getMonth()
        && r.fechaBoleta.toDate().getFullYear() === hoy.getFullYear());
    boletasEmitidasMes.textContent = emitidasEsteMes.length;

    // --- Tablas: se guardan en cache y se pintan a través de los filtros ---
    boletasPendientesCache = pendientes;
    boletasEmitidasCache = emitidas;
    aplicarFiltroBoletasPendientes();
    aplicarFiltroBoletasEmitidas();
}

// Aplica los filtros de fecha y búsqueda por cliente sobre
// boletasPendientesCache, y vuelve a pintar la tabla de Pendientes de boleta.
function aplicarFiltroBoletasPendientes() {
    const desdeFiltro = boletasPendientesFiltroDesde.value;
    const hastaFiltro = boletasPendientesFiltroHasta.value;
    const textoBusqueda = boletasPendientesFiltroBuscar.value.trim().toLowerCase();
    const hayFiltrosActivos = !!desdeFiltro || !!hastaFiltro || textoBusqueda !== '';

    const filtrados = boletasPendientesCache.filter(r => {
        if ((desdeFiltro || hastaFiltro) && !fechaEnRango(r.createdAt, desdeFiltro, hastaFiltro)) return false;
        if (textoBusqueda && !(r.clienteNombre || '').toLowerCase().includes(textoBusqueda)) return false;
        return true;
    });

    actualizarPanelFiltros('boletasPendientes', [
        {
            label: 'Rango de fechas', activo: !!desdeFiltro || !!hastaFiltro,
            texto: `Fecha: ${desdeFiltro || '…'} – ${hastaFiltro || '…'}`,
            onQuitar: () => { boletasPendientesFiltroDesde.value = ''; boletasPendientesFiltroHasta.value = ''; aplicarFiltroBoletasPendientes(); }
        },
        {
            label: 'Búsqueda', activo: textoBusqueda !== '',
            texto: `Cliente: "${boletasPendientesFiltroBuscar.value.trim()}"`,
            onQuitar: () => { boletasPendientesFiltroBuscar.value = ''; aplicarFiltroBoletasPendientes(); }
        }
    ], { mostrados: filtrados.length, total: boletasPendientesCache.length });

    boletasPendientesFiltrado = filtrados;
    boletasPendientesBody.innerHTML = '';
    if (filtrados.length === 0) {
        boletasPendientesEmpty.style.display = 'block';
        boletasPendientesTableWrap.style.display = 'none';
        boletasPendientesEmpty.querySelector('p').textContent = hayFiltrosActivos
            ? 'No hay remesas pendientes que coincidan con el filtro.'
            : 'No tienes remesas pendientes de boleta.';
        return;
    }
    boletasPendientesEmpty.style.display = 'none';
    boletasPendientesTableWrap.style.display = 'block';
    filtrados.forEach(r => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><input type="checkbox" class="boleta-checkbox" data-id="${r.id}" ${boletasSeleccionadas.has(r.id) ? 'checked' : ''}></td>
            <td>${formatDate(r.createdAt)}</td>
            <td>${escapeHtml(r.clienteNombre) || '—'}</td>
            <td class="mono-cell">${formatMoney(r.montoEnviado, r.monedaEnviado)}</td>
            <td><span class="${badgeClass(r.estado)}">${badgeLabel(r.estado)}</span></td>
            <td><button type="button" class="btn-icon-action" data-id="${r.id}"><i class="ti ti-receipt" aria-hidden="true"></i> Marcar boleta emitida</button></td>
        `;
        tr.querySelector('.boleta-checkbox').addEventListener('change', (e) => {
            if (e.target.checked) boletasSeleccionadas.add(r.id);
            else boletasSeleccionadas.delete(r.id);
            actualizarBotonGrupoBoleta();
        });
        tr.querySelector('button').addEventListener('click', () => marcarBoletaEmitida(r.id));
        boletasPendientesBody.appendChild(tr);
    });
}

// Aplica los filtros de fecha y búsqueda por cliente/folio sobre
// boletasEmitidasCache, y vuelve a pintar la tabla de Boletas emitidas.
function aplicarFiltroBoletasEmitidas() {
    const desdeFiltro = boletasEmitidasFiltroDesde.value;
    const hastaFiltro = boletasEmitidasFiltroHasta.value;
    const textoBusqueda = boletasEmitidasFiltroBuscar.value.trim().toLowerCase();
    const hayFiltrosActivos = !!desdeFiltro || !!hastaFiltro || textoBusqueda !== '';

    const filtrados = boletasEmitidasCache.filter(r => {
        if ((desdeFiltro || hastaFiltro) && !fechaEnRango(r.createdAt, desdeFiltro, hastaFiltro)) return false;
        if (textoBusqueda) {
            const enCliente = (r.clienteNombre || '').toLowerCase().includes(textoBusqueda);
            const enFolio = (r.folioBoleta || '').toLowerCase().includes(textoBusqueda);
            if (!enCliente && !enFolio) return false;
        }
        return true;
    });

    actualizarPanelFiltros('boletasEmitidas', [
        {
            label: 'Rango de fechas', activo: !!desdeFiltro || !!hastaFiltro,
            texto: `Fecha: ${desdeFiltro || '…'} – ${hastaFiltro || '…'}`,
            onQuitar: () => { boletasEmitidasFiltroDesde.value = ''; boletasEmitidasFiltroHasta.value = ''; aplicarFiltroBoletasEmitidas(); }
        },
        {
            label: 'Búsqueda', activo: textoBusqueda !== '',
            texto: `Cliente/folio: "${boletasEmitidasFiltroBuscar.value.trim()}"`,
            onQuitar: () => { boletasEmitidasFiltroBuscar.value = ''; aplicarFiltroBoletasEmitidas(); }
        }
    ], { mostrados: filtrados.length, total: boletasEmitidasCache.length });

    boletasEmitidasFiltrado = filtrados;
    boletasEmitidasBody.innerHTML = '';
    if (filtrados.length === 0) {
        boletasEmitidasEmpty.style.display = 'block';
        boletasEmitidasTableWrap.style.display = 'none';
        boletasEmitidasEmpty.querySelector('p').textContent = hayFiltrosActivos
            ? 'No hay boletas emitidas que coincidan con el filtro.'
            : 'Todavía no has marcado ninguna boleta como emitida.';
        return;
    }
    boletasEmitidasEmpty.style.display = 'none';
    boletasEmitidasTableWrap.style.display = 'block';

    // Para las boletas agrupadas, se calcula el total real del grupo
    // (puede incluir remesas que no vinieron en este mismo listado filtrado).
    const totalesPorGrupo = {};
    boletasEmitidasCache.forEach(r => {
        if (!r.grupoBoletaId) return;
        totalesPorGrupo[r.grupoBoletaId] = (totalesPorGrupo[r.grupoBoletaId] || 0) + (r.montoEnviado || 0);
    });

    filtrados.forEach(r => {
        const tr = document.createElement('tr');
        const grupoInfo = r.grupoBoletaId
            ? `<div class="cell-subtext">Boleta agrupada · total ${formatMoney(totalesPorGrupo[r.grupoBoletaId], r.monedaEnviado)}</div>`
            : '';
        tr.innerHTML = `
            <td>${formatDate(r.createdAt)}</td>
            <td>${escapeHtml(r.clienteNombre) || '—'}</td>
            <td class="mono-cell">${formatMoney(r.montoEnviado, r.monedaEnviado)}${grupoInfo}</td>
            <td>${escapeHtml(r.folioBoleta) || '—'}</td>
            <td><button type="button" class="btn-icon-action danger" data-id="${r.id}">Quitar marca</button></td>
        `;
        tr.querySelector('button').addEventListener('click', () => quitarMarcaBoleta(r.id));
        boletasEmitidasBody.appendChild(tr);
    });
}

[boletasPendientesFiltroDesde, boletasPendientesFiltroHasta].forEach(el => {
    el.addEventListener('change', aplicarFiltroBoletasPendientes);
});
boletasPendientesFiltroBuscar.addEventListener('input', aplicarFiltroBoletasPendientes);
boletasPendientesFiltroLimpiar.addEventListener('click', () => {
    boletasPendientesFiltroDesde.value = '';
    boletasPendientesFiltroHasta.value = '';
    boletasPendientesFiltroBuscar.value = '';
    aplicarFiltroBoletasPendientes();
});
initFiltrosToggle('boletasPendientes');

// ============================================
// EXPORTAR BOLETAS (Pendientes de boleta) — PDF (jsPDF) y Excel (SheetJS)
// Exporta siempre lo que está visible en pantalla (respeta los filtros activos).
// ============================================
const boletasPendientesExportarPdfBtn = document.getElementById('boletasPendientesExportarPdfBtn');
const boletasPendientesExportarExcelBtn = document.getElementById('boletasPendientesExportarExcelBtn');

function filasExportBoletasPendientes() {
    return boletasPendientesFiltrado.map(r => ({
        Fecha: formatDate(r.createdAt),
        Cliente: r.clienteNombre || '—',
        Monto: moneyTexto(r.montoEnviado, r.monedaEnviado),
        Estado: badgeLabel(r.estado)
    }));
}

boletasPendientesExportarPdfBtn.addEventListener('click', () => {
    if (boletasPendientesFiltrado.length === 0) {
        alert('No hay remesas pendientes para exportar con los filtros actuales.');
        return;
    }
    const filas = filasExportBoletasPendientes();
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape' });

    doc.setFontSize(14);
    doc.text('Boletas — Pendientes de boleta', 14, 15);
    doc.setFontSize(10);
    doc.setTextColor(120);
    doc.text(`Generado el ${new Date().toLocaleDateString('es-CL')} · ${filas.length} remesa(s)`, 14, 21);

    doc.autoTable({
        startY: 26,
        head: [['Fecha', 'Cliente', 'Monto', 'Estado']],
        body: filas.map(f => [f.Fecha, f.Cliente, f.Monto, f.Estado]),
        styles: { fontSize: 8.5, cellPadding: 3 },
        headStyles: { fillColor: [30, 41, 59] },
        alternateRowStyles: { fillColor: [245, 246, 248] }
    });

    doc.save(`boletas-pendientes-${fechaArchivo()}.pdf`);
});

boletasPendientesExportarExcelBtn.addEventListener('click', () => {
    if (boletasPendientesFiltrado.length === 0) {
        alert('No hay remesas pendientes para exportar con los filtros actuales.');
        return;
    }
    const filas = filasExportBoletasPendientes();
    const hoja = XLSX.utils.json_to_sheet(filas);
    hoja['!cols'] = [{ wch: 12 }, { wch: 24 }, { wch: 16 }, { wch: 14 }];
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, 'Pendientes de boleta');
    XLSX.writeFile(libro, `boletas-pendientes-${fechaArchivo()}.xlsx`);
});

[boletasEmitidasFiltroDesde, boletasEmitidasFiltroHasta].forEach(el => {
    el.addEventListener('change', aplicarFiltroBoletasEmitidas);
});
boletasEmitidasFiltroBuscar.addEventListener('input', aplicarFiltroBoletasEmitidas);
boletasEmitidasFiltroLimpiar.addEventListener('click', () => {
    boletasEmitidasFiltroDesde.value = '';
    boletasEmitidasFiltroHasta.value = '';
    boletasEmitidasFiltroBuscar.value = '';
    aplicarFiltroBoletasEmitidas();
});
initFiltrosToggle('boletasEmitidas');

// ============================================
// EXPORTAR BOLETAS (Boletas emitidas) — PDF (jsPDF) y Excel (SheetJS)
// Exporta siempre lo que está visible en pantalla (respeta los filtros activos).
// ============================================
const boletasEmitidasExportarPdfBtn = document.getElementById('boletasEmitidasExportarPdfBtn');
const boletasEmitidasExportarExcelBtn = document.getElementById('boletasEmitidasExportarExcelBtn');

function filasExportBoletasEmitidas() {
    const totalesPorGrupo = {};
    boletasEmitidasCache.forEach(r => {
        if (!r.grupoBoletaId) return;
        totalesPorGrupo[r.grupoBoletaId] = (totalesPorGrupo[r.grupoBoletaId] || 0) + (r.montoEnviado || 0);
    });

    return boletasEmitidasFiltrado.map(r => ({
        Fecha: formatDate(r.createdAt),
        Cliente: r.clienteNombre || '—',
        Monto: moneyTexto(r.montoEnviado, r.monedaEnviado),
        Folio: r.folioBoleta || '—',
        'Total del grupo': r.grupoBoletaId ? moneyTexto(totalesPorGrupo[r.grupoBoletaId], r.monedaEnviado) : '—'
    }));
}

boletasEmitidasExportarPdfBtn.addEventListener('click', () => {
    if (boletasEmitidasFiltrado.length === 0) {
        alert('No hay boletas emitidas para exportar con los filtros actuales.');
        return;
    }
    const filas = filasExportBoletasEmitidas();
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape' });

    doc.setFontSize(14);
    doc.text('Boletas — Boletas emitidas', 14, 15);
    doc.setFontSize(10);
    doc.setTextColor(120);
    doc.text(`Generado el ${new Date().toLocaleDateString('es-CL')} · ${filas.length} boleta(s)`, 14, 21);

    doc.autoTable({
        startY: 26,
        head: [['Fecha', 'Cliente', 'Monto', 'Folio', 'Total del grupo']],
        body: filas.map(f => [f.Fecha, f.Cliente, f.Monto, f.Folio, f['Total del grupo']]),
        styles: { fontSize: 8.5, cellPadding: 3 },
        headStyles: { fillColor: [30, 41, 59] },
        alternateRowStyles: { fillColor: [245, 246, 248] }
    });

    doc.save(`boletas-emitidas-${fechaArchivo()}.pdf`);
});

boletasEmitidasExportarExcelBtn.addEventListener('click', () => {
    if (boletasEmitidasFiltrado.length === 0) {
        alert('No hay boletas emitidas para exportar con los filtros actuales.');
        return;
    }
    const filas = filasExportBoletasEmitidas();
    const hoja = XLSX.utils.json_to_sheet(filas);
    hoja['!cols'] = [{ wch: 12 }, { wch: 24 }, { wch: 16 }, { wch: 14 }, { wch: 18 }];
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, 'Boletas emitidas');
    XLSX.writeFile(libro, `boletas-emitidas-${fechaArchivo()}.xlsx`);
});

boletasMarcarGrupoBtn.addEventListener('click', async () => {
    const ids = Array.from(boletasSeleccionadas);
    if (ids.length < 2) return;
    const seleccionadas = ids.map(id => pendientesPorId[id]).filter(Boolean);

    const monedas = new Set(seleccionadas.map(r => (r.monedaEnviado || '').toUpperCase()));
    if (monedas.size > 1) {
        alert('Las remesas seleccionadas tienen monedas distintas. Solo puedes agrupar remesas en la misma moneda (lo que realmente pagó el cliente).');
        return;
    }

    const moneda = seleccionadas[0].monedaEnviado;
    const total = seleccionadas.reduce((sum, r) => sum + (r.montoEnviado || 0), 0);
    const folio = prompt(
        `Vas a agrupar ${seleccionadas.length} remesas en una sola boleta por ${formatMoney(total, moneda)}.\n\nNúmero de folio de la boleta en e-Boleta (opcional):`,
        ''
    );
    if (folio === null) return; // canceló

    try {
        const grupoBoletaId = `grupo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const batch = db.batch();
        seleccionadas.forEach(r => {
            batch.update(db.collection('remesas').doc(r.id), {
                boletaEmitida: true,
                folioBoleta: folio.trim(),
                grupoBoletaId,
                fechaBoleta: firebase.firestore.FieldValue.serverTimestamp()
            });
        });
        await batch.commit();
        boletasSeleccionadas.clear();
    } catch (error) {
        console.error('Error al agrupar boletas:', error);
        alert('No se pudo agrupar la boleta. Intenta de nuevo.');
    }
});

async function marcarBoletaEmitida(remesaId) {
    const folio = prompt('Número de folio de la boleta en e-Boleta (opcional, puedes dejarlo en blanco):', '');
    if (folio === null) return; // canceló el prompt
    try {
        await db.collection('remesas').doc(remesaId).update({
            boletaEmitida: true,
            folioBoleta: folio.trim(),
            fechaBoleta: firebase.firestore.FieldValue.serverTimestamp()
        });
    } catch (error) {
        console.error('Error al marcar boleta emitida:', error);
        alert('No se pudo marcar la boleta. Intenta de nuevo.');
    }
}

async function quitarMarcaBoleta(remesaId) {
    if (!confirm('¿Quitar la marca de boleta emitida de esta remesa? Volverá a aparecer como pendiente.')) return;
    try {
        await db.collection('remesas').doc(remesaId).update({
            boletaEmitida: false,
            folioBoleta: '',
            grupoBoletaId: firebase.firestore.FieldValue.delete(),
            fechaBoleta: null
        });
    } catch (error) {
        console.error('Error al quitar marca de boleta:', error);
        alert('No se pudo actualizar. Intenta de nuevo.');
    }
}

// ============================================
// COMPARTIR TASA COMO IMAGEN (para WhatsApp Estado, etc.)
// ============================================
const ESLOGAN_TASA = 'Tu dinero, más cerca de casa';

// Dibuja UN cuadro de la escena (se usa tanto para el video animado como
// para la imagen estática de respaldo). "t" va de 0 a 1 y controla el
// parpadeo de las luces del puente — el puente es una ilustración propia
// estilizada (torres, cables y luces), no una foto real.
function dibujarFrameTasa(ctx, data, t, slogan) {
    const W = 1080, H = 1080, cx = W / 2;
    ctx.clearRect(0, 0, W, H);

    // Cielo nocturno degradado
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#081625');
    grad.addColorStop(0.55, '#123258');
    grad.addColorStop(1, '#1d4e89');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // Luna con resplandor suave
    const moonX = W - 190, moonY = 150;
    const moonGlow = ctx.createRadialGradient(moonX, moonY, 10, moonX, moonY, 110);
    moonGlow.addColorStop(0, 'rgba(255,247,222,0.35)');
    moonGlow.addColorStop(1, 'rgba(255,247,222,0)');
    ctx.fillStyle = moonGlow;
    ctx.fillRect(moonX - 110, moonY - 110, 220, 220);
    ctx.fillStyle = 'rgba(255,251,235,0.92)';
    ctx.beginPath();
    ctx.arc(moonX, moonY, 34, 0, Math.PI * 2);
    ctx.fill();

    // Estrellas sutiles, titilando
    for (let i = 0; i < 36; i++) {
        const sx = (i * 137) % W;
        const sy = (i * 89) % 360;
        const tw = 0.4 + 0.6 * Math.abs(Math.sin(t * 2 * Math.PI + i));
        ctx.globalAlpha = tw * 0.6;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(sx, sy, 1.6, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'center';

    const conSombra = (dibujar) => {
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.45)';
        ctx.shadowBlur = 14;
        ctx.shadowOffsetY = 3;
        dibujar();
        ctx.restore();
    };

    // Marca
    ctx.fillStyle = '#e8b84b';
    ctx.fillRect(cx - 36, 78, 72, 4);
    conSombra(() => {
        ctx.fillStyle = '#ffffff';
        ctx.font = '600 54px "Helvetica Neue", Arial, sans-serif';
        ctx.fillText('Lagomarcambios', cx, 158);
    });

    // Tarjeta con la tasa
    const cardX = 90, cardY = 200, cardW = W - 180, cardH = 330;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 30;
    ctx.shadowOffsetY = 12;
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    ctx.beginPath();
    ctx.roundRect(cardX, cardY, cardW, cardH, 26);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(cardX, cardY, cardW, cardH, 26);
    ctx.stroke();
    // brillo sutil en el borde superior de la tarjeta
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath();
    ctx.moveTo(cardX + 26, cardY + 1);
    ctx.lineTo(cardX + cardW - 26, cardY + 1);
    ctx.stroke();

    ctx.font = '500 42px "Helvetica Neue", Arial, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    const rutaTexto = `${data.monedaOrigen}  →  ${data.monedaDestino}`;
    ctx.fillText(rutaTexto, cx, cardY + 80);

    // Banderitas circulares junto al texto de la ruta (como en la pieza
    // gráfica original de Lagomarcambios), a los costados del texto
    const rutaAncho = ctx.measureText(rutaTexto).width;
    const dibujarBanderaChile = (bx, by, r) => {
        ctx.save();
        ctx.beginPath();
        ctx.arc(bx, by, r, 0, Math.PI * 2);
        ctx.clip();
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(bx - r, by - r, r * 2, r);
        ctx.fillStyle = '#d52b1e';
        ctx.fillRect(bx - r, by, r * 2, r);
        ctx.fillStyle = '#0039a6';
        ctx.fillRect(bx - r, by - r, r, r);
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        const starR = r * 0.22;
        const sx = bx - r * 0.5, sy = by - r * 0.5;
        for (let i = 0; i < 5; i++) {
            const ang = -Math.PI / 2 + i * (Math.PI * 2 / 5);
            const angIn = ang + Math.PI / 5;
            ctx.lineTo(sx + Math.cos(ang) * starR, sy + Math.sin(ang) * starR);
            ctx.lineTo(sx + Math.cos(angIn) * starR * 0.42, sy + Math.sin(angIn) * starR * 0.42);
        }
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(bx, by, r, 0, Math.PI * 2);
        ctx.stroke();
    };
    const dibujarBanderaVenezuela = (bx, by, r) => {
        ctx.save();
        ctx.beginPath();
        ctx.arc(bx, by, r, 0, Math.PI * 2);
        ctx.clip();
        ctx.fillStyle = '#ffcc00';
        ctx.fillRect(bx - r, by - r, r * 2, r * 2 / 3);
        ctx.fillStyle = '#00247d';
        ctx.fillRect(bx - r, by - r / 3, r * 2, r * 2 / 3);
        ctx.fillStyle = '#cf142b';
        ctx.fillRect(bx - r, by + r / 3, r * 2, r * 2 / 3);
        ctx.fillStyle = '#ffffff';
        for (let i = 0; i < 7; i++) {
            const ang = -Math.PI * 0.55 + i * (Math.PI * 1.1 / 6);
            ctx.beginPath();
            ctx.arc(bx + Math.cos(ang) * r * 0.55, by + Math.sin(ang) * r * 0.15, r * 0.09, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(bx, by, r, 0, Math.PI * 2);
        ctx.stroke();
    };
    dibujarBanderaChile(cx - rutaAncho / 2 - 34, cardY + 68, 15);
    dibujarBanderaVenezuela(cx + rutaAncho / 2 + 34, cardY + 68, 15);

    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cardX + 70, cardY + 120);
    ctx.lineTo(cardX + cardW - 70, cardY + 120);
    ctx.stroke();

    conSombra(() => {
        ctx.fillStyle = '#f2c866';
        ctx.font = '700 104px "Helvetica Neue", Arial, sans-serif';
        ctx.fillText(`${data.tasa}`, cx, cardY + 245);
    });

    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.font = '400 30px "Helvetica Neue", Arial, sans-serif';
    ctx.fillText(`${data.monedaDestino} por cada 1 ${data.monedaOrigen}`, cx, cardY + 295);

    // Eslogan, en el espacio entre la tarjeta y el puente
    if (slogan) {
        ctx.save();
        ctx.fillStyle = '#e8b84b';
        ctx.fillRect(cx - 3, cardY + cardH + 26, 6, 6);
        ctx.restore();
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.font = 'italic 400 30px "Helvetica Neue", Arial, sans-serif';
        ctx.fillText(slogan, cx, cardY + cardH + 74);
    }

    // --- Puente estilizado (ilustración propia, no una foto real) ---
    const deckY = 840, towerTopY = 630;
    const towerXs = [330, 750];
    const towerW = 26;

    // cubierta con leve brillo superior
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(50, deckY);
    ctx.lineTo(W - 50, deckY);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(50, deckY - 5);
    ctx.lineTo(W - 50, deckY - 5);
    ctx.stroke();

    const dibujarTorre = (tx, ti) => {
        // Cables con leve curvatura (más realista que una línea recta)
        for (let i = 0; i < 7; i++) {
            const anchorX = tx + (-150 + i * 50);
            const midX = tx + (anchorX - tx) * 0.55;
            const midY = towerTopY + (deckY - towerTopY) * 0.5 + 14;
            ctx.strokeStyle = 'rgba(255,255,255,0.22)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(tx, towerTopY + 24);
            ctx.quadraticCurveTo(midX, midY, anchorX, deckY);
            ctx.stroke();
        }

        // Torre ligeramente ahusada, con remate
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.beginPath();
        ctx.moveTo(tx - towerW / 2, deckY);
        ctx.lineTo(tx - towerW / 2 + 4, towerTopY + 16);
        ctx.lineTo(tx, towerTopY);
        ctx.lineTo(tx + towerW / 2 - 4, towerTopY + 16);
        ctx.lineTo(tx + towerW / 2, deckY);
        ctx.closePath();
        ctx.fill();

        // Luz de remate, parpadeando
        const glow = 0.5 + 0.5 * Math.sin(t * 2 * Math.PI * 1.3 + ti * 2);
        ctx.fillStyle = `rgba(242,200,102,${0.55 + 0.45 * glow})`;
        ctx.beginPath();
        ctx.arc(tx, towerTopY - 6, 9, 0, Math.PI * 2);
        ctx.fill();
    };
    towerXs.forEach(dibujarTorre);

    // Luces de la cubierta, parpadeando en cadena
    for (let i = 0; i < 16; i++) {
        const lx = 70 + i * ((W - 140) / 15);
        const glow = 0.4 + 0.6 * Math.abs(Math.sin(t * 2 * Math.PI * 0.9 + i * 0.5));
        ctx.fillStyle = `rgba(242,200,102,${glow})`;
        ctx.beginPath();
        ctx.arc(lx, deckY + 3, 3.5, 0, Math.PI * 2);
        ctx.fill();
    }

    // Reflejo suave de la luna en el agua, como una franja de brillo vertical
    ctx.save();
    const moonReflect = ctx.createLinearGradient(0, deckY + 10, 0, H - 130);
    moonReflect.addColorStop(0, 'rgba(255,247,222,0.16)');
    moonReflect.addColorStop(1, 'rgba(255,247,222,0)');
    ctx.fillStyle = moonReflect;
    ctx.beginPath();
    ctx.moveTo(moonX - 60, deckY + 10);
    ctx.lineTo(moonX + 60, deckY + 10);
    ctx.lineTo(moonX + 18, H - 130);
    ctx.lineTo(moonX - 18, H - 130);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Reflejo tenue de las torres y luces en el agua
    ctx.save();
    ctx.translate(0, deckY * 2);
    ctx.scale(1, -1);
    ctx.globalAlpha = 0.15;
    towerXs.forEach(tx => {
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.moveTo(tx - towerW / 2, deckY);
        ctx.lineTo(tx - towerW / 2 + 4, towerTopY + 16);
        ctx.lineTo(tx, towerTopY);
        ctx.lineTo(tx + towerW / 2 - 4, towerTopY + 16);
        ctx.lineTo(tx + towerW / 2, deckY);
        ctx.closePath();
        ctx.fill();
    });
    ctx.globalAlpha = 0.25;
    for (let i = 0; i < 16; i++) {
        const lx = 70 + i * ((W - 140) / 15);
        ctx.fillStyle = '#f2c866';
        ctx.beginPath();
        ctx.arc(lx, deckY + 3, 2.5, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();

    // Degradado oscuro abajo para que la fecha se lea bien
    const bottomGrad = ctx.createLinearGradient(0, H - 205, 0, H);
    bottomGrad.addColorStop(0, 'rgba(8,15,25,0)');
    bottomGrad.addColorStop(1, 'rgba(8,15,25,0.68)');
    ctx.fillStyle = bottomGrad;
    ctx.fillRect(0, H - 205, W, 205);

    const fecha = data.actualizadoEn && data.actualizadoEn.toDate
        ? data.actualizadoEn.toDate().toLocaleDateString('es-CL', { day: '2-digit', month: 'long', year: 'numeric' })
        : new Date().toLocaleDateString('es-CL', { day: '2-digit', month: 'long', year: 'numeric' });

    // Aviso "tasa sujeta a cambios", como una pequeña píldora
    ctx.font = '500 22px "Helvetica Neue", Arial, sans-serif';
    const avisoTexto = 'Tasa sujeta a cambios';
    const avisoAncho = ctx.measureText(avisoTexto).width;
    const avisoY = H - 148;
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.beginPath();
    ctx.roundRect(cx - avisoAncho / 2 - 18, avisoY - 22, avisoAncho + 36, 36, 18);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(cx - avisoAncho / 2 - 18, avisoY - 22, avisoAncho + 36, 36, 18);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText(avisoTexto, cx, avisoY + 3);

    // Línea de confianza: bancos y métodos receptores (en dos líneas, ya
    // que la lista es más larga)
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font = '400 21px "Helvetica Neue", Arial, sans-serif';
    ctx.fillText('Banesco · Mercantil · BNC · Banco de Venezuela', cx, H - 100);
    ctx.fillText('Provincial · Pago Móvil', cx, H - 74);

    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = '400 26px "Helvetica Neue", Arial, sans-serif';
    ctx.fillText(`Actualizado el ${fecha}`, cx, H - 36);

    // Marco sutil general para un acabado más cuidado
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 2;
    ctx.strokeRect(10, 10, W - 20, H - 20);
}

// Imagen estática (respaldo si el navegador no puede grabar video)
function dibujarImagenTasa(data) {
    const canvas = document.createElement('canvas');
    canvas.width = 1080;
    canvas.height = 1080;
    dibujarFrameTasa(canvas.getContext('2d'), data, 0.25, ESLOGAN_TASA);
    return canvas;
}

const tasaPreviewOverlay = document.getElementById('tasaPreviewOverlay');
const tasaPreviewImg = document.getElementById('tasaPreviewImg');
const tasaPreviewCerrarBtn = document.getElementById('tasaPreviewCerrarBtn');
const tasaPreviewCompartirBtn = document.getElementById('tasaPreviewCompartirBtn');
const tasaPreviewDescargarBtn = document.getElementById('tasaPreviewDescargarBtn');
let tasaPreviewBlob = null;
let tasaPreviewNombreArchivo = '';

function cerrarPreviewTasa() {
    tasaPreviewOverlay.classList.add('hidden');
    if (tasaPreviewImg.src) URL.revokeObjectURL(tasaPreviewImg.src);
    tasaPreviewImg.src = '';
    tasaPreviewBlob = null;
}
tasaPreviewCerrarBtn.addEventListener('click', cerrarPreviewTasa);
tasaPreviewOverlay.addEventListener('click', (e) => {
    if (e.target === tasaPreviewOverlay) cerrarPreviewTasa();
});

tasaPreviewDescargarBtn.addEventListener('click', () => {
    if (!tasaPreviewBlob) return;
    const url = URL.createObjectURL(tasaPreviewBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = tasaPreviewNombreArchivo;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
});

tasaPreviewCompartirBtn.addEventListener('click', async () => {
    if (!tasaPreviewBlob) return;
    const file = new File([tasaPreviewBlob], tasaPreviewNombreArchivo, { type: 'image/png' });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
            await navigator.share({ files: [file], title: 'Tasa de cambio' });
            cerrarPreviewTasa();
            return;
        } catch (error) {
            if (error && error.name === 'AbortError') return; // el usuario canceló el share
            console.error('Error al compartir la imagen:', error);
        }
    }
    // Si no hay soporte para compartir archivos, se descarga en su lugar
    alert('Tu navegador no puede abrir el selector de compartir. Se descargará la imagen para que la envíes manualmente.');
    tasaPreviewDescargarBtn.click();
});

window.compartirTasaImagen = async (docId) => {
    const data = tasasCache[`__doc_${docId}`];
    if (!data) {
        alert('No se encontró esa tasa. Recarga la página e intenta de nuevo.');
        return;
    }

    const canvas = dibujarImagenTasa(data);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) {
        alert('No se pudo generar la imagen. Intenta de nuevo.');
        return;
    }

    tasaPreviewBlob = blob;
    tasaPreviewNombreArchivo = `tasa-${data.monedaOrigen}-${data.monedaDestino}.png`;
    tasaPreviewImg.src = URL.createObjectURL(blob);
    tasaPreviewOverlay.classList.remove('hidden');
};

// ============================================
// VISTA DE AUDITORÍA — lista de solo lectura
// ============================================
const AUDITORIA_TIPO_LABEL = { tasa: 'Tasa', remesa: 'Remesa', caja: 'Caja' };
const AUDITORIA_ACCION_LABEL = {
    crear: 'Creación', editar: 'Edición', eliminar: 'Eliminación',
    abrir: 'Apertura de caja', cerrar: 'Cierre de caja'
};
const AUDITORIA_ACCION_BADGE = {
    crear: 'badge-success', editar: 'badge-pending', eliminar: 'badge-danger',
    abrir: 'badge-success', cerrar: 'badge-neutral'
};

// Convierte el objeto "detalle" guardado en cada registro en una frase legible,
// sin mostrar el JSON crudo.
function formatearDetalleAuditoria(tipo, accion, detalle = {}) {
    if (tipo === 'tasa') {
        if (accion === 'eliminar') return `Par ${detalle.par || '—'} (tasa ${detalle.tasa ?? '—'})`;
        const partes = [`Par ${detalle.par || '—'}: ${detalle.tasaAnterior ?? '—'} → ${detalle.tasaNueva ?? '—'}`];
        if (detalle.tasaMercadoNueva != null && detalle.tasaMercadoNueva !== detalle.tasaMercadoAnterior) {
            partes.push(`mercado ${detalle.tasaMercadoAnterior ?? '—'} → ${detalle.tasaMercadoNueva}`);
        }
        return partes.join(', ');
    }
    if (tipo === 'remesa') {
        const base = `${detalle.cliente || 'Cliente sin nombre'}${detalle.remesaId ? ` (#${detalle.remesaId.slice(0, 6)})` : ''}`;
        if (accion === 'crear') return `${base}: ${formatMoney(detalle.montoEnviado, detalle.monedaEnviado)} a tasa ${detalle.tasaCambio ?? '—'}`;
        if (accion === 'eliminar') return `${base}: ${formatMoney(detalle.montoEnviado, detalle.monedaEnviado)}`;
        const campos = Object.keys(detalle.cambios || {});
        if (campos.length === 0) return `${base}: sin cambios de valor detectados`;
        return `${base}: ${campos.map(c => `${c} ${detalle.cambios[c].antes ?? '—'} → ${detalle.cambios[c].despues ?? '—'}`).join('; ')}`;
    }
    if (tipo === 'caja') {
        if (accion === 'abrir') {
            const saldos = Object.entries(detalle.saldosIniciales || {}).map(([m, v]) => formatMoney(v, m)).join(', ');
            return `Saldos iniciales: ${saldos || '—'}`;
        }
        if (accion === 'cerrar') {
            const diffs = Object.entries(detalle.diferencias || {})
                .filter(([, v]) => v !== 0)
                .map(([m, v]) => formatMoney(v, m));
            return diffs.length ? `Diferencias: ${diffs.join(', ')}` : 'Sin diferencias';
        }
    }
    return '—';
}

const auditoriaBody = document.getElementById('auditoriaBody');
const auditoriaEmpty = document.getElementById('auditoriaEmpty');
const auditoriaFiltroTipo = document.getElementById('auditoriaFiltroTipo');
const auditoriaFiltroBuscar = document.getElementById('auditoriaFiltroBuscar');
let auditoriaRegistros = [];

function renderAuditoria() {
    if (!auditoriaBody) return;
    const tipoFiltro = auditoriaFiltroTipo ? auditoriaFiltroTipo.value : 'todos';
    const busqueda = auditoriaFiltroBuscar ? auditoriaFiltroBuscar.value.trim().toLowerCase() : '';

    const filtrados = auditoriaRegistros.filter(r => {
        if (tipoFiltro !== 'todos' && r.tipo !== tipoFiltro) return false;
        if (!busqueda) return true;
        const texto = `${r.usuarioEmail || ''} ${JSON.stringify(r.detalle || {})}`.toLowerCase();
        return texto.includes(busqueda);
    });

    auditoriaBody.innerHTML = '';
    filtrados.forEach(r => {
        const fecha = r.creadoEn && r.creadoEn.toDate ? r.creadoEn.toDate().toLocaleString('es-CL') : '—';
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${fecha}</td>
            <td>${AUDITORIA_TIPO_LABEL[r.tipo] || escapeHtml(r.tipo)}</td>
            <td><span class="badge ${AUDITORIA_ACCION_BADGE[r.accion] || 'badge-neutral'}">${AUDITORIA_ACCION_LABEL[r.accion] || escapeHtml(r.accion)}</span></td>
            <td>${escapeHtml(formatearDetalleAuditoria(r.tipo, r.accion, r.detalle))}</td>
            <td>${escapeHtml(r.usuarioEmail || '—')}</td>
        `;
        auditoriaBody.appendChild(tr);
    });

    auditoriaEmpty.classList.toggle('hidden', filtrados.length > 0);
}

if (auditoriaFiltroTipo) auditoriaFiltroTipo.addEventListener('change', renderAuditoria);
if (auditoriaFiltroBuscar) auditoriaFiltroBuscar.addEventListener('input', renderAuditoria);

auditoriaColeccion.orderBy('creadoEn', 'desc').limit(300).onSnapshot(snapshot => {
    auditoriaRegistros = snapshot.docs.map(doc => doc.data());
    renderAuditoria();
}, err => console.warn('No se pudo cargar la auditoría:', err));
