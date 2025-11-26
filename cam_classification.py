import cv2
import numpy as np
import tensorflow as tf
from tensorflow import keras
from tensorflow.keras import layers, regularizers

# ===========================
# 1. Parámetros del modelo
# ===========================
NUM_CLASSES = 5  # PC, PE, PET, PP, PS
IMG_SIZE = 224
WEIGHTS_PATH = "mobilenet_v5.weights.h5"

CLASS_NAMES = [
    "PC",   # 0
    "PE",   # 1
    "PET",  # 2
    "PP",   # 3
    "PS",   # 4
]

CONFIDENCE_THRESHOLD = 0.5   # umbral para confiar en la predicción
STD_THRESHOLD = 8.0          # umbral mínimo de textura para considerar que hay "algo" en el recuadro

# ============================================
# 2. Reconstrucción del modelo MobileNetV5 L2
# ============================================
def construir_mobilenet_v5(num_clases=NUM_CLASSES):
    data_augmentation_v5 = keras.Sequential(
        [
            layers.RandomFlip("horizontal"),
            layers.RandomRotation(0.1),
            layers.RandomZoom(0.1),
        ],
        name="data_augmentation_v5",
    )

    preprocess_input_v5 = tf.keras.applications.mobilenet_v2.preprocess_input

    base_model_v5 = tf.keras.applications.MobileNetV2(
        input_shape=(IMG_SIZE, IMG_SIZE, 3),
        include_top=False,
        weights="imagenet",
        name="mobilenetv2_1.00_224",
    )
    base_model_v5.trainable = True  # como en tu fine-tuning

    inputs = keras.Input(shape=(IMG_SIZE, IMG_SIZE, 3), name="input_layer_4")
    x = data_augmentation_v5(inputs)
    x = preprocess_input_v5(x)
    x = base_model_v5(x, training=False)
    x = layers.GlobalAveragePooling2D(name="global_average_pooling2d_1")(x)
    x = layers.Dropout(0.4, name="dropout_1")(x)
    x = layers.Dense(
        512,
        activation="relu",
        kernel_regularizer=regularizers.l2(0.001),
        name="dense_2",
    )(x)
    outputs = layers.Dense(
        num_clases,
        activation="softmax",
        kernel_regularizer=regularizers.l2(0.001),
        name="dense_3",
    )(x)

    model_v5 = keras.Model(inputs, outputs, name="Modelo_V5_L2")
    return model_v5

print("Cargando modelo MobileNetV5 y pesos...")
model = construir_mobilenet_v5(NUM_CLASSES)
model.load_weights(WEIGHTS_PATH)
print("✅ Pesos cargados desde:", WEIGHTS_PATH)

# ====================================
# 3. Preprocesamiento de la imagen
# ====================================
def preparar_imagen(roi_bgr):
    """Prepara el recorte para pasarlo al modelo."""
    img = cv2.resize(roi_bgr, (IMG_SIZE, IMG_SIZE))
    img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    img = img.astype(np.float32)
    img = np.expand_dims(img, axis=0)
    return img

def hay_objeto(roi_bgr, std_threshold=STD_THRESHOLD):
    """
    Heurística simple: si la desviación estándar en escala de grises es muy baja,
    asumimos que no hay objeto (fondo plano).
    """
    if roi_bgr.size == 0:
        return False

    gray = cv2.cvtColor(roi_bgr, cv2.COLOR_BGR2GRAY)
    std = gray.std()
    return std >= std_threshold

def dibujar_texto_con_fondo(frame, texto, x, y):
    """
    Dibuja un texto con recuadro negro semitransparente detrás
    para mejorar legibilidad.
    """
    font = cv2.FONT_HERSHEY_SIMPLEX
    scale = 0.7
    thickness = 2

    (text_w, text_h), baseline = cv2.getTextSize(texto, font, scale, thickness)
    # Fondo negro
    cv2.rectangle(
        frame,
        (x - 5, y - text_h - 5),
        (x + text_w + 5, y + baseline + 5),
        (0, 0, 0),
        -1,
    )
    # Texto en verde
    cv2.putText(
        frame,
        texto,
        (x, y),
        font,
        scale,
        (0, 255, 0),
        thickness,
        cv2.LINE_AA,
    )

# ====================================
# 4. Inicializar cámara
# ====================================
cap = cv2.VideoCapture(0)

if not cap.isOpened():
    print("❌ No se pudo abrir la cámara.")
    exit()

print("✅ Cámara iniciada.")
print("👉 Instrucciones:")
print("   - Coloca el objeto dentro del recuadro verde (zona central).")
print("   - Presiona 'c' para capturar y clasificar.")
print("   - Presiona 'q' para salir.")

ultimo_texto = "Centra el objeto y pulsa 'c' | 'q' para salir"
flash_frames = 0  # para mostrar un flash breve al capturar

while True:
    ret, frame = cap.read()
    if not ret:
        print("❌ No se pudo leer frame de la cámara.")
        break

    # Vista espejo (más natural para el usuario)
    frame = cv2.flip(frame, 1)

    h, w, _ = frame.shape

    # Recuadro central fijo
    box_size = min(h, w) // 2
    x1 = (w - box_size) // 2
    y1 = (h - box_size) // 2
    x2 = x1 + box_size
    y2 = y1 + box_size

    # Color del recuadro (flash si acabamos de capturar)
    if flash_frames > 0:
        color_box = (0, 0, 255)  # rojo
        flash_frames -= 1
    else:
        color_box = (0, 255, 0)  # verde normal

    cv2.rectangle(frame, (x1, y1), (x2, y2), color_box, 2)

    # Texto arriba a la izquierda
    dibujar_texto_con_fondo(frame, ultimo_texto, 10, 30)

    cv2.imshow("Clasificador de Plásticos - MobileNetV5", frame)

    key = cv2.waitKey(1) & 0xFF
    if key == ord("q"):
        break

    # Clasificar solo cuando se pulsa 'c'
    if key == ord("c"):
        roi = frame[y1:y2, x1:x2]

        if not hay_objeto(roi):
            ultimo_texto = "No se detecta objeto claro en el recuadro. Ajusta y pulsa 'c'."
            flash_frames = 2
            continue

        img_prep = preparar_imagen(roi)
        preds = model.predict(img_prep, verbose=0)
        class_id = int(np.argmax(preds[0]))
        confianza = float(np.max(preds[0]))

        if 0 <= class_id < len(CLASS_NAMES):
            etiqueta = CLASS_NAMES[class_id]
        else:
            etiqueta = f"Clase {class_id}"

        print(f"Predicción: {etiqueta} - confianza {confianza*100:.1f}%")

        if confianza < CONFIDENCE_THRESHOLD:
            ultimo_texto = "Confianza baja. Acerca mejor el objeto y pulsa 'c'."
        else:
            ultimo_texto = f"{etiqueta} ({confianza*100:.1f}%)"

        # Pequeño flash visual para indicar que se tomó captura
        flash_frames = 5

cap.release()
cv2.destroyAllWindows()
print("👋 Cámara cerrada.")
