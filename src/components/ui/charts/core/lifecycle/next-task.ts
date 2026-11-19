export function nextTask(callback: () => void): () => void {
  const channel = new MessageChannel();
  channel.port1.onmessage = (): void => {
    channel.port1.close();
    callback();
  };
  channel.port2.postMessage(null);
  // A closed port drops the message already posted to it.
  return (): void => {
    channel.port1.close();
  };
}
