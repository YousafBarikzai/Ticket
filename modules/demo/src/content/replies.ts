import type { ReplyLibrary } from '../plan/content-types.js';

/**
 * The conversation on a ticket (A4 §1.13.2): what agents and requesters say
 * to each other from the first answer to "it’s back again".
 *
 * The planner draws a reply by kind and subcategory only, never by title, so
 * every line here has to read true for any ticket it can land on:
 *
 * - The general banks never name a product or a fault: "I’ve narrowed it
 *   down and I’m testing a fix" is true of a printer and of Sage Intacct.
 * - Each subcategory has its own first answers, updates, internal notes and
 *   resolution notes, which the planner prefers when present. They name the
 *   subcategory's tools and teams ("the print server", "Business
 *   Applications") but not a particular fault, because "Outlook keeps asking
 *   for my password" and "My email signature has disappeared" share a bank —
 *   and where a subcategory holds requests as well as incidents, its lines
 *   fit both.
 * - Updates promise progress without claiming a milestone, since a ticket
 *   may draw several in any order. Waiting messages (`clarifying`,
 *   `thirdParty`) follow any first answer, so they ask the requester to act
 *   or confirm rather than open a new line of questions.
 *
 * A reply may use `{first}` (the requester's first name) and `{agent}` (the
 * replying agent's), and nothing else: agents greet the requester, and
 * requesters now and then thank the agent by name. Internal notes are terse,
 * as notes are.
 */
export const REPLIES = {
  firstResponse: [
    'Thanks {first}, I’ve picked this up and I’m looking now.',
    'Hi {first}, thanks for letting us know. I’m on this and will update you shortly.',
    'Hi {first}, I’ve got this one. Give me a little while to look into it and I’ll come back to you.',
    'Thanks {first} — I’ve taken this. I’ll be in touch as soon as I know more.',
    'Hi {first}, sorry you’re having trouble with this. I’m looking into it now.',
    'Hi {first}, thanks for the detail, that helps. I’m working on it and will update you here.',
  ],
  update: [
    'Quick update: still working on this. I’ll update you again before the end of the day.',
    'Still on this — I’ve ruled out the obvious causes and I’m trying the next thing now.',
    'An update for you: I’ve narrowed it down and I’m testing a fix. I’ll let you know how it goes.',
    'Just to keep you posted: I’m waiting for a colleague to check something on our side, then I’ll be back in touch.',
    'Still looking at this. Nothing for you to do yet — I’ll update you again later today.',
    'Progress update: I think I know what’s causing it, and I’m working on the fix now.',
    'A quick note to say this hasn’t been forgotten. I’m still on it and will update you soon.',
    'Still in hand. I’ll let you know as soon as there’s something for you to try.',
  ],
  clarifying: [
    'Could you try that when you get a moment and let me know how you get on? I’ll keep this open until I hear back.',
    'Have you had a chance to try that? Let me know either way and I’ll take it from there.',
    'When you’re next at your laptop, could you check whether it’s still happening and reply here?',
    'Could you give it another go and tell me exactly what you see? Then I can take it further.',
    'Could you let me know a good time to connect to your laptop remotely? I’ll pick it up from there.',
  ],
  thirdParty: [
    'I’ve raised this with the supplier and they’re looking at it. I’ll update you as soon as they come back to us.',
    'This needs the supplier to make a change on their side, so I’ve logged it with them and I’m waiting to hear back.',
    'The supplier has picked this up and promised an answer within two working days. I’ll chase them if we haven’t heard by then.',
    'We’re waiting on the supplier for this one. There’s nothing you need to do in the meantime.',
  ],
  requesterPositive: [
    'That’s sorted it, thank you!',
    'All working now — thanks for your help.',
    'Brilliant, thank you.',
    'Perfect, that’s done the trick. Thanks {agent}.',
    'Great, thanks for sorting it so quickly.',
    'Thanks {agent}, much appreciated.',
  ],
  requesterMoreInfo: [
    'I’ve tried that and it’s still the same, I’m afraid.',
    'It happens a few times a day, usually first thing in the morning.',
    'Done — still the same as before.',
    'It seems to be every time. Happy for you to take a look remotely.',
    'The message just says “Something went wrong”. I can copy the full text into a reply if that helps.',
    'I’m in the office all day today if it’s easier to come and see it.',
  ],
  requesterFrustrated: [
    'This is the third time this week — can someone come and look?',
    'Is there any update? I really need this working today.',
    'Still not working and I’ve got a deadline this afternoon.',
    'I’ve already tried all of that. Could someone call me please?',
    'This is holding up my whole team now.',
  ],
  internalNote: [
    'Checked the logs — nothing obvious. Trying the standard fix next.',
    'Same as a couple of other tickets this week; keeping an eye out for a pattern.',
    'Spoke to them on Teams; they’re happy for us to connect remotely.',
    'Needs a second pair of eyes — asked in the team channel.',
    'Confirmed with the user on the phone; nothing else affected.',
  ],
  resolution: [
    'That’s all sorted now — let us know if anything else crops up.',
    'I’m resolving this now. If it comes back, just reply here and it will reopen.',
    'All done. If anything isn’t right, reply here within seven days and the ticket will reopen.',
    'I’m closing this one off now — if you need anything else, just reply here.',
    'Resolved: confirmed with {first} that everything is working.',
  ],
  isItFixed: [
    'We think this is sorted — let us know if it comes back. It will close automatically in 7 days.',
    'I believe this is fixed now. If you still see the problem, just reply and the ticket will reopen; otherwise it closes by itself in 7 days.',
    'This should be working again. Could you check when you have a moment? If we don’t hear from you, it will close automatically in 7 days.',
  ],
  reopen: [
    'It’s back again this morning, same as before.',
    'Sorry, it’s started doing it again.',
    'This worked for a day but the problem has come back.',
    'Still happening, I’m afraid — it wasn’t fixed after all.',
  ],
  cancelled: [
    'Please cancel this — it’s started working again.',
    'No longer needed, thanks — I’ve found another way round it.',
    'Raised this twice by mistake, please close this one.',
    'Please cancel — a colleague sorted it for me.',
    'Not needed any more, thanks.',
  ],

  bySubcategory: {
    /* ---------------------------------------------- Access & identity */
    'password-sign-in': {
      firstResponse: [
        'Hi {first}, thanks — I can see the sign-in attempts on your account. I’ll call your desk number to check it’s you, then sort it out.',
        'Hi {first}, I’ve picked this up. Once I’ve confirmed it’s you, I’ll unlock or reset the account and stay on the line while you sign in.',
      ],
      update: [
        'Quick update: the account looks fine now, so I’m checking whether a saved password on another device is getting in the way.',
        'Still on this — changes to your sign-in can take ten minutes to reach every system. I’ll check back with you shortly.',
        'An update for you: I’m going through the sign-in logs to see exactly where it fails.',
        'Still working on it. Nothing for you to do for now.',
      ],
      internalNote: [
        'Identity verified by call-back on the HR number before any change.',
        'Sign-in logs show an old password still being tried from a phone’s mail app.',
        'Failures all from the office network; nothing suspicious.',
      ],
      resolution: [
        'Unlocked the account and reset the password with {first} on the phone; signed in to the laptop and webmail without a problem.',
        'Cleared an old saved password that kept locking the account; {first} can sign in everywhere again.',
        'Password reset and sign-in tested with {first}; all working.',
      ],
    },
    mfa: {
      firstResponse: [
        'Hi {first}, I can reset your sign-in methods so you can set up the Authenticator app again. I’ll call the number on your HR record first to check it’s you.',
        'Hi {first}, thanks — I’ve picked this up for Identity & Security. Please don’t approve any request you didn’t start while we look at it.',
      ],
      update: [
        'Quick update: I’ve checked the sign-in methods on your account and I’m tidying up the old ones.',
        'Still on this — I’m confirming with Identity & Security that nothing else is registered against your account.',
        'An update for you: when you’re ready, sign in on your laptop and it will walk you through setting up the app again.',
        'Still working on it. I’ll call you shortly to finish this off together.',
      ],
      internalNote: [
        'Identity verified by call-back on the HR number before the reset.',
        'Old phone still listed as a sign-in method. Removed it and revoked sessions.',
      ],
      resolution: [
        'Re-registered the Authenticator app and confirmed a sign-in with {first}.',
        'Cleared the old sign-in methods; {first} set the app up again while we were on the phone.',
        'Sign-in approvals now arrive on the right phone; tested with {first}.',
      ],
    },
    'mailbox-drive-access': {
      firstResponse: [
        'Hi {first}, thanks — I’ve picked this up. I’ll check who owns it and what access you already have, then come back to you.',
        'Hi {first}, I can see the request. I’ll look at the permissions now; changes can take up to an hour to appear on your laptop.',
      ],
      update: [
        'Quick update: the permissions look right on our side, so I’m checking how they reach your laptop.',
        'Still on this — nothing for you to do yet. I’ll update you as soon as it’s in place.',
        'An update for you: I’ve checked the group memberships and I’m waiting for them to sync, which can take up to an hour.',
        'Still working on it. If it appears before you hear from me, close and reopen Outlook or File Explorer.',
      ],
      internalNote: [
        'Owner confirmed on Teams. Added to the group rather than the person, so it survives the next restructure.',
        'Group membership correct; waiting for it to sync.',
      ],
      resolution: [
        'Access sorted and confirmed with {first}; it shows in Outlook and File Explorer.',
        'Group membership corrected; {first} can open it now.',
        'Fixed the permissions and checked with {first} after a restart; all working.',
      ],
    },
    'joiners-leavers': {
      firstResponse: [
        'Hi {first}, thanks — I’ve set the tasks going. Identity & Security handle the account side and End-User Computing the kit. I’ll update you here as each part is done.',
        'Hi {first}, I’ve picked this up and checked the dates with HR. Everything is on track for the date in the form.',
      ],
      update: [
        'Quick update: everything is on track for the date in the form.',
        'Still on this — the tasks are with Identity & Security and End-User Computing, and nothing is held up.',
        'An update for you: the account side is in hand. I’ll confirm when the kit is ready too.',
        'Just to keep you posted: no problems so far. I’ll update you again before the day.',
      ],
      internalNote: [
        'HR record matches the form. Using the team’s role template for groups.',
        'Kit to go by tracked courier to the site’s facilities supervisor, not to the person.',
      ],
      resolution: [
        'All tasks complete and checked against the form.',
        'Everything on the form is done; confirmed with {first}.',
        'Completed as per the form; HR updated.',
      ],
    },
    'app-access': {
      firstResponse: [
        'Hi {first}, thanks — this needs your manager’s approval, so I’ve sent it to them. I’ll set it up as soon as they approve.',
        'Hi {first}, I’ve picked this up. Could you confirm whether read-only access is enough, or whether you need to make changes?',
      ],
      update: [
        'Quick update: I’m checking we have a licence free for this.',
        'Still on this — waiting for the go-ahead, then it’s a quick job.',
        'An update for you: I’ve set up the access; it can take up to an hour to work everywhere.',
        'Still working on it. Nothing for you to do for now.',
      ],
      internalNote: [
        'Licence pool checked: spare seats available, no purchase needed.',
        'Added to the app’s access group in Entra ID rather than inside the app, so leavers lose it automatically.',
      ],
      resolution: [
        'Access granted and tested with {first}.',
        'Added to the access group; {first} has signed in successfully.',
        'Licence assigned and access confirmed.',
      ],
    },

    /* ---------------------------------------------- Software & Microsoft 365 */
    outlook: {
      firstResponse: [
        'Hi {first}, thanks — could you check whether the same thing happens in webmail? That tells us whether it’s Outlook or the mailbox.',
        'Hi {first}, I’ve picked this up. I’ll connect to your laptop remotely to look at Outlook — let me know if now isn’t a good time.',
      ],
      update: [
        'Quick update: the mailbox itself looks healthy, so I’m concentrating on the Outlook app on your laptop.',
        'Still working on this. I’m testing a fix on a laptop with the same build as yours before I try it on yours.',
        'An update for you: your mailbox settings look fine. Next I’m checking the add-ins in Outlook.',
        'Still on this — nothing for you to do for now. I’ll be in touch when I have something to try.',
      ],
      internalNote: [
        'Webmail fine, so it’s the client. Profile rebuild next if a repair doesn’t do it.',
        'Same Outlook build as a few other tickets this week; keeping an eye out for a pattern.',
      ],
      resolution: [
        'Repaired Microsoft 365 Apps and rebuilt the Outlook profile; working normally again.',
        'Fixed on the mailbox side and confirmed with {first} in Outlook.',
        'Cleared the cached settings in Outlook and restarted it; all working.',
      ],
    },
    teams: {
      firstResponse: [
        'Hi {first}, thanks — could you quit Teams completely (right-click the icon by the clock and choose Quit) and open it again? If it’s still happening, I’ll connect and have a look.',
        'Hi {first}, sorry about that. Does it happen everywhere, or only in particular rooms or on Wi-Fi?',
      ],
      update: [
        'Quick update: I’ve cleared the Teams cache on your laptop, which fixes a lot of these. Let me know if you see it again.',
        'Still on this — it looks like the laptop rather than your account, so I’m checking the drivers next.',
        'An update for you: Teams looks fine for your account from our side, so I’m concentrating on the laptop.',
        'Still working on it. I’ll be back in touch later today.',
      ],
      internalNote: [
        'Teams works on their phone, so not the account. Cleared the cache remotely.',
        'Call quality report shows packet loss on Wi-Fi only.',
      ],
      resolution: [
        'Cleared the Teams cache and updated the drivers; working normally again.',
        'Reset the Teams app and checked its settings; tested with a call to {first}.',
        'Updated Teams to the current version and confirmed it’s working with {first}.',
      ],
    },
    'office-apps': {
      firstResponse: [
        'Hi {first}, I’ve picked this up. I’ll run a quick repair of Microsoft 365 Apps, which fixes a lot of these, and then check back with you.',
        'Hi {first}, thanks — I’ll connect to your laptop to see it for myself. Let me know if now isn’t a good time.',
      ],
      update: [
        'Quick update: the repair has finished. Could you try again and let me know?',
        'Still on this — I’m checking the add-ins installed on your laptop next.',
        'An update for you: I can’t reproduce it on my laptop, so I’m looking at the set-up on yours.',
        'Still working on it. Nothing for you to do for now.',
      ],
      internalNote: [
        'Can’t reproduce on a test laptop; probably something local to theirs.',
        'Ran a quick repair remotely; full repair next if needed.',
      ],
      resolution: [
        'Ran a Microsoft 365 Apps repair and turned off an old add-in; working normally now.',
        'Signed out of Office and back in, which refreshed the licence and settings; all working.',
        'Sorted with {first} on a call; working as expected.',
      ],
    },
    'install-request': {
      firstResponse: [
        'Hi {first}, thanks — I’ve checked and this isn’t in Company Portal yet. I’ll package it and push it to your laptop.',
        'Hi {first}, I can install this for you. If it needs a paid licence, your manager will be asked to approve it first.',
      ],
      update: [
        'Quick update: I’m packaging it now and will push it to your laptop when it’s ready.',
        'Still on this — checking the licence terms before it goes on.',
        'An update for you: it’s nearly ready. Keep your laptop connected to the office network or the VPN so it can arrive.',
        'Still working on it. Nothing for you to do for now.',
      ],
      internalNote: ['Checked the approved software list; fine to install.', 'Free version covers what they need; no licence required.'],
      resolution: [
        'Installed through Company Portal and confirmed it opens.',
        'Licence assigned and software installed; {first} has signed in.',
        'Added to Company Portal, so anyone who needs it can install it themselves.',
      ],
    },
    'onedrive-sharepoint': {
      firstResponse: [
        'Hi {first}, I’ve picked this up. I’ll check the site’s permissions and the recycle bin first.',
        'Hi {first}, thanks — I’ll connect to your laptop to look at OneDrive and SharePoint together. Let me know if now isn’t a good time.',
      ],
      update: [
        'Quick update: your files are safe on SharePoint, so it’s the laptop’s side I’m working on.',
        'Still on this — checking the library’s settings and permissions.',
        'An update for you: I’ve restarted the sync on your laptop. A large library can take an hour to catch up.',
        'Still working on it. Nothing for you to do for now.',
      ],
      internalNote: [
        'Files present on SharePoint; looks like a local sync problem.',
        'Checked the site’s recycle bin and permissions; nothing unusual.',
      ],
      resolution: [
        'Reset the OneDrive app and resynced; everything is up to date.',
        'Fixed the permissions on the library; {first} can open everything now.',
        'Sorted with {first} on a call; the files are all where they should be.',
      ],
    },

    /* ---------------------------------------------- Hardware */
    laptop: {
      firstResponse: [
        'Hi {first}, thanks — could you bring the laptop to the service desk when you get a moment? If that’s hard, we can come to you.',
        'Hi {first}, I’ve picked this up for End-User Computing. I’ll check the warranty and come back to you with the options.',
      ],
      update: [
        'Quick update: I’ve checked the warranty and I’m sorting out the next step with Dell.',
        'Still on this — a spare laptop is ready if you need one in the meantime.',
        'An update for you: I’m working out the quickest way to get you sorted and will confirm shortly.',
        'Still working on it. Nothing for you to do for now.',
      ],
      internalNote: ['Warranty checked: Dell ProSupport, next business day on site.', 'Spare loan laptop available in the cupboard if needed.'],
      resolution: [
        'Sorted under the Dell warranty; the laptop is back with {first} and working.',
        'Swapped for a newly built laptop and moved {first}’s files across.',
        'Fixed at the desk and tested with {first}.',
      ],
    },
    'monitor-dock': {
      firstResponse: [
        'Hi {first}, thanks — I’ve picked this up. Could you tell me your desk number so I can bring what’s needed to the right place?',
        'Hi {first}, I’ll come and have a look at your desk set-up — let me know if there’s a time that suits.',
      ],
      update: [
        'Quick update: I’ve checked what we have in stores and I’ll bring it up shortly.',
        'Still on this — the dock’s firmware is due an update, which I’ll do at the same time.',
        'An update for you: I’ll be up to your desk later today.',
        'Still working on it. Nothing for you to do for now.',
      ],
      internalNote: ['Dock on old firmware; worth updating while there.', 'Spare monitor and dock in stores; booked out.'],
      resolution: [
        'Replaced the DisplayPort cable and updated the dock firmware; both screens working.',
        'Delivered and set up the kit; tested with {first}.',
        'Sorted at the desk; everything working normally.',
      ],
    },
    printer: {
      firstResponse: [
        'Hi {first}, thanks — is it just you, or can colleagues nearby not print either? That tells us whether it’s the printer or your laptop.',
        'Hi {first}, I’ve picked this up. I’ll check the printer’s queue on the print server first.',
      ],
      update: [
        'Quick update: the queue on the print server looks clear, so I’m checking the printer itself.',
        'Still on this — I’ve asked someone nearby to read me what the printer’s screen says.',
        'An update for you: this one may need the supplier’s engineer. I’ll confirm shortly.',
        'Still working on it. Nothing for you to do for now.',
      ],
      internalNote: ['Restarted the spooler on the print server.', 'Printer’s network address changed after a power cut; reserved it.'],
      resolution: [
        'Cleared the stuck queue and restarted the print spooler; printing again.',
        'Re-added the printer on {first}’s laptop; test page printed.',
        'Fixed by the supplier’s engineer; the printer is back in service.',
      ],
    },
    mobile: {
      firstResponse: [
        'Hi {first}, I can help with this. I’ll check what we have and come back to you.',
        'Hi {first}, thanks — I’ve picked this up and I’ll be in touch shortly about next steps.',
      ],
      update: [
        'Quick update: I’m sorting this out with our phone supplier.',
        'Still on this — I’ll let you know as soon as there’s something to collect.',
        'An update for you: everything is in hand, and there’s nothing for you to do yet.',
        'Still working on it. I’ll be back in touch later today.',
      ],
      internalNote: ['Loan phone available from the spares drawer if needed.', 'Checked in Company Portal; device record up to date.'],
      resolution: [
        'Phone sorted and handed back to {first}; email, Teams and Authenticator all working.',
        'New phone set up with email, Teams and Authenticator; the old one wiped and collected.',
        'Fixed and tested with {first}.',
      ],
    },

    /* ---------------------------------------------- Business applications */
    salesforce: {
      firstResponse: [
        'Hi {first}, thanks — I’ve passed this to Business Applications, who look after Salesforce. One of us will update you shortly.',
        'Hi {first}, I’ve picked this up and I’ll look at it in the sandbox first.',
      ],
      update: [
        'Quick update: I’m working through this in the sandbox before changing anything in production.',
        'Still on this — I’m checking the sharing rules and profiles involved.',
        'An update for you: nearly there. I’ll confirm once it’s done.',
        'Still working on it. Nothing for you to do for now.',
      ],
      internalNote: ['Testing the change in the sandbox first.', 'Licence pool checked: spare Sales Cloud seats available.'],
      resolution: [
        'Done in Salesforce and confirmed with {first}.',
        'Fixed the settings in Salesforce; {first} confirmed it works.',
        'Licence, profile and access sorted; {first} has signed in.',
      ],
    },
    'sage-intacct': {
      firstResponse: [
        'Hi {first}, thanks — I’ve picked this up and I know Finance rely on it. I’ll update you within the hour.',
        'Hi {first}, I’m on this. Could you tell me which entity and period you were working in?',
      ],
      update: [
        'Quick update: I’ve found what’s causing it and I’m correcting it now.',
        'Still on this — I’ve raised it with Sage support as well, in case it’s on their side.',
        'An update for you: I’m testing the fix in the sandbox company first.',
        'Still working on it. I’ll update you again within the hour.',
      ],
      internalNote: ['Checked the audit trail for recent changes to the records involved.', 'Raised with Sage support as a precaution.'],
      resolution: [
        'Corrected the records involved and re-ran the step; working normally.',
        'Fixed in Sage Intacct and checked with {first}.',
        'Resolved with Sage support’s help; Finance confirmed it’s working.',
      ],
    },
    bamboohr: {
      firstResponse: [
        'Hi {first}, thanks — I’ve picked this up. I’ll check your BambooHR account and permissions first.',
        'Hi {first}, thanks — I’ve passed this to Business Applications, who look after BambooHR. We’ll update you shortly.',
      ],
      update: [
        'Quick update: I’ve found the setting involved and I’m checking it with HR before I change it.',
        'Still on this — I’ve raised it with BambooHR support as well.',
        'An update for you: nearly there. I’ll confirm once it’s done.',
        'Still working on it. Nothing for you to do for now.',
      ],
      internalNote: ['Checked the record in BambooHR; correcting the field that’s out of date.', 'Raised with BambooHR support as a precaution.'],
      resolution: [
        'Corrected {first}’s BambooHR record; all working.',
        'Permissions updated in BambooHR; confirmed with {first}.',
        'Fixed with BambooHR support; {first} confirmed it works.',
      ],
    },
    wms: {
      firstResponse: [
        'Hi {first}, thanks — I know this stops picking, so I’m on it now.',
        'Hi {first}, I’ve picked this up. I’ll check the WMS server and the scanner logins from here.',
      ],
      update: [
        'Quick update: the WMS server is healthy, so I’m looking at the warehouse end.',
        'Still on this — I’ve asked Network to check the Wi-Fi in that part of the warehouse as well.',
        'An update for you: I think I’ve found what’s causing it and I’m correcting it now.',
        'Still working on it. I’ll update you again within the hour.',
      ],
      internalNote: ['lds-wms-db01 healthy; problem local to the warehouse floor.', 'User profiles re-pushed to the scanners from Zebra MDM.'],
      resolution: [
        'Fixed on the WMS side and checked with the shift supervisor; picking normally.',
        'Re-pushed the user profiles to the scanners; everyone can log in again.',
        'Corrected the data in the WMS; confirmed with {first}.',
      ],
    },

    /* ---------------------------------------------- Network */
    vpn: {
      firstResponse: [
        'Hi {first}, thanks — I’ve picked this up for Network. I’ll check your VPN account and profile first.',
        'Hi {first}, thanks — I’ll look at the VPN gateway logs and your profile and come back to you.',
      ],
      update: [
        'Quick update: your VPN profile looks fine on our side, so I’m checking the client on your laptop.',
        'Still on this — I’m looking through the gateway logs for your connection attempts.',
        'An update for you: I’ve pushed the current VPN profile to your laptop; it arrives the next time it’s online.',
        'Still working on it. Nothing for you to do for now.',
      ],
      internalNote: ['Client on an old profile; pushed the new one.', 'Gateway logs checked; nothing blocking the account.'],
      resolution: [
        'Pushed the current VPN profile; {first} connects normally from home.',
        'Renewed the VPN certificate and tested the connection with {first}.',
        'VPN set up and tested with {first}.',
      ],
    },
    wifi: {
      firstResponse: [
        'Hi {first}, I’ve picked this up for Network. I’ll check the access points in that area.',
        'Hi {first}, thanks — I’ll look into this now and come back to you.',
      ],
      update: [
        'Quick update: I’m checking the access points and their channels in that area.',
        'Still on this — I’ve asked for a survey of that area to find the weak spot.',
        'An update for you: we’ll make a change this evening, outside working hours.',
        'Still working on it. Nothing for you to do for now.',
      ],
      internalNote: ['Access point on a crowded channel; moving it after 18:00.', 'Client on an old Wi-Fi certificate; a restart on the dock renews it.'],
      resolution: [
        'Moved the access point to a quieter channel; the connection has been stable since.',
        'Fixed and tested with {first}.',
        'Sorted on the Wi-Fi controller; confirmed working in that area.',
      ],
    },
    'site-connectivity': {
      firstResponse: [
        'Hi {first}, thanks — I’m on this now and checking the site link from our monitoring.',
        'Hi {first}, we can see the problem from here too. Network are on it; I’ll update you every 30 minutes.',
      ],
      update: [
        'Quick update: we can see the fault on our monitoring and we’re working on it.',
        'Still on this — the site is running on the backup link while we work on the main one, so expect it to be slower.',
        'An update for you: we’ve raised it with BT and they’re investigating.',
        'Still working on it. I’ll update you every 30 minutes until it’s fixed.',
      ],
      internalNote: ['Main circuit down; SD-WAN failed over to 4G automatically.', 'Switch in the comms cupboard rebooted overnight; checking the power.'],
      resolution: [
        'Fault fixed and the site is back to normal; confirmed with {first}.',
        'Replaced the failed equipment in the comms cupboard; everything reconnected.',
        'BT repaired the circuit and the site is back on its main link.',
      ],
    },

    /* ---------------------------------------------- Security */
    phishing: {
      firstResponse: [
        'Hi {first}, thanks for reporting this — you were right to. Please don’t act on it while I check it.',
        'Hi {first}, thank you. I’ve picked this up and I’m checking whether anyone else received it.',
      ],
      update: [
        'Quick update: it’s being checked now. Please don’t act on it in the meantime.',
        'Still on this — checking whether anyone else received it.',
        'An update for you: I’m removing it from everyone’s inbox while we finish checking.',
        'Still working on it. Nothing for you to do.',
      ],
      internalNote: ['Sender spoofed; link goes to a fake sign-in page. Purged from all mailboxes.', 'Several recipients; no clicks in the proxy logs.'],
      resolution: [
        'Confirmed phishing. Removed it everywhere we found it and blocked the sender; nobody clicked.',
        'Checked it: this one is genuine, so it’s safe to act on.',
        'Blocked the sender and the link; thanks again for reporting it.',
      ],
    },
    'suspicious-sign-in': {
      firstResponse: [
        'Hi {first}, thanks for telling us straight away. Please don’t approve any request you didn’t start; I’m checking your sign-ins now.',
        'Hi {first}, I’ve picked this up for Identity & Security. I’ll call you on your desk number to go through it.',
      ],
      update: [
        'Quick update: I’ve signed you out everywhere, and you’ll be asked to set a new password.',
        'Still on this — checking your mailbox for rules or changes you didn’t make.',
        'An update for you: nothing so far suggests anyone got in, but I’m finishing the checks.',
        'Still working on it. Please keep an eye out for anything else unusual.',
      ],
      internalNote: [
        'Sign-in attempt from an unfamiliar country blocked by conditional access. Reset the password anyway.',
        'Checked the mailbox for forwarding rules; removed one the user didn’t create.',
      ],
      resolution: [
        'Reset the password, revoked all sessions and checked the mailbox for changes. No sign of data taken.',
        'Checked the sign-in logs: this was {first}’s own old device. Removed it and reset the password to be safe.',
        'Sign-in attempts blocked; no access gained. New password set.',
      ],
    },
    'lost-stolen-device': {
      firstResponse: [
        'Hi {first}, thanks for telling us so quickly. I’m locking the device remotely now.',
        'Hi {first}, I’ve picked this up. Don’t worry — it’s encrypted, and I’m locking it now.',
      ],
      update: [
        'Quick update: the device is locked and your sessions are signed out. A replacement is being prepared.',
        'Still on this — I’ve asked lost property to keep an eye out as well.',
        'An update for you: no sign of anyone trying to use it. I’ll let you know about the replacement.',
        'Still working on it. Nothing for you to do for now.',
      ],
      internalNote: ['Locked, and wipe queued in Intune; encryption confirmed.', 'Sessions revoked; password change forced.'],
      resolution: [
        'Device wiped remotely and a replacement issued to {first}.',
        'Found and handed in to lost property; checked and returned to {first}.',
        'Device locked and wiped; asset recorded as lost.',
      ],
    },

    /* ---------------------------------------------- Facilities & how-to */
    'meeting-room-av': {
      firstResponse: [
        'Hi {first}, on my way up now.',
        'Hi {first}, thanks — could you unplug the cable, wait five seconds and plug it in again? If that doesn’t work, I’ll come up.',
      ],
      update: [
        'Quick update: I’ve restarted the room’s system remotely. Could you try again?',
        'Still on this — someone is on their way up with a spare.',
        'An update for you: I’ve logged it with the AV supplier in case it needs a part.',
        'Still working on it. The room next door is free if you need it.',
      ],
      internalNote: ['Room console stuck on an update; restarted it from the Teams Rooms admin page.', 'Cable damaged at the connector; replaced.'],
      resolution: [
        'Fixed in the room and tested with {first}.',
        'Restarted the room system and checked the screen, sound and camera; all working.',
        'Replaced the faulty cable; tested with {first}’s laptop.',
      ],
    },
    questions: {
      firstResponse: [
        'Hi {first}, good question! There’s an article on this in the Help Portal — I’ll send you the link.',
        'Hi {first}, happy to help. Here’s how to do it, step by step.',
      ],
      update: [
        'Quick update: I’ve checked with the team and I’ll come back to you shortly with the answer.',
        'Still on this — I’m confirming the right answer for your site.',
        'An update for you: nearly there; I’ll send you the details shortly.',
        'Still working on it. I’ll be back in touch later today.',
      ],
      internalNote: ['Common question this week; worth a pinned article.', 'Answered on Teams as well.'],
      resolution: ['Answered — sent {first} the article and the steps.', 'Talked {first} through it on a call; all set.', 'Answered by email; closing.'],
    },
  },
} satisfies ReplyLibrary;
