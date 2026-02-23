#!/usr/bin/env python3
"""
Music Catalog Analyzer

Scans the music-library folder for new audio files not yet in music-catalog.json.
For each new file:
  1. Extracts technical metadata (duration, sample rate, BPM, key) via librosa
  2. Sends the audio to OpenAI gpt-4o-audio-preview for human-style analysis
  3. Appends the result to music-catalog.json

Usage:
  pip install openai librosa numpy
  export OPENAI_API_KEY="sk-..."
  python3 backend/scripts/analyze-new-music.py [--dry-run]

Options:
  --dry-run    Show which files would be added without actually analyzing them
  --skip-ai    Extract technical metadata only, skip OpenAI analysis
"""

import argparse
import base64
import json
import os
import sys
from datetime import datetime
from pathlib import Path

# ─── Paths ───────────────────────────────────────────────────────────────────
SCRIPT_DIR = Path(__file__).resolve().parent
BACKEND_DIR = SCRIPT_DIR.parent
MUSIC_DIR = BACKEND_DIR / "uploads" / "music-library"
CATALOG_PATH = BACKEND_DIR / "src" / "data" / "music-catalog.json"

SUPPORTED_EXTENSIONS = {".mp3", ".wav", ".flac", ".ogg", ".m4a", ".aac"}
MAX_OPENAI_FILE_SIZE_MB = 24  # OpenAI audio input limit


def load_catalog() -> dict:
    """Load existing catalog JSON."""
    if not CATALOG_PATH.exists():
        return {
            "metadata": {
                "total_tracks": 0,
                "source_folder": str(MUSIC_DIR),
                "generated_at": datetime.now().isoformat(),
                "openai_model": "gpt-4o-audio-preview",
            },
            "tracks": [],
        }
    with open(CATALOG_PATH, "r") as f:
        return json.load(f)


def save_catalog(catalog: dict) -> None:
    """Write catalog back to disk."""
    catalog["metadata"]["total_tracks"] = len(catalog["tracks"])
    catalog["metadata"]["generated_at"] = datetime.now().isoformat()
    with open(CATALOG_PATH, "w") as f:
        json.dump(catalog, f, indent=2, ensure_ascii=False)
    print(f"  Saved catalog ({catalog['metadata']['total_tracks']} total tracks)")


def get_cataloged_filenames(catalog: dict) -> set:
    """Return set of filenames already in the catalog."""
    return {track["filename"] for track in catalog["tracks"]}


def discover_new_files(catalog: dict) -> list[Path]:
    """Find audio files in MUSIC_DIR that are not yet in the catalog."""
    existing = get_cataloged_filenames(catalog)
    new_files = []
    for f in sorted(MUSIC_DIR.iterdir()):
        if f.is_file() and f.suffix.lower() in SUPPORTED_EXTENSIONS:
            if f.name not in existing:
                new_files.append(f)
    return new_files


def extract_technical_metadata(filepath: Path) -> dict:
    """Extract technical audio features using librosa."""
    try:
        import librosa
        import numpy as np
    except ImportError:
        print("  WARNING: librosa not installed. Using ffprobe fallback for basic info.")
        return extract_technical_ffprobe(filepath)

    y, sr = librosa.load(filepath, sr=None, mono=True)
    duration = librosa.get_duration(y=y, sr=sr)
    total_samples = len(y)

    # Rhythm analysis
    tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr)
    # Handle both scalar and array returns from librosa
    tempo_val = float(tempo[0]) if hasattr(tempo, '__len__') else float(tempo)
    onset_env = librosa.onset.onset_strength(y=y, sr=sr)
    avg_onset = float(np.mean(onset_env))

    # Tonal analysis (key estimation via chroma)
    chroma = librosa.feature.chroma_cqt(y=y, sr=sr)
    key_names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
    chroma_mean = np.mean(chroma, axis=1)
    key_idx = int(np.argmax(chroma_mean))
    key_confidence = float(chroma_mean[key_idx] / (np.sum(chroma_mean) + 1e-8))

    # Simple major/minor detection
    major_template = np.array([1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 1], dtype=float)
    minor_template = np.array([1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 0], dtype=float)
    rotated_chroma = np.roll(chroma_mean, -key_idx)
    major_corr = float(np.corrcoef(rotated_chroma, major_template)[0, 1])
    minor_corr = float(np.corrcoef(rotated_chroma, minor_template)[0, 1])
    mode = "major" if major_corr >= minor_corr else "minor"

    return {
        "file_info": {
            "sample_rate": int(sr),
            "duration_seconds": round(duration, 2),
            "total_samples": total_samples,
        },
        "rhythm": {
            "tempo_bpm": round(tempo_val, 2),
            "num_beats_detected": int(len(beat_frames)),
            "avg_onset_strength": round(avg_onset, 4),
        },
        "tonal": {
            "estimated_key": f"{key_names[key_idx]} {mode}",
            "key_confidence": round(key_confidence, 4),
        },
    }


def extract_technical_ffprobe(filepath: Path) -> dict:
    """Fallback: extract basic info using ffprobe when librosa is not available."""
    import subprocess

    cmd = [
        "ffprobe", "-v", "quiet", "-print_format", "json",
        "-show_format", "-show_streams", str(filepath)
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    info = json.loads(result.stdout)

    fmt = info.get("format", {})
    duration = float(fmt.get("duration", 0))

    sr = 44100
    total_samples = 0
    for stream in info.get("streams", []):
        if stream.get("codec_type") == "audio":
            sr = int(stream.get("sample_rate", 44100))
            total_samples = int(float(stream.get("duration", duration)) * sr)
            break

    return {
        "file_info": {
            "sample_rate": sr,
            "duration_seconds": round(duration, 2),
            "total_samples": total_samples,
        },
        "rhythm": {
            "tempo_bpm": 0,
            "num_beats_detected": 0,
            "avg_onset_strength": 0,
        },
        "tonal": {
            "estimated_key": "unknown",
            "key_confidence": 0,
        },
    }


HUMAN_ANALYSIS_PROMPT = """Analyze this audio track and return a JSON object with exactly these fields:
{
  "genre": "primary genre, with sub-genres if applicable",
  "mood": "description of the mood/feeling",
  "energy_level": "low, medium, or high",
  "instruments_detected": ["list", "of", "instruments"],
  "vocal_description": "describe vocals or say 'instrumental'",
  "brief_description": "1-2 sentence description of the track",
  "suitable_use_cases": ["list", "of", "use", "cases"],
  "similar_artists_or_styles": ["list", "of", "similar", "artists"],
  "production_style": "description of production quality and style",
  "tempo_feel": "description of the rhythmic feel"
}

Return ONLY the raw JSON object, no markdown, no code blocks, no extra text."""


def analyze_with_openai(filepath: Path, api_key: str) -> dict:
    """Send audio to OpenAI gpt-4o-audio-preview for human-style analysis."""
    from openai import OpenAI

    file_size_mb = filepath.stat().st_size / (1024 * 1024)
    if file_size_mb > MAX_OPENAI_FILE_SIZE_MB:
        return {"error": f"File too large ({file_size_mb:.1f} MB). Max is {MAX_OPENAI_FILE_SIZE_MB} MB."}

    # Determine media type
    ext = filepath.suffix.lower()
    media_types = {
        ".mp3": "audio/mp3",
        ".wav": "audio/wav",
        ".flac": "audio/flac",
        ".ogg": "audio/ogg",
        ".m4a": "audio/mp4",
        ".aac": "audio/aac",
    }
    media_type = media_types.get(ext, "audio/mpeg")

    # Read and encode audio
    with open(filepath, "rb") as f:
        audio_b64 = base64.b64encode(f.read()).decode("utf-8")

    client = OpenAI(api_key=api_key)

    response = client.chat.completions.create(
        model="gpt-4o-audio-preview",
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "input_audio",
                        "input_audio": {
                            "data": audio_b64,
                            "format": ext.lstrip("."),
                        },
                    },
                    {
                        "type": "text",
                        "text": HUMAN_ANALYSIS_PROMPT,
                    },
                ],
            }
        ],
        temperature=0.3,
    )

    raw = response.choices[0].message.content.strip()

    # Try to parse the JSON response
    try:
        # Strip markdown code fences if present
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
            if raw.endswith("```"):
                raw = raw[:-3]
            raw = raw.strip()

        return json.loads(raw)
    except json.JSONDecodeError:
        return {"raw_response": raw, "parse_error": "Could not parse JSON from OpenAI response"}


def process_file(filepath: Path, api_key: str | None, skip_ai: bool) -> dict:
    """Analyze a single audio file and return a catalog entry."""
    file_size_mb = filepath.stat().st_size / (1024 * 1024)

    print(f"  Extracting technical metadata...")
    technical = extract_technical_metadata(filepath)

    if skip_ai or not api_key:
        human_analysis = {"note": "AI analysis skipped (--skip-ai or no API key)"}
    else:
        print(f"  Sending to OpenAI for analysis...")
        human_analysis = analyze_with_openai(filepath, api_key)

    return {
        "filename": filepath.name,
        "relative_path": filepath.name,
        "file_size_mb": round(file_size_mb, 2),
        "technical": technical,
        "human_analysis": human_analysis,
    }


def main():
    parser = argparse.ArgumentParser(description="Analyze new music files and add to catalog")
    parser.add_argument("--dry-run", action="store_true", help="Show new files without analyzing")
    parser.add_argument("--skip-ai", action="store_true", help="Skip OpenAI analysis, extract technical data only")
    args = parser.parse_args()

    if not MUSIC_DIR.exists():
        print(f"ERROR: Music directory not found: {MUSIC_DIR}")
        sys.exit(1)

    catalog = load_catalog()
    new_files = discover_new_files(catalog)

    if not new_files:
        print("No new music files found. Catalog is up to date.")
        sys.exit(0)

    print(f"Found {len(new_files)} new file(s):")
    for f in new_files:
        size_mb = f.stat().st_size / (1024 * 1024)
        print(f"  - {f.name} ({size_mb:.1f} MB)")

    if args.dry_run:
        print("\n[DRY RUN] No changes made.")
        sys.exit(0)

    api_key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not api_key and not args.skip_ai:
        print("\nWARNING: OPENAI_API_KEY not set. Will skip AI analysis.")
        print("  Set it with: export OPENAI_API_KEY='sk-...'")
        args.skip_ai = True

    print(f"\nProcessing {len(new_files)} file(s)...\n")

    for i, filepath in enumerate(new_files, 1):
        print(f"[{i}/{len(new_files)}] {filepath.name}")
        try:
            entry = process_file(filepath, api_key if not args.skip_ai else None, args.skip_ai)
            catalog["tracks"].append(entry)
            save_catalog(catalog)
            print(f"  Done.\n")
        except Exception as e:
            print(f"  ERROR: {e}\n")
            # Add entry with error info so it can be retried
            catalog["tracks"].append({
                "filename": filepath.name,
                "relative_path": filepath.name,
                "file_size_mb": round(filepath.stat().st_size / (1024 * 1024), 2),
                "technical": {"error": str(e)},
                "human_analysis": {"error": str(e)},
            })
            save_catalog(catalog)

    print(f"Catalog updated: {CATALOG_PATH}")
    print(f"Total tracks: {catalog['metadata']['total_tracks']}")


if __name__ == "__main__":
    main()
