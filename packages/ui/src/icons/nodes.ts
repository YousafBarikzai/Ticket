/// <reference path="./lucide-icons.d.ts" />
/**
 * The drawings behind the registry: each name's lucide icon node, imported by
 * deep path so a bundle carries these icons and no others.
 *
 * Kept apart from `registry.ts` so that knowing the names costs nothing and
 * only drawing an icon pays for the data. `Icon` imports this module; a
 * server component that draws icons sends none of it to the browser, and a
 * client component that does pays for the registry once (about 120 bytes
 * gzipped per icon).
 *
 * `satisfies Record<IconName, IconNode>` is the check that every registered
 * name has a drawing and nothing else does; `icons.test.ts` checks that each
 * drawing is the lucide file the registry names.
 */
import type { IconNode } from 'lucide';
import type { IconName } from './registry.js';

import archiveIcon from 'lucide/dist/esm/icons/archive.mjs';
import arrowDownIcon from 'lucide/dist/esm/icons/arrow-down.mjs';
import arrowLeftIcon from 'lucide/dist/esm/icons/arrow-left.mjs';
import arrowRightIcon from 'lucide/dist/esm/icons/arrow-right.mjs';
import arrowUpIcon from 'lucide/dist/esm/icons/arrow-up.mjs';
import arrowUpDownIcon from 'lucide/dist/esm/icons/arrow-up-down.mjs';
import arrowUpRightIcon from 'lucide/dist/esm/icons/arrow-up-right.mjs';
import banIcon from 'lucide/dist/esm/icons/ban.mjs';
import bellIcon from 'lucide/dist/esm/icons/bell.mjs';
import bookOpenIcon from 'lucide/dist/esm/icons/book-open.mjs';
import botIcon from 'lucide/dist/esm/icons/bot.mjs';
import boxesIcon from 'lucide/dist/esm/icons/boxes.mjs';
import buildingComplexIcon from 'lucide/dist/esm/icons/building-complex.mjs';
import calendarIcon from 'lucide/dist/esm/icons/calendar.mjs';
import calendarClockIcon from 'lucide/dist/esm/icons/calendar-clock.mjs';
import chartNoAxesCombinedIcon from 'lucide/dist/esm/icons/chart-no-axes-combined.mjs';
import checkIcon from 'lucide/dist/esm/icons/check.mjs';
import chevronDownIcon from 'lucide/dist/esm/icons/chevron-down.mjs';
import chevronLeftIcon from 'lucide/dist/esm/icons/chevron-left.mjs';
import chevronRightIcon from 'lucide/dist/esm/icons/chevron-right.mjs';
import chevronUpIcon from 'lucide/dist/esm/icons/chevron-up.mjs';
import chevronsUpDownIcon from 'lucide/dist/esm/icons/chevrons-up-down.mjs';
import circleAlertIcon from 'lucide/dist/esm/icons/circle-alert.mjs';
import circleCheckIcon from 'lucide/dist/esm/icons/circle-check.mjs';
import circleCheckBigIcon from 'lucide/dist/esm/icons/circle-check-big.mjs';
import circleDashedIcon from 'lucide/dist/esm/icons/circle-dashed.mjs';
import circlePauseIcon from 'lucide/dist/esm/icons/circle-pause.mjs';
import circleQuestionMarkIcon from 'lucide/dist/esm/icons/circle-question-mark.mjs';
import circleUserIcon from 'lucide/dist/esm/icons/circle-user.mjs';
import circleXIcon from 'lucide/dist/esm/icons/circle-x.mjs';
import clockIcon from 'lucide/dist/esm/icons/clock.mjs';
import cloudOffIcon from 'lucide/dist/esm/icons/cloud-off.mjs';
import columns3Icon from 'lucide/dist/esm/icons/columns-3.mjs';
import contrastIcon from 'lucide/dist/esm/icons/contrast.mjs';
import copyIcon from 'lucide/dist/esm/icons/copy.mjs';
import dotIcon from 'lucide/dist/esm/icons/dot.mjs';
import downloadIcon from 'lucide/dist/esm/icons/download.mjs';
import ellipsisIcon from 'lucide/dist/esm/icons/ellipsis.mjs';
import externalLinkIcon from 'lucide/dist/esm/icons/external-link.mjs';
import eyeIcon from 'lucide/dist/esm/icons/eye.mjs';
import eyeOffIcon from 'lucide/dist/esm/icons/eye-off.mjs';
import fileIcon from 'lucide/dist/esm/icons/file.mjs';
import fileTextIcon from 'lucide/dist/esm/icons/file-text.mjs';
import flagIcon from 'lucide/dist/esm/icons/flag.mjs';
import globeIcon from 'lucide/dist/esm/icons/globe.mjs';
import gripVerticalIcon from 'lucide/dist/esm/icons/grip-vertical.mjs';
import hourglassIcon from 'lucide/dist/esm/icons/hourglass.mjs';
import houseIcon from 'lucide/dist/esm/icons/house.mjs';
import inboxIcon from 'lucide/dist/esm/icons/inbox.mjs';
import infoIcon from 'lucide/dist/esm/icons/info.mjs';
import keyRoundIcon from 'lucide/dist/esm/icons/key-round.mjs';
import keyboardIcon from 'lucide/dist/esm/icons/keyboard.mjs';
import laptopIcon from 'lucide/dist/esm/icons/laptop.mjs';
import layers2Icon from 'lucide/dist/esm/icons/layers-2.mjs';
import layoutGridIcon from 'lucide/dist/esm/icons/layout-grid.mjs';
import lifeBuoyIcon from 'lucide/dist/esm/icons/life-buoy.mjs';
import linkIcon from 'lucide/dist/esm/icons/link.mjs';
import listFilterIcon from 'lucide/dist/esm/icons/list-filter.mjs';
import listTodoIcon from 'lucide/dist/esm/icons/list-todo.mjs';
import loaderCircleIcon from 'lucide/dist/esm/icons/loader-circle.mjs';
import lockIcon from 'lucide/dist/esm/icons/lock.mjs';
import logInIcon from 'lucide/dist/esm/icons/log-in.mjs';
import logOutIcon from 'lucide/dist/esm/icons/log-out.mjs';
import mailIcon from 'lucide/dist/esm/icons/mail.mjs';
import menuIcon from 'lucide/dist/esm/icons/menu.mjs';
import messageCircleIcon from 'lucide/dist/esm/icons/message-circle.mjs';
import messageSquareIcon from 'lucide/dist/esm/icons/message-square.mjs';
import minusIcon from 'lucide/dist/esm/icons/minus.mjs';
import monitorIcon from 'lucide/dist/esm/icons/monitor.mjs';
import moonIcon from 'lucide/dist/esm/icons/moon.mjs';
import panelLeftIcon from 'lucide/dist/esm/icons/panel-left.mjs';
import panelRightIcon from 'lucide/dist/esm/icons/panel-right.mjs';
import paperclipIcon from 'lucide/dist/esm/icons/paperclip.mjs';
import pencilIcon from 'lucide/dist/esm/icons/pencil.mjs';
import phoneIcon from 'lucide/dist/esm/icons/phone.mjs';
import pinIcon from 'lucide/dist/esm/icons/pin.mjs';
import playIcon from 'lucide/dist/esm/icons/play.mjs';
import plugIcon from 'lucide/dist/esm/icons/plug.mjs';
import plusIcon from 'lucide/dist/esm/icons/plus.mjs';
import refreshCwIcon from 'lucide/dist/esm/icons/refresh-cw.mjs';
import replyIcon from 'lucide/dist/esm/icons/reply.mjs';
import rotateCcwClockIcon from 'lucide/dist/esm/icons/rotate-ccw-clock.mjs';
import rows3Icon from 'lucide/dist/esm/icons/rows-3.mjs';
import scrollTextIcon from 'lucide/dist/esm/icons/scroll-text.mjs';
import searchIcon from 'lucide/dist/esm/icons/search.mjs';
import sendIcon from 'lucide/dist/esm/icons/send.mjs';
import settingsIcon from 'lucide/dist/esm/icons/settings.mjs';
import settings2Icon from 'lucide/dist/esm/icons/settings-2.mjs';
import shieldCheckIcon from 'lucide/dist/esm/icons/shield-check.mjs';
import slidersHorizontalIcon from 'lucide/dist/esm/icons/sliders-horizontal.mjs';
import smartphoneIcon from 'lucide/dist/esm/icons/smartphone.mjs';
import sparklesIcon from 'lucide/dist/esm/icons/sparkles.mjs';
import squareIcon from 'lucide/dist/esm/icons/square.mjs';
import squarePenIcon from 'lucide/dist/esm/icons/square-pen.mjs';
import starIcon from 'lucide/dist/esm/icons/star.mjs';
import stickyNoteIcon from 'lucide/dist/esm/icons/sticky-note.mjs';
import sunIcon from 'lucide/dist/esm/icons/sun.mjs';
import tagIcon from 'lucide/dist/esm/icons/tag.mjs';
import textCursorInputIcon from 'lucide/dist/esm/icons/text-cursor-input.mjs';
import ticketIcon from 'lucide/dist/esm/icons/ticket.mjs';
import timerIcon from 'lucide/dist/esm/icons/timer.mjs';
import trashIcon from 'lucide/dist/esm/icons/trash.mjs';
import trendingDownIcon from 'lucide/dist/esm/icons/trending-down.mjs';
import trendingUpIcon from 'lucide/dist/esm/icons/trending-up.mjs';
import triangleAlertIcon from 'lucide/dist/esm/icons/triangle-alert.mjs';
import undo2Icon from 'lucide/dist/esm/icons/undo-2.mjs';
import uploadIcon from 'lucide/dist/esm/icons/upload.mjs';
import userIcon from 'lucide/dist/esm/icons/user.mjs';
import userPlusIcon from 'lucide/dist/esm/icons/user-plus.mjs';
import usersIcon from 'lucide/dist/esm/icons/users.mjs';
import webhookIcon from 'lucide/dist/esm/icons/webhook.mjs';
import wifiOffIcon from 'lucide/dist/esm/icons/wifi-off.mjs';
import workflowIcon from 'lucide/dist/esm/icons/workflow.mjs';
import xIcon from 'lucide/dist/esm/icons/x.mjs';
import zapIcon from 'lucide/dist/esm/icons/zap.mjs';

export const iconNodes = {
  home: houseIcon,
  inbox: inboxIcon,
  ticket: ticketIcon,
  queue: listTodoIcon,
  automation: zapIcon,
  workflow: workflowIcon,
  approvals: circleCheckBigIcon,
  insights: chartNoAxesCombinedIcon,
  ai: sparklesIcon,
  integrations: plugIcon,
  cmdb: boxesIcon,
  catalogue: layoutGridIcon,
  knowledge: bookOpenIcon,
  profile: circleUserIcon,
  people: usersIcon,
  security: shieldCheckIcon,
  audit: scrollTextIcon,
  settings: settingsIcon,
  platform: buildingComplexIcon,
  sla: timerIcon,
  compose: squarePenIcon,
  forms: fileTextIcon,
  fields: textCursorInputIcon,
  workforce: calendarClockIcon,
  assets: laptopIcon,
  apps: layoutGridIcon,
  help: circleQuestionMarkIcon,
  external: arrowUpRightIcon,
  grip: gripVerticalIcon,
  sparkles: sparklesIcon,
  lock: lockIcon,
  paperclip: paperclipIcon,
  reply: replyIcon,
  note: stickyNoteIcon,
  timer: timerIcon,
  file: fileIcon,
  tag: tagIcon,
  user: userIcon,
  key: keyRoundIcon,
  send: sendIcon,
  star: starIcon,
  history: rotateCcwClockIcon,
  calendar: calendarIcon,
  link: linkIcon,
  flag: flagIcon,
  archive: archiveIcon,
  'user-plus': userPlusIcon,
  search: searchIcon,
  bell: bellIcon,
  plus: plusIcon,
  minus: minusIcon,
  x: xIcon,
  check: checkIcon,
  dot: dotIcon,
  menu: menuIcon,
  'chevron-down': chevronDownIcon,
  'chevron-up': chevronUpIcon,
  'chevron-left': chevronLeftIcon,
  'chevron-right': chevronRightIcon,
  'arrow-up': arrowUpIcon,
  'arrow-down': arrowDownIcon,
  'arrow-left': arrowLeftIcon,
  'arrow-right': arrowRightIcon,
  'arrow-up-down': arrowUpDownIcon,
  ellipsis: ellipsisIcon,
  'list-filter': listFilterIcon,
  'columns-3': columns3Icon,
  'rows-3': rows3Icon,
  'sliders-horizontal': slidersHorizontalIcon,
  'chevrons-up-down': chevronsUpDownIcon,
  'panel-left': panelLeftIcon,
  'panel-right': panelRightIcon,
  pin: pinIcon,
  copy: copyIcon,
  'external-link': externalLinkIcon,
  'undo-2': undo2Icon,
  pencil: pencilIcon,
  trash: trashIcon,
  download: downloadIcon,
  upload: uploadIcon,
  'refresh-cw': refreshCwIcon,
  keyboard: keyboardIcon,
  'log-out': logOutIcon,
  'log-in': logInIcon,
  eye: eyeIcon,
  'eye-off': eyeOffIcon,
  play: playIcon,
  pause: circlePauseIcon,
  stop: squareIcon,
  'circle-check': circleCheckIcon,
  'triangle-alert': triangleAlertIcon,
  'circle-alert': circleAlertIcon,
  'circle-x': circleXIcon,
  'circle-dashed': circleDashedIcon,
  hourglass: hourglassIcon,
  info: infoIcon,
  'loader-circle': loaderCircleIcon,
  clock: clockIcon,
  'wifi-off': wifiOffIcon,
  'cloud-off': cloudOffIcon,
  ban: banIcon,
  'trending-up': trendingUpIcon,
  'trending-down': trendingDownIcon,
  globe: globeIcon,
  mail: mailIcon,
  'message-square': messageSquareIcon,
  'message-circle': messageCircleIcon,
  phone: phoneIcon,
  smartphone: smartphoneIcon,
  webhook: webhookIcon,
  bot: botIcon,
  sun: sunIcon,
  moon: moonIcon,
  monitor: monitorIcon,
  contrast: contrastIcon,
  'layers-2': layers2Icon,
  'settings-2': settings2Icon,
  'life-buoy': lifeBuoyIcon,
} as const satisfies Record<IconName, IconNode>;

