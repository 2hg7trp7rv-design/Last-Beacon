export type SoundCue = "collect" | "upgrade" | "rescue" | "tap";

class GameAudio {
  private context: AudioContext | null = null;
  private enabled = true;

  isEnabled(): boolean {
    return this.enabled;
  }

  toggle(): boolean {
    this.enabled = !this.enabled;
    if (this.enabled) this.play("tap");
    return this.enabled;
  }

  play(cue: SoundCue): void {
    if (!this.enabled) return;

    try {
      const context = this.context ?? new AudioContext();
      this.context = context;
      if (context.state === "suspended") void context.resume();

      const now = context.currentTime;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const settings = {
        collect: { from: 330, to: 520, duration: 0.13, volume: 0.045 },
        upgrade: { from: 190, to: 620, duration: 0.38, volume: 0.06 },
        rescue: { from: 420, to: 760, duration: 0.28, volume: 0.05 },
        tap: { from: 240, to: 280, duration: 0.07, volume: 0.025 }
      }[cue];

      oscillator.type = cue === "upgrade" ? "sawtooth" : "sine";
      oscillator.frequency.setValueAtTime(settings.from, now);
      oscillator.frequency.exponentialRampToValueAtTime(settings.to, now + settings.duration);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(settings.volume, now + 0.018);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + settings.duration);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(now);
      oscillator.stop(now + settings.duration + 0.02);
    } catch {
      // Sound is optional; unsupported audio must never interrupt the game loop.
    }
  }
}

export const gameAudio = new GameAudio();
