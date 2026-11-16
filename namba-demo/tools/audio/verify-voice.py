#!/usr/bin/env python3
"""verify-voice.py - catch voice clips that say the wrong words or are technically off.

  python3 tools/audio/verify-voice.py [--voice-dir assets/audio/voice] [--lines lines.json]
                                      [--model small] [--no-asr] [--threshold 0.85] [--only style] [--target -19]

Checks that need no recogniser (always run):
  silent        speech level too low / no speech
  clip          samples at full scale (>= 0.999) or sample peak above -1 dBFS
  loudness      integrated loudness more than 1.5 LU from the target (-19 LUFS)
  pace          seconds per mora is an outlier against the median of the same style (x0.6 .. x1.6),
                or outside 0.06 .. 0.35 s/mora in absolute terms (added or dropped words, truncated audio)
Speech recogniser check (faster-whisper + pykakasi; skipped with --no-asr or when not installed):
  the clip is transcribed in Japanese; transcript and the expected `read` text are both turned into hiragana,
  punctuation removed, and compared with difflib (ratio 0..1). Anything under --threshold (0.85) is flagged.

--lines is the JSON written for gen-voice.mjs ([{key,text,read,style,...}]); it supplies the expected text and
the style of each clip. Without it only the technical checks (and the raw transcript) are possible.
Run with `python3 -I` if the folder you run it from is not trusted. Exit code 1 if anything is flagged.
"""
import argparse, difflib, json, os, re, subprocess, sys, unicodedata
import numpy as np

SR = 44100
HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_DIR = os.path.normpath(os.path.join(HERE, '..', '..', 'assets', 'audio', 'voice'))
HEAD_TAIL = 0.06 + 0.15          # silence gen-voice.mjs leaves around the speech


def decode(path):
    b = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-f', 'f32le', '-ac', '1', '-ar', str(SR), '-'],
                       capture_output=True, check=True).stdout
    return np.frombuffer(b, '<f4').astype(np.float64)


def lufs(x):
    # ebur128 undefined for < 400 ms and unreliable < ~1 s: measure a tiled copy (same method as gen-voice.mjs)
    reps = max(1, int(np.ceil(2 * SR / len(x))))
    t = np.tile(x, reps).astype('<f4')
    r = subprocess.run(['ffmpeg', '-v', 'info', '-nostats', '-f', 'f32le', '-ar', str(SR), '-ac', '1', '-i', '-',
                        '-af', 'ebur128=peak=true', '-f', 'null', '-'], input=t.tobytes(), capture_output=True).stderr.decode()
    s = r[r.rfind('Summary'):]
    m = re.search(r'I:\s+(-?[\d.]+) LUFS', s)
    p = re.search(r'Peak:\s+(-?[\d.]+|-inf) dBFS', s)
    return (float(m.group(1)) if m else None), (float(p.group(1)) if p else None)


def speech_seconds(x):
    n = int(SR * 0.01)
    k = len(x) // n
    rms = np.sqrt((x[:k * n].reshape(k, n) ** 2).mean(1))
    act = np.nonzero(rms > 10 ** (-50 / 20))[0]
    if len(act) == 0:
        return 0.0, -120.0
    sp = x[act[0] * n:(act[-1] + 1) * n]
    return (act[-1] + 1 - act[0]) * 0.01, 20 * np.log10(np.sqrt((sp ** 2).mean()) + 1e-12)


# ---- kana helpers ----------------------------------------------------------------------------------------
KANJI_DIGITS = '〇一二三四五六七八九'


def num_to_kanji(n):
    if n < 10:
        return KANJI_DIGITS[n]
    if n < 20:
        return '十' + (KANJI_DIGITS[n - 10] if n > 10 else '')
    if n < 100:
        return (KANJI_DIGITS[n // 10] + '十' + (KANJI_DIGITS[n % 10] if n % 10 else ''))
    return ''.join(KANJI_DIGITS[int(c)] for c in str(n))


_kks = None


def to_kana(text):
    """normalise to hiragana without punctuation, so a reading difference in kanji does not count as an error"""
    global _kks
    t = unicodedata.normalize('NFKC', text)
    t = re.sub(r'\d+', lambda m: num_to_kanji(int(m.group(0))), t)
    if _kks is None:
        import pykakasi
        _kks = pykakasi.kakasi()
    out = ''.join(item['hira'] for item in _kks.convert(t))
    out = re.sub(r'[\s\W_]+', '', out, flags=re.UNICODE)   # punctuation, spaces, symbols
    return out


SMALL = set('ゃゅょぁぃぅぇぉゎ')


def morae(kana):
    return sum(1 for c in kana if c not in SMALL)


# ---- recogniser --------------------------------------------------------------------------------------------
def load_asr(model_name):
    try:
        from faster_whisper import WhisperModel
    except Exception as e:  # not installed
        return None, 'faster-whisper not available: %s' % e
    try:
        return WhisperModel(model_name, device='cpu', compute_type='int8'), None
    except Exception as e:
        return None, 'could not load model %s: %s' % (model_name, e)


def transcribe(model, path):
    # decode with ffmpeg ourselves (16 kHz mono float) rather than through PyAV, whose versions vary
    b = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-f', 'f32le', '-ac', '1', '-ar', '16000', '-'],
                       capture_output=True, check=True).stdout
    audio = np.frombuffer(b, '<f4')
    segs, _ = model.transcribe(audio, language='ja', beam_size=5, vad_filter=False, condition_on_previous_text=False,
                               temperature=0.0)
    return ''.join(s.text for s in segs).strip()


# ---- main --------------------------------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--voice-dir', default=DEFAULT_DIR)
    ap.add_argument('--lines', help='lines.json used for generation (expected text + style)')
    ap.add_argument('--model', default='small')
    ap.add_argument('--no-asr', action='store_true')
    ap.add_argument('--threshold', type=float, default=0.85)
    ap.add_argument('--only', help='only clips of this style (needs --lines)')
    ap.add_argument('--target', type=float, default=-19.0)
    a = ap.parse_args()

    # expected text per clip name (key, key_b, key_c): the `read` of the line (the same for all variants)
    exp = {}
    if a.lines:
        node = ['node', '--input-type=module', '-e',
                "import {voiceKey} from %s;import fs from 'fs';const L=JSON.parse(fs.readFileSync(%s,'utf8'));"
                "console.log(JSON.stringify(L.map(l=>({k:voiceKey(l.text),r:l.read||l.text,s:l.style}))))" % (
                    json.dumps('file://' + os.path.normpath(os.path.join(HERE, '..', '..', 'js', 'audio', 'phrases.js'))),
                    json.dumps(os.path.abspath(a.lines)))]
        try:
            for it in json.loads(subprocess.run(node, capture_output=True, check=True).stdout):
                exp[it['k']] = (it['r'], it['s'])        # key recomputed with voiceKey() like gen-voice.mjs does
        except Exception as e:
            sys.exit('cannot read --lines (needs node): %s' % e)

    files = sorted(f for f in os.listdir(a.voice_dir) if re.fullmatch(r'[0-9a-f]{8}(_b|_c)?\.mp3', f))
    if a.only:
        files = [f for f in files if exp.get(f[:8], (None, None))[1] == a.only]
    if not files:
        sys.exit('no voice clips found in %s' % a.voice_dir)

    asr, asr_msg = (None, 'skipped (--no-asr)') if a.no_asr else load_asr(a.model)
    if asr is None:
        print('speech recogniser: %s' % asr_msg)
    else:
        print('speech recogniser: faster-whisper model "%s" (cpu, int8)' % a.model)

    rows = []
    for f in files:
        p = os.path.join(a.voice_dir, f)
        x = decode(p)
        dur = len(x) / SR
        read, style = exp.get(f[:8], (None, None))
        sp_s, sp_db = speech_seconds(x)
        I, tp = lufs(x) if sp_s > 0 else (None, None)
        peak = float(np.abs(x).max()) if len(x) else 0.0
        clipped = int((np.abs(x) >= 0.999).sum())
        kana = to_kana(read) if read else None
        mor = morae(kana) if kana else None
        row = dict(file=f, dur=dur, speech=sp_s, style=style, I=I, tp=tp, peak=peak, clipped=clipped, mora=mor,
                   spm=(sp_s / mor if mor else None), read=read, kana=kana, flags=[], ratio=None, heard=None)
        if sp_s < 0.15 or sp_db < -45:
            row['flags'].append('silent')
        if clipped >= 3 or peak > 10 ** (-1 / 20):
            row['flags'].append('clip')
        if I is None or abs(I - a.target) > 1.5:
            row['flags'].append('loudness')
        rows.append(row)

    # pace: against the median of the same style (or all clips when styles are unknown), plus absolute bounds
    groups = {}
    for r in rows:
        if r['spm']:
            groups.setdefault(r['style'], []).append(r['spm'])
    for r in rows:
        if r['spm'] is None:
            continue
        g = groups[r['style']]
        med = float(np.median(g))
        r['pace_ratio'] = r['spm'] / med if len(g) >= 3 else None
        if r['spm'] < 0.06 or r['spm'] > 0.35 or (r['pace_ratio'] is not None and not 0.6 <= r['pace_ratio'] <= 1.6):
            r['flags'].append('pace')

    if asr is not None:
        for r in rows:
            r['heard'] = transcribe(asr, os.path.join(a.voice_dir, r['file']))
            if r['kana'] is not None:
                h = to_kana(r['heard'])
                r['heard_kana'] = h
                r['ratio'] = difflib.SequenceMatcher(None, r['kana'], h).ratio() if (r['kana'] or h) else 1.0
                if r['ratio'] < a.threshold:
                    r['flags'].append('words')

    # worst first: lowest ratio, then clips with other flags, then the rest
    rows.sort(key=lambda r: (r['ratio'] if r['ratio'] is not None else (0.5 if r['flags'] else 2.0), r['file']))
    print()
    print('%-15s %6s %7s %6s %6s %7s %7s  %s' % ('clip', 'sec', 's/mora', 'LUFS', 'peak', 'ratio', 'style', 'flags'))
    for r in rows:
        print('%-15s %6.2f %7s %6s %6.1f %7s %7s  %s' % (
            r['file'], r['dur'], '%.3f' % r['spm'] if r['spm'] else '-', '%.1f' % r['I'] if r['I'] is not None else '-',
            20 * np.log10(r['peak'] + 1e-12), '%.3f' % r['ratio'] if r['ratio'] is not None else '-', r['style'] or '-',
            ','.join(r['flags']) or 'ok'))
    bad = [r for r in rows if r['flags']]
    for r in rows:
        if r['heard'] is not None and (r['flags'] or r['ratio'] is not None):
            print('\n%s  ratio %s' % (r['file'], '%.3f' % r['ratio'] if r['ratio'] is not None else '-'))
            print('  expected : %s' % (r['read'] or '(no --lines entry)'))
            print('  heard    : %s' % r['heard'])
            if r['kana'] is not None:
                print('  exp kana : %s' % r['kana'])
                print('  heard kna: %s' % r.get('heard_kana', ''))
    print('\n%d clips, %d flagged%s' % (len(rows), len(bad), (': ' + ', '.join(r['file'] for r in bad)) if bad else ''))
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
