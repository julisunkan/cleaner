import zipfile
import os


def create_zip(file_paths, zip_path):
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for fp in file_paths:
            if os.path.exists(fp):
                zf.write(fp, arcname=os.path.basename(fp))
    return zip_path
