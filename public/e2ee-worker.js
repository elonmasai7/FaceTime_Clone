let cryptoKeyPromise = null;

function bytesFromCounter(counter) {
  const iv = new Uint8Array(12);
  const view = new DataView(iv.buffer);
  view.setUint32(8, counter >>> 0, false);
  return iv;
}

async function importKey(keyMaterial) {
  if (!keyMaterial || !keyMaterial.length) {
    return null;
  }
  return crypto.subtle.importKey('raw', new Uint8Array(keyMaterial), 'AES-GCM', false, [
    'encrypt',
    'decrypt'
  ]);
}

self.addEventListener('rtctransform', (event) => {
  const transformer = event.transformer;
  const options = event.options || {};
  const operation = options.operation || 'encode';
  const enabled = Boolean(options.enabled);
  const keyMaterial = options.keyMaterial || [];

  cryptoKeyPromise = importKey(keyMaterial);
  let counter = 0;

  const transform = new TransformStream({
    async transform(frame, controller) {
      if (!enabled || !keyMaterial.length) {
        controller.enqueue(frame);
        return;
      }

      const key = await cryptoKeyPromise;
      if (!key) {
        controller.enqueue(frame);
        return;
      }

      try {
        if (operation === 'encode') {
          const iv = bytesFromCounter(counter);
          counter += 1;
          const encrypted = await crypto.subtle.encrypt(
            {
              name: 'AES-GCM',
              iv
            },
            key,
            frame.data
          );
          const encryptedBytes = new Uint8Array(encrypted);
          const payload = new Uint8Array(iv.length + encryptedBytes.length);
          payload.set(iv, 0);
          payload.set(encryptedBytes, iv.length);
          frame.data = payload.buffer;
          controller.enqueue(frame);
          return;
        }

        const incoming = new Uint8Array(frame.data);
        if (incoming.length <= 12) {
          return;
        }

        const iv = incoming.slice(0, 12);
        const encryptedPayload = incoming.slice(12);
        const decrypted = await crypto.subtle.decrypt(
          {
            name: 'AES-GCM',
            iv
          },
          key,
          encryptedPayload
        );
        frame.data = decrypted;
        controller.enqueue(frame);
      } catch (_error) {
        // Drop undecipherable frames when keys differ.
      }
    }
  });

  transformer.readable.pipeThrough(transform).pipeTo(transformer.writable);
});
