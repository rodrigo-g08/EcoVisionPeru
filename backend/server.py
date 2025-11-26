import base64
import io
import numpy as np
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from PIL import Image

import tensorflow as tf
from tensorflow import keras
from tensorflow.keras import layers, regularizers


# =========================================
# CONFIGURACIÓN FASTAPI
# =========================================
app = FastAPI()

# Permitir acceso al frontend local
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],     # al estar en local, no restringimos
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# =========================================
# MODELO MobileNetV5 (reconstrucción)
# =========================================
NUM_CLASSES = 5
IMG_SIZE = 224
WEIGHTS_PATH = "mobilenet_v5.weights.h5"

CLASS_NAMES = ["PC", "PE", "PET", "PP", "PS"]


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
    base_model_v5.trainable = True

    inputs = keras.Input(shape=(IMG_SIZE, IMG_SIZE, 3), name="input_layer_4")
    x = data_augmentation_v5(inputs)
    x = preprocess_input_v5(x)
    x = base_model_v5(x, training=False)
    x = layers.GlobalAveragePooling2D(name="gap")(x)
    x = layers.Dropout(0.4)(x)
    x = layers.Dense(
        512,
        activation="relu",
        kernel_regularizer=regularizers.l2(0.001)
    )(x)

    outputs = layers.Dense(
        num_clases,
        activation="softmax",
        kernel_regularizer=regularizers.l2(0.001)
    )(x)

    model = keras.Model(inputs, outputs)
    return model


# =========================================
# CARGA DEL MODELO AL INICIAR EL SERVIDOR
# =========================================
print("🔄 Cargando MobileNetV5...")
model = construir_mobilenet_v5()
model.load_weights(WEIGHTS_PATH)
print("✅ Modelo cargado correctamente.")


# =========================================
# INPUT DE LA API
# =========================================
class ImageInput(BaseModel):
    image_base64: str


# =========================================
# ENDPOINT PRINCIPAL
# =========================================
@app.post("/predict")
def predict(input_data: ImageInput):

    # Quitar el encabezado "data:image/jpg;base64,..."
    image_b64 = input_data.image_base64.split(",")[-1]

    # Decodificar base64 → bytes
    image_bytes = base64.b64decode(image_b64)

    # Leer imagen con PIL
    img = Image.open(io.BytesIO(image_bytes)).convert("RGB")

    # Redimensionar
    img = img.resize((IMG_SIZE, IMG_SIZE))

    # Convertir a numpy
    img = np.array(img).astype(np.float32)
    img = np.expand_dims(img, axis=0)

    # Predicción
    preds = model.predict(img, verbose=0)
    class_id = int(np.argmax(preds[0]))
    confidence = float(np.max(preds[0]))

    result = {
        "class": CLASS_NAMES[class_id],
        "confidence": confidence
    }

    return result


# =========================================
# ROOT
# =========================================
@app.get("/")
def root():
    return {"message": "EcoVision API funcionando en local 🚀"}
