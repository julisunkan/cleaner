import piexif
from PIL import Image


# ── Internal helpers ──────────────────────────────────────────────

def _resolve_fmt(img, output_format):
    src = (img.format or "JPEG").upper()
    if src == "JPG":
        src = "JPEG"
    if not output_format or output_format.lower() == "same":
        return src
    mapping = {"jpeg": "JPEG", "jpg": "JPEG", "png": "PNG", "webp": "WEBP"}
    return mapping.get(output_format.lower(), src)


def _resize(img, max_width, max_height=None):
    if not max_width and not max_height:
        return img
    w, h = img.size
    if max_width and w > max_width:
        ratio = max_width / w
        img = img.resize((max_width, int(h * ratio)), Image.LANCZOS)
    w, h = img.size
    if max_height and h > max_height:
        ratio = max_height / h
        img = img.resize((int(w * ratio), max_height), Image.LANCZOS)
    return img


def _ensure_mode(img, fmt):
    if fmt == "JPEG" and img.mode in ("RGBA", "P", "LA"):
        img = img.convert("RGB")
    return img


def _save(img, output_path, fmt, quality, exif_bytes=b""):
    img = _ensure_mode(img, fmt)
    if fmt == "JPEG":
        img.save(output_path, format="JPEG", quality=quality, optimize=True, exif=exif_bytes)
    elif fmt == "PNG":
        img.save(output_path, format="PNG", optimize=True)
    elif fmt == "WEBP":
        img.save(output_path, format="WEBP", quality=quality, exif=exif_bytes if exif_bytes else b"")
    else:
        img.save(output_path, format=fmt)


def _strip_icc_and_info(img):
    data = list(img.getdata())
    clean = Image.new(img.mode, img.size)
    clean.putdata(data)
    return clean


# ── Public API ────────────────────────────────────────────────────

def remove_all_metadata(input_path, output_path, quality=85,
                        output_format=None, max_width=None, max_height=None):
    img = Image.open(input_path)
    fmt = _resolve_fmt(img, output_format)
    img = _strip_icc_and_info(img)
    img = _resize(img, max_width, max_height)
    _save(img, output_path, fmt, quality, exif_bytes=b"")


def remove_gps_only(input_path, output_path, quality=85,
                    output_format=None, max_width=None, max_height=None):
    img = Image.open(input_path)
    fmt = _resolve_fmt(img, output_format)
    raw_exif = img.info.get("exif")
    if not raw_exif:
        new_exif = b""
    else:
        try:
            exif_dict = piexif.load(raw_exif)
            exif_dict["GPS"] = {}
            new_exif = piexif.dump(exif_dict)
        except Exception:
            new_exif = b""
    img = _resize(img, max_width, max_height)
    _save(img, output_path, fmt, quality, exif_bytes=new_exif)


def remove_custom_fields(input_path, output_path, fields_to_remove=None,
                         quality=85, output_format=None,
                         max_width=None, max_height=None):
    """Remove only the specified EXIF fields (by 'ifd_name:tag_id' keys).
    All other metadata is preserved."""
    img = Image.open(input_path)
    fmt = _resolve_fmt(img, output_format)
    raw_exif = img.info.get("exif")
    new_exif = b""
    if raw_exif:
        try:
            exif_dict = piexif.load(raw_exif)
            for field_key in (fields_to_remove or []):
                parts = field_key.split(":", 1)
                if len(parts) == 2:
                    ifd_name, tag_id_str = parts
                    try:
                        tag_id = int(tag_id_str)
                        if ifd_name in exif_dict and tag_id in exif_dict[ifd_name]:
                            del exif_dict[ifd_name][tag_id]
                    except (ValueError, KeyError):
                        pass
            new_exif = piexif.dump(exif_dict)
        except Exception:
            new_exif = raw_exif or b""
    img = _resize(img, max_width, max_height)
    _save(img, output_path, fmt, quality, exif_bytes=new_exif)
