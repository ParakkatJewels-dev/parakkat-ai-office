/** Small, deterministic poses driven by the agent's real map and work state. */
export function characterMotion(p, t, working, reduce = false) {
  const phase = t + p.phase;
  const moving = !p.sitting && !!p.path.length;
  const greeting = p.visitId && p.greetingAt != null && t - p.greetingAt < 2.3;
  const speaking = p.status === 'talking';
  const thinking = p.status === 'thinking' || (!speaking && !moving && working === 'thinking');
  const typing = p.sitting && !greeting && !speaking && !thinking && working === 'working';
  const pulse = reduce ? 0 : Math.sin(phase * 2.1);
  const pose = {
    mode: greeting ? 'greeting' : moving ? 'walking' : speaking ? 'speaking' : thinking ? 'thinking' : typing ? 'typing' : 'resting',
    bodyX: reduce ? 0 : Math.sin(phase * 1.3) * .012,
    bodyZ: reduce ? 0 : pulse * .018,
    headX: reduce ? 0 : Math.sin(phase * 1.7) * .065,
    headY: reduce ? 0 : Math.sin(phase * .65) * .14,
    headZ: reduce ? 0 : Math.sin(phase * 1.15) * .04,
    armsX: [0, 0], armsZ: [0, 0], elbowsX: [0, 0], legsX: [0, 0], lift: 0,
  };
  if (p.sitting) {
    pose.legsX = [-Math.PI / 2 + .1, -Math.PI / 2 + .1];
    pose.armsX = [-.72, -.72]; pose.elbowsX = [-.28, -.28];
  }
  if (moving) {
    const swing = reduce ? 0 : Math.sin(t * 9 + p.phase) * .58;
    pose.legsX = [swing, -swing]; pose.armsX = [p.carry ? -1.1 : -swing * .8, swing * .8];
    pose.lift = reduce ? 0 : Math.abs(Math.sin(t * 9 + p.phase)) * .045;
    pose.bodyZ = reduce ? 0 : Math.sin(t * 9 + p.phase) * .035;
  } else if (typing) {
    const tap = reduce ? 0 : Math.sin(t * 14 + p.phase) * .09;
    pose.armsX = [-.68 + tap, -.68 - tap];
    pose.elbowsX = [-.64 - tap, -.64 + tap];
    pose.bodyX += .045; pose.headX += .08;
  } else if (thinking) {
    pose.armsX[1] = -1.02; pose.elbowsX[1] = -1.18;
    pose.headZ += .12; pose.headX += .08;
  } else if (speaking) {
    const point = Math.floor((t + p.phase) / 2.2) % 2 === 0;
    if (point) {
      pose.armsX[1] = -1.25 + (reduce ? 0 : Math.sin(t * 6) * .12);
      pose.elbowsX[1] = -.33; pose.armsZ[1] = -.2;
    } else {
      pose.armsX[1] = -2.45 + (reduce ? 0 : Math.sin(t * 5) * .1);
      pose.elbowsX[1] = -.32; pose.armsZ[1] = -.35;
    }
    pose.headY += reduce ? 0 : Math.sin(t * 3.3) * .08;
  }
  if (greeting) {
    const hand = p.greetingSide ?? 1;
    pose.armsX[hand] = -1.38 + (reduce ? 0 : Math.sin((t - p.greetingAt) * 16) * .11);
    pose.elbowsX[hand] = -.18;
    pose.armsZ[hand] = hand ? -.22 : .22;
    pose.headX += .08;
  }
  return pose;
}
