import base64
import io
from PIL import Image


def get_preview_b64(path, max_width=700):
    """Return a base64-encoded JPEG preview of the image, stripped of all metadata."""
    img = Image.open(path)
    # Convert to RGB so JPEG encoding always works (handles RGBA/P modes)
    if img.mode not in ("RGB", "L"):
        img = img.convert("RGB")
    # Resize if wider than max_width
    if img.width > max_width:
        ratio = max_width / img.width
        new_h = int(img.height * ratio)
        img = img.resize((max_width, new_h), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=82, optimize=True)
    buf.seek(0)
    return "data:image/jpeg;base64," + base64.b64encode(buf.read()).decode("ascii")
