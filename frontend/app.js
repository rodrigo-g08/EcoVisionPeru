// =========================
// Scroll suave en index.html
// =========================
document.addEventListener("DOMContentLoaded", () => {
  console.log("[EV] DOMContentLoaded");
  const scrollButtons = document.querySelectorAll("[data-scroll]");
  scrollButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.getAttribute("data-scroll");
      const el = document.querySelector(target);
      if (el) {
        window.scrollTo({
          top: el.offsetTop - 80,
          behavior: "smooth",
        });
      }
    });
  });

  // Inicializar lógica de demo con cámara si estamos en classify.html
  initCameraPage();
});

// =========================
// DEMO CON CÁMARA + UPLOAD
// =========================
function initCameraPage() {
  console.log("[EV] initCameraPage() llamado");

  const video = document.getElementById("cameraVideo");
  const canvasOverlay = document.getElementById("cameraOverlay");
  const hintEl = document.getElementById("cameraHint");
  const btnStart = document.getElementById("btnStartCamera");
  const btnCapture = document.getElementById("btnCapture");
  const resultLabel = document.getElementById("resultLabel");
  const resultConfidence = document.getElementById("resultConfidence");
  const resultHint = document.getElementById("resultHint");
  const historyList = document.getElementById("historyList");
  const fileInput = document.getElementById("fileInput");
  const btnUpload = document.getElementById("btnUploadPredict");

  // Si no encontramos el video, no estamos en classify.html
  if (!video || !canvasOverlay || !btnStart || !btnCapture) {
    console.log("[EV] No es classify.html (faltan elementos de cámara)");
    return;
  }

  const ctxOverlay = canvasOverlay.getContext("2d");
  let streaming = false;
  let box = null; // {x, y, size}
  const BOX_RELATIVE_SIZE = 0.5; // 50% del lado menor

  // =========================
  // Inicializar cámara
  // =========================
  btnStart.addEventListener("click", async () => {
    console.log("[EV] click en Activar cámara");
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      hintEl.textContent =
        "Tu navegador no soporta acceso a la cámara (getUserMedia). Prueba con Chrome o Edge.";
      return;
    }

    const isLocalhost =
      location.hostname === "localhost" || location.hostname === "127.0.0.1";
    const isSecure = window.isSecureContext || isLocalhost;

    if (!isSecure) {
      hintEl.textContent =
        "Para usar la cámara abre esta página desde http://localhost o con Live Server (no como file://).";
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
        audio: false,
      });
      video.srcObject = stream;
      btnStart.textContent = "Cámara activa";
      btnStart.disabled = true;
      btnCapture.disabled = false;
      hintEl.textContent =
        "Centra el objeto en el recuadro y pulsa C o “Capturar”.";
    } catch (err) {
      console.error("Error al acceder a la cámara:", err);
      hintEl.textContent =
        "No se pudo acceder a la cámara. Revisa los permisos del navegador.";
    }
  });

  // Cuando el video esté listo, ajustamos el canvas y empezamos a dibujar el recuadro
  video.addEventListener("loadedmetadata", () => {
    console.log("[EV] video loadedmetadata");
    const rect = video.getBoundingClientRect();
    canvasOverlay.width = rect.width;
    canvasOverlay.height = rect.height;
    streaming = true;
    computeBox();
    requestAnimationFrame(drawOverlayLoop);
  });

  // Recalcular el recuadro si cambia el tamaño de ventana
  window.addEventListener("resize", () => {
    if (!streaming) return;
    const rect = video.getBoundingClientRect();
    canvasOverlay.width = rect.width;
    canvasOverlay.height = rect.height;
    computeBox();
  });

  // =========================
  // Cálculo del recuadro central
  // =========================
  function computeBox() {
    const cw = canvasOverlay.width;
    const ch = canvasOverlay.height;
    const size = Math.min(cw, ch) * BOX_RELATIVE_SIZE;
    const x = (cw - size) / 2;
    const y = (ch - size) / 2;
    box = { x, y, size };
  }

  // =========================
  // Dibujar overlay (recuadro)
// =========================
  function drawOverlayLoop() {
    if (!streaming) return;

    ctxOverlay.clearRect(0, 0, canvasOverlay.width, canvasOverlay.height);

    if (box) {
      ctxOverlay.strokeStyle = "rgba(77,166,255,0.9)";
      ctxOverlay.lineWidth = 3;
      ctxOverlay.strokeRect(box.x, box.y, box.size, box.size);
    }

    requestAnimationFrame(drawOverlayLoop);
  }

  // =========================
  // Captura desde cámara y envío al backend
  // =========================
  async function captureAndPredict() {
    console.log("[EV] captureAndPredict() llamado");
    if (!streaming) {
      hintEl.textContent = "Activa la cámara primero.";
      return;
    }
    if (!box) {
      hintEl.textContent = "No se pudo calcular el recuadro.";
      return;
    }

    const vw = video.videoWidth;
    const vh = video.videoHeight;

    if (!vw || !vh) {
      hintEl.textContent = "Esperando a que el video esté listo...";
      return;
    }

    const side = Math.min(vw, vh) * BOX_RELATIVE_SIZE;
    const sx = (vw - side) / 2;
    const sy = (vh - side) / 2;

    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = side;
    tempCanvas.height = side;
    const tctx = tempCanvas.getContext("2d");

    tctx.drawImage(video, sx, sy, side, side, 0, 0, side, side);

    const dataUrl = tempCanvas.toDataURL("image/jpeg", 0.9);
    console.log("[EV] dataUrl generado desde cámara");

    await sendToBackend(dataUrl);
  }

  // =========================
  // Upload de archivo y envío al backend
  // =========================
  async function uploadAndPredict() {
    console.log("[EV] uploadAndPredict() llamado");

    if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
      resultHint.textContent = "Selecciona primero una imagen JPG o PNG.";
      console.log("[EV] No hay archivo seleccionado");
      return;
    }

    const file = fileInput.files[0];
    console.log("[EV] Archivo seleccionado:", file.name, file.type);

    if (!file.type.startsWith("image/")) {
      resultHint.textContent =
        "El archivo debe ser una imagen (JPG, PNG, etc.).";
      console.log("[EV] Tipo de archivo NO es imagen");
      return;
    }

    let dataUrl;
    try {
      dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () =>
          reject(reader.error || new Error("Error al leer el archivo."));
        reader.readAsDataURL(file);
      });
      console.log("[EV] Imagen leída como DataURL (upload)");
    } catch (err) {
      console.error("Error leyendo el archivo:", err);
      resultLabel.textContent = "No se pudo leer la imagen seleccionada.";
      resultConfidence.textContent = "";
      resultHint.textContent = "Intenta con otro archivo JPG o PNG.";
      return;
    }

    await sendToBackend(dataUrl);
  }

  // =========================
  // Enviar imagen (base64) al backend
  // =========================
  async function sendToBackend(dataUrl) {
    console.log("[EV] Enviando al backend /predict");
    setResultLoading(true);

    try {
      const res = await fetch("https://ecovisionperu.onrender.com/predict", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_base64: dataUrl }),
      });

      console.log("[EV] Respuesta HTTP:", res.status);

      if (!res.ok) {
        throw new Error("Respuesta no OK del servidor");
      }

      const json = await res.json();
      console.log("[EV] JSON recibido:", json);
      const cls = json.class;
      const conf = json.confidence;

      updateResult(cls, conf);
      appendHistory(cls, conf);
    } catch (err) {
      console.error("Error al consultar /predict:", err);
      resultLabel.textContent = "Error al conectar con el backend.";
      resultConfidence.textContent =
        "Asegúrate de que el servidor (FastAPI) esté corriendo en http://127.0.0.1:8000.";
      resultHint.textContent =
        "Ejecuta: uvicorn server:app --reload en la carpeta backend.";
    } finally {
      setResultLoading(false);
    }
  }

  // =========================
  // UI helpers
  // =========================
  function setResultLoading(isLoading) {
    if (isLoading) {
      resultLabel.textContent = "Clasificando...";
      resultConfidence.textContent =
        "Procesando la imagen en el modelo MobileNetV5.";
      resultHint.textContent = "";
    }
  }

  function updateResult(cls, conf) {
    const pct = (conf * 100).toFixed(1);
    resultLabel.textContent = `Clase: ${cls}`;
    resultConfidence.textContent = `Confianza: ${pct}%`;

    if (conf < 0.5) {
      resultHint.textContent =
        "Confianza baja. Intenta acercar más el objeto y evitar fondos muy ruidosos.";
    } else {
      resultHint.textContent =
        "Predicción estable. Puedes capturar otro objeto para comparar resultados.";
    }
  }

  function appendHistory(cls, conf) {
    const pct = (conf * 100).toFixed(1);
    const ts = new Date().toLocaleTimeString();

    const line = document.createElement("div");
    line.style.padding = "4px 0";
    line.style.borderBottom = "1px solid rgba(255,255,255,0.04)";
    line.style.display = "flex";
    line.style.justifyContent = "space-between";
    line.style.gap = "10px";

    const left = document.createElement("span");
    left.textContent = `[${ts}] Clase: ${cls}`;
    const right = document.createElement("span");
    right.textContent = `${pct}%`;

    line.appendChild(left);
    line.appendChild(right);

    if (
      historyList &&
      historyList.firstElementChild &&
      historyList.firstElementChild.tagName === "P"
    ) {
      historyList.innerHTML = "";
    }

    historyList.appendChild(line);
    historyList.scrollTop = historyList.scrollHeight;
  }

  // =========================
  // Eventos de botones y teclado
  // =========================
  btnCapture.addEventListener("click", () => {
    captureAndPredict();
  });

  // Upload: habilitar botón y lanzar predicción
  if (fileInput && btnUpload) {
    fileInput.addEventListener("change", () => {
      const enabled = !!(fileInput.files && fileInput.files.length > 0);
      console.log("[EV] fileInput change, enabled =", enabled);
      btnUpload.disabled = !enabled;
    });

    btnUpload.addEventListener("click", (e) => {
      e.preventDefault(); // por si acaso
      console.log("[EV] click en btnUploadPredict");
      uploadAndPredict();
    });
  } else {
    console.log("[EV] No se encontró fileInput o btnUploadPredict");
  }

  // Atajos de teclado
  document.addEventListener("keydown", (e) => {
    if (e.key === "c" || e.key === "C") {
      captureAndPredict();
    }
    if (e.key === "q" || e.key === "Q") {
      resultLabel.textContent = "Aún no hay predicciones.";
      resultConfidence.textContent =
        "Captura un objeto para ver el tipo de plástico estimado.";
      resultHint.textContent =
        "Asegúrate de que el objeto ocupe la mayor parte posible del recuadro.";
    }
  });
}
