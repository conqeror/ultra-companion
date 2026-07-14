/**
 * Give React Native one full frame and a macrotask to commit pending feedback
 * before starting CPU-heavy work on the JavaScript thread.
 */
export function yieldToUI(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      setTimeout(resolve, 0);
    });
  });
}
