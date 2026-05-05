import piexif
from PIL import Image
import io


def remove_all_metadata(input_path, output_path, quality=85):
    img = Image.open(input_path)
    img = _strip_icc_and_info(img)

    fmt = img.format or "JPEG"
    if fmt.upper() == "JPG":
        fmt = "JPEG"

    if fmt.upper() in ("JPEG", "WEBP"):
        img.save(output_path, format=fmt, quality=quality, optimize=True, exif=b"")
    elif fmt.upper() == "PNG":
        img.save(output_path, format="PNG", optimize=True)
    else:
        img.save(output_path, format=fmt)


def remove_gps_only(input_path, output_path, quality=85):
    img = Image.open(input_path)
    fmt = (img.format or "JPEG").upper()
    if fmt == "JPG":
        fmt = "JPEG"

    raw_exif = img.info.get("exif")

    if not raw_exif:
        img.save(output_path, format=fmt, quality=quality if fmt in ("JPEG", "WEBP") else None)
        return

    try:
        exif_dict = piexif.load(raw_exif)
        exif_dict["GPS"] = {}
        new_exif = piexif.dump(exif_dict)
    except Exception:
        new_exif = b""

    if fmt in ("JPEG", "WEBP"):
        img.save(output_path, format=fmt, quality=quality, optimize=True, exif=new_exif)
    else:
        img.save(output_path, format="PNG", optimize=True)


def _strip_icc_and_info(img):
    data = list(img.getdata())
    clean = Image.new(img.mode, img.size)
    clean.putdata(data)
    return clean
