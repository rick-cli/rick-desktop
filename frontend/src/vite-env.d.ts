export {};

declare global {
  interface Window {
    runtime: {
      EventsOn: (event: string, cb: (payload: any) => void) => () => void;
      EventsOff: (event: string) => void;
      EventsEmit: (event: string, payload?: any) => void;
    };
    go: {
      main: {
        App: Record<string, (...args: any[]) => Promise<any>>;
      };
    };
  }
}
