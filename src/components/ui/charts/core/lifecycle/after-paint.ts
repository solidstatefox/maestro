export function afterPaint(callback: () => void): () => void {
  let channel: MessageChannel | undefined;
  const frame = requestAnimationFrame(() => {
    channel = new MessageChannel();
    channel.port1.onmessage = (): void => {
      channel?.port1.close();
      callback();
    };
    channel.port2.postMessage(null);
  });
  return (): void => {
    cancelAnimationFrame(frame);
    // A closed port drops the message already posted to it.
    channel?.port1.close();
  };
}
