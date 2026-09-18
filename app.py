"""IrisLab - Flask web application serving the trained Iris SVM classifier.

Built from the artifacts saved by ``AI_LAB_with_dump.ipynb``:
    model/iris_model.pkl        - linear SVC trained in the notebook
    model/label_encoder.pkl     - fitted LabelEncoder for species names
    model/model_metadata.json   - feature names, target names, test accuracy

Routes
    GET  /                 -> single-page responsive frontend
    GET  /api/health       -> service + model status
    GET  /api/model-info   -> metadata (features, classes, accuracy)
    POST /api/predict      -> classify one flower (modern route)
    POST /predict          -> classify one flower (legacy notebook route)
"""
from __future__ import annotations

import json
import math
import os
import time

import joblib
import numpy as np
import pandas as pd
from flask import Flask, jsonify, render_template, request

try:  # flask-cors is optional; the app works without it (same-origin UI)
    from flask_cors import CORS
except Exception:  # pragma: no cover
    CORS = None

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_DIR = os.path.join(BASE_DIR, "model")

app = Flask(__name__, static_folder="static", template_folder="templates")
if CORS is not None:
    CORS(app, resources={r"/api/*": {"origins": "*"}, r"/predict": {"origins": "*"}})

# ---------------------------------------------------------------- model load
classifier = joblib.load(os.path.join(MODEL_DIR, "iris_model.pkl"))
encoder = joblib.load(os.path.join(MODEL_DIR, "label_encoder.pkl"))

with open(os.path.join(MODEL_DIR, "model_metadata.json"), "r", encoding="utf-8") as fh:
    METADATA = json.load(fh)

FEATURE_NAMES = METADATA["feature_names"]          # trained column order
TARGET_NAMES = METADATA["target_names"]            # ['setosa', ...]
TEST_ACCURACY = METADATA.get("test_accuracy")

# Physically plausible ranges (cm) used for input validation, taken from the
# cleaned training data (with a small margin so borderline samples pass).
FEATURE_RANGES = {
    "sepal_length": (0.5, 10.0),
    "sepal_width": (0.5, 8.0),
    "petal_length": (0.1, 10.0),
    "petal_width": (0.0, 6.0),
}
FEATURE_KEYS = ["sepal_length", "sepal_width", "petal_length", "petal_width"]


def _softmax(values: np.ndarray) -> np.ndarray:
    """Numerically stable softmax over the linear SVM decision scores."""
    values = np.asarray(values, dtype=float)
    shifted = values - values.max()
    exp = np.exp(shifted)
    return exp / exp.sum()


@app.after_request
def add_security_headers(response):
    """Lightweight hardening + cache policy for static assets."""
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
    if request.path.startswith("/static/"):
        response.headers.setdefault("Cache-Control", "public, max-age=86400")
    return response


# -------------------------------------------------------------------- routes
@app.route("/", methods=["GET"])
def home():
    """Serve the responsive single-page webapp."""
    return render_template("index.html", accuracy=TEST_ACCURACY)


@app.route("/api/health", methods=["GET"])
def health():
    return jsonify(
        {
            "status": "ok",
            "model_loaded": True,
            "model_type": type(classifier).__name__,
            "test_accuracy": TEST_ACCURACY,
        }
    )


@app.route("/api/model-info", methods=["GET"])
def model_info():
    import sklearn

    return jsonify(
        {
            "model_type": type(classifier).__name__,
            "kernel": classifier.get_params().get("kernel"),
            "feature_names": FEATURE_NAMES,
            "target_names": TARGET_NAMES,
            "test_accuracy": TEST_ACCURACY,
            "sklearn_version": sklearn.__version__,
        }
    )


def _validate_payload(data: dict):
    """Return (values, error_response). values is a list of 4 floats."""
    if not isinstance(data, dict):
        return None, (jsonify({"error": "Request body must be a JSON object."}), 400)

    values = []
    for key in FEATURE_KEYS:
        aliases = {
            "sepal_length": ["sepal_length", "sepalLength"],
            "sepal_width": ["sepal_width", "sepalWidth"],
            "petal_length": ["petal_length", "petalLength"],
            "petal_width": ["petal_width", "petalWidth"],
        }[key]
        raw = next((data[a] for a in aliases if a in data), None)
        if raw is None:
            return None, (jsonify({"error": f"Missing field: {key}"}), 400)
        try:
            num = float(raw)
        except (TypeError, ValueError):
            return None, (jsonify({"error": f"Field '{key}' must be a number (cm)."}), 400)
        if not math.isfinite(num):
            return None, (jsonify({"error": f"Field '{key}' must be a finite number."}), 400)
        low, high = FEATURE_RANGES[key]
        if not (low <= num <= high):
            return None, (
                jsonify(
                    {
                        "error": f"Field '{key}' must be between {low} and {high} cm (got {num}).",
                    }
                ),
                400,
            )
        values.append(round(num, 3))
    return values, None


def _classify(values: list) -> dict:
    """Run the saved model and build the prediction response."""
    started = time.perf_counter()
    input_df = pd.DataFrame([values], columns=FEATURE_NAMES)
    prediction = classifier.predict(input_df)
    species = encoder.inverse_transform(prediction)[0]

    # Linear SVC exposes decision_function (signed distance to hyperplanes).
    # A softmax over those scores gives an intuitive relative confidence.
    decision = classifier.decision_function(input_df)[0]
    confidence_scores = _softmax(decision)
    predicted_index = int(np.argmax(confidence_scores))

    latency_ms = round((time.perf_counter() - started) * 1000, 2)

    return {
        "prediction": str(species),
        "prediction_index": int(prediction[0]),
        "confidence": round(float(confidence_scores[predicted_index]), 4),
        "confidence_scores": {
            name: round(float(score), 4)
            for name, score in zip(TARGET_NAMES, confidence_scores)
        },
        "decision_scores": {
            name: round(float(score), 4) for name, score in zip(TARGET_NAMES, decision)
        },
        "input": dict(zip(FEATURE_KEYS, values)),
        "latency_ms": latency_ms,
    }


@app.route("/api/predict", methods=["POST"])
def predict():
    values, error = _validate_payload(request.get_json(silent=True))
    if error:
        return error
    return jsonify(_classify(values))


@app.route("/predict", methods=["POST"])
def predict_legacy():
    """Legacy route kept for compatibility with the notebook's API contract."""
    return predict()


# ------------------------------------------------------------ error handlers
@app.errorhandler(404)
def not_found(_e):
    if request.path.startswith("/api"):
        return jsonify({"error": "Endpoint not found"}), 404
    return render_template("index.html", accuracy=TEST_ACCURACY)


@app.errorhandler(500)
def server_error(e):  # pragma: no cover
    if request.path.startswith("/api"):
        return jsonify({"error": "Internal server error", "detail": str(e)}), 500
    return "Internal server error", 500


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)
