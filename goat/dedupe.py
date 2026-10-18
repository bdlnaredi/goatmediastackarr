#!/usr/bin/env python3
"""dedupe DIR [DIR...]: replace identical files across the given folders with hardlinks to one copy.

Sonarr, Radarr, Lidarr and Prowlarr each ship their own copy of the .NET runtime. When the copies match file for
file, hardlinking them in the same build step means the image stores each file once. Files that differ are left
alone, so every app still runs with exactly the files it shipped with.
"""
import hashlib, os, sys

def digest(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()

def main(dirs):
    by_size = {}
    for d in dirs:
        for root, _, files in os.walk(d):
            for n in files:
                p = os.path.join(root, n)
                if os.path.islink(p) or not os.path.isfile(p):
                    continue
                st = os.stat(p)
                if st.st_size >= 4096:
                    by_size.setdefault(st.st_size, []).append(p)
    saved = linked = 0
    for size, paths in by_size.items():
        if len(paths) < 2:
            continue
        seen = {}
        for p in paths:
            key = (digest(p), os.stat(p).st_mode)
            first = seen.setdefault(key, p)
            if first == p or os.stat(first).st_ino == os.stat(p).st_ino:
                continue
            tmp = p + '.dedupe'
            os.link(first, tmp)
            os.replace(tmp, p)
            saved += size
            linked += 1
    print(f'dedupe: {linked} duplicate files hardlinked, {saved / 1048576:.0f} MB saved')
    return saved

if __name__ == '__main__':
    main(sys.argv[1:])
