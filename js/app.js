import { auth } from './firebase-config.js';
import { initUI } from './ui.js';
import { initAuditoria } from './auditoria.js';
import { initTasas } from './tasas.js';
import { initClientes } from './clientes.js';
import { initRemesas } from './remesas.js';
import { initConciliacion } from './conciliacion.js';
import { initReportes } from './reportes.js';
import { initCaja } from './caja.js';
import { initBilletera } from './billetera.js';
import { initBoletas } from './boletas.js';

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
// ORQUESTADOR — inicializa cada módulo de dominio una sola vez.
// El orden aquí no es crítico: todos los módulos ya están completamente
// cargados (imports de ES modules) antes de que se ejecute esta línea, y
// las dependencias circulares entre ellos (ej. remesas.js <-> dashboard.js)
// solo se resuelven dentro de callbacks asíncronos (onSnapshot, eventos de
// clic), que corren después de que todos los init() de abajo terminaron.
// ============================================
initUI();
initAuditoria();
initTasas();
initClientes();
initRemesas();
initConciliacion();
initReportes();
initCaja();
initBilletera();
initBoletas();
