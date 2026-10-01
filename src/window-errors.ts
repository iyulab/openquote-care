/** Hands a failure on to the shell's reports: a type name and a stack. */
export type ReportWindowError = (kind: string, stack: string) => Promise<void>

/**
 * Hands errors the window did not handle — a thrown error no code caught, a rejected promise no
 * code awaited — to the shell's error reports. Only an `Error` goes, as its type name and its
 * stack; the shell keeps of those only what its reports allow (the type when it is a plain name,
 * and the frames in the app's own bundle), never the message. Anything else thrown or rejected
 * (a command's refusal, a plain value) is not a failure of the window's own code and goes nowhere.
 * A report that cannot be handed over is let go: reporting never adds a failure of its own.
 */
export function reportUnhandledErrors(target: Pick<Window, 'addEventListener'>, report: ReportWindowError): void {
  const hand = (error: unknown) => {
    if (!(error instanceof Error)) return
    report(error.name, error.stack ?? '').catch(() => {})
  }
  target.addEventListener('error', (e) => hand((e as ErrorEvent).error))
  target.addEventListener('unhandledrejection', (e) => hand((e as PromiseRejectionEvent).reason))
}
