# LichtspielBridge — Ableton MIDI Remote Script
# ------------------------------------------------------------------------------
# Streams the live Live-Set state (transport / selection / clip) to the
# Lichtspiel live-bridge as OSC:  /lichtspiel/state <json>  on udp 127.0.0.1:7400
#
# This is a drop-in replacement for the Max for Live device's
# live_api_helpers.js — same OSC address, same LiveSessionState JSON, same port —
# so the bridge needs ZERO changes. No Max patch required.
#
# The emitted JSON matches packages/schemas LiveSessionState.schema.json exactly
# (every object is additionalProperties:false, so we send those keys and no more).
#
# Install:   copy this folder to <User Library>/Remote Scripts/LichtspielBridge/
# Activate:  restart Live, then Settings -> Link/Tempo/MIDI -> Control Surface
#            dropdown -> "LichtspielBridge".
# ------------------------------------------------------------------------------
from __future__ import absolute_import, print_function, unicode_literals

from _Framework.ControlSurface import ControlSurface
import socket
import json
import time

BRIDGE_HOST = "127.0.0.1"
BRIDGE_PORT = 7400              # LICHTSPIEL_OSC_MAX_TO_BRIDGE_PORT (Max->bridge)
OSC_ADDRESS = "/lichtspiel/state"
EMIT_EVERY_N_TICKS = 1         # update_display ~10 Hz; 2 => ~5 Hz, etc.


def create_instance(c_instance):
    return LichtspielBridge(c_instance)


# --- minimal OSC 1.0 encoder (null-terminated, 4-byte padded ASCII strings) ---
def _osc_string(s):
    b = s.encode("ascii", "replace") + b"\x00"
    b += b"\x00" * ((-len(b)) % 4)
    return b


def _osc_message(address, json_str):
    # one string arg => typetag ",s"
    return _osc_string(address) + _osc_string(",s") + _osc_string(json_str)


class LichtspielBridge(ControlSurface):
    def __init__(self, c_instance):
        ControlSurface.__init__(self, c_instance)
        self._tick = 0
        self._sock = None
        self._fail_logged = False
        try:
            self._sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        except Exception as e:
            self.log_message("LichtspielBridge: socket init failed: " + str(e))
        self.log_message(
            "LichtspielBridge -> OSC %s:%d %s" % (BRIDGE_HOST, BRIDGE_PORT, OSC_ADDRESS)
        )
        self.show_message("Lichtspiel: streaming Live state to bridge :%d" % BRIDGE_PORT)
        self._emit()  # send an initial frame immediately

    def disconnect(self):
        try:
            if self._sock:
                self._sock.close()
        except Exception:
            pass
        ControlSurface.disconnect(self)

    # Live calls this on the main thread roughly every 100 ms — our safe tick to
    # read the LOM (thread-safe here) and emit.
    def update_display(self):
        ControlSurface.update_display(self)
        self._tick += 1
        if self._tick % EMIT_EVERY_N_TICKS == 0:
            self._emit()

    def _emit(self):
        if not self._sock:
            return
        try:
            payload = self._build_state()
            data = json.dumps(payload)  # ensure_ascii=True -> pure-ASCII wire
            self._sock.sendto(_osc_message(OSC_ADDRESS, data), (BRIDGE_HOST, BRIDGE_PORT))
        except Exception as e:
            if not self._fail_logged:
                self.log_message("LichtspielBridge emit error: " + str(e))
                self._fail_logged = True

    # Every LOM access is guarded so a None/master/return object never breaks the
    # frame — we fall back to the schema's neutral defaults (mirrors the Max js).
    def _build_state(self):
        song = self.song()

        # ---- transport ----
        try:
            sig_num = int(song.signature_numerator)
        except Exception:
            sig_num = 4
        if sig_num <= 0:
            sig_num = 4
        try:
            song_time = float(song.current_song_time)  # in beats
        except Exception:
            song_time = 0.0
        bar = int(song_time // sig_num) + 1            # 1-based bar
        beat = (song_time % sig_num) + 1.0             # 1-based beat within bar
        try:
            is_playing = bool(song.is_playing)
        except Exception:
            is_playing = False
        try:
            tempo = float(song.tempo)
        except Exception:
            tempo = 120.0

        transport = {"isPlaying": is_playing, "tempo": tempo, "beat": beat, "bar": bar}

        # ---- selection (track / scene / highlighted clip slot) ----
        selection = {
            "trackIndex": -1, "trackName": "",
            "sceneIndex": -1, "sceneName": "",
            "clipSlotIndex": -1, "clipName": "", "clipColor": "", "clipType": "unknown",
        }
        clip_info = {
            "lengthBeats": 0.0, "loopStart": 0.0, "loopEnd": 0.0,
            "isLooping": False, "audioFilePath": None, "midiSummary": None,
        }

        try:
            sel_track = song.view.selected_track
            if sel_track is not None:
                selection["trackName"] = str(sel_track.name)
                tracks = list(song.tracks)
                if sel_track in tracks:
                    selection["trackIndex"] = tracks.index(sel_track)
        except Exception:
            pass

        try:
            sel_scene = song.view.selected_scene
            if sel_scene is not None:
                selection["sceneName"] = str(sel_scene.name)
                scenes = list(song.scenes)
                if sel_scene in scenes:
                    selection["sceneIndex"] = scenes.index(sel_scene)
        except Exception:
            pass

        # clip slot index == highlighted slot's scene index
        selection["clipSlotIndex"] = selection["sceneIndex"]

        try:
            slot = song.view.highlighted_clip_slot
            clip = slot.clip if slot is not None else None
            if clip is not None:
                selection["clipName"] = str(clip.name)
                try:
                    selection["clipColor"] = "#%06X" % (int(clip.color) & 0xFFFFFF)
                except Exception:
                    selection["clipColor"] = ""
                if getattr(clip, "is_midi_clip", False):
                    selection["clipType"] = "midi"
                elif getattr(clip, "is_audio_clip", False):
                    selection["clipType"] = "audio"
                try:
                    clip_info["lengthBeats"] = float(clip.length)
                except Exception:
                    pass
                try:
                    clip_info["loopStart"] = float(clip.loop_start)
                    clip_info["loopEnd"] = float(clip.loop_end)
                except Exception:
                    pass
                try:
                    clip_info["isLooping"] = bool(clip.looping)
                except Exception:
                    pass
                if selection["clipType"] == "audio":
                    try:
                        fp = clip.file_path
                        clip_info["audioFilePath"] = str(fp) if fp else None
                    except Exception:
                        pass
        except Exception:
            pass

        return {
            "type": "live_session_state",
            "version": "0.1.0",
            "timestampMs": int(time.time() * 1000),
            "transport": transport,
            "selection": selection,
            "clip": clip_info,
            "devices": [],
            "performance": {
                "sceneLocked": False,
                "manualOverride": False,
                "semanticDistance": 0,
                "mutationAmount": 0,
            },
        }
