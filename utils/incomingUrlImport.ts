/**
 * Deduplicates incoming file URLs without making a failed attempt permanent.
 * URLs become handled only after their import operation completes successfully.
 */
export class IncomingUrlImportGate {
  private readonly handledUrls = new Set<string>();
  private readonly pendingUrls = new Set<string>();

  async run(url: string, importUrl: () => Promise<void>): Promise<boolean> {
    if (this.handledUrls.has(url) || this.pendingUrls.has(url)) return false;

    this.pendingUrls.add(url);
    try {
      await importUrl();
      this.handledUrls.add(url);
      return true;
    } finally {
      this.pendingUrls.delete(url);
    }
  }
}
