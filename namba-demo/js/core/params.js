// URL parameters (also used by the headless test harness).
//   ?skip           skip title screen, start playing immediately
//   ?spawn=name     start at a named spawn (layout.spawns)
//   ?pos=x,z,level&yaw=deg&pitch=deg   exact camera placement
//   ?time=HH:MM     game clock start
//   ?quality=low|medium|high|ultra
//   ?nocrowd ?noaudio ?nopost   disable systems (debug)
//   ?debug          show debug overlay (fps, position, level, zone)
//   ?freeze         don't advance simulation (for stable screenshots)
//   ?seed=n         random seed
const q = new URLSearchParams(location.search);
export const params = {
  skip: q.has('skip') || q.has('test'),
  test: q.has('test'),
  spawn: q.get('spawn'),
  pos: q.get('pos') ? q.get('pos').split(',') : null,
  yaw: q.has('yaw') ? parseFloat(q.get('yaw')) * Math.PI / 180 : null,
  pitch: q.has('pitch') ? parseFloat(q.get('pitch')) * Math.PI / 180 : null,
  time: q.get('time'),
  quality: q.get('quality'),
  nocrowd: q.has('nocrowd'),
  noaudio: q.has('noaudio'),
  nopost: q.has('nopost'),
  debug: q.has('debug'),
  freeze: q.has('freeze'),
  seed: q.has('seed') ? parseInt(q.get('seed'), 10) : 20261005,
  get(k) { return q.get(k); },
  has(k) { return q.has(k); },
};
