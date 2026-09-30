import type { IconName } from '../types.js';

/**
 * How a ticket channel is shown: a generic glyph *and* a word, never a brand
 * logo and never the glyph alone (SPEC §1.8, X-80). Server-safe.
 *
 * The keys are the ticket model's channels. Anything else — a channel added
 * after this was written, or free text from an integration — is shown as the
 * words it arrived as, with the generic message glyph, rather than dropped.
 */
const channels: Readonly<Record<string, { readonly label: string; readonly icon: IconName }>> = {
  portal: { label: 'Portal', icon: 'globe' },
  email: { label: 'Email', icon: 'mail' },
  slack: { label: 'Slack', icon: 'message-square' },
  teams: { label: 'Teams', icon: 'message-square' },
  whatsapp: { label: 'WhatsApp', icon: 'message-circle' },
  voice: { label: 'Phone', icon: 'phone' },
  phone: { label: 'Phone', icon: 'phone' },
  mobile: { label: 'Mobile app', icon: 'smartphone' },
  api: { label: 'API', icon: 'webhook' },
  import: { label: 'Import', icon: 'upload' },
  system: { label: 'Automatic', icon: 'bot' },
};

export interface ChannelInfo {
  /** "Email" — sentence case, for a label beside the glyph. */
  readonly label: string;
  readonly icon: IconName;
}

/** The glyph and label for a channel key ("email") or an already human label ("Email"). */
export function channelInfo(channel: string): ChannelInfo {
  const known = channels[channel.trim().toLowerCase()];
  if (known) return known;
  const words = channel.trim().replace(/[_-]+/g, ' ');
  const [first = ''] = Array.from(words);
  return { label: first.toUpperCase() + words.slice(first.length), icon: 'message-square' };
}

/**
 * The channel as it reads inside a sentence: "by email", "by phone". Proper
 * names and acronyms keep their capitals ("by Slack", "by API").
 */
export function channelPhrase(channel: string): string {
  const { label } = channelInfo(channel);
  const keepsCase = /^(?:[A-Z]{2,}|Slack|Teams|WhatsApp)/.test(label);
  return `by ${keepsCase ? label : label.charAt(0).toLowerCase() + label.slice(1)}`;
}
