# Crossing features and retrospective beat recall

This software module links streaming waveform analysis to a shared rolling audio history. It can capture a past beat on command or after a chosen number of future rising crossings. The physical firmware is unchanged.

## Detection and accumulation

Each of the dry, echo, room and recall output contributions has an independent detector. Its current side is positive or negative. From the negative side it qualifies a rising event only when `x > hysteresis`; from the positive side it qualifies a falling event only when `x < -hysteresis`. The first valid side seeds the detector without counting an event. Exact zero samples do not themselves count. A peak envelope with a 50 ms release resets the side and rise interval when it falls below the gate. Default hysteresis is 0.03% full scale and the gate is 0.1% full scale, applied after master gain and the common output limiter.

For each segment between qualified events, accumulate:

```
samples += 1
sum += x
energy += x*x
peak = max(peak, abs(x))
segment_rms = sqrt(energy / samples)
segment_area = sum / sample_rate
```

An event latches those features and starts a new segment. Lifetime rising/falling counters are separate from the 250 ms event-rate window. The rise-to-rise interval uses a 0.15 exponential smoothing factor. Harmonics, interference and modulation can create several crossings per fundamental cycle, so neither the event rate nor the interval is asserted to be pitch. Hysteresis also means the detected event is near the threshold crossing, not a sub-sample estimate of the mathematical zero.

The engine checks an armed rising-event countdown every output sample and captures once when it reaches zero. UI refresh timing does not determine the trigger. Counter storage is constant per source; a firmware port would select integer widths and an overflow policy. Segment energy needs an appropriately wide accumulator. The present implementation uses JavaScript numbers.

## History and captured playback

The selected source is recorded before master gain into one 6.25-second circular history. A mix source includes dry, echo and room. Recall return is excluded to avoid recursively recording itself. At a grab command:

```
start = current_sample - round(beats_back * 60 / bpm * sample_rate)
length = round(slice_beats * 60 / bpm * sample_rate)
```

`beats_back` is 1/2/4, `slice_beats` is 1/4, 1/2 or 1, and tempo spans 40–240 BPM. The longest offset is six seconds and the longest slice is 1.5 seconds. Readiness includes 3 ms of extra history. Optional upward-zero alignment searches ±2 ms around the computed start without changing slice duration or reading future audio.

Capture copies at most 32 samples per output sample into the spare bank while history continues recording. At 48 kHz, a longest slice completes within about 46.9 ms, plus block/control delivery time. The 250 ms history margin covers this copy. Two banks keep old captured data intact during replacement and its 5 ms crossfade. These are bounded software operations, not measured target execution times. Explicit export also copies the captured slice into a snapshot; this is a user-triggered operation, not a per-block task.

OFF mutes playback while preserving the pinned bank. ON restarts that bank; Grab again copies current earlier history. Five-millisecond raised-cosine fades at each slice edge soften discontinuities and produce a brief level dip at the wrap. Playback rate stays fixed when tempo changes. Changing history source clears rolling history and pending capture, while retaining the last completed slice. Global FX bypass fades recall off but keeps recording history. Clear recall history fades playback out and erases history/capture; Panic resets them immediately.

JSON and browser SAVE persist configuration only. WAV rendering can snapshot the active captured bank, resample it if the offline rate differs, and mix it with the C4 audition. It stops recall after four seconds, leaving the ordinary note/effects release. Captured audio is not a new long-form recorder or a saved sample library.

## Memory and a possible physical port

Sample capacity is `ceil(6.25*fs) + 2*(ceil(1.5*fs)+2)`. The following excludes state, alignment, monitoring, conversion filters and existing effects:

| History/capture format | Sample bytes | Storage |
| --- | ---: | ---: |
| Actual browser, 48 kHz Float32 mono | 1,776,016 | 1.69 MiB |
| Proposed 12 kHz PCM16 mono | 222,008 | 216.8 KiB |
| Proposed 8 kHz PCM16 mono | 148,008 | 144.5 KiB |

Available memory must be measured in the target build. Native-rate Float32 history alone uses the allocation above. The proposed 8 kHz PCM16 history/capture plus 22.05 kHz echo/default room totals 199,198 sample bytes before state, conversion filters and other modules. Ordinary RAM and any dedicated sample pool may be separate regions; this sum is not proof of a hardware fit.

The 8 kHz plan trades audio bandwidth for history: its Nyquist ceiling is 4 kHz, with practical passband lower once transition bands are included. Proper anti-alias filtering before storage and reconstruction on return are required. The lab does not implement this lower-rate storage format. Porting would also need saturating PCM conversion, static/pool allocation, cheap block-prepared controls, bounded copy scheduling and a worst-case target timing benchmark with voice stacks and all effects active. Existing controller emulator headroom does not measure this DSP.

For a first physical experiment, retain the four lightweight detectors and one shared lower-bandwidth history, with a small menu of fixed recall lengths. Measure RAM placement and block time before increasing rate, duration or adding independent per-voice capture. See [BUFFER-RESEARCH.md](BUFFER-RESEARCH.md) for the existing echo/room path.
