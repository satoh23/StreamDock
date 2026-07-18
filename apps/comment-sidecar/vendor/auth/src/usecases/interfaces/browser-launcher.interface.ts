export interface BrowserLauncher {
  open(url: URL): Promise<void>;
}
