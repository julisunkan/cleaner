import os
import time
import logging

logger = logging.getLogger(__name__)

DEFAULT_MAX_AGE = 3600  # 1 hour fallback for orphaned files


def purge_old_files(*directories, max_age_seconds=DEFAULT_MAX_AGE):
    now = time.time()
    removed = 0
    for directory in directories:
        if not os.path.isdir(directory):
            continue
        for fname in os.listdir(directory):
            fpath = os.path.join(directory, fname)
            if fname.startswith("."):
                continue
            try:
                age = now - os.path.getmtime(fpath)
                if age > max_age_seconds:
                    os.remove(fpath)
                    removed += 1
                    logger.info(f"Auto-deleted orphan: {fpath}")
            except Exception as e:
                logger.warning(f"Could not remove {fpath}: {e}")
    return removed


def delete_file(filepath):
    try:
        if os.path.exists(filepath):
            os.remove(filepath)
            return True
    except Exception:
        pass
    return False


def get_file_expiry_info(filepath, max_age_seconds=DEFAULT_MAX_AGE):
    try:
        mtime = os.path.getmtime(filepath)
        age = time.time() - mtime
        remaining = max_age_seconds - age
        return {
            "created_ts": mtime,
            "remaining_seconds": max(0, int(remaining)),
            "expires_in_days": max(0, remaining / 86400),
        }
    except Exception:
        return None
