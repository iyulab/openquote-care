/**
 * Tells overlapping reads apart: of several started one after another, only the last one's answer
 * is current. A read that finishes after a newer one began is stale — applying it would put back a
 * state the newer read has already moved past.
 */
export class Latest {
  private started = 0

  /** Marks a read as started; the returned check says whether it is still the newest. */
  begin(): () => boolean {
    const mine = ++this.started
    return () => mine === this.started
  }
}
