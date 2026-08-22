import { escapeHtml, formatMoney, formatDate, badgeClass, badgeLabel } from './shared.js';
import { remesasPorId } from './remesas.js';

// ============================================
// CONCILIACIÓN SII — comparar boletas exentas emitidas
// (pegadas desde la web/CSV del SII) contra las remesas
// registradas en la app. Lee remesasPorId directamente de remesas.js.
// ============================================
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



// ============================================

// Inicializa los botones de Conciliación (comparar, limpiar, subir archivo).
// Se llama una sola vez desde app.js al arrancar.
export function initConciliacion() {
    conciliacionLimpiarBtn.addEventListener('click', limpiarResultadosConciliacion);

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

}
