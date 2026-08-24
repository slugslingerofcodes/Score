#!/usr/bin/env python3
"""Static server that speaks Unity Web's compressed files.

`python -m http.server` cannot set Content-Encoding, so a Brotli Unity build
served by it hands the browser compressed bytes it will not decompress and the
loader dies. This sets the encoding and the real MIME type for .br/.gz files.

    python serve.py [port]
"""
import http.server
import re
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 5180

ENCODINGS = {".br": "br", ".gz": "gzip"}

# Content-Type has to describe the file *inside* the compression, not the
# .br wrapper, or the browser refuses to stream the wasm.
MIME = {
    ".js": "application/javascript",
    ".wasm": "application/wasm",
    ".data": "application/octet-stream",
    ".symbols.json": "application/json",
}


class Handler(http.server.SimpleHTTPRequestHandler):
    def guess_type(self, path):
        for suffix in ENCODINGS:
            if path.endswith(suffix):
                stem = path[: -len(suffix)]
                for ext, mime in MIME.items():
                    if stem.endswith(ext):
                        return mime
        return super().guess_type(path)

    def end_headers(self):
        path = self.path.split("?")[0]
        for suffix, encoding in ENCODINGS.items():
            if path.endswith(suffix):
                self.send_header("Content-Encoding", encoding)
                break
        # The Unity build is the only thing worth caching, and its files are
        # hash-named, so this is safe and makes reloads instant. Everything
        # else is source you are actively editing -- caching it means a stale
        # ES module silently shadows your change, which looks like a bug in
        # the code rather than in the browser.
        # `immutable` is only safe when the filename carries a content hash
        # (webGLNameFilesAsHashes). A build named two.data / two.wasm reuses
        # the same URL every time, so pinning it for a year would leave this
        # browser on a stale player until someone cleared their cache by hand.
        if "/Build/" in path:
            hashed = re.search(r"/[0-9a-f]{32}\.", path) is not None
            self.send_header(
                "Cache-Control",
                "public, max-age=31536000, immutable" if hashed
                else "public, max-age=0, must-revalidate",
            )
        else:
            self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write("%s %s\n" % (self.address_string(), fmt % args))


if __name__ == "__main__":
    # Threaded, not TCPServer: the Unity loader pulls the loader, framework,
    # wasm and data files in parallel, and a single-threaded server serialises
    # them -- which on a 13 MB build looks like a hang.
    #
    # allow_reuse_address is deliberately NOT set. On Windows it does not just
    # forgive TIME_WAIT, it lets a second process bind a port another process
    # is already listening on; requests then land on either at random, and a
    # stale server quietly serving old headers is far harder to diagnose than
    # a refused bind.
    http.server.ThreadingHTTPServer.daemon_threads = True

    try:
        httpd = http.server.ThreadingHTTPServer(("", PORT), Handler)
    except OSError as exc:
        sys.exit(
            "could not bind port %d: %s -- something is already serving it, "
            "stop that first." % (PORT, exc)
        )

    with httpd:
        print("serving . on http://localhost:%d" % PORT, flush=True)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("stopped")
