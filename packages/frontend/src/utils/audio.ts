/**
 * Sound utilities for the application
 */

const getAudioContext = () => {
  return new (window.AudioContext || (window as any).webkitAudioContext)();
};

export const playNotificationSound = () => {
  try {
    const audioCtx = getAudioContext();
    
    const playBlip = (startTime: number, freq: number) => {
      const osc = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, startTime);
      
      g.gain.setValueAtTime(0, startTime);
      g.gain.linearRampToValueAtTime(0.2, startTime + 0.005);
      g.gain.exponentialRampToValueAtTime(0.01, startTime + 0.1);
      
      osc.connect(g);
      g.connect(audioCtx.destination);
      
      osc.start(startTime);
      osc.stop(startTime + 0.1);
    };

    // Two short high-pitched blips (modern UI style)
    playBlip(audioCtx.currentTime, 880);      // A5
    playBlip(audioCtx.currentTime + 0.08, 1046.50); // C6
    
  } catch (e) {
    console.error("Could not play notification sound:", e);
  }
};

export const playErrorSound = () => {
  try {
    const audioCtx = getAudioContext();
    
    const playBlip = (startTime: number, freq: number) => {
      const osc = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      
      osc.type = 'sine'; // Clean and professional
      osc.frequency.setValueAtTime(freq, startTime);
      
      g.gain.setValueAtTime(0, startTime);
      g.gain.linearRampToValueAtTime(0.1, startTime + 0.005);
      g.gain.exponentialRampToValueAtTime(0.01, startTime + 0.1);
      
      osc.connect(g);
      g.connect(audioCtx.destination);
      
      osc.start(startTime);
      osc.stop(startTime + 0.1);
    };

    // Two fast, subtle low-pitched blips
    playBlip(audioCtx.currentTime, 180);
    playBlip(audioCtx.currentTime + 0.1, 140);
    
  } catch (e) {
    console.error("Could not play error sound:", e);
  }
};
