/** Let interactive map labels keep clicks while the canvas still receives wheel zoom. */
export function forwardLabelWheel(event, canvas, WheelEventType = WheelEvent) {
  event.preventDefault();
  canvas.dispatchEvent(new WheelEventType('wheel', {
    deltaX: event.deltaX, deltaY: event.deltaY, deltaZ: event.deltaZ,
    deltaMode: event.deltaMode, clientX: event.clientX, clientY: event.clientY,
    ctrlKey: event.ctrlKey, shiftKey: event.shiftKey,
    bubbles: false, cancelable: true,
  }));
}
