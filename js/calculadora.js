// ============================================
// CALCULADORA — script independiente, SIN dependencia de Firebase.
// Se carga aparte para que funcione siempre, incluso si Firebase
// tarda o falla en cargar (red lenta, bloqueador, etc.).
// ============================================

// ============================================
// CALCULADORA DE TASA VÍA USDT
// Flujo real del negocio: compras USDT pagando en la moneda de origen
// (ej. CLP) y vendes ese mismo USDT recibiendo la moneda de destino
// (ej. VES). El cruce de esos dos precios da la tasa "full" del día;
// a esa tasa se le descuenta el margen para obtener la tasa final
// que se le ofrece al cliente.
// ============================================
const calcMonedaOrigenInput = document.getElementById('calcMonedaOrigen');
const calcMonedaDestinoInput = document.getElementById('calcMonedaDestino');
const calcCompraValorInput = document.getElementById('calcCompraValor');
const calcVentaValorInput = document.getElementById('calcVentaValor');
const calcMargenInput = document.getElementById('calcMargen');
const calcMontoOrigenInput = document.getElementById('calcMontoOrigen');

const calcTasaFullLabel = document.getElementById('calcTasaFullLabel');
const calcTasaFullValue = document.getElementById('calcTasaFullValue');
const calcTasaFinalLabel = document.getElementById('calcTasaFinalLabel');
const calcTasaFinalValue = document.getElementById('calcTasaFinalValue');
const calcTasaInversaLabel = document.getElementById('calcTasaInversaLabel');
const calcTasaInversaValue = document.getElementById('calcTasaInversaValue');
const calcMontoDestinoLabel = document.getElementById('calcMontoDestinoLabel');
const calcMontoDestinoValue = document.getElementById('calcMontoDestinoValue');
const calcGuardarBtn = document.getElementById('calcGuardarBtn');

let calcTasaFull = null;   // cruce puro venta/compra, sin margen (origen -> destino)
let calcTasaFinal = null;  // tasa full con el margen ya descontado (la que se ofrece)

function recalcularTasa() {
    const origenCodigo = calcMonedaOrigenInput.value.trim().toUpperCase();
    const destinoCodigo = calcMonedaDestinoInput.value.trim().toUpperCase();
    const compraValor = parseFloat(calcCompraValorInput.value);
    const ventaValor = parseFloat(calcVentaValorInput.value);
    const margen = parseFloat(calcMargenInput.value) || 0;

    const origenTxt = origenCodigo || 'ORIGEN';
    const destinoTxt = destinoCodigo || 'DESTINO';

    if (!compraValor || !ventaValor || compraValor <= 0 || ventaValor <= 0) {
        calcTasaFull = null;
        calcTasaFinal = null;
        calcTasaFullLabel.textContent = 'Tasa full (cruce sin margen)';
        calcTasaFullValue.textContent = '—';
        calcTasaFinalLabel.textContent = 'Tasa final a ofrecer';
        calcTasaFinalValue.textContent = '—';
        calcTasaInversaLabel.textContent = 'Tasa inversa';
        calcTasaInversaValue.textContent = '—';
        calcGuardarBtn.disabled = true;
        actualizarMontoDestino();
        return;
    }

    // Por cada USDT: pagas "compraValor" en origen y recibes "ventaValor" en destino.
    // El cruce (destino/origen) es la tasa full del día para ese par.
    calcTasaFull = ventaValor / compraValor;
    calcTasaFinal = calcTasaFull * (1 - margen / 100);
    const tasaInversa = calcTasaFinal > 0 ? 1 / calcTasaFinal : null;

    calcTasaFullLabel.textContent = `Tasa full — 1 ${origenTxt} = ${calcTasaFull.toFixed(6)} ${destinoTxt} (sin margen)`;
    calcTasaFullValue.textContent = calcTasaFull.toFixed(6);

    calcTasaFinalLabel.textContent = `1 ${origenTxt} = ${calcTasaFinal.toFixed(6)} ${destinoTxt} (margen ${margen}%)`;
    calcTasaFinalValue.textContent = calcTasaFinal.toFixed(6);

    if (tasaInversa !== null) {
        calcTasaInversaLabel.textContent = `1 ${destinoTxt} = ${tasaInversa.toFixed(6)} ${origenTxt}`;
        calcTasaInversaValue.textContent = tasaInversa.toFixed(6);
    } else {
        calcTasaInversaLabel.textContent = 'Tasa inversa';
        calcTasaInversaValue.textContent = '—';
    }

    calcGuardarBtn.disabled = !(origenCodigo && destinoCodigo);
    actualizarMontoDestino();
}

function actualizarMontoDestino() {
    const origenTxt = calcMonedaOrigenInput.value.trim().toUpperCase() || 'ORIGEN';
    const destinoTxt = calcMonedaDestinoInput.value.trim().toUpperCase() || 'DESTINO';
    const monto = parseFloat(calcMontoOrigenInput.value);

    if (calcTasaFinal === null || !monto || monto <= 0) {
        calcMontoDestinoLabel.textContent = 'El cliente recibe';
        calcMontoDestinoValue.textContent = '—';
        return;
    }

    const montoDestino = monto * calcTasaFinal;
    calcMontoDestinoLabel.textContent = `Enviando ${monto.toLocaleString('es-CL')} ${origenTxt}, el cliente recibe`;
    calcMontoDestinoValue.textContent = `${montoDestino.toLocaleString('es-CL', { maximumFractionDigits: 2 })} ${destinoTxt}`;
}

[calcMonedaOrigenInput, calcMonedaDestinoInput, calcCompraValorInput, calcVentaValorInput, calcMargenInput].forEach(el => {
    el.addEventListener('input', recalcularTasa);
});
calcMontoOrigenInput.addEventListener('input', actualizarMontoDestino);

calcGuardarBtn.addEventListener('click', () => {
    if (calcTasaFull === null) return;

    const tasaMonedaOrigenInput = document.getElementById('tasaMonedaOrigen');
    const tasaMonedaDestinoInput = document.getElementById('tasaMonedaDestino');
    const tasaBaseInput = document.getElementById('tasaBase');
    const tasaMargenCompraInput = document.getElementById('tasaMargenCompra');
    const tasaMargenVentaInput = document.getElementById('tasaMargenVenta');
    const margen = calcMargenInput.value;

    tasaMonedaOrigenInput.value = calcMonedaOrigenInput.value.trim().toUpperCase();
    tasaMonedaDestinoInput.value = calcMonedaDestinoInput.value.trim().toUpperCase();
    tasaBaseInput.value = Number(calcTasaFull.toFixed(6));
    tasaMargenCompraInput.value = margen;
    tasaMargenVentaInput.value = margen;

    // Disparar 'input' para que app.js (módulo aparte) recalcule su vista previa.
    [tasaMonedaOrigenInput, tasaMonedaDestinoInput, tasaBaseInput, tasaMargenCompraInput, tasaMargenVentaInput].forEach(el => {
        el.dispatchEvent(new Event('input', { bubbles: true }));
    });

    document.getElementById('tasaForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
    tasaMonedaOrigenInput.focus();
});

// Calcular de inmediato con los valores ya presentes al cargar la página
// (por si el navegador restauró valores de un formulario sin disparar 'input').
recalcularTasa();
