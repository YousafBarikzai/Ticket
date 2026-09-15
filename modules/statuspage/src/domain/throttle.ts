/**
 * A sliding-window counter for the one public endpoint that does something:
 * subscribing sends an email, and an endpoint that sends an email to any
 * address it is given, with no session in front of it, is a spam relay
 * unless it is rationed.
 *
 * In-process on purpose. The API runs several instances, so the true rate is
 * this times the instance count — a bound, not an accounting. That is enough:
 * the aim is to make the page useless as a relay, not to count precisely.
 * A pure structure so the rule can be tested without a clock or a server.
 */
export class SlidingWindow {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Records one attempt and says whether it is within the allowance. */
  allow(key: string, now: number = Date.now()): boolean {
    const since = now - this.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((at) => at > since);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    // Keys nobody has used inside the window are forgotten, so a long-running
    // process does not remember every address that ever tried once.
    if (this.hits.size > 10_000) {
      for (const [other, times] of this.hits) {
        if (!times.some((at) => at > since)) this.hits.delete(other);
      }
    }
    return true;
  }
}
