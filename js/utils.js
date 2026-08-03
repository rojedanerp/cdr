// ============================================
// UTILIDADES PURAS — formateo, parsing y cálculo
//
// Todo lo que hay en este archivo es independiente del DOM y de Firebase:
// recibe datos, devuelve datos. Eso permite reutilizarlo desde cualquier
// sección de la app (app.js, calculadora.js) sin duplicar código, y
// probarlo con tests unitarios sin tener que simular el navegador.
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

// Formatea un Firestore Timestamp (objeto con .toDate()) como dd-mm-yyyy.
// Usada para remesas, clientes y tasas — antes existía triplicada
// (formatDate / formatClienteFecha / formatTasaFecha), ahora es una sola.
export const formatDate = (timestamp) => {
    if (!timestamp || !timestamp.toDate) return '—';
    return timestamp.toDate().toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

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

export const badgePagoLabel = (formaPago, banco) => {
    if (formaPago === 'transferencia') return `Transferencia${banco ? ' · ' + escapeHtml(banco) : ''}`;
    if (formaPago === 'caja_vecina') return 'Caja Vecina';
    return 'Efectivo';
};

export function claveTasa(origen, destino) {
    return `${(origen || '').trim().toUpperCase()}_${(destino || '').trim().toUpperCase()}`;
}

export function normalizarNombre(nombre) {
    return (nombre || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function routeTagHTML(origen, destino) {
    const o = escapeHtml(origen);
    const d = escapeHtml(destino);
    return `
        <span class="route-tag" title="${o} → ${d}">
            <i class="dot dot-origin"></i><i class="route-line"></i><i class="dot dot-dest"></i>
        </span>
        <span class="route-text">${o} → ${d}</span>
    `;
}

export function normalizarTexto(str) {
    return (str || '')
        .toString()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // quita tildes
        .trim()
        .toLowerCase();
}

// --- Detecta el delimitador más probable de la tabla pegada ---
export function detectarDelimitador(linea) {
    const candidatos = [
        { d: '\t', c: (linea.match(/\t/g) || []).length },
        { d: ';', c: (linea.match(/;/g) || []).length },
        { d: ',', c: (linea.match(/,/g) || []).length }
    ];
    candidatos.sort((a, b) => b.c - a.c);
    return candidatos[0].c > 0 ? candidatos[0].d : '\t';
}

// --- Parsea una línea respetando comillas si el delimitador es coma ---
export function parsearLinea(linea, delimitador) {
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
export function parsearMontoCLP(valor) {
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
export function parsearFechaSII(valor) {
    if (!valor) return null;
    const texto = String(valor).trim();
    let m = texto.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); // yyyy-mm-dd
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    m = texto.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/); // dd-mm-yyyy o dd/mm/yyyy
    if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
    const fallback = new Date(texto);
    return isNaN(fallback.getTime()) ? null : fallback;
}

export function diferenciaEnDias(a, b) {
    if (!a || !b) return null;
    return Math.abs(Math.round((a.getTime() - b.getTime()) / 86400000));
}

// --- Parsea el texto pegado en boletas: [{ folio, fecha, monto, estado }] ---
export function parsearBoletasPegadas(texto) {
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
export function montoCLPDeRemesa(r) {
    if ((r.monedaEnviado || '').toUpperCase() === 'CLP' && r.montoEnviado) return r.montoEnviado;
    if ((r.monedaRecibido || '').toUpperCase() === 'CLP' && r.montoRecibido) return r.montoRecibido;
    return null;
}

// --- Tasa cruzada entre dos monedas a partir del valor de cada una vs USD, con margen ---
// (lógica de la calculadora de tasas, extraída para poder testearla igual que el resto)
export function calcularTasaCruzada(origenValor, destinoValor, margenPorc) {
    if (!origenValor || !destinoValor || origenValor <= 0) return null;
    const tasaMercado = destinoValor / origenValor;
    const tasaResultado = tasaMercado * (1 - (margenPorc || 0) / 100);
    return { tasaMercado, tasaResultado };
}

// --- Tasas de compra/venta de USDT a partir del valor de mercado y márgenes ---
export function calcularCompraVentaUSDT(valorMercado, margenCompraPorc, margenVentaPorc) {
    if (!valorMercado || valorMercado <= 0) return null;
    const tasaCompra = valorMercado * (1 - (margenCompraPorc || 0) / 100);
    const tasaVenta = valorMercado * (1 + (margenVentaPorc || 0) / 100);
    return { tasaCompra, tasaVenta };
}
