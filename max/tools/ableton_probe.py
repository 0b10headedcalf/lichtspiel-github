#!/usr/bin/env python3
"""Direct client for the AbletonMCP Remote Script socket (localhost:9877).

Bypasses the MCP server so we can drive/introspect Ableton Live straight from
the shell (no Claude-client reconnect needed). Same JSON protocol the MCP server
uses: send {"type", "params"} -> read one complete JSON {"status","result"|"message"}.

Usage:
  probe.py get_scene_info
  probe.py get_session_info
  probe.py fire_scene '{"scene_index": 0}'
  probe.py set_song_position '{"time": 70}'
  probe.py start_playback
  probe.py stop_playback
"""
import socket
import json
import sys

HOST, PORT = "localhost", 9877


def cmd(ctype, params):
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(12)
    s.connect((HOST, PORT))
    s.sendall(json.dumps({"type": ctype, "params": params}).encode("utf-8"))
    buf = b""
    while True:
        try:
            chunk = s.recv(8192)
        except socket.timeout:
            break
        if not chunk:
            break
        buf += chunk
        try:
            json.loads(buf.decode("utf-8"))
            break
        except ValueError:
            continue
    s.close()
    return buf.decode("utf-8")


if __name__ == "__main__":
    ctype = sys.argv[1] if len(sys.argv) > 1 else "get_scene_info"
    params = json.loads(sys.argv[2]) if len(sys.argv) > 2 else {}
    out = cmd(ctype, params)
    try:
        print(json.dumps(json.loads(out), indent=2))
    except Exception:
        print(out)
