class AudioEngine {
  private ctx: AudioContext | null = null;

  public getContext(): AudioContext {
    if (!this.ctx || this.ctx.state === 'closed') {
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioContextClass();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    return this.ctx;
  }

  /**
   * Sound Effect Synthesizer
   */
  public playSFX(sfxType: 'ding' | 'whoosh' | 'pop' | 'bass_drop' | 'applause', volume = 0.8) {
    const ctx = this.getContext();
    const master = ctx.createGain();
    master.gain.setValueAtTime(volume, ctx.currentTime);
    master.connect(ctx.destination);

    if (sfxType === 'ding') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1760, ctx.currentTime); // A6
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.8);

      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);

      osc.connect(gain);
      gain.connect(master);
      osc.start();
      osc.stop(ctx.currentTime + 0.8);
    } else if (sfxType === 'whoosh') {
      const bufferSize = ctx.sampleRate * 0.4;
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      const noise = ctx.createBufferSource();
      noise.buffer = buffer;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(300, ctx.currentTime);
      filter.frequency.exponentialRampToValueAtTime(3000, ctx.currentTime + 0.2);
      filter.frequency.exponentialRampToValueAtTime(200, ctx.currentTime + 0.4);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.01, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.3, ctx.currentTime + 0.2);
      gain.gain.linearRampToValueAtTime(0.01, ctx.currentTime + 0.4);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(master);
      noise.start();
    } else if (sfxType === 'pop') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(400, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(80, ctx.currentTime + 0.1);

      gain.gain.setValueAtTime(0.4, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);

      osc.connect(gain);
      gain.connect(master);
      osc.start();
      osc.stop(ctx.currentTime + 0.1);
    } else if (sfxType === 'bass_drop') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(150, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(35, ctx.currentTime + 1.2);

      gain.gain.setValueAtTime(0.5, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.2);

      osc.connect(gain);
      gain.connect(master);
      osc.start();
      osc.stop(ctx.currentTime + 1.2);
    } else {
      // Applause / Cheer (multi noise grain)
      const bufferSize = ctx.sampleRate * 1.5;
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.sin((i / bufferSize) * Math.PI);
      }
      const noise = ctx.createBufferSource();
      noise.buffer = buffer;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      noise.connect(gain);
      gain.connect(master);
      noise.start();
    }
  }
}

export const audioEngine = new AudioEngine();
