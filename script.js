function contenidoTicketPayPos(datos, permitirAnular = false) {
  const escapar = (valor) =>
    String(valor ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

  const anulada = String(datos.estado || "").toLowerCase() === "anulada";

  const fecha = new Date(datos.creada_en ?? datos.fecha);

  const fechaTexto = Number.isNaN(fecha.getTime())
    ? "FECHA NO DISPONIBLE"
    : new Intl.DateTimeFormat("es-BO", {
        timeZone: "America/La_Paz",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      })
        .format(fecha)
        .replace(",", "");

  const etiquetas = {
    efectivo: "EFECTIVO",
    qr: "QR",
    tarjeta: "TARJETA",
  };

  const abreviaturas = {
    efectivo: "EFEC",
    qr: "QR",
    tarjeta: "TARJ",
  };

  const importes = new Map();

  for (const pago of Array.isArray(datos.pagos) ? datos.pagos : []) {
    const metodo = String(pago.metodo || "")
      .trim()
      .toLowerCase();

    const monto = Number(pago.monto_bs);

    if (
      !Object.hasOwn(etiquetas, metodo) ||
      !Number.isFinite(monto) ||
      monto <= 0
    ) {
      continue;
    }

    importes.set(metodo, (importes.get(metodo) || 0) + monto);
  }

  const metodos = ["efectivo", "qr", "tarjeta"].filter((metodo) =>
    importes.has(metodo),
  );

  const formatoMonto = new Intl.NumberFormat("es-BO", {
    maximumFractionDigits: 2,
  });

  const pagoTexto =
    metodos.length > 1
      ? metodos
          .map(
            (metodo) =>
              `${abreviaturas[metodo]}-${formatoMonto.format(
                importes.get(metodo),
              )}`,
          )
          .join(" ")
      : etiquetas[metodos[0]] || "SIN DATOS";

  const numeroCaja = Number(datos.caja_numero);
  const codigoCaja =
    Number.isSafeInteger(numeroCaja) && numeroCaja > 0
      ? `C${numeroCaja}`
      : datos.caja_nombre || datos.caja || "CAJA";

  const productos = Array.isArray(datos.productos) ? datos.productos : [];

  const filas = productos
    .map(
      (producto) => `
    <tr>
      <td>${escapar(producto.cantidad)}</td>
      <td>${escapar(producto.nombre)}</td>
    </tr>
  `,
    )
    .join("");

  const marca = anulada
    ? `<span class="comanda-ticket-marca">ANULADA</span>`
    : permitirAnular
      ? `
        <button
          class="comanda-ticket-anular"
          type="button"
          data-anular-comanda
          aria-label="Anular orden ${escapar(datos.numero)}"
        >
          ANULAR
          <span class="comanda-ticket-circulo"
                aria-hidden="true"></span>
        </button>
      `
      : `
        <span class="comanda-ticket-marca">
          ANULAR
          <span class="comanda-ticket-circulo"
                aria-hidden="true"></span>
        </span>
      `;

  return `
   <div class="comanda-ticket-logo">
     <img src="pa.png" alt="PACHA">
   </div>

   <div class="comanda-ticket-codigo">
     ${escapar(codigoCaja)}
   </div>
    ${anulada ? '<div class="comanda-ticket-sello">ANULADA</div>' : ""}

    <div class="comanda-ticket-fecha">
      ${escapar(fechaTexto)}
    </div>

    <div class="comanda-ticket-datos">
      <div class="comanda-ticket-info">
        <div class="comanda-ticket-orden">
          ORDEN #${escapar(datos.numero ?? datos.numeroVenta)}
        </div>

        <div class="comanda-ticket-pago">
          PAGO: ${escapar(pagoTexto)}
        </div>
      </div>

      ${marca}
    </div>

    <table class="comanda-ticket-tabla">
      <thead>
        <tr>
          <th>CANT</th>
          <th>PRODUCTO</th>
        </tr>
      </thead>
      <tbody>${filas}</tbody>
    </table>

    <div class="comanda-ticket-entrega">
      PRODUCTO A ENTREGAR
    </div>

    ${
      datos.nota
        ? `
      <div class="comanda-ticket-nota"><strong>NOTA</strong>${escapar(datos.nota)}</div>
    `
        : ""
    }

    ${
      anulada && datos.motivo_anulacion
        ? `
      <div class="comanda-ticket-motivo-anulada">
        <strong>MOTIVO DE ANULACIÓN</strong>
        <div>${escapar(datos.motivo_anulacion)}</div>
      </div>
    `
        : ""
    }
  `;
}
// ===== CONEXIÓN DE PAYPOS CON SUPABASE =====
const SUPABASE_URL = "https://czpzkkakhdcwhbclhugk.supabase.co";

const SUPABASE_PUBLIC_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN6cHpra2FraGRjd2hiY2xodWdrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM2MTA0MzIsImV4cCI6MjA4OTE4NjQzMn0.dfUGsaZxg16X_S0uuGmCSvVTSGXVnwRGpBDqda5Z1P8";
let db = null;

const payposFotos = window.payposFotosCache || {
  entradas: new Map(),
  solicitudes: new Map(),
  prefijoSesion: "paypos-foto-v2:",
};

window.payposFotosCache = payposFotos;

const DURACION_URL_FIRMADA = 55 * 60 * 1000;
const MARGEN_EXPIRACION_FOTO = 60 * 1000;

function entradaFotoValida(entrada) {
  return Boolean(
    entrada?.url &&
      Number.isFinite(entrada.expiresAt) &&
      entrada.expiresAt > Date.now() + MARGEN_EXPIRACION_FOTO,
  );
}

function claveFoto(ruta) {
  return payposFotos.prefijoSesion + encodeURIComponent(ruta);
}

function guardarFotoEnSesion(ruta, entrada) {
  try {
    sessionStorage.setItem(claveFoto(ruta), JSON.stringify(entrada));
  } catch {
    // La caché en memoria sigue funcionando si el navegador la bloquea.
  }
}

function leerFotoDeSesion(ruta) {
  try {
    const guardada = JSON.parse(
      sessionStorage.getItem(claveFoto(ruta)) || "null",
    );

    if (!entradaFotoValida(guardada)) {
      sessionStorage.removeItem(claveFoto(ruta));
      return null;
    }

    return guardada;
  } catch {
    return null;
  }
}

function obtenerUrlFotoCacheada(ruta) {
  if (!ruta) return null;

  const actual = payposFotos.entradas.get(ruta);
  if (entradaFotoValida(actual)) return actual.url;

  const guardada = leerFotoDeSesion(ruta);
  if (guardada) {
    payposFotos.entradas.set(ruta, guardada);
    return guardada.url;
  }

  payposFotos.entradas.delete(ruta);
  return null;
}

async function obtenerUrlFoto(ruta) {
  const cacheada = obtenerUrlFotoCacheada(ruta);
  if (cacheada) return cacheada;

  const solicitudExistente = payposFotos.solicitudes.get(ruta);
  if (solicitudExistente) return solicitudExistente;

  if (!db?.storage) {
    throw new Error("El almacenamiento de fotos no está disponible.");
  }

  const solicitud = db.storage
    .from("paypos-productos")
    .createSignedUrl(ruta, 3600)
    .then(({ data, error }) => {
      if (error || !data?.signedUrl) {
        throw error || new Error("No se pudo obtener la foto.");
      }

      const entrada = {
        url: data.signedUrl,
        expiresAt: Date.now() + DURACION_URL_FIRMADA,
      };

      payposFotos.entradas.set(ruta, entrada);
      guardarFotoEnSesion(ruta, entrada);
      return entrada.url;
    })
    .finally(() => {
      payposFotos.solicitudes.delete(ruta);
    });

  payposFotos.solicitudes.set(ruta, solicitud);
  return solicitud;
}

function invalidarFoto(ruta) {
  if (!ruta) return;

  payposFotos.entradas.delete(ruta);
  payposFotos.solicitudes.delete(ruta);

  try {
    sessionStorage.removeItem(claveFoto(ruta));
  } catch {
    // No afecta la caché en memoria.
  }
}

function limpiarCacheFotos() {
  payposFotos.entradas.clear();
  payposFotos.solicitudes.clear();

  try {
    const claves = [];
    for (let indice = 0; indice < sessionStorage.length; indice++) {
      const clave = sessionStorage.key(indice);
      if (clave?.startsWith(payposFotos.prefijoSesion)) {
        claves.push(clave);
      }
    }
    claves.forEach((clave) => sessionStorage.removeItem(clave));
  } catch {
    // La sesión puede continuar sin almacenamiento persistente.
  }
}

window.payposInvalidarFoto = invalidarFoto;

function crearImagenFoto(url, alt, prioridad = "auto") {
  const imagen = document.createElement("img");
  imagen.alt = alt;
  imagen.width = 400;
  imagen.height = 400;
  imagen.decoding = "async";
  imagen.fetchPriority = prioridad;
  imagen.loading = prioridad === "high" ? "eager" : "lazy";
  if (url) imagen.src = url;
  return imagen;
}

function iniciarSupabase() {
  if (db) return db;

  if (!SUPABASE_URL.trim() || !SUPABASE_PUBLIC_KEY.trim()) {
    console.info("PayPos: falta configurar la URL y la clave pública.");
    return null;
  }

  if (!window.supabase?.createClient) {
    console.error("PayPos: no se pudo cargar la librería de Supabase.");
    return null;
  }

  try {
    db = window.supabase.createClient(
      SUPABASE_URL.trim(),
      SUPABASE_PUBLIC_KEY.trim(),
    );

    console.info("PayPos: cliente de Supabase preparado.");
    return db;
  } catch {
    console.error("PayPos: revisa la configuración de Supabase.");
    return null;
  }
}

iniciarSupabase();
// ===== RECUPERAR CONTRASEÑA =====
(() => {
  const modal = document.getElementById("modal-recuperar-acceso");
  const formulario = document.getElementById("form-recuperar-acceso");
  const cuenta = document.getElementById("recuperar-cuenta");
  const clave = document.getElementById("recuperar-clave");
  const confirmacion = document.getElementById("recuperar-confirmacion");
  const estado = document.getElementById("recuperar-estado");
  const guardar = document.getElementById("guardar-nueva-clave");
  const cancelar = document.getElementById("cancelar-recuperacion");

  if (
    !db ||
    !modal ||
    !formulario ||
    !cuenta ||
    !clave ||
    !confirmacion ||
    !estado ||
    !guardar ||
    !cancelar
  ) {
    console.error("PayPos: falta configurar la recuperación.");
    return;
  }

  let usuarioRecuperacion = null;
  let verificado = false;
  let guardando = false;
  let completado = false;
  let revision = 0;

  function actualizarControles() {
    const bloqueado = !verificado || guardando || completado;

    clave.disabled = bloqueado;
    confirmacion.disabled = bloqueado;
    guardar.disabled = bloqueado;
    cancelar.disabled = guardando;

    guardar.textContent = guardando ? "Guardando…" : "Guardar contraseña";

    cancelar.textContent = completado ? "Cerrar" : "Cancelar";
  }

  function invalidarRecuperacion() {
    ++revision;
    usuarioRecuperacion = null;
    verificado = false;
    clave.value = "";
    confirmacion.value = "";
    actualizarControles();

    if (modal.open && !completado) {
      cuenta.textContent = "Sesión no disponible";
      estado.textContent =
        "La sesión cambió o se cerró. Abre un enlace de recuperación nuevo.";
    }
  }

  async function verificarCuenta(id, version) {
    try {
      const { data, error } = await db.auth.getUser();

      if (version !== revision || !modal.open) return;

      if (error || !data?.user || data.user.id !== id) {
        throw new Error("No se pudo verificar el enlace. Solicita uno nuevo.");
      }

      cuenta.textContent = "Cuenta: " + data.user.email;
      verificado = true;
      estado.textContent = "";
      actualizarControles();
      clave.focus();
    } catch (error) {
      if (version !== revision) return;

      verificado = false;
      estado.textContent = error.message || "No se pudo verificar la cuenta.";

      actualizarControles();
    }
  }

  db.auth.onAuthStateChange((evento, sesion) => {
    if (evento === "PASSWORD_RECOVERY" && sesion?.user) {
      const version = ++revision;

      usuarioRecuperacion = sesion.user.id;
      verificado = false;
      completado = false;

      formulario.reset();
      cuenta.textContent = "Verificando la cuenta…";
      estado.textContent = "";
      actualizarControles();

      if (!modal.open) modal.showModal();

      // Las consultas se hacen fuera del callback de Supabase.
      setTimeout(() => {
        void verificarCuenta(sesion.user.id, version);
      }, 0);

      return;
    }

    if (
      usuarioRecuperacion &&
      (evento === "SIGNED_OUT" ||
        (sesion?.user && sesion.user.id !== usuarioRecuperacion))
    ) {
      invalidarRecuperacion();
    }
  });

  formulario.addEventListener("submit", async (evento) => {
    evento.preventDefault();

    if (
      guardando ||
      completado ||
      !verificado ||
      !usuarioRecuperacion ||
      !formulario.reportValidity()
    ) {
      return;
    }

    if (clave.value !== confirmacion.value) {
      estado.textContent = "Las contraseñas no coinciden.";
      confirmacion.focus();
      return;
    }

    const usuarioEsperado = usuarioRecuperacion;
    const version = revision;

    guardando = true;
    estado.textContent = "Guardando contraseña…";
    actualizarControles();

    try {
      const verificacion = await db.auth.getUser();

      if (
        version !== revision ||
        verificacion.error ||
        verificacion.data?.user?.id !== usuarioEsperado
      ) {
        throw new Error("La sesión ya no corresponde a esta cuenta.");
      }

      const { data, error } = await db.auth.updateUser({
        password: clave.value,
      });

      if (version !== revision) return;
      if (error) throw error;

      if (data?.user?.id !== usuarioEsperado) {
        throw new Error("No se pudo confirmar el cambio.");
      }

      completado = true;
      formulario.reset();

      estado.textContent =
        "Contraseña guardada correctamente. " +
        "Cierra esta ventana y vuelve a iniciar sesión con tu contraseña nueva.";
    } catch (error) {
      if (version !== revision) return;

      estado.textContent =
        error.message || "No se pudo confirmar el cambio. Revisa tu conexión.";
    } finally {
      guardando = false;
      actualizarControles();
    }
  });

  cancelar.addEventListener("click", () => {
    if (!guardando) modal.close();
  });

  modal.addEventListener("cancel", (evento) => {
    if (guardando) evento.preventDefault();
  });

  modal.addEventListener("close", () => {
    ++revision;
    usuarioRecuperacion = null;
    verificado = false;
    formulario.reset();
    actualizarControles();
  });

  // Informa si Supabase devuelve un enlace vencido o inválido.
  const parametros = new URLSearchParams(window.location.hash.slice(1));

  if (parametros.has("error") || parametros.has("error_code")) {
    cuenta.textContent = "No se pudo abrir la recuperación";
    estado.textContent =
      "El enlace puede haber vencido o haberse utilizado. Solicita uno nuevo.";

    actualizarControles();
    if (!modal.open) modal.showModal();
  }
})();
("use strict");
/* =========================================================
   PAYPOS · BLOQUEAR ZOOM TÁCTIL
========================================================= */

(function bloquearZoomTactil() {
  const bloquear = (evento) => {
    evento.preventDefault();
  };

  /*
    Safari iPhone / iPad
  */
  document.addEventListener("gesturestart", bloquear, { passive: false });

  document.addEventListener("gesturechange", bloquear, { passive: false });

  document.addEventListener("gestureend", bloquear, { passive: false });

  /*
    Bloquea específicamente el gesto
    de dos dedos.
  */
  document.addEventListener(
    "touchmove",
    (evento) => {
      if (evento.touches.length > 1) {
        evento.preventDefault();
      }
    },
    { passive: false },
  );
})();
const barra = document.getElementById("barra");
const superficie = document.getElementById("superficie");
const forma = document.getElementById("forma");
const detalle = document.getElementById("detalle");
const etiqueta = document.getElementById("etiqueta");
const botones = [...document.querySelectorAll(".icono")];

const reducirMovimiento = window.matchMedia("(prefers-reduced-motion: reduce)");

const ALTURA_BARRA = 46;
const PROFUNDIDAD = 36;

let ancho = document.documentElement.clientWidth;
let centro = ancho / 2;
let destinoCentro = centro;

let profundidad = 0;
let destinoProfundidad = 0;

let velocidadCentro = 0;
let velocidadProfundidad = 0;

let botonActual = null;
let animacion = null;
let animacionTexto = null;
let ultimoTiempo = 0;

let punteroDentro = false;
let entradaPuntero = false;

function limitar(valor, minimo, maximo) {
  return Math.min(maximo, Math.max(minimo, valor));
}

/*
Dibuja el borde con curvas Bézier:
plano → hombro suave → parte baja → hombro → plano.
*/
function dibujar() {
  const y = ALTURA_BARRA;
  const p = profundidad;
  const c = centro;

  forma.setAttribute(
    "d",
    `
M 0 0
H ${ancho}
V ${y}
H ${c + 112}

  C ${c + 84} ${y},
    ${c + 84} ${y + p},
    ${c + 53} ${y + p}

  H ${c - 53}

  C ${c - 84} ${y + p},
    ${c - 84} ${y},
    ${c - 112} ${y}

  H 0
  Z
`,
  );

  detalle.style.transform = `
    translate3d(
      ${c - 80}px,
      ${(p - PROFUNDIDAD) * 0.35}px,
      0
    )
  `;
}

/* Movimiento con resorte y frenado suave. */
function animar(tiempo) {
  const paso = ultimoTiempo ? Math.min((tiempo - ultimoTiempo) / 16.667, 2) : 1;

  ultimoTiempo = tiempo;

  velocidadCentro += (destinoCentro - centro) * 0.085 * paso;

  velocidadCentro *= Math.pow(0.65, paso);
  centro += velocidadCentro * paso;

  velocidadProfundidad += (destinoProfundidad - profundidad) * 0.1 * paso;

  velocidadProfundidad *= Math.pow(0.66, paso);
  profundidad += velocidadProfundidad * paso;

  dibujar();

  const sigueMoviendose =
    Math.abs(destinoCentro - centro) > 0.05 ||
    Math.abs(destinoProfundidad - profundidad) > 0.05 ||
    Math.abs(velocidadCentro) > 0.05 ||
    Math.abs(velocidadProfundidad) > 0.05;

  if (sigueMoviendose) {
    animacion = requestAnimationFrame(animar);
  } else {
    centro = destinoCentro;
    profundidad = destinoProfundidad;

    velocidadCentro = 0;
    velocidadProfundidad = 0;

    animacion = null;
    ultimoTiempo = 0;

    dibujar();
  }
}

function iniciarAnimacion() {
  if (reducirMovimiento.matches) {
    if (animacion !== null) {
      cancelAnimationFrame(animacion);
    }

    animacion = null;
    ultimoTiempo = 0;

    centro = destinoCentro;
    profundidad = destinoProfundidad;
    velocidadCentro = 0;
    velocidadProfundidad = 0;

    dibujar();
    return;
  }

  if (animacion === null) {
    animacion = requestAnimationFrame(animar);
  }
}

function obtenerCentro(boton) {
  const rectangulo = boton.getBoundingClientRect();

  const margen = Math.min(114, ancho / 2);

  return limitar(
    rectangulo.left + rectangulo.width / 2,
    margen,
    ancho - margen,
  );
}

function abrir(boton) {
  const cambio = botonActual !== boton;

  botonActual = boton;
  destinoCentro = obtenerCentro(boton);
  destinoProfundidad = PROFUNDIDAD;

  barra.classList.add("abierta");

  botones.forEach((item) => {
    item.classList.toggle("explorando", item === boton);
  });

  if (cambio) {
    etiqueta.textContent = boton.dataset.nombre;

    if (animacionTexto) {
      animacionTexto.cancel();
    }

    if (!reducirMovimiento.matches) {
      animacionTexto = etiqueta.animate(
        [
          {
            opacity: 0,
            transform: "translateY(5px)",
            filter: "blur(3px)",
          },
          {
            opacity: 1,
            transform: "translateY(0)",
            filter: "blur(0)",
          },
        ],
        {
          duration: 240,
          easing: "cubic-bezier(.2,.7,.2,1)",
        },
      );
    }
  }

  iniciarAnimacion();
}

function cerrar() {
  destinoProfundidad = 0;
  botonActual = null;

  barra.classList.remove("abierta");

  botones.forEach((boton) => {
    boton.classList.remove("explorando");
  });

  iniciarAnimacion();
}

botones.forEach((boton) => {
  boton.addEventListener("pointerenter", (evento) => {
    if (evento.pointerType !== "touch") {
      abrir(boton);
    }
  });

  boton.addEventListener("focus", () => {
    abrir(boton);
  });

  boton.addEventListener("click", () => {
    botones.forEach((item) => {
      item.setAttribute("aria-pressed", String(item === boton));
    });

    abrir(boton);
  });
});

barra.addEventListener("pointerenter", (evento) => {
  if (evento.pointerType !== "touch") {
    punteroDentro = true;
  }
});

barra.addEventListener("pointerleave", () => {
  punteroDentro = false;

  const focoTeclado = botones.find((boton) => document.activeElement === boton);

  if (!entradaPuntero && focoTeclado) {
    abrir(focoTeclado);
  } else {
    cerrar();
  }
});

barra.addEventListener("focusout", (evento) => {
  if (!barra.contains(evento.relatedTarget) && !punteroDentro) {
    cerrar();
  }
});

document.addEventListener("pointerdown", (evento) => {
  entradaPuntero = true;

  if (!barra.contains(evento.target)) {
    cerrar();
  }
});

document.addEventListener("keydown", (evento) => {
  entradaPuntero = false;

  if (evento.key === "Escape") {
    cerrar();
  }
});

function ajustarPantalla() {
  ancho = document.documentElement.clientWidth;

  superficie.setAttribute("viewBox", `0 0 ${ancho} 105`);

  destinoCentro = botonActual ? obtenerCentro(botonActual) : ancho / 2;

  centro = destinoCentro;
  velocidadCentro = 0;

  dibujar();
}

window.addEventListener("resize", ajustarPantalla);

ajustarPantalla();
// ===== TRANSICIÓN ENTRE INICIO Y PRODUCTOS =====
(() => {
  const contenedor = document.getElementById("area-paginas");

  const paginas = {
    Inicio: document.getElementById("pagina-inicio"),
    Ventas: document.getElementById("pagina-ventas"),
    Productos: document.getElementById("pagina-productos"),
    Cajas: document.getElementById("pagina-cajas"),
  };

  if (
    !contenedor ||
    !paginas.Inicio ||
    !paginas.Ventas ||
    !paginas.Productos ||
    !paginas.Cajas
  ) {
    console.error("PayPos: faltan las secciones del HTML.");
    return;
  }

  const orden = ["Inicio", "Ventas", "Productos", "Cajas"];
  const movimientoReducido = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  );

  let actual = "Inicio";
  let solicitada = actual;
  let cambiando = false;

  // Estado inicial.
  Object.entries(paginas).forEach(([nombre, pagina]) => {
    const visible = nombre === actual;

    pagina.hidden = !visible;
    pagina.inert = !visible;
    pagina.classList.toggle("pagina-activa", visible);
  });

  async function cambiarPagina(nombre) {
    if (!paginas[nombre]) return;

    // Si se pulsa varias veces, conserva el último destino.
    solicitada = nombre;

    if (cambiando || solicitada === actual) return;

    cambiando = true;

    try {
      while (solicitada !== actual) {
        const destino = solicitada;

        const saliente = paginas[actual];
        const entrante = paginas[destino];

        const direccion =
          orden.indexOf(destino) > orden.indexOf(actual) ? 1 : -1;

        const duracion = movimientoReducido.matches ? 0 : 300;
        const animaciones = [];

        // Evita dejar el foco en una sección que se ocultará.
        if (saliente.contains(document.activeElement)) {
          document
            .querySelector(`.icono[data-nombre="${destino}"]`)
            ?.focus({ preventScroll: true });
        }

        saliente.inert = true;

        entrante.hidden = false;
        entrante.inert = true;

        // Ambas páginas comparten el espacio durante el cambio.
        saliente.style.position = "absolute";
        saliente.style.top = "0";
        saliente.style.left = "0";
        saliente.style.width = "100%";

        // Evita que la altura cambie bruscamente durante el movimiento.
        const altura = Math.max(
          saliente.offsetHeight,
          entrante.offsetHeight,
          window.innerHeight,
        );

        contenedor.style.minHeight = `${altura}px`;

        try {
          if (duracion > 0) {
            const opciones = {
              duration: duracion,
              easing: "cubic-bezier(0.22, 0.75, 0.25, 1)",
              fill: "both",
            };

            animaciones.push(
              saliente.animate(
                [
                  {
                    transform: "translateX(0)",
                    opacity: 1,
                  },
                  {
                    transform: `translateX(${-100 * direccion}%)`,
                    opacity: 0.25,
                  },
                ],
                opciones,
              ),

              entrante.animate(
                [
                  {
                    transform: `translateX(${100 * direccion}%)`,
                    opacity: 0.25,
                  },
                  {
                    transform: "translateX(0)",
                    opacity: 1,
                  },
                ],
                opciones,
              ),
            );

            await Promise.all(
              animaciones.map((animacion) => animacion.finished),
            );
          }
        } finally {
          // Deja un estado estable incluso si se interrumpe la animación.
          saliente.hidden = true;
          saliente.classList.remove("pagina-activa");

          saliente.style.removeProperty("position");
          saliente.style.removeProperty("top");
          saliente.style.removeProperty("left");
          saliente.style.removeProperty("width");

          entrante.hidden = false;
          entrante.inert = false;
          entrante.classList.add("pagina-activa");

          animaciones.forEach((animacion) => animacion.cancel());

          contenedor.style.removeProperty("min-height");

          actual = destino;
        }
      }
    } catch (error) {
      console.error("PayPos: se interrumpió la transición.", error);
    } finally {
      cambiando = false;
    }
  }

  document.querySelectorAll(".icono").forEach((boton) => {
    const nombre = boton.dataset.nombre;

    if (!paginas[nombre]) return;

    boton.addEventListener("click", () => {
      cambiarPagina(nombre);
    });
  });
})();
// ===== CONSULTAR PERMISOS Y CAJA DEL USUARIO =====
async function consultarAccesoPayPos() {
  if (!db) {
    throw new Error("No hay conexión con Supabase.");
  }

  const { data, error } = await db.auth.getUser();

  if (error || !data?.user) {
    throw new Error("No se pudo verificar tu sesión. Ingresa nuevamente.");
  }

  const usuario = data.user;

  const [administrador, cajero] = await Promise.all([
    db
      .from("pos_administradores")
      .select("usuario_id")
      .eq("usuario_id", usuario.id)
      .maybeSingle(),

    db
      .from("pos_cajeros")
      .select("caja_id, activo")
      .eq("usuario_id", usuario.id)
      .maybeSingle(),
  ]);

  if (administrador.error || cajero.error) {
    throw new Error(
      "No se pudieron comprobar tus permisos. Intenta nuevamente.",
    );
  }

  const esAdministrador = Boolean(administrador.data);
  let caja = null;

  if (cajero.data?.activo === true) {
    const respuesta = await db
      .from("pos_cajas")
      .select("id, numero, nombre, activa")
      .eq("id", cajero.data.caja_id)
      .maybeSingle();

    if (respuesta.error) {
      throw new Error("No se pudo comprobar la caja asignada.");
    }

    if (respuesta.data?.activa === true) {
      caja = Object.freeze({
        id: respuesta.data.id,
        numero: respuesta.data.numero,
        nombre: respuesta.data.nombre,
      });
    }
  }

  if (!esAdministrador && !caja) {
    throw new Error(
      "Tu cuenta no tiene acceso habilitado. Consulta al administrador.",
    );
  }

  return Object.freeze({
    usuarioId: usuario.id,
    email: usuario.email || "",
    esAdministrador,
    caja,
  });
}
// ===== ACCESO DE ADMINISTRADORES Y CAJEROS =====
window.payposAcceso = null;

(() => {
  const acceso = document.getElementById("acceso-administrador");
  const formulario = document.getElementById("form-acceso");
  const correo = document.getElementById("admin-correo");
  const clave = document.getElementById("admin-clave");
  const verClave = document.getElementById("mostrar-admin-clave");
  const ingresar = document.getElementById("ingresar-productos");
  const estado = document.getElementById("estado-acceso");
  const gestion = document.getElementById("gestion-autorizada");
  const salir = document.getElementById("salir-productos");
  const nuevoProducto = document.getElementById("nuevo-producto");

  let ocupado = false;
  let revision = 0;

  function actualizarVisibilidadClave(visible) {
    clave.type = visible ? "text" : "password";
    verClave.setAttribute("aria-pressed", String(visible));
    verClave.setAttribute(
      "aria-label",
      visible ? "Ocultar contraseña" : "Mostrar contraseña",
    );
  }

  verClave.addEventListener("click", () => {
    actualizarVisibilidadClave(clave.type === "password");
  });

  document.getElementById("titulo-acceso").textContent = "Acceso a PayPos";

  const descripcion = acceso.querySelector(".acceso-introduccion p");

  if (descripcion) {
    descripcion.textContent =
      "Ingresa con tu cuenta de administrador o cajero.";
  }

  function mensaje(texto, error = false) {
    estado.textContent = texto;
    estado.dataset.error = String(error);
  }

  function bloquear(valor) {
    ocupado = valor;

    ingresar.disabled = valor;
    salir.disabled = valor;
    correo.disabled = valor;
    clave.disabled = valor;
    verClave.disabled = valor;

    ingresar.textContent = valor ? "Verificando…" : "Ingresar";
  }

  function aplicarAcceso(permisos) {
    window.payposAcceso = permisos;

    const autorizado = Boolean(permisos);
    const administrador = permisos?.esAdministrador === true;

    // Los cajeros mantienen visible el área de acceso
    // para consultar su caja y cerrar sesión.
    acceso.hidden = administrador;
    formulario.hidden = autorizado;
    gestion.hidden = !administrador;
    salir.hidden = !autorizado;

    nuevoProducto.hidden = !administrador;
    nuevoProducto.disabled = !administrador;

    if (permisos && !administrador) {
      mensaje(
        `${permisos.caja.nombre} · Sesión iniciada. ` +
          "Puedes ir a Inicio para preparar tus pedidos.",
      );
    }

    document.dispatchEvent(
      new CustomEvent("paypos:acceso-cambiado", {
        detail: permisos,
      }),
    );
  }

  async function comprobarAcceso(version) {
    const permisos = await consultarAccesoPayPos();

    // Ignora respuestas de una sesión que ya se cerró.
    if (version !== revision) return;

    mensaje("");
    aplicarAcceso(permisos);
  }

  formulario.addEventListener("submit", async (evento) => {
    evento.preventDefault();

    if (ocupado || !formulario.reportValidity()) return;

    const email = correo.value.trim();
    const password = clave.value;
    const version = ++revision;

    bloquear(true);
    gestion.dataset.verificandoSesion = "true";
    aplicarAcceso(null);
    mensaje("Comprobando tu cuenta…");

    try {
      if (!db) {
        throw new Error("No hay conexión con Supabase.");
      }

      const { error } = await db.auth.signInWithPassword({
        email,
        password,
      });

      if (version !== revision) return;

      if (error) {
        throw new Error("No se pudo ingresar. Revisa tus datos y la conexión.");
      }

      await comprobarAcceso(version);
    } catch (error) {
      if (version !== revision) return;

      aplicarAcceso(null);
      mensaje(error.message || "No se pudo ingresar.", true);
    } finally {
      clave.value = "";
      actualizarVisibilidadClave(false);
      bloquear(false);
      delete gestion.dataset.verificandoSesion;
    }
  });

  salir.addEventListener("click", async () => {
    if (ocupado) return;

    ++revision;
    bloquear(true);
    aplicarAcceso(null);
    mensaje("Cerrando sesión…");

    try {
      if (!db) {
        throw new Error("No hay conexión con Supabase.");
      }

      const { error } = await db.auth.signOut({
        scope: "local",
      });

      if (error) throw error;

      formulario.reset();
      mensaje("Sesión cerrada.");
    } catch {
      salir.hidden = false;

      mensaje(
        "No se pudo confirmar el cierre de sesión. " +
          "Pulsa Cerrar sesión para intentar nuevamente.",
        true,
      );
    } finally {
      bloquear(false);
    }
  });

  async function recuperarSesion() {
    if (ocupado) return;

    const version = ++revision;

    bloquear(true);
    gestion.dataset.verificandoSesion = "true";
    aplicarAcceso(null);

    try {
      if (!db) {
        throw new Error("No hay conexión con Supabase.");
      }

      const { data, error } = await db.auth.getSession();

      if (version !== revision) return;

      if (error) {
        throw new Error("No se pudo recuperar la sesión.");
      }

      if (!data.session) {
        mensaje("");
        return;
      }

      mensaje("Verificando sesión…");
      await comprobarAcceso(version);
    } catch (error) {
      if (version !== revision) return;

      aplicarAcceso(null);
      mensaje(error.message || "No se pudo verificar el acceso.", true);
    } finally {
      bloquear(false);
      delete gestion.dataset.verificandoSesion;
    }
  }

  if (db) {
    db.auth.onAuthStateChange((evento, sesion) => {
      // Esta función no realiza consultas asíncronas.
      if (evento === "SIGNED_OUT") {
        ++revision;
        aplicarAcceso(null);
        clave.value = "";
        mensaje("Sesión cerrada.");
      }

      if (
        evento === "SIGNED_IN" &&
        !ocupado &&
        sesion?.user?.id !== window.payposAcceso?.usuarioId
      ) {
        // Consulta fuera del callback de autenticación.
        setTimeout(() => {
          void recuperarSesion();
        }, 0);
      }
    });
  }

  void recuperarSesion();
})();
/* =========================================================
   PAYPOS · CONTROL DE CAJAS Y TURNOS
========================================================= */

window.payposTurnoActual = null;

(() => {
  const pagina = document.getElementById("pagina-cajas");

  const lista = document.getElementById("cajas-lista");

  const tarjetas = [...lista.querySelectorAll("[data-caja-numero]")];

  const usuarioTexto = document.getElementById("cajas-usuario");

  const apertura = document.getElementById("caja-apertura");

  const titulo = document.getElementById("caja-apertura-titulo");

  const estado = document.getElementById("caja-apertura-estado");

  const fondoBloque = document.getElementById("caja-fondo-bloque");

  const fondo = document.getElementById("caja-fondo-inicial");

  const abrir = document.getElementById("abrir-caja");

  const mensaje = document.getElementById("caja-mensaje");

  let procesando = false;
  const cerrarAperturaCaja = document.getElementById("cerrar-apertura-caja");

  const totalAperturaCaja = document.getElementById("apertura-caja-total");

  const cortesAperturaCaja = [
    ...document.querySelectorAll("[data-corte-apertura]"),
  ];

  let temporizadorAperturaCaja = 0;

  function actualizarFondoApertura() {
    let total = 0;

    for (const input of cortesAperturaCaja) {
      const cantidad = Number(input.value || 0);

      if (!Number.isSafeInteger(cantidad) || cantidad < 0 || cantidad > 9999) {
        totalAperturaCaja.textContent = "—";

        abrir.disabled = true;

        return false;
      }

      const corte = Number(input.dataset.corteApertura);

      total += corte * cantidad;
    }

    fondo.value = String(total);

    totalAperturaCaja.textContent =
      "Bs " + new Intl.NumberFormat("es-BO").format(total);

    if (!procesando) {
      abrir.disabled = false;
    }

    return true;
  }

  function mostrarAperturaCaja() {
    if (procesando || window.payposTurnoActual?.id) {
      return;
    }

    cortesAperturaCaja.forEach((input) => {
      input.value = "";
    });

    actualizarFondoApertura();

    clearTimeout(temporizadorAperturaCaja);

    apertura.hidden = false;
    apertura.inert = false;

    document.body.style.overflow = "hidden";

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        apertura.classList.add("abierta");
      });
    });

    cortesAperturaCaja[0]?.focus({
      preventScroll: true,
    });
  }

  function ocultarAperturaCaja(forzar = false) {
    if ((!forzar && procesando) || apertura.hidden) {
      return;
    }

    apertura.classList.remove("abierta");

    apertura.inert = true;

    document.body.style.removeProperty("overflow");

    temporizadorAperturaCaja = setTimeout(() => {
      apertura.hidden = true;
    }, 480);
  }

  cortesAperturaCaja.forEach((input) => {
    input.addEventListener("input", actualizarFondoApertura);
  });

  cerrarAperturaCaja.addEventListener("click", () => {
    ocultarAperturaCaja();
  });
  // =========================================================
  // CERRAR CAJA · PANTALLA COMPLETA
  // =========================================================

  const cierreCaja = document.getElementById("caja-cierre");

  const cerrarPantallaCierre = document.getElementById(
    "cerrar-pantalla-cierre",
  );

  const cierreQr = document.getElementById("cierre-qr");

  const cierreTarjeta = document.getElementById("cierre-tarjeta");

  const cierreTotal = document.getElementById("cierre-caja-total");

  const cierreMensaje = document.getElementById("cierre-caja-mensaje");

  const confirmarCierre = document.getElementById("confirmar-cierre-caja");

  const cortesCierre = [...document.querySelectorAll("[data-corte-cierre]")];

  let temporizadorCierreCaja = 0;

  function obtenerDatosCierre() {
    const qr = Number(cierreQr.value || 0);

    const tarjeta = Number(cierreTarjeta.value || 0);

    if (
      !Number.isSafeInteger(qr) ||
      qr < 0 ||
      !Number.isSafeInteger(tarjeta) ||
      tarjeta < 0
    ) {
      return null;
    }

    let efectivo = 0;

    for (const input of cortesCierre) {
      const cantidad = Number(input.value || 0);

      if (!Number.isSafeInteger(cantidad) || cantidad < 0 || cantidad > 9999) {
        return null;
      }

      const corte = Number(input.dataset.corteCierre);

      efectivo += corte * cantidad;
    }

    return {
      qr,
      tarjeta,
      efectivo,
      total: qr + tarjeta + efectivo,
    };
  }

  function actualizarTotalCierre() {
    const datos = obtenerDatosCierre();

    if (!datos) {
      cierreTotal.textContent = "—";

      confirmarCierre.disabled = true;

      return;
    }

    cierreTotal.textContent =
      "Bs " + new Intl.NumberFormat("es-BO").format(datos.total);

    if (!procesando) {
      confirmarCierre.disabled = false;
    }
  }

  function mostrarCierreCaja() {
    if (procesando || !window.payposTurnoActual?.id) {
      return;
    }

    cierreQr.value = "";
    cierreTarjeta.value = "";

    cortesCierre.forEach((input) => {
      input.value = "";
    });

    cierreMensaje.textContent = "";

    actualizarTotalCierre();

    clearTimeout(temporizadorCierreCaja);

    cierreCaja.hidden = false;
    cierreCaja.inert = false;

    document.body.style.overflow = "hidden";

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        cierreCaja.classList.add("abierta");
      });
    });

    cierreQr.focus({
      preventScroll: true,
    });
  }

  function ocultarCierreCaja(forzar = false) {
    if ((!forzar && procesando) || cierreCaja.hidden) {
      return;
    }

    cierreCaja.classList.remove("abierta");

    cierreCaja.inert = true;

    document.body.style.removeProperty("overflow");

    temporizadorCierreCaja = setTimeout(() => {
      cierreCaja.hidden = true;
    }, 480);
  }

  [cierreQr, cierreTarjeta, ...cortesCierre].forEach((input) => {
    input.addEventListener("input", actualizarTotalCierre);
  });

  cerrarPantallaCierre.addEventListener("click", () => {
    ocultarCierreCaja();
  });
  async function imprimirArqueoCaja(turnoId) {
    try {
      if (!db || !turnoId) {
        throw new Error("No hay datos del cierre.");
      }

      const { data, error } = await db.rpc("pos_obtener_arqueo_impresion", {
        p_turno_id: turnoId,
      });

      if (error) throw error;
      if (!data) {
        throw new Error("No se encontró el arqueo.");
      }

      const numero = (valor) => {
        const n = Number(valor);
        return Number.isFinite(n) ? n : 0;
      };

      const bs = (valor) =>
        numero(valor).toLocaleString("es-BO", {
          maximumFractionDigits: 0,
        });

      const efectivoEsperado = numero(data.efectivo_esperado);
      const efectivoContado = numero(data.efectivo_contado);

      const qrEsperado = numero(data.qr_esperado);
      const qrContado = numero(data.qr_contado);

      const tarjetaEsperado = numero(data.tarjeta_esperado);
      const tarjetaContado = numero(data.tarjeta_contado);

      const totalEsperado = efectivoEsperado + qrEsperado + tarjetaEsperado;

      const totalContado = efectivoContado + qrContado + tarjetaContado;

      const diferencia = (esperado, contado) => bs(contado - esperado);

      const fila = (nombre, esperado, contado) => `
        <tr>
          <td>${nombre}</td>
          <td>${bs(esperado)}</td>
          <td>${bs(contado)}</td>
          <td>${diferencia(esperado, contado)}</td>
        </tr>
      `;

      const fecha = new Date(data.cerrado_en);

      const fechaTexto = Number.isNaN(fecha.getTime())
        ? ""
        : fecha.toLocaleString("es-BO", {
            timeZone: "America/La_Paz",
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          });

      const cajaActual = window.payposAcceso?.caja;

      const cajaNombre = cajaActual?.nombre
        ? String(cajaActual.nombre)
        : "CIERRE DE CAJA";

      const escapar = (valor) =>
        String(valor).replace(
          /[&<>"']/g,
          (caracter) =>
            ({
              "&": "&amp;",
              "<": "&lt;",
              ">": "&gt;",
              '"': "&quot;",
              "'": "&#39;",
            })[caracter],
        );

      const iframe = document.createElement("iframe");

      iframe.style.cssText = `
        position: fixed;
        width: 0;
        height: 0;
        border: 0;
        visibility: hidden;
      `;

      iframe.onload = () => {
        setTimeout(() => {
          try {
            iframe.contentWindow.focus();
            iframe.contentWindow.print();
          } catch (e) {
            console.error("Error al imprimir arqueo:", e);
          }
        }, 400);
      };

      iframe.srcdoc = `
        <!DOCTYPE html>
        <html lang="es">
        <head>
          <meta charset="UTF-8">

          <style>
          .logo-arqueo {
            width: 100%;
            text-align: center;
            margin: 0 auto 2mm;
          }

          .logo-arqueo img {
            display: block;
            width: 31mm;
            height: auto;
            max-height: 18mm;
            object-fit: contain;
            margin: 0 auto;
          }
            @page {
              size: 80mm auto;
              margin: 0;
            }

            * {
              box-sizing: border-box;
            }

            html, body {
              width: 80mm;
              margin: 0;
              padding: 0;
              background: white;
              color: black;
              font-family: Arial, sans-serif;
            }

            .ticket {
              width: 80mm;
              padding: 3mm 4mm 5mm;
            }

            .marca {
              text-align: center;
              font-size: 24px;
              font-weight: 900;
              letter-spacing: 2px;
            }

            .submarca {
              text-align: center;
              font-size: 10px;
              font-weight: bold;
            }

            h1 {
              margin: 5mm 0 3mm;
              text-align: center;
              font-size: 17px;
            }

            .info {
              font-size: 12px;
              line-height: 1.6;
              font-weight: bold;
            }

            .linea {
              border-top: 1px dashed black;
              margin: 3mm 0;
            }

            table {
              width: 100%;
              border-collapse: collapse;
              font-size: 11px;
            }

            th, td {
              padding: 2mm 0.5mm;
            }

            th {
              border-bottom: 1px solid black;
            }

            td:not(:first-child),
            th:not(:first-child) {
              text-align: right;
            }

            .total td {
              border-top: 2px solid black;
              padding-top: 3mm;
              font-weight: 900;
            }

            .pie {
              text-align: center;
              font-size: 12px;
              font-weight: bold;
              margin-top: 5mm;
            }

            @media print {
              html, body {
                width: 80mm;
              }
            }
          </style>
        </head>

        <body>
          <div class="ticket">

            <div class="logo-arqueo">
              <img src="pa.png" alt="PACHA">
            </div>

            <h1>ARQUEO DE CAJA</h1>

            <div class="info">
              ${escapar(cajaNombre)}<br>
              ${escapar(fechaTexto)}
            </div>

            <div class="linea"></div>

            <table>
              <thead>
                <tr>
                  <th>METODO</th>
                  <th>ESP.</th>
                  <th>CONT.</th>
                  <th>DIF.</th>
                </tr>
              </thead>

              <tbody>
                ${fila("EFECTIVO", efectivoEsperado, efectivoContado)}
                ${fila("QR", qrEsperado, qrContado)}
                ${fila("TARJETA", tarjetaEsperado, tarjetaContado)}

                <tr class="total">
                  <td>TOTAL</td>
                  <td>${bs(totalEsperado)}</td>
                  <td>${bs(totalContado)}</td>
                  <td>${diferencia(totalEsperado, totalContado)}</td>
                </tr>
              </tbody>
            </table>

            <div class="linea"></div>

            <div class="pie">
              CIERRE DE CAJA CONFIRMADO
            </div>

          </div>
        </body>
        </html>
      `;

      document.body.appendChild(iframe);

      setTimeout(() => {
        iframe.remove();
      }, 120000);
    } catch (error) {
      console.error("PayPos · no se pudo imprimir el arqueo:", error);

      window.payposToast?.("Caja cerrada. No se pudo imprimir el arqueo.");
    }
  }
  async function cerrarCajaPayPos() {
    if (procesando) return;

    const datos = obtenerDatosCierre();

    if (!datos) {
      cierreMensaje.textContent = "Revisa los importes ingresados.";

      return;
    }

    if (!window.payposTurnoActual?.id) {
      cierreMensaje.textContent = "No hay una caja abierta para cerrar.";

      return;
    }
    const idTurnoParaImprimir = window.payposTurnoActual.id;
    procesando = true;

    confirmarCierre.disabled = true;
    cerrarPantallaCierre.disabled = true;

    cierreMensaje.textContent = "Cerrando caja…";

    try {
      if (!db) {
        throw new Error("No hay conexión con Supabase.");
      }

      const respuesta = await db.rpc("pos_cerrar_turno", {
        p_cierre_qr_bs: datos.qr,

        p_cierre_efectivo_bs: datos.efectivo,

        p_cierre_tarjeta_bs: datos.tarjeta,
      });

      if (respuesta.error) {
        /*
          Puede pasar que Supabase cierre la caja
          pero la respuesta se pierda.
          Comprobamos el estado real.
        */

        const comprobacion = await consultarTurnoActual();

        if (!comprobacion?.id) {
          ocultarCierreCaja(true);

          window.payposToast?.("Caja cerrada correctamente");

          // La caja se cerró aunque se perdió
          // la respuesta de Supabase.
          await imprimirArqueoCaja(idTurnoParaImprimir);

          return;
        }

        throw new Error(
          respuesta.error.message || "No se pudo cerrar la caja.",
        );
      }

      /*
        Volvemos a consultar Supabase.
        Si cerró correctamente ya no
        debe existir un turno abierto.
      */

      const turnoActual = await consultarTurnoActual();

      if (turnoActual?.id) {
        throw new Error("Supabase no confirmó el cierre de la caja.");
      }

      emitirTurno(null);

      pintarCajaAsignada(null);
      // Imprimir automáticamente el arqueo
      await imprimirArqueoCaja(idTurnoParaImprimir);
      cierreMensaje.textContent = "Caja cerrada correctamente.";

      window.payposToast?.("Caja cerrada correctamente");

      ocultarCierreCaja(true);
    } catch (error) {
      console.error("PayPos · error al cerrar caja:", error);

      cierreMensaje.textContent =
        error?.message || "No se pudo cerrar la caja.";
    } finally {
      procesando = false;

      confirmarCierre.disabled = false;
      cerrarPantallaCierre.disabled = false;

      /*
        Dejamos la pantalla de Cajas
        mostrando el estado real.
      */

      await consultarTurnoActual();
    }
  }

  confirmarCierre.addEventListener("click", cerrarCajaPayPos);
  function emitirTurno(turno) {
    window.payposTurnoActual = turno || null;

    document.dispatchEvent(
      new CustomEvent("paypos:turno-cambiado", {
        detail: window.payposTurnoActual,
      }),
    );
  }

  function obtenerTarjeta(numero) {
    return tarjetas.find(
      (tarjeta) => Number(tarjeta.dataset.cajaNumero) === Number(numero),
    );
  }

  function limpiarVista() {
    tarjetas.forEach((tarjeta) => {
      tarjeta.classList.remove("caja-propia", "caja-abierta");

      const estadoTarjeta = tarjeta.querySelector("[data-caja-estado]");

      const accion = tarjeta.querySelector("[data-caja-accion]");

      estadoTarjeta.textContent = "No asignada a este usuario";

      accion.textContent = "No disponible";

      accion.disabled = true;

      accion.onclick = null;
    });

    usuarioTexto.textContent = "";

    mensaje.textContent = "";
  }

  function pintarCajaAsignada(turno = null) {
    limpiarVista();

    const acceso = window.payposAcceso;

    if (!acceso?.usuarioId || !acceso?.caja) {
      usuarioTexto.textContent = "Inicia sesión para consultar tu caja.";

      return;
    }

    usuarioTexto.textContent = acceso.email || "";

    const numero = Number(acceso.caja.numero);

    const tarjeta = obtenerTarjeta(numero);

    if (!tarjeta) return;

    tarjeta.classList.add("caja-propia");

    const estadoTarjeta = tarjeta.querySelector("[data-caja-estado]");

    const accion = tarjeta.querySelector("[data-caja-accion]");

    tarjeta.querySelector("h2").textContent =
      acceso.caja.nombre || `Caja ${numero}`;

    titulo.textContent = acceso.caja.nombre || `Caja ${numero}`;

    if (turno?.id) {
      tarjeta.classList.add("caja-abierta");

      estadoTarjeta.textContent = "Turno abierto";

      accion.textContent = "Cerrar caja";

      accion.disabled = false;

      fondoBloque.hidden = true;

      abrir.disabled = true;

      accion.onclick = mostrarCierreCaja;

      return;
    }

    estadoTarjeta.textContent = "Asignada a tu usuario";

    accion.textContent = "Abrir caja";

    accion.disabled = false;

    estado.textContent = "La caja está cerrada.";

    fondoBloque.hidden = false;

    fondo.disabled = false;

    abrir.textContent = "Abrir caja";

    abrir.disabled = false;

    accion.onclick = mostrarAperturaCaja;
  }

  async function consultarTurnoActual() {
    const acceso = window.payposAcceso;

    emitirTurno(null);

    if (!acceso?.usuarioId || !acceso?.caja?.id || !db) {
      pintarCajaAsignada(null);
      return null;
    }

    const respuesta = await db
      .from("pos_turnos")
      .select("id,caja_id,abierto_por,abierto_en,fondo_inicial_bs,estado")
      .eq("caja_id", acceso.caja.id)
      .eq("abierto_por", acceso.usuarioId)
      .eq("estado", "abierto")
      .order("abierto_en", {
        ascending: false,
      })
      .limit(1)
      .maybeSingle();

    if (respuesta.error) {
      console.error("PayPos · consultar turno:", {
        code: respuesta.error.code,

        message: respuesta.error.message,

        details: respuesta.error.details,

        hint: respuesta.error.hint,
      });

      mensaje.textContent = "No se pudo comprobar el estado de la caja.";

      pintarCajaAsignada(null);

      return null;
    }

    emitirTurno(respuesta.data || null);

    pintarCajaAsignada(respuesta.data || null);

    return respuesta.data || null;
  }

  async function abrirCaja() {
    if (procesando) return;

    const acceso = window.payposAcceso;

    if (!acceso?.usuarioId || !acceso?.caja?.id) {
      mensaje.textContent = "Inicia sesión con el usuario de esta caja.";

      return;
    }

    const valor = Number(fondo.value);

    if (!Number.isSafeInteger(valor) || valor < 0 || valor > 999999999) {
      mensaje.textContent =
        "El fondo inicial debe ser un número entero válido.";

      fondo.focus();

      return;
    }

    procesando = true;

    abrir.disabled = true;
    fondo.disabled = true;

    mensaje.textContent = "Abriendo caja…";

    try {
      /*
        Comprobamos nuevamente por si
        otro proceso ya abrió el turno.
      */
      const existente = await consultarTurnoActual();

      if (existente?.id) {
        mensaje.textContent = "La caja ya estaba abierta.";

        return;
      }

      const respuesta = await db.rpc("pos_abrir_turno", {
        p_fondo_inicial_bs: valor,
      });

      if (respuesta.error) {
        /*
          Podría haberse abierto aunque
          la respuesta se haya perdido.
          Volvemos a comprobar.
        */

        const comprobacion = await consultarTurnoActual();

        if (comprobacion?.id) {
          mensaje.textContent = "Caja abierta correctamente.";

          return;
        }

        console.error("PayPos · pos_abrir_turno:", {
          code: respuesta.error.code,

          message: respuesta.error.message,

          details: respuesta.error.details,

          hint: respuesta.error.hint,
        });

        throw new Error(respuesta.error.message || "No se pudo abrir la caja.");
      }

      const turno = Array.isArray(respuesta.data)
        ? respuesta.data[0]
        : respuesta.data;

      if (!turno?.id) {
        /*
          Comprobación final antes de
          considerar la apertura fallida.
        */

        const comprobacion = await consultarTurnoActual();

        if (!comprobacion?.id) {
          throw new Error("Supabase no confirmó la apertura de la caja.");
        }
      }

      const turnoFinal = turno?.id ? turno : await consultarTurnoActual();

      emitirTurno(turnoFinal);

      pintarCajaAsignada(turnoFinal);

      mensaje.textContent = "Caja abierta correctamente.";

      window.payposToast?.("Caja abierta correctamente");
      ocultarAperturaCaja(true);
    } catch (error) {
      console.error("PayPos · error al abrir caja:", error);

      mensaje.textContent = error?.message || "No se pudo abrir la caja.";
    } finally {
      procesando = false;

      /*
        La consulta define si debe volver
        a habilitarse o quedar abierta.
      */

      await consultarTurnoActual();
    }
  }

  abrir.addEventListener("click", abrirCaja);

  /*
    Cuando cambia el usuario,
    cargamos su caja y turno.
  */

  document.addEventListener("paypos:acceso-cambiado", () => {
    void consultarTurnoActual();
  });

  /*
    Al pulsar Cajas refrescamos
    el estado real desde Supabase.
  */

  document
    .querySelector('.icono[data-nombre="Cajas"]')
    ?.addEventListener("click", () => {
      void consultarTurnoActual();
    });

  /*
    Por si la sesión ya estaba
    restaurada antes de este bloque.
  */

  if (window.payposAcceso) {
    void consultarTurnoActual();
  } else {
    pintarCajaAsignada(null);
  }
})();
/* =========================================================
   PAYPOS · HISTORIAL DE COMANDAS
========================================================= */

(() => {
  const botonAbrir = document.getElementById("abrir-comandas");

  const pantalla = document.getElementById("pantalla-comandas");

  const botonCerrar = document.getElementById("cerrar-comandas");

  const buscador = document.getElementById("buscar-comanda");

  const lista = document.getElementById("lista-comandas");

  const estado = document.getElementById("estado-comandas");

  const cantidad = document.getElementById("comandas-cantidad");

  const recargar = document.getElementById("recargar-comandas");
  const modalAnular = document.getElementById("modal-anular-comanda");

  const cancelarAnulacion = document.getElementById("cancelar-anulacion");

  const confirmarAnulacion = document.getElementById("confirmar-anulacion");

  const tituloAnulacion = document.getElementById("titulo-anular-comanda");

  const motivoAnulacion = document.getElementById("motivo-anulacion");

  const estadoAnulacion = document.getElementById("estado-anulacion");

  if (
    !botonAbrir ||
    !pantalla ||
    !botonCerrar ||
    !buscador ||
    !lista ||
    !estado ||
    !cantidad ||
    !recargar
  ) {
    console.error("PayPos: faltan elementos de Comandas.");

    return;
  }

  let cargando = false;
  let temporizadorCerrar = 0;
  let temporizadorBusqueda = 0;
  let versionConsulta = 0;

  let comandaParaAnular = null;
  let anulandoComanda = false;
  let temporizadorAnulacion = 0;

  /* =========================================================
     TEXTO SEGURO
  ========================================================= */

  function escaparComandaHistorial(valor) {
    return String(valor ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  /* =========================================================
     FECHA Y HORA
  ========================================================= */

  function fechaComanda(valor) {
    const fecha = new Date(valor);

    if (Number.isNaN(fecha.getTime())) {
      return "";
    }

    const dia = fecha.toLocaleDateString("es-BO");

    const hora = fecha.toLocaleTimeString("es-BO", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

    return `${dia} ${hora}`;
  }

  /* =========================================================
     CREAR UNA COMANDA
  ========================================================= */
  function crearComanda(datos) {
    const articulo = document.createElement("article");

    const anulada = String(datos.estado || "").toLowerCase() === "anulada";

    articulo.className = "comanda-ticket";
    articulo.classList.toggle("anulada", anulada);
    articulo.dataset.numero = String(datos.numero ?? "");

    articulo.innerHTML = contenidoTicketPayPos(
      datos,
      datos.puede_anular === true && !anulada,
    );

    articulo
      .querySelector("[data-anular-comanda]")
      ?.addEventListener("click", (evento) => {
        evento.stopPropagation();
        abrirAnulacion(datos);
      });

    return articulo;
  }

  /* =========================================================
     DIBUJAR RESULTADOS
  ========================================================= */

  function dibujarComandas(comandas) {
    lista.replaceChildren();

    if (!comandas.length) {
      cantidad.textContent = "0 comandas";

      estado.textContent = buscador.value.trim()
        ? "No encontramos esa orden."
        : "Todavía no hay comandas registradas.";

      return;
    }

    cantidad.textContent =
      comandas.length === 1 ? "1 comanda" : `${comandas.length} comandas`;

    estado.textContent = "";

    const fragmento = document.createDocumentFragment();

    comandas.forEach((comanda) => {
      fragmento.appendChild(crearComanda(comanda));
    });

    lista.appendChild(fragmento);
  }

  /* =========================================================
     CONSULTAR SUPABASE
  ========================================================= */

  async function cargarComandas() {
    if (cargando) {
      versionConsulta++;
    }

    const version = ++versionConsulta;

    const texto = buscador.value.trim().replace(/^#/, "").trim();

    let numero = null;

    if (texto) {
      if (!/^\d+$/.test(texto)) {
        lista.replaceChildren();

        cantidad.textContent = "—";

        estado.textContent = "Escribe solamente el número de orden.";

        return;
      }

      numero = Number(texto);

      if (!Number.isSafeInteger(numero) || numero < 1) {
        estado.textContent = "El número de orden no es válido.";

        return;
      }
    }

    cargando = true;

    recargar.disabled = true;

    estado.textContent = numero
      ? `Buscando orden #${numero}…`
      : "Cargando comandas…";

    try {
      if (!db) {
        throw new Error("No hay conexión con Supabase.");
      }

      if (!window.payposAcceso?.caja) {
        throw new Error("Necesitas iniciar sesión en una caja.");
      }

      const { data, error } = await db.rpc("pos_listar_comandas", {
        p_numero: numero,

        p_limite: numero ? 1 : 40,

        p_desde: 0,
      });

      if (version !== versionConsulta) {
        return;
      }

      if (error) {
        throw error;
      }

      const comandas = Array.isArray(data) ? data : [];

      dibujarComandas(comandas);
    } catch (error) {
      if (version !== versionConsulta) {
        return;
      }

      console.error("PayPos · comandas:", error);

      lista.replaceChildren();

      cantidad.textContent = "—";

      estado.textContent =
        error?.message || "No se pudieron cargar las comandas.";
    } finally {
      if (version === versionConsulta) {
        cargando = false;
        recargar.disabled = false;
      }
    }
  }

  /* =========================================================
     ANULAR COMANDA
  ========================================================= */

  function abrirAnulacion(comanda) {
    if (
      anulandoComanda ||
      !comanda?.id ||
      comanda.puede_anular !== true ||
      String(comanda.estado || "").toLowerCase() === "anulada"
    ) {
      return;
    }

    clearTimeout(temporizadorAnulacion);

    comandaParaAnular = comanda;

    tituloAnulacion.textContent = `Orden #${comanda.numero}`;

    motivoAnulacion.value = "";

    estadoAnulacion.textContent = "";

    confirmarAnulacion.disabled = false;

    cancelarAnulacion.disabled = false;

    motivoAnulacion.disabled = false;

    modalAnular.hidden = false;
    modalAnular.inert = false;

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        modalAnular.classList.add("abierta");
      });
    });

    setTimeout(() => {
      motivoAnulacion.focus({
        preventScroll: true,
      });
    }, 150);
  }

  function cerrarAnulacion(forzar = false) {
    if (modalAnular.hidden || (anulandoComanda && !forzar)) {
      return;
    }

    modalAnular.classList.remove("abierta");

    modalAnular.inert = true;

    clearTimeout(temporizadorAnulacion);

    temporizadorAnulacion = setTimeout(() => {
      modalAnular.hidden = true;

      comandaParaAnular = null;

      motivoAnulacion.value = "";

      estadoAnulacion.textContent = "";
    }, 480);
  }

  async function anularComandaSeleccionada() {
    if (anulandoComanda || !comandaParaAnular?.id) {
      return;
    }

    const motivo = motivoAnulacion.value.trim();

    if (motivo.length < 3) {
      estadoAnulacion.textContent = "Escribe el motivo de la anulación.";

      motivoAnulacion.focus();

      return;
    }

    if (motivo.length > 180) {
      estadoAnulacion.textContent =
        "El motivo no puede superar 180 caracteres.";

      return;
    }

    const ventaId = comandaParaAnular.id;

    const numeroVenta = comandaParaAnular.numero;

    anulandoComanda = true;

    confirmarAnulacion.disabled = true;

    cancelarAnulacion.disabled = true;

    motivoAnulacion.disabled = true;

    estadoAnulacion.textContent = "Anulando comanda…";

    try {
      if (!db) {
        throw new Error("No hay conexión con Supabase.");
      }

      const { data, error } = await db.rpc("pos_anular_venta", {
        p_venta_id: ventaId,

        p_motivo: motivo,
      });

      if (error) {
        throw error;
      }

      if (data?.estado !== "anulada") {
        throw new Error("Supabase no confirmó la anulación.");
      }

      document.dispatchEvent(new Event("paypos:ventas-actualizadas"));

      window.payposToast?.(`Orden #${numeroVenta} anulada`);

      cerrarAnulacion(true);

      /*
        Recargamos las comandas.
        Ahora aparecerá con el sello ANULADA.
      */
      await cargarComandas();
    } catch (error) {
      console.error("PayPos · anular comanda:", error);

      estadoAnulacion.textContent =
        error?.message || "No se pudo anular la comanda.";
    } finally {
      anulandoComanda = false;

      confirmarAnulacion.disabled = false;

      cancelarAnulacion.disabled = false;

      motivoAnulacion.disabled = false;
    }
  }

  cancelarAnulacion.addEventListener("click", () => {
    cerrarAnulacion();
  });

  confirmarAnulacion.addEventListener("click", () => {
    void anularComandaSeleccionada();
  });
  /* =========================================================
     ABRIR PANTALLA
  ========================================================= */

  function abrirComandas() {
    if (!window.payposAcceso?.caja) {
      window.payposToast?.("Inicia sesión en tu caja para ver las comandas.");

      return;
    }

    clearTimeout(temporizadorCerrar);

    buscador.value = "";

    pantalla.hidden = false;
    pantalla.inert = false;

    document.body.style.overflow = "hidden";

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        pantalla.classList.add("abierta");
      });
    });

    void cargarComandas();
  }

  /* =========================================================
     CERRAR PANTALLA
  ========================================================= */

  function cerrarComandas() {
    if (pantalla.hidden) {
      return;
    }

    pantalla.classList.remove("abierta");

    pantalla.inert = true;

    document.body.style.removeProperty("overflow");

    temporizadorCerrar = setTimeout(() => {
      pantalla.hidden = true;
    }, 480);
  }

  /* =========================================================
     BOTONES
  ========================================================= */

  botonAbrir.addEventListener("click", abrirComandas);

  botonCerrar.addEventListener("click", cerrarComandas);

  recargar.addEventListener("click", () => {
    void cargarComandas();
  });

  /* =========================================================
     BUSCADOR
  ========================================================= */

  buscador.addEventListener("input", () => {
    clearTimeout(temporizadorBusqueda);

    temporizadorBusqueda = setTimeout(() => {
      void cargarComandas();
    }, 300);
  });

  /* =========================================================
     ESC
  ========================================================= */

  document.addEventListener("keydown", (evento) => {
    if (evento.key !== "Escape") {
      return;
    }

    /*
        Primero cierra Anulación.
        Si no está abierta,
        recién cierra Comandas.
      */
    if (!modalAnular.hidden) {
      cerrarAnulacion();

      return;
    }

    if (!pantalla.hidden) {
      cerrarComandas();
    }
  });
})();
// ===== ABRIR EL FORMULARIO DE PRODUCTOS =====
(() => {
  const nuevo = document.getElementById("nuevo-producto");
  const editor = document.getElementById("editor-producto");
  const formulario = document.getElementById("form-producto");
  const gestion = document.getElementById("gestion-autorizada");

  const cerrar = document.getElementById("cerrar-editor");
  const cancelar = document.getElementById("cancelar-producto");

  const foto = document.getElementById("producto-foto");
  const preview = document.getElementById("preview-producto");
  const placeholder = document.getElementById("foto-placeholder");
  const mensaje = document.getElementById("mensaje-productos");

  let fotoTemporal = null;
  // ===== LISTA Y EDITOR COMO DOS VISTAS =====

  // Sacamos el editor de la distribución lateral.
  editor.remove();

  // Agrupamos la lista y el buscador.
  const vistaLista = document.createElement("div");
  vistaLista.className = "vista-lista-productos";

  while (gestion.firstChild) {
    vistaLista.append(gestion.firstChild);
  }

  // El editor y la lista quedan al mismo nivel.
  gestion.append(vistaLista, editor);
  gestion.classList.add("escenario-productos");
  editor.classList.add("editor-pagina");

  let vistaEditorActiva = false;
  let destinoEditor = false;
  let transicionEditor = false;
  let versionTransicion = 0;
  let efectosEditor = [];

  function limpiarEstilosTransicion() {
    efectosEditor.forEach((efecto) => efecto.cancel());
    efectosEditor = [];

    [vistaLista, editor].forEach((vista) => {
      vista.style.removeProperty("position");
      vista.style.removeProperty("top");
      vista.style.removeProperty("left");
      vista.style.removeProperty("width");
    });

    gestion.style.removeProperty("min-height");
  }

  function establecerVista(esEditor) {
    vistaLista.hidden = esEditor;
    vistaLista.inert = esEditor;

    editor.hidden = !esEditor;
    editor.inert = !esEditor;

    nuevo.hidden = esEditor;
    nuevo.setAttribute("aria-expanded", String(esEditor));

    vistaEditorActiva = esEditor;
  }

  async function cambiarVistaProducto(esEditor, inmediato = false) {
    destinoEditor = esEditor;

    if (inmediato) {
      versionTransicion++;
      limpiarEstilosTransicion();
      establecerVista(esEditor);
      transicionEditor = false;
      return;
    }

    if (transicionEditor) return;

    transicionEditor = true;
    const version = ++versionTransicion;

    try {
      while (vistaEditorActiva !== destinoEditor) {
        const abrirEditor = destinoEditor;
        const saliente = vistaEditorActiva ? editor : vistaLista;
        const entrante = abrirEditor ? editor : vistaLista;

        const direccion = abrirEditor ? 1 : -1;

        // Quita el foco antes de desactivar la vista saliente.
        if (saliente.contains(document.activeElement)) {
          document.activeElement.blur();
        }

        entrante.hidden = false;
        entrante.inert = true;
        saliente.inert = true;

        nuevo.hidden = true;

        saliente.style.position = "absolute";
        saliente.style.top = "0";
        saliente.style.left = "0";
        saliente.style.width = "100%";

        gestion.style.minHeight = `${Math.max(saliente.offsetHeight, entrante.offsetHeight)}px`;

        const reducir = window.matchMedia(
          "(prefers-reduced-motion: reduce)",
        ).matches;

        if (!reducir) {
          const opciones = {
            duration: 300,
            easing: "cubic-bezier(.22,.75,.25,1)",
            fill: "both",
          };

          efectosEditor = [
            saliente.animate(
              [
                { transform: "translateX(0)", opacity: 1 },
                {
                  transform: `translateX(${-100 * direccion}%)`,
                  opacity: 0.2,
                },
              ],
              opciones,
            ),

            entrante.animate(
              [
                {
                  transform: `translateX(${100 * direccion}%)`,
                  opacity: 0.2,
                },
                { transform: "translateX(0)", opacity: 1 },
              ],
              opciones,
            ),
          ];

          await Promise.allSettled(
            efectosEditor.map((efecto) => efecto.finished),
          );
        }

        if (version !== versionTransicion) return;

        establecerVista(abrirEditor);
        limpiarEstilosTransicion();

        // Lleva al comienzo de la vista si estabas abajo en la lista.
        const paginaVisible =
          !document.getElementById("pagina-productos").hidden &&
          !gestion.hidden;

        if (paginaVisible) {
          const posicion = Math.max(
            0,
            window.scrollY + gestion.getBoundingClientRect().top - 105,
          );

          window.scrollTo({ top: posicion, behavior: "instant" });

          const foco = abrirEditor
            ? document.getElementById("producto-nombre")
            : nuevo;

          foco.focus({ preventScroll: true });
        }
      }
    } finally {
      if (version === versionTransicion) {
        limpiarEstilosTransicion();
        transicionEditor = false;
      }
    }
  }

  establecerVista(false);
  function limpiarFoto() {
    if (fotoTemporal) {
      URL.revokeObjectURL(fotoTemporal);
      fotoTemporal = null;
    }

    preview.hidden = true;
    preview.removeAttribute("src");
    placeholder.hidden = false;
  }

  function cerrarEditor() {
    cambiarVistaProducto(false, gestion.hidden);
  }

  function sincronizarAcceso() {
    nuevo.disabled = gestion.hidden;

    if (gestion.hidden) {
      cerrarEditor();
      formulario.reset();
      limpiarFoto();
      mensaje.textContent = "";
    }
  }

  // Sigue el estado del acceso que ya conectamos.
  const observador = new MutationObserver(sincronizarAcceso);

  observador.observe(gestion, {
    attributes: true,
    attributeFilter: ["hidden"],
  });

  sincronizarAcceso();

  nuevo.addEventListener("click", () => {
    if (gestion.hidden) return;

    // Conserva lo escrito si el formulario ya estaba abierto.
    if (!editor.hidden) {
      document.getElementById("producto-nombre").focus();
      return;
    }

    formulario.reset();
    limpiarFoto();

    document.getElementById("producto-id").value = "";
    delete editor.dataset.fotoActual;

    document.getElementById("guardar-producto").textContent =
      "Guardar producto";

    placeholder.textContent = "Tu producto puede guardarse sin foto.";
    document.getElementById("modo-editor").textContent = "NUEVO PRODUCTO";
    document.getElementById("titulo-editor").textContent = "Añadir producto";

    mensaje.textContent = "";
    mensaje.dataset.error = "false";

    cambiarVistaProducto(true);
  });

  function cancelarEdicion() {
    const tieneDatos =
      document.getElementById("producto-nombre").value.trim() ||
      document.getElementById("producto-precio").value ||
      document.getElementById("producto-categoria").value ||
      foto.files.length;

    if (
      tieneDatos &&
      !window.confirm("¿Descartar los datos de este producto?")
    ) {
      return;
    }

    cerrarEditor();
    formulario.reset();
    limpiarFoto();
    nuevo.focus();
  }

  cerrar.addEventListener("click", cancelarEdicion);
  cancelar.addEventListener("click", cancelarEdicion);

  foto.addEventListener("change", () => {
    limpiarFoto();
    mensaje.textContent = "";

    const archivo = foto.files[0];
    if (!archivo) return;

    const tipos = ["image/jpeg", "image/png", "image/webp"];

    if (!tipos.includes(archivo.type) || archivo.size > 3 * 1024 * 1024) {
      foto.value = "";
      mensaje.textContent = "Elige una foto JPG, PNG o WebP de hasta 3 MB.";
      mensaje.dataset.error = "true";
      return;
    }

    fotoTemporal = URL.createObjectURL(archivo);
    preview.src = fotoTemporal;
    preview.hidden = false;
    placeholder.hidden = true;
  });

  preview.addEventListener("error", () => {
    limpiarFoto();
    foto.value = "";
    mensaje.textContent = "No se pudo leer esa imagen. Selecciona otra.";
    mensaje.dataset.error = "true";
  });

  // ===== GUARDAR PRODUCTO EN SUPABASE =====

  let guardandoProducto = false;
  let productoPendiente = null;
  document.addEventListener("paypos:editar-producto", (evento) => {
    if (gestion.hidden || guardandoProducto || productoPendiente) {
      return;
    }

    const producto = evento.detail;

    if (!producto?.id) return;

    const tieneDatos =
      document.getElementById("producto-nombre").value.trim() ||
      document.getElementById("producto-precio").value ||
      document.getElementById("producto-categoria").value ||
      foto.files.length;

    if (
      !editor.hidden &&
      tieneDatos &&
      !window.confirm("¿Descartar el formulario actual y editar este producto?")
    ) {
      return;
    }

    formulario.reset();
    limpiarFoto();

    document.getElementById("producto-id").value = producto.id;
    document.getElementById("producto-nombre").value = producto.nombre;
    document.getElementById("producto-precio").value = producto.precio;
    document.getElementById("producto-categoria").value = producto.categoria;

    // Conserva la foto existente si no seleccionas otra.
    editor.dataset.fotoActual = producto.foto_path || "";

    document.getElementById("modo-editor").textContent = "EDITAR PRODUCTO";
    document.getElementById("titulo-editor").textContent = "Editar producto";
    document.getElementById("guardar-producto").textContent = "Guardar cambios";

    placeholder.textContent = producto.foto_path
      ? "Este producto ya tiene foto. Selecciona otra solo si quieres reemplazarla."
      : "Este producto no tiene foto.";

    mensaje.textContent = "";
    mensaje.dataset.error = "false";

    cambiarVistaProducto(true);
  });
  const botonGuardar = document.getElementById("guardar-producto");
  const camposProducto = document.getElementById("campos-producto");

  formulario.addEventListener("submit", async (evento) => {
    evento.preventDefault();

    if (guardandoProducto) return;

    function mostrarMensaje(texto, error = false) {
      mensaje.textContent = texto;
      mensaje.dataset.error = String(error);
    }

    try {
      if (!db) {
        throw new Error("Supabase no está conectado. Revisa tu configuración.");
      }

      if (!productoPendiente) {
        if (!formulario.reportValidity()) return;

        const nombre = document.getElementById("producto-nombre").value.trim();

        const precioTexto = document.getElementById("producto-precio").value;

        const precio = Number(precioTexto);

        const categoria = document.getElementById("producto-categoria").value;

        const archivo = foto.files[0] || null;

        const categorias = [
          "Cervezas",
          "Botellas",
          "Cócteles",
          "Sin alcohol",
          "Otros",
        ];

        if (!nombre || nombre.length > 100) {
          throw new Error("Escribe un nombre de entre 1 y 100 caracteres.");
        }

        if (
          !Number.isFinite(precio) ||
          precio <= 0 ||
          precio > 999999.99 ||
          !/^\d+(\.\d{1,2})?$/.test(precioTexto)
        ) {
          throw new Error(
            "El precio debe ser mayor a cero y tener máximo dos decimales.",
          );
        }

        if (!categorias.includes(categoria)) {
          throw new Error("Selecciona una categoría.");
        }

        if (
          archivo &&
          (!["image/jpeg", "image/png", "image/webp"].includes(archivo.type) ||
            archivo.size > 3 * 1024 * 1024)
        ) {
          throw new Error("Selecciona una foto JPG, PNG o WebP de hasta 3 MB.");
        }

        // Conservamos los datos y el ID para reintentar
        // sin crear otra fila si se pierde la respuesta.
        const idExistente = document.getElementById("producto-id").value;

        productoPendiente = {
          id: idExistente || crypto.randomUUID(),
          editando: Boolean(idExistente),
          nombre,
          precio,
          categoria,
          archivo,

          // Con otra imagen, se genera una ruta nueva.
          foto_path: archivo ? null : editor.dataset.fotoActual || null,

          fotoSubida: !archivo,
          usuario_id: null,
        };
      }

      guardandoProducto = true;

      botonGuardar.disabled = true;
      camposProducto.disabled = true;
      nuevo.disabled = true;
      cerrar.disabled = true;
      cancelar.disabled = true;

      botonGuardar.textContent = "Guardando…";
      mostrarMensaje("Verificando tu sesión…");

      const sesion = await db.auth.getUser();

      if (sesion.error || !sesion.data.user) {
        throw new Error(
          "No se pudo verificar la sesión. Revisa tu conexión y reintenta.",
        );
      }

      const usuarioId = sesion.data.user.id;

      if (
        productoPendiente.usuario_id &&
        productoPendiente.usuario_id !== usuarioId
      ) {
        throw new Error(
          "Este guardado pertenece a otra sesión. Ingresa con la cuenta original.",
        );
      }

      productoPendiente.usuario_id = usuarioId;

      // La foto es opcional.
      if (productoPendiente.archivo && !productoPendiente.fotoSubida) {
        mostrarMensaje("Subiendo fotografía…");

        const extensiones = {
          "image/jpeg": "jpg",
          "image/png": "png",
          "image/webp": "webp",
        };

        if (!productoPendiente.foto_path) {
          productoPendiente.foto_path =
            `${usuarioId}/${crypto.randomUUID()}.` +
            extensiones[productoPendiente.archivo.type];
        }

        const almacen = db.storage.from("paypos-productos");

        const subida = await almacen.upload(
          productoPendiente.foto_path,
          productoPendiente.archivo,
          {
            contentType: productoPendiente.archivo.type,
            upsert: false,
          },
        );

        if (subida.error) {
          // La subida pudo terminar aunque se perdiera su respuesta.
          const existente = await almacen.download(productoPendiente.foto_path);

          if (existente.error || !existente.data) {
            throw new Error(
              "No se confirmó la subida de la foto. Revisa tu conexión y reintenta.",
            );
          }
        }

        productoPendiente.fotoSubida = true;
      }

      mostrarMensaje("Guardando producto…");

      const registro = {
        id: productoPendiente.id,
        nombre: productoPendiente.nombre,
        precio: productoPendiente.precio,
        categoria: productoPendiente.categoria,
        foto_path: productoPendiente.foto_path,
        creado_por: productoPendiente.usuario_id,
      };

      let resultado;

      if (productoPendiente.editando) {
        resultado = await db
          .from("productos")
          .update({
            nombre: registro.nombre,
            precio: registro.precio,
            categoria: registro.categoria,
            foto_path: registro.foto_path,
          })
          .eq("id", registro.id)
          .select("id")
          .single();
      } else {
        resultado = await db
          .from("productos")
          .insert(registro)
          .select("id")
          .single();
      }

      if (resultado.error) {
        // Una respuesta puede perderse después de guardar.
        // Comprobamos que los valores guardados sean los esperados.
        const comprobacion = await db
          .from("productos")
          .select("id,nombre,precio,categoria,foto_path")
          .eq("id", registro.id)
          .maybeSingle();

        const guardado = comprobacion.data;

        const coincide =
          !comprobacion.error &&
          guardado &&
          guardado.nombre === registro.nombre &&
          Number(guardado.precio) === Number(registro.precio) &&
          guardado.categoria === registro.categoria &&
          guardado.foto_path === registro.foto_path;

        if (!coincide) {
          throw new Error(
            "No se confirmó el guardado. Revisa tu conexión y pulsa Reintentar.",
          );
        }
      }

      productoPendiente = null;

      const fotoAnterior = editor.dataset.fotoActual || "";
      if (fotoAnterior && fotoAnterior !== registro.foto_path) {
        window.payposInvalidarFoto?.(fotoAnterior);
      }

      formulario.reset();
      limpiarFoto();

      document.getElementById("producto-id").value = "";
      delete editor.dataset.fotoActual;

      document.getElementById("modo-editor").textContent = "NUEVO PRODUCTO";
      document.getElementById("titulo-editor").textContent = "Añadir producto";

      placeholder.textContent = "Tu producto puede guardarse sin foto.";
      mostrarMensaje("");

      document.dispatchEvent(new Event("paypos:productos-actualizados"));

      window.payposToast("Guardado correctamente");

      await cambiarVistaProducto(false);
    } catch (error) {
      mostrarMensaje(error.message || "No se pudo guardar el producto.", true);
    } finally {
      guardandoProducto = false;
      botonGuardar.disabled = false;

      const pendiente = Boolean(productoPendiente);

      // Conserva el mismo pedido de guardado durante un reintento.
      camposProducto.disabled = pendiente;
      cerrar.disabled = pendiente;
      cancelar.disabled = pendiente;
      nuevo.disabled = pendiente || gestion.hidden;

      botonGuardar.textContent = pendiente
        ? "Reintentar guardado"
        : "Guardar producto";
    }
  });
})();
// ===== MOSTRAR Y BUSCAR PRODUCTOS =====
(() => {
  const catalogo = document.getElementById("catalogo");
  const estadoCatalogo = document.getElementById("estado-catalogo");

  const lista = document.getElementById("lista-productos");
  const estadoLista = document.getElementById("estado-lista-productos");
  const contador = document.getElementById("contador-productos");

  const buscador = document.getElementById("buscar-productos");
  const buscadorInicio = document.getElementById("buscar-inicio");
  const filtro = document.getElementById("filtrar-categoria");
  const gestion = document.getElementById("gestion-autorizada");

  let productos = [];
  let versionCarga = 0;
  let observadorFotos = null;
  const tarjetasInicio = new Map();
  const filasProductos = new Map();

  const moneda = new Intl.NumberFormat("es-BO", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });

  function precio(valor) {
    return `Bs ${moneda.format(Number(valor))}`;
  }

  function normalizar(texto) {
    return texto
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
  }

  // textContent evita interpretar nombres como código HTML.
  function texto(etiqueta, clase, contenido) {
    const nodo = document.createElement(etiqueta);
    nodo.className = clase;
    nodo.textContent = contenido;
    return nodo;
  }

  function crearFoto(producto, clase) {
    const contenedor = document.createElement("div");
    contenedor.className = clase;

    const aviso = texto("span", "foto-vacia", "Sin foto");
    contenedor.append(aviso);

    if (producto.foto_path) {
      const urlCacheada = obtenerUrlFotoCacheada(producto.foto_path);

      if (urlCacheada) {
        contenedor.replaceChildren(
          crearImagenFoto(urlCacheada, producto.nombre),
        );
      } else {
        contenedor.dataset.fotoPath = producto.foto_path;
        contenedor.dataset.fotoNombre = producto.nombre;
        aviso.textContent = "Cargando foto…";
      }
    }

    return contenedor;
  }

  async function cargarFoto(contenedor, version) {
    const ruta = contenedor.dataset.fotoPath;
    if (!ruta) return;

    delete contenedor.dataset.fotoPath;

    try {
      const url = await obtenerUrlFoto(ruta);

      if (version !== versionCarga || !contenedor.isConnected) {
        return;
      }

      const imagen = crearImagenFoto("", contenedor.dataset.fotoNombre, "high");

      imagen.addEventListener("load", () => {
        if (version === versionCarga) {
          contenedor.replaceChildren(imagen);
        }
      });

      imagen.addEventListener("error", () => {
        if (version === versionCarga) {
          contenedor.replaceChildren(
            texto("span", "foto-vacia", "Foto no disponible"),
          );
        }
      });

      imagen.src = url;
    } catch {
      if (version === versionCarga) {
        contenedor.replaceChildren(
          texto("span", "foto-vacia", "Foto no disponible"),
        );
      }
    }
  }

  function observarFotos() {
    observadorFotos?.disconnect();

    const version = versionCarga;

    const pendientes = [
      ...catalogo.querySelectorAll("[data-foto-path]"),
      ...lista.querySelectorAll("[data-foto-path]"),
    ];

    if (!("IntersectionObserver" in window)) {
      pendientes.forEach((foto) => cargarFoto(foto, version));
      return;
    }

    observadorFotos = new IntersectionObserver(
      (entradas) => {
        entradas.forEach((entrada) => {
          if (!entrada.isIntersecting) return;

          observadorFotos.unobserve(entrada.target);
          cargarFoto(entrada.target, version);
        });
      },
      { rootMargin: "300px 0px", threshold: 0.01 },
    );

    pendientes.forEach((foto) => observadorFotos.observe(foto));
  }
  function crearTarjetaInicio(producto) {
    const articulo = document.createElement("article");
    articulo.className = "producto";
    articulo.dataset.productoId = producto.id;
    articulo.setAttribute("role", "button");
    articulo.tabIndex = 0;

    articulo.setAttribute("aria-label", `Añadir ${producto.nombre} al pedido`);

    function seleccionarProducto() {
      document.dispatchEvent(
        new CustomEvent("paypos:seleccionar-producto", {
          detail: {
            id: producto.id,
            nombre: producto.nombre,
            precio: producto.precio,
            foto_path: producto.foto_path || "",
          },
        }),
      );
    }


    articulo.addEventListener("click", seleccionarProducto);

    articulo.addEventListener("keydown", (evento) => {
      if (
        evento.target === articulo &&
        !evento.repeat &&
        (evento.key === "Enter" || evento.key === " ")
      ) {
        evento.preventDefault();
        seleccionarProducto();
      }
    });
    const marco = document.createElement("div");
    marco.className = "producto-marco";

    const escena = document.createElement("div");
    escena.className = "producto-escena";

    const cabecera = document.createElement("div");
    cabecera.className = "producto-cabecera-card";

    const textos = document.createElement("div");
    textos.className = "producto-textos-card";

    textos.append(
      texto("h2", "producto-titulo-card", producto.nombre),
      texto(
        "p",
        "producto-subtitulo-card",
        producto.categoria || "Disponible ahora",
      ),
    );

    const logoWrap = document.createElement("div");
    logoWrap.className = "producto-logo-wrap";

    const logo = document.createElement("div");
    logo.className = "producto-logo-marca";

    const imagenLogo = document.createElement("img");
    imagenLogo.src = "pa.png";
    imagenLogo.alt = "Logo";
    imagenLogo.decoding = "async";

    logo.append(imagenLogo);

    logoWrap.append(logo);
    cabecera.append(logoWrap);

    const precioBadge = texto(
      "div",
      "producto-precio-badge",
      precio(producto.precio),
    );

    const foto = crearFoto(producto, "producto-foto producto-foto-card");

    const puntos = document.createElement("div");
    puntos.className = "producto-puntos";
    puntos.innerHTML = `
  <span class="activo"></span>
  <span></span>
  <span></span>
  <span></span>
`;

    escena.append(cabecera, precioBadge, foto, puntos);

    escena.append(textos);
    marco.append(escena);
    articulo.append(marco);

    return articulo;
  }
  function dibujarVitrina() {
    const busqueda = normalizar(buscadorInicio.value);

    const resultados = productos.filter((producto) => {
      const nombre = normalizar(producto.nombre || "");
      const categoria = normalizar(producto.categoria || "");

      return nombre.includes(busqueda) || categoria.includes(busqueda);
    });

    const fragmento = document.createDocumentFragment();

    resultados.forEach((producto) => {
      const firma = firmaProducto(producto);
      const existente = tarjetasInicio.get(producto.id);

      if (existente?.firma === firma) {
        fragmento.append(existente.elemento);
        return;
      }

      const elemento = crearTarjetaInicio(producto);
      tarjetasInicio.set(producto.id, { firma, elemento });
      fragmento.append(elemento);
    });

    if (busqueda && !resultados.length) {
      const mensaje = document.createElement("p");
      mensaje.textContent = "No se encontraron productos.";
      mensaje.setAttribute("role", "status");
      mensaje.style.gridColumn = "1 / -1";
      fragmento.append(mensaje);
    }

    catalogo.replaceChildren(fragmento);

    estadoCatalogo.textContent = `${resultados.length} producto${
      resultados.length === 1 ? "" : "s"
    } disponibles`;

    observarFotos();
  }

  function firmaProducto(producto) {
    return [
      producto.id,
      producto.nombre,
      producto.precio,
      producto.categoria,
      producto.foto_path || "",
    ].join("\u0001");
  }

  function dibujarLista() {
    const busqueda = normalizar(buscador.value);
    const categoria = filtro.value;

    const resultados = productos.filter((producto) => {
      const coincideNombre = normalizar(producto.nombre).includes(busqueda);

      const coincideCategoria = !categoria || producto.categoria === categoria;

      return coincideNombre && coincideCategoria;
    });

    const fragmento = document.createDocumentFragment();

    resultados.forEach((producto) => {
      const firma = firmaProducto(producto);
      const existente = filasProductos.get(producto.id);

      if (existente?.firma === firma) {
        fragmento.append(existente.elemento);
        return;
      }

      const fila = document.createElement("article");
      fila.className = "fila-producto";
      fila.dataset.productoId = producto.id;

      const informacion = document.createElement("div");
      informacion.className = "fila-producto-info";

      informacion.append(
        texto("h3", "", producto.nombre),
        texto("p", "", producto.categoria),
      );

      const editar = document.createElement("button");
      editar.type = "button";
      editar.className = "boton-editar";
      editar.textContent = "Editar";
      editar.dataset.productoId = producto.id;

      editar.addEventListener("click", () => {
        document.dispatchEvent(
          new CustomEvent("paypos:editar-producto", {
            detail: { ...producto },
          }),
        );
      });

      fila.append(
        crearFoto(producto, "fila-producto-foto"),
        informacion,
        texto("span", "fila-producto-precio", precio(producto.precio)),
        editar,
      );

      filasProductos.set(producto.id, { firma, elemento: fila });
      fragmento.append(fila);
    });

    lista.replaceChildren(fragmento);

    contador.textContent = `${resultados.length} de ${productos.length}`;

    estadoLista.textContent = resultados.length
      ? ""
      : productos.length
        ? "No hay productos que coincidan con tu búsqueda."
        : "Tu catálogo está vacío. Pulsa Añadir producto.";

    observarFotos();
  }

  async function actualizarProductos() {
    const permisos = window.payposAcceso;

    if (!db || !permisos) {
      limpiarCatalogo();
      return;
    }

    const usuarioId = permisos.usuarioId;
    const version = ++versionCarga;

    function cargaVigente() {
      return (
        version === versionCarga && window.payposAcceso?.usuarioId === usuarioId
      );
    }

    observadorFotos?.disconnect();

    estadoCatalogo.textContent = "Actualizando productos…";
    estadoLista.textContent = "Actualizando productos…";

    try {
      const resultado = [];
      const cantidad = 100;

      for (let inicio = 0; ; inicio += cantidad) {
        if (!cargaVigente()) return;

        const { data, error } = await db
          .from("productos")
          .select("id,nombre,precio,categoria,foto_path")
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .range(inicio, inicio + cantidad - 1);

        if (!cargaVigente()) return;

        if (error) throw error;

        if (!Array.isArray(data)) {
          throw new Error("La respuesta del catálogo no es válida.");
        }

        resultado.push(...data);

        if (data.length < cantidad) break;
      }

      if (!cargaVigente()) return;

      productos = resultado;

      const idsActuales = new Set(productos.map((producto) => producto.id));

      for (const id of tarjetasInicio.keys()) {
        if (!idsActuales.has(id)) {
          tarjetasInicio.delete(id);
        }
      }

      for (const id of filasProductos.keys()) {
        if (!idsActuales.has(id)) {
          filasProductos.delete(id);
        }
      }

      // Catálogo disponible para administradores y cajeros.
      dibujarVitrina();

      // Lista de edición disponible para administradores.
      if (window.payposAcceso.esAdministrador) {
        dibujarLista();
      } else {
        filasProductos.clear();
        lista.replaceChildren();
        contador.textContent = "—";
        estadoLista.textContent = "";
      }
    } catch {
      if (!cargaVigente()) return;

      const aviso =
        "No se pudo actualizar el catálogo. " +
        "Revisa tu conexión y vuelve a pulsar Inicio.";

      estadoCatalogo.textContent = aviso;
      estadoLista.textContent = aviso;

      // Conserva el catálogo de esta sesión ante un fallo de red.
      observarFotos();
    }
  }

  function limpiarCatalogo() {
    // Invalida las consultas que todavía estén pendientes.
    versionCarga++;

    observadorFotos?.disconnect();

    productos = [];
    tarjetasInicio.clear();
    filasProductos.clear();

    catalogo.replaceChildren();
    lista.replaceChildren();

    limpiarCacheFotos();

    contador.textContent = "—";
    estadoLista.textContent = "";
    estadoCatalogo.textContent =
      "Inicia sesión desde Productos para ver el catálogo.";
  }

  function sincronizarSesion() {
    // Limpia la vista anterior antes de cargar otra sesión.
    limpiarCatalogo();

    if (window.payposAcceso) {
      void actualizarProductos();
    }
  }

  buscador.addEventListener("input", dibujarLista);
  buscadorInicio.addEventListener("input", dibujarVitrina);
  filtro.addEventListener("change", dibujarLista);

  document.addEventListener(
    "paypos:productos-actualizados",
    actualizarProductos,
  );

  document.querySelectorAll(".icono").forEach((boton) => {
    if (["Inicio", "Productos"].includes(boton.dataset.nombre)) {
      boton.addEventListener("click", actualizarProductos);
    }
  });

  // Sigue la sesión real, independientemente de si
  // las herramientas de administración están ocultas.
  document.addEventListener("paypos:acceso-cambiado", sincronizarSesion);

  sincronizarSesion();
})();
// ===== FOTO CON RECORTE Y TOAST =====
(() => {
  const obtener = (id) => document.getElementById(id);

  const escoger = obtener("escoger-foto");
  const selector = obtener("selector-recorte");
  const archivoProducto = obtener("producto-foto");
  const modal = obtener("modal-recorte");
  const imagen = obtener("imagen-recorte");
  const estado = obtener("estado-recorte");
  const completa = obtener("usar-completa");
  const aplicar = obtener("aplicar-recorte");
  const cerrarModal = obtener("cerrar-recorte");
  const toast = obtener("toast-paypos");

  let recortador = null;
  let original = null;
  let urlTemporal = null;
  let version = 0;
  let procesando = false;
  let temporizadorToast = null;

  window.payposToast = (texto) => {
    clearTimeout(temporizadorToast);

    toast.textContent = texto;
    toast.classList.add("visible");

    temporizadorToast = setTimeout(() => {
      toast.classList.remove("visible");
    }, 3500);
  };

  function informar(texto) {
    estado.textContent = texto;
  }

  function limpiarRecorte() {
    version++;
    recortador?.destroy();
    recortador = null;

    imagen.onload = null;
    imagen.onerror = null;
    imagen.removeAttribute("src");

    if (urlTemporal) {
      URL.revokeObjectURL(urlTemporal);
      urlTemporal = null;
    }

    original = null;
    procesando = false;
    selector.value = "";
  }

  escoger.addEventListener("click", () => {
    if (archivoProducto.disabled) return;

    selector.value = "";
    selector.click();
  });

  selector.addEventListener("change", () => {
    const archivo = selector.files[0];
    if (!archivo) return;

    const tipos = ["image/jpeg", "image/png", "image/webp"];

    if (!tipos.includes(archivo.type)) {
      window.payposToast("Selecciona una imagen JPG, PNG o WebP.");
      return;
    }

    if (archivo.size > 3 * 1024 * 1024) {
      window.payposToast("La imagen debe pesar como máximo 3 MB.");
      return;
    }

    limpiarRecorte();

    original = archivo;
    const versionActual = version;

    completa.disabled = true;
    aplicar.disabled = true;
    informar("Cargando imagen…");

    modal.showModal();

    imagen.onerror = () => {
      if (versionActual !== version) return;
      informar("No se pudo leer esta imagen. Cierra y selecciona otra.");
    };

    imagen.onload = () => {
      if (versionActual !== version || !modal.open) return;

      completa.disabled = false;

      if (typeof window.Cropper !== "function") {
        informar("No se cargó el recortador. Puedes usar la imagen completa.");
        return;
      }

      try {
        recortador = new window.Cropper(imagen, {
          viewMode: 1,
          dragMode: "move",
          aspectRatio: NaN,
          autoCropArea: 0.85,
          background: true,
          responsive: true,
          guides: true,
          movable: true,
          zoomable: true,
          cropBoxMovable: true,
          cropBoxResizable: true,
          toggleDragModeOnDblclick: false,

          ready() {
            if (versionActual !== version) return;

            aplicar.disabled = false;
            informar("Ajusta las esquinas o usa la imagen completa.");
          },
        });
      } catch {
        informar(
          "No se pudo abrir el recortador. Puedes usar la imagen completa.",
        );
      }
    };

    urlTemporal = URL.createObjectURL(archivo);
    imagen.src = urlTemporal;
  });

  function colocarArchivo(archivo) {
    if (archivo.size > 3 * 1024 * 1024) {
      throw new Error(
        "El recorte supera 3 MB. Selecciona un área más pequeña.",
      );
    }

    const transferencia = new DataTransfer();
    transferencia.items.add(archivo);
    archivoProducto.files = transferencia.files;

    archivoProducto.dispatchEvent(new Event("change", { bubbles: true }));

    modal.close();
  }

  completa.addEventListener("click", () => {
    if (!original || procesando) return;

    try {
      colocarArchivo(original);
    } catch (error) {
      informar(error.message || "No se pudo seleccionar la imagen.");
    }
  });

  aplicar.addEventListener("click", async () => {
    if (!recortador || procesando) return;

    procesando = true;
    completa.disabled = true;
    aplicar.disabled = true;

    const versionActual = version;

    informar("Preparando recorte…");

    try {
      const canvas = recortador.getCroppedCanvas({
        maxWidth: 1200,
        maxHeight: 1200,
        imageSmoothingEnabled: true,
        imageSmoothingQuality: "high",
      });

      if (!canvas || !canvas.width || !canvas.height) {
        throw new Error("Selecciona un área válida para recortar.");
      }

      // PNG conserva la transparencia de la imagen.
      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob((resultado) => {
          if (resultado) resolve(resultado);
          else reject(new Error("No se pudo generar el recorte."));
        }, "image/png");
      });

      // Si se canceló mientras procesaba, no cambia la foto.
      if (versionActual !== version || !modal.open) return;

      const archivo = new File([blob], "producto-recortado.png", {
        type: "image/png",
      });

      colocarArchivo(archivo);
    } catch (error) {
      if (versionActual === version) {
        informar(error.message || "No se pudo recortar la imagen.");
      }
    } finally {
      if (versionActual === version) {
        procesando = false;
        completa.disabled = false;
        aplicar.disabled = !recortador;
      }
    }
  });

  cerrarModal.addEventListener("click", () => modal.close());

  modal.addEventListener("close", () => {
    limpiarRecorte();
    escoger.focus({ preventScroll: true });
  });

  // Mantiene el cuadrado con un texto corto aunque el formulario
  // actual cambie el mensaje de foto al añadir o editar.
  const placeholder = obtener("foto-placeholder");

  function textoCompacto() {
    if (placeholder.textContent.trim() === "Subir foto") return;
    placeholder.textContent = "Subir foto";
  }

  const observarTexto = new MutationObserver(textoCompacto);

  observarTexto.observe(placeholder, {
    childList: true,
    subtree: true,
    characterData: true,
  });
})();
// ===== PEDIDO LOCAL EN EL PANEL IZQUIERDO =====
(() => {
  const panel = document.getElementById("panel-pedido");
  const lista = document.getElementById("pedido-lista");
  const contador = document.getElementById("pedido-contador");
  const total = document.getElementById("pedido-total");
  const vaciar = document.getElementById("vaciar-pedido");
  const cobrar = document.getElementById("cobrar-pedido");
  const cobrarPedidoTotal = document.getElementById("cobrar-pedido-total");

  const pantallaCobro = document.getElementById("pantalla-cobro");

  const cerrarCobro = document.getElementById("cerrar-cobro");

  const confirmarCobro = document.getElementById("confirmar-cobro");

  const cobroEstado = document.getElementById("cobro-estado");

  const cobroTotal = document.getElementById("cobro-total");

  const cobroQrTotal = document.getElementById("cobro-qr-total");

  const cobroEfectivoTotal = document.getElementById("cobro-efectivo-total");

  const cobroTarjetaTotal = document.getElementById("cobro-tarjeta-total");

  const efectivoRecibido = document.getElementById("cobro-efectivo-recibido");

  const efectivoCambio = document.getElementById("cobro-cambio");

  const botonesMetodo = [...document.querySelectorAll(".cobro-metodo")];

  const vistasPago = [...document.querySelectorAll("[data-vista-pago]")];

  const mixtoMetodos = [...document.querySelectorAll("[data-mixto-metodo]")];

  const mixtoMontos = [...document.querySelectorAll("[data-mixto-monto]")];

  const mixtoTotal = document.getElementById("mixto-total");

  const mixtoDistribuido = document.getElementById("mixto-distribuido");

  const mixtoRestante = document.getElementById("mixto-restante");

  const mixtoEfectivoBloque = document.getElementById("mixto-efectivo-bloque");

  const mixtoEfectivoRecibido = document.getElementById(
    "mixto-efectivo-recibido",
  );

  const mixtoCambio = document.getElementById("mixto-cambio");
  /* =========================================================
     MIXTO · AÑADIR MÉTODOS MANUALMENTE
  ========================================================= */

  const mixtoLineas = [...document.querySelectorAll(".mixto-linea")];

  const mixtoContenedor = document.querySelector(".mixto-contenedor");

  const botonAgregarMixto = document.createElement("button");

  botonAgregarMixto.type = "button";
  botonAgregarMixto.className = "mixto-agregar";
  botonAgregarMixto.textContent = "+";

  /*
    Añadimos una opción vacía a cada selector.
    Así ya no aparece QR / Efectivo / Tarjeta
    seleccionado automáticamente.
  */
  mixtoMetodos.forEach((selector) => {
    if (!selector.querySelector('option[value=""]')) {
      const opcion = document.createElement("option");

      opcion.value = "";
      opcion.textContent = "Selecciona método";

      opcion.disabled = true;

      selector.prepend(opcion);
    }

    selector.value = "";
  });

  /*
    Los importes comienzan VACÍOS.
    Nada de 0 escrito.
  */
  mixtoMontos.forEach((input) => {
    input.value = "";
    input.placeholder = "Monto";
  });

  /*
    Al principio no mostramos ninguna línea.
  */
  mixtoLineas.forEach((linea) => {
    linea.hidden = true;
  });

  /*
    Ponemos el botón antes del bloque Cambio.
  */
  mixtoContenedor.insertBefore(botonAgregarMixto, mixtoEfectivoBloque);

  function actualizarBotonAgregarMixto() {
    botonAgregarMixto.hidden = !mixtoLineas.some((linea) => linea.hidden);
  }

  botonAgregarMixto.addEventListener("click", () => {
    const linea = mixtoLineas.find((item) => item.hidden);

    if (!linea) return;

    linea.hidden = false;

    const selector = linea.querySelector("[data-mixto-metodo]");

    const input = linea.querySelector("[data-mixto-monto]");

    selector.value = "";
    input.value = "";
    input.placeholder = "Monto";

    selector.focus({
      preventScroll: true,
    });

    actualizarBotonAgregarMixto();
    actualizarEstadoCobro();
  });

  let metodoCobro = "qr";
  let cobroProcesando = false;

  let ventaIdCobro = null;
  let firmaVentaCobro = null;

  let cierreCobroTemporizador = null;
  const anuncio = document.getElementById("pedido-anuncio");

  const inicio = document.getElementById("pagina-inicio");
  const gestion = document.getElementById("gestion-autorizada");

  const pedido = new Map();
  const filasPedido = new Map();
  let descuentoPedido = { tipo: "bs", valor: 0 };
  let notaPedido = "";
  let modoAjuste = "descuento";

  const modalAjuste = document.getElementById("modal-ajuste-pedido");
  let ajusteViewportFrame = 0;

  function adaptarModalAlTeclado() {
    cancelAnimationFrame(ajusteViewportFrame);

    ajusteViewportFrame = requestAnimationFrame(() => {
      if (
        !modalAjuste.open ||
        !window.matchMedia("(max-width: 700px)").matches
      ) {
        return;
      }

      const viewport = window.visualViewport;
      const altoVisible = viewport?.height ?? window.innerHeight;
      const inicioVisible = viewport?.offsetTop ?? 0;
      const margen = 12;

      modalAjuste.style.setProperty(
        "--ajuste-alto",
        Math.max(1, altoVisible - margen * 2) + "px",
      );

      const altoModal = modalAjuste.offsetHeight;
      const arriba =
        inicioVisible + Math.max(margen, (altoVisible - altoModal) / 2);

      modalAjuste.style.setProperty("--ajuste-top", arriba + "px");
    });
  }

  window.visualViewport?.addEventListener("resize", adaptarModalAlTeclado);

  window.visualViewport?.addEventListener("scroll", adaptarModalAlTeclado);

  window.addEventListener("resize", adaptarModalAlTeclado);

  new MutationObserver(adaptarModalAlTeclado).observe(modalAjuste, {
    attributes: true,
    attributeFilter: ["open"],
  });
  const formAjuste = document.getElementById("form-ajuste-pedido");
  const abrirDescuento = document.getElementById("abrir-descuento");
  const abrirNota = document.getElementById("abrir-nota");
  const valorDescuento = document.getElementById("valor-descuento");
  const textoNota = document.getElementById("texto-nota");
  const errorAjuste = document.getElementById("ajuste-error");
  const quitarAjuste = document.getElementById("quitar-ajuste");
  const camposDescuento = document.getElementById("campos-descuento");
  // =====================================================
  // SELECTOR DESLIZANTE Bs / %
  // =====================================================

  const selectorTipoDescuento = document.getElementById(
    "selector-tipo-descuento",
  );

  const piezaTipoDescuento = selectorTipoDescuento.querySelector(
    ".ajuste-tipos-pieza",
  );

  const radiosTipoDescuento = [
    ...formAjuste.querySelectorAll('input[name="tipo-descuento"]'),
  ];

  let arrastrandoTipoDescuento = false;

  let punteroTipoDescuento = null;

  let inicioXTipoDescuento = 0;

  let inicioPosicionTipoDescuento = 0;

  let posicionTipoDescuento = 0;

  let movioTipoDescuento = false;

  /* Cuánto puede viajar horizontalmente la pieza */
  function recorridoSelectorDescuento() {
    return piezaTipoDescuento.offsetWidth;
  }

  /* Devuelve el radio actualmente seleccionado */
  function obtenerTipoDescuentoSeleccionado() {
    return radiosTipoDescuento.find((radio) => radio.checked)?.value || "bs";
  }

  /* Sincroniza visualmente la pieza con el radio */
  function sincronizarSelectorDescuento(animar = true) {
    const porcentaje = obtenerTipoDescuentoSeleccionado() === "porcentaje";

    if (!animar) {
      selectorTipoDescuento.classList.add("sin-transicion");
    }

    selectorTipoDescuento.classList.toggle("es-porcentaje", porcentaje);

    piezaTipoDescuento.style.removeProperty("transform");

    if (!animar) {
      requestAnimationFrame(() => {
        selectorTipoDescuento.classList.remove("sin-transicion");
      });
    }
  }

  /* Selecciona Bs o % y actualiza el descuento */
  function seleccionarTipoDescuento(tipo) {
    const radio = radiosTipoDescuento.find((item) => item.value === tipo);

    if (!radio || radio.disabled) return;

    radio.checked = true;

    selectorTipoDescuento.classList.toggle(
      "es-porcentaje",
      tipo === "porcentaje",
    );

    actualizarLimiteDescuento();
  }

  /* ==========================================
     EMPEZAR A ARRASTRAR
  ========================================== */

  selectorTipoDescuento.addEventListener("pointerdown", (evento) => {
    if (radiosTipoDescuento.every((radio) => radio.disabled)) {
      return;
    }

    /*
        Solo botón izquierdo en mouse.
        En touch/pen no existe ese problema.
      */
    if (evento.pointerType === "mouse" && evento.button !== 0) {
      return;
    }

    const recorrido = recorridoSelectorDescuento();

    const tipoActual = obtenerTipoDescuentoSeleccionado();

    inicioPosicionTipoDescuento = tipoActual === "porcentaje" ? recorrido : 0;

    posicionTipoDescuento = inicioPosicionTipoDescuento;

    inicioXTipoDescuento = evento.clientX;

    movioTipoDescuento = false;

    arrastrandoTipoDescuento = true;

    punteroTipoDescuento = evento.pointerId;

    selectorTipoDescuento.classList.add("arrastrando");

    piezaTipoDescuento.style.transform = `translateX(${inicioPosicionTipoDescuento}px)`;

    selectorTipoDescuento.setPointerCapture(evento.pointerId);
  });

  /* ==========================================
     SEGUIR EL DEDO / MOUSE
  ========================================== */

  selectorTipoDescuento.addEventListener("pointermove", (evento) => {
    if (
      !arrastrandoTipoDescuento ||
      evento.pointerId !== punteroTipoDescuento
    ) {
      return;
    }

    const recorrido = recorridoSelectorDescuento();

    const desplazamiento = evento.clientX - inicioXTipoDescuento;

    if (Math.abs(desplazamiento) > 3) {
      movioTipoDescuento = true;
    }

    posicionTipoDescuento = Math.min(
      recorrido,
      Math.max(0, inicioPosicionTipoDescuento + desplazamiento),
    );

    piezaTipoDescuento.style.transform = `translateX(${posicionTipoDescuento}px)`;
  });

  /* ==========================================
     SOLTAR Y ACOMODAR AL MÁS CERCANO
  ========================================== */

  function terminarArrastreTipoDescuento(evento) {
    if (
      !arrastrandoTipoDescuento ||
      evento.pointerId !== punteroTipoDescuento
    ) {
      return;
    }

    const recorrido = recorridoSelectorDescuento();

    const rectangulo = selectorTipoDescuento.getBoundingClientRect();

    let tipoFinal;

    /*
      Si solamente tocó/clickeó:
      usamos el lado que pulsó.
    */
    if (!movioTipoDescuento) {
      const mitad = rectangulo.left + rectangulo.width / 2;

      tipoFinal = evento.clientX >= mitad ? "porcentaje" : "bs";
    } else {
      /*
      Si sí arrastró:
      elegimos la posición más cercana.
    */
      tipoFinal = posicionTipoDescuento >= recorrido / 2 ? "porcentaje" : "bs";
    }

    const radioFinal = radiosTipoDescuento.find(
      (radio) => radio.value === tipoFinal,
    );

    if (radioFinal) {
      radioFinal.checked = true;
    }

    /*
      Primero dejamos definida
      la posición final.
    */
    selectorTipoDescuento.classList.toggle(
      "es-porcentaje",
      tipoFinal === "porcentaje",
    );

    selectorTipoDescuento.classList.remove("arrastrando");

    /*
      Quitamos la posición manual.
      El CSS realiza el pequeño movimiento
      final hacia Bs o %.
    */
    requestAnimationFrame(() => {
      piezaTipoDescuento.style.removeProperty("transform");
    });

    arrastrandoTipoDescuento = false;
    punteroTipoDescuento = null;

    actualizarLimiteDescuento();
  }

  selectorTipoDescuento.addEventListener(
    "pointerup",
    terminarArrastreTipoDescuento,
  );

  selectorTipoDescuento.addEventListener("pointercancel", (evento) => {
    if (evento.pointerId !== punteroTipoDescuento) {
      return;
    }

    selectorTipoDescuento.classList.remove("arrastrando");

    piezaTipoDescuento.style.removeProperty("transform");

    arrastrandoTipoDescuento = false;
    punteroTipoDescuento = null;

    sincronizarSelectorDescuento();
  });

  /*
    El movimiento de puntero ya gestiona
    los clics del mouse/touch.

    Evitamos que después el label vuelva
    a cambiar el radio por segunda vez.
  */
  selectorTipoDescuento.addEventListener("click", (evento) => {
    if (evento.detail > 0) {
      evento.preventDefault();
    }
  });
  const camposNota = document.getElementById("campos-nota");

  function subtotalPedido() {
    return [...pedido.values()].reduce(
      (suma, producto) => suma + producto.centavos * producto.cantidad,
      0,
    );
  }

  function calcularDescuento(subtotal) {
    const subtotalBs = Math.round(subtotal / 100);

    if (descuentoPedido.tipo === "porcentaje") {
      const descuentoBs = Math.round(
        (subtotalBs * descuentoPedido.valor) / 100,
      );

      return descuentoBs * 100;
    }

    const descuentoBs = Math.min(
      subtotalBs,
      Math.max(0, descuentoPedido.valor),
    );

    return descuentoBs * 100;
  }

  function actualizarResumenPedido(subtotal) {
    if (!pedido.size) {
      descuentoPedido = { tipo: "bs", valor: 0 };
      notaPedido = "";

      if (modalAjuste.open) modalAjuste.close();
    }

    const descuento = calcularDescuento(subtotal);

    total.textContent = monto(subtotal - descuento);
    const totalFinal = subtotal - descuento;

    cobrarPedidoTotal.textContent = monto(totalFinal);

    cobrar.disabled =
      !pedido.size ||
      !window.payposAcceso?.caja ||
      !window.payposTurnoActual?.id ||
      cobroProcesando;
    document.getElementById("pedido-subtotal").textContent = monto(subtotal);

    document.getElementById("pedido-descuento-monto").textContent =
      "− " + monto(descuento);

    document.getElementById("pedido-descuento-etiqueta").textContent =
      descuentoPedido.tipo === "porcentaje"
        ? "Descuento (" + descuentoPedido.valor + "%)"
        : "Descuento";

    document.getElementById("pedido-desglose").hidden = descuento === 0;

    document.getElementById("pedido-nota-indicador").hidden = !notaPedido;

    abrirDescuento.disabled = !pedido.size;
    abrirNota.disabled = !pedido.size;

    abrirDescuento.classList.toggle("activa", descuento > 0);
    abrirNota.classList.toggle("activa", Boolean(notaPedido));
  }

  function actualizarVistaDescuento() {
    const tipo = formAjuste.querySelector(
      'input[name="tipo-descuento"]:checked',
    ).value;

    const subtotal = subtotalPedido();
    const valor = Number(valorDescuento.value);

    const maximo = tipo === "porcentaje" ? 100 : Math.floor(subtotal / 100);

    const valido = Number.isSafeInteger(valor) && valor >= 0 && valor <= maximo;

    const descuento = valido
      ? Math.min(
          subtotal,
          tipo === "porcentaje"
            ? Math.round((subtotal * valor) / 100)
            : valor * 100,
        )
      : 0;

    document.getElementById("ajuste-subtotal").textContent = monto(subtotal);

    document.getElementById("ajuste-descuento-label").textContent =
      tipo === "porcentaje" && valido
        ? "Descuento (" + valor + "%)"
        : "Descuento";

    document.getElementById("ajuste-descuento").textContent = valido
      ? "− " + monto(descuento)
      : "—";

    document.getElementById("ajuste-total").textContent = valido
      ? monto(subtotal - descuento)
      : "—";

    errorAjuste.textContent = valido
      ? ""
      : "Introduce un número entero entre 0 y " + maximo + ".";
  }

  function actualizarLimiteDescuento() {
    const tipo = formAjuste.querySelector(
      'input[name="tipo-descuento"]:checked',
    ).value;

    const esPorcentaje = tipo === "porcentaje";

    valorDescuento.max = String(
      esPorcentaje ? 100 : Math.floor(subtotalPedido() / 100),
    );

    document.getElementById("descuento-label").textContent = esPorcentaje
      ? "Porcentaje de descuento"
      : "Monto de descuento";

    document.getElementById("descuento-unidad").textContent = esPorcentaje
      ? "%"
      : "Bs";

    document.getElementById("descuento-ayuda").textContent = esPorcentaje
      ? "Introduce un porcentaje entero entre 0 y 100."
      : "Máximo disponible: " + monto(subtotalPedido()) + ".";

    actualizarVistaDescuento();
  }

  function abrirAjuste(modo) {
    if (!pedido.size || modalAjuste.open) return;

    modoAjuste = modo;
    const esDescuento = modo === "descuento";

    document.getElementById("ajuste-titulo").textContent = esDescuento
      ? "Descuento del pedido"
      : "Nota del pedido";

    document.getElementById("guardar-ajuste").textContent = esDescuento
      ? "Aplicar"
      : "Guardar";

    camposDescuento.hidden = !esDescuento;
    camposNota.hidden = esDescuento;

    valorDescuento.disabled = !esDescuento;
    valorDescuento.required = esDescuento;
    textoNota.disabled = esDescuento;

    formAjuste
      .querySelectorAll('input[name="tipo-descuento"]')
      .forEach((radio) => {
        radio.disabled = !esDescuento;
        radio.checked = radio.value === descuentoPedido.tipo;
      });

    valorDescuento.value = descuentoPedido.valor || "";
    textoNota.value = notaPedido;

    document.getElementById("nota-caracteres").textContent = String(
      notaPedido.length,
    );

    quitarAjuste.textContent = esDescuento ? "Quitar descuento" : "Quitar nota";

    actualizarLimiteDescuento();

    modalAjuste.showModal();

    if (esDescuento) {
      sincronizarSelectorDescuento(false);
    }

    (esDescuento ? valorDescuento : textoNota).focus();
  }

  abrirDescuento.addEventListener("click", () => {
    abrirAjuste("descuento");
  });

  abrirNota.addEventListener("click", () => {
    abrirAjuste("nota");
  });

  let cerrandoAjuste = false;

  async function cerrarAjusteAnimado() {
    if (!modalAjuste.open || cerrandoAjuste) return;

    cerrandoAjuste = true;

    try {
      const reducirMovimiento = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;

      if (!reducirMovimiento) {
        const animacion = modalAjuste.animate(
          [
            { opacity: 1, transform: "translateX(0)" },
            {
              opacity: 0,
              transform: "translateX(calc(50vw + 50%))",
            },
          ],
          {
            duration: 380,
            easing: "cubic-bezier(.4, 0, 1, 1)",
          },
        );

        await animacion.finished;
      }
    } catch {
      // Permite cerrar aunque se interrumpa la animación.
    } finally {
      modalAjuste.close();
      cerrandoAjuste = false;
    }
  }

  document
    .getElementById("cerrar-ajuste")
    .addEventListener("click", cerrarAjusteAnimado);
  document
    .getElementById("cancelar-ajuste")
    .addEventListener("click", cerrarAjusteAnimado);

  valorDescuento.addEventListener("input", actualizarVistaDescuento);

  modalAjuste.addEventListener("cancel", (evento) => {
    evento.preventDefault();
    cerrarAjusteAnimado();
  });

  radiosTipoDescuento.forEach((radio) => {
    radio.addEventListener("change", () => {
      sincronizarSelectorDescuento();
      actualizarLimiteDescuento();
    });
  });

  textoNota.addEventListener("input", () => {
    document.getElementById("nota-caracteres").textContent = String(
      textoNota.value.length,
    );
  });

  formAjuste.addEventListener("submit", (evento) => {
    evento.preventDefault();

    if (!pedido.size) {
      modalAjuste.close();
      return;
    }

    if (modoAjuste === "descuento") {
      const tipo = formAjuste.querySelector(
        'input[name="tipo-descuento"]:checked',
      ).value;

      const valor = Number(valorDescuento.value);

      const maximo =
        tipo === "porcentaje" ? 100 : Math.floor(subtotalPedido() / 100);

      if (
        valorDescuento.value.trim() === "" ||
        !Number.isSafeInteger(valor) ||
        valor < 0 ||
        valor > maximo
      ) {
        errorAjuste.textContent =
          "Introduce un número entero entre 0 y " + maximo + ".";
        return;
      }

      descuentoPedido = { tipo, valor };
    } else {
      notaPedido = textoNota.value.trim().slice(0, 180);
    }

    modalAjuste.close();
    dibujarPedido();
    anuncio.textContent = "Cambios del pedido guardados.";
  });

  quitarAjuste.addEventListener("click", () => {
    if (modoAjuste === "descuento") {
      descuentoPedido = { tipo: "bs", valor: 0 };
    } else {
      notaPedido = "";
    }

    modalAjuste.close();
    dibujarPedido();
    anuncio.textContent = "Ajuste eliminado.";
  });
  // Cálculos en centavos para evitar errores con decimales.
  const formato = new Intl.NumberFormat("es-BO", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });

  function monto(centavos) {
    return `Bs ${formato.format(centavos / 100)}`;
  }

  function crearTexto(etiqueta, clase, contenido) {
    const nodo = document.createElement(etiqueta);
    nodo.className = clase;
    nodo.textContent = contenido;
    return nodo;
  }

  function crearFotoPedido(producto) {
    const contenedor = document.createElement("div");
    contenedor.className = "pedido-foto";

    if (!producto.foto_path) {
      contenedor.append(crearTexto("span", "foto-vacia", "Sin foto"));
      return contenedor;
    }

    const urlGuardada = obtenerUrlFotoCacheada(producto.foto_path);
    if (urlGuardada) {
      contenedor.append(crearImagenFoto(urlGuardada, producto.nombre, "high"));
      return contenedor;
    }

    contenedor.append(crearTexto("span", "foto-vacia", "Cargando foto…"));
    cargarFotoPedido(contenedor, producto.foto_path, producto.nombre);
    return contenedor;
  }

  async function cargarFotoPedido(contenedor, ruta, nombre) {
    try {
      const url = await obtenerUrlFoto(ruta);
      if (!contenedor.isConnected) return;

      const imagen = crearImagenFoto("", nombre, "high");
      imagen.addEventListener("error", () => {
        if (contenedor.isConnected) {
          contenedor.replaceChildren(
            crearTexto("span", "foto-vacia", "Foto no disponible"),
          );
        }
      });
      imagen.src = url;
      contenedor.replaceChildren(imagen);
    } catch {
      if (contenedor.isConnected) {
        contenedor.replaceChildren(
          crearTexto("span", "foto-vacia", "Foto no disponible"),
        );
      }
    }
  }

  function crearFilaPedido(producto) {
    const fila = document.createElement("article");
    fila.className = "pedido-item";

    const cantidad = document.createElement("div");
    cantidad.className = "pedido-cantidad";

    const menos = document.createElement("button");
    menos.type = "button";
    menos.textContent = "−";

    const unidades = crearTexto("span", "pedido-unidades", producto.cantidad);

    const mas = document.createElement("button");
    mas.type = "button";
    mas.textContent = "+";

    menos.dataset.control = `menos-${producto.id}`;
    mas.dataset.control = `mas-${producto.id}`;

    menos.addEventListener("click", () => {
      cambiarCantidad(producto.id, -1);
    });

    mas.addEventListener("click", () => {
      cambiarCantidad(producto.id, 1);
    });

    cantidad.append(menos, unidades, mas);

    const informacion = document.createElement("div");
    informacion.className = "pedido-info";

    const nombre = crearTexto("h3", "", producto.nombre);
    informacion.append(nombre);

    const importe = crearTexto(
      "strong",
      "pedido-importe",
      monto(producto.centavos * producto.cantidad),
    );

    fila.append(informacion, cantidad, importe, crearFotoPedido(producto));

    return {
      elemento: fila,
      nombre,
      unidades,
      menos,
      mas,
      importe,
      fotoRuta: producto.foto_path || "",
    };
  }

  function actualizarFilaPedido(fila, producto) {
    fila.nombre.textContent = producto.nombre;
    fila.unidades.textContent = producto.cantidad;
    fila.importe.textContent = monto(producto.centavos * producto.cantidad);
    fila.mas.disabled = producto.cantidad >= 99;
    fila.menos.setAttribute(
      "aria-label",
      `Quitar una unidad de ${producto.nombre}`,
    );
    fila.mas.setAttribute(
      "aria-label",
      `Añadir una unidad de ${producto.nombre}`,
    );
  }

  function dibujarPedido() {
    const fragmento = document.createDocumentFragment();

    let unidades = 0;
    let importe = 0;
    const idsActivos = new Set();

    for (const producto of pedido.values()) {
      unidades += producto.cantidad;
      importe += producto.centavos * producto.cantidad;
      idsActivos.add(producto.id);

      let fila = filasPedido.get(producto.id);
      if (!fila || fila.fotoRuta !== (producto.foto_path || "")) {
        fila = crearFilaPedido(producto);
        filasPedido.set(producto.id, fila);
      }

      actualizarFilaPedido(fila, producto);
      fragmento.append(fila.elemento);
    }

    for (const id of filasPedido.keys()) {
      if (!idsActivos.has(id)) filasPedido.delete(id);
    }

    const controlActivo = lista.contains(document.activeElement)
      ? document.activeElement.dataset.control
      : null;

    lista.replaceChildren(fragmento);

    contador.textContent = unidades;
    actualizarResumenPedido(importe);
    vaciar.disabled = !pedido.size;

    if (controlActivo) {
      const siguiente = [...lista.querySelectorAll("button")].find(
        (boton) => boton.dataset.control === controlActivo && !boton.disabled,
      );

      const alternativa = lista.querySelector("button:not(:disabled)");

      if (siguiente || alternativa) {
        (siguiente || alternativa).focus({ preventScroll: true });
      } else {
        // La última unidad se quitó; enfocar el título.
        const titulo = document.getElementById("titulo-pedido");
        titulo.tabIndex = -1;
        titulo.focus({ preventScroll: true });
      }
    }
  }

  function cambiarCantidad(id, cambio) {
    const producto = pedido.get(id);
    if (!producto) return;

    const cantidad = producto.cantidad + cambio;

    if (cantidad > 99) return;

    if (cantidad <= 0) {
      pedido.delete(id);
      anuncio.textContent = `${producto.nombre} eliminado del pedido.`;
    } else {
      producto.cantidad = cantidad;
      anuncio.textContent = `${producto.nombre}: ${cantidad} unidades.`;
    }

    dibujarPedido();
  }

  document.addEventListener("paypos:seleccionar-producto", (evento) => {
    if (inicio.hidden || inicio.inert) return;

    const producto = evento.detail;
    const precio = Number(producto?.precio);

    if (
      !producto?.id ||
      typeof producto.nombre !== "string" ||
      !Number.isFinite(precio) ||
      precio <= 0 ||
      precio > 999999.99
    ) {
      return;
    }

    const existente = pedido.get(producto.id);

    if (existente) {
      if (existente.cantidad >= 99) {
        anuncio.textContent = "Máximo 99 unidades por producto.";
        return;
      }

      existente.nombre = producto.nombre;
      existente.centavos = Math.round(precio * 100);
      existente.foto_path = producto.foto_path || "";
      existente.cantidad++;
    } else {
      pedido.set(producto.id, {
        id: producto.id,
        nombre: producto.nombre,
        foto_path: producto.foto_path || "",
        centavos: Math.round(precio * 100),
        cantidad: 1,
      });
    }


    dibujarPedido();

    anuncio.textContent =
      `${producto.nombre} añadido. ` +
      `${pedido.get(producto.id).cantidad} unidades.`;

    // Limpiar la búsqueda solo después de agregar el producto al pedido.
    const buscadorInicio = document.getElementById("buscar-inicio");
    if (buscadorInicio) {
      buscadorInicio.value = "";
      buscadorInicio.dispatchEvent(new Event("input", { bubbles: true }));
      buscadorInicio.focus({ preventScroll: true });
    }

  });

  vaciar.addEventListener("click", () => {
    if (pedido.size) {
      pedido.clear();
      dibujarPedido();
      anuncio.textContent = "Pedido vaciado.";
    }
  });

  // El panel pertenece a Inicio.
  function actualizarVisibilidad() {
    panel.hidden = inicio.hidden || inicio.inert;
  }

  new MutationObserver(actualizarVisibilidad).observe(inicio, {
    attributes: true,
    attributeFilter: ["hidden", "inert"],
  });

  // El pedido no se comparte entre sesiones.
  // El pedido pertenece al usuario que inició sesión.
  let usuarioDelPedido = window.payposAcceso?.usuarioId || null;

  document.addEventListener("paypos:acceso-cambiado", () => {
    const siguienteUsuario = window.payposAcceso?.usuarioId || null;

    const cambioUsuario = siguienteUsuario !== usuarioDelPedido;

    if (!siguienteUsuario || cambioUsuario) {
      pedido.clear();
      filasPedido.clear();

      descuentoPedido = { tipo: "bs", valor: 0 };
      notaPedido = "";

      if (modalAjuste.open) {
        modalAjuste.close();
      }

      document.getElementById("form-ajuste-pedido").reset();
      document.getElementById("ajuste-error").textContent = "";
      document.getElementById("nota-caracteres").textContent = "0";

      dibujarPedido();
      anuncio.textContent = "";
    }

    usuarioDelPedido = siguienteUsuario;
  });
  /* =========================================================
     COBRO PAYPOS
  ========================================================= */

  function numeroEntero(valor) {
    const numero = Number(valor);

    return Number.isSafeInteger(numero) ? numero : null;
  }

  function totalPedidoBs() {
    const subtotal = subtotalPedido();
    const descuento = calcularDescuento(subtotal);

    return Math.round((subtotal - descuento) / 100);
  }

  function descuentoParaServidor() {
    if (!descuentoPedido.valor) {
      return {
        tipo: "ninguno",
        valor: 0,
      };
    }

    return {
      tipo: descuentoPedido.tipo,
      valor: descuentoPedido.valor,
    };
  }

  function productosParaServidor() {
    return [...pedido.values()].map((producto) => ({
      producto_id: producto.id,
      cantidad: producto.cantidad,
    }));
  }

  function crearFirmaCobro() {
    return JSON.stringify({
      usuario: window.payposAcceso?.usuarioId || null,

      productos: productosParaServidor().sort((a, b) =>
        String(a.producto_id).localeCompare(String(b.producto_id)),
      ),

      descuento: descuentoParaServidor(),

      nota: notaPedido,

      total: totalPedidoBs(),
    });
  }

  function asegurarVentaId() {
    const firmaActual = crearFirmaCobro();

    if (!ventaIdCobro || firmaVentaCobro !== firmaActual) {
      ventaIdCobro = crypto.randomUUID();
      firmaVentaCobro = firmaActual;
    }

    return ventaIdCobro;
  }

  function textoBs(valor) {
    return (
      "Bs " +
      new Intl.NumberFormat("es-BO", {
        maximumFractionDigits: 0,
      }).format(valor || 0)
    );
  }

  /* =========================================================
     TURNO ABIERTO
  ========================================================= */

  async function obtenerTurnoCobro() {
    const acceso = window.payposAcceso;

    if (!acceso?.usuarioId || !acceso?.caja?.id) {
      throw new Error("Necesitas iniciar sesión en una caja para cobrar.");
    }

    /*
      Si ya tenemos el turno verificado
      por la página Cajas, lo usamos.
    */

    if (
      window.payposTurnoActual?.id &&
      window.payposTurnoActual.caja_id === acceso.caja.id &&
      window.payposTurnoActual.estado === "abierto"
    ) {
      return window.payposTurnoActual;
    }

    /*
      Segunda comprobación directamente
      en Supabase.
    */

    const { data, error } = await db
      .from("pos_turnos")
      .select("id,caja_id,abierto_por,estado,abierto_en")
      .eq("abierto_por", acceso.usuarioId)
      .eq("caja_id", acceso.caja.id)
      .eq("estado", "abierto")
      .order("abierto_en", {
        ascending: false,
      })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(
        error.message || "No se pudo comprobar el turno de caja.",
      );
    }

    if (!data?.id) {
      throw new Error(
        "Tu caja está cerrada. Ve a Cajas y ábrela antes de cobrar.",
      );
    }

    window.payposTurnoActual = data;

    return data;
  }

  /* =========================================================
     ABRIR / CERRAR PANTALLA
  ========================================================= */

  async function abrirPantallaCobro() {
    if (cobroProcesando || !pedido.size) {
      return;
    }

    if (!window.payposAcceso?.caja) {
      window.payposToast?.("Necesitas iniciar sesión como cajero para cobrar.");

      return;
    }

    const totalBs = totalPedidoBs();

    asegurarVentaId();

    metodoCobro = "qr";

    cobroEstado.textContent = "";

    cobroTotal.textContent = textoBs(totalBs);

    cobroQrTotal.textContent = textoBs(totalBs);

    cobroEfectivoTotal.textContent = textoBs(totalBs);

    cobroTarjetaTotal.textContent = textoBs(totalBs);

    mixtoTotal.textContent = textoBs(totalBs);

    efectivoRecibido.value = "";

    mixtoMontos.forEach((input) => {
      input.value = "";
      input.placeholder = "Monto";
    });

    mixtoMetodos.forEach((selector) => {
      selector.value = "";
    });

    mixtoLineas.forEach((linea) => {
      linea.hidden = true;
    });

    botonAgregarMixto.hidden = false;

    mixtoEfectivoRecibido.value = "";

    mixtoEfectivoBloque.hidden = true;

    mixtoCambio.textContent = textoBs(0);

    seleccionarMetodoCobro("qr");

    clearTimeout(cierreCobroTemporizador);

    pantallaCobro.hidden = false;
    pantallaCobro.inert = false;

    document.body.style.overflow = "hidden";

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        pantallaCobro.classList.add("abierta");
      });
    });
  }

  function cerrarPantallaCobro() {
    if (cobroProcesando || pantallaCobro.hidden) {
      return;
    }

    pantallaCobro.classList.remove("abierta");

    pantallaCobro.inert = true;

    document.body.style.removeProperty("overflow");

    cierreCobroTemporizador = setTimeout(() => {
      pantallaCobro.hidden = true;

      pantallaCobro.style.removeProperty("height");

      pantallaCobro.style.removeProperty("top");
    }, 480);
  }

  cobrar.addEventListener("click", abrirPantallaCobro);

  cerrarCobro.addEventListener("click", cerrarPantallaCobro);

  /* =========================================================
     CAMBIAR MÉTODO
  ========================================================= */

  function seleccionarMetodoCobro(metodo) {
    metodoCobro = metodo;

    botonesMetodo.forEach((boton) => {
      const activo = boton.dataset.metodo === metodo;

      boton.classList.toggle("activo", activo);

      boton.setAttribute("aria-pressed", String(activo));
    });

    vistasPago.forEach((vista) => {
      const activa = vista.dataset.vistaPago === metodo;

      vista.hidden = !activa;

      vista.classList.toggle("activa", activa);
    });

    cobroEstado.textContent = "";

    actualizarEstadoCobro();
  }

  botonesMetodo.forEach((boton) => {
    boton.addEventListener("click", () => {
      if (cobroProcesando) return;

      seleccionarMetodoCobro(boton.dataset.metodo);
    });
  });

  function datosMontoExacto(esMixto) {
    if (!esMixto) {
      const monto = totalPedidoBs();

      return {
        input: efectivoRecibido,
        monto,
        visible: true,
        valido: Number.isSafeInteger(monto) && monto > 0,
      };
    }

    const indices = mixtoMetodos
      .map((selector, indice) => (selector.value === "efectivo" ? indice : -1))
      .filter((indice) => indice >= 0);

    const datos = calcularMixto();

    const otrosValidos = mixtoMontos.every((input, indice) => {
      if (mixtoMetodos[indice].value === "efectivo") {
        return true;
      }

      const texto = input.value.trim();

      if (texto === "") return true;

      const monto = Number(texto);
      const metodo = mixtoMetodos[indice].value;

      return (
        (metodo === "qr" || metodo === "tarjeta") &&
        Number.isSafeInteger(monto) &&
        monto >= 0
      );
    });

    return {
      input: indices.length === 1 ? mixtoMontos[indices[0]] : null,

      monto: datos.efectivoNecesario,

      visible: indices.length > 0,

      valido:
        indices.length === 1 &&
        otrosValidos &&
        Number.isSafeInteger(datos.efectivoNecesario) &&
        datos.efectivoNecesario > 0,
    };
  }

  function actualizarMontosExactos() {
    [false, true].forEach((esMixto) => {
      const id = esMixto ? "paypos-exacto-mixto" : "paypos-exacto-efectivo";

      let boton = document.getElementById(id);

      if (!boton) {
        boton = document.createElement("button");
        boton.id = id;
        boton.type = "button";

        boton.style.cssText = `
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-height: 44px;
          margin: 10px 0;
          padding: 10px 20px;
          border: 1px solid var(--cobre, #e6a06f);
          border-radius: 12px;
          background: rgba(230, 160, 111, .12);
          color: var(--cobre-claro, #f4c3a4);
          font: inherit;
          font-weight: 700;
          cursor: pointer;
        `;

        if (!esMixto) {
          const campo = efectivoRecibido.closest(".cobro-input-grande");

          campo.append(boton);

          efectivoRecibido.style.minWidth = "0";
          efectivoRecibido.style.flex = "1 1 0";

          boton.style.margin = "0";
          boton.style.padding = "8px 12px";
          boton.style.flexShrink = "0";
          boton.style.whiteSpace = "nowrap";
        }

        boton.addEventListener("click", () => {
          if (cobroProcesando) return;

          const metodoEsperado = esMixto ? "mixto" : "efectivo";

          if (metodoCobro !== metodoEsperado) return;

          // Calcula nuevamente el importe al presionar.
          const exacto = datosMontoExacto(esMixto);

          if (!exacto.valido || !exacto.input) return;

          exacto.input.value = String(exacto.monto);

          exacto.input.dispatchEvent(new Event("input", { bubbles: true }));
        });
      }

      const exacto = datosMontoExacto(esMixto);

      // En mixto, acompaña a la fila de Efectivo.
      if (esMixto && exacto.input) {
        const fila = exacto.input.closest(".mixto-linea");

        if (fila) {
          if (fila.nextElementSibling !== boton) {
            fila.after(boton);
          }

          boton.style.display = "flex";
          boton.style.width = "fit-content";
          boton.style.margin = "6px 0 14px auto";
          boton.style.padding = "8px 14px";
        }
      }

      boton.hidden = !exacto.visible;
      boton.disabled = cobroProcesando || !exacto.valido;

      const seleccionado =
        exacto.valido &&
        exacto.input &&
        exacto.input.value.trim() !== "" &&
        Number(exacto.input.value) === exacto.monto;

      boton.textContent = exacto.valido
        ? `${seleccionado ? "✓ " : ""}${textoBs(exacto.monto)}`
        : "—";

      boton.setAttribute("aria-pressed", String(Boolean(seleccionado)));

      boton.setAttribute(
        "aria-label",
        exacto.valido
          ? seleccionado
            ? `Monto exacto seleccionado: ${textoBs(exacto.monto)}`
            : `Recibí el efectivo exacto: ${textoBs(exacto.monto)}`
          : "Revisa los métodos y montos del pago",
      );

      boton.style.background = seleccionado
        ? "var(--cobre, #e6a06f)"
        : "rgba(230, 160, 111, .12)";

      boton.style.color = seleccionado
        ? "#21191a"
        : "var(--cobre-claro, #f4c3a4)";

      boton.style.boxShadow = seleccionado
        ? "0 0 0 3px rgba(230, 160, 111, .18)"
        : "none";

      boton.style.transition =
        "background 180ms ease, color 180ms ease, box-shadow 180ms ease";

      boton.style.opacity = boton.disabled ? ".45" : "1";
    });
  }
  /* =========================================================
     EFECTIVO
  ========================================================= */

  function actualizarEfectivo() {
    const totalBs = totalPedidoBs();

    const recibido = numeroEntero(efectivoRecibido.value);

    const cambio = recibido === null ? 0 : Math.max(0, recibido - totalBs);

    efectivoCambio.textContent = textoBs(cambio);

    actualizarEstadoCobro();
  }

  efectivoRecibido.addEventListener("input", actualizarEfectivo);

  /* =========================================================
     MIXTO
  ========================================================= */

  function leerMixto() {
    return mixtoMontos.map((input, indice) => ({
      metodo: mixtoMetodos[indice].value,

      monto: numeroEntero(input.value) ?? 0,
    }));
  }
  function calcularMixto() {
    const totalBs = totalPedidoBs();

    const lineas = leerMixto().map((linea) => ({
      ...linea,
      monto: Math.max(0, linea.monto),
    }));

    /*
      QR y Tarjeta son importes aplicados
      directamente a la venta.
    */
    const noEfectivo = lineas
      .filter((linea) => linea.metodo !== "efectivo")
      .reduce((suma, linea) => suma + linea.monto, 0);

    /*
      El campo Efectivo ahora significa
      cuánto dinero físico entrega el cliente.
    */
    const efectivoRecibido = lineas
      .filter((linea) => linea.metodo === "efectivo")
      .reduce((suma, linea) => suma + linea.monto, 0);

    /*
      Esto es lo que realmente debe aplicarse
      como efectivo a la venta.
    */
    const efectivoNecesario = Math.max(0, totalBs - noEfectivo);

    /*
      Lo que sobra del efectivo es cambio.
    */
    const cambio = Math.max(0, efectivoRecibido - efectivoNecesario);

    return {
      totalBs,
      lineas,
      noEfectivo,
      efectivoRecibido,
      efectivoNecesario,
      cambio,
    };
  }

  function actualizarMixto() {
    const datos = calcularMixto();

    /*
      Cambio:
      lo que entregó en efectivo
      menos lo que realmente faltaba pagar.
    */
    mixtoCambio.textContent = textoBs(datos.cambio);

    const hayEfectivo = datos.lineas.some(
      (linea) => linea.metodo === "efectivo" && linea.monto > 0,
    );

    /*
      Cambio solo aparece cuando
      estamos usando efectivo.
    */
    mixtoEfectivoBloque.hidden = !hayEfectivo;

    actualizarEstadoCobro();
  }

  mixtoMontos.forEach((input) => {
    input.addEventListener("input", actualizarMixto);
  });

  mixtoMetodos.forEach((selector) => {
    selector.addEventListener("change", actualizarMixto);
  });

  mixtoEfectivoRecibido.addEventListener("input", actualizarMixto);

  /* =========================================================
     VALIDAR PAGO ACTUAL
  ========================================================= */

  function validarPagoActual() {
    const totalBs = totalPedidoBs();

    if (totalBs < 0) {
      return {
        valido: false,
        mensaje: "El total no es válido.",
      };
    }

    if (metodoCobro === "qr" || metodoCobro === "tarjeta") {
      return {
        valido: true,
        mensaje: "",
      };
    }

    if (metodoCobro === "efectivo") {
      if (totalBs === 0) {
        return {
          valido: true,
          mensaje: "",
        };
      }

      const recibido = numeroEntero(efectivoRecibido.value);

      if (recibido === null || recibido < totalBs) {
        return {
          valido: false,
          mensaje: "El efectivo recibido debe cubrir el total.",
        };
      }

      return {
        valido: true,
        mensaje: "",
      };
    }

    if (metodoCobro === "mixto") {
      if (totalBs === 0) {
        return {
          valido: true,
          mensaje: "",
        };
      }

      const datos = calcularMixto();

      const lineas = datos.lineas.filter((linea) => linea.monto > 0);

      if (!lineas.length) {
        return {
          valido: false,
          mensaje: "Ingresa los montos del pago.",
        };
      }
      if (lineas.length < 2) {
        return {
          valido: false,
          mensaje: "Añade un segundo método de pago.",
        };
      }
      const metodos = lineas.map((linea) => linea.metodo);

      if (new Set(metodos).size !== metodos.length) {
        return {
          valido: false,
          mensaje: "No repitas un método de pago.",
        };
      }

      if (datos.noEfectivo > totalBs) {
        return {
          valido: false,
          mensaje: "QR y Tarjeta superan el total.",
        };
      }

      const usaEfectivo = lineas.some((linea) => linea.metodo === "efectivo");

      if (datos.efectivoNecesario > 0 && !usaEfectivo) {
        return {
          valido: false,
          mensaje: "Falta completar el pago.",
        };
      }

      if (usaEfectivo && datos.efectivoRecibido < datos.efectivoNecesario) {
        return {
          valido: false,
          mensaje: "El efectivo no alcanza para completar el pago.",
        };
      }

      if (datos.efectivoNecesario === 0 && datos.efectivoRecibido > 0) {
        return {
          valido: false,
          mensaje: "QR y Tarjeta ya cubren el total.",
        };
      }

      return {
        valido: true,
        mensaje: "",
      };
    }

    return {
      valido: false,
      mensaje: "Selecciona un método de pago.",
    };
  }

  function actualizarEstadoCobro() {
    actualizarMontosExactos();
    if (cobroProcesando) {
      confirmarCobro.disabled = true;
      return;
    }

    const validacion = validarPagoActual();

    confirmarCobro.disabled = !validacion.valido;

    cobroEstado.textContent = validacion.mensaje;
  }

  /* =========================================================
     CONSTRUIR PAGOS PARA SUPABASE
  ========================================================= */

  function construirPagos() {
    const totalBs = totalPedidoBs();

    if (totalBs === 0) {
      return [];
    }

    if (metodoCobro === "qr") {
      return [
        {
          metodo: "qr",
          monto_bs: totalBs,
          recibido_bs: null,
        },
      ];
    }

    if (metodoCobro === "tarjeta") {
      return [
        {
          metodo: "tarjeta",
          monto_bs: totalBs,
          recibido_bs: null,
        },
      ];
    }

    if (metodoCobro === "efectivo") {
      return [
        {
          metodo: "efectivo",
          monto_bs: totalBs,

          recibido_bs: numeroEntero(efectivoRecibido.value),
        },
      ];
    }

    const datos = calcularMixto();

    const pagos = [];

    /*
      QR y Tarjeta:
      se guarda exactamente el monto
      escrito por el cajero.
    */
    datos.lineas.forEach((linea) => {
      if (linea.metodo === "efectivo" || linea.monto <= 0) {
        return;
      }

      pagos.push({
        metodo: linea.metodo,
        monto_bs: linea.monto,
        recibido_bs: null,
      });
    });

    /*
      Efectivo:
      monto_bs = lo que corresponde a la venta
      recibido_bs = lo que entregó físicamente
      el cliente.

      PostgreSQL calcula el cambio.
    */
    if (datos.efectivoNecesario > 0) {
      pagos.push({
        metodo: "efectivo",

        monto_bs: datos.efectivoNecesario,

        recibido_bs: datos.efectivoRecibido,
      });
    }

    return pagos;
  }

  /* =========================================================
     PAYPOS · IMPRESIÓN DE COMANDA
  ========================================================= */

  function crearDatosComanda(numeroVenta) {
    const acceso = window.payposAcceso;

    return {
      numeroVenta: numeroVenta || "",
      caja: acceso?.caja?.nombre || `Caja ${acceso?.caja?.numero || ""}`,

      fecha: new Date(),

      nota: notaPedido || "",

      productos: [...pedido.values()].map((producto) => ({
        nombre: producto.nombre,
        cantidad: producto.cantidad,
      })),
    };
  }

  function escaparComanda(texto) {
    return String(texto ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  const pendientesUSB = new Map();
  const prefijoUSB = "paypos-usb-venta:";
  let enviandoUSB = false;
  let ultimoAvisoUSB = "";

  function avisarUSB(texto) {
    if (texto === ultimoAvisoUSB) return;
    ultimoAvisoUSB = texto;
    window.payposToast?.(texto);
    console.warn("PayPOS USB:", texto);
  }

  function imprimirComanda(datos) {
    if (!datos?.productos?.length) return;

    if (!datos.venta_id) {
      throw new Error("Falta el identificador de la venta.");
    }

    const copia = JSON.parse(JSON.stringify(datos));
    pendientesUSB.set(copia.venta_id, copia);

    try {
      localStorage.setItem(
        prefijoUSB + copia.venta_id,
        JSON.stringify(copia)
      );
    } catch {
      avisarUSB(
        "Venta guardada. No cierres esta pagina hasta que salga la comanda."
      );
    }

    void procesarUSB();
  }

  async function consultarUSB(ruta, datos) {
    const respuesta = await fetch(
      "http://127.0.0.1:17891" + ruta,
      {
        method: datos ? "POST" : "GET",
        mode: "cors",
        credentials: "omit",
        cache: "no-store",
        targetAddressSpace: "loopback",
        headers: datos
          ? { "Content-Type": "application/json" }
          : {},
        body: datos ? JSON.stringify(datos) : undefined,
        signal: AbortSignal.timeout(8000),
      }
    );

    const resultado = await respuesta.json();

    if (!respuesta.ok) {
      throw new Error(
        resultado.error || "Error de impresion local."
      );
    }

    return resultado;
  }

  async function procesarUSB() {
    const caja = Number(window.payposAcceso?.caja?.numero);

    if (enviandoUSB || ![1, 3, 4].includes(caja)) return;

    enviandoUSB = true;

    try {
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const clave = localStorage.key(i);

          if (!clave?.startsWith(prefijoUSB)) continue;

          const datos = JSON.parse(localStorage.getItem(clave));
          pendientesUSB.set(datos.venta_id, datos);
        }
      } catch {
        avisarUSB(
          "No se pudieron recuperar todas las comandas pendientes del navegador."
        );
      }

      const trabajos = [...pendientesUSB.values()].filter(
        datos => Number(datos.caja_numero) === caja
      );

      if (!trabajos.length) return;

      const estado = await consultarUSB("/estado");

      if (estado.caja !== caja) {
        throw new Error(
          "La caja de esta laptop no coincide con tu sesion."
        );
      }

      if (!estado.disponible) {
        throw new Error(
          "Revisa el programa local y la impresora USB."
        );
      }

      for (const datos of trabajos) {
        if (Number(window.payposAcceso?.caja?.numero) !== caja) {
          break;
        }

        const trabajo = await consultarUSB("/trabajos", datos);

        if (trabajo.estado === "enviado") {
          try {
            localStorage.removeItem(prefijoUSB + datos.venta_id);
          } catch {}

          pendientesUSB.delete(datos.venta_id);
          ultimoAvisoUSB = "";
        } else if (["error", "revision"].includes(trabajo.estado)) {
          avisarUSB(
            `Venta ${datos.numero} guardada. Revisa la impresion: ` +
            `${trabajo.error || trabajo.estado}. No vuelvas a cobrarla.`
          );
          break;
        }
      }
    } catch (error) {
      avisarUSB(
        "Venta guardada; comanda pendiente. " +
        (error.message === "Failed to fetch"
          ? "No se pudo conectar con la impresora local."
          : error.message)
      );
    } finally {
      enviandoUSB = false;
    }
  }

  setInterval(() => void procesarUSB(), 5000);
  /* =========================================================
     CONFIRMAR EN SUPABASE
  ========================================================= */

  async function registrarVentaPayPos() {
    if (cobroProcesando) return;

    const validacion = validarPagoActual();

    if (!validacion.valido) {
      cobroEstado.textContent = validacion.mensaje;

      return;
    }

    cobroProcesando = true;

    confirmarCobro.disabled = true;
    cerrarCobro.disabled = true;

    botonesMetodo.forEach((boton) => {
      boton.disabled = true;
    });

    cobroEstado.textContent = "Registrando venta…";

    confirmarCobro.textContent = "Registrando…";

    try {
      if (!db) {
        throw new Error("No hay conexión con Supabase.");
      }

      const acceso = window.payposAcceso;

      if (!acceso?.usuarioId || !acceso?.caja?.id) {
        throw new Error("La sesión de caja ya no está disponible.");
      }

      const turno = await obtenerTurnoCobro();

      const descuento = descuentoParaServidor();

      const ventaId = asegurarVentaId();

      const totalBs = totalPedidoBs();

      const parametros = {
        p_venta_id: ventaId,

        p_turno_id: turno.id,

        p_productos: productosParaServidor(),

        p_pagos: construirPagos(),

        p_descuento_tipo: descuento.tipo,

        p_descuento_valor: descuento.valor,

        p_nota: notaPedido || "",

        p_total_esperado_bs: totalBs,
      };

      const { data, error } = await db.rpc("pos_registrar_venta", parametros);

      if (error) {
        throw error;
      }

      if (!data?.id) {
        throw new Error("Supabase no confirmó la venta.");
      }

      document.dispatchEvent(new Event("paypos:ventas-actualizadas"));

      const numeroVenta = data.numero;

      const datosComanda = crearDatosComanda(numeroVenta);

      datosComanda.caja_numero = acceso.caja.numero;
      datosComanda.venta_id = data.id;

      if (data.creada_en) {
        datosComanda.creada_en = data.creada_en;
      }
      // Son los pagos enviados en la venta confirmada.
      datosComanda.pagos = parametros.p_pagos.map((pago) => ({
        ...pago,
      }));
      /*
        IMPORTANTE:
        recién aquí se limpia el pedido.
        La venta YA está guardada.
      */

      pedido.clear();
      filasPedido.clear();

      descuentoPedido = {
        tipo: "bs",
        valor: 0,
      };

      notaPedido = "";

      ventaIdCobro = null;
      firmaVentaCobro = null;

      dibujarPedido();

      cobroEstado.textContent = numeroVenta
        ? `Venta ${numeroVenta} registrada correctamente.`
        : "Venta registrada correctamente.";

      window.payposToast?.(
        numeroVenta
          ? `Venta ${numeroVenta} registrada correctamente.`
          : "Venta registrada correctamente.",
      );

      try {
        const numeroCajaImpresion = Number(datosComanda.caja_numero);

        if (numeroCajaImpresion === 2) {
          window.payposToast?.(
            "Venta guardada. Comanda enviada a la cola de impresión."
          );
        } else {
          imprimirComanda(datosComanda);
        }
      } catch (error) {
        console.error(
          "PayPos: venta registrada, pero no se pudo preparar la comanda.",
          error
        );

        window.payposToast?.(
          "Venta registrada. Error de impresión: " +
          (error?.message || "Error desconocido")
        );
      }
      setTimeout(() => {
        cobroProcesando = false;

        cerrarCobro.disabled = false;

        botonesMetodo.forEach((boton) => {
          boton.disabled = false;
        });

        confirmarCobro.textContent = "Confirmar cobro";

        cerrarPantallaCobro();
      }, 350);
    } catch (error) {
      /*
        NO borramos el pedido.
        Tampoco cambiamos ventaIdCobro.
        Si el usuario reintenta,
        utiliza la MISMA ID.
      */

      console.error("PayPos: error al cobrar.", error);

      cobroEstado.textContent =
        error?.message ||
        "No se pudo registrar la venta. El pedido continúa intacto.";
    } finally {
      if (!pedido.size) {
        return;
      }

      cobroProcesando = false;

      cerrarCobro.disabled = false;

      botonesMetodo.forEach((boton) => {
        boton.disabled = false;
      });

      confirmarCobro.textContent = "Confirmar cobro";

      actualizarEstadoCobro();
    }
  }

  confirmarCobro.addEventListener("click", registrarVentaPayPos);

  /* =========================================================
     ESC
  ========================================================= */

  document.addEventListener("keydown", (evento) => {
    if (evento.key === "Escape" && !pantallaCobro.hidden && !cobroProcesando) {
      cerrarPantallaCobro();
    }
  });

  /* ACTUALIZA EL PEDIDO CUANDO SE ABRE O CIERRA LA CAJA */
  document.addEventListener("paypos:turno-cambiado", () => {
    dibujarPedido();
  });

  dibujarPedido();
  actualizarVisibilidad();
})();
// Mostrar el buscador únicamente en Inicio.
(() => {
  const inicio = document.getElementById("pagina-inicio");
  const buscador = document.querySelector(".buscador-inicio");

  if (!inicio || !buscador) return;

  function actualizarBuscador() {
    buscador.hidden = inicio.hidden || inicio.inert;
  }

  new MutationObserver(actualizarBuscador).observe(inicio, {
    attributes: true,
    attributeFilter: ["hidden", "inert"],
  });

  actualizarBuscador();
})();
/* =========================================================
   PAYPOS · VENTAS
========================================================= */

(() => {
  const pagina = document.getElementById("pagina-ventas");

  const pila = document.getElementById("ventas-pila-cajas");

  const nombreCaja = document.getElementById("ventas-caja-nombre");

  const total = document.getElementById("ventas-total");

  const efectivo = document.getElementById("ventas-efectivo");

  const qr = document.getElementById("ventas-qr");

  const tarjeta = document.getElementById("ventas-tarjeta");

  const lista = document.getElementById("ventas-lista");

  const estado = document.getElementById("ventas-estado");

  const recargar = document.getElementById("ventas-recargar");

  const verTodas = document.getElementById("ventas-ver-todas");

  const hoy = document.getElementById("ventas-hoy");
  const tarjetaPrincipal = pagina.querySelector(".ventas-caja-principal");

  const panelRecientes = pagina.querySelector(".ventas-recientes");
  const botonVentas = document.querySelector('.icono[data-nombre="Ventas"]');

  if (
    !pagina ||
    !pila ||
    !nombreCaja ||
    !total ||
    !efectivo ||
    !qr ||
    !tarjeta ||
    !lista ||
    !estado ||
    !recargar ||
    !verTodas ||
    !hoy ||
    !botonVentas
  ) {
    console.error("PayPos: faltan elementos del panel de Ventas.");

    return;
  }

  let cajaSeleccionada = null;
  let cajaPreferidaRestaurada = false;

  let cajasDisponibles = [];
  let ordenVisualCajas = [];
  const cacheCarrusel = new Map();

  const cargasCarrusel = new Map();
  let revisionCacheCarrusel = 0;
  let temporizadorPrecargaCarrusel = 0;
  let idlePrecargaCarrusel = 0;
  let cargando = false;
  let cambiandoCaja = false;
  let filtroHoy = false;

  let versionConsulta = 0;
  const DURACION_CACHE_VENTAS_MS = 5000;
  let ultimaCargaVentas = {
    clave: "",
    momento: 0,
  };

  const formatoNumero = new Intl.NumberFormat("es-BO", {
    maximumFractionDigits: 0,
  });

  const formatoFechaVenta = new Intl.DateTimeFormat("es-BO", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

  const formatoHoraVenta = new Intl.DateTimeFormat("es-BO", {
    hour: "2-digit",
    minute: "2-digit",
  });

  function numeroBs(valor) {
    const numero = Number(valor || 0);

    return formatoNumero.format(Number.isFinite(numero) ? numero : 0);
  }

  function textoBs(valor) {
    return `Bs ${numeroBs(valor)}`;
  }

  function escaparVentas(valor) {
    return String(valor ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function fechaVenta(valor) {
    const fecha = new Date(valor);

    if (Number.isNaN(fecha.getTime())) {
      return "";
    }

    const dia = formatoFechaVenta.format(fecha);

    const hora = formatoHoraVenta.format(fecha);

    return `${dia} · ${hora}`;
  }

  function obtenerRango() {
    if (!filtroHoy) {
      return {
        desde: null,
        hasta: null,
      };
    }

    const desde = new Date();

    desde.setHours(0, 0, 0, 0);

    const hasta = new Date(desde);

    hasta.setDate(hasta.getDate() + 1);

    return {
      desde: desde.toISOString(),

      hasta: hasta.toISOString(),
    };
  }

  function nombreMetodo(pagos) {
    if (!Array.isArray(pagos) || !pagos.length) {
      return "—";
    }

    const metodos = [
      ...new Set(
        pagos
          .map((pago) =>
            String(pago.metodo || "")
              .trim()
              .toLowerCase(),
          )
          .filter(Boolean),
      ),
    ];

    if (metodos.length > 1) {
      return "Mixto";
    }

    switch (metodos[0]) {
      case "efectivo":
        return "Efectivo";

      case "qr":
        return "QR";

      case "tarjeta":
        return "Tarjeta";

      default:
        return metodos[0] || "—";
    }
  }

  function iconoComanda() {
    return `
      <svg viewBox="0 0 24 24">
        <path
          d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z"
        />
        <path
          d="M9 8h6M9 12h6M9 16h4"
        />
      </svg>
    `;
  }

  function limpiarVista() {
    nombreCaja.textContent = "Caja";

    total.textContent = "0";

    efectivo.textContent = "Bs 0";

    qr.textContent = "Bs 0";

    tarjeta.textContent = "Bs 0";

    lista.replaceChildren();

    pila
      .querySelectorAll(".ventas-caja-atras")
      .forEach((elemento) => elemento.remove());
  }

  function dibujarVentas(ventas) {
    lista.replaceChildren();

    if (!Array.isArray(ventas) || !ventas.length) {
      estado.textContent = filtroHoy
        ? "No hay ventas registradas hoy."
        : "No hay ventas registradas.";

      return;
    }

    estado.textContent = "";

    const fragmento = document.createDocumentFragment();

    ventas.forEach((venta) => {
      const anulada = String(venta.estado || "").toLowerCase() === "anulada";

      const articulo = document.createElement("article");

      articulo.className = "ventas-item" + (anulada ? " anulada" : "");

      articulo.innerHTML = `
          <div class="ventas-item-icono">
            ${iconoComanda()}
          </div>

          <div class="ventas-item-info">

            <strong>
              Venta #${escaparVentas(venta.numero)}
            </strong>

            <span>
              ${escaparVentas(fechaVenta(venta.creada_en))}
            </span>

          </div>

          <div class="ventas-item-metodo">
            ${anulada ? "Anulada" : escaparVentas(nombreMetodo(venta.pagos))}
          </div>

          <div class="ventas-item-total">
            ${
              anulada ? textoBs(venta.total_bs) : `+ ${textoBs(venta.total_bs)}`
            }
          </div>
        `;

      fragmento.appendChild(articulo);
    });

    lista.appendChild(fragmento);
  }

  function dibujarResumen(datos) {
    const resumen = datos?.resumen || {};

    const caja = cajasDisponibles.find(
      (item) => Number(item.numero) === Number(cajaSeleccionada),
    );

    const esGeneral =
      datos.es_administrador === true && cajaSeleccionada == null;

    nombreCaja.textContent = esGeneral
      ? "Total general"
      : caja?.nombre || `Caja ${cajaSeleccionada}`;

    const titulo = document.getElementById("ventas-caja-titulo");

    if (titulo) {
      titulo.textContent = esGeneral
        ? "Ventas de todas las cajas"
        : "Total de caja";
    }

    const selector = document.getElementById("ventas-caja-selector");

    if (selector) {
      selector.disabled = datos.es_administrador !== true;

      selector.setAttribute("aria-pressed", String(esGeneral));

      selector.setAttribute(
        "aria-label",
        esGeneral
          ? "Mostrando el total general"
          : "Ver total general de todas las cajas",
      );

      selector.title = esGeneral
        ? "Selecciona una tarjeta para consultar una caja"
        : "Ver total general";
    }

    total.textContent = numeroBs(resumen.total_bs);

    efectivo.textContent = textoBs(resumen.efectivo_bs);

    qr.textContent = textoBs(resumen.qr_bs);

    tarjeta.textContent = textoBs(resumen.tarjeta_bs);
  }
  function esperarVentas(tiempo) {
    return new Promise((resolver) => setTimeout(resolver, tiempo));
  }

  function prepararOrdenVisualCajas() {
    const numeros = cajasDisponibles
      .map((caja) => Number(caja.numero))
      .filter((numero) => Number.isSafeInteger(numero));

    const ordenValido =
      ordenVisualCajas.length === numeros.length &&
      ordenVisualCajas.every((numero) => numeros.includes(numero));

    if (!ordenValido) {
      ordenVisualCajas = [...numeros].sort((a, b) => b - a);
    }

    const seleccionada = Number(cajaSeleccionada);

    const indice = ordenVisualCajas.indexOf(seleccionada);

    /*
      La seleccionada siempre
      representa la tarjeta del frente.
    */

    if (indice >= 0 && indice !== ordenVisualCajas.length - 1) {
      const ultima = ordenVisualCajas.length - 1;

      [ordenVisualCajas[indice], ordenVisualCajas[ultima]] = [
        ordenVisualCajas[ultima],
        ordenVisualCajas[indice],
      ];
    }
  }

  function intercambiarCajaEnCarrusel(nuevaCaja) {
    prepararOrdenVisualCajas();

    const actual = Number(cajaSeleccionada);

    const indiceNueva = ordenVisualCajas.indexOf(Number(nuevaCaja));

    const indiceActual = ordenVisualCajas.indexOf(actual);

    if (indiceNueva < 0 || indiceActual < 0) {
      return;
    }

    /*
      Es un intercambio físico:

      la caja seleccionada viene adelante
      y la que estaba adelante ocupa
      exactamente su lugar atrás.
    */

    [ordenVisualCajas[indiceNueva], ordenVisualCajas[indiceActual]] = [
      ordenVisualCajas[indiceActual],
      ordenVisualCajas[indiceNueva],
    ];
  }

  function quitarIdsClonVentas(elemento) {
    elemento.removeAttribute("id");

    elemento.querySelectorAll("[id]").forEach((hijo) => {
      hijo.removeAttribute("id");
    });
  }

  function crearClonCajaDestino(datos, numero) {
    const clon = tarjetaPrincipal.cloneNode(true);

    const resumen = datos?.resumen || {};

    const cajas = Array.isArray(datos?.cajas) ? datos.cajas : cajasDisponibles;

    const caja = cajas.find((item) => Number(item.numero) === Number(numero));

    const nombre = clon.querySelector("#ventas-caja-nombre");

    const totalClon = clon.querySelector("#ventas-total");

    const efectivoClon = clon.querySelector("#ventas-efectivo");

    const qrClon = clon.querySelector("#ventas-qr");

    const tarjetaClon = clon.querySelector("#ventas-tarjeta");

    if (nombre) {
      nombre.textContent =
        numero === null ? "Total general" : caja?.nombre || `Caja ${numero}`;
    }

    const tituloClon = clon.querySelector("#ventas-caja-titulo");

    if (tituloClon) {
      tituloClon.textContent =
        numero === null ? "Ventas de todas las cajas" : "Total de caja";
    }

    if (totalClon) {
      totalClon.textContent = numeroBs(resumen.total_bs);
    }

    if (efectivoClon) {
      efectivoClon.textContent = textoBs(resumen.efectivo_bs);
    }

    if (qrClon) {
      qrClon.textContent = textoBs(resumen.qr_bs);
    }

    if (tarjetaClon) {
      tarjetaClon.textContent = textoBs(resumen.tarjeta_bs);
    }

    clon.classList.remove("caja-saliendo", "caja-entrando");

    clon.querySelectorAll("button").forEach((boton) => {
      boton.disabled = true;
    });

    quitarIdsClonVentas(clon);

    return clon;
  }
  function claveCarrusel(numero) {
    return (filtroHoy ? "hoy:" : "todo:") + String(numero);
  }

  async function obtenerDatosCarrusel(numero) {
    const clave = claveCarrusel(numero);

    if (cacheCarrusel.has(clave)) {
      return cacheCarrusel.get(clave);
    }

    if (cargasCarrusel.has(clave)) {
      return cargasCarrusel.get(clave);
    }

    const revision = revisionCacheCarrusel;

    let promesa;

    promesa = consultarVentas(numero)
      .then((datos) => {
        if (revision === revisionCacheCarrusel) {
          cacheCarrusel.set(clave, datos);
        }

        if (cargasCarrusel.get(clave) === promesa) {
          cargasCarrusel.delete(clave);
        }

        return datos;
      })
      .catch((error) => {
        if (cargasCarrusel.get(clave) === promesa) {
          cargasCarrusel.delete(clave);
        }

        throw error;
      });

    cargasCarrusel.set(clave, promesa);

    return promesa;
  }

  function precargarCarrusel() {
    cancelarPrecargaCarrusel();

    if (window.payposAcceso?.esAdministrador !== true) {
      return;
    }

    prepararOrdenVisualCajas();

    const otrasCajas = ordenVisualCajas.filter(
      (numero) => Number(numero) !== Number(cajaSeleccionada),
    );

    const numero = Number(otrasCajas[otrasCajas.length - 1]);

    if (!Number.isSafeInteger(numero) || numero < 1) {
      return;
    }

    const clave = claveCarrusel(numero);

    if (cacheCarrusel.has(clave) || cargasCarrusel.has(clave)) {
      return;
    }

    const iniciarPrecarga = () => {
      idlePrecargaCarrusel = 0;
      temporizadorPrecargaCarrusel = 0;

      if (document.visibilityState === "hidden") {
        return;
      }

      void obtenerDatosCarrusel(numero).catch(() => {});
    };

    if (typeof window.requestIdleCallback === "function") {
      idlePrecargaCarrusel = window.requestIdleCallback(iniciarPrecarga, {
        timeout: 1200,
      });
    } else {
      temporizadorPrecargaCarrusel = window.setTimeout(iniciarPrecarga, 700);
    }
  }

  function cancelarPrecargaCarrusel() {
    if (temporizadorPrecargaCarrusel) {
      clearTimeout(temporizadorPrecargaCarrusel);

      temporizadorPrecargaCarrusel = 0;
    }

    if (
      idlePrecargaCarrusel &&
      typeof window.cancelIdleCallback === "function"
    ) {
      window.cancelIdleCallback(idlePrecargaCarrusel);

      idlePrecargaCarrusel = 0;
    }
  }

  function limpiarCacheCarrusel() {
    revisionCacheCarrusel += 1;

    cancelarPrecargaCarrusel();

    cacheCarrusel.clear();

    cargasCarrusel.clear();
  }

  function clavePreferenciaCajaVentas(acceso) {
    if (acceso?.esAdministrador !== true || !acceso?.usuarioId) {
      return "";
    }

    return `paypos:ventas:caja:${acceso.usuarioId}`;
  }

  function restaurarPreferenciaCajaVentas(acceso) {
    if (acceso?.esAdministrador !== true) {
      cajaPreferidaRestaurada = false;

      const numero = Number(acceso?.caja?.numero);

      if (Number.isSafeInteger(numero) && numero > 0) {
        cajaSeleccionada = numero;
        cajaPreferidaRestaurada = true;
      }

      return;
    }

    cajaPreferidaRestaurada = false;

    const clave = clavePreferenciaCajaVentas(acceso);

    if (!clave) return;

    try {
      const preferencia = JSON.parse(sessionStorage.getItem(clave) || "null");

      const cajas = Array.isArray(preferencia?.cajas)
        ? preferencia.cajas
            .map((caja) => ({
              id: String(caja?.id || ""),
              numero: Number(caja?.numero),
              nombre: String(caja?.nombre || ""),
            }))
            .filter(
              (caja) => Number.isSafeInteger(caja.numero) && caja.numero > 0,
            )
        : [];

      if (cajas.length) {
        cajasDisponibles = cajas;
      }

      const numero = Number(preferencia?.numero);

      if (
        Number.isSafeInteger(numero) &&
        numero > 0 &&
        (!cajas.length || cajas.some((caja) => caja.numero === numero))
      ) {
        cajaSeleccionada = numero;
      }
    } catch {
      // Si el almacenamiento del navegador no está disponible,
      // Ventas vuelve a descubrir las cajas desde Supabase.
    }
  }

  function borrarPreferenciaCajaVentas(acceso) {
    const clave = clavePreferenciaCajaVentas(acceso);

    if (!clave) return;

    try {
      sessionStorage.removeItem(clave);
    } catch {
      // Se ignora: la carga actual seguirá usando el estado en memoria.
    }
  }

  function guardarPreferenciaCajaVentas() {
    const acceso = window.payposAcceso;

    const clave = clavePreferenciaCajaVentas(acceso);

    if (!clave || !Number.isSafeInteger(Number(cajaSeleccionada))) {
      return;
    }

    try {
      sessionStorage.setItem(
        clave,
        JSON.stringify({
          numero: Number(cajaSeleccionada),
          cajas: cajasDisponibles.map((caja) => ({
            id: caja.id || "",
            numero: Number(caja.numero),
            nombre: caja.nombre || "",
          })),
        }),
      );
    } catch {
      // La selección en memoria sigue activa si el navegador bloquea storage.
    }
  }

  function claveVistaVentas() {
    const acceso = window.payposAcceso;

    return [
      acceso?.usuarioId || "sin-usuario",
      filtroHoy ? "hoy" : "todas",
      cajaSeleccionada ?? "todas",
    ].join(":");
  }

  function marcarVentasActualizadas() {
    ultimaCargaVentas = {
      clave: claveVistaVentas(),
      momento: Date.now(),
    };
  }

  /* =========================================================
     CREAR SLIDER REAL
  ========================================================= */

  function crearSliderVertical(datosDestino, numero) {
    const rect = tarjetaPrincipal.getBoundingClientRect();

    const viewport = document.createElement("div");

    viewport.className = "ventas-slider-vertical";

    viewport.style.left = `${rect.left}px`;

    viewport.style.top = `${rect.top}px`;

    viewport.style.width = `${rect.width}px`;

    viewport.style.height = `${rect.height}px`;

    viewport.style.borderRadius =
      getComputedStyle(tarjetaPrincipal).borderRadius;

    /*
      TARJETA QUE ESTÁ ACTUALMENTE
      ADELANTE
    */

    const actual = tarjetaPrincipal.cloneNode(true);

    quitarIdsClonVentas(actual);

    /*
      TARJETA QUE ESTAMOS
      JALANDO
    */

    const entrante = crearClonCajaDestino(datosDestino, numero);

    actual.classList.add("ventas-slider-slide");

    entrante.classList.add("ventas-slider-slide");

    actual.style.transform = "translate3d(0, 0, 0)";

    /*
      La nueva comienza justo
      encima, como un slide vertical.
    */

    entrante.style.transform = `translate3d(
        0,
        ${-rect.height}px,
        0
      )`;

    viewport.append(actual, entrante);

    document.body.append(viewport);

    /*
      Ocultamos la real mientras
      movemos las dos copias completas.
    */

    tarjetaPrincipal.style.visibility = "hidden";

    return {
      viewport,

      actual,

      entrante,

      alto: rect.height,

      desplazamiento: 0,
    };
  }

  function moverSliderVertical(slider, desplazamiento) {
    const valor = Math.max(0, Math.min(slider.alto, desplazamiento));

    slider.desplazamiento = valor;

    /*
      LAS DOS TARJETAS VIAJAN
      JUNTAS HACIA ABAJO.

      Exactamente como un slider
      horizontal, pero vertical.
    */

    slider.actual.style.transform = `translate3d(
        0,
        ${valor}px,
        0
      )`;

    slider.entrante.style.transform = `translate3d(
        0,
        ${-slider.alto + valor}px,
        0
      )`;
  }

  async function animarSliderVertical(slider, destino) {
    const origen = slider.desplazamiento;

    const final = Math.max(0, Math.min(slider.alto, destino));

    const distancia = Math.abs(final - origen);

    const duracion = Math.max(
      170,
      Math.min(360, 170 + (distancia / slider.alto) * 190),
    );

    const actual = slider.actual.animate(
      [
        {
          transform: `translate3d(
                0,
                ${origen}px,
                0
              )`,
        },
        {
          transform: `translate3d(
                0,
                ${final}px,
                0
              )`,
        },
      ],
      {
        duration: duracion,

        easing: "cubic-bezier(.22,.82,.2,1)",

        fill: "forwards",
      },
    );

    const entrante = slider.entrante.animate(
      [
        {
          transform: `translate3d(
                0,
                ${-slider.alto + origen}px,
                0
              )`,
        },
        {
          transform: `translate3d(
                0,
                ${-slider.alto + final}px,
                0
              )`,
        },
      ],
      {
        duration: duracion,

        easing: "cubic-bezier(.22,.82,.2,1)",

        fill: "forwards",
      },
    );

    await Promise.all([actual.finished, entrante.finished]);

    actual.cancel();
    entrante.cancel();

    moverSliderVertical(slider, final);
  }

  function destruirSliderVertical(slider, boton = null) {
    slider?.viewport?.remove();

    tarjetaPrincipal.style.removeProperty("visibility");

    boton?.style.removeProperty("visibility");
  }

  function aplicarCajaCarrusel(numero, datos) {
    intercambiarCajaEnCarrusel(numero);

    cajaSeleccionada = numero;
    cajaPreferidaRestaurada = false;

    cajasDisponibles = Array.isArray(datos?.cajas)
      ? datos.cajas
      : cajasDisponibles;

    cacheCarrusel.set(claveCarrusel(numero), datos);

    dibujarResumen(datos);

    dibujarPila();

    dibujarVentas(datos.ventas);

    guardarPreferenciaCajaVentas();
    marcarVentasActualizadas();
  }
  /* =========================================================
     CAMBIAR CAJA CON ANIMACIÓN
  ========================================================= */
  async function seleccionarCajaAnimada(numero, boton, arrastre = 0) {
    if (cargando || cambiandoCaja) {
      return;
    }

    // null representa el total general.
    if (numero !== null && (!Number.isSafeInteger(numero) || numero < 1)) {
      return;
    }

    if (Number(cajaSeleccionada) === numero) {
      return;
    }

    const acceso = window.payposAcceso;

    if (
      acceso?.esAdministrador !== true &&
      Number(acceso?.caja?.numero) !== numero
    ) {
      return;
    }

    cambiandoCaja = true;

    cancelarPrecargaCarrusel();

    recargar.disabled = true;
    verTodas.disabled = true;
    hoy.disabled = true;

    let slider = null;

    try {
      const datosDestino = await obtenerDatosCarrusel(numero);

      slider = crearSliderVertical(datosDestino, numero);

      if (boton) {
        boton.style.visibility = "hidden";
      }

      moverSliderVertical(slider, Math.max(0, arrastre));

      await animarSliderVertical(slider, slider.alto);

      aplicarCajaCarrusel(numero, datosDestino);

      await new Promise((resolver) => requestAnimationFrame(resolver));
    } catch (error) {
      console.error("PayPos · cambio de caja:", error);

      estado.textContent = error?.message || "No se pudo cambiar de caja.";
    } finally {
      destruirSliderVertical(slider, boton);

      recargar.disabled = false;
      verTodas.disabled = false;
      hoy.disabled = false;

      cambiandoCaja = false;
    }
  }
  /* =========================================================
     ARRASTRAR UNA CAJA HACIA ABAJO
  ========================================================= */

  function prepararArrastreCaja(boton, numero) {
    let activo = false;

    let pointerId = null;

    let inicioY = 0;

    let arrastre = 0;

    let seMovio = false;

    let slider = null;

    let datosDestino = null;

    let finalizando = false;

    async function terminar(confirmar) {
      if (finalizando) {
        return;
      }

      finalizando = true;

      try {
        if (!slider) {
          return;
        }

        if (confirmar) {
          await animarSliderVertical(slider, slider.alto);

          aplicarCajaCarrusel(numero, datosDestino);

          await new Promise((resolver) => requestAnimationFrame(resolver));
        } else {
          await animarSliderVertical(slider, 0);
        }
      } catch (error) {
        console.error("PayPos · carrusel:", error);
      } finally {
        destruirSliderVertical(slider, boton);

        slider = null;

        recargar.disabled = false;
        verTodas.disabled = false;
        hoy.disabled = false;

        cambiandoCaja = false;

        finalizando = false;
      }
    }

    boton.addEventListener("pointerdown", (evento) => {
      if (cargando || cambiandoCaja) {
        return;
      }

      const clave = claveCarrusel(numero);

      if (!cacheCarrusel.has(clave)) {
        void seleccionarCajaAnimada(numero, boton, 0);

        return;
      }

      datosDestino = cacheCarrusel.get(clave);

      cambiandoCaja = true;

      recargar.disabled = true;
      verTodas.disabled = true;
      hoy.disabled = true;

      activo = true;

      pointerId = evento.pointerId;

      inicioY = evento.clientY;

      arrastre = 0;

      seMovio = false;

      slider = crearSliderVertical(datosDestino, numero);

      boton.style.visibility = "hidden";

      boton.setPointerCapture?.(pointerId);
    });

    boton.addEventListener("pointermove", (evento) => {
      if (!activo || evento.pointerId !== pointerId || !slider) {
        return;
      }

      const movimiento = evento.clientY - inicioY;

      arrastre = Math.max(0, Math.min(slider.alto, movimiento));

      if (arrastre > 4) {
        seMovio = true;
      }

      moverSliderVertical(slider, arrastre);
    });

    boton.addEventListener("pointerup", (evento) => {
      if (!activo || evento.pointerId !== pointerId) {
        return;
      }

      activo = false;

      boton.releasePointerCapture?.(pointerId);

      const umbral = Math.min(120, slider ? slider.alto * 0.18 : 120);

      const confirmar = !seMovio || arrastre >= umbral;

      pointerId = null;

      void terminar(confirmar);
    });

    boton.addEventListener("pointercancel", () => {
      if (!activo) {
        return;
      }

      activo = false;

      pointerId = null;

      void terminar(false);
    });

    boton.addEventListener("keydown", (evento) => {
      if (evento.key !== "Enter" && evento.key !== " ") {
        return;
      }

      evento.preventDefault();

      void seleccionarCajaAnimada(numero, boton, 0);
    });
  }

  function dibujarPila() {
    pila
      .querySelectorAll(".ventas-caja-atras")
      .forEach((elemento) => elemento.remove());

    const acceso = window.payposAcceso;

    /*
      CAJERO NORMAL:
      solamente ve su propia caja.
    */

    if (acceso?.esAdministrador !== true) {
      pila.style.setProperty("--pila-offset", "0px");

      pila.style.setProperty("--pila-offset-movil", "0px");

      return;
    }

    /*
      Orden descendente:

      Caja 4  <- más atrás
      Caja 3
      Caja 2  <- más cerca
      Caja 1  <- seleccionada
    */
    prepararOrdenVisualCajas();

    const otrasCajas = ordenVisualCajas

      .filter((numero) => Number(numero) !== Number(cajaSeleccionada))

      .map((numero) =>
        cajasDisponibles.find((caja) => Number(caja.numero) === Number(numero)),
      )

      .filter(Boolean);
    // Cuando vemos una caja, el total general también
    // debe aparecer entre las tarjetas disponibles.
    if (cajaSeleccionada != null) {
      otrasCajas.push({
        numero: null,
        nombre: "Total general",
      });
    }

    const visibles = otrasCajas.slice(0, 4);

    /*
      Reservamos solamente el espacio
      visible de las pestañas.
    */

    pila.style.setProperty("--pila-offset", `${visibles.length * 34}px`);

    pila.style.setProperty("--pila-offset-movil", `${visibles.length * 31}px`);

    visibles.forEach((caja, indice) => {
      const boton = document.createElement("button");

      boton.type = "button";

      boton.className = "ventas-caja-atras";

      /*
          LAPTOP

          índice 0:
          más atrás / más angosta.

          índice 2:
          más cerca / más ancha.
        */

      boton.style.setProperty("--caja-top", `${indice * 34}px`);

      boton.style.setProperty("--caja-lado", `${68 - indice * 22}px`);

      boton.style.setProperty("--caja-z", String(2 + indice));

      /*
          CELULAR
        */

      boton.style.setProperty("--caja-top-movil", `${indice * 31}px`);

      boton.style.setProperty("--caja-lado-movil", `${44 - indice * 14}px`);

      boton.textContent = caja.nombre || `Caja ${caja.numero}`;

      boton.setAttribute(
        "aria-label",
        caja.numero === null
          ? "Ver total general de todas las cajas"
          : `Ver ${caja.nombre || `Caja ${caja.numero}`}`,
      );

      // Todas las tarjetas utilizan el mismo carrusel.
      prepararArrastreCaja(
        boton,
        caja.numero === null ? null : Number(caja.numero),
      );

      /*
          Siempre antes de
          la tarjeta principal.
        */

      const principal = pila.querySelector(".ventas-caja-principal");

      pila.insertBefore(boton, principal);
    });

    precargarCarrusel();
  }

  async function consultarVentas(numeroCaja) {
    const rango = obtenerRango();

    const { data, error } = await db.rpc("pos_panel_ventas", {
      p_caja_numero: numeroCaja,

      p_desde: rango.desde,

      p_hasta: rango.hasta,

      p_limite: 100,
    });

    if (error) {
      throw error;
    }

    if (!data || typeof data !== "object") {
      throw new Error("Supabase no devolvió los datos de Ventas.");
    }

    return data;
  }

  async function cargarVentas({ forzar = false } = {}) {
    if (cargando) {
      return;
    }

    const acceso = window.payposAcceso;

    if (!acceso) {
      limpiarVista();

      estado.textContent = "Inicia sesión para consultar las ventas.";

      return;
    }

    if (!db) {
      estado.textContent = "No hay conexión con Supabase.";

      return;
    }

    if (cajaSeleccionada == null && acceso.esAdministrador !== true) {
      restaurarPreferenciaCajaVentas(acceso);
    }
    const claveActual = claveVistaVentas();

    if (
      !forzar &&
      ultimaCargaVentas.clave === claveActual &&
      Date.now() - ultimaCargaVentas.momento < DURACION_CACHE_VENTAS_MS
    ) {
      return;
    }

    const version = ++versionConsulta;

    cargando = true;

    recargar.disabled = true;

    verTodas.disabled = true;

    hoy.disabled = true;

    estado.textContent =
      ultimaCargaVentas.clave === claveActual
        ? "Actualizando ventas…"
        : "Cargando ventas…";

    try {
      /*
        Admin sin una selección guardada:
        NULL permite recibir la lista de cajas.

        El cajero ya tiene su caja asignada
        y la consulta directamente.
      */

      if (cajaSeleccionada == null) {
        const inicial = await consultarVentas(null);

        if (version !== versionConsulta) {
          return;
        }

        cajasDisponibles = Array.isArray(inicial.cajas) ? inicial.cajas : [];

        if (inicial.es_administrador === true) {
          // null significa consultar todas las cajas.
          cajaSeleccionada = null;
        } else {
          cajaSeleccionada = Number(inicial.caja_propia_numero) || null;
        }

        /*
          Si encontramos caja,
          ahora pedimos específicamente
          los datos de esa caja.
        */

        if (cajaSeleccionada != null) {
          const datosCaja = await consultarVentas(cajaSeleccionada);

          if (version !== versionConsulta) {
            return;
          }

          cajasDisponibles = Array.isArray(datosCaja.cajas)
            ? datosCaja.cajas
            : cajasDisponibles;

          guardarPreferenciaCajaVentas();

          dibujarResumen(datosCaja);

          dibujarPila();

          dibujarVentas(datosCaja.ventas);

          marcarVentasActualizadas();

          return;
        }

        /*
          Por seguridad, si no hay caja,
          mostramos el resultado inicial.
        */

        dibujarResumen(inicial);

        dibujarPila();

        dibujarVentas(inicial.ventas);

        marcarVentasActualizadas();

        return;
      }

      /*
        YA HAY CAJA SELECCIONADA
      */

      const datos = await consultarVentas(cajaSeleccionada);

      if (version !== versionConsulta) {
        return;
      }

      cajaPreferidaRestaurada = false;

      cajasDisponibles = Array.isArray(datos.cajas)
        ? datos.cajas
        : cajasDisponibles;

      guardarPreferenciaCajaVentas();

      dibujarResumen(datos);

      dibujarPila();

      dibujarVentas(datos.ventas);

      marcarVentasActualizadas();
    } catch (error) {
      if (version !== versionConsulta) {
        return;
      }

      if (cajaPreferidaRestaurada && acceso.esAdministrador === true) {
        cajaPreferidaRestaurada = false;
        cajaSeleccionada = null;
        cajasDisponibles = [];
        borrarPreferenciaCajaVentas(acceso);
        ultimaCargaVentas = {
          clave: "",
          momento: 0,
        };

        estado.textContent = "Buscando las cajas disponibles…";

        window.setTimeout(() => {
          if (!pagina.hidden) {
            void cargarVentas({
              forzar: true,
            });
          }
        }, 0);

        return;
      }

      console.error("PayPos · Ventas:", error);

      estado.textContent =
        error?.message || "No se pudieron cargar las ventas.";
    } finally {
      if (version === versionConsulta) {
        cargando = false;

        recargar.disabled = false;

        verTodas.disabled = false;

        hoy.disabled = false;
      }
    }
  }

  function seleccionarCaja(numero) {
    void seleccionarCajaAnimada(Number(numero), null, 0);
  }

  document
    .getElementById("ventas-caja-selector")
    ?.addEventListener("click", () => {
      if (
        window.payposAcceso?.esAdministrador !== true ||
        cargando ||
        cambiandoCaja ||
        cajaSeleccionada == null
      ) {
        return;
      }

      void seleccionarCajaAnimada(null, null, 0);
    });

  recargar.addEventListener("click", () => {
    if (!cargando) {
      limpiarCacheCarrusel();
      void cargarVentas({ forzar: true });
    }
  });

  verTodas.addEventListener("click", () => {
    if (cargando) {
      return;
    }

    filtroHoy = false;

    limpiarCacheCarrusel();

    verTodas.classList.add("activo");

    hoy.classList.remove("activo");

    void cargarVentas({ forzar: true });
  });

  hoy.addEventListener("click", () => {
    if (cargando) {
      return;
    }

    filtroHoy = true;

    limpiarCacheCarrusel();

    hoy.classList.add("activo");

    verTodas.classList.remove("activo");

    void cargarVentas({ forzar: true });
  });

  botonVentas.addEventListener("click", () => {
    /*
        Esperamos a que empiece
        la transición de página.
      */

    setTimeout(() => {
      void cargarVentas();
    }, 20);
  });

  document.addEventListener("paypos:acceso-cambiado", () => {
    ++versionConsulta;

    cargando = false;

    cajaSeleccionada = null;
    cajaPreferidaRestaurada = false;

    cajasDisponibles = [];

    ordenVisualCajas = [];

    limpiarCacheCarrusel();

    ultimaCargaVentas = {
      clave: "",
      momento: 0,
    };

    recargar.disabled = false;
    verTodas.disabled = false;
    hoy.disabled = false;

    limpiarVista();

    estado.textContent = "";
  });

  document.addEventListener("paypos:ventas-actualizadas", () => {
    limpiarCacheCarrusel();

    ultimaCargaVentas = {
      clave: "",
      momento: 0,
    };

    if (cargando) {
      ++versionConsulta;
      cargando = false;
      recargar.disabled = false;
      verTodas.disabled = false;
      hoy.disabled = false;
    }

    if (!pagina.hidden) {
      void cargarVentas({ forzar: true });
    }
  });
})();
/* =========================================================
   PAYPOS · HOJAS DEL NUEVO CIERRE
   Primera etapa: estructura y navegación.
========================================================= */

(() => {
  const pantalla = document.getElementById("caja-cierre");
  const contenedor = document.getElementById("cierre-hojas-cajas");
  const general = document.getElementById("cierre-vista-general");

  if (!pantalla || !contenedor || !general) return;

  // Evita crear las hojas dos veces.
  if (contenedor.dataset.preparado === "true") return;
  contenedor.dataset.preparado = "true";

  const cortes = [200, 100, 50, 20, 10, 5, 2, 1];

  function campoNumerico(atributos, etiqueta) {
    return `
      <input
        type="number"
        inputmode="numeric"
        min="0"
        step="1"
        placeholder="0"
        autocomplete="off"
        aria-label="${etiqueta}"
        ${atributos}
      >
    `;
  }

  function tablaRegistros(caja, grupo, titulo) {
    return `
      <section class="cierre-hoja">
        <header class="cierre-hoja-cabecera">
          <h2>${titulo}</h2>

          <button
            type="button"
            data-cierre-agregar="${grupo}"
            data-cierre-caja="${caja}"
          >
            + Añadir importe
          </button>
        </header>

        <div class="cierre-tabla-contenedor">
          <table class="cierre-tabla">
            <thead>
              <tr>
                <th scope="col">N.º</th>
                <th scope="col">Importe · Bs</th>
                <th scope="col">Acción</th>
              </tr>
            </thead>

            <tbody data-cierre-registros="${grupo}">
              <tr>
                <td>1</td>
                <td>
                  ${campoNumerico(
                    `data-cierre-importe="${grupo}"`,
                    `${titulo}, importe 1, caja ${caja}`,
                  )}
                </td>
                <td>
                  <button type="button" data-cierre-quitar>
                    Quitar
                  </button>
                </td>
              </tr>
            </tbody>

            <tfoot>
              <tr>
                <th scope="row">Total</th>
                <td data-cierre-suma="${grupo}">—</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
    `;
  }

  function crearHojaExcel(caja) {
    const celdas = new Map();
    const ocupadas = new Set();

    // Anchos originales de las columnas A:W del Excel.
    const anchos = [
      22.25, 15.23828125, 16.31640625, 16.31640625, 4.1796875, 2.96484375,
      13.75390625, 3.234375, 14.15625, 2.96484375, 13.88671875, 3.7734375,
      3.234375, 14.15625, 3.7734375, 16.31640625, 3.91015625, 2.96484375,
      14.15625, 2.96484375, 14.15625, 2.96484375, 10.65234375,
    ].map((ancho) => Math.floor(ancho * 7 + 5));

    // Alturas en puntos, tomadas de la primera hoja.
    const alturas = {
      1: 15.75,
      2: 22.5,
      3: 15.75,
      4: 15.75,
      5: 26.25,
      6: 15.75,
      7: 18,
      8: 17.25,
      9: 17.25,
      10: 16.5,
      11: 17.25,
      12: 16.5,
      13: 17.25,
      14: 16.5,
      15: 15.75,
      16: 18,
      17: 18,
      31: 13.5,
      40: 21,
    };

    function poner(fila, columna, contenido = "", opciones = {}) {
      const span = opciones.span || 1;

      celdas.set(`${fila}:${columna}`, {
        contenido,
        span,
        fondo: opciones.fondo || "#fff",
        color: opciones.color || "#000",
        negrita: opciones.negrita || false,
        centro: opciones.centro || false,
        tamaño: opciones.tamaño || 10,
      });

      for (let i = 1; i < span; i++) {
        ocupadas.add(`${fila}:${columna + i}`);
      }
    }

    function entrada(atributos, etiqueta) {
      return `
        <input
          type="number"
          inputmode="numeric"
          min="0"
          step="1"
          placeholder=""
          autocomplete="off"
          aria-label="${etiqueta}, caja ${caja}"
          ${atributos}
          style="
            display:block;width:100%;min-width:0;
            height:100%;min-height:0;margin:0;
            padding:0 3px;border:0;border-radius:0;
            background:transparent;color:#000;
            font:inherit;text-align:right;box-sizing:border-box;
          "
        >
      `;
    }

    function salida(atributo) {
      return `<span ${atributo}>—</span>`;
    }

    // Fecha y caja, como las celdas amarillas del original.
    poner(2, 2, new Intl.DateTimeFormat("es-BO", {
      timeZone: "America/La_Paz",
      day: "2-digit",
      month: "2-digit",
      year: "numeric"
    }).format(new Date()), {
      span: 3,
      fondo: "#ffff00",
      centro: true,
      negrita: true,
      tamaño: 15,
    });

    poner(3, 2, `CAJA ${caja}`, {
      span: 3,
      fondo: "#ffff00",
      centro: true,
      negrita: true,
    });

    poner(5, 1, "ARQUEO CAJA", {
      span: 4,
      centro: true,
      negrita: true,
      tamaño: 15,
    });

    ["CORTE", "MONEDA", "CANTIDAD", "TOTAL"].forEach((texto, indice) => {
      poner(6, indice + 1, texto, {
        centro: true,
        negrita: true,
      });
    });

    [200, 100, 50, 20, 10, 5, 2, 1].forEach((corte, indice) => {
      const fila = indice + 7;

      poner(fila, 1, corte, { negrita: true });
      poner(fila, 2, "Bs.", { centro: true });

      poner(
        fila,
        3,
        entrada(
          `data-cierre-corte="${corte}"`,
          `Cantidad de cortes de ${corte}`,
        ),
        { fondo: "#a6e3b6", tamaño: 12 },
      );

      poner(fila, 4, salida(`data-cierre-subtotal-corte="${corte}"`), {
        tamaño: 12,
      });
    });

    poner(15, 1, "TOTAL BS.", { negrita: true });
    poner(15, 2, "Bs.", { centro: true });
    poner(15, 3, "");
    poner(15, 4, salida("data-cierre-total-efectivo"));

    poner(17, 1, "QR's", {
      span: 4,
      centro: true,
      negrita: true,
    });

    [
      [18, "QR CAJA", "qr-caja"],
      [19, "QR MESEROS", "qr-meseros"],
    ].forEach(([fila, texto, grupo]) => {
      poner(fila, 1, texto, { negrita: true });
      poner(fila, 2, "Bs.", { centro: true });
      poner(fila, 3, salida(`data-cierre-suma="${grupo}"`), {
        fondo: "#a6e3b6",
      });
      poner(fila, 4, "", { fondo: "#a6e3b6" });
    });

    poner(20, 1, "TOTAL QR's:", {
      span: 2,
      centro: true,
      negrita: true,
    });
    poner(20, 3, salida('data-cierre-real="qr"'), { span: 2 });

    poner(22, 1, "TDC's", {
      span: 4,
      centro: true,
      negrita: true,
    });

    poner(23, 1, "TDC CAJA", { negrita: true });
    poner(23, 2, "Bs.", { centro: true });
    poner(
      23,
      3,
      entrada('data-cierre-concepto="tarjeta-caja"', "Tarjeta caja"),
      { fondo: "#a6e3b6" },
    );
    poner(23, 4, "", { fondo: "#a6e3b6" });

    poner(24, 1, "TDC MESEROS", { negrita: true });
    poner(24, 2, "Bs.", { centro: true });
    poner(24, 3, salida('data-cierre-suma="tarjeta-meseros"'), {
      fondo: "#a6e3b6",
    });
    poner(24, 4, "", { fondo: "#a6e3b6" });

    poner(25, 1, "");
    poner(25, 2, "TOTAL TDC's:", {
      centro: true,
      negrita: true,
    });
    poner(25, 3, salida('data-cierre-real="tarjeta"'), {
      span: 2,
    });

    [
      ["guardarropia", "GUARDARROPIA"],
      ["qr-barra", "QR BARRA"],
      ["cover-efectivo", "COVER EFECTIVO"],
      ["cover-qr", "COVER QR"],
    ].forEach(([clave, nombre], indice) => {
      const fila = indice + 27;

      poner(fila, 1, nombre, { negrita: true });
      poner(fila, 2, "Bs.", { centro: true });

      poner(fila, 3, entrada(`data-cierre-concepto="${clave}"`, nombre), {
        fondo: "#a6e3b6",
      });

      poner(fila, 4, "", { fondo: "#a6e3b6" });
    });

    poner(32, 1, "RENDICIÓN TOTAL", {
      span: 4,
      centro: true,
      negrita: true,
    });

    poner(33, 1, "CAJA + QR'S + TDC + EXTRAS", {
      span: 2,
      tamaño: 9,
    });

    poner(33, 3, salida("data-cierre-rendicion"), {
      span: 2,
      negrita: true,
    });

    // Comparación en A36:D40.
    ["TIPO DE FLUJO", "REAL", "APP", "DIFERENCIA"].forEach((texto, indice) => {
      poner(36, indice + 1, texto, {
        fondo: "#0070c0",
        color: "#fff",
        negrita: true,
        centro: indice > 0,
      });
    });

    [
      ["efectivo", "EFECTIVO"],
      ["tarjeta", "TDC"],
      ["qr", "QR"],
    ].forEach(([clave, nombre], indice) => {
      const fila = indice + 37;

      poner(fila, 1, nombre);
      poner(fila, 2, salida(`data-cierre-real="${clave}"`));
      poner(fila, 3, salida(`data-cierre-app="${clave}"`));
      poner(fila, 4, salida(`data-cierre-diferencia="${clave}"`));
    });

    poner(40, 1, "Total Diferencia", { negrita: true });
    poner(40, 2, salida("data-cierre-total-metodos"), {
      negrita: true,
    });
    poner(40, 3, salida("data-cierre-total-app"), {
      negrita: true,
    });
    poner(40, 4, salida("data-cierre-total-diferencia"), {
      negrita: true,
    });

    // Listas de comprobantes en las mismas columnas del Excel.
    function comprobantes(titulo, grupo, inicio, bloques, filas) {
      const ancho = bloques * 2;

      poner(5, inicio, titulo, {
        span: ancho - 2,
        centro: true,
        negrita: true,
      });

      poner(5, inicio + ancho - 2, salida(`data-cierre-suma="${grupo}"`), {
        span: 2,
        negrita: true,
      });

      for (let bloque = 0; bloque < bloques; bloque++) {
        const columna = inicio + bloque * 2;

        for (let indice = 0; indice < filas; indice++) {
          const numero = bloque * filas + indice + 1;
          const fila = indice + 6;

          poner(fila, columna, numero, {
            fondo: "#fff2cc",
            negrita: true,
          });

          poner(
            fila,
            columna + 1,
            entrada(
              `data-cierre-importe="${grupo}"`,
              `${titulo}, comprobante ${numero}`,
            ),
          );
        }
      }
    }

    comprobantes("CAJA QR TOTAL:", "qr-caja", 6, 3, 30);
    comprobantes("MESEROS TDC TOTAL:", "tarjeta-meseros", 13, 2, 20);
    comprobantes("MESERO QR'S TOTAL:", "qr-meseros", 18, 3, 30);

    let filasHtml = "";

    for (let fila = 1; fila <= 40; fila++) {
      let columnasHtml = "";

      for (let columna = 1; columna <= 23; columna++) {
        const clave = `${fila}:${columna}`;
        if (ocupadas.has(clave)) continue;

        const celda = celdas.get(clave);
        const altura = alturas[fila] || 15.75;

        columnasHtml += celda
          ? `
            <td
              colspan="${celda.span}"
              style="
                height:${altura}pt;
                padding:0 3px;
               border:1.2px solid #000;
                background:${celda.fondo};
                color:${celda.color};
                font-size:${celda.tamaño}pt;
                font-weight:${celda.negrita ? 700 : 400};
                text-align:${celda.centro ? "center" : "left"};
                vertical-align:middle;
                white-space:nowrap;
                overflow:hidden;
                box-sizing:border-box;
              "
            >${celda.contenido}</td>
          `
          : `
            <td style="
              height:${altura}pt;
              padding:0;
             border:0;
             background:transparent;
            "></td>
          `;
      }

      filasHtml += `
        <tr style="height:${alturas[fila] || 15.75}pt">
          ${columnasHtml}
        </tr>
      `;
    }

    return `
      <section data-cierre-hoja="${caja}" hidden>

          <table
            aria-label="Hoja de rendición de Caja ${caja}"
            style="
              width:${anchos.reduce((a, b) => a + b, 0)}px;
              table-layout:fixed;
              border-collapse:collapse;
              font-family:Arial,sans-serif;
              line-height:normal;
              color:#000;
              background:#fff;
            "
          >
            <colgroup>
              ${anchos
                .map((ancho) => `<col style="width:${ancho}px">`)
                .join("")}
            </colgroup>
            <tbody>${filasHtml}</tbody>
          </table>
        </div>
      </section>
    `;
  }

  contenedor.innerHTML = [1, 2, 3, 4].map(crearHojaExcel).join("");

  const pestañas = [...pantalla.querySelectorAll("[data-cierre-vista]")];

  function mostrarHoja(vista) {
    const esGeneral = vista === "general";

    general.hidden = !esGeneral;
    contenedor.hidden = esGeneral;

    contenedor.querySelectorAll("[data-cierre-hoja]").forEach((hoja) => {
      hoja.hidden = hoja.dataset.cierreHoja !== vista;
    });

    pestañas.forEach((boton) => {
      boton.setAttribute(
        "aria-pressed",
        String(boton.dataset.cierreVista === vista),
      );
    });
  }

  pestañas.forEach((boton) => {
    boton.disabled = false;

    boton.addEventListener("click", () => {
      mostrarHoja(boton.dataset.cierreVista);
    });
  });

  // Añadir y quitar importes dentro de cada hoja.
  contenedor.addEventListener("click", (evento) => {
    const agregar = evento.target.closest("[data-cierre-agregar]");
    const quitar = evento.target.closest("[data-cierre-quitar]");

    if (agregar) {
      const hoja = agregar.closest("[data-cierre-hoja]");
      const grupo = agregar.dataset.cierreAgregar;

      const cuerpo = hoja.querySelector(`[data-cierre-registros="${grupo}"]`);

      const fila = cuerpo.rows[0].cloneNode(true);
      fila.querySelector("input").value = "";
      cuerpo.append(fila);

      renumerar(cuerpo);
      fila.querySelector("input").focus();
    }

    if (quitar) {
      const fila = quitar.closest("tr");
      const cuerpo = fila.parentElement;

      if (cuerpo.rows.length > 1) {
        fila.remove();
      } else {
        fila.querySelector("input").value = "";
      }

      renumerar(cuerpo);
    }
  });

  function renumerar(cuerpo) {
    const caja = cuerpo.closest("[data-cierre-hoja]").dataset.cierreHoja;

    [...cuerpo.rows].forEach((fila, indice) => {
      fila.cells[0].textContent = indice + 1;

      fila
        .querySelector("input")
        .setAttribute(
          "aria-label",
          `Importe ${indice + 1}, ${cuerpo.dataset.cierreRegistros}, caja ${caja}`,
        );
    });
  }

  document.getElementById("cierre-jornada-mensaje").textContent =
    "Hojas preparadas. Falta conectar cálculos y turnos.";

  mostrarHoja("general");
})();
/* =========================================================
   CIERRE · CARGAR TOTALES APP DESDE SUPABASE
========================================================= */

(() => {
  const pantalla = document.getElementById("caja-cierre");
  const contenedor = document.getElementById("cierre-hojas-cajas");
  const mensaje = document.getElementById("cierre-jornada-mensaje");

  if (!pantalla || !contenedor || !mensaje) return;

  let version = 0;

  const formato = new Intl.NumberFormat("es-BO", {
    maximumFractionDigits: 0,
  });

  function limpiarApp() {
    pantalla.payposResumenCierre = null;

    contenedor.querySelectorAll("[data-cierre-app]").forEach((celda) => {
      celda.textContent = "—";
      delete celda.dataset.montoApp;
    });

    contenedor.querySelectorAll("[data-cierre-total-app]").forEach((celda) => {
      celda.textContent = "—";
    });

    contenedor.querySelectorAll("[data-cierre-hoja]").forEach((hoja) => {
      delete hoja.dataset.turnoId;
    });
  }

  async function cargarApp() {
    const consulta = ++version;
    const usuario = window.payposAcceso?.usuarioId;

    limpiarApp();

    // Mientras se consulta, no permitir ingresar un cierre
    // en una hoja cuyo turno aún no conocemos.
    contenedor.querySelectorAll("input").forEach((input) => {
      input.disabled = true;
    });

    if (!usuario || !db) {
      mensaje.textContent = "Inicia sesión para consultar los turnos.";
      return;
    }

    mensaje.textContent = "Consultando ventas por caja…";

    try {
      const { data, error } = await db.rpc("pos_resumen_cierre_abiertos");

      if (consulta !== version || usuario !== window.payposAcceso?.usuarioId) {
        return;
      }

      if (error) throw error;

      if (!data || !Array.isArray(data.cajas)) {
        throw new Error("Supabase no devolvió un resumen de cierre válido.");
      }

      // Validar primero todos los importes recibidos.
      for (const caja of data.cajas) {
        if (!caja.tiene_turno_abierto) continue;

        if (!caja.turno_id || !caja.app) {
          throw new Error("Faltan datos de un turno abierto.");
        }

        for (const metodo of ["efectivo", "qr", "tarjeta"]) {
          const valor = caja.app[metodo];

          if (
            valor === null ||
            valor === undefined ||
            !Number.isSafeInteger(Number(valor)) ||
            Number(valor) < 0
          ) {
            throw new Error(
              `El total de ${metodo} de Caja ${caja.caja_numero} no es válido.`,
            );
          }
        }
      }

      pantalla.payposResumenCierre = data;

      contenedor.querySelectorAll("[data-cierre-hoja]").forEach((hoja) => {
        const numero = Number(hoja.dataset.cierreHoja);

        const caja = data.cajas.find(
          (item) => Number(item.caja_numero) === numero,
        );
        const celdaNombreCaja = hoja.querySelector("table")
          ?.rows[2]?.cells[1];

        if (celdaNombreCaja) {
          celdaNombreCaja.textContent =
            caja?.caja_nombre || `Caja ${numero}`;
        }
        const abierta = caja?.tiene_turno_abierto === true;

        hoja.querySelectorAll("input").forEach((input) => {
          input.disabled = !abierta;
        });

        if (!abierta) {
          hoja.querySelectorAll("[data-cierre-app]").forEach((celda) => {
            celda.textContent = caja ? "Sin turno" : "Sin acceso";
          });

          return;
        }

        hoja.dataset.turnoId = caja.turno_id;

        let total = 0;

        for (const metodo of ["efectivo", "qr", "tarjeta"]) {
          const monto = Number(caja.app[metodo]);

          total += monto;

          hoja
            .querySelectorAll(`[data-cierre-app="${metodo}"]`)
            .forEach((celda) => {
              celda.textContent = formato.format(monto);
              celda.dataset.montoApp = String(monto);
            });
        }

        hoja.querySelectorAll("[data-cierre-total-app]").forEach((celda) => {
          celda.textContent = formato.format(total);
        });
      });

      mensaje.textContent =
        "APP actualizado por turno abierto. El cierre aún no está habilitado.";

      pantalla.dispatchEvent(
        new CustomEvent("paypos:cierre-app-cargado", {
          detail: data,
        }),
      );
    } catch (error) {
      if (consulta !== version) return;

      limpiarApp();

      console.error("PayPos · APP del cierre:", error);

      mensaje.textContent =
        error?.message || "No se pudieron consultar las ventas.";
    }
  }

  // Consultar cada vez que se abre la pantalla.
  new MutationObserver(() => {
    if (!pantalla.hidden) {
      void cargarApp();
    } else {
      ++version;
    }
  }).observe(pantalla, {
    attributes: true,
    attributeFilter: ["hidden"],
  });

  // Actualizar si se registra o anula una venta.
  document.addEventListener("paypos:ventas-actualizadas", () => {
    if (!pantalla.hidden) void cargarApp();
  });

  // Limpiar los importes de la cuenta anterior.
  document.addEventListener("paypos:acceso-cambiado", () => {
    ++version;
    limpiarApp();

    contenedor.querySelectorAll("input").forEach((input) => {
      input.value = "";
      input.disabled = true;
    });

    if (!pantalla.hidden) void cargarApp();
  });

  if (!pantalla.hidden) void cargarApp();
})();
/* =========================================================
   CIERRE · CÁLCULOS DE LAS HOJAS
========================================================= */

(() => {
  const pantalla = document.getElementById("caja-cierre");
  const contenedor = document.getElementById("cierre-hojas-cajas");

  if (!pantalla || !contenedor) return;

  const formato = new Intl.NumberFormat("es-BO", {
    maximumFractionDigits: 0,
  });

  function escribir(raiz, selector, monto) {
    raiz.querySelectorAll(selector).forEach((celda) => {
      celda.textContent = monto === null ? "—" : formato.format(monto);
    });
  }

  function sumar(valores) {
    const total = valores.reduce((suma, valor) => suma + valor, 0);

    if (!Number.isSafeInteger(total)) {
      throw new Error("El total supera el límite permitido.");
    }

    return total;
  }

  function leer(input) {
    const texto = input.value.trim();
    const valor = texto === "" ? 0 : Number(texto);

    const valido =
      !input.validity.badInput && Number.isSafeInteger(valor) && valor >= 0;

    input.setCustomValidity(
      valido ? "" : "Introduce un número entero de cero o mayor.",
    );

    input.setAttribute("aria-invalid", String(!valido));

    if (!valido) throw new Error("Hay un importe no válido.");

    return valor;
  }

  function calcularHoja(hoja) {
    const selectoresSalida = [
      "[data-cierre-subtotal-corte]",
      "[data-cierre-total-efectivo]",
      "[data-cierre-suma]",
      "[data-cierre-real]",
      "[data-cierre-diferencia]",
      "[data-cierre-rendicion]",
      "[data-cierre-total-metodos]",
      "[data-cierre-total-diferencia]",
    ].join(",");

    if (!hoja.dataset.turnoId) {
      escribir(hoja, selectoresSalida, null);
      return null;
    }

    try {
      // Revisar todos los campos antes de mostrar resultados.
      hoja.querySelectorAll("input").forEach(leer);

      const subtotales = [...hoja.querySelectorAll("[data-cierre-corte]")].map(
        (input) => {
          const corte = Number(input.dataset.cierreCorte);
          const subtotal = corte * leer(input);

          if (!Number.isSafeInteger(subtotal)) {
            throw new Error("El conteo supera el límite permitido.");
          }

          escribir(hoja, `[data-cierre-subtotal-corte="${corte}"]`, subtotal);

          return subtotal;
        },
      );

      const efectivo = sumar(subtotales);

      function sumarGrupo(grupo) {
        const total = sumar(
          [...hoja.querySelectorAll(`[data-cierre-importe="${grupo}"]`)].map(
            leer,
          ),
        );

        escribir(hoja, `[data-cierre-suma="${grupo}"]`, total);

        return total;
      }

      function concepto(nombre) {
        const input = hoja.querySelector(`[data-cierre-concepto="${nombre}"]`);

        if (!input) throw new Error("Falta un campo del cierre.");

        return leer(input);
      }

      const qr = sumar([sumarGrupo("qr-caja"), sumarGrupo("qr-meseros")]);

      const tarjeta = sumar([
        concepto("tarjeta-caja"),
        sumarGrupo("tarjeta-meseros"),
      ]);

      const extras = sumar([
        concepto("guardarropia"),
        concepto("qr-barra"),
        concepto("cover-efectivo"),
        concepto("cover-qr"),
      ]);

      const reales = { efectivo, qr, tarjeta };
      const totalMetodos = sumar([efectivo, qr, tarjeta]);
      const rendicion = sumar([totalMetodos, extras]);

      escribir(hoja, "[data-cierre-total-efectivo]", efectivo);
      escribir(hoja, "[data-cierre-total-metodos]", totalMetodos);
      escribir(hoja, "[data-cierre-rendicion]", rendicion);

      const diferencias = [];
      const filas = [];

      for (const metodo of ["efectivo", "tarjeta", "qr"]) {
        const real = reales[metodo];

        escribir(hoja, `[data-cierre-real="${metodo}"]`, real);

        const celdaApp = hoja.querySelector(`[data-cierre-app="${metodo}"]`);

        const textoApp = celdaApp?.dataset.montoApp;
        const app = textoApp === undefined ? null : Number(textoApp);

        const diferencia =
          app !== null && Number.isSafeInteger(app) ? real - app : null;

        escribir(hoja, `[data-cierre-diferencia="${metodo}"]`, diferencia);

        hoja
          .querySelectorAll(`[data-cierre-diferencia="${metodo}"]`)
          .forEach((celda) => {
            const fondo =
              diferencia === null || diferencia === 0
                ? "#fff"
                : diferencia < 0
                  ? "#f4b0a8"
                  : "#00b050";

            celda.closest("td").style.background = fondo;
          });

        diferencias.push(diferencia);
        filas.push({ metodo, real, app, diferencia });
      }

      escribir(
        hoja,
        "[data-cierre-total-diferencia]",
        diferencias.every((valor) => valor !== null)
          ? sumar(diferencias)
          : null,
      );

      return {
        caja: Number(hoja.dataset.cierreHoja),
        filas,
        extras,
        rendicion,
      };
    } catch {
      escribir(hoja, selectoresSalida, null);
      return null;
    }
  }

  function actualizar() {
    const hojas = [...contenedor.querySelectorAll("[data-cierre-hoja]")];

    const resultados = hojas.map(calcularHoja);
    const activas = hojas.filter((hoja) => hoja.dataset.turnoId);
    const validos = resultados.filter(Boolean);

    const completo = activas.length > 0 && validos.length === activas.length;

    const cuerpo = document.getElementById("cierre-general-filas");

    if (cuerpo) {
      cuerpo.innerHTML = validos.length
        ? validos
            .map((caja) =>
              caja.filas
                .map(
                  (fila) => `
              <tr>
                <th scope="row">Caja ${caja.caja}</th>
                <td>${fila.metodo === "tarjeta" ? "TDC" : fila.metodo.toUpperCase()}</td>
                <td>${formato.format(fila.real)}</td>
                <td>${fila.app === null ? "—" : formato.format(fila.app)}</td>
                <td>${fila.diferencia === null ? "—" : formato.format(fila.diferencia)}</td>
                <td>Turno abierto</td>
              </tr>
            `,
                )
                .join(""),
            )
            .join("")
        : `<tr><td colspan="6">
             No hay conteos válidos de turnos abiertos.
           </td></tr>`;
    }

    function totalGeneral(selector, obtener) {
      let total = null;

      if (completo) {
        try {
          const valores = validos.map(obtener);

          if (valores.every((valor) => valor !== null)) {
            total = sumar(valores);
          }
        } catch {
          total = null;
        }
      }

      escribir(pantalla, selector, total);
    }

    totalGeneral("#cierre-general-real", (caja) =>
      sumar(caja.filas.map((fila) => fila.real)),
    );

    totalGeneral("#cierre-general-app", (caja) =>
      caja.filas.every((fila) => fila.app !== null)
        ? sumar(caja.filas.map((fila) => fila.app))
        : null,
    );

    totalGeneral("#cierre-general-diferencia", (caja) =>
      caja.filas.every((fila) => fila.diferencia !== null)
        ? sumar(caja.filas.map((fila) => fila.diferencia))
        : null,
    );

    totalGeneral("#cierre-general-extras", (caja) => caja.extras);

    totalGeneral(
      "#cierre-general-rendicion, #cierre-jornada-total-real",
      (caja) => caja.rendicion,
    );
  }

  contenedor.addEventListener("input", (evento) => {
    if (evento.target.matches("input")) actualizar();
  });

  pantalla.addEventListener("paypos:cierre-app-cargado", actualizar);

  document.addEventListener("paypos:acceso-cambiado", () => {
    queueMicrotask(actualizar);
  });

  actualizar();
})();
/* =========================================================
   PAYPOS · IMPRIMIR CIERRES CENTRALIZADOS
========================================================= */

window.payposImprimirCierres = async function (cierres) {
  if (!Array.isArray(cierres)) {
    throw new Error("La lista de cierres no es válida.");
  }

  // Solo imprime cajas con ventas válidas con monto.
  const imprimibles = cierres
    .filter((cierre) => cierre.imprimir === true)
    .sort((a, b) => a.caja_numero - b.caja_numero);

  if (!imprimibles.length) {
    window.payposToast?.(
      "Cajas cerradas sin ventas con monto. No hay comprobantes para imprimir.",
    );
    return;
  }

  const escapar = (valor) =>
    String(valor ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

  const formato = new Intl.NumberFormat("es-BO", {
    maximumFractionDigits: 0,
  });

  function monto(valor) {
    if (
      valor === null ||
      valor === undefined ||
      !Number.isSafeInteger(Number(valor))
    ) {
      throw new Error("Un importe del comprobante no es válido.");
    }

    return formato.format(Number(valor));
  }

  function fecha(valor) {
    const momento = new Date(valor);

    if (Number.isNaN(momento.getTime())) {
      throw new Error("La fecha del cierre no es válida.");
    }

    return new Intl.DateTimeFormat("es-BO", {
      timeZone: "America/La_Paz",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(momento);
  }

  const logo = new URL("pa.png", document.baseURI).href;

  const comprobantes = imprimibles
    .map((cierre) => {
      const filas = [
        ["efectivo", "EFECTIVO"],
        ["tarjeta", "TARJETA"],
        ["qr", "QR"],
      ]
        .map(
          ([clave, nombre]) => `
      <tr>
        <th>${nombre}</th>
        <td>${monto(cierre.real?.[clave])}</td>
        <td>${monto(cierre.app?.[clave])}</td>
        <td>${monto(cierre.diferencia?.[clave])}</td>
      </tr>
    `,
        )
        .join("");

      const totalReal = ["efectivo", "tarjeta", "qr"].reduce(
        (suma, clave) => suma + Number(cierre.real[clave]),
        0,
      );

      const totalApp = ["efectivo", "tarjeta", "qr"].reduce(
        (suma, clave) => suma + Number(cierre.app[clave]),
        0,
      );

      return `
      <article class="ticket-cierre">
        <div class="logo">
          <img src="${escapar(logo)}" alt="PACHA">
        </div>

        <h1>CIERRE DE CAJA</h1>

        <div class="datos">
          <strong>
            ${escapar(cierre.caja_nombre)}
            · C${escapar(cierre.caja_numero)}
          </strong>

          <div>${escapar(fecha(cierre.cerrado_en))}</div>
        </div>

        <table>
          <thead>
            <tr>
              <th>MÉTODO</th>
              <th>REAL</th>
              <th>APP</th>
              <th>DIF.</th>
            </tr>
          </thead>

          <tbody>
            ${filas}

            <tr class="total">
              <th>TOTAL</th>
              <td>${monto(totalReal)}</td>
              <td>${monto(totalApp)}</td>
              <td>${monto(totalReal - totalApp)}</td>
            </tr>
          </tbody>
        </table>

        <div class="resumen">
          <div>
            <span>EXTRAS</span>
            <strong>Bs ${monto(cierre.extras)}</strong>
          </div>

          <div>
            <span>RENDICIÓN TOTAL</span>
            <strong>Bs ${monto(cierre.rendicion)}</strong>
          </div>

          <div>
            <span>VENTAS VÁLIDAS</span>
            <strong>${monto(cierre.ventas_validas)}</strong>
          </div>
        </div>

        <p class="confirmado">CIERRE CONFIRMADO</p>

        <p class="identificador">
          TURNO: ${escapar(cierre.turno_id)}
        </p>
      </article>
    `;
    })
    .join("");

  const iframe = document.createElement("iframe");

  iframe.title = "Comprobantes de cierre";
  iframe.style.cssText = `
    position: fixed;
    left: -10000px;
    top: 0;
    width: 80mm;
    height: 600px;
    border: 0;
  `;

  await new Promise((resolve, reject) => {
    iframe.onload = async () => {
      const documento = iframe.contentDocument;
      const ventana = iframe.contentWindow;

      try {
        if (!documento || !ventana) {
          throw new Error("No se pudo abrir la impresión.");
        }

        // Al dispararse load, las imágenes ya terminaron
        // de cargar o fallaron.
        const imagenes = [...documento.images];

        if (imagenes.some((imagen) => !imagen.naturalWidth)) {
          throw new Error("No se pudo cargar el logo pa.png.");
        }

        if (documento.fonts) {
          await documento.fonts.ready;
        }

        await new Promise((fin) => setTimeout(fin, 150));

        ventana.addEventListener(
          "afterprint",
          () => {
            setTimeout(() => iframe.remove(), 1000);
          },
          { once: true },
        );

        ventana.focus();
        ventana.print();

        // Esto confirma que se abrió la impresión,
        // no que la impresora entregó el papel.
        resolve();
      } catch (error) {
        iframe.remove();
        reject(error);
      }
    };

    iframe.srcdoc = `
      <!DOCTYPE html>
      <html lang="es">
        <head>
          <meta charset="UTF-8">

          <style>
            @page {
              margin: 0;
            }

            * {
              box-sizing: border-box;
            }

            html,
            body {
              width: 80mm;
              margin: 0;
              padding: 0;
              background: #fff;
              color: #000;
              color-scheme: light;
            }

            .ticket-cierre {
              width: 80mm;
              margin: 0;
              padding: 2mm 5mm 4mm;
              font-family: Arial, sans-serif;
              font-size: 10px;
              break-after: page;
              page-break-after: always;
            }

            .ticket-cierre:last-child {
              break-after: auto;
              page-break-after: auto;
            }

            .logo {
              position: relative;
              width: 31mm;
              height: 13.93mm;
              margin: 0 auto;
              overflow: hidden;
            }

            .logo img {
              position: absolute;
              top: -4.96mm;
              left: 0;
              display: block;
              width: 31mm;
              height: auto;
            }

            h1 {
              margin: 2mm 0;
              font-size: 15px;
              text-align: center;
            }

            .datos {
              margin-bottom: 3mm;
              line-height: 1.5;
              text-align: center;
            }

            table {
              width: 100%;
              border-collapse: collapse;
              font-variant-numeric: tabular-nums;
            }

            th,
            td {
              padding: 2mm 1mm;
              border-bottom: 1px dashed #000;
              text-align: right;
              white-space: nowrap;
              font-size: 9px;
            }

            th:first-child {
              text-align: left;
            }

            thead th {
              border-top: 1px solid #000;
              border-bottom: 1px solid #000;
            }

            .total th,
            .total td {
              border-top: 1px solid #000;
              border-bottom: 1px solid #000;
              font-weight: bold;
            }

            .resumen {
              margin-top: 3mm;
            }

            .resumen > div {
              display: flex;
              justify-content: space-between;
              gap: 2mm;
              padding: 1mm 0;
            }

            .confirmado {
              margin: 3mm 0 1mm;
              font-weight: bold;
              text-align: center;
            }

            .identificador {
              margin: 0;
              font-size: 8px;
              text-align: center;
              overflow-wrap: anywhere;
            }
          </style>
        </head>

        <body>${comprobantes}</body>
      </html>
    `;

    document.body.appendChild(iframe);
  });
};
/* =========================================================
   PAYPOS · CONFIRMAR CIERRE CENTRALIZADO
========================================================= */

(() => {
  const pantalla = document.getElementById("caja-cierre");
  const contenedor = document.getElementById("cierre-hojas-cajas");
  const boton = document.getElementById("cierre-jornada-confirmar");
  const mensaje = document.getElementById("cierre-jornada-mensaje");

  if (!pantalla || !contenedor || !boton || !mensaje) return;
  if (boton.dataset.conectado === "true") return;

  boton.dataset.conectado = "true";

  let procesando = false;
  let ultimoResultado = null;

  const reimprimir = document.createElement("button");
  reimprimir.type = "button";
  reimprimir.textContent = "Reimprimir último cierre";
  reimprimir.className = "apertura-caja-volver";
  const pestanasCierre = pantalla.querySelector(
    ".cierre-jornada-pestanas"
  );

  const volverCierre = document.getElementById(
    "cerrar-pantalla-cierre"
  );

  const barraCierre = document.createElement("div");
  barraCierre.className = "cierre-barra-herramientas";

  const accionesCierre = document.createElement("div");
  accionesCierre.className = "cierre-barra-acciones";

  pestanasCierre.before(barraCierre);
  barraCierre.append(pestanasCierre, accionesCierre);
  accionesCierre.append(volverCierre, reimprimir, boton);

  const botonPdfCierre = document.createElement("button");
  botonPdfCierre.type = "button";
  botonPdfCierre.className = "apertura-caja-volver";
  botonPdfCierre.textContent = "Descargar PDF";

  accionesCierre.insertBefore(botonPdfCierre, boton);

  /* PDF directo: celdas y texto, sin html2canvas */
  /* DESCARGAR PNG INDIVIDUAL POR CAJA TRABAJADA */

  botonPdfCierre.textContent = "Descargar PNG";

  botonPdfCierre.addEventListener("click", async () => {
    if (procesando || botonPdfCierre.disabled) return;

    let soporte = null;

    botonPdfCierre.disabled = true;
    botonPdfCierre.textContent = "Preparando imágenes…";

    const escapar = valor => String(valor ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&apos;");

    function colorVisible(color) {
      if (color === "transparent") return false;

      const partes = color.match(/[\d.]+/g);

      return !(
        partes &&
        partes.length > 3 &&
        Number(partes[3]) === 0
      );
    }

    try {
      const datos = pantalla.payposResumenCierre;

      if (!Array.isArray(datos?.cajas)) {
        throw new Error("Espera a que se carguen las cajas.");
      }

      const cajas = datos.cajas.filter(caja =>
        caja.tiene_turno_abierto === true &&
        Number(caja.ventas_con_monto) > 0
      );

      if (!cajas.length) {
        throw new Error(
          "No hay cajas con ventas válidas con monto para descargar."
        );
      }

      // Copiar todas las hojas antes de comenzar:
      // así los datos no cambian durante la generación.
      const trabajos = cajas.map(caja => {
        const original = contenedor.querySelector(
          `[data-cierre-hoja="${Number(caja.caja_numero)}"] table`
        );

        if (!original) {
          throw new Error("No se encontró la hoja de una caja.");
        }

        const tabla = original.cloneNode(true);
        const entradas = [...original.querySelectorAll("input")];

        tabla.querySelectorAll("input").forEach((input, indice) => {
          const origen = entradas[indice];
          const valor = origen.value.trim();

          if (
            origen.validity.badInput ||
            (
              valor !== "" &&
              (
                !Number.isSafeInteger(Number(valor)) ||
                Number(valor) < 0
              )
            )
          ) {
            throw new Error(
              `Revisa los importes de Caja ${caja.caja_numero}.`
            );
          }

          const texto = document.createElement("span");

          texto.textContent = origen.value;
          texto.style.cssText =
            "display:block;text-align:right;font:inherit;color:#000;";

          input.replaceWith(texto);
        });

        return {
          numero: Number(caja.caja_numero),
          tabla
        };
      });

      const fecha = new Intl.DateTimeFormat("es-BO", {
        timeZone: "America/La_Paz",
        day: "2-digit",
        month: "2-digit",
        year: "numeric"
      }).format(new Date());

      soporte = document.createElement("div");

      soporte.style.cssText = `
        position:absolute;
        left:-20000px;
        top:0;
        width:max-content;
        background:#dedede;
        color:#000;
        color-scheme:light;
        pointer-events:none;
      `;

      document.body.appendChild(soporte);

      if (document.fonts) await document.fonts.ready;

      for (const trabajo of trabajos) {
        const tabla = trabajo.tabla;

        const celdaFecha = tabla.rows[1]?.cells[1];
        if (celdaFecha) celdaFecha.textContent = fecha;

        soporte.replaceChildren(tabla);

        const marco = tabla.getBoundingClientRect();
        const ancho = Math.ceil(marco.width);
        const alto = Math.ceil(marco.height);

        if (!ancho || !alto) {
          throw new Error("No se pudo medir una hoja.");
        }

        const dibujos = [
          `<rect width="${ancho}" height="${alto}" fill="#dedede"/>`
        ];

        const filas = [...tabla.rows];

        for (let indice = 0; indice < filas.length; indice++) {
          for (const celda of filas[indice].cells) {
            const rect = celda.getBoundingClientRect();
            const estilo = getComputedStyle(celda);

            const x = rect.left - marco.left;
            const y = rect.top - marco.top;
            const w = rect.width;
            const h = rect.height;

            if (colorVisible(estilo.backgroundColor)) {
              dibujos.push(`
                <rect
                  x="${x}" y="${y}" width="${w}" height="${h}"
                  fill="${escapar(estilo.backgroundColor)}"
                />
              `);
            }

            const lados = [
              ["Top", x, y, x + w, y],
              ["Right", x + w, y, x + w, y + h],
              ["Bottom", x, y + h, x + w, y + h],
              ["Left", x, y, x, y + h]
            ];

            for (const [lado, x1, y1, x2, y2] of lados) {
              const grosor = parseFloat(
                estilo[`border${lado}Width`]
              );

              if (
                grosor > 0 &&
                estilo[`border${lado}Style`] !== "none"
              ) {
                dibujos.push(`
                  <line
                    x1="${x1}" y1="${y1}"
                    x2="${x2}" y2="${y2}"
                    stroke="${escapar(estilo[`border${lado}Color`])}"
                    stroke-width="${grosor}"
                  />
                `);
              }
            }

            const contenido = celda.textContent
              .trim()
              .replace(/\s+/g, " ");

            if (!contenido) continue;

            const elementoTexto =
              celda.querySelector("span") || celda;

            const textoEstilo = getComputedStyle(elementoTexto);
            const alineacion = textoEstilo.textAlign;

            const posicionX = alineacion === "right"
              ? x + w - 4
              : alineacion === "center"
                ? x + w / 2
                : x + 4;

            const ancla = alineacion === "right"
              ? "end"
              : alineacion === "center" ? "middle" : "start";

            const clipId = `celda-${indice}-${celda.cellIndex}`;

            dibujos.push(`
              <defs>
                <clipPath id="${clipId}">
                  <rect x="${x}" y="${y}" width="${w}" height="${h}"/>
                </clipPath>
              </defs>

              <text
                x="${posicionX}"
                y="${y + h / 2}"
                dominant-baseline="central"
                text-anchor="${ancla}"
                font-family="Arial, sans-serif"
                font-size="${parseFloat(textoEstilo.fontSize)}"
                font-weight="${escapar(textoEstilo.fontWeight)}"
                fill="${escapar(textoEstilo.color)}"
                clip-path="url(#${clipId})"
              >${escapar(contenido)}</text>
            `);
          }

          if (indice % 10 === 9) {
            await new Promise(resolve => setTimeout(resolve, 0));
          }
        }

        const svg = `
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="${ancho}"
            height="${alto}"
            viewBox="0 0 ${ancho} ${alto}"
          >
            ${dibujos.join("")}
          </svg>
        `;

        const urlSvg = URL.createObjectURL(
          new Blob([svg], { type: "image/svg+xml;charset=utf-8" })
        );

        const imagen = new Image();

        try {
          await new Promise((resolve, reject) => {
            imagen.onload = resolve;
            imagen.onerror = () => reject(
              new Error("No se pudo dibujar la hoja.")
            );
            imagen.src = urlSvg;
          });

          const canvas = document.createElement("canvas");
          const escala = 1.5;

          canvas.width = Math.ceil(ancho * escala);
          canvas.height = Math.ceil(alto * escala);

          const contexto = canvas.getContext("2d");

          if (!contexto) {
            throw new Error("No se pudo crear la imagen PNG.");
          }

          contexto.drawImage(
            imagen, 0, 0, canvas.width, canvas.height
          );

          const archivo = await new Promise((resolve, reject) => {
            canvas.toBlob(blob => {
              if (blob) resolve(blob);
              else reject(new Error("No se pudo generar el PNG."));
            }, "image/png");
          });

          const urlPng = URL.createObjectURL(archivo);
          const enlace = document.createElement("a");

          enlace.href = urlPng;
          enlace.download =
            `Cierre_Caja_${trabajo.numero}_${fecha.replaceAll("/", "-")}.png`;

          document.body.appendChild(enlace);
          enlace.click();
          enlace.remove();

          setTimeout(() => URL.revokeObjectURL(urlPng), 60000);

          canvas.width = 0;
          canvas.height = 0;

        } finally {
          URL.revokeObjectURL(urlSvg);
        }

        await new Promise(resolve => setTimeout(resolve, 100));
      }

      mensaje.textContent =
        `Se generaron ${trabajos.length} imágenes, una por caja trabajada.`;

    } catch (error) {
      console.error("PayPos · PNG:", error);

      mensaje.textContent =
        "No se pudo completar la descarga: " + error.message;

    } finally {
      soporte?.remove();
      botonPdfCierre.disabled = false;
      botonPdfCierre.textContent = "Descargar PNG";
    }
  });

  function usuarioActual() {
    return window.payposAcceso?.usuarioId || "";
  }

  function autorizado() {
    const acceso = window.payposAcceso;

    return (
      acceso?.esAdministrador === true &&
      [1, 2].includes(Number(acceso?.caja?.numero))
    );
  }

  function clavePendiente(usuario) {
    return `paypos:cierre-pendiente:${usuario}`;
  }

  function leerPendiente() {
    const usuario = usuarioActual();
    if (!usuario) return null;

    const texto = sessionStorage.getItem(clavePendiente(usuario));

    if (!texto) return null;

    const pendiente = JSON.parse(texto);

    if (!pendiente?.p_operacion_id || !Array.isArray(pendiente.p_cierres)) {
      throw new Error("La solicitud de cierre guardada no es válida.");
    }

    return pendiente;
  }

  function actualizarBoton() {
    let pendiente = false;

    try {
      pendiente = Boolean(leerPendiente());
    } catch (error) {
      boton.disabled = true;
      mensaje.textContent = error.message;
      return;
    }

    const datos = pantalla.payposResumenCierre;

    const hayTurnos = datos?.cajas?.some(
      (caja) => caja.tiene_turno_abierto === true,
    );

    boton.disabled =
      procesando ||
      !autorizado() ||
      typeof window.payposImprimirCierres !== "function" ||
      (!pendiente && !hayTurnos);

    boton.textContent = procesando
      ? "Cerrando cajas…"
      : pendiente
        ? "Reintentar cierre pendiente"
        : "Cerrar cajas";

    reimprimir.disabled = procesando || !autorizado();
  }

  function numero(input) {
    if (!input) {
      throw new Error("Falta un campo del cierre.");
    }

    const texto = input.value.trim();
    const valor = texto === "" ? 0 : Number(texto);

    if (input.validity.badInput || !Number.isSafeInteger(valor) || valor < 0) {
      input.focus();
      throw new Error(
        "Revisa los campos: usa números enteros de cero o mayores.",
      );
    }

    return valor;
  }

  function prepararSolicitud() {
    const datos = pantalla.payposResumenCierre;

    if (!datos || !Array.isArray(datos.cajas)) {
      throw new Error("Primero espera a que se carguen los montos APP.");
    }

    const cajas = datos.cajas.filter(
      (caja) => caja.tiene_turno_abierto === true,
    );

    if (!cajas.length) {
      throw new Error("No hay turnos abiertos para cerrar.");
    }

    const cierres = cajas.map((caja) => {
      const hoja = contenedor.querySelector(
        `[data-cierre-hoja="${Number(caja.caja_numero)}"]`,
      );

      if (!hoja || hoja.dataset.turnoId !== caja.turno_id) {
        throw new Error("Los turnos cambiaron. Vuelve a abrir la pantalla.");
      }

      function concepto(nombre) {
        return numero(hoja.querySelector(`[data-cierre-concepto="${nombre}"]`));
      }

      function importes(grupo) {
        return [
          ...hoja.querySelectorAll(`[data-cierre-importe="${grupo}"]`),
        ].map(numero);
      }

      return {
        turno_id: caja.turno_id,

        app_esperado: {
          efectivo: Number(caja.app.efectivo),
          qr: Number(caja.app.qr),
          tarjeta: Number(caja.app.tarjeta),
        },

        ventas_validas: Number(caja.ventas_validas),

        detalle: {
          cortes: [...hoja.querySelectorAll("[data-cierre-corte]")].map(
            (input) => ({
              corte: Number(input.dataset.cierreCorte),
              cantidad: numero(input),
            }),
          ),

          qr_caja: importes("qr-caja"),
          qr_meseros: importes("qr-meseros"),
          tarjeta_meseros: importes("tarjeta-meseros"),
          tarjeta_caja: concepto("tarjeta-caja"),

          extras: {
            guardarropia: concepto("guardarropia"),
            qr_barra: concepto("qr-barra"),
            cover_efectivo: concepto("cover-efectivo"),
            cover_qr: concepto("cover-qr"),
          },
        },
      };
    });

    return {
      p_operacion_id: crypto.randomUUID(),
      p_cierres: cierres,
    };
  }

  function textoConfirmacion(solicitud) {
    const formato = new Intl.NumberFormat("es-BO");

    const lineas = solicitud.p_cierres.map((cierre) => {
      const caja = pantalla.payposResumenCierre?.cajas?.find(
        (item) => item.turno_id === cierre.turno_id,
      );

      const detalle = cierre.detalle;
      const sumar = (valores) =>
        valores.reduce((suma, valor) => suma + valor, 0);

      const efectivo = detalle.cortes.reduce(
        (suma, corte) => suma + corte.corte * corte.cantidad,
        0,
      );

      const qr = sumar(detalle.qr_caja) + sumar(detalle.qr_meseros);

      const tarjeta = detalle.tarjeta_caja + sumar(detalle.tarjeta_meseros);

      return [
        caja?.caja_nombre || `Turno ${cierre.turno_id}`,
        `Efectivo contado: Bs ${formato.format(efectivo)}`,
        `QR contado: Bs ${formato.format(qr)}`,
        `Tarjeta contada: Bs ${formato.format(tarjeta)}`,
        `Diferencia total: Bs ${formato.format(
          efectivo +
            qr +
            tarjeta -
            cierre.app_esperado.efectivo -
            cierre.app_esperado.qr -
            cierre.app_esperado.tarjeta,
        )}`,
      ].join("\n");
    });

    return (
      "REVISA LOS CONTEOS ANTES DE CERRAR\n\n" +
      lineas.join("\n\n") +
      "\n\nSe cerrarán estos turnos y ya no podrán vender." +
      "\nLas cajas sin ventas con monto no imprimirán comprobante." +
      "\n\n¿Confirmas el cierre?"
    );
  }

  boton.addEventListener("click", async () => {
    if (procesando || !autorizado()) return;

    const usuario = usuarioActual();
    let solicitud;

    try {
      solicitud = leerPendiente() || prepararSolicitud();

      if (!window.confirm(textoConfirmacion(solicitud))) {
        return;
      }

      // Guardar antes de enviar: un reintento conservará
      // la misma ID y los mismos datos.
      sessionStorage.setItem(
        clavePendiente(usuario),
        JSON.stringify(solicitud),
      );
    } catch (error) {
      mensaje.textContent = error.message;
      return;
    }

    procesando = true;
    pantalla.inert = true;
    actualizarBoton();

    mensaje.textContent = "Guardando y cerrando cajas…";

    let resultado = null;

    try {
      if (!db) {
        throw new Error("No hay conexión con Supabase.");
      }

      const { data, error } = await db.rpc(
        "pos_cerrar_cajas_centralizado",
        solicitud,
      );

      if (error) {
        // Un error de PostgreSQL confirma que la operación
        // se revirtió. Un fallo de red puede ser incierto.
        if (
          typeof error.code === "string" &&
          /^[0-9A-Z]{5}$/.test(error.code)
        ) {
          sessionStorage.removeItem(clavePendiente(usuario));
        }

        throw error;
      }

      if (
        data?.operacion_id !== solicitud.p_operacion_id ||
        !Array.isArray(data.cierres) ||
        data.cierres.length !== solicitud.p_cierres.length
      ) {
        throw new Error(
          "No se pudo verificar la respuesta. Reintenta el cierre pendiente.",
        );
      }

      resultado = data;

      // El servidor ya confirmó el cierre.
      try {
        sessionStorage.removeItem(clavePendiente(usuario));
      } catch {
        // Si queda pendiente, el servidor devolverá el mismo cierre.
      }

      if (usuario !== usuarioActual()) return;

      ultimoResultado = data;

      for (const cierre of data.cierres) {
        const hoja = [
          ...contenedor.querySelectorAll("[data-cierre-hoja]"),
        ].find((item) => item.dataset.turnoId === cierre.turno_id);

        if (hoja) {
          hoja.querySelectorAll("input").forEach((input) => {
            input.value = "";
          });
        }
      }

      if (
        data.cierres.some(
          (cierre) => cierre.turno_id === window.payposTurnoActual?.id,
        )
      ) {
        window.payposTurnoActual = null;

        document.dispatchEvent(
          new CustomEvent("paypos:turno-cambiado", {
            detail: null,
          }),
        );
      }

      document.dispatchEvent(new Event("paypos:ventas-actualizadas"));

      mensaje.textContent =
        "Cajas cerradas y guardadas. Preparando comprobantes…";
    } catch (error) {
      console.error("PayPos · cierre centralizado:", error);

      if (usuario === usuarioActual()) {
        mensaje.textContent =
          (error?.message || "No se pudo confirmar el cierre.") +
          " Si quedó una solicitud pendiente, usa Reintentar cierre pendiente.";

        // Refresca APP para detectar turnos cerrados o ventas nuevas.
        document.dispatchEvent(new Event("paypos:ventas-actualizadas"));
      }
    } finally {
      procesando = false;
      pantalla.inert = pantalla.hidden;
      actualizarBoton();
    }

    // Imprimir fuera del bloque de guardado:
    // un fallo de impresión nunca vuelve a cerrar las cajas.
    if (resultado && usuario === usuarioActual()) {
      try {
        await window.payposImprimirCierres(resultado.cierres);

        mensaje.textContent =
          "Cierre guardado. Si cancelaste la impresión, usa Reimprimir último cierre.";
      } catch (error) {
        console.error("PayPos · imprimir cierres:", error);

        mensaje.textContent =
          "Las cajas están cerradas y guardadas. No se pudo imprimir: " +
          error.message +
          " Usa Reimprimir último cierre.";
      }
    }
  });

  reimprimir.addEventListener("click", async () => {
    if (procesando || !autorizado()) return;

    const usuario = usuarioActual();

    procesando = true;
    actualizarBoton();

    try {
      let cierres = ultimoResultado?.cierres;

      // Si se recargó la página, recuperar el último cierre
      // realizado por este usuario desde Supabase.
      if (!cierres) {
        const ultima = await db
          .from("pos_cierres_centralizados")
          .select("operacion_id")
          .eq("cerrado_por", usuario)
          .order("cerrado_en", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (ultima.error) throw ultima.error;

        if (!ultima.data) {
          throw new Error(
            "Tu usuario todavía no tiene un cierre centralizado guardado.",
          );
        }

        const respuesta = await db
          .from("pos_cierres_centralizados")
          .select("resumen")
          .eq("operacion_id", ultima.data.operacion_id)
          .eq("cerrado_por", usuario);

        if (respuesta.error) throw respuesta.error;

        cierres = respuesta.data.map((fila) => fila.resumen);
      }

      if (usuario !== usuarioActual()) return;

      await window.payposImprimirCierres(cierres);
    } catch (error) {
      if (usuario === usuarioActual()) {
        mensaje.textContent =
          error?.message || "No se pudo reimprimir el cierre.";
      }
    } finally {
      procesando = false;
      actualizarBoton();
    }
  });

  pantalla.addEventListener("paypos:cierre-app-cargado", actualizarBoton);

  document.addEventListener("paypos:acceso-cambiado", () => {
    ultimoResultado = null;
    actualizarBoton();
  });

  new MutationObserver(actualizarBoton).observe(pantalla, {
    attributes: true,
    attributeFilter: ["hidden"],
  });

  actualizarBoton();
})();
document.documentElement.classList.toggle(
  "ventas-lenovo",
  localStorage.getItem("paypos-ventas-lenovo") === "1"
);
/* Ajuste permanente de Ventas en la Lenovo activada */
(() => {
  if (localStorage.getItem("paypos-ventas-lenovo") !== "1") return;

  const id = "ajuste-ventas-lenovo";
  document.getElementById(id)?.remove();

  const estilo = document.createElement("style");
  estilo.id = id;
  estilo.textContent = `
    #pagina-ventas .ventas-caja-principal {
      min-height: 0 !important;
      padding: 12px 18px !important;
    }
    #pagina-ventas .ventas-caja-cabecera h2 {
      font-size: 16px !important;
    }
    #pagina-ventas .ventas-recargar {
      width: 32px !important;
      height: 32px !important;
    }
    #pagina-ventas .ventas-caja-selector {
      margin-top: 6px !important;
      min-height: 32px !important;
    }
    #pagina-ventas .ventas-total-centro {
      margin-top: 8px !important;
    }
    #pagina-ventas .ventas-total-numero strong {
      font-size: 48px !important;
    }
    #pagina-ventas .ventas-metodos {
      margin-top: 28px !important;
    }
    #pagina-ventas .ventas-metodo {
      min-height: 70px !important;
      padding: 24px 6px 8px !important;
    }
    #pagina-ventas .ventas-metodo-icono {
      top: -18px !important;
      width: 36px !important;
      height: 36px !important;
    }
    #pagina-ventas .ventas-metodo-icono svg {
      width: 22px !important;
      height: 22px !important;
    }
  `;
  document.head.appendChild(estilo);
})();
