import type { HeroContent } from '../plan/content-types.js';

/**
 * The hero tickets: the presenter's script (A4 §1.12, §1.13.3).
 *
 * Each is present in every generation with the same words, requester, team,
 * state and story, and carries `externalRef = demo:hero:<key>`, so a presenter
 * can say "open Marcus's Outlook ticket" on any day. Their timing is not here:
 * the planner re-times each one in business time against T0 (A1 is always due
 * within the next business hour, A2 always breached yesterday at 15:10), so
 * nothing below names a clock time that T0 could contradict.
 *
 * Routing follows the v3 amendments (SPEC §5.1, R8, X-B2): every hero in
 * `DEMO_SD_HEROES` belongs to `service-desk`, whatever its subcategory's usual
 * team, so a hop from the Help Portal or Administration into the Service Desk
 * lands on a ticket Alex Morgan can open. E3 is a `desk-equipment` request the
 * Service Desk owns, with End-User Computing doing the work as a task; H6, H7,
 * H13 and E2 stay with the teams that work them. The landing page's "Try it"
 * request (`drive-access`) is not a hero: the catalogue routes it to
 * `service-desk` with no approval, so a visitor's own request lands first in
 * Alex's Unassigned.
 *
 * Threads run oldest first. The planner puts the assignee's public messages on
 * the update cadence and spreads the rest through the ticket's life, so a
 * message here never quotes a time of day, and the last message of H1 is the
 * requester's ("customer replied"). `{first}` is the requester's first name,
 * `{agent}` the assignee's.
 */
export const HEROES = [
  /* ---------------------------------------------- Alex Morgan's queue (A4 §1.12) */
  {
    key: 'H1',
    name: 'outlook-password',
    title: 'Outlook keeps asking for my password',
    description:
      'Since this morning Outlook pops up a password box every few minutes. I type it in, it goes away, then it comes back. Webmail works fine.\n\nIt’s the ThinkPad from the finance refresh.\n\nMarcus',
    requester: 'marcus-chen',
    channel: 'email',
    type: 'incident',
    priority: 'P3',
    subcategory: 'outlook',
    team: 'service-desk',
    assignee: 'alex-morgan',
    status: 'in_progress',
    thread: [
      {
        author: 'assignee',
        visibility: 'public',
        body: 'Hi {first}, thanks for the detail. This is usually an old saved password after a password change. Could you open Credential Manager, remove the entries that start with “MicrosoftOffice16”, then restart Outlook? It will ask you to sign in once more and should then stay quiet.',
      },
      {
        author: 'requester',
        visibility: 'public',
        body: 'Done that and restarted. It was fine for about an hour, but the prompt is back. It seems to happen when I plug the laptop into the dock.',
      },
      {
        author: 'assignee',
        visibility: 'internal',
        body: 'Docking moves him from Wi-Fi to the wired finance VLAN, and the sign-in token isn’t refreshing there. Asked Aisha whether the finance VLAN still blocks login.microsoftonline.com.',
      },
      {
        author: 'requester',
        visibility: 'public',
        body: 'It’s just done it again. I’m using webmail for now so I can keep going, but I need the desktop app for my calendar.',
      },
    ],
    custom: { site: 'London HQ', assetTag: 'NW-LT-0241', affectedUsers: 1 },
  },
  {
    key: 'H2',
    name: 'teams-4th-floor',
    title: 'Teams calls drop after a few minutes on Wi-Fi',
    description:
      'Calls keep dropping after 3–5 minutes when I’m on the office Wi-Fi, so customers have to call me back. At my desk on the dock it’s fine. Mostly in rooms 4.02 and 4.05.',
    requester: 'elena-kovacs',
    channel: 'teams',
    type: 'incident',
    priority: 'P2',
    subcategory: 'teams',
    team: 'service-desk',
    assignee: 'alex-morgan',
    status: 'in_progress',
    problem: 415,
    thread: [
      {
        author: 'assignee',
        visibility: 'public',
        body: 'Hi {first}, sorry about the dropped calls. That matches a problem we already know about on the 4th floor: laptops hop between access points in those rooms and the call drops as they do. I’ve linked your ticket to it so you hear when it’s fixed. Until the new access points go in, you should be fine on a wired dock or in the 3rd-floor rooms.',
      },
      {
        author: 'assignee',
        visibility: 'internal',
        body: 'Linked to PRB-0415. Daniel’s access point replacement for the 4th floor is in this week’s changes.',
      },
      {
        author: 'requester',
        visibility: 'public',
        body: 'Thanks {agent}. I’ll book 3.07 for my customer calls until then.',
      },
    ],
    custom: { site: 'London HQ', affectedUsers: 12 },
  },
  {
    key: 'H3',
    name: 's-drive',
    title: 'Shared S: drive missing after the Windows update',
    description:
      'After last night’s update the S: drive has disappeared from File Explorer. I need the sales forecasts on it for this week’s pipeline meeting.',
    requester: 'james-whitfield',
    channel: 'portal',
    type: 'incident',
    priority: 'P3',
    subcategory: 'mailbox-drive-access',
    team: 'service-desk',
    assignee: 'alex-morgan',
    status: 'pending_requester',
    thread: [
      {
        author: 'assignee',
        visibility: 'public',
        body: 'Hi {first}, the update reset the drive-mapping policy on a handful of laptops. Could you restart once while you’re connected to the office network (not the VPN)? S: should come back when you sign in.',
      },
      {
        author: 'requester',
        visibility: 'public',
        body: 'I’m working from home today, so I’ll try that when I’m back in the office.',
      },
    ],
    custom: { site: 'London HQ', assetTag: 'NW-LT-0176' },
  },
  {
    key: 'H4',
    name: 'salesforce-reporting',
    title: 'Access to the Salesforce reporting workspace',
    description:
      'I’ve moved onto the key accounts plan and need read access to the Salesforce reporting workspace (the pipeline and promotions dashboards). My manager is Mark Ellison.',
    requester: 'fatima-khan',
    channel: 'portal',
    type: 'request',
    priority: 'P4',
    subcategory: 'salesforce',
    team: 'service-desk',
    assignee: 'alex-morgan',
    status: 'pending_approval',
    requestItem: 'salesforce-licence',
    approver: 'mark-ellison',
    thread: [
      {
        author: 'assignee',
        visibility: 'public',
        body: 'Hi {first}, the reporting workspace needs a Salesforce licence, so this has gone to Mark to approve. I’ll set it up as soon as he does.',
      },
      {
        author: 'assignee',
        visibility: 'internal',
        body: 'There are three spare Sales Cloud seats, so nothing to buy once Mark approves. Hannah can add the reporting permission set.',
      },
    ],
    custom: { site: 'London HQ' },
  },
  {
    key: 'H5',
    name: 'dock-black-screen',
    title: 'Laptop won’t wake from sleep when docked',
    description:
      'When I come back to my desk the laptop is on (the lights are on) but both screens stay black. I have to hold the power button to restart it. It happens most days.',
    requester: 'sam-doyle',
    channel: 'portal',
    type: 'incident',
    priority: 'P4',
    subcategory: 'monitor-dock',
    team: 'service-desk',
    assignee: 'alex-morgan',
    assignedBy: 'priya-shah',
    status: 'new',
    problem: 412,
    thread: [
      {
        author: 'priya-shah',
        visibility: 'internal',
        body: 'Looks like the WD19S dock firmware problem (PRB-0412). Alex, the workaround in “Laptop won’t wake from sleep when docked” should keep him going until the firmware reaches his dock.',
      },
    ],
    aiSuggestion:
      'Matches known error PRB-0412 (Dell WD19S dock firmware). Suggest the workaround article “Laptop won’t wake from sleep when docked” and schedule the dock firmware update.',
    custom: { site: 'London HQ', assetTag: 'NW-LT-0137', affectedUsers: 1 },
  },
  {
    key: 'H8',
    name: 'printer-offline',
    title: '3rd-floor printer shows as offline',
    description:
      'The Ricoh on the 3rd floor (PRN-3F-01) shows as offline for everyone on our side of the floor. People by the windows can still print to it.',
    requester: 'megan-price',
    channel: 'email',
    type: 'incident',
    priority: 'P4',
    subcategory: 'printer',
    team: 'service-desk',
    assignee: null,
    status: 'new',
    thread: [],
    aiSuggestion:
      'Several people on one side of the floor are affected, so the printer rather than their laptops: check PRN-3F-01’s queue on ldn-print01 and the network point it is patched into, then point them to “Printer shows as offline”.',
    custom: { site: 'London HQ', affectedUsers: 9 },
  },
  {
    key: 'H9',
    name: 'password-link',
    title: 'Password reset link says it has expired',
    description:
      'I asked for a reset link from the sign-in page. It says the link has expired as soon as I open it, less than a minute later. I’ve tried twice.',
    requester: 'zara-hussain',
    channel: 'portal',
    type: 'incident',
    priority: 'P3',
    subcategory: 'password-sign-in',
    team: 'service-desk',
    assignee: null,
    status: 'new',
    thread: [],
    custom: { site: 'London HQ', affectedUsers: 1 },
  },
  {
    key: 'H10',
    name: 'acrobat',
    title: 'Install Adobe Acrobat Pro',
    description: 'I need to edit and sign PDFs for supplier contracts. The licence is approved from the marketing budget (PO 7731).',
    requester: 'fatima-khan',
    channel: 'portal',
    type: 'request',
    priority: 'P4',
    subcategory: 'install-request',
    team: 'service-desk',
    assignee: null,
    status: 'new',
    thread: [],
    custom: { site: 'London HQ' },
  },
  {
    key: 'H11',
    name: 'new-starter',
    title: 'New starter: laptop and accounts for Jasmine Kaur',
    description:
      'Jasmine Kaur joins the finance team next week as a management accountant. She needs a laptop, an email account, the finance shared mailbox and access to the finance drives, all ready for her first morning.',
    requester: 'emma-clarke',
    channel: 'portal',
    type: 'request',
    priority: 'P3',
    subcategory: 'joiners-leavers',
    team: 'service-desk',
    assignee: 'tom-fletcher',
    status: 'in_progress',
    requestItem: 'new-starter',
    tasks: [
      { title: 'Create the account and mailbox', team: 'identity', done: true },
      { title: 'Assign licences and groups', team: 'identity', done: true },
      { title: 'Prepare and image the laptop', team: 'euc', done: false },
      { title: 'Hand over the laptop and phone', team: 'euc', done: false },
    ],
    thread: [
      {
        author: 'assignee',
        visibility: 'public',
        body: 'Hi {first}, thanks — I’ve set the four tasks going. Identity & Security create Jasmine’s account and mailbox first, then End-User Computing build her laptop. I’ll let you know when it’s ready to collect.',
      },
      {
        author: 'requester',
        visibility: 'public',
        body: 'Thanks {agent}. Could her laptop have the finance printer set up too? She’ll sit on the 2nd floor near me.',
      },
      {
        author: 'assignee',
        visibility: 'internal',
        body: 'Account and mailbox done; Microsoft 365 E3 and Sage Intacct read-only assigned until Emma asks for more. Laptop build is with Sofia, finance printer added to the build notes.',
      },
    ],
    custom: { site: 'London HQ' },
  },
  {
    key: 'H12',
    name: 'monitor-flicker',
    title: 'Second monitor flickers on the docking station',
    description: 'My second monitor flickers every few seconds when the laptop is docked. It’s fine on its own.',
    requester: 'marcus-chen',
    channel: 'portal',
    type: 'incident',
    priority: 'P4',
    subcategory: 'monitor-dock',
    team: 'service-desk',
    assignee: 'alex-morgan',
    status: 'resolved',
    thread: [
      {
        author: 'assignee',
        visibility: 'public',
        body: 'Hi {first}, I’ll bring a new DisplayPort cable up — the old ones from that batch cause exactly this.',
      },
      { author: 'requester', visibility: 'public', body: 'Thanks, I’ll be at my desk all afternoon.' },
    ],
    resolutionNote:
      'Hi {first}, I’ve replaced the DisplayPort cable and there’s been no flicker since, so I’m marking this resolved. If it comes back, just reply here and the ticket will reopen.',
    custom: { site: 'London HQ', assetTag: 'NW-LT-0241', affectedUsers: 1 },
  },

  /* ---------------------------------------------- Heroes other teams work */
  {
    key: 'H6',
    name: 'bank-file',
    title: 'Sage Intacct bank file rejected — supplier payment run',
    description:
      'Kwame called: the bank rejected today’s supplier payment file with “invalid sort code format”. It’s this week’s supplier payment run and it has to reach the bank today. Two suppliers were added this week and he thinks one of them is the cause.',
    requester: 'kwame-mensah',
    channel: 'voice',
    type: 'incident',
    priority: 'P2',
    subcategory: 'sage-intacct',
    team: 'bizapps',
    assignee: 'liam-walsh',
    status: 'in_progress',
    thread: [
      {
        author: 'assignee',
        visibility: 'public',
        body: 'Hi {first}, thanks for calling it in. I can see the rejected file: two of the new supplier records have their sort codes saved with spaces, which the bank’s format doesn’t allow. I’m correcting them now and will regenerate the file for you to resend.',
      },
      {
        author: 'assignee',
        visibility: 'internal',
        body: 'Sort codes on suppliers SUP-20417 and SUP-20431 were keyed as “20 45 77”. Fixed both; asked Hannah to add a format check to the supplier import template.',
      },
    ],
    custom: { site: 'London HQ', affectedUsers: 2 },
  },
  {
    key: 'H7',
    name: 'leeds-scanners',
    title: 'Leeds DC: handheld scanners dropping off the network in aisle 12',
    description:
      'Pickers in aisles 10–14 keep losing connection on the TC58s, and orders are being picked twice when a scanner reconnects. It’s worst on the late shift.',
    requester: 'oliver-grant',
    channel: 'teams',
    type: 'incident',
    priority: 'P2',
    subcategory: 'wifi',
    team: 'network',
    assignee: 'aisha-rahman',
    status: 'in_progress',
    problem: 413,
    thread: [
      {
        author: 'assignee',
        visibility: 'public',
        body: 'Hi {first}, thanks — this is the same pattern as the other aisle reports, so I’ve linked it to the problem we’re investigating. I’ll be on site with a survey kit to check the access points between aisles 10 and 14.',
      },
      { author: 'requester', visibility: 'public', body: 'Thanks {agent}. Aisle 12 is the worst, especially near the chiller doors.' },
      {
        author: 'assignee',
        visibility: 'internal',
        body: 'ap-lds-a12 drops clients as they hand over to ap-lds-a13; that pair is two firmware versions behind the rest. Updating them outside picking hours.',
      },
    ],
    custom: { site: 'Leeds DC', affectedUsers: 24 },
  },
  {
    key: 'H13',
    name: 'authenticator-vpn',
    title: 'Authenticator app not prompting for VPN sign-in',
    description: 'The VPN sign-in waits for the Authenticator prompt but it never arrives on my phone. Other apps send prompts fine.',
    requester: 'elena-kovacs',
    channel: 'email',
    type: 'incident',
    priority: 'P3',
    subcategory: 'vpn',
    team: 'network',
    assignee: 'aisha-rahman',
    status: 'resolved',
    thread: [
      {
        author: 'assignee',
        visibility: 'public',
        body: 'Hi {first}, your phone was still registered from before the upgrade. I’ve reset the registration — please sign in again and approve the new prompt.',
      },
      { author: 'requester', visibility: 'public', body: 'That worked, thank you!' },
    ],
    resolutionNote: 'Re-registered the Authenticator app and confirmed the VPN sign-in with {first}.',
    custom: { site: 'Remote', affectedUsers: 1 },
  },

  /* ---------------------------------------------- Alex's other open tickets (A4 §1.12) */
  {
    key: 'A1',
    name: 'shared-mailbox-missing',
    title: 'Shared mailbox not showing in Outlook after access was granted',
    description:
      'I was given access to the creditors@northwind.example mailbox, but it still isn’t showing in Outlook on my laptop. I can open it in webmail.',
    requester: 'ravi-patel',
    channel: 'portal',
    type: 'incident',
    priority: 'P3',
    subcategory: 'mailbox-drive-access',
    team: 'service-desk',
    assignee: 'alex-morgan',
    status: 'in_progress',
    thread: [
      {
        author: 'assignee',
        visibility: 'public',
        body: 'Hi {first}, new mailbox permissions can take a while to reach Outlook. I’ve applied them again with automatic mapping turned on; could you close Outlook completely and open it again in about an hour?',
      },
      { author: 'requester', visibility: 'public', body: 'Closed and reopened it — still not there, I’m afraid.' },
      {
        author: 'assignee',
        visibility: 'internal',
        body: 'Automapping was off on the original grant. If the re-grant hasn’t shown up by the next check, add the mailbox by hand under Account Settings › Change › More Settings › Advanced.',
      },
    ],
    custom: { site: 'London HQ', affectedUsers: 1 },
  },
  {
    key: 'A2',
    name: 'teams-camera',
    title: 'Teams camera not detected after the Windows update',
    description:
      'Since the update Teams says “We can’t find a camera”. The camera works in the Windows Camera app. I’ve got customer calls all week.',
    requester: 'fatima-khan',
    channel: 'portal',
    type: 'incident',
    priority: 'P3',
    subcategory: 'teams',
    team: 'service-desk',
    assignee: 'alex-morgan',
    status: 'in_progress',
    thread: [
      {
        author: 'assignee',
        visibility: 'public',
        body: 'Hi {first}, thanks — could you try the steps in “Teams camera or microphone not detected”? If that doesn’t do it, I’ll come and reinstall the camera driver.',
      },
      {
        author: 'requester',
        visibility: 'public',
        body: 'Tried the article, no change. The camera light comes on for a second and then goes off.',
      },
      {
        author: 'assignee',
        visibility: 'internal',
        body: 'The camera driver in that update is the known bad one for the Latitude 7450. Rolling it back needs the laptop for half an hour; waiting for a gap between her calls.',
      },
    ],
    custom: { site: 'London HQ', assetTag: 'NW-LT-0093', affectedUsers: 1 },
  },
  {
    key: 'A3',
    name: 'bamboohr-loop',
    title: 'Can’t sign in to BambooHR — sign-in loop',
    description:
      'When I sign in to BambooHR it goes to the Microsoft sign-in page, then back to BambooHR, then back again, round and round. I need to approve two holiday requests today.',
    requester: 'zara-hussain',
    channel: 'email',
    type: 'incident',
    priority: 'P2',
    subcategory: 'bamboohr',
    team: 'service-desk',
    assignee: 'alex-morgan',
    status: 'new',
    thread: [],
    custom: { site: 'London HQ', affectedUsers: 1 },
  },
  {
    key: 'A4',
    name: 'cracked-iphone',
    title: 'Cracked screen on work iPhone — sent for repair',
    description:
      'Megan called: she dropped her work iPhone and the glass is cracked across the top. It still works, but the crack is spreading. She needs a loan phone while it’s away.',
    requester: 'megan-price',
    channel: 'voice',
    type: 'incident',
    priority: 'P4',
    subcategory: 'mobile',
    team: 'service-desk',
    assignee: 'alex-morgan',
    status: 'pending_third_party',
    thread: [
      {
        author: 'assignee',
        visibility: 'public',
        body: 'Hi {first}, I’ve booked the repair with CDW. A courier collects it tomorrow and it should be back within five working days. There’s a loan iPhone waiting for you at reception in the meantime.',
      },
      { author: 'assignee', visibility: 'internal', body: 'CDW repair reference RMA-558214. Loan phone NW-MB-0019 issued from the spares drawer.' },
    ],
    custom: { site: 'London HQ', affectedUsers: 1 },
  },

  /* ---------------------------------------------- Emma Clarke's requests (A4 §1.12) */
  {
    key: 'E1',
    name: 'month-end-pack',
    title: 'Month-end pack won’t open from SharePoint',
    description:
      'The month-end pack on the Finance SharePoint site won’t open — Excel in the browser shows “We can’t open this workbook” after a minute. The team needs it this afternoon.',
    requester: 'emma-clarke',
    channel: 'portal',
    type: 'incident',
    priority: 'P3',
    subcategory: 'onedrive-sharepoint',
    team: 'service-desk',
    assignee: 'grace-okafor',
    status: 'pending_requester',
    thread: [
      {
        author: 'assignee',
        visibility: 'public',
        body: 'Hi {first}, the pack has grown past the size Excel in the browser will open. Could you try opening it in the Excel desktop app instead? Choose “Open in Desktop App” from the Editing menu at the top. Let me know if that works and I’ll look at slimming the file down.',
      },
    ],
    custom: { site: 'London HQ', affectedUsers: 7 },
  },
  {
    key: 'E2',
    name: 'performance-laptop',
    title: 'Laptop: performance (Dell Precision 3591)',
    description:
      'Model: Performance (Dell Precision 3591)\nWhat you’ll use it for: The cash-flow and Power BI models take minutes to recalculate on my current laptop.\nDeliver to: London HQ, 2nd floor',
    requester: 'emma-clarke',
    channel: 'portal',
    type: 'request',
    priority: 'P4',
    subcategory: 'laptop',
    team: 'euc',
    assignee: 'sofia-rossi',
    status: 'in_progress',
    requestItem: 'laptop',
    approver: 'richard-hale',
    thread: [
      {
        author: 'assignee',
        visibility: 'public',
        body: 'Hi {first}, thanks — the performance model needs Richard’s approval, so it’s with him now. As soon as he approves I’ll order it from Dell and let you know the delivery date.',
      },
    ],
    custom: { site: 'London HQ' },
  },
  {
    key: 'E3',
    name: 'home-monitor',
    title: 'Monitor and dock for home working',
    description:
      'What you need: Monitor and docking station\nWhere should we bring it?: My home address — I work from home on Mondays and Fridays\nAnything else: A 27-inch monitor if there is one; I use two screens in the office.',
    requester: 'emma-clarke',
    channel: 'portal',
    type: 'request',
    priority: 'P4',
    subcategory: 'monitor-dock',
    team: 'service-desk',
    assignee: 'priya-shah',
    status: 'new',
    requestItem: 'desk-equipment',
    tasks: [{ title: 'Send a monitor and dock to Emma’s home address', team: 'euc', done: false }],
    thread: [],
    custom: { site: 'Remote' },
  },
  {
    key: 'E4',
    name: 'excel-crash',
    title: 'Excel crashes when opening the cash-flow model',
    description: 'The cash-flow workbook (about 40 MB) crashes Excel as soon as it recalculates. Other files open fine. It’s happened twice today.',
    requester: 'emma-clarke',
    channel: 'portal',
    type: 'incident',
    priority: 'P3',
    subcategory: 'office-apps',
    team: 'service-desk',
    assignee: 'grace-okafor',
    status: 'resolved',
    thread: [
      {
        author: 'assignee',
        visibility: 'public',
        body: 'Hi {first}, could you tell me which copy of the file you’re opening, and whether it crashes on a colleague’s laptop too?',
      },
      { author: 'requester', visibility: 'public', body: 'It’s the copy on the Finance SharePoint site. Lucy opened it fine on her laptop.' },
      {
        author: 'assignee',
        visibility: 'internal',
        body: 'Same file opens on Lucy’s laptop. Emma still has an old Analysis add-in from her previous laptop build; turning it off.',
      },
    ],
    resolutionNote:
      'Hi {first}, the crash was an old add-in clashing with the model’s macros. I’ve turned it off and the workbook now opens and recalculates without a problem. We think this is sorted — let us know if it comes back. It will close automatically in 7 days.',
    custom: { site: 'London HQ', affectedUsers: 1 },
  },
] satisfies readonly HeroContent[];
