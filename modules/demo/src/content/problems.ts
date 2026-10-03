import type { ProblemContent } from '../plan/content-types.js';

/**
 * The eight problems, `PRB-0411` … `PRB-0418` (A4 §1.9.1).
 *
 * Each one explains a cluster the dashboards show: the Outlook prompts after
 * password changes, the dock firmware behind the Windows 11 rollout's black
 * screens, the Leeds scanners, the three historic major incidents and the
 * live VPN one. Two are known errors whose workaround is a published article,
 * which is what lets the Service Desk suggest it on H5 and H1-style tickets.
 *
 * `links` says how many generated incidents the planner links and where they
 * come from; the heroes are named apart, and each hero listed here names the
 * problem back (`HeroContent.problem`), which `content.test.ts` checks.
 */
export const PROBLEMS = [
  {
    number: 411,
    title: 'Outlook re-prompts for a password after a password change',
    description:
      'After a password change, Outlook on Windows keeps prompting for the password every few minutes even though webmail and Teams work. Reports follow resets at the service desk and changes people make after a phishing scare.',
    state: 'known_error',
    priority: 'P3',
    owner: 'priya-shah',
    team: 'service-desk',
    service: 'microsoft-365',
    subcategory: 'outlook',
    links: [{ source: 'history', count: 14 }],
    workaround:
      'Remove the saved “MicrosoftOffice16” entries from Windows Credential Manager and restart Outlook; it asks for the password once and then stays quiet. See the article “Outlook keeps asking for your password”.',
    workaroundArticle: 'outlook-password-prompt',
    rootCause: 'Windows Credential Manager keeps the old password after a change, and Outlook tries it before asking for the new one.',
    raisedDaysBeforeT0: 82,
  },
  {
    number: 412,
    title: 'Dell WD19S dock firmware: black screens after wake',
    description:
      'Since the Windows 11 rollout, laptops on Dell WD19S docks wake from sleep with both external screens black. The laptop is running; only a power cycle or unplugging the dock brings the picture back.',
    state: 'known_error',
    priority: 'P3',
    owner: 'ben-carter',
    team: 'euc',
    service: 'end-user-devices',
    subcategory: 'monitor-dock',
    links: [{ source: 'rollout', count: 6 }],
    heroes: ['H5'],
    workaround:
      'Unplug the dock’s USB-C cable, wait for the laptop’s own screen, then plug it back in (Windows key + P › Extend if the screens stay black). See “Laptop won’t wake from sleep when docked”.',
    workaroundArticle: 'dock-black-screen',
    rootCause: 'Dock firmware older than 01.00.32 does not renegotiate DisplayPort after the new Windows 11 modern standby. The fix is the firmware update, rolling out desk by desk.',
    raisedDaysBeforeT0: 47,
  },
  {
    number: 413,
    title: 'Leeds DC handheld scanners drop Wi-Fi in aisles 10–14',
    description:
      'Zebra TC58 scanners lose their Wi-Fi connection as pickers move through aisles 10 to 14, most often on the late shift. Orders are picked twice when a scanner reconnects mid-pick.',
    state: 'investigating',
    priority: 'P2',
    owner: 'aisha-rahman',
    team: 'network',
    service: 'warehouse-wms',
    subcategory: 'wifi',
    links: [{ source: 'history', count: 7 }],
    heroes: ['H7'],
    raisedDaysBeforeT0: 19,
  },
  {
    number: 414,
    title: 'Sage Intacct bank export times out at month-end',
    description:
      'The supplier payment export to the bank times out when month-end volumes run through it, so the payment file never reaches the bank. Raised from major incident MI-0002.',
    state: 'resolved',
    priority: 'P2',
    owner: 'liam-walsh',
    team: 'bizapps',
    service: 'finance-systems',
    subcategory: 'sage-intacct',
    links: [{ source: 'major-incident', count: 6 }],
    majorIncident: 2,
    rootCause:
      'The bank export report ran under a 300-second limit that was set when Northwind paid a third as many suppliers. The limit was raised and the export now runs by supplier group.',
    raisedDaysBeforeT0: 34,
  },
  {
    number: 415,
    title: 'Teams calls drop on the London 4th-floor Wi-Fi',
    description:
      'Teams calls drop after a few minutes in the 4th-floor meeting rooms (4.02 and 4.05 especially) when laptops move between access points. Wired docks are not affected.',
    state: 'investigating',
    priority: 'P3',
    owner: 'daniel-hughes',
    team: 'network',
    service: 'network-vpn',
    subcategory: 'teams',
    links: [{ source: 'history', count: 5 }],
    heroes: ['H2'],
    workaround: 'Use a wired dock or one of the 3rd-floor rooms for calls until the 4th-floor access points are replaced this week.',
    raisedDaysBeforeT0: 9,
  },
  {
    number: 416,
    title: 'No automatic failover when the Leeds site link fails',
    description:
      'When the BT circuit into Leeds was cut, the site stayed offline for over two hours because nothing moved its traffic to the 4G backup router without someone on site. Raised from major incident MI-0001.',
    state: 'resolved',
    priority: 'P1',
    owner: 'daniel-hughes',
    team: 'network',
    service: 'network-vpn',
    subcategory: 'site-connectivity',
    links: [{ source: 'major-incident', count: 14 }],
    majorIncident: 1,
    rootCause:
      'The backup router was configured but not in the SD-WAN policy, so failover was manual. It is now part of the policy and is tested every quarter (an action from the post-incident review).',
    raisedDaysBeforeT0: 60,
  },
  {
    number: 417,
    title: 'Salesforce SSO certificate expiry was not monitored',
    description:
      'Nobody could sign in to Salesforce with their Northwind account for 50 minutes because the SAML signing certificate expired overnight without a warning. Raised from major incident MI-0003.',
    state: 'closed',
    priority: 'P2',
    owner: 'chloe-nguyen',
    team: 'identity',
    service: 'salesforce',
    subcategory: 'app-access',
    links: [{ source: 'major-incident', count: 9 }],
    majorIncident: 3,
    rootCause:
      'Signing certificates for single sign-on were tracked in a spreadsheet that was out of date. Every SAML certificate is now on the expiry report, with a reminder 60 days ahead.',
    raisedDaysBeforeT0: 12,
  },
  {
    number: 418,
    title: 'Intermittent VPN authentication failures after certificate rotation',
    description:
      'Remote staff see “Authentication failed” from the VPN client after the gateway certificates were rotated. Two similar reports came in nine days ago, before the rotation reached both gateways. Linked to the live major incident MI-0004.',
    state: 'investigating',
    priority: 'P2',
    owner: 'daniel-hughes',
    team: 'network',
    service: 'network-vpn',
    subcategory: 'vpn',
    // The live incident's reports: 18 in day mode; at night the incident has
    // nine reports and the planner links all of them.
    links: [
      { source: 'major-incident', count: 18 },
      { source: 'early-vpn', count: 2 },
    ],
    majorIncident: 4,
    workaround: 'Disconnect and sign out of the VPN client, approve the pending Authenticator request, then connect to “Northwind-Remote-2”.',
    workaroundArticle: 'vpn-authentication-failed',
    raisedDaysBeforeT0: 0,
  },
] satisfies readonly ProblemContent[];
