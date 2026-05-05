import os
import io
import uuid
import logging
import mimetypes
from flask import (Flask, render_template, request, jsonify,
                   Response, abort)
from werkzeug.utils import secure_filename
from apscheduler.schedulers.background import BackgroundScheduler

from utils.metadata import extract_metadata
from utils.gps import extract_gps_coordinates, reverse_geocode
from utils.risk import calculate_risk_score
from utils.cleaner import remove_all_metadata, remove_gps_only
from utils.compressor import compress_image
from utils.zip_utils import create_zip
from utils.cleanup import purge_old_files
from utils.preview import get_preview_b64

logging.basicConfig(level=logging.INFO)

BASE_DIR    = os.path.dirname(os.path.abspath(__file__))
UPLOAD_DIR  = os.path.join(BASE_DIR, "uploads")
CLEANED_DIR = os.path.join(BASE_DIR, "cleaned")
os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(CLEANED_DIR, exist_ok=True)

ALLOWED_EXTENSIONS = {"jpg", "jpeg", "png", "webp"}
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB

app = Flask(__name__)
app.secret_key = os.environ.get("SESSION_SECRET", "img-meta-tool-2024")
app.config["MAX_CONTENT_LENGTH"] = MAX_FILE_SIZE


def allowed_file(filename):
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS


def save_upload(file_obj):
    ext = file_obj.filename.rsplit(".", 1)[1].lower()
    uid = str(uuid.uuid4())
    fname = f"{uid}.{ext}"
    path = os.path.join(UPLOAD_DIR, fname)
    file_obj.save(path)
    return uid, fname, path


def _read_and_delete(path):
    """Read file into memory, then immediately delete it from disk."""
    with open(path, "rb") as f:
        data = f.read()
    try:
        os.remove(path)
    except Exception:
        pass
    return data


def _serve_bytes(data, download_name):
    """Return a file download Response from in-memory bytes."""
    mime = mimetypes.guess_type(download_name)[0] or "application/octet-stream"
    return Response(
        data,
        headers={
            "Content-Disposition": f'attachment; filename="{download_name}"',
            "Content-Type": mime,
            "Content-Length": str(len(data)),
            "Cache-Control": "no-store",
        }
    )


def _silent_delete(*paths):
    for p in paths:
        try:
            if p and os.path.exists(p):
                os.remove(p)
        except Exception:
            pass


# ── Safety-net scheduler (cleans up any orphaned files after 1 hour) ─────────
scheduler = BackgroundScheduler()
scheduler.add_job(
    func=lambda: purge_old_files(UPLOAD_DIR, CLEANED_DIR, max_age_seconds=3600),
    trigger="interval",
    minutes=30,
    id="orphan_cleanup",
)
scheduler.start()


# ── Routes ───────────────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/upload", methods=["POST"])
def upload():
    files = request.files.getlist("images")
    if not files or all(f.filename == "" for f in files):
        return jsonify({"error": "No files selected"}), 400

    results = []
    for f in files:
        if not allowed_file(f.filename):
            results.append({"error": f"'{f.filename}' is not a supported format (JPG, PNG, WEBP only)"})
            continue
        try:
            uid, fname, path = save_upload(f)
            original_size = os.path.getsize(path)
            metadata = extract_metadata(path)
            gps = extract_gps_coordinates(path)
            address = None
            if gps:
                address = reverse_geocode(gps["lat"], gps["lon"])
            risk       = calculate_risk_score(metadata)
            preview_b64 = get_preview_b64(path)
            results.append({
                "uid": uid,
                "original_name": secure_filename(f.filename),
                "filename": fname,
                "original_size": original_size,
                "metadata": metadata,
                "gps": gps,
                "address": address,
                "risk": risk,
                "preview_b64": preview_b64,
            })
        except Exception as e:
            results.append({"error": str(e)})

    if len(results) == 1:
        return jsonify(results[0])
    return jsonify({"bulk": True, "results": results})


@app.route("/clean", methods=["POST"])
def clean():
    data     = request.get_json(force=True)
    uid      = data.get("uid", "")
    fname    = data.get("filename", "")
    mode     = data.get("mode", "all")
    quality  = int(data.get("quality", 85))
    compress = bool(data.get("compress", False))

    if not fname or not uid:
        return jsonify({"error": "Missing file info"}), 400

    input_path = os.path.join(UPLOAD_DIR, fname)
    if not os.path.exists(input_path):
        return jsonify({"error": "Source file not found"}), 404

    ext      = fname.rsplit(".", 1)[1].lower()
    out_name = f"clean_{uid}.{ext}"
    out_path = os.path.join(CLEANED_DIR, out_name)

    try:
        if compress:
            compress_image(input_path, out_path, quality=quality, remove_meta=(mode == "all"))
            if mode == "gps":
                remove_gps_only(out_path, out_path)
        elif mode == "gps":
            remove_gps_only(input_path, out_path, quality=quality)
        else:
            remove_all_metadata(input_path, out_path, quality=quality)

        original_size    = os.path.getsize(input_path)
        cleaned_size     = os.path.getsize(out_path)
        after_meta       = extract_metadata(out_path)
        cleaned_preview  = get_preview_b64(out_path)

        # Upload no longer needed — delete it now
        _silent_delete(input_path)

        return jsonify({
            "cleaned_filename": out_name,
            "original_size": original_size,
            "cleaned_size": cleaned_size,
            "bytes_saved": original_size - cleaned_size,
            "after_metadata": after_meta,
            "cleaned_preview_b64": cleaned_preview,
        })
    except Exception as e:
        _silent_delete(input_path, out_path)
        return jsonify({"error": str(e)}), 500


@app.route("/download/<filename>")
def download(filename):
    safe = secure_filename(filename)
    path = os.path.join(CLEANED_DIR, safe)
    if not os.path.exists(path):
        abort(404)
    # Read into memory and immediately delete from disk
    data = _read_and_delete(path)
    return _serve_bytes(data, safe)


@app.route("/bulk-clean", methods=["POST"])
def bulk_clean():
    data     = request.get_json(force=True)
    files    = data.get("files", [])
    mode     = data.get("mode", "all")
    quality  = int(data.get("quality", 85))
    compress = bool(data.get("compress", False))

    if not files:
        return jsonify({"error": "No files provided"}), 400

    cleaned_paths  = []
    upload_paths   = []
    results        = []

    for item in files:
        uid        = item.get("uid", "")
        fname      = item.get("filename", "")
        input_path = os.path.join(UPLOAD_DIR, fname)
        if not os.path.exists(input_path):
            results.append({"uid": uid, "error": "File not found"})
            continue
        ext      = fname.rsplit(".", 1)[1].lower()
        out_name = f"clean_{uid}.{ext}"
        out_path = os.path.join(CLEANED_DIR, out_name)
        try:
            if compress:
                compress_image(input_path, out_path, quality=quality, remove_meta=(mode == "all"))
            elif mode == "gps":
                remove_gps_only(input_path, out_path, quality=quality)
            else:
                remove_all_metadata(input_path, out_path, quality=quality)
            cleaned_paths.append(out_path)
            upload_paths.append(input_path)
            results.append({"uid": uid, "cleaned_filename": out_name, "ok": True})
        except Exception as e:
            results.append({"uid": uid, "error": str(e)})

    if not cleaned_paths:
        return jsonify({"error": "No files could be processed", "results": results}), 500

    zip_name = f"cleaned_batch_{uuid.uuid4().hex[:8]}.zip"
    zip_path = os.path.join(CLEANED_DIR, zip_name)
    create_zip(cleaned_paths, zip_path)

    # Delete all upload files and individual cleaned files — only ZIP remains
    _silent_delete(*upload_paths)
    _silent_delete(*cleaned_paths)

    return jsonify({"zip_filename": zip_name, "results": results})


@app.route("/download-zip/<filename>")
def download_zip(filename):
    safe = secure_filename(filename)
    path = os.path.join(CLEANED_DIR, safe)
    if not os.path.exists(path):
        abort(404)
    # Read into memory and immediately delete from disk
    data = _read_and_delete(path)
    return Response(
        data,
        headers={
            "Content-Disposition": f'attachment; filename="{safe}"',
            "Content-Type": "application/zip",
            "Content-Length": str(len(data)),
            "Cache-Control": "no-store",
        }
    )


# ── API Endpoint ─────────────────────────────────────────────────

@app.route("/api/clean", methods=["POST"])
def api_clean():
    if "image" not in request.files:
        return jsonify({"error": "No image provided"}), 400
    f = request.files["image"]
    if not allowed_file(f.filename):
        return jsonify({"error": "Unsupported format"}), 400

    mode    = request.form.get("mode", "all")
    quality = int(request.form.get("quality", 85))

    uid, fname, input_path = save_upload(f)
    ext      = fname.rsplit(".", 1)[1].lower()
    out_name = f"clean_{uid}.{ext}"
    out_path = os.path.join(CLEANED_DIR, out_name)

    try:
        if mode == "gps":
            remove_gps_only(input_path, out_path, quality=quality)
        else:
            remove_all_metadata(input_path, out_path, quality=quality)
        # Read cleaned file, delete both files, return bytes
        data = _read_and_delete(out_path)
        _silent_delete(input_path)
        return _serve_bytes(data, out_name)
    except Exception as e:
        _silent_delete(input_path, out_path)
        return jsonify({"error": str(e)}), 500


# ── PWA ──────────────────────────────────────────────────────────

@app.route("/manifest.json")
def manifest():
    import json
    data = {
        "name": "Image Metadata Removal Tool",
        "short_name": "MetaCleaner",
        "start_url": "/",
        "display": "standalone",
        "background_color": "#0f172a",
        "theme_color": "#6366f1",
        "description": "Remove EXIF metadata from images to protect your privacy.",
        "icons": [
            {"src": "/static/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any maskable"},
            {"src": "/static/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable"},
        ]
    }
    return Response(json.dumps(data), mimetype="application/manifest+json")


@app.route("/sw.js")
def service_worker():
    js = """
const CACHE = 'metacleaner-v1';
const ASSETS = ['/', '/static/style.css', '/static/script.js'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});
"""
    return Response(js, mimetype="application/javascript")


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)
