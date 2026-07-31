import { auth, db } from './firebase-config.js';

// ============================================
// AUTENTICACIÓN — proteger la página
// ============================================
auth.onAuthStateChanged(user => {
    if (!user) {
        window.location.href = 'index.html';
    } else {
        document.getElementById('userEmail').textContent = user.email;
    }
});

window.logout = async () => {
    await auth.signOut();
    window.location.href = 'index.html';
};

// ============================================
// NAVEGACIÓN DEL SIDEBAR
// ============================================
const navLinks = document.querySelectorAll('.nav-links li');
const sections = document.querySelectorAll('.section');

navLinks.forEach(link => {
    link.addEventListener('click', () => {
        navLinks.forEach(l => l.classList.remove('active'));
        sections.forEach(s => s.classList.remove('active'));

        link.classList.add('active');
        document.getElementById(link.dataset.section).classList.add('active');

        document.getElementById('sidebar').classList.remove('open');
    });
});

document.getElementById('menuToggle').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
});

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

    // 2) Si no hay una configurada, se busca una tasa en vivo automáticamente
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
    document.querySelector('.nav-links li[data-section="clientes"]').click();
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
            <button type="button" class="btn-icon-action" onclick="editarCliente('${docId}')">✏️ Editar</button>
            <button type="button" class="btn-icon-action danger" onclick="eliminarCliente('${docId}')">🗑️ Eliminar</button>
        </td>
    `;
    return tr;
}

db.collection('clientes').orderBy('nombre').onSnapshot(snapshot => {
    clientesCache = {};
    clientesPorId = {};
    listaClientesDatalist.innerHTML = '';

    snapshot.forEach(doc => {
        const data = doc.data();
        const entry = { id: doc.id, ...data };
        clientesCache[normalizarNombre(data.nombre)] = entry;
        clientesPorId[doc.id] = data;

        const option = document.createElement('option');
        option.value = data.nombre;
        listaClientesDatalist.appendChild(option);
    });

    clientesBody.innerHTML = '';
    if (snapshot.empty) {
        clientesEmpty.style.display = 'block';
        clientesTableWrap.style.display = 'none';
    } else {
        clientesEmpty.style.display = 'none';
        clientesTableWrap.style.display = 'block';
        snapshot.forEach(doc => {
            clientesBody.appendChild(renderClienteRow(doc.id, doc.data()));
        });
    }
}, error => {
    console.error('Error escuchando clientes:', error);
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
            tasaReferencia: tasaReferenciaActual, // tasa configurada/en vivo sugerida al momento del registro, para calcular margen
            montoRecibido,
            monedaRecibido,
            estado: document.getElementById('estado').value,
            formaPago,
            bancoOrigen
        };

        let remesaIdGuardada = remesaDocId;
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

    remesaSubmitBtn.querySelector('.btn-text').textContent = 'Actualizar remesa';
    remesaCancelBtn.classList.remove('hidden');
    remesaMessage.textContent = '';
    remesaMessage.className = 'form-message';

    document.querySelector('.nav-links li[data-section="nueva"]').click();
};

window.eliminarRemesa = async (docId) => {
    if (!confirm('¿Eliminar esta remesa? Esta acción no se puede deshacer.')) return;
    try {
        await db.collection('remesas').doc(docId).delete();
        await eliminarMovimientosCajaDeRemesa(docId);
    } catch (error) {
        console.error('Error al eliminar remesa:', error);
        alert('No se pudo eliminar la remesa. Intenta de nuevo.');
    }
};

// ============================================
// HISTORIAL + DASHBOARD — escucha en tiempo real
// ============================================
const historialBody = document.getElementById('historialBody');
const historialEmpty = document.getElementById('historialEmpty');
const historialTableWrap = document.querySelector('#historial .table-wrap');
const dashboardPanel = document.querySelector('#dashboard .panel');

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
            <button type="button" class="btn-icon-action" onclick="editarRemesa('${id}')">✏️ Editar</button>
            <button type="button" class="btn-icon-action danger" onclick="eliminarRemesa('${id}')">🗑️ Eliminar</button>
        </td>
    `;
    return tr;
}

db.collection('remesas').orderBy('createdAt', 'desc').onSnapshot(snapshot => {
    // --- Historial completo ---
    historialBody.innerHTML = '';
    remesasPorId = {};
    snapshot.forEach(doc => { remesasPorId[doc.id] = doc.data(); });

    if (snapshot.empty) {
        historialEmpty.style.display = 'block';
        historialTableWrap.style.display = 'none';
    } else {
        historialEmpty.style.display = 'none';
        historialTableWrap.style.display = 'block';
        snapshot.forEach(doc => {
            historialBody.appendChild(renderHistorialRow(doc.id, doc.data()));
        });
    }

    // --- Estadísticas del dashboard ---
    const docs = snapshot.docs.map(d => d.data());
    const hoy = new Date();
    const esHoy = (ts) => ts && ts.toDate && ts.toDate().toDateString() === hoy.toDateString();
    const esEsteMes = (ts) => ts && ts.toDate && ts.toDate().getMonth() === hoy.getMonth() && ts.toDate().getFullYear() === hoy.getFullYear();

    const enviadoHoy = docs.filter(r => esHoy(r.createdAt)).reduce((sum, r) => sum + (r.montoEnviado || 0), 0);
    const remesasMes = docs.filter(r => esEsteMes(r.createdAt)).length;
    const pendientes = docs.filter(r => r.estado === 'pendiente').length;
    const clientesActivos = new Set(docs.map(r => r.clienteNombre).filter(Boolean)).size;

    document.querySelector('[data-stat="enviado-hoy"]').textContent = enviadoHoy ? enviadoHoy.toLocaleString('es-CL') : '0';
    document.querySelector('[data-stat="remesas-mes"]').textContent = remesasMes;
    document.querySelector('[data-stat="pendientes"]').textContent = pendientes;
    document.querySelector('[data-stat="clientes-activos"]').textContent = clientesActivos;

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
    try {
        await db.collection('tasasCambio').doc(docId).delete();
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
            <button type="button" class="btn-icon-action" onclick="editarTasa('${docId}')">✏️ Editar</button>
            <button type="button" class="btn-icon-action danger" onclick="eliminarTasa('${docId}')">🗑️ Eliminar</button>
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

reportesPeriodo.addEventListener('change', renderizarReportes);

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

function renderizarReportes() {
    if (!reportesPeriodo) return;

    const periodo = reportesPeriodo.value;
    const ahora = new Date();
    let desde = null;

    if (periodo === '30d') {
        desde = new Date(ahora);
        desde.setDate(desde.getDate() - 29);
        desde.setHours(0, 0, 0, 0);
    } else if (periodo === 'mes') {
        desde = new Date(ahora.getFullYear(), ahora.getMonth(), 1);
    } // 'todo' -> sin límite inferior

    const enPeriodo = Object.entries(remesasPorId)
        .map(([id, r]) => ({ id, ...r }))
        .filter(r => {
            if (r.estado === 'cancelado') return false;
            if (!r.createdAt || !r.createdAt.toDate) return false;
            const fecha = r.createdAt.toDate();
            return !desde || fecha >= desde;
        });

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
        const ganancia = r.montoEnviado - (r.montoRecibido / r.tasaReferencia);
        const moneda = (r.monedaEnviado || '').toUpperCase();
        gananciaPorMoneda[moneda] = (gananciaPorMoneda[moneda] || 0) + ganancia;
    });
    const entradasGanancia = Object.entries(gananciaPorMoneda);
    repStatGanancia.textContent = entradasGanancia.length === 0
        ? '—'
        : entradasGanancia.map(([moneda, total]) => formatMoney(total, moneda)).join(' · ');

    renderizarGraficoDiario(enPeriodo, periodo);
    renderizarVolumenMensual(enPeriodo);
    renderizarGananciaPorRemesa(conReferencia);
}

function renderizarGraficoDiario(remesas, periodo) {
    const ahora = new Date();
    const dias = [];

    if (periodo === 'mes') {
        const inicio = new Date(ahora.getFullYear(), ahora.getMonth(), 1);
        const fin = new Date(ahora.getFullYear(), ahora.getMonth() + 1, 0);
        for (let d = new Date(inicio); d <= fin; d.setDate(d.getDate() + 1)) dias.push(new Date(d));
        repChartSubtitulo.textContent = 'Este mes';
    } else {
        // '30d' y 'todo' (el gráfico siempre se acota a los últimos 30 días para que sea legible)
        for (let i = 29; i >= 0; i--) {
            const d = new Date(ahora);
            d.setDate(d.getDate() - i);
            dias.push(d);
        }
        repChartSubtitulo.textContent = periodo === 'todo' ? 'Últimos 30 días (de todo el historial)' : 'Últimos 30 días';
    }

    const conteoPorDia = {};
    remesas.forEach(r => {
        if (!r.createdAt || !r.createdAt.toDate) return;
        const clave = claveDiaLocal(r.createdAt.toDate());
        conteoPorDia[clave] = (conteoPorDia[clave] || 0) + 1;
    });

    const valores = dias.map(d => conteoPorDia[claveDiaLocal(d)] || 0);
    const totalEnRango = valores.reduce((a, b) => a + b, 0);

    if (totalEnRango === 0) {
        repChartWrap.style.display = 'none';
        repChartEmpty.style.display = 'block';
        return;
    }
    repChartWrap.style.display = 'block';
    repChartEmpty.style.display = 'none';

    const max = Math.max(...valores, 1);
    repChart.innerHTML = '';
    dias.forEach((d, i) => {
        const valor = valores[i];
        const alturaPct = valor > 0 ? Math.max((valor / max) * 100, 4) : 0;
        const mostrarEtiqueta = d.getDate() === 1 || i === 0 || i === dias.length - 1;
        const bar = document.createElement('div');
        bar.className = 'rep-chart-bar';
        bar.title = `${d.toLocaleDateString('es-CL')}: ${valor} remesa(s)`;
        bar.innerHTML = `
            <div class="rep-chart-bar-fill" style="height:${alturaPct}%"></div>
            ${mostrarEtiqueta ? `<span class="rep-chart-bar-label">${d.getDate()}/${d.getMonth() + 1}</span>` : ''}
        `;
        repChart.appendChild(bar);
    });
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
        return;
    }
    repVolumenWrap.style.display = 'block';
    repVolumenEmpty.style.display = 'none';

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
        return;
    }
    repGananciaWrap.style.display = 'block';
    repGananciaEmpty.style.display = 'none';

    filas.forEach(r => {
        const ganancia = r.montoEnviado - (r.montoRecibido / r.tasaReferencia);
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

// ============================================
// CAJA — control de efectivo por moneda
// ============================================
const cajaColeccion = db.collection('movimientosCaja');

// --- Sincronización automática: cada remesa pagada en efectivo genera
// un único movimiento de entrada en movimientosCaja, ligado por remesaId.
// Si la remesa se edita (cambia forma de pago, monto, moneda o se cancela)
// o se elimina, el movimiento se actualiza/borra solo. ---
async function sincronizarCajaDeRemesa(remesaId, data) {
    if (!remesaId) return;

    const existentes = await cajaColeccion.where('remesaId', '==', remesaId).limit(1).get();
    const debeExistir = data.formaPago === 'efectivo' && data.estado !== 'cancelado'
        && data.montoEnviado > 0 && data.monedaEnviado;

    if (!debeExistir) {
        if (!existentes.empty) {
            await Promise.all(existentes.docs.map(doc => doc.ref.delete()));
        }
        return;
    }

    const payload = {
        tipo: 'entrada',
        moneda: data.monedaEnviado,
        monto: data.montoEnviado,
        concepto: `Remesa en efectivo — ${data.clienteNombre}`,
        origen: 'remesa',
        remesaId,
        clienteNombre: data.clienteNombre || null,
        actualizadoEn: firebase.firestore.FieldValue.serverTimestamp()
    };

    if (existentes.empty) {
        payload.createdAt = firebase.firestore.FieldValue.serverTimestamp();
        payload.creadoPorEmail = auth.currentUser ? auth.currentUser.email : null;
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
const cajaTableWrap = document.getElementById('cajaTableWrap');
const cajaSaldosGrid = document.getElementById('cajaSaldosGrid');
const cajaSaldosEmpty = document.getElementById('cajaSaldosEmpty');

function origenBadgeHTML(mov) {
    return mov.origen === 'remesa'
        ? '<span class="badge badge-neutral">Remesa automática</span>'
        : '<span class="badge badge-pending">Manual</span>';
}

function tipoBadgeHTML(tipo) {
    return tipo === 'entrada'
        ? '<span class="badge badge-success">Entrada</span>'
        : '<span class="badge badge-danger">Salida</span>';
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
                : `<button type="button" class="btn-icon-action danger" onclick="eliminarMovimientoCaja('${id}')">🗑️ Eliminar</button>`}
        </td>
    `;
    return tr;
}

function renderCajaSaldos(movimientos) {
    const saldosPorMoneda = {};
    movimientos.forEach(mov => {
        const moneda = mov.moneda || '?';
        const signo = mov.tipo === 'entrada' ? 1 : -1;
        saldosPorMoneda[moneda] = (saldosPorMoneda[moneda] || 0) + signo * (mov.monto || 0);
    });

    const monedas = Object.keys(saldosPorMoneda).sort();
    cajaSaldosGrid.innerHTML = '';

    if (monedas.length === 0) {
        cajaSaldosGrid.style.display = 'none';
        cajaSaldosEmpty.style.display = 'block';
        return;
    }
    cajaSaldosGrid.style.display = 'grid';
    cajaSaldosEmpty.style.display = 'none';

    monedas.forEach(moneda => {
        const saldo = saldosPorMoneda[moneda];
        const card = document.createElement('div');
        card.className = 'stat-card';
        card.innerHTML = `
            <span class="stat-label">Saldo en caja · ${escapeHtml(moneda)}</span>
            <span class="stat-value ${saldo < 0 ? 'stat-value-negative' : ''}">${formatMoney(saldo, moneda)}</span>
        `;
        cajaSaldosGrid.appendChild(card);
    });
}

cajaColeccion.orderBy('createdAt', 'desc').onSnapshot(snapshot => {
    cajaBody.innerHTML = '';
    const movimientos = [];
    snapshot.forEach(doc => movimientos.push(doc.data()));
    renderCajaSaldos(movimientos);

    if (snapshot.empty) {
        cajaEmpty.style.display = 'block';
        cajaTableWrap.style.display = 'none';
        return;
    }
    cajaEmpty.style.display = 'none';
    cajaTableWrap.style.display = 'block';
    snapshot.forEach(doc => {
        cajaBody.appendChild(renderCajaRow(doc.id, doc.data()));
    });
}, error => {
    console.error('Error al escuchar movimientos de caja:', error);
});
