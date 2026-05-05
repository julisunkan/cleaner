from PIL import Image


def compress_image(input_path, output_path, quality=75, remove_meta=True):
    img = Image.open(input_path)
    fmt = (img.format or "JPEG").upper()
    if fmt == "JPG":
        fmt = "JPEG"

    save_kwargs = {"optimize": True}

    if fmt in ("JPEG", "WEBP"):
        save_kwargs["quality"] = quality
        save_kwargs["format"] = fmt
        if remove_meta:
            save_kwargs["exif"] = b""
    elif fmt == "PNG":
        save_kwargs["format"] = "PNG"
        save_kwargs["compress_level"] = max(1, min(9, 9 - quality // 11))
    else:
        save_kwargs["format"] = fmt

    img.save(output_path, **save_kwargs)
